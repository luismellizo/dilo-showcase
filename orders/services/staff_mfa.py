"""
Segundo factor del panel interno: código de un solo uso enviado por correo.

Por qué existe: el panel `/admin` controla TODAS las tiendas de la plataforma
—config, planes, impersonation—. Una contraseña filtrada no puede bastar para
abrirlo.

Reglas del código (settings):
- 6 dígitos, generados con `secrets` (nunca `random`).
- Vive `STAFF_MFA_CODE_TTL_SECONDS` (3 min). Vencido → hay que pedir otro.
- Se guarda HASHEADO; ni leyendo la DB se puede completar un login ajeno.
- Un solo uso, y `STAFF_MFA_MAX_ATTEMPTS` intentos antes de quemarse (un
  código de 6 dígitos se adivina en 10^6 intentos: sin tope, es papel).
- Emitir uno nuevo invalida los anteriores del mismo usuario.
"""
import logging
import secrets

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.utils import timezone

from . import mailer
from ..models import StaffLoginChallenge

logger = logging.getLogger(__name__)

CODE_LENGTH = 6


def generate_code():
    """Código numérico de 6 dígitos, con ceros a la izquierda válidos."""
    return f"{secrets.randbelow(10 ** CODE_LENGTH):0{CODE_LENGTH}d}"


def create_challenge(user, *, ip=None, user_agent=""):
    """
    Emite un desafío nuevo (invalidando los pendientes del usuario) y devuelve
    `(challenge, codigo_en_claro)`. El código en claro solo existe en memoria
    el tiempo de mandar el correo.
    """
    now = timezone.now()
    # Pedir un código nuevo mata los anteriores: si no, cada reenvío ampliaría
    # la ventana de códigos válidos simultáneos.
    StaffLoginChallenge.objects.filter(
        user=user, consumed_at__isnull=True, expires_at__gt=now
    ).update(expires_at=now)

    code = generate_code()
    challenge = StaffLoginChallenge.objects.create(
        user=user,
        code_hash=make_password(code),
        expires_at=now + timezone.timedelta(seconds=settings.STAFF_MFA_CODE_TTL_SECONDS),
        ip_address=ip,
        user_agent=(user_agent or "")[:300],
    )
    return challenge, code


def verify_challenge(challenge, code):
    """
    Valida el código contra el desafío. Devuelve `(ok, motivo)`.

    Consume el desafío solo si acierta; cada fallo suma un intento (y al
    llegar al tope el desafío queda inservible aunque el código fuera bueno).
    """
    if challenge.consumed_at is not None:
        return False, 'ya_usado'
    if challenge.is_expired:
        return False, 'expirado'
    if challenge.attempts >= settings.STAFF_MFA_MAX_ATTEMPTS:
        return False, 'intentos_agotados'

    if not check_password((code or '').strip(), challenge.code_hash):
        challenge.attempts += 1
        challenge.save(update_fields=['attempts'])
        return False, 'codigo_incorrecto'

    challenge.consumed_at = timezone.now()
    challenge.save(update_fields=['consumed_at'])
    return True, ''


def ttl_label():
    """'3 minutos' / '45 segundos' — se muestra tal cual en el correo."""
    seconds = settings.STAFF_MFA_CODE_TTL_SECONDS
    if seconds >= 120 and seconds % 60 == 0:
        return f"{seconds // 60} minutos"
    if seconds >= 60:
        minutos = seconds // 60
        return f"{minutos} minuto{'s' if minutos > 1 else ''}"
    return f"{seconds} segundos"


def send_code_email(user, code, *, ip=None):
    """
    Envía el código al correo del miembro del equipo con la plantilla de marca.

    Devuelve True/False; el fallo NO se traga en la vista (si el correo no
    salió, el usuario nunca podría completar el login y merece saberlo).
    """
    return mailer.send_brand_email(
        'verification_code',
        to=user.email or user.username,
        subject=f"{code} es tu código de acceso al panel DILO",
        context={
            'code': code,
            'ttl_label': ttl_label(),
            'greeting_name': user.first_name or '',
            'purpose': 'entrar al panel interno de DILO',
            'ip': ip,
            'header_tag': 'Panel interno',
        },
    )


def send_login_alert(user, *, ip=None, user_agent='', when=None):
    """
    Aviso de sesión abierta en el panel. Accesorio a propósito: si el correo
    falla, el login ya ocurrió y no se toca — por eso el resultado se ignora
    en la vista.
    """
    when = when or timezone.localtime()
    rows = [
        {'label': 'Cuenta', 'value': user.email or user.username},
        {'label': 'Fecha y hora', 'value': when.strftime('%d/%m/%Y, %I:%M %p')},
        {'label': 'Dispositivo', 'value': describe_user_agent(user_agent)},
    ]
    if ip:
        rows.append({'label': 'Dirección IP', 'value': ip})
    rows.append({'label': 'Acceso', 'value': 'Panel interno DILO', 'accent': True})

    frontend = (getattr(settings, 'FRONTEND_URL', '') or 'https://dilo.example.com').rstrip('/')
    return mailer.send_brand_email(
        'login_alert',
        to=user.email or user.username,
        subject="Nuevo inicio de sesión en el panel DILO",
        context={
            'greeting_name': user.first_name or '',
            'rows': rows,
            'account_url': f"{frontend}/admin/audit",
            'panel_label': 'Ver la bitácora del panel',
            'header_tag': 'Panel interno',
        },
    )


def describe_user_agent(user_agent):
    """
    'Chrome en Windows' a partir del user agent.

    Es una aproximación deliberada: en un correo de seguridad importa que el
    usuario reconozca (o no) el dispositivo, no la versión exacta del motor.
    Ante la duda, se devuelve el texto crudo recortado antes que inventar.
    """
    ua = (user_agent or '').strip()
    if not ua:
        return 'Dispositivo desconocido'

    navegador = next(
        (nombre for marca, nombre in (
            ('Edg/', 'Edge'), ('OPR/', 'Opera'), ('Firefox/', 'Firefox'),
            ('Chrome/', 'Chrome'), ('Safari/', 'Safari'),
        ) if marca in ua),
        None,
    )
    sistema = next(
        (nombre for marca, nombre in (
            ('iPhone', 'iPhone'), ('iPad', 'iPad'), ('Android', 'Android'),
            ('Mac OS X', 'macOS'), ('Windows', 'Windows'), ('CrOS', 'ChromeOS'),
            ('Linux', 'Linux'),
        ) if marca in ua),
        None,
    )
    if navegador and sistema:
        return f"{navegador} en {sistema}"
    return navegador or sistema or ua[:60]
