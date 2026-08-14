"""Toma de control humana (F1 de PLAN_DASHBOARD_V3).

El dueño puede callar al bot en UNA conversación. Lo que se protege aquí:
- pausado = el LLM no se instancia (dinero y voz duplicada en el chat),
- la pausa vence sola (una pausa olvidada = cliente abandonado en silencio),
- el endpoint aísla por dueño (fuga de datos entre comercios),
- escribir a mano pausa solo (si no, el bot responde encima del humano).

Cero red externa: el engine, el envío y el WebSocket van mockeados.
"""
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from orders.models import Message, Order


def _client(user=None):
    c = APIClient()
    if user is not None:
        token = RefreshToken.for_user(user).access_token
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return c


@pytest.fixture
def order(db, store, customer):
    return Order.objects.create(
        store=store,
        customer=customer,
        customer_phone="tg-123",
        customer_name="Cliente Test",
        source=Order.Source.TELEGRAM,
    )


def _incoming(order, content="hola"):
    """Simula el mensaje USER que el webhook ya guardó antes de encolar."""
    return Message.objects.create(
        order=order, sender='USER', content=content, platform=order.source,
    )


@pytest.mark.django_db
def test_bot_pausado_no_llama_al_llm(order):
    order.bot_paused = True
    order.bot_paused_at = timezone.now()
    order.save()
    _incoming(order)

    from orders import tasks

    with patch.object(tasks, 'WhatsAppBotEngine') as engine, \
            patch.object(tasks.notify_dashboard, 'delay') as notify:
        result = tasks._process_message_locked(str(order.id), "hola")

    engine.assert_not_called()
    notify.assert_called_once()
    assert result['status'] == 'skipped_bot_paused'


@pytest.mark.django_db
def test_pausa_vencida_reanuda_sola(order, settings):
    settings.BOT_PAUSE_MINUTES = 60
    order.bot_paused = True
    order.bot_paused_at = timezone.now() - timedelta(minutes=61)
    order.save()
    _incoming(order)

    from orders import tasks

    with patch.object(tasks, 'WhatsAppBotEngine') as engine, \
            patch.object(tasks, 'resolve_store_token', return_value='tok'), \
            patch.object(tasks.send_telegram_message_task, 'delay'), \
            patch.object(tasks.notify_dashboard, 'delay'):
        engine.return_value.process.return_value = "respuesta del bot"
        tasks._process_message_locked(str(order.id), "hola")

    engine.assert_called_once()
    order.refresh_from_db()
    assert order.bot_paused is False
    assert order.bot_paused_at is None


@pytest.mark.django_db
def test_toggle_bot_requiere_auth(order):
    resp = _client().post(f"/api/orders/{order.id}/toggle_bot/", {"paused": True}, format='json')
    assert resp.status_code == 401


@pytest.mark.django_db
def test_toggle_bot_aisla_por_dueno(order, make_user):
    intruso = make_user()
    resp = _client(intruso).post(
        f"/api/orders/{order.id}/toggle_bot/", {"paused": True}, format='json',
    )
    assert resp.status_code == 404
    order.refresh_from_db()
    assert order.bot_paused is False


@pytest.mark.django_db
def test_toggle_bot_pausa_y_reanuda(order):
    client = _client(order.store.owner)

    with patch('orders.views.notify_dashboard'):
        resp = client.post(
            f"/api/orders/{order.id}/toggle_bot/", {"paused": True}, format='json',
        )
    assert resp.status_code == 200
    assert resp.json()['bot_paused'] is True
    order.refresh_from_db()
    assert order.bot_paused is True and order.bot_paused_at is not None

    with patch('orders.views.notify_dashboard'):
        resp = client.post(
            f"/api/orders/{order.id}/toggle_bot/", {"paused": False}, format='json',
        )
    assert resp.json()['bot_paused'] is False
    order.refresh_from_db()
    assert order.bot_paused is False and order.bot_paused_at is None


@pytest.mark.django_db
def test_send_message_pausa_el_bot(order):
    with patch('orders.views.resolve_store_token', create=True), \
            patch('orders.views.send_telegram_message_task') as tg:
        tg.delay.return_value = None
        resp = _client(order.store.owner).post(
            f"/api/orders/{order.id}/send_message/", {"content": "yo respondo"},
            format='json',
        )

    assert resp.status_code == 200
    order.refresh_from_db()
    assert order.bot_paused is True
    assert order.bot_paused_at is not None


@pytest.mark.django_db
def test_bot_paused_es_read_only_en_patch(order):
    resp = _client(order.store.owner).patch(
        f"/api/orders/{order.id}/", {"bot_paused": True}, format='json',
    )
    assert resp.status_code == 200
    order.refresh_from_db()
    assert order.bot_paused is False  # solo la acción toggle_bot lo cambia
