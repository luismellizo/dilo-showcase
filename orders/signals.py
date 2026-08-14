"""
Signals: mantener la imagen del menú digital sincronizada con la DB.

Cualquier cambio en Category/Product/ProductVariant encola la regeneración
(con debounce en tasks.queue_menu_image_regen). Solo aplica si la imagen es
GENERATED — una imagen UPLOADED por el dueño jamás se sobreescribe sola
(update_store_menu_image también lo garantiza).
"""
import logging

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import Category, Product, ProductVariant

logger = logging.getLogger(__name__)


def _store_id_for(instance):
    try:
        if isinstance(instance, Category):
            return instance.store_id
        if isinstance(instance, Product):
            return instance.category.store_id
        if isinstance(instance, ProductVariant):
            return instance.product.category.store_id
    except Exception:
        # La cascada de un borrado puede dejar FKs ya inexistentes
        return None
    return None


@receiver(post_save, sender=Category)
@receiver(post_save, sender=Product)
@receiver(post_save, sender=ProductVariant)
@receiver(post_delete, sender=Category)
@receiver(post_delete, sender=Product)
@receiver(post_delete, sender=ProductVariant)
def menu_changed(sender, instance, **kwargs):
    store_id = _store_id_for(instance)
    if not store_id:
        return
    try:
        from .tasks import queue_menu_image_regen
        queue_menu_image_regen(store_id)
    except Exception as e:
        # La regeneración del menú digital jamás rompe la operación original
        logger.warning(f"No se pudo encolar regeneración de menú digital: {e}")
