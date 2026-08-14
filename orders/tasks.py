"""
Tareas asíncronas de Celery para procesamiento de mensajes de WhatsApp.

Este módulo contiene todas las tareas que se ejecutan en background
para evitar bloquear el webhook de WhatsApp.
"""

import json
import logging
import uuid
import requests
from contextlib import contextmanager
from io import BytesIO
from django.core.files.base import ContentFile
from celery import shared_task
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

from .models import Order, Message
from .bot_engine import WhatsAppBotEngine
from .serializers import OrderSerializer
from .services.telegram_service import send_telegram_message, get_telegram_file_url, resolve_store_token
from django.conf import settings

logger = logging.getLogger(__name__)


# ============================================================
# LOCK DISTRIBUIDO POR ORDEN (#6 — evita carrera entre workers)
# ============================================================

def _get_lock_redis():
    """Cliente Redis para locks. None si Redis no está disponible (degradación)."""
    try:
        import redis
        return redis.Redis.from_url(settings.CELERY_BROKER_URL, socket_connect_timeout=2)
    except Exception as e:
        logger.warning(f"Redis no disponible para locks: {e}")
        return None


@contextmanager
def order_lock(order_id, timeout=60):
    """
    Lock por orden para serializar el procesamiento de mensajes concurrentes
    del mismo cliente. Si no se obtiene el lock, lanza LockBusy para reintentar.
    Si Redis no está disponible, NO bloquea (degradación controlada en dev).
    """
    client = _get_lock_redis()
    key = f"order_lock:{order_id}"
    token = str(uuid.uuid4())
    acquired = False
    if client is not None:
        try:
            acquired = client.set(key, token, nx=True, ex=timeout)
        except Exception as e:
            logger.warning(f"Fallo adquiriendo lock {key}: {e}")
            client = None  # degradar a sin-lock
    if client is not None and not acquired:
        raise LockBusy(order_id)
    try:
        yield
    finally:
        if client is not None and acquired:
            try:
                # Liberar solo si el token sigue siendo nuestro.
                if client.get(key) == token.encode():
                    client.delete(key)
            except Exception:
                pass


class LockBusy(Exception):
    """La orden está siendo procesada por otro worker."""
    pass


@shared_task(bind=True, max_retries=3)
def process_whatsapp_message_task(self, order_id, text, media_url=None):
    """
    Procesa mensaje de WhatsApp de forma asíncrona.
    
    Esta tarea se ejecuta en background, permitiendo que el webhook
    responda inmediatamente a WhatsApp (evitando timeouts).
    
    Args:
        self: Contexto de la tarea (bind=True)
        order_id: ID de la orden (UUID string)
        text: Texto del mensaje del cliente
        media_url: URL de archivo adjunto (imagen, documento, etc.)
        
    Returns:
        dict: Status y detalles del procesamiento
        
    Raises:
        Retry: Si hay un error temporal (se reintenta automáticamente)
    """
    try:
        with order_lock(order_id):
            return _process_message_locked(order_id, text, media_url)

    except LockBusy:
        # Otro worker procesa esta orden: reintentar pronto para serializar.
        logger.info(f"⏳ Orden {order_id} ocupada por otro worker, reintentando...")
        raise self.retry(countdown=2, max_retries=10)

    except Order.DoesNotExist:
        logger.error(f"❌ Orden {order_id} no existe")
        raise

    except Exception as e:
        logger.error(f"❌ Error procesando mensaje: {e}", exc_info=True)
        countdown = 2 ** self.request.retries  # 1s, 2s, 4s
        raise self.retry(exc=e, countdown=countdown)


def _process_message_locked(order_id, text, media_url=None):
    """Cuerpo de procesamiento de mensaje, ya con el lock de orden adquirido."""
    if True:
        # 1. Obtener orden
        order = Order.objects.get(id=order_id)
        logger.info(f"📱 Procesando mensaje para orden {order_id}")

        # El mensaje entrante (USER) ya se guarda en la capa de webhook
        # (WhatsAppWebhookView / TelegramWebhookView) con su external_id,
        # tanto para idempotencia como para la memoria del bot.

        # TOMA DE CONTROL HUMANA: si el dueño está atendiendo este chat, el bot
        # no habla. El mensaje del cliente ya quedó guardado por el webhook y ya
        # consumió cuota de billing, así que aquí solo se salta el LLM y se
        # refresca el panel para que el dueño vea el mensaje entrar.
        if order.bot_paused:
            if order.bot_is_muted():
                logger.info(f"🤐 Orden {order_id}: bot en pausa, no responde")
                notify_dashboard.delay(order_id)
                return {'status': 'skipped_bot_paused', 'order_id': str(order_id)}
            # Pausa vencida → el bot vuelve solo.
            order.bot_paused = False
            order.bot_paused_at = None
            order.save(update_fields=['bot_paused', 'bot_paused_at'])
            logger.info(f"🔔 Orden {order_id}: pausa vencida, el bot retoma")

        # ANTI-RÁFAGA: si el cliente mandó varios mensajes seguidos, la primera
        # task en tomar el lock los responde TODOS en una sola pasada del LLM;
        # las tasks de los mensajes ya cubiertos no encuentran nada pendiente y
        # se descartan sin responder (antes: 4 mensajes → 4 respuestas casi
        # idénticas que espantaban al cliente). Solo aplica a texto — los
        # mensajes con media (comprobantes) se procesan individualmente.
        if not media_url:
            last_reply = order.messages.exclude(sender='USER').order_by('-timestamp').first()
            pending_qs = order.messages.filter(sender='USER')
            if last_reply:
                pending_qs = pending_qs.filter(timestamp__gt=last_reply.timestamp)
            pending = [
                c for c in pending_qs.order_by('timestamp').values_list('content', flat=True)
                if c and c != '[Archivo adjunto]'
            ]
            if not pending:
                logger.info(f"♻️ Orden {order_id}: mensaje ya respondido en batch previo, task descartada")
                return {'status': 'skipped_batched', 'order_id': str(order_id)}
            text = "\n".join(pending)

        # Token de Telegram de ESTA tienda (multi-tienda). None si no aplica.
        tg_token = resolve_store_token(order.store) if order.source == Order.Source.TELEGRAM else None

        # 2. Si hay media (comprobante de pago), descargar primero
        local_media_path = None
        if media_url:
            logger.info(f"📸 Detectado archivo adjunto, descargando...")

            # Manejo específico para Telegram (resolver URL con el token de la tienda)
            if order.source == Order.Source.TELEGRAM and media_url.startswith('telegram_file_id:'):
                file_id = media_url.split(':', 1)[1]
                media_url = get_telegram_file_url(file_id, token=tg_token)
                if not media_url:
                    logger.error("❌ No se pudo resolver URL de archivo Telegram")

            # Ejecutar descarga de forma síncrona para tener la imagen antes de procesarla
            # Pasamos is_whatsapp=True solo si es WhatsApp para usar headers
            is_whatsapp = (order.source == Order.Source.WHATSAPP)
            local_media_path = download_whatsapp_media(order_id, media_url, is_whatsapp)

        # 3. Procesar con bot engine (IA)
        logger.info(f"🤖 Enviando mensaje al bot de IA...")
        bot = WhatsAppBotEngine(order, text, local_media_path or media_url)
        response = bot.process()
        logger.info(f"✅ Bot generó respuesta: {response[:100]}...")
        
        # Guardar respuesta del bot
        Message.objects.create(
            order=order,
            sender='BOT',
            content=response,
            platform=order.source
        )
        
        # Recargar order para obtener cambios del bot
        order.refresh_from_db()
        
        # 4. Enviar respuesta según la fuente
        if order.source == Order.Source.TELEGRAM:
            from .services.telegram_service import get_confirm_order_buttons
            
            # Detectar si debemos mostrar botones de confirmación
            # Condición: hay items en el pedido Y el estado es conversación de ventas
            has_items = order.items.exists()
            is_sales_state = order.bot_state == 'SALES_CONVERSATION'
            should_show_buttons = has_items and is_sales_state
            
            if should_show_buttons:
                buttons = get_confirm_order_buttons()
                logger.info(f"🔘 Enviando respuesta CON botones de confirmación")
            else:
                buttons = None
            
            send_telegram_message_task.delay(order.customer_phone, response, buttons, token=tg_token)
        else:
            send_whatsapp_message.delay(order.customer_phone, response, order_id=str(order_id))

        # 5. Notificar dashboard via WebSocket (asíncrono)
        notify_dashboard.delay(order_id)

        return {
            'status': 'success',
            'order_id': str(order_id),
            'response_preview': response[:100]
        }


@shared_task
def download_whatsapp_media(order_id, media_url, is_whatsapp=True):
    """
    Descarga imagen/documento y la guarda en el modelo Order.
    """
    try:
        order = Order.objects.get(id=order_id)
        if not media_url:
            return None
            
        logger.info(f"⬇️ Descargando media desde: {media_url[:50]}...")
        
        # Headers solo para WhatsApp — usar el token de ESTA tienda.
        headers = {}
        if is_whatsapp:
            from .services.whatsapp_service import resolve_store_sender
            _, wa_token = resolve_store_sender(order.store)
            headers = {'Authorization': f'Bearer {wa_token}'}

        response = requests.get(media_url, headers=headers, timeout=15)
        response.raise_for_status()
        
        # Determinar extensión del archivo
        content_type = response.headers.get('Content-Type', '')
        ext_map = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'application/pdf': 'pdf'
        }
        ext = ext_map.get(content_type, 'jpg')
        
        # Nombre de archivo único
        filename = f'payment_proof_{order.id}.{ext}'
        
        # Guardar en el campo ImageField del modelo Order
        image_content = ContentFile(response.content)
        order.payment_proof_image.save(filename, image_content, save=True)
        
        # También guardar URL original (para referencia)
        order.payment_proof_url = media_url
        order.save()
        
        logger.info(f"✅ Media descargada y guardada: {order.payment_proof_image.name}")
        
        # Retornar path local para uso inmediato
        return order.payment_proof_image.path if order.payment_proof_image else None
        
    except Exception as e:
        logger.error(f"❌ Error descargando media: {e}", exc_info=True)
        # No lanzar excepción para no bloquear el procesamiento del mensaje
        return None


@shared_task(bind=True, max_retries=3)
def send_whatsapp_message(self, to, text, order_id=None, store_id=None):
    """
    Envía mensaje de texto a WhatsApp usando las credenciales de la TIENDA.

    Resuelve el phone_number_id y token desde la orden o la tienda
    (multi-tienda). Sin order_id/store_id, o sin credenciales propias,
    cae al token global.

    Args:
        to: Número de teléfono destino (formato: 573001234567)
        text: Texto del mensaje a enviar
        order_id: ID de la orden para resolver la tienda emisora
        store_id: ID de la tienda emisora (cuando no hay orden, ej. aviso de cuota)

    Raises:
        Retry: Si hay un error temporal
    """
    from .services.whatsapp_service import resolve_store_sender, send_text_message
    try:
        # Resolver credenciales de la tienda dueña de la orden.
        phone_number_id = settings.WHATSAPP_PHONE_NUMBER_ID
        token = settings.WHATSAPP_API_TOKEN
        if order_id:
            order = Order.objects.select_related('store').filter(id=order_id).first()
            if order:
                phone_number_id, token = resolve_store_sender(order.store)
        elif store_id:
            from .models import Store
            store = Store.objects.filter(id=store_id).first()
            if store:
                phone_number_id, token = resolve_store_sender(store)

        # Tienda sin WhatsApp conectado: reintentar no arregla nada y enviar
        # desde el número global suplantaría a otro negocio. Se descarta.
        if not phone_number_id or not token:
            logger.error(
                f"🚫 Sin credenciales de WhatsApp para enviar a {to} "
                f"(order_id={order_id}, store_id={store_id}) — mensaje descartado"
            )
            return None

        result = send_text_message(phone_number_id, token, to, text)
        logger.info(f"📤 Mensaje enviado a {to}: {text[:50]}...")
        return result

    except requests.exceptions.RequestException as e:
        logger.error(f"❌ Error enviando mensaje WhatsApp: {e}", exc_info=True)
        # Reintentar con delay exponencial
        countdown = 2 ** self.request.retries
        raise self.retry(exc=e, countdown=countdown)


@shared_task(bind=True, max_retries=2)
def generate_menu_image_task(self, store_id, force=False):
    """Regenera la imagen del menú digital de la tienda (render desde DB)."""
    from .models import Store
    from .services.menu_image import update_store_menu_image
    store = Store.objects.filter(id=store_id).first()
    if not store:
        return
    try:
        updated = update_store_menu_image(store, force=force)
        return {'updated': updated}
    except Exception as e:
        logger.error(f"❌ Error regenerando menú digital de {store_id}: {e}", exc_info=True)
        raise self.retry(exc=e, countdown=10)


def queue_menu_image_regen(store_id):
    """Encola la regeneración del menú digital con debounce (ediciones en ráfaga
    del dueño en Config = UNA sola regeneración). Sin Redis, encola directo."""
    r = _get_lock_redis()
    if r is not None:
        try:
            # SET NX EX: si ya hay una regeneración encolada en la ventana, no duplicar
            if not r.set(f"menuimg_regen:{store_id}", "1", nx=True, ex=8):
                return
        except Exception:
            pass
    generate_menu_image_task.apply_async(args=[str(store_id)], countdown=6)


@shared_task
def notify_dashboard(order_id):
    """
    Notifica al dashboard via WebSocket sobre cambios en la orden.
    
    Esto actualiza la UI en tiempo real cuando hay cambios en una orden.
    
    Args:
        order_id: ID de la orden (UUID string)
    """
    try:
        order = Order.objects.get(id=order_id)

        # Obtener channel layer de Django Channels
        channel_layer = get_channel_layer()

        # El layer (redis/msgpack) no serializa UUID/Decimal. Forzamos primitivos
        # JSON-safe (UUID/Decimal → str) antes de enviar al grupo.
        payload = json.loads(json.dumps(OrderSerializer(order).data, default=str))

        # Enviar mensaje al grupo de WebSocket de la tienda
        async_to_sync(channel_layer.group_send)(
            f'store_{order.store.id}',
            {
                'type': 'order_update',
                'message': payload
            }
        )
        
        logger.info(f"🔔 Dashboard notificado de cambios en orden {order_id}")
        
    except Order.DoesNotExist:
        logger.warning(f"⚠️ Orden {order_id} no existe, no se puede notificar")
        
    except Exception as e:
        logger.error(f"❌ Error notificando dashboard: {e}", exc_info=True)
        # No lanzar excepción, la notificación es opcional


@shared_task(bind=True, max_retries=3)
def send_telegram_message_task(self, chat_id, text, buttons=None, token=None):
    """
    Tarea asíncrona para enviar mensaje a Telegram con botones opcionales.

    Args:
        chat_id: ID del chat
        text: Texto del mensaje
        buttons: Lista opcional de botones inline
        token: Token del bot de la tienda (multi-tienda). None → token global.
    """
    # Texto vacío = Telegram responde 400 "message text is empty" siempre:
    # reintentar es inútil. Se registra y se aborta.
    if not (text or '').strip():
        logger.error(f"❌ Intento de enviar mensaje VACÍO a Telegram {chat_id}; descartado.")
        return None
    try:
        result = send_telegram_message(chat_id, text, buttons, token=token)
        if not result:
            raise Exception("Falló el envío a Telegram")
        logger.info(f"📤 Mensaje enviado a Telegram {chat_id}" + (" con botones" if buttons else ""))
        return result
    except Exception as e:
        logger.error(f"❌ Error enviando mensaje Telegram: {e}")
        countdown = 2 ** self.request.retries
        raise self.retry(exc=e, countdown=countdown)


def _winback_message(customer):
    """Construye el mensaje personalizado de recompra usando la memoria del cliente."""
    name = customer.name or "¡Hola!"
    fav = customer.favorite_products[0] if customer.favorite_products else None
    if fav:
        return (f"¡Hola {name}! 👋 Hace rato no te vemos por aquí 🥹\n\n"
                f"¿Se te antoja un *{fav}* como la última vez? 😋 "
                f"Escríbeme y te lo despacho en minutos. 🛵")
    return (f"¡Hola {name}! 👋 Hace rato no te vemos 🥹\n\n"
            f"Tenemos algo rico esperándote. ¿Qué se te antoja hoy? Escríbeme 😉")


@shared_task
def winback_inactive_customers():
    """
    Recompra automática: re-contacta clientes inactivos (> WINBACK_DAYS sin pedir).

    Telegram: envío libre. WhatsApp: fuera de la ventana de 24h SOLO con plantilla
    aprobada (`WHATSAPP_WINBACK_TEMPLATE`); sin plantilla, se omite y se registra.
    Respeta un cooldown para no spamear (`WINBACK_COOLDOWN_DAYS`).
    """
    from django.utils import timezone
    from datetime import timedelta
    from .models import Customer

    now = timezone.now()
    inactive_before = now - timedelta(days=settings.WINBACK_DAYS)
    cooldown_before = now - timedelta(days=settings.WINBACK_COOLDOWN_DAYS)

    candidates = Customer.objects.filter(
        total_orders__gt=0,
        last_order_at__lt=inactive_before,
    ).filter(
        models_q_recent_winback(cooldown_before)
    ).select_related('store')[:200]

    sent, skipped = 0, 0
    for customer in candidates:
        text = _winback_message(customer)
        try:
            if customer.channel_type == Customer.ChannelType.TELEGRAM:
                token = resolve_store_token(customer.store)
                send_telegram_message(customer.channel_id, text, token=token)
                customer.last_winback_at = now
                customer.save(update_fields=['last_winback_at'])
                sent += 1
            else:
                # WhatsApp requiere plantilla aprobada fuera de la ventana 24h.
                if settings.WHATSAPP_WINBACK_TEMPLATE:
                    # TODO: enviar plantilla vía Cloud API (components con {{1}}={name}).
                    logger.info(f"Win-back WhatsApp con plantilla pendiente para {customer.id}")
                    skipped += 1
                else:
                    logger.info(f"Win-back WhatsApp omitido (sin plantilla) para {customer.id}")
                    skipped += 1
        except Exception as e:
            logger.error(f"Error en win-back de {customer.id}: {e}")
            skipped += 1

    logger.info(f"📨 Win-back: {sent} enviados, {skipped} omitidos")
    return {'sent': sent, 'skipped': skipped}


def models_q_recent_winback(cooldown_before):
    """Q: nunca contactado o fuera del cooldown."""
    from django.db.models import Q
    return Q(last_winback_at__isnull=True) | Q(last_winback_at__lt=cooldown_before)


@shared_task(bind=True, max_retries=3)
def process_button_callback_task(self, order_id, callback_data):
    """
    Procesa un click en botón inline de Telegram.
    
    Args:
        order_id: ID de la orden
        callback_data: Datos del callback (confirm_order, add_more, cancel_order, etc.)
    """
    from functools import partial
    from .services.telegram_service import (
        send_telegram_message as _send_tg,
        get_confirm_order_buttons,
        get_payment_method_buttons
    )
    from django.utils import timezone

    try:
        order = Order.objects.get(id=order_id)
        chat_id = order.customer_phone

        # Enviar siempre con el token del bot de ESTA tienda (multi-tienda).
        tg_token = resolve_store_token(order.store)
        send_telegram_message = partial(_send_tg, token=tg_token)

        logger.info(f"🔘 Procesando callback: {callback_data} para orden {order_id}")
        
        # ==================== CONFIRMAR PEDIDO ====================
        if callback_data == 'confirm_order':
            # Cambiar estado a esperar pago
            order.bot_state = 'WAITING_PAYMENT_PROOF'
            order.status = Order.Status.WAITING_PAYMENT
            order.save()
            
            # Actualizar estadísticas del cliente
            customer = order.customer
            if customer and order.total_amount > 0:
                customer.total_orders += 1
                customer.total_spent += order.total_amount
                customer.last_order_at = timezone.now()
                customer.save()
                logger.info(f"📊 Stats actualizadas: {customer.total_orders} pedidos")
            
            # Mostrar resumen y botones de pago
            items_text = "\n".join([
                f"• {item.quantity}x {item.display_name} - ${item.unit_price:,.0f}"
                for item in order.items.all()
            ])
            
            send_telegram_message(
                chat_id,
                f"✅ *¡Pedido confirmado!*\n\n{items_text}\n\n💰 *Total: ${order.total_amount:,.0f}*\n\n¿Cómo deseas pagar?",
                get_payment_method_buttons()
            )
            
            # Notificar dashboard
            notify_dashboard.delay(order_id)
            
        # ==================== AGREGAR MÁS ====================
        elif callback_data == 'add_more':
            order.bot_state = 'SALES_CONVERSATION'
            order.save()
            
            send_telegram_message(
                chat_id,
                "¡Claro! 😊 ¿Qué más te gustaría agregar?\n\nPuedes decirme cualquier producto del menú. 🍔🍟🥤"
            )
            
        # ==================== CANCELAR PEDIDO ====================
        elif callback_data == 'cancel_order':
            order.status = Order.Status.CANCELLED
            order.bot_state = 'IDLE'
            order.save()
            
            send_telegram_message(
                chat_id,
                "❌ Pedido cancelado.\n\n¡No hay problema! Cuando quieras hacer un nuevo pedido, solo escríbeme. 👋"
            )
            
        # ==================== PAGO NEQUI ====================
        elif callback_data == 'pay_nequi':
            order.payment_method = 'NEQUI'
            order.save()

            payment_info = (order.store.payment_instructions or "").strip()
            if payment_info:
                payment_block = f"💳 *Pago por Nequi/Transferencia*\n\n{payment_info}"
            else:
                payment_block = (
                    "💳 *Pago por Nequi/Transferencia*\n\n"
                    "⚠️ Esta tienda aún no configuró sus datos de pago. "
                    "Por favor contacta directamente al negocio para coordinar el pago."
                )

            send_telegram_message(
                chat_id,
                f"{payment_block}\n\n💰 Total a pagar: *${order.total_amount:,.0f}*\n\n📸 *Envía la foto del comprobante* aquí para confirmar tu pago."
            )
            
        # ==================== PAGO EFECTIVO ====================
        elif callback_data == 'pay_cash':
            order.payment_method = 'CASH'
            order.status = Order.Status.CONFIRMED
            order.bot_state = 'COMPLETED'
            order.save()
            
            send_telegram_message(
                chat_id,
                "✅ *¡Pedido confirmado!*\n\n💵 Pagarás en efectivo al recibir.\n\n👨‍🍳 Estamos preparando tu pedido...\n🚚 Te avisaremos cuando esté en camino.\n\n¡Gracias por tu compra! 🙏"
            )
            
            # Notificar dashboard del cambio de estado
            notify_dashboard.delay(order_id)
        
        else:
            logger.warning(f"Callback no reconocido: {callback_data}")
            send_telegram_message(chat_id, "Opción no reconocida. ¿En qué te puedo ayudar? 😊")
        
        return {'status': 'success', 'callback': callback_data}
        
    except Order.DoesNotExist:
        logger.error(f"❌ Orden {order_id} no existe para callback")
        raise
        
    except Exception as e:
        logger.error(f"❌ Error procesando callback: {e}", exc_info=True)
        countdown = 2 ** self.request.retries
        raise self.retry(exc=e, countdown=countdown)

