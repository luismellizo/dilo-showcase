"""
Siembra los planes comerciales.

Unidad de cobro: `conversation_limit` = conversaciones (ventana de 24h por
cliente, igual que la facturación de Meta) por mes. Se cobra por conversación
y no por mensaje ni por pedido, porque la conversación es también la unidad de
costo del LLM: así el precio del plan queda anclado al gasto que genera.

Idempotente: usa `update_or_create`, se puede re-ejecutar sin duplicar.

⚠️  PRECIOS Y CUPOS REALES OMITIDOS — información comercial.
    Los valores de abajo son placeholders redondos, elegidos solo para que la
    suite de tests tenga cupos coherentes con los que verificar el enforcement.
    La estructura de planes, el modelo de cobro y la lógica de enforcement
    (ver `orders/billing.py`) sí son los reales.
"""
from django.db import migrations

PLANS = [
    {
        'code': 'FREE',
        'name': 'Gratis',
        'price_cop': 0,             # placeholder
        'conversation_limit': 100,  # placeholder
        'display_order': 0,
        'features': [
            'Bot de ventas con IA (WhatsApp y Telegram)',
            'Dashboard de pedidos en tiempo real',
            'Menú desde foto con IA',
        ],
    },
    {
        'code': 'PRO',
        'name': 'Pro',
        'price_cop': 0,               # placeholder
        'conversation_limit': 1000,   # placeholder
        'display_order': 1,
        'features': [
            'Todo lo del plan Gratis',
            'Recompra automática (win-back)',
            'Pantalla de cocina (KDS)',
            'Soporte prioritario',
        ],
    },
    {
        'code': 'PREMIUM',
        'name': 'Premium',
        'price_cop': 0,                # placeholder
        'conversation_limit': 10000,   # placeholder
        'display_order': 2,
        'features': [
            'Todo lo del plan Pro',
            'Links de pago automáticos (Wompi)',
            'Reportes avanzados de ventas',
        ],
    },
]


def seed_plans(apps, schema_editor):
    Plan = apps.get_model('orders', 'Plan')
    for data in PLANS:
        Plan.objects.update_or_create(code=data['code'], defaults=data)


def unseed_plans(apps, schema_editor):
    Plan = apps.get_model('orders', 'Plan')
    Plan.objects.filter(code__in=[p['code'] for p in PLANS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0012_plan_customer_last_user_message_at_subscription'),
    ]

    operations = [
        migrations.RunPython(seed_plans, unseed_plans),
    ]
