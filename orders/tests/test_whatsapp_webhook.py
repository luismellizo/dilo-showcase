"""Tests del webhook de WhatsApp: ruteo por `field`, estados y account_update.

Antes el webhook solo miraba `messages` y descartaba en silencio los `statuses`
(mensajes que NO llegaron al cliente) y los `account_update` (cuenta del
comercio inhabilitada por Meta). Ambos son fallos que el comercio nunca veia.
"""
import hashlib
import hmac
import json
from unittest.mock import patch

import pytest
from django.test import Client

from orders.models import WhatsAppCredentials
from orders.services.whatsapp_service import encrypt_token

APP_SECRET = 'test-app-secret'


def _post(payload, secret=APP_SECRET):
    body = json.dumps(payload)
    signature = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return Client(SERVER_NAME='localhost').post(
        '/api/webhook/whatsapp/',
        data=body,
        content_type='application/json',
        HTTP_X_HUB_SIGNATURE_256=f'sha256={signature}',
    )


def _creds(store, waba_id='WABA1', phone_number_id='PN1'):
    return WhatsAppCredentials.objects.create(
        store=store, waba_id=waba_id, phone_number_id=phone_number_id,
        display_phone_number='+57 300 1112233',
        encrypted_token=encrypt_token('T'), is_subscribed=True,
    )


# ------------------------------------------------------------------- firma

@pytest.mark.django_db
def test_webhook_rejects_bad_signature(settings):
    settings.META_APP_SECRET = APP_SECRET
    settings.DEBUG = False
    resp = _post({'entry': []}, secret='otro-secret')
    assert resp.status_code == 403


# ------------------------------------------------------------------ statuses

@pytest.mark.django_db
def test_failed_status_is_logged(settings, store, caplog):
    settings.META_APP_SECRET = APP_SECRET
    _creds(store)

    payload = {'entry': [{'id': 'WABA1', 'changes': [{
        'field': 'messages',
        'value': {
            'metadata': {'phone_number_id': 'PN1'},
            'statuses': [{
                'status': 'failed', 'recipient_id': '573001112233',
                'errors': [{'code': 131047, 'title': 'Re-engagement message'}],
            }],
        },
    }]}]}

    with caplog.at_level('ERROR'):
        resp = _post(payload)

    assert resp.status_code == 200
    assert any('NO entregado' in r.message or 'NO entregado' in r.getMessage()
               for r in caplog.records)


@pytest.mark.django_db
def test_delivered_status_is_ignored(settings, store):
    """Solo los `failed` importan: los demas no deben generar trabajo."""
    settings.META_APP_SECRET = APP_SECRET
    _creds(store)

    payload = {'entry': [{'id': 'WABA1', 'changes': [{
        'field': 'messages',
        'value': {'metadata': {'phone_number_id': 'PN1'},
                  'statuses': [{'status': 'delivered', 'recipient_id': '57300'}]},
    }]}]}

    resp = _post(payload)
    assert resp.status_code == 200


@pytest.mark.django_db
def test_messages_still_queue(settings, store):
    settings.META_APP_SECRET = APP_SECRET
    _creds(store)

    payload = {'entry': [{'id': 'WABA1', 'changes': [{
        'field': 'messages',
        'value': {
            'metadata': {'phone_number_id': 'PN1'},
            'messages': [{'id': 'wamid.1', 'from': '573001112233',
                          'text': {'body': 'hola'}}],
        },
    }]}]}

    with patch('orders.tasks.process_whatsapp_message_task.apply_async') as task:
        resp = _post(payload)

    assert resp.status_code == 200
    assert task.called


# -------------------------------------------------------------- account_update

@pytest.mark.django_db
@pytest.mark.parametrize('event', [
    'ACCOUNT_DELETED', 'ACCOUNT_RESTRICTION', 'ACCOUNT_VIOLATION',
    'PARTNER_APP_UNINSTALLED', 'PARTNER_REMOVED',
])
def test_account_update_disables_credentials(settings, store, event):
    """Una WABA inoperante no puede seguir marcada como activa."""
    settings.META_APP_SECRET = APP_SECRET
    creds = _creds(store)

    payload = {'entry': [{'id': 'WABA1', 'changes': [{
        'field': 'account_update', 'value': {'event': event},
    }]}]}

    assert _post(payload).status_code == 200

    creds.refresh_from_db()
    assert creds.is_active is False
    assert creds.is_subscribed is False


@pytest.mark.django_db
def test_disabled_update_ban_disables(settings, store):
    settings.META_APP_SECRET = APP_SECRET
    creds = _creds(store)

    payload = {'entry': [{'id': 'WABA1', 'changes': [{
        'field': 'account_update',
        'value': {'event': 'DISABLED_UPDATE',
                  'ban_info': {'waba_ban_state': 'DISABLE'}},
    }]}]}

    assert _post(payload).status_code == 200
    creds.refresh_from_db()
    assert creds.is_active is False


@pytest.mark.django_db
def test_disabled_update_reinstate_does_not_disable(settings, store):
    """DISABLED_UPDATE tambien llega al REACTIVAR: apagar aqui mataria una
    cuenta sana. El estado real esta en ban_info, no en el nombre del evento."""
    settings.META_APP_SECRET = APP_SECRET
    creds = _creds(store)
    creds.is_active = False
    creds.save()

    payload = {'entry': [{'id': 'WABA1', 'changes': [{
        'field': 'account_update',
        'value': {'event': 'DISABLED_UPDATE',
                  'ban_info': {'waba_ban_state': 'REINSTATE'}},
    }]}]}

    assert _post(payload).status_code == 200
    creds.refresh_from_db()
    assert creds.is_active is True


@pytest.mark.django_db
def test_account_update_uses_waba_info_id(settings, store):
    """En los eventos PARTNER_* el id del cliente viaja en waba_info."""
    settings.META_APP_SECRET = APP_SECRET
    creds = _creds(store, waba_id='WABA_CLIENTE')

    payload = {'entry': [{'id': 'WABA_NUESTRA', 'changes': [{
        'field': 'account_update',
        'value': {'event': 'PARTNER_APP_UNINSTALLED',
                  'waba_info': {'waba_id': 'WABA_CLIENTE'}},
    }]}]}

    assert _post(payload).status_code == 200
    creds.refresh_from_db()
    assert creds.is_active is False


@pytest.mark.django_db
def test_account_reconnected_reactivates(settings, store):
    settings.META_APP_SECRET = APP_SECRET
    creds = _creds(store)
    creds.is_active = False
    creds.save()

    payload = {'entry': [{'id': 'WABA1', 'changes': [{
        'field': 'account_update', 'value': {'event': 'ACCOUNT_RECONNECTED'},
    }]}]}

    assert _post(payload).status_code == 200
    creds.refresh_from_db()
    assert creds.is_active is True


@pytest.mark.django_db
def test_account_update_for_unknown_waba_is_harmless(settings, store):
    """Llega antes de guardar credenciales durante el onboarding: no debe romper."""
    settings.META_APP_SECRET = APP_SECRET
    payload = {'entry': [{'id': 'DESCONOCIDA', 'changes': [{
        'field': 'account_update', 'value': {'event': 'PARTNER_ADDED'},
    }]}]}
    assert _post(payload).status_code == 200


@pytest.mark.django_db
def test_webhook_is_not_rate_limited(settings, store):
    """Meta manda los webhooks de TODOS los comercios desde pocas IPs.

    Con el throttle `anon` por defecto (60/min) una ráfaga real devolvería 429
    y Meta reintentaría: mensajes perdidos o duplicados.
    """
    settings.META_APP_SECRET = APP_SECRET
    _creds(store)
    payload = {'entry': [{'id': 'WABA1', 'changes': [{
        'field': 'messages', 'value': {'metadata': {'phone_number_id': 'PN1'}},
    }]}]}

    for _ in range(70):
        assert _post(payload).status_code == 200


@pytest.mark.django_db
def test_unknown_field_does_not_break(settings, store):
    settings.META_APP_SECRET = APP_SECRET
    payload = {'entry': [{'id': 'WABA1', 'changes': [{
        'field': 'message_template_status_update',
        'value': {'event': 'APPROVED', 'message_template_name': 'recompra'},
    }]}]}
    assert _post(payload).status_code == 200
