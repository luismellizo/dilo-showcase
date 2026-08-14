"""Reportes del comercio: ventas, más vendidos, embudo y exportación CSV.

Por qué existe: el plan PRO se vende con "Analytics avanzado" y no había nada.
Los datos ya estaban en la DB sin usar — en particular `OrderItem.product_name`
(snapshot, migración 0022), que hace que el ranking de más vendidos sobreviva
al borrado del producto.

Dos reglas que se rompen solas si nadie las vigila:

1. **Zona horaria.** `USE_TZ=True` guarda en UTC pero el dueño vive en Bogotá.
   Agrupar por día sin `tzinfo` corre las ventas 5 horas: un pedido de las 7 pm
   aparecería al día siguiente. Todo el truncado usa `BOGOTA`.
2. **Un solo criterio de "vendido".** `SOLD_STATUSES` es el mismo de
   `frontend/src/StatsCards.js`. Si el reporte y las tarjetas del panel dan
   números distintos, el dueño deja de confiar en los dos.
"""
import csv
import logging
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db.models import Count, F, Sum
from django.db.models.functions import TruncDate
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Order, OrderItem, Store

logger = logging.getLogger(__name__)

# Mismo criterio que StatsCards.js — si divergen, los números del panel y los
# del reporte dejan de cuadrar y ninguno vuelve a ser creíble.
SOLD_STATUSES = ['CONFIRMED', 'COMPLETED', 'DELIVERED']

BOGOTA = ZoneInfo('America/Bogota')

MAX_RANGE_DAYS = 366


class ReportRangeError(Exception):
    """Parámetros de rango inválidos (se traducen a 400)."""


def _parse_range(request):
    """Devuelve (desde_aware, hasta_aware, date_from, date_to) en hora de Bogotá.

    `date_from`/`date_to` mandan sobre `days` si vienen ambos. El rango es
    inclusivo en los dos extremos (el dueño que pide "del 1 al 31" espera el 31).
    """
    raw_from = request.query_params.get('date_from')
    raw_to = request.query_params.get('date_to')

    if raw_from and raw_to:
        try:
            d_from = date.fromisoformat(raw_from)
            d_to = date.fromisoformat(raw_to)
        except ValueError:
            raise ReportRangeError("Fechas inválidas: usa el formato YYYY-MM-DD.")
        if d_to < d_from:
            raise ReportRangeError("date_to no puede ser anterior a date_from.")
    else:
        try:
            days = int(request.query_params.get('days', 30))
        except (TypeError, ValueError):
            raise ReportRangeError("El parámetro days debe ser un número.")
        days = max(1, min(days, MAX_RANGE_DAYS))
        d_to = timezone.localtime(timezone.now(), BOGOTA).date()
        d_from = d_to - timedelta(days=days - 1)

    if (d_to - d_from).days + 1 > MAX_RANGE_DAYS:
        raise ReportRangeError(f"El rango máximo es de {MAX_RANGE_DAYS} días.")

    start = datetime.combine(d_from, time.min, tzinfo=BOGOTA)
    # `time.max` en vez de sumar un día: evita solapar el primer instante del
    # día siguiente si dos rangos consecutivos se piden por separado.
    end = datetime.combine(d_to, time.max, tzinfo=BOGOTA)
    return start, end, d_from, d_to


def _resolve_store(request):
    """La tienda del usuario. Una `store_id` ajena es 404, nunca 403.

    404 y no 403 a propósito: un 403 confirmaría que ese UUID existe.
    """
    stores = Store.objects.filter(owner=request.user)
    store_id = request.query_params.get('store_id')
    if store_id:
        return stores.filter(id=store_id).first()
    return stores.first()


def _orders_in_range(store, start, end):
    return Order.objects.filter(store=store, created_at__gte=start, created_at__lte=end)


class ReportSummaryView(APIView):
    """GET /api/reports/summary/?store_id=&days=30 (o date_from/date_to)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        store = _resolve_store(request)
        if not store:
            return Response({'error': 'Tienda no encontrada'}, status=status.HTTP_404_NOT_FOUND)
        try:
            start, end, d_from, d_to = _parse_range(request)
        except ReportRangeError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        orders = _orders_in_range(store, start, end)
        sold = orders.filter(status__in=SOLD_STATUSES)

        totals = sold.aggregate(total=Sum('total_amount'), count=Count('id'))
        total = float(totals['total'] or 0)
        count = totals['count'] or 0

        # --- Serie diaria ---------------------------------------------------
        # `tzinfo=BOGOTA` es lo que evita que una venta de las 7 pm caiga en el
        # día siguiente (la DB guarda UTC).
        rows = (
            sold.annotate(day=TruncDate('created_at', tzinfo=BOGOTA))
            .values('day')
            .annotate(total=Sum('total_amount'), orders=Count('id'))
        )
        by_day = {r['day']: r for r in rows}
        series = []
        cursor = d_from
        while cursor <= d_to:
            row = by_day.get(cursor)
            # Los días vacíos van explícitos en 0: si se omiten, la gráfica
            # comprime los huecos y miente sobre el ritmo de ventas.
            series.append({
                'date': cursor.isoformat(),
                'total': float(row['total']) if row else 0.0,
                'orders': row['orders'] if row else 0,
            })
            cursor += timedelta(days=1)

        # --- Más vendidos ---------------------------------------------------
        # Se agrupa por el SNAPSHOT del nombre, no por la FK: así el ranking
        # sobrevive al borrado del producto (migración 0022).
        top_rows = (
            OrderItem.objects.filter(order__in=sold)
            .values('product_name')
            .annotate(units=Sum('quantity'), revenue=Sum(F('quantity') * F('unit_price')))
            .order_by('-units')[:10]
        )
        top_products = [
            {
                'name': r['product_name'] or 'Producto eliminado',
                'units': r['units'] or 0,
                'revenue': float(r['revenue'] or 0),
            }
            for r in top_rows
        ]

        # --- Embudo ---------------------------------------------------------
        conversations = orders.count()
        with_items = orders.annotate(n=Count('items')).filter(n__gt=0).count()
        abandoned = orders.annotate(n=Count('items')).filter(n=0, status=Order.Status.NEW).count()

        return Response({
            'range': {
                'from': d_from.isoformat(),
                'to': d_to.isoformat(),
                'days': (d_to - d_from).days + 1,
            },
            'sales': {
                'total': total,
                'orders': count,
                'avg_ticket': round(total / count, 2) if count else 0,
                'series': series,
            },
            'top_products': top_products,
            'funnel': {
                'conversations': conversations,
                'with_items': with_items,
                'confirmed': count,
                'abandoned': abandoned,
                'conversion_rate': round((count / conversations) * 100, 1) if conversations else 0.0,
            },
            'by_channel': {
                r['source']: r['n']
                for r in sold.values('source').annotate(n=Count('id'))
            },
            'by_hour': _orders_by_hour(sold),
        })


def _orders_by_hour(qs):
    """Pedidos por hora del día en horario de Bogotá.

    Se calcula en Python sobre las fechas ya traídas: `ExtractHour` con tzinfo
    depende del soporte de zonas del motor (sqlite en test no lo tiene sin la
    tabla de zonas cargada) y aquí el volumen es de un rango acotado.
    """
    buckets = {h: 0 for h in range(24)}
    for created in qs.values_list('created_at', flat=True):
        buckets[timezone.localtime(created, BOGOTA).hour] += 1
    return [{'hour': h, 'orders': n} for h, n in buckets.items()]


class _Echo:
    """Fichero falso: `csv.writer` escribe en él y devolvemos cada línea.

    Es lo que permite hacer streaming sin construir el CSV completo en memoria:
    un comercio con un año de pedidos tumbaría el contenedor.
    """
    def write(self, value):
        return value


class ReportOrdersCSVView(APIView):
    """GET /api/reports/orders.csv/?store_id=&date_from=&date_to="""
    permission_classes = [IsAuthenticated]

    HEADER = [
        'id', 'fecha', 'cliente', 'telefono', 'canal', 'estado', 'productos',
        'subtotal', 'domicilio', 'total', 'metodo_pago', 'direccion', 'notas',
    ]

    def get(self, request):
        store = _resolve_store(request)
        if not store:
            return Response({'error': 'Tienda no encontrada'}, status=status.HTTP_404_NOT_FOUND)
        try:
            start, end, d_from, d_to = _parse_range(request)
        except ReportRangeError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        qs = (
            _orders_in_range(store, start, end)
            .prefetch_related('items')
            .order_by('created_at')
        )
        writer = csv.writer(_Echo())

        def rows():
            # BOM: sin él, Excel en Windows lee el CSV como latin-1 y muestra
            # "Hamburguesa clÃ¡sica". El dueño reporta un bug que no es nuestro.
            yield '﻿'
            yield writer.writerow(self.HEADER)
            # `chunk_size` es obligatorio con prefetch_related y además es lo
            # que mantiene el consumo de memoria acotado en un año de pedidos.
            for order in qs.iterator(chunk_size=500):
                items = '; '.join(
                    f"{i.quantity}x {i.display_name}" for i in order.items.all()
                )
                total = float(order.total_amount or 0)
                fee = float(order.delivery_fee or 0)
                yield writer.writerow([
                    str(order.id),
                    timezone.localtime(order.created_at, BOGOTA).strftime('%Y-%m-%d %H:%M'),
                    order.customer_name or '',
                    order.customer_phone or '',
                    order.get_source_display(),
                    order.get_status_display(),
                    items,
                    f"{total - fee:.2f}",
                    f"{fee:.2f}",
                    f"{total:.2f}",
                    order.payment_method or '',
                    (order.delivery_address or '').replace('\n', ' '),
                    (order.notes or '').replace('\n', ' '),
                ])

        slug = ''.join(c if c.isalnum() else '-' for c in (store.name or 'tienda')).strip('-').lower()
        filename = f"pedidos-{slug or 'tienda'}-{d_from.isoformat()}_{d_to.isoformat()}.csv"
        response = StreamingHttpResponse(rows(), content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response
