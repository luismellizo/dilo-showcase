"""Tests de eliminacion de datos (requisito de Meta).

Lo critico aqui es la firma: si el `signed_request` no se valida, cualquiera
podria pedir el borrado de los datos de otro usuario. Y el borrado propio debe
ser real — no un "marcado como eliminado" que deje los datos vivos.
"""
import base64
import hashlib
import hmac
import json

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from orders.data_deletion_views import parse_signed_request
from orders.models import Category, Customer, DataDeletionRequest, Order, Product, Store

APP_SECRET = 'test-app-secret'


def _client(user=None):
    c = APIClient()
    if user is not None:
        token = RefreshToken.for_user(user).access_token
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return c


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip('=')


def _make_signed_request(payload: dict, secret: str = APP_SECRET) -> str:
    encoded = _b64(json.dumps(payload).encode())
    sig = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).digest()
    return f"{_b64(sig)}.{encoded}"


# ------------------------------------------------------------ signed_request

def test_parse_signed_request_valid():
    payload = {'algorithm': 'HMAC-SHA256', 'user_id': '12345'}
    assert parse_signed_request(_make_signed_request(payload), APP_SECRET)['user_id'] == '12345'


def test_parse_signed_request_rejects_wrong_signature():
    payload = {'algorithm': 'HMAC-SHA256', 'user_id': '12345'}
    forged = _make_signed_request(payload, secret='otro-secret')
    with pytest.raises(ValueError, match='Firma'):
        parse_signed_request(forged, APP_SECRET)


def test_parse_signed_request_rejects_tampered_payload():
    """Cambiar el user_id sin re-firmar debe fallar."""
    good = _make_signed_request({'algorithm': 'HMAC-SHA256', 'user_id': '1'})
    sig, _ = good.split('.', 1)
    tampered = _b64(json.dumps({'algorithm': 'HMAC-SHA256', 'user_id': '999'}).encode())
    with pytest.raises(ValueError):
        parse_signed_request(f"{sig}.{tampered}", APP_SECRET)


def test_parse_signed_request_rejects_bad_algorithm():
    payload = {'algorithm': 'NONE', 'user_id': '1'}
    with pytest.raises(ValueError, match='Algoritmo'):
        parse_signed_request(_make_signed_request(payload), APP_SECRET)


@pytest.mark.parametrize('value', ['', 'sinpunto', None])
def test_parse_signed_request_rejects_malformed(value):
    with pytest.raises(ValueError):
        parse_signed_request(value, APP_SECRET)


def test_parse_signed_request_requires_app_secret():
    payload = {'algorithm': 'HMAC-SHA256', 'user_id': '1'}
    with pytest.raises(ValueError, match='META_APP_SECRET'):
        parse_signed_request(_make_signed_request(payload), '')


# --------------------------------------------------------------- callback API

@pytest.mark.django_db
def test_meta_callback_returns_url_and_code(settings):
    settings.META_APP_SECRET = APP_SECRET
    settings.FRONTEND_URL = 'https://dilo.example.com'
    signed = _make_signed_request({'algorithm': 'HMAC-SHA256', 'user_id': 'fb-1'})

    resp = APIClient().post('/api/meta/data-deletion/', {'signed_request': signed})

    assert resp.status_code == 200
    assert 'confirmation_code' in resp.data
    assert resp.data['url'].startswith('https://dilo.example.com/data-deletion?code=')
    assert DataDeletionRequest.objects.filter(
        confirmation_code=resp.data['confirmation_code'], facebook_user_id='fb-1'
    ).exists()


@pytest.mark.django_db
def test_meta_callback_rejects_forged_request(settings):
    settings.META_APP_SECRET = APP_SECRET
    forged = _make_signed_request({'algorithm': 'HMAC-SHA256', 'user_id': 'fb-1'},
                                  secret='otro')
    resp = APIClient().post('/api/meta/data-deletion/', {'signed_request': forged})
    assert resp.status_code == 400
    assert DataDeletionRequest.objects.count() == 0


@pytest.mark.django_db
def test_deletion_status_lookup(settings):
    deletion = DataDeletionRequest.objects.create(confirmation_code='abc123')
    resp = APIClient().get('/api/meta/data-deletion/status/?code=abc123')
    assert resp.status_code == 200
    assert resp.data['status'] == 'RECEIVED'

    deletion.mark_completed()
    resp = APIClient().get('/api/meta/data-deletion/status/?code=abc123')
    assert resp.data['status'] == 'COMPLETED'
    assert resp.data['completed_at'] is not None


@pytest.mark.django_db
def test_deletion_status_unknown_code():
    resp = APIClient().get('/api/meta/data-deletion/status/?code=nope')
    assert resp.status_code == 404


# ------------------------------------------------------------ borrado propio

@pytest.mark.django_db
def test_delete_account_requires_auth():
    resp = APIClient().post('/api/auth/delete-account/', {'confirm': 'ELIMINAR'},
                            format='json')
    assert resp.status_code == 401


@pytest.mark.django_db
def test_delete_account_requires_confirmation(store):
    resp = _client(store.owner).post('/api/auth/delete-account/', {'confirm': 'si'},
                                     format='json')
    assert resp.status_code == 400
    assert Store.objects.filter(id=store.id).exists()


@pytest.mark.django_db
def test_delete_account_purges_everything(store):
    """El borrado es real: tienda, menu, clientes y pedidos desaparecen."""
    owner_id = store.owner_id
    category = Category.objects.create(store=store, name='Burgers')
    Product.objects.create(category=category, name='Clasica', price=20000)
    customer = Customer.objects.create(
        store=store, channel_id='tg-9', channel_type=Customer.ChannelType.TELEGRAM
    )
    Order.objects.create(store=store, customer_phone='tg-9')

    resp = _client(store.owner).post('/api/auth/delete-account/',
                                     {'confirm': 'ELIMINAR'}, format='json')

    assert resp.status_code == 200
    assert resp.data['success'] is True
    assert not Store.objects.filter(id=store.id).exists()
    assert not User.objects.filter(id=owner_id).exists()
    assert not Category.objects.filter(id=category.id).exists()
    assert not Customer.objects.filter(id=customer.id).exists()
    assert Order.objects.filter(store_id=store.id).count() == 0

    # Queda el rastro de la solicitud (sin datos personales del negocio).
    deletion = DataDeletionRequest.objects.get(
        confirmation_code=resp.data['confirmation_code']
    )
    assert deletion.status == DataDeletionRequest.Status.COMPLETED
