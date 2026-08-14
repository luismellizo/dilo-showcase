"""
Roles y permisos del equipo interno de DILO (panel /admin).

Roles vía grupos de Django (cero migración de auth):
- `dilo_admin`   → todo: editar config de tiendas, cambiar planes, impersonar.
- `dilo_soporte` → solo lectura + impersonar (para atender soporte).
- `dilo_lectura` → solo lectura.
Superuser = admin implícito.

Asignación: `python manage.py staffrole <email> <admin|soporte|lectura>`
(o desde el admin de Django, grupos dilo_*).
"""
from django.conf import settings
from rest_framework.permissions import BasePermission

# grupo Django → rol expuesto al frontend
STAFF_GROUP_ROLES = {
    'dilo_admin': 'admin',
    'dilo_soporte': 'soporte',
    'dilo_lectura': 'lectura',
}
# orden de precedencia si un usuario está en varios grupos
_ROLE_PRECEDENCE = ['dilo_admin', 'dilo_soporte', 'dilo_lectura']


def email_domain_allowed(email):
    """
    ¿El correo pertenece a un dominio del equipo (settings.STAFF_EMAIL_DOMAINS)?

    Es una condición de identidad, no solo de login: el panel controla TODAS
    las tiendas, así que una cuenta con rol dilo_* en un correo personal no es
    equipo interno por más grupo que tenga asignado.
    """
    domains = getattr(settings, 'STAFF_EMAIL_DOMAINS', [])
    if not domains:          # lista vacía = restricción desactivada a propósito
        return True
    email = (email or '').strip().lower()
    if '@' not in email:
        return False
    return email.rsplit('@', 1)[1] in domains


def staff_role(user):
    """Rol interno del usuario ('admin'/'soporte'/'lectura') o None si no es del equipo."""
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    # El dominio manda por encima del grupo Y del superuser: un superuser con
    # correo personal administra Django, no el panel de clientes de DILO.
    if not email_domain_allowed(user.email or user.username):
        return None
    if user.is_superuser:
        return 'admin'
    names = set(user.groups.values_list('name', flat=True))
    for group in _ROLE_PRECEDENCE:
        if group in names:
            return STAFF_GROUP_ROLES[group]
    return None


def is_staff_session(request):
    """
    ¿El token con el que llega la request salió de la puerta del panel
    (/api/staff/login/ + código por correo)?

    Sin esto, un token del login de comercios —que no pasó por el segundo
    factor— abriría igual el panel: el 2FA sería decorativo.
    """
    token = getattr(request, 'auth', None)
    if token is None:
        return False
    try:
        return bool(token.get('staff'))
    except (AttributeError, TypeError):
        return False


class IsInternalStaff(BasePermission):
    """Bloquea todo el panel a quien no sea del equipo interno."""
    message = "Solo el equipo interno de DILO puede acceder a este recurso."

    def has_permission(self, request, view):
        return staff_role(request.user) is not None and is_staff_session(request)


class IsStaffAdmin(BasePermission):
    """Solo rol admin (mutaciones: config de tienda, planes)."""
    message = "Se requiere rol de administrador interno."

    def has_permission(self, request, view):
        return staff_role(request.user) == 'admin' and is_staff_session(request)


class CanImpersonate(BasePermission):
    """Impersonation: admin y soporte."""
    message = "Se requiere rol de administrador o soporte."

    def has_permission(self, request, view):
        return staff_role(request.user) in ('admin', 'soporte') and is_staff_session(request)


def client_ip(request):
    """IP real del cliente (primer hop de X-Forwarded-For detrás del proxy nginx)."""
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def write_audit(request, action, store=None, target_user=None, detail=None,
                actor=None, actor_email=None):
    """
    Registra una acción del equipo. Nunca rompe la request si falla.

    `actor`/`actor_email` permiten registrar acciones donde `request.user` aún
    no existe (login del panel: la request llega anónima, y un intento fallido
    ni siquiera tiene usuario — solo el email que se intentó).
    """
    from .models import AuditLog
    actor = actor if actor is not None else getattr(request, 'user', None)
    authenticated = bool(getattr(actor, 'is_authenticated', False))
    try:
        AuditLog.objects.create(
            actor=actor if authenticated else None,
            actor_email=actor_email or (
                (actor.email or actor.username) if authenticated else ""),
            action=action,
            store=store,
            store_name=store.name if store else "",
            target_user_email=(target_user.email or target_user.username) if target_user else "",
            ip_address=client_ip(request),
            detail=detail or {},
        )
    except Exception:
        import logging
        logging.getLogger(__name__).error("No se pudo escribir AuditLog", exc_info=True)
