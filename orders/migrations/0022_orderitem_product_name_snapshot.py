# Snapshot del nombre del producto en OrderItem + FK a SET_NULL.
# Antes: on_delete=PROTECT → borrar una categoría (cascade a productos) con
# historial de pedidos lanzaba ProtectedError (500 en el dashboard).
# Ahora el historial sobrevive con el snapshot y el producto se puede borrar.
import django.db.models.deletion
from django.db import migrations, models


def backfill_product_name(apps, schema_editor):
    OrderItem = apps.get_model('orders', 'OrderItem')
    for item in OrderItem.objects.select_related('product').filter(product_name=''):
        if item.product_id:
            item.product_name = item.product.name
            item.save(update_fields=['product_name'])


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0021_auditlog'),
    ]

    operations = [
        migrations.AddField(
            model_name='orderitem',
            name='product_name',
            field=models.CharField(blank=True, default='', max_length=200, verbose_name='Nombre del producto'),
        ),
        migrations.AlterField(
            model_name='orderitem',
            name='product',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='orders.product'),
        ),
        migrations.RunPython(backfill_product_name, migrations.RunPython.noop),
    ]
