"""
Acciones sensibles de la cuenta del comercio: restablecer contraseña y cambiar
el correo de acceso.

Ambas comparten la misma pieza — un enlace de un solo uso que prueba que quien
lo abre controla el buzón. Toda la lógica vive aquí y no en las vistas para que
haya UN solo lugar donde se decide cuánto vive un token, cómo se guarda y qué
correo se manda.

Reglas (no negociables, son la puerta de una cuenta):
- Token de 256 bits con `secrets` (nunca `random`), en la URL.
- En DB solo el SHA-256: leer la base de datos no permite tomar una cuenta.
- Un solo uso. Consumirlo o pedir uno nuevo invalida los anteriores del mismo
  usuario y propósito.
- Vencen (`PASSWORD_RESET_TTL_MINUTES` / `EMAIL_CHANGE_TTL_MINUTES`).
- Ninguna respuesta revela si un correo está registrado (enumeración de
  usuarios): eso lo garantizan las vistas, aquí las funciones son honestas.
"""
import hashlib
import logging
import secrets

from django.conf import settings
from django.utils import timezone

from . import mailer
from .staff_mfa import describe_user_agent
from ..models import AccountToken

logger = logging.getLogger(__name__)


def _hash(raw_token):
    """SHA-256 hex del token. Determinista a propósito: hay que poder buscarlo."""
    return hashlib.sha256((raw_token or '').encode('utf-8')).hexdigest()


def _ttl_minutes(purpose):
    if purpose == AccountToken.Purpose.PASSWORD_RESET:
        return settings.PASSWORD_RESET_TTL_MINUTES
    return settings.EMAIL_CHANGE_TTL_MINUTES


def ttl_label(purpose):
    """'1 hora' / '45 minutos' — se imprime tal cual en el correo."""
    minutes = _ttl_minutes(purpose)
    if minutes >= 120 and minutes % 60 == 0:
        return f"{minutes // 60} horas"
    if minutes == 60:
        return "1 hora"
    return f"{minutes} minutos"


def issue_token(user, purpose, *, new_email="", ip=None, user_agent=""):
    """
    Emite un token nuevo e invalida los pendientes del mismo usuario+propósito.

    Devuelve `(token_obj, token_en_claro)`. El valor en claro solo existe en
    memoria el tiempo que tarda en irse el correo.
    """
    now = timezone.now()
    AccountToken.objects.filter(
        user=user, purpose=purpose, consumed_at__isnull=True, expires_at__gt=now
    ).update(expires_at=now)

    raw = secrets.token_urlsafe(32)
    token = AccountToken.objects.create(
        user=user,
        purpose=purpose,
        token_hash=_hash(raw),
        new_email=new_email or "",
        expires_at=now + timezone.timedelta(minutes=_ttl_minutes(purpose)),
        ip_address=ip,
        user_agent=(user_agent or "")[:300],
    )
    return token, raw


def consume_token(raw_token, purpose):
    """
    Canjea el token. Devuelve `(token_obj, motivo)`; `token_obj` es None si no
    sirve. Motivos: `invalido` (no existe / propósito equivocado / ya usado),
    `expirado`.

    La marca de consumido se escribe con un UPDATE condicionado
    (`consumed_at__isnull=True`): si dos clics llegan a la vez, solo uno gana.
    """
    token = AccountToken.objects.filter(
        token_hash=_hash(raw_token), purpose=purpose
    ).first()
    if token is None or token.consumed_at is not None:
        return None, 'invalido'
    if token.is_expired:
        return None, 'expirado'

    now = timezone.now()
    claimed = AccountToken.objects.filter(
        pk=token.pk, consumed_at__isnull=True
    ).update(consumed_at=now)
    if not claimed:
        return None, 'invalido'

    token.consumed_at = now
    return token, ''


def invalidate_tokens(user, purpose=None):
    """
    Quema los tokens pendientes de un usuario. Se llama al cambiar la
    contraseña: un enlace viejo circulando por un correo ajeno deja de servir.
    """
    now = timezone.now()
    qs = AccountToken.objects.filter(
        user=user, consumed_at__isnull=True, expires_at__gt=now
    )
    if purpose:
        qs = qs.filter(purpose=purpose)
    return qs.update(expires_at=now)


# ---------------------------------------------------------------------------
# Correos (siempre por `mailer.send_brand_email`, jamás HTML a mano)
# ---------------------------------------------------------------------------

def send_password_reset_email(user, raw_token, *, ip=None, user_agent=""):
    """
    Manda el enlace de restablecimiento. Devuelve True/False: la vista responde
    lo mismo pase lo que pase (no revelar si el correo existe), pero el fallo
    tiene que quedar en el log.
    """
    label = ttl_label(AccountToken.Purpose.PASSWORD_RESET)
    rows = [
        {'label': 'Cuenta', 'value': user.email or user.username},
        {'label': 'El enlace vence en', 'value': label, 'accent': True},
    ]
    if ip:
        rows.append({'label': 'Solicitado desde', 'value': ip})
    if user_agent:
        rows.append({'label': 'Dispositivo', 'value': describe_user_agent(user_agent)})

    return mailer.send_brand_email(
        'password_reset',
        to=user.email or user.username,
        subject="Restablece tu contraseña de DILO",
        context={
            'reset_url': f"{mailer.public_site_url()}/reset-password?token={raw_token}",
            'ttl_label': label,
            'greeting_name': user.first_name or '',
            'rows': rows,
        },
    )


def send_email_change_email(user, raw_token, new_email):
    """
    Manda la confirmación al buzón NUEVO (es el que hay que probar). El aviso al
    buzón viejo es otro envío distinto — ver `send_email_change_notice`.
    """
    label = ttl_label(AccountToken.Purpose.EMAIL_CHANGE)
    return mailer.send_brand_email(
        'email_change',
        to=new_email,
        subject="Confirma tu nuevo correo en DILO",
        context={
            'confirm_url': f"{mailer.public_site_url()}/confirm-email?token={raw_token}",
            'ttl_label': label,
            'greeting_name': user.first_name or '',
            'old_email': user.email or user.username,
            'new_email': new_email,
            'rows': [
                {'label': 'Correo actual', 'value': user.email or user.username},
                {'label': 'Correo nuevo', 'value': new_email, 'accent': True},
                {'label': 'La solicitud vence en', 'value': label},
            ],
            'header_tag': 'Cuenta',
        },
    )


def send_email_change_notice(user, new_email):
    """
    Avisa al buzón VIEJO que alguien pidió mover el correo de la cuenta.

    Es la única defensa si a alguien le roban la sesión: el dueño se entera
    ANTES de perder el acceso. Accesorio a propósito — si el correo falla, la
    solicitud no se detiene (el cambio real todavía exige abrir el enlace del
    buzón nuevo).
    """
    return mailer.send_brand_email(
        'security_notice',
        to=user.email or user.username,
        subject="Se solicitó cambiar el correo de tu cuenta DILO",
        context={
            'greeting_name': user.first_name or '',
            'eyebrow': 'Seguridad de la cuenta',
            'headline': 'Se solicitó cambiar tu correo',
            'intro': ('pediste mover el acceso de tu cuenta DILO a otro buzón. '
                      'El cambio solo se aplica cuando se confirme desde el correo nuevo.'),
            'card_title': 'La solicitud',
            'rows': [
                {'label': 'Correo actual', 'value': user.email or user.username},
                {'label': 'Correo solicitado', 'value': new_email, 'accent': True},
                {'label': 'Fecha y hora',
                 'value': timezone.localtime().strftime('%d/%m/%Y, %I:%M %p')},
            ],
            'account_url': f"{mailer.public_site_url()}/dashboard/profile",
            'panel_label': 'Revisar mi cuenta',
            'alert_heading': '¿No pediste este cambio?',
            'alert_text': ('Cambia tu contraseña ahora mismo: alguien con acceso a tu '
                           'sesión intentó quedarse con la cuenta. Mientras no se confirme '
                           'desde el buzón nuevo, tu correo actual sigue siendo el de acceso.'),
            'header_tag': 'Cuenta y seguridad',
        },
    )


def send_password_changed_notice(user, *, ip=None, user_agent=""):
    """
    Avisa que la contraseña quedó cambiada. Va después de aplicar el cambio, al
    correo de la cuenta: si el usuario no fue, se entera de inmediato y no
    semanas después. Accesorio, no rompe el flujo.
    """
    rows = [
        {'label': 'Cuenta', 'value': user.email or user.username},
        {'label': 'Fecha y hora',
         'value': timezone.localtime().strftime('%d/%m/%Y, %I:%M %p'), 'accent': True},
    ]
    if user_agent:
        rows.append({'label': 'Dispositivo', 'value': describe_user_agent(user_agent)})
    if ip:
        rows.append({'label': 'Dirección IP', 'value': ip})

    return mailer.send_brand_email(
        'security_notice',
        to=user.email or user.username,
        subject="Tu contraseña de DILO fue cambiada",
        context={
            'greeting_name': user.first_name or '',
            'eyebrow': 'Seguridad de la cuenta',
            'headline': 'Tu contraseña quedó cambiada',
            'intro': 'ya puedes entrar a DILO con tu contraseña nueva.',
            'card_title': 'El cambio',
            'rows': rows,
            'account_url': f"{mailer.public_site_url()}/dashboard",
            'panel_label': 'Entrar a mi panel',
            'alert_heading': '¿No fuiste tú?',
            'alert_text': ('Escríbenos de inmediato desde este mismo correo: alguien con '
                           'acceso a tu buzón cambió la contraseña de tu cuenta.'),
            'header_tag': 'Cuenta y seguridad',
        },
    )
