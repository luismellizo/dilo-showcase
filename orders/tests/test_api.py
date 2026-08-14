"""Tests de la capa API (DRF) — auth, aislamiento por owner y permisos staff.

Usa el APIClient de DRF con JWT real de simplejwt. Cero red externa: solo DB
de test. El aislamiento por tienda es una garantia de SEGURIDAD (fuga de datos
entre comercios), por eso se testea explicito.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken


def _client(user=None):
    c = APIClient()
    if user is not None:
        token = RefreshToken.for_user(user).access_token
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return c


@pytest.mark.django_db
def test_stores_requires_auth():
    resp = _client().get("/api/stores/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_store_isolation_between_owners(make_store):
    store_a = make_store(name="Tienda A")
    store_b = make_store(name="Tienda B")

    resp = _client(store_a.owner).get("/api/stores/")
    assert resp.status_code == 200
    data = resp.json()
    rows = data["results"] if isinstance(data, dict) else data
    ids = {row["id"] for row in rows}
    assert str(store_a.id) in ids
    assert str(store_b.id) not in ids  # NO puede ver la tienda ajena


@pytest.mark.django_db
def test_billing_plans_public():
    resp = _client().get("/api/billing/plans/")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1  # planes sembrados por 0013


@pytest.mark.django_db
def test_staff_endpoint_forbidden_for_normal_user(make_user):
    resp = _client(make_user()).get("/api/staff/me/")
    assert resp.status_code == 403


# ------------- Historial de pedidos por cliente (F5 del dashboard v3) -------

def _customer_with_order(store, name="Ana"):
    from decimal import Decimal
    from orders.models import Customer, Order
    customer = Customer.objects.create(
        store=store, channel_id=f"tg-{name}", channel_type=Customer.ChannelType.TELEGRAM,
        name=name,
    )
    order = Order.objects.create(
        store=store, customer=customer, customer_phone=f"tg-{name}",
        customer_name=name, total_amount=Decimal("12000"),
        status=Order.Status.CONFIRMED,
    )
    return customer, order


@pytest.mark.django_db
def test_customer_orders_requires_auth(store):
    customer, _ = _customer_with_order(store)
    resp = _client().get(f"/api/customers/{customer.id}/orders/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_customer_orders_isolated_by_owner(make_store):
    mia = make_store(name="Mía")
    ajena = make_store(name="Ajena")
    customer, _ = _customer_with_order(ajena)

    resp = _client(mia.owner).get(f"/api/customers/{customer.id}/orders/")
    assert resp.status_code == 404  # fuga de datos entre comercios


@pytest.mark.django_db
def test_customer_orders_returns_only_its_own(store):
    customer, order = _customer_with_order(store, name="Ana")
    _other, other_order = _customer_with_order(store, name="Beto")

    resp = _client(store.owner).get(f"/api/customers/{customer.id}/orders/")
    assert resp.status_code == 200
    data = resp.json()
    rows = data["results"] if isinstance(data, dict) else data
    ids = {row["id"] for row in rows}
    assert ids == {str(order.id)}
    assert str(other_order.id) not in ids
