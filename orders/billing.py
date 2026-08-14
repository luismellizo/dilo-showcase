"""
Lógica de negocio de suscripciones y cuotas de DILO.

Conceptos:
- Conversación facturable: ventana de 24h por cliente (estilo Meta). Un mensaje
  fuera de la ventana abre conversación nueva y consume cuota; los mensajes
  dentro de la ventana son libres (un pedido en curso nunca se corta a mitad).
- Enforcement: los webhooks (WhatsApp/Telegram) llaman `register_conversation()`
  ANTES de encolar el bot. Si devuelve False, el bot no responde y se envía un
  aviso de cortesía (throttled por Redis, 1/día por cliente).
- Fail-open: cualquier error de billing PERMITE el mensaje. Nunca se pierde una
  venta por un bug de facturación.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.db.models import F
from django.utils import timezone

from .models import Plan, Subscription

logger = logging.getLogger(__name__)

FREE_PLAN_CODE = 'FREE'
TRIAL_PLAN_CODE = 'PRO'
PERIOD_DAYS = 30

QUOTA_NOTICE_TEXT = (
    "🙏 ¡Gracias por escribirnos! En este momento no podemos tomar tu pedido "
    "por este medio. Inténtalo de nuevo más tarde."
)


def _get_plan(code):
    return Plan.objects.filter(code=code, is_active=True).first()


def get_or_create_subscription(store):
    """
    Garantiza que la tienda tenga suscripción. Tiendas nuevas (y existentes sin
    suscripción) arrancan con trial del plan Pro por `settings.TRIAL_DAYS` días.

    Devuelve None si los planes no están sembrados (migración 0013) — en ese
    caso el enforcement queda desactivado (fail-open).
    """
    sub = getattr(store, 'subscription', None)
    if sub:
        return sub

    plan = _get_plan(TRIAL_PLAN_CODE) or _get_plan(FREE_PLAN_CODE)
    if not plan:
        logger.warning("Planes no sembrados; tienda %s sin suscripción (fail-open)", store.id)
        return None

    now = timezone.now()
    trial_days = getattr(settings, 'TRIAL_DAYS', 14)
    sub = Subscription.objects.create(
        store=store,
        plan=plan,
        status=Subscription.Status.TRIALING,
        trial_ends_at=now + timedelta(days=trial_days),
        current_period_start=now,
        current_period_end=now + timedelta(days=PERIOD_DAYS),
    )
    logger.info("🎁 Trial de %s días creado para tienda %s (plan %s)", trial_days, store.id, plan.code)
    return sub


def refresh_subscription(sub):
    """
    Rollover de estado/período. Llamar antes de cualquier chequeo de cuota.

    - Trial vencido → cae al plan Gratis, status ACTIVE, usage en cero.
    - Período vencido en plan pago → PAST_DUE (opera con límite Gratis).
    - Período vencido en plan gratis → solo reinicia usage y período.
    """
    now = timezone.now()

    if sub.status == Subscription.Status.TRIALING and sub.trial_ends_at and now >= sub.trial_ends_at:
        free = _get_plan(FREE_PLAN_CODE)
        if free:
            sub.plan = free
        sub.status = Subscription.Status.ACTIVE
        sub.conversations_used = 0
        sub.current_period_start = now
        sub.current_period_end = now + timedelta(days=PERIOD_DAYS)
        sub.save()
        logger.info("⏳ Trial vencido para tienda %s → plan %s", sub.store_id, sub.plan.code)
        return sub

    if now >= sub.current_period_end:
        if sub.plan.price_cop > 0 and sub.status == Subscription.Status.ACTIVE:
            # Plan pago sin renovación registrada (la renovación automática
            # llegará con Wompi recurrente; hoy se reactiva con activate_plan).
            sub.status = Subscription.Status.PAST_DUE
            logger.warning("💸 Suscripción PAST_DUE para tienda %s", sub.store_id)
        sub.conversations_used = 0
        sub.current_period_start = now
        sub.current_period_end = now + timedelta(days=PERIOD_DAYS)
        sub.save()

    return sub


def effective_conversation_limit(sub):
    """Límite vigente. None = ilimitado. PAST_DUE/CANCELED operan como Gratis."""
    if sub.status in (Subscription.Status.TRIALING, Subscription.Status.ACTIVE):
        return sub.plan.conversation_limit
    free = _get_plan(FREE_PLAN_CODE)
    return free.conversation_limit if free else 0


def register_conversation(store, customer):
    """
    Punto de enforcement de los webhooks. Devuelve True si el mensaje puede
    procesarse (y registra el consumo), False si la cuota está agotada.
    """
    try:
        sub = get_or_create_subscription(store)
        if sub is None:
            return True  # planes no sembrados → fail-open
        refresh_subscription(sub)

        now = timezone.now()
        window = timedelta(hours=getattr(settings, 'CONVERSATION_WINDOW_HOURS', 24))
        is_new_conversation = (
            customer.last_user_message_at is None
            or (now - customer.last_user_message_at) > window
        )

        if not is_new_conversation:
            customer.last_user_message_at = now
            customer.save(update_fields=['last_user_message_at'])
            return True

        limit = effective_conversation_limit(sub)
        if limit is not None and sub.conversations_used >= limit:
            # NO se actualiza last_user_message_at: mientras esté sobre el
            # límite, cada mensaje sigue bloqueado (el aviso va throttled).
            return False

        Subscription.objects.filter(pk=sub.pk).update(
            conversations_used=F('conversations_used') + 1
        )
        customer.last_user_message_at = now
        customer.save(update_fields=['last_user_message_at'])
        return True

    except Exception as e:
        logger.error("Error en billing (fail-open): %s", e, exc_info=True)
        return True


def should_send_quota_notice(customer):
    """
    Throttle del aviso de cortesía: máximo 1 por cliente por día (Redis SET NX).
    Sin Redis (dev) se envía siempre.
    """
    try:
        import redis
        client = redis.Redis.from_url(settings.CELERY_BROKER_URL, socket_connect_timeout=2)
        return bool(client.set(f"quota_notice:{customer.id}", '1', nx=True, ex=86400))
    except Exception:
        return True


def activate_plan(store, plan, months=1):
    """
    Activa/renueva un plan pago tras confirmar el cobro (webhook Wompi futuro,
    o manual desde admin mientras el cobro recurrente no existe).
    """
    sub = get_or_create_subscription(store)
    if sub is None:
        raise ValueError("Planes no sembrados: corre las migraciones")
    now = timezone.now()
    sub.plan = plan
    sub.status = Subscription.Status.ACTIVE
    sub.trial_ends_at = None
    sub.conversations_used = 0
    sub.current_period_start = now
    sub.current_period_end = now + timedelta(days=PERIOD_DAYS * months)
    sub.save()
    logger.info("✅ Plan %s activado para tienda %s (%s meses)", plan.code, store.id, months)
    return sub


def subscription_summary(store):
    """Resumen para el dashboard/paywall (usado por /api/auth/me/ y /api/billing/)."""
    try:
        sub = get_or_create_subscription(store)
    except Exception:
        sub = None
    if sub is None:
        return None
    refresh_subscription(sub)
    now = timezone.now()
    limit = effective_conversation_limit(sub)
    trial_days_left = None
    if sub.status == Subscription.Status.TRIALING and sub.trial_ends_at:
        trial_days_left = max(0, (sub.trial_ends_at - now).days)
    return {
        'plan': {
            'code': sub.plan.code,
            'name': sub.plan.name,
            'price_cop': float(sub.plan.price_cop),
        },
        'status': sub.status,
        'trial_days_left': trial_days_left,
        'conversations_used': sub.conversations_used,
        'conversation_limit': limit,
        'current_period_end': sub.current_period_end.isoformat(),
    }
