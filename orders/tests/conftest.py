"""Fixtures compartidas de la suite. Todo mockeado: cero llamadas a LLM/WhatsApp/
Telegram/Redis reales. La DB es la de test de pytest-django (sqlite en local/CI).

Los planes (FREE/PRO/PREMIUM) los siembra la migracion 0013_seed_plans, que
pytest-django aplica al crear la DB de test — no hay que crearlos a mano.
"""
import uuid

import pytest
from django.contrib.auth.models import User

from orders.models import Customer, Store


@pytest.fixture
def make_user(db):
    def _make(email=None):
        email = email or f"owner-{uuid.uuid4().hex[:8]}@test.dilo"
        return User.objects.create_user(username=email, email=email, password="x")
    return _make


@pytest.fixture
def make_store(db, make_user):
    def _make(owner=None, **kwargs):
        owner = owner or make_user()
        defaults = dict(name="Tienda Test", owner=owner)
        defaults.update(kwargs)
        return Store.objects.create(**defaults)
    return _make


@pytest.fixture
def store(make_store):
    return make_store(payment_instructions="Nequi al 3001112233 a nombre de Test")


@pytest.fixture
def customer(db, store):
    return Customer.objects.create(
        store=store,
        channel_id="tg-123",
        channel_type=Customer.ChannelType.TELEGRAM,
        name="Cliente Test",
    )
