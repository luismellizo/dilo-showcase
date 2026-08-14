"""Tests del enforcement de suscripciones (orders/billing.py).

Protege el modelo de negocio: trial, ventana de 24h, corte por cuota agotada y
la garantia fail-open (un bug de billing NUNCA bloquea una venta).
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from orders import billing
from orders.models import Plan, Subscription


@pytest.mark.django_db
def test_new_store_gets_pro_trial(store):
    sub = billing.get_or_create_subscription(store)
    assert sub is not None
    assert sub.status == Subscription.Status.TRIALING
    assert sub.plan.code == "PRO"
    assert sub.trial_ends_at is not None


@pytest.mark.django_db
def test_expired_trial_falls_to_free(store):
    sub = billing.get_or_create_subscription(store)
    sub.trial_ends_at = timezone.now() - timedelta(days=1)
    sub.save()
    billing.refresh_subscription(sub)
    sub.refresh_from_db()
    assert sub.status == Subscription.Status.ACTIVE
    assert sub.plan.code == "FREE"


@pytest.mark.django_db
def test_register_conversation_counts_new_window(store, customer):
    sub = billing.get_or_create_subscription(store)
    used_before = sub.conversations_used
    assert billing.register_conversation(store, customer) is True
    sub.refresh_from_db()
    assert sub.conversations_used == used_before + 1


@pytest.mark.django_db
def test_register_conversation_within_window_is_free(store, customer):
    billing.get_or_create_subscription(store)
    # Primer mensaje abre conversacion (consume 1).
    billing.register_conversation(store, customer)
    sub = store.subscription
    sub.refresh_from_db()
    used = sub.conversations_used
    # Segundo mensaje dentro de la ventana de 24h -> NO consume.
    assert billing.register_conversation(store, customer) is True
    sub.refresh_from_db()
    assert sub.conversations_used == used


@pytest.mark.django_db
def test_quota_exhausted_blocks(store, customer):
    free = Plan.objects.get(code="FREE")
    sub = billing.get_or_create_subscription(store)
    sub.plan = free
    sub.status = Subscription.Status.ACTIVE
    sub.conversations_used = free.conversation_limit  # tope exacto
    sub.save()
    # Cliente sin ventana previa -> conversacion nueva -> debe bloquear.
    customer.last_user_message_at = None
    customer.save()
    assert billing.register_conversation(store, customer) is False


@pytest.mark.django_db
def test_billing_fail_open_when_no_plans(store, customer):
    # Sin planes sembrados, get_or_create devuelve None -> fail-open (True).
    Subscription.objects.all().delete()
    Plan.objects.all().delete()
    assert billing.register_conversation(store, customer) is True
