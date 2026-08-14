"""Tests del onboarding de WhatsApp (Embedded Signup v4) y sus endpoints.

Todo lo de Meta esta mockeado: la suite JAMAS llama a graph.facebook.com.
Lo que se protege aqui es el dinero y la operacion:

- Sin `subscribed_apps` el comercio NO recibe mensajes. Es el fallo mas caro
  del onboarding y por eso se testea que la conexion se aborte si falla.
- El PIN de dos pasos jamas puede ser un valor fijo compartido entre clientes.
- Un numero ya conectado a otra tienda no puede robarse.
"""
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from orders.models import WhatsAppCredentials
from orders.services import whatsapp_service


def _client(user=None):
    c = APIClient()
    if user is not None:
        token = RefreshToken.for_user(user).access_token
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return c


ASSETS = {
    'waba_id': '111222333',
    'phone_number_id': '444555666',
    'display_phone_number': '+57 300 1112233',
    'verified_name': 'Burgas',
    'platform_type': 'CLOUD_API',
    'code_verification_status': 'VERIFIED',
}

REGISTERED_OK = {'ok': True, 'already_registered': False, 'needs_pin': False,
                 'code': None, 'message': 'Número registrado'}


def _patch_meta(subscribe=True, registration=None):
    """Mockea el trio de llamadas a Meta del onboarding."""
    registration = registration or REGISTERED_OK
    return (
        patch('orders.whatsapp_views.exchange_code_for_token',
              return_value={'access_token': 'BUSINESS_TOKEN'}),
        patch('orders.whatsapp_views.resolve_onboarding_assets', return_value=ASSETS),
        patch('orders.whatsapp_views.subscribe_app_to_waba', return_value=subscribe),
        patch('orders.whatsapp_views.register_phone_number', return_value=registration),
    )


# ---------------------------------------------------------------- onboarding

@pytest.mark.django_db
def test_token_exchange_requires_auth(store):
    resp = _client().post('/api/whatsapp/token-exchange/',
                          {'code': 'x', 'store_id': str(store.id)}, format='json')
    assert resp.status_code == 401


@pytest.mark.django_db
def test_token_exchange_rejects_foreign_store(store, make_user):
    """Un usuario no puede conectar WhatsApp a la tienda de otro comercio."""
    intruder = make_user()
    resp = _client(intruder).post(
        '/api/whatsapp/token-exchange/',
        {'code': 'x', 'store_id': str(store.id), 'waba_id': '1'},
        format='json',
    )
    assert resp.status_code == 404
    assert not WhatsAppCredentials.objects.filter(store=store).exists()


@pytest.mark.django_db
def test_onboarding_happy_path_subscribes_and_saves(store):
    p1, p2, p3, p4 = _patch_meta()
    with p1, p2, p3 as sub, p4 as reg:
        resp = _client(store.owner).post(
            '/api/whatsapp/token-exchange/',
            {'code': 'CODE', 'store_id': str(store.id),
             'waba_id': ASSETS['waba_id'],
             'phone_number_id': ASSETS['phone_number_id']},
            format='json',
        )

    assert resp.status_code == 200, resp.data
    assert resp.data['success'] is True
    assert resp.data['subscribed'] is True

    # La suscripcion a los webhooks es obligatoria y se hace con la WABA correcta.
    sub.assert_called_once()
    assert sub.call_args[0][0] == ASSETS['waba_id']

    creds = WhatsAppCredentials.objects.get(store=store)
    assert creds.waba_id == ASSETS['waba_id']
    assert creds.phone_number_id == ASSETS['phone_number_id']
    assert creds.verified_name == 'Burgas'
    assert creds.is_subscribed is True
    assert creds.is_active is True
    # El token nunca se guarda en claro.
    assert creds.encrypted_token != 'BUSINESS_TOKEN'
    assert whatsapp_service.decrypt_token(creds.encrypted_token) == 'BUSINESS_TOKEN'

    # El PIN se genero, se guardo encriptado y tiene 6 digitos.
    pin = whatsapp_service.decrypt_token(creds.encrypted_pin)
    assert len(pin) == 6 and pin.isdigit()
    assert reg.call_args[0][2] == pin


@pytest.mark.django_db
def test_onboarding_aborts_if_subscription_fails(store):
    """Sin webhooks el comercio queda mudo: NO se guardan credenciales."""
    p1, p2, p3, p4 = _patch_meta(subscribe=False)
    with p1, p2, p3, p4:
        resp = _client(store.owner).post(
            '/api/whatsapp/token-exchange/',
            {'code': 'CODE', 'store_id': str(store.id),
             'waba_id': ASSETS['waba_id']},
            format='json',
        )

    assert resp.status_code == 502
    assert not WhatsAppCredentials.objects.filter(store=store).exists()


@pytest.mark.django_db
def test_onboarding_aborts_if_registration_fails(store):
    """Un numero sin registrar no puede enviar mensajes: no se guarda a medias."""
    failure = {'ok': False, 'already_registered': False, 'needs_pin': True,
               'code': 133005, 'message': 'Escribe el PIN'}
    p1, p2, p3, p4 = _patch_meta(registration=failure)
    with p1, p2, p3, p4:
        resp = _client(store.owner).post(
            '/api/whatsapp/token-exchange/',
            {'code': 'CODE', 'store_id': str(store.id),
             'waba_id': ASSETS['waba_id']},
            format='json',
        )

    assert resp.status_code == 400
    assert resp.data['needs_pin'] is True
    assert not WhatsAppCredentials.objects.filter(store=store).exists()


@pytest.mark.django_db
def test_onboarding_uses_supplied_pin(store):
    p1, p2, p3, p4 = _patch_meta()
    with p1, p2, p3, p4 as reg:
        resp = _client(store.owner).post(
            '/api/whatsapp/token-exchange/',
            {'code': 'CODE', 'store_id': str(store.id),
             'waba_id': ASSETS['waba_id'], 'pin': '987654'},
            format='json',
        )
    assert resp.status_code == 200
    assert reg.call_args[0][2] == '987654'


@pytest.mark.django_db
def test_onboarding_rejects_malformed_pin(store):
    resp = _client(store.owner).post(
        '/api/whatsapp/token-exchange/',
        {'code': 'CODE', 'store_id': str(store.id),
         'waba_id': ASSETS['waba_id'], 'pin': '12ab'},
        format='json',
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_onboarding_rejects_number_taken_by_another_store(store, make_store):
    """phone_number_id es unique: no se le puede robar el numero a otra tienda."""
    other = make_store()
    WhatsAppCredentials.objects.create(
        store=other, waba_id='999', phone_number_id=ASSETS['phone_number_id'],
        display_phone_number='+57 300 0000000',
        encrypted_token=whatsapp_service.encrypt_token('OTRO'),
    )

    p1, p2, p3, p4 = _patch_meta()
    with p1, p2, p3, p4:
        resp = _client(store.owner).post(
            '/api/whatsapp/token-exchange/',
            {'code': 'CODE', 'store_id': str(store.id),
             'waba_id': ASSETS['waba_id'],
             'phone_number_id': ASSETS['phone_number_id']},
            format='json',
        )

    assert resp.status_code == 409
    assert not WhatsAppCredentials.objects.filter(store=store).exists()


# ------------------------------------------------------------------- status

@pytest.mark.django_db
def test_status_reports_disconnected(store):
    resp = _client(store.owner).get(f'/api/whatsapp/status/?store_id={store.id}')
    assert resp.status_code == 200
    assert resp.data['connected'] is False


@pytest.mark.django_db
def test_status_verify_detects_lost_subscription(store):
    """Si Meta ya no lista la app suscrita, el estado local se corrige."""
    creds = WhatsAppCredentials.objects.create(
        store=store, waba_id='111', phone_number_id='222',
        display_phone_number='+57 300 1112233',
        encrypted_token=whatsapp_service.encrypt_token('T'),
        is_subscribed=True,
    )

    with patch('orders.whatsapp_views.list_waba_subscriptions', return_value=[]):
        resp = _client(store.owner).get(
            f'/api/whatsapp/status/?store_id={store.id}&verify=1'
        )

    assert resp.status_code == 200
    assert resp.data['webhook_verified'] is False
    creds.refresh_from_db()
    assert creds.is_subscribed is False


# --------------------------------------------------------------- disconnect

@pytest.mark.django_db
def test_disconnect_unsubscribes_and_clears_token(store):
    WhatsAppCredentials.objects.create(
        store=store, waba_id='111', phone_number_id='222',
        display_phone_number='+57 300 1112233',
        encrypted_token=whatsapp_service.encrypt_token('T'),
        is_subscribed=True,
    )

    with patch('orders.whatsapp_views.unsubscribe_app_from_waba',
               return_value=True) as unsub:
        resp = _client(store.owner).post(
            '/api/whatsapp/disconnect/', {'store_id': str(store.id)}, format='json'
        )

    assert resp.status_code == 200
    unsub.assert_called_once()
    creds = WhatsAppCredentials.objects.get(store=store)
    assert creds.is_active is False
    assert creds.is_subscribed is False
    assert creds.encrypted_token == ''


# ---------------------------------------------------------------- plantillas

@pytest.mark.django_db
def test_templates_requires_connected_whatsapp(store):
    resp = _client(store.owner).get(f'/api/whatsapp/templates/?store_id={store.id}')
    assert resp.status_code == 400


@pytest.mark.django_db
def test_templates_list(store):
    WhatsAppCredentials.objects.create(
        store=store, waba_id='111', phone_number_id='222',
        display_phone_number='+57 300 1112233',
        encrypted_token=whatsapp_service.encrypt_token('T'),
    )
    fake = [{'name': 'recompra', 'status': 'APPROVED', 'language': 'es',
             'category': 'MARKETING', 'components': [{'type': 'BODY', 'text': 'Hola'}]}]

    with patch('orders.whatsapp_views.list_message_templates', return_value=fake):
        resp = _client(store.owner).get(
            f'/api/whatsapp/templates/?store_id={store.id}'
        )

    assert resp.status_code == 200
    assert resp.data['count'] == 1
    assert resp.data['templates'][0]['name'] == 'recompra'


@pytest.mark.django_db
@pytest.mark.parametrize('name', ['Recompra Clientes', '1recompra', 're-compra'])
def test_templates_reject_invalid_names(store, name):
    """Meta solo acepta minusculas, numeros y guiones bajos."""
    WhatsAppCredentials.objects.create(
        store=store, waba_id='111', phone_number_id='222',
        display_phone_number='+57 300 1112233',
        encrypted_token=whatsapp_service.encrypt_token('T'),
    )
    resp = _client(store.owner).post(
        '/api/whatsapp/templates/',
        {'store_id': str(store.id), 'name': name, 'body': 'Hola'},
        format='json',
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_templates_create_builds_components(store):
    WhatsAppCredentials.objects.create(
        store=store, waba_id='111', phone_number_id='222',
        display_phone_number='+57 300 1112233',
        encrypted_token=whatsapp_service.encrypt_token('T'),
    )

    with patch('orders.whatsapp_views.create_message_template',
               return_value={'id': '1', 'status': 'PENDING'}) as create:
        resp = _client(store.owner).post(
            '/api/whatsapp/templates/',
            {'store_id': str(store.id), 'name': 'recompra_clientes',
             'category': 'MARKETING', 'language': 'es',
             'body': 'Hola {{1}}', 'footer': 'Responde STOP'},
            format='json',
        )

    assert resp.status_code == 201
    components = create.call_args[0][5]
    assert components[0] == {'type': 'BODY', 'text': 'Hola {{1}}'}
    assert components[1] == {'type': 'FOOTER', 'text': 'Responde STOP'}


@pytest.mark.django_db
def test_templates_isolated_by_owner(store, make_user):
    intruder = make_user()
    resp = _client(intruder).get(f'/api/whatsapp/templates/?store_id={store.id}')
    assert resp.status_code == 400
