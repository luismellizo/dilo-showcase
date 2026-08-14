"""Reportes del comercio (F4) y exportación CSV (F6).

Lo que se protege aquí:
- aislamiento por dueño (una `store_id` ajena no puede leer ventas),
- el ranking de más vendidos sobrevive al borrado del producto (es la razón de
  ser del snapshot `OrderItem.product_name`, migración 0022),
- la serie diaria trae los días vacíos en 0 (si no, la gráfica miente),
- el corte de día es el de Bogotá, no UTC (la DB guarda UTC),
- el CSV sale con BOM (sin él, Excel en Windows destroza las tildes).
"""
from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from orders.models import Category, Order, OrderItem, Product

BOGOTA = ZoneInfo('America/Bogota')


def _client(user=None):
    c = APIClient()
    if user is not None:
        token = RefreshToken.for_user(user).access_token
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return c


def _sold_order(store, *, when=None, total="20000", customer_name="Ana"):
    order = Order.objects.create(
        store=store,
        customer_phone="573001112233",
        customer_name=customer_name,
        total_amount=Decimal(total),
        status=Order.Status.CONFIRMED,
    )
    if when is not None:
        # `created_at` es auto_now_add: solo se puede mover con un update.
        Order.objects.filter(id=order.id).update(created_at=when)
        order.refresh_from_db()
    return order


def _product(store, name="Hamburguesa clásica", price="15000"):
    cat = Category.objects.create(store=store, name="Comidas")
    return Product.objects.create(category=cat, name=name, price=Decimal(price))


@pytest.mark.django_db
def test_summary_requiere_auth():
    assert _client().get("/api/reports/summary/").status_code == 401


@pytest.mark.django_db
def test_summary_aisla_por_dueno(make_store):
    mia = make_store(name="Mía")
    ajena = make_store(name="Ajena")
    _sold_order(ajena, total="99000")

    resp = _client(mia.owner).get(f"/api/reports/summary/?store_id={ajena.id}")
    assert resp.status_code == 404


@pytest.mark.django_db
def test_summary_cuenta_solo_los_estados_vendidos(store):
    _sold_order(store, total="20000")
    _sold_order(store, total="30000")
    Order.objects.create(  # NEW: conversación, no venta
        store=store, customer_phone="5730002", total_amount=Decimal("50000"),
        status=Order.Status.NEW,
    )

    data = _client(store.owner).get(f"/api/reports/summary/?store_id={store.id}").json()
    assert data['sales']['orders'] == 2
    assert data['sales']['total'] == 50000.0
    assert data['sales']['avg_ticket'] == 25000.0
    assert data['funnel']['conversations'] == 3
    assert data['funnel']['confirmed'] == 2
    assert data['funnel']['abandoned'] == 1          # NEW sin items
    assert data['funnel']['conversion_rate'] == pytest.approx(66.7, abs=0.1)


@pytest.mark.django_db
def test_top_products_usa_el_snapshot(store):
    product = _product(store)
    order = _sold_order(store, total="30000")
    OrderItem.objects.create(
        order=order, product=product, product_name=product.name,
        quantity=2, unit_price=Decimal("15000"),
    )
    product.delete()   # el dueño borra el producto del menú

    data = _client(store.owner).get(f"/api/reports/summary/?store_id={store.id}").json()
    top = data['top_products']
    assert len(top) == 1
    assert top[0]['name'] == "Hamburguesa clásica"   # sobrevive al borrado
    assert top[0]['units'] == 2
    assert top[0]['revenue'] == 30000.0


@pytest.mark.django_db
def test_serie_rellena_dias_vacios(store):
    hoy = timezone.localtime(timezone.now(), BOGOTA).date()
    _sold_order(store, when=timezone.now())

    data = _client(store.owner).get(
        f"/api/reports/summary/?store_id={store.id}&days=4"
    ).json()
    series = data['sales']['series']
    assert len(series) == 4                       # sin huecos
    assert series[0]['date'] == (hoy - timedelta(days=3)).isoformat()
    assert series[-1]['date'] == hoy.isoformat()
    assert [d['total'] for d in series[:3]] == [0.0, 0.0, 0.0]
    assert series[-1]['orders'] == 1


@pytest.mark.django_db
def test_rango_respeta_zona_horaria(store):
    """Un pedido de las 00:30 UTC es del día ANTERIOR en Bogotá (UTC-5).

    Sin `tzinfo` en el truncado, este pedido se contaría un día tarde y el
    dueño vería ventas de medianoche en la fecha equivocada.
    """
    hoy_bogota = timezone.localtime(timezone.now(), BOGOTA).date()
    # 00:30 UTC de mañana = 19:30 de hoy en Bogotá.
    utc_medianoche = datetime.combine(
        hoy_bogota + timedelta(days=1), time(0, 30), tzinfo=ZoneInfo('UTC')
    )
    _sold_order(store, when=utc_medianoche, total="10000")

    data = _client(store.owner).get(
        f"/api/reports/summary/?store_id={store.id}&days=2"
    ).json()
    dia = {d['date']: d for d in data['sales']['series']}
    assert dia[hoy_bogota.isoformat()]['orders'] == 1
    assert data['by_hour'][19]['orders'] == 1     # 19:30 hora de Bogotá


@pytest.mark.django_db
def test_rango_invalido_da_400(store):
    resp = _client(store.owner).get(
        f"/api/reports/summary/?store_id={store.id}&date_from=2026-08-09&date_to=2026-08-01"
    )
    assert resp.status_code == 400


# ------------------------------ CSV (F6) ------------------------------

def _csv_text(response):
    return b''.join(response.streaming_content).decode('utf-8')


@pytest.mark.django_db
def test_csv_requiere_auth():
    assert _client().get("/api/reports/orders.csv/").status_code == 401


@pytest.mark.django_db
def test_csv_aisla_por_dueno(make_store):
    mia = make_store(name="Mía")
    ajena = make_store(name="Ajena")
    resp = _client(mia.owner).get(f"/api/reports/orders.csv/?store_id={ajena.id}")
    assert resp.status_code == 404


@pytest.mark.django_db
def test_csv_trae_bom_y_cabecera(store):
    product = _product(store)
    order = _sold_order(store, total="15000", customer_name="Ramón Muñoz")
    OrderItem.objects.create(
        order=order, product=product, product_name=product.name,
        quantity=1, unit_price=Decimal("15000"),
    )

    resp = _client(store.owner).get(f"/api/reports/orders.csv/?store_id={store.id}")
    assert resp.status_code == 200
    assert resp['Content-Disposition'].startswith('attachment; filename="pedidos-')
    text = _csv_text(resp)
    assert text.startswith('﻿')                       # BOM para Excel
    assert 'id,fecha,cliente' in text
    assert 'Ramón Muñoz' in text
    assert '1x Hamburguesa clásica' in text


@pytest.mark.django_db
def test_csv_respeta_rango_de_fechas(store):
    hoy = timezone.localtime(timezone.now(), BOGOTA).date()
    _sold_order(store, customer_name="Dentro")
    _sold_order(
        store, customer_name="Fuera",
        when=timezone.now() - timedelta(days=40),
    )

    resp = _client(store.owner).get(
        f"/api/reports/orders.csv/?store_id={store.id}"
        f"&date_from={(hoy - timedelta(days=2)).isoformat()}&date_to={hoy.isoformat()}"
    )
    text = _csv_text(resp)
    assert 'Dentro' in text
    assert 'Fuera' not in text
