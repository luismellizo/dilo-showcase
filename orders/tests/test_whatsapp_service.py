"""Tests del cliente de la Graph API de Meta (sin red).

Se cubre el manejo de errores real: el codigo viejo trataba `error.code == 100`
como "numero ya registrado" (100 es *Invalid parameter*), asi que se tragaba
fallos reales y devolvia exito. Eso dejaba comercios "conectados" pero
incapaces de enviar un solo mensaje.
"""
from unittest.mock import MagicMock, patch

import pytest
import requests

from orders.services import whatsapp_service as svc


def _response(payload, status_code=200):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = payload
    return resp


# ------------------------------------------------------------ manejo de error

def test_raise_for_meta_error_raises_with_code():
    resp = _response({'error': {'message': 'Boom', 'code': 190, 'error_subcode': 460}}, 400)
    with pytest.raises(svc.MetaAPIError) as exc:
        svc._raise_for_meta_error(resp)
    assert exc.value.code == 190
    assert exc.value.subcode == 460
    assert 'Boom' in str(exc.value)


def test_raise_for_meta_error_passes_through_ok():
    assert svc._raise_for_meta_error(_response({'data': [1]})) == {'data': [1]}


def test_raise_for_meta_error_handles_non_json():
    resp = MagicMock()
    resp.status_code = 502
    resp.json.side_effect = ValueError
    with pytest.raises(svc.MetaAPIError):
        svc._raise_for_meta_error(resp)


# ------------------------------------------------------------------ webhooks

def test_subscribe_app_to_waba_posts_to_correct_path():
    with patch.object(svc.requests, 'post', return_value=_response({'success': True})) as post:
        assert svc.subscribe_app_to_waba('WABA1', 'TOKEN') is True
    url = post.call_args[0][0]
    assert url.endswith('/WABA1/subscribed_apps')
    assert post.call_args[1]['headers']['Authorization'] == 'Bearer TOKEN'


def test_subscribe_app_raises_on_meta_error():
    error = _response({'error': {'message': 'no permission', 'code': 200}}, 403)
    with patch.object(svc.requests, 'post', return_value=error):
        with pytest.raises(svc.MetaAPIError):
            svc.subscribe_app_to_waba('WABA1', 'TOKEN')


def test_unsubscribe_never_raises():
    """Desconectar un comercio no puede quedar bloqueado porque Meta falle."""
    with patch.object(svc.requests, 'delete', side_effect=requests.RequestException):
        assert svc.unsubscribe_app_from_waba('WABA1', 'TOKEN') is False


# ------------------------------------------------------------------ registro

def test_generate_registration_pin_is_six_digits_and_varies():
    pins = {svc.generate_registration_pin() for _ in range(50)}
    assert all(len(p) == 6 and p.isdigit() for p in pins)
    # Un PIN fijo compartido entre clientes seria una llave maestra.
    assert len(pins) > 1


def test_register_phone_number_success():
    with patch.object(svc.requests, 'post', return_value=_response({'success': True})):
        result = svc.register_phone_number('PN1', 'TOKEN', '123456')
    assert result['ok'] is True
    assert result['already_registered'] is False


def test_register_phone_number_detects_already_registered():
    """Se confirma con platform_type, no adivinando por el codigo de error."""
    error = _response({'error': {'message': 'PIN mismatch', 'code': 133005}}, 400)
    details = _response({'id': 'PN1', 'platform_type': 'CLOUD_API'})
    with patch.object(svc.requests, 'post', return_value=error), \
         patch.object(svc.requests, 'get', return_value=details):
        result = svc.register_phone_number('PN1', 'TOKEN', '123456')
    assert result['ok'] is True
    assert result['already_registered'] is True


def test_register_phone_number_reports_pin_needed():
    error = _response({'error': {'message': 'PIN mismatch', 'code': 133005}}, 400)
    details = _response({'id': 'PN1', 'platform_type': 'NOT_APPLICABLE'})
    with patch.object(svc.requests, 'post', return_value=error), \
         patch.object(svc.requests, 'get', return_value=details):
        result = svc.register_phone_number('PN1', 'TOKEN', '123456')
    assert result['ok'] is False
    assert result['needs_pin'] is True


def test_register_phone_number_does_not_swallow_code_100():
    """El bug historico: code 100 (Invalid parameter) se daba por exitoso."""
    error = _response({'error': {'message': 'Invalid parameter', 'code': 100}}, 400)
    details = _response({'id': 'PN1', 'platform_type': 'NOT_APPLICABLE'})
    with patch.object(svc.requests, 'post', return_value=error), \
         patch.object(svc.requests, 'get', return_value=details):
        result = svc.register_phone_number('PN1', 'TOKEN', '123456')
    assert result['ok'] is False
    assert result['needs_pin'] is False


# ------------------------------------------------------- resolucion de activos

def test_resolve_assets_requires_waba_id():
    with pytest.raises(ValueError):
        svc.resolve_onboarding_assets('TOKEN', waba_id='')


def test_resolve_assets_uses_session_logging_ids():
    """Con phone_number_id del session logging NO se listan los numeros."""
    details = _response({'id': 'PN1', 'display_phone_number': '+57 300',
                         'verified_name': 'Burgas', 'platform_type': 'CLOUD_API'})
    with patch.object(svc.requests, 'get', return_value=details) as get:
        assets = svc.resolve_onboarding_assets('TOKEN', 'WABA1', 'PN1')
    assert assets['waba_id'] == 'WABA1'
    assert assets['phone_number_id'] == 'PN1'
    assert get.call_args[0][0].endswith('/PN1')


def test_resolve_assets_falls_back_to_first_number():
    listing = _response({'data': [{'id': 'PN9', 'display_phone_number': '+57 301',
                                   'verified_name': 'X'}]})
    with patch.object(svc.requests, 'get', return_value=listing):
        assets = svc.resolve_onboarding_assets('TOKEN', 'WABA1')
    assert assets['phone_number_id'] == 'PN9'


def test_resolve_assets_errors_when_waba_has_no_numbers():
    with patch.object(svc.requests, 'get', return_value=_response({'data': []})):
        with pytest.raises(ValueError):
            svc.resolve_onboarding_assets('TOKEN', 'WABA1')


# -------------------------------------------------------------- graph version

def test_graph_version_is_supported():
    """v18.0 (sep-2023) quedo fuera del ciclo de soporte de Meta."""
    major = int(svc.META_GRAPH_API_VERSION.lstrip('v').split('.')[0])
    assert major >= 22, f"Graph API {svc.META_GRAPH_API_VERSION} esta obsoleta"


# ------------------------------------------------------ resolucion del emisor

@pytest.mark.django_db
def test_resolve_store_sender_uses_store_credentials(store):
    from orders.models import WhatsAppCredentials
    WhatsAppCredentials.objects.create(
        store=store, waba_id='W', phone_number_id='PN1',
        display_phone_number='+57 300', encrypted_token=svc.encrypt_token('TOK'),
    )
    store.refresh_from_db()
    assert svc.resolve_store_sender(store) == ('PN1', 'TOK')


@pytest.mark.django_db
def test_resolve_store_sender_never_falls_back_when_disconnected(store, settings):
    """Responder desde el número global sería suplantar a otro negocio."""
    from orders.models import WhatsAppCredentials
    settings.WHATSAPP_PHONE_NUMBER_ID = 'GLOBAL_PN'
    settings.WHATSAPP_API_TOKEN = 'GLOBAL_TOKEN'
    WhatsAppCredentials.objects.create(
        store=store, waba_id='W', phone_number_id='PN1',
        display_phone_number='+57 300', encrypted_token='', is_active=False,
    )
    store.refresh_from_db()
    assert svc.resolve_store_sender(store) == (None, None)


@pytest.mark.django_db
def test_resolve_store_sender_global_fallback_without_credentials(store, settings):
    """Instalación de una sola tienda: sin fila de credenciales sí hay fallback."""
    settings.WHATSAPP_PHONE_NUMBER_ID = 'GLOBAL_PN'
    settings.WHATSAPP_API_TOKEN = 'GLOBAL_TOKEN'
    assert svc.resolve_store_sender(store) == ('GLOBAL_PN', 'GLOBAL_TOKEN')


# ----------------------------------------------------------------- plantillas

def test_create_message_template_payload():
    with patch.object(svc.requests, 'post', return_value=_response({'id': '1'})) as post:
        svc.create_message_template('WABA1', 'TOKEN', 'recompra', 'MARKETING', 'es',
                                    [{'type': 'BODY', 'text': 'Hola'}])
    assert post.call_args[0][0].endswith('/WABA1/message_templates')
    assert post.call_args[1]['json']['category'] == 'MARKETING'


def test_send_template_message_shape():
    resp = _response({'messages': [{'id': 'wamid.1'}]})
    resp.raise_for_status = MagicMock()
    with patch.object(svc.requests, 'post', return_value=resp) as post:
        svc.send_template_message('PN1', 'TOKEN', '573001112233', 'recompra', 'es')
    payload = post.call_args[1]['json']
    assert payload['type'] == 'template'
    assert payload['template']['name'] == 'recompra'
    assert payload['template']['language'] == {'code': 'es'}
