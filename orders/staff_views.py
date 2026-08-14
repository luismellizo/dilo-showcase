"""
Panel administrativo interno de DILO — endpoints /api/staff/*.

Acceso restringido por roles internos (ver staff_permissions.py).
Toda mutación y toda impersonación quedan en AuditLog.

Métricas que HOY no existen en DB (se reportan como requires_instrumentation,
nunca se simulan): pagos fallidos (no hay tabla de transacciones de
suscripción — el cobro es manual), errores recurrentes (viven en Sentry),
"features más usadas" (no hay event tracking).
"""
import logging
import os
import uuid
from datetime import timedelta

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core.paginator import Paginator
from django.db.models import Count, Max, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import AccessToken

from . import billing
from .models import (
    AuditLog, Customer, Message, Order, Plan, StaffLoginChallenge, Store,
    Subscription,
)
from .services import staff_mfa
from .staff_permissions import (
    CanImpersonate, IsInternalStaff, IsStaffAdmin, client_ip,
    email_domain_allowed, staff_role, write_audit,
)

logger = logging.getLogger(__name__)

IMPERSONATION_MINUTES = 30
PAGE_SIZE = 25

# Duración de la sesión del panel interno. Corta a propósito: el token no
# tiene refresh, así que al vencer hay que volver a autenticarse en
# /admin/login. Ver StaffLoginView.
STAFF_SESSION_HOURS = int(os.getenv('STAFF_SESSION_HOURS', '2'))

# Campos de Store que el panel puede editar. Whitelist estricta: jamás
# owner, credenciales ni payment_config por esta vía.
STORE_EDITABLE_FIELDS = [
    'name', 'theme_color',
    'bot_name', 'bot_personality', 'business_description', 'address',
    'business_hours', 'delivery_info', 'delivery_fee', 'free_delivery_min',
    'prep_time_minutes', 'payment_instructions', 'bot_extra_info',
    'bot_custom_instructions',
]

# Estados de orden que cuentan como venta real para GMV.
SOLD_STATUSES = [Order.Status.CONFIRMED, Order.Status.COMPLETED]

REQUIRES_INSTRUMENTATION = [
    {'metric': 'pagos_fallidos', 'reason': 'No existe tabla de transacciones de suscripción (cobro manual por Nequi/transferencia).'},
    {'metric': 'errores_recurrentes', 'reason': 'Los errores viven en Sentry, no en la base de datos.'},
    {'metric': 'features_mas_usadas', 'reason': 'No hay event tracking de uso del dashboard.'},
]


class StaffStoreEditSerializer(serializers.ModelSerializer):
    """Valida el PATCH de config de tienda desde el panel interno."""
    class Meta:
        model = Store
        fields = STORE_EDITABLE_FIELDS


def _paginate(request, queryset_or_list, build):
    """Paginación simple ?page=N. `build` mapea cada objeto a dict."""
    try:
        page_num = max(1, int(request.query_params.get('page', 1)))
    except (TypeError, ValueError):
        page_num = 1
    paginator = Paginator(queryset_or_list, PAGE_SIZE)
    page = paginator.get_page(page_num)
    return {
        'count': paginator.count,
        'page': page.number,
        'pages': paginator.num_pages,
        'results': [build(obj) for obj in page.object_list],
    }


def _subscription_dict(store):
    sub = getattr(store, 'subscription', None)
    if not sub:
        return None
    return {
        'plan_code': sub.plan.code,
        'plan_name': sub.plan.name,
        'price_cop': float(sub.plan.price_cop),
        'status': sub.status,
        'trial_ends_at': sub.trial_ends_at.isoformat() if sub.trial_ends_at else None,
        'current_period_start': sub.current_period_start.isoformat(),
        'current_period_end': sub.current_period_end.isoformat(),
        'conversations_used': sub.conversations_used,
        'conversation_limit': sub.plan.conversation_limit,
    }


def _mask_email(email):
    """`admin@example.com` → `ad•••@example.com`. Confirma a dónde fue el código sin
    dictarle la dirección completa a quien tenga la contraseña robada."""
    email = email or ''
    if '@' not in email:
        return email
    local, domain = email.rsplit('@', 1)
    visible = local[:2]
    return f"{visible}{'•' * max(3, len(local) - 2)}@{domain}"


def _audit_login(request, email, *, ok, user=None, reason='', extra=None):
    """Rastro de todo paso de la puerta del panel, exitoso o fallido."""
    detail = {
        'ok': ok,
        'email_intentado': email,
        'user_agent': (request.META.get('HTTP_USER_AGENT') or '')[:300],
    }
    if reason:
        detail['motivo'] = reason
    detail.update(extra or {})
    write_audit(
        request, AuditLog.Action.STAFF_LOGIN,
        detail=detail,
        actor=user,                       # None en intentos sin cuenta que atribuir
        actor_email=(user.email or user.username) if user else email,
    )


class StaffLoginView(APIView):
    """
    POST /api/staff/login/ {email, password} — PRIMER paso de la puerta del
    panel interno (/admin/login), separada del login de comercios.

    NO emite sesión: valida credenciales y manda un código de 6 dígitos al
    correo del equipo. La sesión sale del segundo paso (StaffLoginVerifyView).

    Seguridad:
    - Solo correos de `settings.STAFF_EMAIL_DOMAINS` (dominio interno) — un correo
      personal no es equipo interno por más rol que tenga.
    - Throttle propio y agresivo (`staff_login`, 5/min por IP).
    - Respuesta 401 SIEMPRE idéntica: no revela si el email existe, si la
      contraseña falló, si el dominio no aplica o si la cuenta no es interna.
    - Todo intento —exitoso o fallido— queda en AuditLog con IP y user agent.
    """
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'staff_login'

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        password = request.data.get('password') or ''

        if not email or not password:
            return self._deny(request, email, 'campos_incompletos')
        if not email_domain_allowed(email):
            # Se corta antes de tocar la DB: ni siquiera se comprueba la
            # contraseña de un correo que jamás podrá ser del equipo.
            return self._deny(request, email, 'dominio_no_autorizado')

        user = authenticate(username=email, password=password)
        if not user:
            return self._deny(request, email, 'credenciales_invalidas')
        if not user.is_active:
            return self._deny(request, email, 'cuenta_inactiva', user=user)

        role = staff_role(user)
        if role is None:
            # Cuenta real de comercio intentando entrar al panel: mismo 401
            # genérico, pero el intento queda registrado (es señal).
            return self._deny(request, email, 'sin_rol_interno', user=user)

        destino = user.email or user.username
        if not email_domain_allowed(destino):
            # Defensa de borde: el username es del dominio pero el correo real
            # no. El código iría a parar fuera del equipo.
            return self._deny(request, email, 'correo_de_contacto_externo', user=user)

        ip = client_ip(request)
        challenge, code = staff_mfa.create_challenge(
            user, ip=ip, user_agent=request.META.get('HTTP_USER_AGENT', ''))

        if not staff_mfa.send_code_email(user, code, ip=ip):
            # Sin correo no hay forma de completar el login: decirlo claro es
            # mejor que dejar al admin esperando un código que nunca llega.
            challenge.delete()
            _audit_login(request, email, ok=False, user=user, reason='envio_de_correo_fallido')
            return Response(
                {'error': 'No se pudo enviar el código de verificación. Intenta de nuevo.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE)

        _audit_login(request, email, ok=True, user=user,
                     extra={'paso': 'codigo_enviado', 'rol': role})
        logger.info("🛡️ Código de panel enviado a %s (rol %s) desde IP %s", email, role, ip)

        return Response({
            'mfa_required': True,
            'challenge_id': str(challenge.id),
            'expires_in': challenge.seconds_left,
            'email_hint': _mask_email(destino),
        })

    def _deny(self, request, email, reason, user=None):
        _audit_login(request, email, ok=False, user=user, reason=reason)
        logger.warning("🚫 Login staff rechazado (%s): %s desde IP %s", reason, email,
                       request.META.get('REMOTE_ADDR'))
        return Response({'error': 'Credenciales inválidas'},
                        status=status.HTTP_401_UNAUTHORIZED)


class StaffLoginVerifyView(APIView):
    """
    POST /api/staff/login/verify/ {challenge_id, code} — SEGUNDO paso: canjea
    el código del correo por la sesión del panel.

    - Access token corto (STAFF_SESSION_HOURS) y **sin refresh**.
    - Claim `staff=<rol>`: `IsInternalStaff` exige que el token venga de aquí,
      así un token del login de comercios no abre el panel aunque la cuenta
      tenga rol interno (si no, el segundo factor sería decorativo).
    - Código vencido → 410 con `expired: true`, para que la UI ofrezca pedir
      otro en vez de dejar al usuario adivinando.
    """
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'staff_mfa'

    def post(self, request):
        challenge_id = (request.data.get('challenge_id') or '').strip()
        code = (request.data.get('code') or '').strip()

        challenge = None
        if challenge_id:
            challenge = StaffLoginChallenge.objects.select_related('user').filter(
                id=challenge_id).first() if _looks_like_uuid(challenge_id) else None
        if challenge is None or not code:
            _audit_login(request, '', ok=False, reason='desafio_invalido',
                         extra={'paso': 'verificacion'})
            return Response({'error': 'Código inválido o vencido.'},
                            status=status.HTTP_401_UNAUTHORIZED)

        user = challenge.user
        email = user.email or user.username

        if challenge.is_expired:
            _audit_login(request, email, ok=False, user=user, reason='codigo_expirado',
                         extra={'paso': 'verificacion'})
            return Response({'error': 'El código venció. Solicita uno nuevo.', 'expired': True},
                            status=status.HTTP_410_GONE)

        ok, reason = staff_mfa.verify_challenge(challenge, code)
        if not ok:
            _audit_login(request, email, ok=False, user=user, reason=reason,
                         extra={'paso': 'verificacion', 'intentos': challenge.attempts})
            logger.warning("🚫 Código de panel rechazado (%s) para %s desde IP %s",
                           reason, email, request.META.get('REMOTE_ADDR'))
            return Response({'error': 'Código inválido o vencido.'},
                            status=status.HTTP_401_UNAUTHORIZED)

        # El rol se vuelve a leer aquí: pudo revocarse en los 3 minutos que el
        # código estuvo vivo, y el token no debe nacer con un permiso muerto.
        role = staff_role(user)
        if role is None or not user.is_active:
            _audit_login(request, email, ok=False, user=user, reason='rol_revocado',
                         extra={'paso': 'verificacion'})
            return Response({'error': 'Código inválido o vencido.'},
                            status=status.HTTP_401_UNAUTHORIZED)

        token = AccessToken.for_user(user)
        token.set_exp(lifetime=timedelta(hours=STAFF_SESSION_HOURS))
        token['staff'] = role

        # Aviso de sesión abierta. Accesorio: si el correo falla, el login ya
        # ocurrió — no se revierte ni se bloquea por un problema de SMTP.
        staff_mfa.send_login_alert(
            user, ip=client_ip(request), user_agent=request.META.get('HTTP_USER_AGENT', ''))

        _audit_login(request, email, ok=True, user=user,
                     extra={'paso': 'sesion_iniciada', 'rol': role})
        logger.info("🛡️ Sesión de panel abierta: %s (rol %s) desde IP %s", email, role,
                    request.META.get('REMOTE_ADDR'))

        return Response({
            'access': str(token),
            'expires_in': STAFF_SESSION_HOURS * 3600,
            'role': role,
            'user': {'email': email, 'name': user.get_full_name()},
        })


def _looks_like_uuid(value):
    """Evita que un challenge_id basura reviente el filtro con ValidationError."""
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


class StaffMeView(APIView):
    """GET /api/staff/me/ — rol del miembro autenticado (guard del frontend)."""
    permission_classes = [IsInternalStaff]

    def get(self, request):
        return Response({
            'role': staff_role(request.user),
            'email': request.user.email,
            'name': request.user.get_full_name(),
        })


class StaffOverviewView(APIView):
    """GET /api/staff/overview/ — KPIs globales + alertas."""
    permission_classes = [IsInternalStaff]

    def get(self, request):
        now = timezone.now()
        d30 = now - timedelta(days=30)
        d14 = now - timedelta(days=14)

        total_stores = Store.objects.count()
        active_store_ids = set(
            Customer.objects.filter(last_user_message_at__gte=d30)
            .values_list('store_id', flat=True).distinct()
        )

        subs = Subscription.objects.select_related('plan', 'store')
        subs_by_status = {
            row['status']: row['n']
            for row in subs.values('status').annotate(n=Count('id'))
        }
        mrr = subs.filter(status=Subscription.Status.ACTIVE).aggregate(
            total=Sum('plan__price_cop'))['total'] or 0

        orders_30d = Order.objects.filter(created_at__gte=d30)
        gmv_30d = orders_30d.filter(status__in=SOLD_STATUSES).aggregate(
            total=Sum('total_amount'))['total'] or 0

        # --- Alertas ---
        alerts = []
        for sub in subs.filter(status=Subscription.Status.PAST_DUE)[:20]:
            alerts.append({
                'type': 'past_due',
                'store_id': str(sub.store_id),
                'store_name': sub.store.name,
                'message': f'Pago vencido (plan {sub.plan.name})',
            })
        for sub in subs.filter(
            status=Subscription.Status.TRIALING,
            trial_ends_at__lte=now + timedelta(days=3),
            trial_ends_at__gte=now,
        )[:20]:
            days = max(0, (sub.trial_ends_at - now).days)
            alerts.append({
                'type': 'trial_ending',
                'store_id': str(sub.store_id),
                'store_name': sub.store.name,
                'message': f'Trial vence en {days} día(s)',
            })
        inactive = (
            Store.objects.annotate(last_activity=Max('customers__last_user_message_at'))
            .filter(Q(last_activity__lt=d14) | Q(last_activity__isnull=True))
            .order_by('name')[:20]
        )
        for store in inactive:
            alerts.append({
                'type': 'inactive',
                'store_id': str(store.id),
                'store_name': store.name,
                'message': (
                    f'Sin actividad desde {store.last_activity:%Y-%m-%d}'
                    if store.last_activity else 'Sin actividad registrada (nunca)'
                ),
            })

        return Response({
            'kpis': {
                'total_stores': total_stores,
                'active_stores_30d': len(active_store_ids),
                'inactive_stores_30d': total_stores - len(active_store_ids),
                'total_users': User.objects.filter(is_active=True).count(),
                'mrr_cop': float(mrr),
                'subscriptions_by_status': subs_by_status,
                'orders_30d': orders_30d.count(),
                'sold_orders_30d': orders_30d.filter(status__in=SOLD_STATUSES).count(),
                'gmv_30d_cop': float(gmv_30d),
                'messages_30d': Message.objects.filter(timestamp__gte=d30).count(),
                'customers_total': Customer.objects.count(),
            },
            'alerts': alerts,
            'requires_instrumentation': REQUIRES_INSTRUMENTATION,
        })


class StaffStoreListView(APIView):
    """GET /api/staff/stores/?q=&page= — listado de tiendas (clientes de DILO)."""
    permission_classes = [IsInternalStaff]

    def get(self, request):
        qs = (
            Store.objects.select_related('owner', 'subscription__plan')
            .annotate(
                order_count=Count('orders', distinct=True),
                customer_count=Count('customers', distinct=True),
                last_activity=Max('customers__last_user_message_at'),
            )
            .order_by('name')
        )
        q = (request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(
                Q(name__icontains=q) | Q(owner__email__icontains=q) | Q(owner__first_name__icontains=q)
            )

        def build(store):
            sub = getattr(store, 'subscription', None)
            return {
                'id': str(store.id),
                'name': store.name,
                'owner_email': store.owner.email,
                'owner_last_login': store.owner.last_login.isoformat() if store.owner.last_login else None,
                'registered_at': store.owner.date_joined.isoformat(),
                'plan_code': sub.plan.code if sub else None,
                'subscription_status': sub.status if sub else None,
                'conversations_used': sub.conversations_used if sub else None,
                'conversation_limit': sub.plan.conversation_limit if sub else None,
                'order_count': store.order_count,
                'customer_count': store.customer_count,
                'last_activity': store.last_activity.isoformat() if store.last_activity else None,
            }

        return Response(_paginate(request, qs, build))


class StaffStoreDetailView(APIView):
    """
    GET  /api/staff/stores/<uuid>/  — ficha completa del cliente.
    PATCH /api/staff/stores/<uuid>/ — edita config (whitelist, solo admin, con audit).
    """
    permission_classes = [IsInternalStaff]

    def get_permissions(self):
        if self.request.method == 'PATCH':
            return [IsStaffAdmin()]
        return super().get_permissions()

    def _detail(self, store):
        now = timezone.now()
        d30 = now - timedelta(days=30)
        owner = store.owner
        profile = getattr(owner, 'profile', None)
        orders = Order.objects.filter(store=store)
        orders_by_status = {
            row['status']: row['n']
            for row in orders.values('status').annotate(n=Count('id'))
        }
        gmv_total = orders.filter(status__in=SOLD_STATUSES).aggregate(t=Sum('total_amount'))['t'] or 0
        gmv_30d = orders.filter(status__in=SOLD_STATUSES, created_at__gte=d30).aggregate(t=Sum('total_amount'))['t'] or 0
        wa = getattr(store, 'whatsapp_credentials', None)
        tg = getattr(store, 'telegram_credentials', None)
        pay = getattr(store, 'payment_config', None)
        last_activity = Customer.objects.filter(store=store).aggregate(
            t=Max('last_user_message_at'))['t']

        return {
            'id': str(store.id),
            'name': store.name,
            'account': {
                'owner_email': owner.email,
                'owner_name': owner.get_full_name(),
                'owner_whatsapp': profile.whatsapp_number if profile else None,
                'whatsapp_verified': profile.is_whatsapp_verified if profile else False,
                'registered_at': owner.date_joined.isoformat(),
                'last_login': owner.last_login.isoformat() if owner.last_login else None,
                'is_active': owner.is_active,
            },
            'subscription': _subscription_dict(store),
            'config': {field: getattr(store, field) for field in STORE_EDITABLE_FIELDS},
            'channels': {
                'whatsapp': {
                    'connected': wa is not None,
                    'is_active': wa.is_active if wa else False,
                    'display_phone_number': wa.display_phone_number if wa else None,
                    'connected_at': wa.connected_at.isoformat() if wa else None,
                },
                'telegram': {
                    'connected': tg is not None,
                    'is_active': tg.is_active if tg else False,
                    'bot_username': tg.bot_username if tg else None,
                    'connected_at': tg.connected_at.isoformat() if tg else None,
                },
            },
            # Solo el provider — jamás keys/secrets por el panel.
            'payment_provider': {
                'provider': pay.provider if pay else None,
                'is_active': pay.is_active if pay else False,
            },
            'metrics': {
                'orders_by_status': orders_by_status,
                'orders_total': orders.count(),
                'orders_30d': orders.filter(created_at__gte=d30).count(),
                'gmv_total_cop': float(gmv_total),
                'gmv_30d_cop': float(gmv_30d),
                'customers_total': Customer.objects.filter(store=store).count(),
                'messages_30d': Message.objects.filter(order__store=store, timestamp__gte=d30).count(),
                'products_total': store.categories.aggregate(n=Count('products'))['n'] or 0,
                'last_activity': last_activity.isoformat() if last_activity else None,
            },
        }

    def get(self, request, store_id):
        store = get_object_or_404(
            Store.objects.select_related('owner', 'subscription__plan'), id=store_id)
        return Response(self._detail(store))

    def patch(self, request, store_id):
        store = get_object_or_404(Store, id=store_id)
        serializer = StaffStoreEditSerializer(store, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        diff = {}
        for field, new_value in serializer.validated_data.items():
            old_value = getattr(store, field)
            if old_value != new_value:
                diff[field] = {'antes': str(old_value), 'despues': str(new_value)}

        if diff:
            serializer.save()
            write_audit(request, AuditLog.Action.STORE_UPDATE, store=store, detail=diff)
            logger.info("🛠️ Staff %s editó tienda %s: %s",
                        request.user.email, store.id, list(diff.keys()))

        store.refresh_from_db()
        return Response(self._detail(store))


class StaffSubscriptionChangeView(APIView):
    """POST /api/staff/stores/<uuid>/subscription/ {plan_code, months?} — solo admin."""
    permission_classes = [IsStaffAdmin]

    def post(self, request, store_id):
        store = get_object_or_404(Store, id=store_id)
        plan_code = (request.data.get('plan_code') or '').strip().upper()
        plan = Plan.objects.filter(code=plan_code, is_active=True).first()
        if not plan:
            return Response({'error': f'Plan "{plan_code}" no existe o está inactivo.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            months = max(1, min(12, int(request.data.get('months', 1))))
        except (TypeError, ValueError):
            months = 1

        old = _subscription_dict(store)
        sub = billing.activate_plan(store, plan, months=months)
        write_audit(request, AuditLog.Action.SUBSCRIPTION_CHANGE, store=store, detail={
            'antes': {'plan': old['plan_code'], 'status': old['status']} if old else None,
            'despues': {'plan': sub.plan.code, 'status': sub.status, 'meses': months},
        })
        logger.info("💳 Staff %s activó plan %s (%s meses) para tienda %s",
                    request.user.email, plan.code, months, store.id)
        store.refresh_from_db()
        return Response({'subscription': _subscription_dict(store)})


class StaffStoreCustomersView(APIView):
    """GET /api/staff/stores/<uuid>/customers/?page= — consumidores finales de la tienda."""
    permission_classes = [IsInternalStaff]

    def get(self, request, store_id):
        store = get_object_or_404(Store, id=store_id)
        qs = Customer.objects.filter(store=store).order_by('-last_user_message_at', '-first_contact_at')

        def build(c):
            return {
                'id': str(c.id),
                'name': c.name,
                'channel_type': c.channel_type,
                'phone': c.phone or (c.channel_id if c.channel_type == Customer.ChannelType.WHATSAPP else ''),
                'total_orders': c.total_orders,
                'total_spent': float(c.total_spent),
                'first_contact_at': c.first_contact_at.isoformat(),
                'last_user_message_at': c.last_user_message_at.isoformat() if c.last_user_message_at else None,
            }

        return Response(_paginate(request, qs, build))


class StaffImpersonateView(APIView):
    """
    POST /api/staff/impersonate/ {store_id} — emite un access token JWT del
    dueño de la tienda, válido 30 minutos, SIN refresh token.

    Seguridad:
    - Solo roles admin/soporte (CanImpersonate).
    - Claims `imp=True` + `impersonator_id` → el frontend muestra el banner.
    - AuditLog obligatorio con IP.
    - No se puede impersonar a otro miembro del equipo interno.
    - Nunca se expone ni se toca la contraseña del usuario.
    """
    permission_classes = [CanImpersonate]

    def post(self, request):
        store_id = request.data.get('store_id')
        if not store_id:
            return Response({'error': 'store_id es requerido'}, status=status.HTTP_400_BAD_REQUEST)
        store = get_object_or_404(Store.objects.select_related('owner'), id=store_id)
        target = store.owner

        if staff_role(target):
            return Response(
                {'error': 'No se puede impersonar a un miembro del equipo interno.'},
                status=status.HTTP_403_FORBIDDEN)
        if not target.is_active:
            return Response({'error': 'La cuenta del usuario está inactiva.'},
                            status=status.HTTP_400_BAD_REQUEST)

        token = AccessToken.for_user(target)
        token.set_exp(lifetime=timedelta(minutes=IMPERSONATION_MINUTES))
        token['imp'] = True
        token['impersonator_id'] = request.user.id
        token['impersonator_email'] = request.user.email

        write_audit(request, AuditLog.Action.IMPERSONATE, store=store, target_user=target,
                    detail={'expira_minutos': IMPERSONATION_MINUTES})
        logger.warning("👤 IMPERSONATION: %s → %s (tienda %s) desde IP %s",
                       request.user.email, target.email, store.id,
                       request.META.get('REMOTE_ADDR'))

        return Response({
            'access': str(token),
            'expires_in': IMPERSONATION_MINUTES * 60,
            'user': {'email': target.email, 'name': target.get_full_name()},
            'store': {'id': str(store.id), 'name': store.name},
        })


class StaffAuditLogView(APIView):
    """GET /api/staff/audit/?actor=&store_id=&action=&page= — bitácora filtrable."""
    permission_classes = [IsInternalStaff]

    def get(self, request):
        qs = AuditLog.objects.select_related('actor', 'store').all()
        actor = (request.query_params.get('actor') or '').strip()
        if actor:
            qs = qs.filter(actor_email__icontains=actor)
        store_id = (request.query_params.get('store_id') or '').strip()
        if store_id:
            qs = qs.filter(store_id=store_id)
        action = (request.query_params.get('action') or '').strip()
        if action:
            qs = qs.filter(action=action)

        def build(log):
            return {
                'id': str(log.id),
                'actor_email': log.actor_email,
                'action': log.action,
                'action_display': log.get_action_display(),
                'store_id': str(log.store_id) if log.store_id else None,
                'store_name': log.store_name,
                'target_user_email': log.target_user_email,
                'ip_address': log.ip_address,
                'detail': log.detail,
                'created_at': log.created_at.isoformat(),
            }

        return Response(_paginate(request, qs, build))
