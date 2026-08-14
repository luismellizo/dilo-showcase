import logging
import json
import secrets
from django.db import IntegrityError
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.conf import settings
from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from .models import Store, Order, Customer, Message, TelegramCredentials
from .services.telegram_service import resolve_store_token
from .services.whatsapp_service import encrypt_token
from .tasks import process_whatsapp_message_task, process_button_callback_task

logger = logging.getLogger(__name__)


@method_decorator(csrf_exempt, name='dispatch')
class TelegramWebhookView(APIView):
    """
    Webhook para recibir mensajes de Telegram.
    Maneja tanto mensajes de texto como callback_query (clicks en botones).

    Multi-tienda: la URL incluye un `secret` que identifica la tienda
    (`/api/webhook/telegram/<secret>/`). Sin secret, cae a la tienda por
    defecto (compatibilidad con el entorno de un solo bot).
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, secret=None):
        try:
            data = json.loads(request.body)
            logger.info(f"📥 Telegram Webhook recibido: {json.dumps(data)[:200]}")

            # Resolver la tienda destino a partir del secret de la URL.
            store = self._resolve_store(secret)
            if not store:
                logger.warning(f"⚠️ Tienda no encontrada para secret de Telegram")
                return HttpResponse('OK', status=200)

            # ==================== MANEJAR CALLBACK QUERY (Botones) ====================
            callback_query = data.get('callback_query')
            if callback_query:
                return self._handle_callback_query(callback_query, store)

            # ==================== MANEJAR MENSAJE NORMAL ====================
            message = data.get('message', {})
            if not message:
                return HttpResponse('OK', status=200)

            return self._handle_message(message, store)

        except Exception as e:
            logger.error(f"❌ Error en webhook Telegram: {e}", exc_info=True)
            return HttpResponse('OK', status=200)

    def _handle_callback_query(self, callback_query, store):
        """Maneja clicks en botones inline."""
        from .services.telegram_service import answer_callback_query, edit_message_remove_buttons

        callback_id = callback_query.get('id')
        callback_data = callback_query.get('data', '')
        chat_id = str(callback_query.get('from', {}).get('id'))
        message_id = callback_query.get('message', {}).get('message_id')

        logger.info(f"🔘 Callback recibido: {callback_data} de {chat_id}")

        # Token del bot de ESTA tienda para responder.
        token = resolve_store_token(store)

        # Responder al callback inmediatamente (quita el "loading" del botón)
        answer_callback_query(callback_id, "Procesando...", token=token)

        # Remover botones del mensaje original
        if message_id:
            edit_message_remove_buttons(chat_id, message_id, token=token)

        # Misma ventana de 24h que _handle_message: no operar carritos zombis.
        from datetime import timedelta
        from django.utils import timezone
        order = Order.objects.filter(
            store=store,
            customer_phone=chat_id,
            status__in=['NEW', 'WAITING_PAYMENT', 'SALES_CONVERSATION', 'WAITING_PAYMENT_PROOF'],
            created_at__gte=timezone.now() - timedelta(hours=24),
        ).first()

        if not order:
            logger.warning(f"No hay orden activa para callback {callback_data}")
            return HttpResponse('OK', status=200)

        # Encolar el procesamiento del callback
        process_button_callback_task.delay(
            order_id=str(order.id),
            callback_data=callback_data
        )

        return HttpResponse('OK', status=200)

    def _handle_message(self, message, store):
        """Maneja mensajes de texto normales."""
        chat_id = str(message.get('chat', {}).get('id'))
        text = message.get('text', '')
        
        # Extraer datos del usuario de Telegram
        from_user = message.get('from', {})
        telegram_name = from_user.get('first_name', '')
        if from_user.get('last_name'):
            telegram_name += f" {from_user['last_name']}"
        
        # Manejo de fotos
        media_url = None
        if 'photo' in message:
            file_id = message['photo'][-1]['file_id']
            media_url = f"telegram_file_id:{file_id}"

        if not text and not media_url:
            return HttpResponse('OK', status=200)

        logger.info(f"📍 Usando tienda: {store.name}")

        # Idempotencia (#5): ignorar si ya guardamos este message_id.
        tg_message_id = str(message.get('message_id'))
        if Message.objects.filter(external_id=tg_message_id, order__store=store).exists():
            logger.info(f"♻️ Mensaje Telegram duplicado {tg_message_id} ignorado")
            return HttpResponse('OK', status=200)

        # Customer tracking
        customer, customer_created = Customer.objects.get_or_create(
            store=store,
            channel_id=chat_id,
            channel_type=Customer.ChannelType.TELEGRAM,
            defaults={'name': telegram_name}
        )
        
        if customer_created:
            logger.info(f"✨ Nuevo cliente: {customer.id} ({telegram_name})")
        elif not customer.name and telegram_name:
            customer.name = telegram_name
            customer.save()

        # Enforcement de suscripción: cuota agotada → no responde el bot.
        from .billing import register_conversation, should_send_quota_notice, QUOTA_NOTICE_TEXT
        if not register_conversation(store, customer):
            logger.warning(f"🚫 Cuota de conversaciones agotada (tienda {store.id})")
            if should_send_quota_notice(customer):
                from .tasks import send_telegram_message_task
                send_telegram_message_task.delay(
                    chat_id, QUOTA_NOTICE_TEXT, None, token=resolve_store_token(store)
                )
            return HttpResponse('OK', status=200)

        # Carrito ABIERTO = estados antes de cerrar el pago (ver nota en views.py).
        # VERIFYING_PAYMENT/CONFIRMED ya no capturan mensajes: pedido aparte o consulta.
        # Ventana de 24h: carrito viejo no se reutiliza (ver nota en views.py).
        from datetime import timedelta
        from django.utils import timezone
        active_statuses = ['NEW', 'WAITING_PAYMENT', 'SALES_CONVERSATION', 'WAITING_PAYMENT_PROOF']

        order = Order.objects.filter(
            store=store,
            customer_phone=chat_id,
            status__in=active_statuses,
            created_at__gte=timezone.now() - timedelta(hours=24),
        ).first()
        
        if not order:
            order = Order.objects.create(
                store=store,
                customer=customer,
                customer_phone=chat_id,
                customer_name=customer.name,
                bot_state='IDLE',
                status=Order.Status.NEW,
                source=Order.Source.TELEGRAM
            )
            logger.info(f"✨ Nueva orden: {order.id}")
        else:
            if not order.customer:
                order.customer = customer
                order.save()
            logger.info(f"🔄 Orden existente: {order.id}")

        # Guardar mensaje en DB. El unique constraint (platform, external_id)
        # es la garantía real contra duplicados concurrentes.
        try:
            Message.objects.create(
                order=order,
                sender='USER',
                content=text or '[Archivo adjunto]',
                platform='TELEGRAM',
                external_id=tg_message_id
            )
        except IntegrityError:
            logger.info(f"♻️ Mensaje Telegram duplicado {tg_message_id} (carrera) ignorado")
            return HttpResponse('OK', status=200)

        # Encolar tarea. Texto: debounce de 2s para que una ráfaga de mensajes
        # se agrupe en UNA respuesta (ver anti-ráfaga en tasks.py). Media: inmediato.
        process_whatsapp_message_task.apply_async(
            kwargs={'order_id': str(order.id), 'text': text, 'media_url': media_url},
            countdown=0 if media_url else 2,
        )

        return HttpResponse('OK', status=200)

    def _resolve_store(self, secret):
        """
        Resuelve la tienda destino del webhook por su `webhook_secret`.

        Si no se pasa secret (URL legacy), NO hay forma de autenticar que el
        POST realmente viene de Telegram (Telegram no firma sus webhooks) —
        cualquiera podría pegarle a `/api/webhook/telegram/` y enrutar
        mensajes falsos a una tienda real. Por eso el fallback legacy (un
        solo bot global, sin secret) solo se habilita en DEBUG/dev; en
        producción se rechaza.
        """
        if secret:
            creds = TelegramCredentials.objects.filter(
                webhook_secret=secret, is_active=True
            ).select_related('store').first()
            if creds:
                return creds.store
            return None

        if not settings.DEBUG:
            logger.error(
                "🚨 Webhook de Telegram sin secret en producción — rechazado "
                "(el fallback legacy solo aplica en DEBUG=True)"
            )
            return None

        # Fallback legacy (un solo bot global, solo dev local)
        from django.contrib.auth.models import User
        test_user = User.objects.filter(username='test@test.com').first()
        if test_user:
            return Store.objects.filter(owner=test_user).first()
        return Store.objects.first()


def _owned_store(request):
    """Devuelve la tienda del store_id si pertenece al usuario, o None."""
    store_id = request.data.get('store_id') or request.query_params.get('store_id')
    if not store_id:
        return None
    return Store.objects.filter(id=store_id, owner=request.user).first()


class TelegramConnectView(APIView):
    """
    Conecta el bot de Telegram de una tienda.

    POST /api/telegram/connect/  { store_id, bot_token }
    - Valida el token con getMe
    - Genera webhook_secret, encripta el token y crea/actualiza TelegramCredentials
    - Registra el webhook en Telegram apuntando a /api/webhook/telegram/<secret>/
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        store = _owned_store(request)
        if not store:
            return Response({'error': 'Tienda no encontrada'}, status=status.HTTP_404_NOT_FOUND)

        bot_token = (request.data.get('bot_token') or '').strip()
        if not bot_token:
            return Response({'error': 'bot_token es requerido'}, status=status.HTTP_400_BAD_REQUEST)

        from .services.telegram_service import get_bot_info, set_webhook
        info = get_bot_info(bot_token)
        if not info:
            return Response({'error': 'Token de bot inválido'}, status=status.HTTP_400_BAD_REQUEST)

        # Reusar secret existente si ya estaba conectado; si no, generarlo.
        creds = getattr(store, 'telegram_credentials', None)
        webhook_secret = creds.webhook_secret if creds else secrets.token_urlsafe(24)

        TelegramCredentials.objects.update_or_create(
            store=store,
            defaults={
                'encrypted_bot_token': encrypt_token(bot_token),
                'bot_username': info.get('username', ''),
                'webhook_secret': webhook_secret,
                'is_active': True,
            }
        )

        webhook_url = f"{settings.BACKEND_PUBLIC_URL.rstrip('/')}/api/webhook/telegram/{webhook_secret}/"
        ok = set_webhook(bot_token, webhook_url)

        return Response({
            'success': True,
            'connected': True,
            'bot_username': info.get('username', ''),
            'webhook_registered': ok,
        })


class TelegramStatusView(APIView):
    """GET /api/telegram/status/?store_id= → estado de conexión del bot."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        store = _owned_store(request)
        if not store:
            return Response({'error': 'Tienda no encontrada'}, status=status.HTTP_404_NOT_FOUND)
        creds = getattr(store, 'telegram_credentials', None)
        return Response({
            'connected': bool(creds and creds.is_active),
            'bot_username': creds.bot_username if creds else '',
        })


class TelegramDisconnectView(APIView):
    """POST /api/telegram/disconnect/ { store_id } → desconecta el bot."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        store = _owned_store(request)
        if not store:
            return Response({'error': 'Tienda no encontrada'}, status=status.HTTP_404_NOT_FOUND)
        creds = getattr(store, 'telegram_credentials', None)
        if creds:
            from .services.telegram_service import delete_webhook
            try:
                delete_webhook(resolve_store_token(store))
            except Exception:
                pass
            creds.is_active = False
            creds.save()
        return Response({'success': True, 'connected': False})
