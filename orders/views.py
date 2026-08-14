import hashlib
import hmac
import logging
from django.db import IntegrityError
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.http import HttpResponse
from django.conf import settings
from .models import Store, Order, Category, Product, ProductVariant, Message, Customer
from .serializers import (StoreSerializer, OrderSerializer, CategorySerializer,
                          ProductSerializer, MessageSerializer, CustomerSerializer)
from .bot_engine import WhatsAppBotEngine
from .tasks import send_whatsapp_message, send_telegram_message_task, notify_dashboard
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
import requests

logger = logging.getLogger(__name__)


class StoreViewSet(viewsets.ModelViewSet):
    queryset = Store.objects.all()
    serializer_class = StoreSerializer

    def get_queryset(self):
        # Aislamiento multi-tienda: cada usuario solo ve SUS tiendas.
        return Store.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        # El dueño es siempre el usuario autenticado, nunca lo que mande el cliente.
        serializer.save(owner=self.request.user)


class CategoryViewSet(viewsets.ModelViewSet):
    """ViewSet para gestionar categorías del menú."""
    queryset = Category.objects.all()
    serializer_class = CategorySerializer

    def get_queryset(self):
        """Solo categorías de tiendas del usuario. Filtro opcional por store_id."""
        queryset = Category.objects.filter(
            store__owner=self.request.user
        ).order_by('display_order', 'name')
        store_id = self.request.query_params.get('store_id')
        if store_id:
            queryset = queryset.filter(store_id=store_id)
        return queryset

    def perform_create(self, serializer):
        # No permitir crear categorías en tiendas ajenas.
        store = serializer.validated_data.get('store')
        if store and store.owner_id != self.request.user.id:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("No puedes crear categorías en una tienda que no es tuya.")
        serializer.save()


class ProductViewSet(viewsets.ModelViewSet):
    """ViewSet para gestionar productos del menú."""
    queryset = Product.objects.all()
    serializer_class = ProductSerializer

    def get_queryset(self):
        """Solo productos de tiendas del usuario. Filtro opcional por category/store."""
        queryset = Product.objects.filter(
            category__store__owner=self.request.user
        ).order_by('display_order', 'name')
        category_id = self.request.query_params.get('category_id')
        store_id = self.request.query_params.get('store_id')
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        elif store_id:
            queryset = queryset.filter(category__store_id=store_id)
        return queryset

    def perform_create(self, serializer):
        # No permitir crear productos en categorías de tiendas ajenas.
        category = serializer.validated_data.get('category')
        if category and category.store.owner_id != self.request.user.id:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("No puedes crear productos en una tienda que no es tuya.")
        serializer.save()


class CustomerViewSet(viewsets.ReadOnlyModelViewSet):
    """Clientes de las tiendas del usuario (página Clientes del dashboard)."""
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer

    def get_queryset(self):
        from django.db.models import Count
        queryset = Customer.objects.filter(
            store__owner=self.request.user
        ).annotate(order_count=Count('orders')).order_by('-last_order_at', '-first_contact_at')
        store_id = self.request.query_params.get('store_id')
        if store_id:
            queryset = queryset.filter(store_id=store_id)
        return queryset

    @action(detail=True, methods=['get'])
    def orders(self, request, pk=None):
        """Historial de pedidos de este cliente, del más reciente al más viejo.

        `get_object()` ya aplica el filtro por `store__owner`: un cliente de
        otro comercio es 404 antes de llegar aquí.
        """
        customer = self.get_object()
        qs = customer.orders.all().prefetch_related('items').order_by('-created_at')
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = OrderSerializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)
        return Response(OrderSerializer(qs, many=True, context={'request': request}).data)


class OrderViewSet(viewsets.ModelViewSet):
    queryset = Order.objects.all()
    serializer_class = OrderSerializer

    def get_queryset(self):
        # Aislamiento multi-tienda: solo órdenes de tiendas del usuario.
        return Order.objects.filter(store__owner=self.request.user)

    # Mensaje automático al cliente cuando el dueño avanza el estado en el
    # dashboard. Cierra el lazo del pago manual (Nequi): el comensal manda el
    # comprobante y aquí se entera de que fue aceptado / despachado.
    STATUS_CUSTOMER_MESSAGE = {
        Order.Status.CONFIRMED: (
            "✅ ¡Pago verificado!\n\n"
            "Ya estamos preparando tu pedido 👨‍🍳\n"
            "Te avisamos cuando salga. ¡Gracias! 🙏"
        ),
        Order.Status.COMPLETED: (
            "🚚 ¡Tu pedido va en camino / fue entregado!\n\n"
            "Gracias por tu compra. ¡Buen provecho! 😋"
        ),
        Order.Status.CANCELLED: (
            "❌ Tu pedido fue cancelado.\n\n"
            "Si crees que es un error o tienes dudas, escríbenos por aquí."
        ),
    }

    def _send_to_customer(self, order, text):
        """Envía un texto al cliente por su canal, con las credenciales de la tienda."""
        if order.source == Order.Source.TELEGRAM:
            from .services.telegram_service import resolve_store_token
            token = resolve_store_token(order.store)
            send_telegram_message_task.delay(order.customer_phone, text, None, token)
        else:
            send_whatsapp_message.delay(order.customer_phone, text, order_id=str(order.id))
        # Persistir en el historial del chat (visible en el dashboard).
        Message.objects.create(
            order=order, sender='AGENT', content=text,
            platform=order.source, is_read=True,
        )

    @action(detail=True, methods=['post'])
    def update_status(self, request, pk=None):
        order = self.get_object()
        new_status = request.data.get('status')
        if new_status in [choice[0] for choice in Order.Status.choices]:
            status_changed = order.status != new_status
            order.status = new_status
            order.save()
            # Notificar via WebSocket (UUID/Decimal → primitivos JSON-safe).
            channel_layer = get_channel_layer()
            payload = json.loads(json.dumps(OrderSerializer(order).data, default=str))
            async_to_sync(channel_layer.group_send)(
                f'store_{order.store.id}',
                {
                    'type': 'order_update',
                    'message': payload
                }
            )
            # Avisar al cliente si el nuevo estado tiene mensaje y de verdad cambió.
            if status_changed:
                customer_msg = self.STATUS_CUSTOMER_MESSAGE.get(new_status)
                if customer_msg:
                    try:
                        self._send_to_customer(order, customer_msg)
                    except Exception as e:
                        logger.error(f"No se pudo avisar al cliente de orden {order.id}: {e}")
            return Response({'status': 'updated'})
        return Response({'error': 'Invalid status'}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def toggle_bot(self, request, pk=None):
        """Pausa o reanuda el bot en ESTA conversación.

        Body: {"paused": true|false}. Sin body → alterna el estado actual.
        """
        from django.utils import timezone
        order = self.get_object()          # ya filtrado por store__owner
        paused = request.data.get('paused')
        if paused is None:
            paused = not order.bot_paused
        order.bot_paused = bool(paused)
        order.bot_paused_at = timezone.now() if order.bot_paused else None
        order.save(update_fields=['bot_paused', 'bot_paused_at'])
        notify_dashboard(str(order.id))
        return Response(OrderSerializer(order).data)

    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        """Listar mensajes de la orden."""
        order = self.get_object()
        messages = order.messages.all().order_by('timestamp')
        serializer = MessageSerializer(messages, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def send_message(self, request, pk=None):
        """Enviar mensaje al cliente (WhatsApp/Telegram)."""
        order = self.get_object()
        content = request.data.get('content')
        
        if not content:
            return Response({'error': 'Content is required'}, status=status.HTTP_400_BAD_REQUEST)

        # 1. Guardar mensaje en DB (como enviado por AGENT)
        message = Message.objects.create(
            order=order,
            sender='AGENT',
            content=content,
            platform=order.source, # WHATSAPP o TELEGRAM
            is_read=True
        )

        # El dueño habló: el bot se calla solo. Si no, el LLM responde encima
        # del humano en el siguiente mensaje del cliente.
        if not order.bot_paused:
            from django.utils import timezone
            order.bot_paused = True
            order.bot_paused_at = timezone.now()
            order.save(update_fields=['bot_paused', 'bot_paused_at'])

        # 2. Enviar mensaje real (con las credenciales de LA tienda).
        try:
            if order.source == Order.Source.TELEGRAM:
                from .services.telegram_service import resolve_store_token
                token = resolve_store_token(order.store)
                send_telegram_message_task.delay(order.customer_phone, content, None, token)
            else:
                send_whatsapp_message.delay(order.customer_phone, content, order_id=str(order.id))

            return Response(MessageSerializer(message).data)
            
        except Exception as e:
            logger.error(f"Error enviando mensaje manual: {e}")
            return Response({'error': 'Failed to send message'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Vista para webhook de WhatsApp
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
import json


@method_decorator(csrf_exempt, name='dispatch')
class WhatsAppWebhookView(APIView):
    """
    Webhook de WhatsApp Business API.

    PÚBLICO A PROPÓSITO: Meta llama sin cabecera de autenticación. Con el
    `IsAuthenticated` por defecto de DRF este webhook respondía **401 a todos
    los mensajes de Meta** — el bot jamás podía contestar por WhatsApp.
    La autenticidad NO se pierde: se valida la firma HMAC
    `X-Hub-Signature-256` en cada POST (`_verify_meta_signature`) y el
    `hub.verify_token` en el GET de verificación.

    CRÍTICO: WhatsApp requiere respuesta HTTP 200 en menos de 5 segundos.
    Si no respondemos a tiempo, WhatsApp reenviará el mensaje (duplicados).

    Estrategia:
    1. Recibir webhook
    2. Parsear payload (rápido)
    3. Guardar/buscar orden en DB (rápido)
    4. Encolar tarea Celery (asíncrono)
    5. Retornar 200 OK inmediatamente (<100ms)
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    # Sin autenticación, DRF aplicaría el throttle `anon` (60/min por IP). Meta
    # envía los webhooks de TODOS los comercios desde un puñado de IPs: con
    # tráfico real se pasaría del límite y Meta recibiría 429 → mensajes
    # perdidos o duplicados. La protección aquí es la firma HMAC, no el rate.
    throttle_classes = []

    def get(self, request):
        """
        Verificación del webhook (WhatsApp setup).
        
        WhatsApp envía este request para verificar que el webhook funciona.
        """
        mode = request.GET.get('hub.mode')
        token = request.GET.get('hub.verify_token')
        challenge = request.GET.get('hub.challenge')

        if mode == 'subscribe' and token == settings.WHATSAPP_VERIFY_TOKEN:
            logger.info("✅ Webhook verificado exitosamente")
            return HttpResponse(challenge, content_type='text/plain')
        
        logger.warning("❌ Intento de verificación fallido")
        return HttpResponse('Forbidden', status=403)

    def _verify_meta_signature(self, request):
        """Valida X-Hub-Signature-256 (HMAC-SHA256 con META_APP_SECRET).

        Sin esto, cualquiera puede POSTear payloads falsos al webhook y
        gastar cuota/IA de una tienda o inyectar pedidos falsos.
        """
        app_secret = settings.META_APP_SECRET
        if not app_secret:
            # Sin secret configurado no hay forma de validar. En dev se deja
            # pasar para poder probar sin credenciales de Meta; en prod
            # (DEBUG=False) se rechaza — nunca confiar en payloads sin firmar.
            logger.error("⚠️ META_APP_SECRET no configurado — webhook de WhatsApp SIN validar firma")
            return bool(settings.DEBUG)

        signature = request.META.get('HTTP_X_HUB_SIGNATURE_256', '')
        if not signature.startswith('sha256='):
            return False
        expected = hmac.new(app_secret.encode(), request.body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature[len('sha256='):], expected)

    def post(self, request):
        """
        Recepción de mensajes de WhatsApp.

        DEBE responder en <200ms para evitar timeouts y mensajes duplicados.
        """
        if not self._verify_meta_signature(request):
            logger.error("🚨 Firma X-Hub-Signature-256 inválida — webhook rechazado")
            return HttpResponse('Forbidden', status=403)
        try:
            data = json.loads(request.body)
            logger.info(f"📥 Webhook recibido: {len(data.get('entry', []))} entries")

            # Procesar todos los cambios del payload. Meta manda varios tipos
            # de `field` por el MISMO webhook: mensajes entrantes, estados de
            # entrega y cambios de la cuenta del cliente. Ignorar los últimos
            # dos era perder los fallos de envío y los avisos de onboarding.
            for entry in data.get('entry', []):
                waba_id = entry.get('id')
                for change in entry.get('changes', []):
                    field = change.get('field')
                    value = change.get('value', {})

                    if field == 'messages':
                        # phone_number_id identifica a QUÉ tienda llegó el mensaje.
                        phone_number_id = value.get('metadata', {}).get('phone_number_id')
                        for message in value.get('messages', []):
                            self.queue_message_processing(message, phone_number_id)
                        for status_update in value.get('statuses', []):
                            self.handle_message_status(status_update, phone_number_id)
                    elif field == 'account_update':
                        self.handle_account_update(waba_id, value)
                    else:
                        logger.info(f"ℹ️ Webhook '{field}' recibido (sin handler): "
                                    f"WABA {waba_id}")

            # ✅ Respuesta inmediata a WhatsApp (sin esperar procesamiento)
            return HttpResponse('OK', status=200)
            
        except Exception as e:
            logger.error(f"❌ Error en webhook: {e}", exc_info=True)
            # Incluso con error, retornar 200 para evitar reintentos de WhatsApp
            return HttpResponse('OK', status=200)

    def handle_message_status(self, status_update, phone_number_id=None):
        """
        Procesa un webhook de estado de mensaje (sent/delivered/read/failed).

        Solo los `failed` importan operativamente: significan que un mensaje
        del bot NO llegó al cliente (número inválido, ventana de 24h cerrada,
        plantilla no aprobada). Sin esto, un pedido puede morir en silencio
        porque el comercio cree que respondió y el cliente nunca vio nada.
        """
        try:
            state = status_update.get('status')
            if state != 'failed':
                return

            recipient = status_update.get('recipient_id', '')
            errors = status_update.get('errors', []) or []
            detail = errors[0] if errors else {}
            logger.error(
                f"🚨 Mensaje de WhatsApp NO entregado a {recipient} "
                f"(phone_number_id={phone_number_id}): "
                f"[{detail.get('code')}] {detail.get('title') or detail.get('message')}"
            )
        except Exception as e:
            logger.error(f"Error procesando estado de mensaje: {e}", exc_info=True)

    # Eventos de `account_update` que dejan la cuenta del comercio inoperante.
    # Nombres tomados de la referencia oficial del webhook — inventarlos hace
    # que el handler no dispare nunca y el fallo pase inadvertido.
    ACCOUNT_DEAD_EVENTS = {
        'ACCOUNT_DELETED',          # el cliente borró su WABA
        'ACCOUNT_RESTRICTION',      # restringida por infracción de políticas
        'ACCOUNT_VIOLATION',        # infringió políticas o condiciones
        'PARTNER_APP_UNINSTALLED',  # el cliente revocó el acceso de nuestra app
        'PARTNER_REMOVED',          # dejó de compartir la WABA con nosotros
    }
    ACCOUNT_ALIVE_EVENTS = {
        'ACCOUNT_RECONNECTED',      # reconectada tras cambio de dispositivo
        'PARTNER_APP_INSTALLED',    # el cliente (re)otorgó permisos a la app
    }

    def handle_account_update(self, waba_id, value):
        """
        Procesa el webhook `account_update` de la WABA del cliente.

        Meta exige suscribirse a este campo para el Embedded Signup. Avisa
        cuando el cliente revoca el acceso de nuestra app, cuando su cuenta es
        restringida o inhabilitada, y cuando vuelve a estar operativa. Una WABA
        muerta que sigue marcada como activa deja al comercio creyendo que
        vende mientras cada envío falla en silencio.
        """
        try:
            from .models import WhatsAppCredentials

            event = value.get('event', '')
            # En los eventos PARTNER_* el id del cliente viaja en waba_info;
            # en el resto, `entry.id` ya es la WABA.
            waba_id = (value.get('waba_info') or {}).get('waba_id') or waba_id
            logger.info(f"📣 account_update '{event}' para WABA {waba_id}: {value}")

            creds = WhatsAppCredentials.objects.filter(waba_id=waba_id).first()
            if not creds:
                # Normal durante el onboarding: el webhook puede llegar antes
                # de que terminemos de guardar las credenciales.
                return

            dead = event in self.ACCOUNT_DEAD_EVENTS
            alive = event in self.ACCOUNT_ALIVE_EVENTS

            if event == 'DISABLED_UPDATE':
                # OJO: DISABLED_UPDATE también llega cuando Meta REACTIVA la
                # cuenta. El estado real está en ban_info, no en el nombre del
                # evento; tratarlo siempre como baja apagaría comercios sanos.
                ban_state = (value.get('ban_info') or {}).get('waba_ban_state', '')
                if ban_state == 'REINSTATE':
                    alive = True
                else:
                    dead = True

            if dead:
                creds.is_active = False
                creds.is_subscribed = False
                creds.save(update_fields=['is_active', 'is_subscribed', 'updated_at'])
                logger.error(f"🚨 WABA {waba_id} inoperante ({event}) — "
                             f"tienda {creds.store_id} desactivada")

            elif alive and not creds.is_active:
                creds.is_active = True
                creds.save(update_fields=['is_active', 'updated_at'])
                logger.info(f"✅ WABA {waba_id} reactivada ({event})")

        except Exception as e:
            logger.error(f"Error procesando account_update: {e}", exc_info=True)

    def queue_message_processing(self, message, phone_number_id=None):
        """
        Encola procesamiento de mensaje en Celery (operación rápida <50ms).

        Esta función NO procesa el mensaje, solo prepara y encola la tarea.

        Args:
            message: Payload del mensaje de WhatsApp
            phone_number_id: Phone Number ID receptor (identifica la tienda destino)
        """
        try:
            from .models import WhatsAppCredentials, Customer
            from .tasks import process_whatsapp_message_task

            # Extraer datos del mensaje (operación rápida)
            from_number = message.get('from', '')      # número del CLIENTE
            wa_message_id = message.get('id')           # id único para idempotencia
            text = message.get('text', {}).get('body', '')
            media_url = None

            # Detectar archivos adjuntos
            if 'image' in message:
                media_url = message['image'].get('url')
            elif 'document' in message:
                media_url = message['document'].get('url')
            elif 'video' in message:
                media_url = message['video'].get('url')

            logger.info(f"📱 Mensaje de {from_number}: {text[:50]}{'...' if len(text) > 50 else ''}")

            # Ruteo multi-tienda: resolver la tienda por el phone_number_id receptor.
            store = None
            if phone_number_id:
                creds = WhatsAppCredentials.objects.filter(
                    phone_number_id=phone_number_id, is_active=True
                ).select_related('store').first()
                if creds:
                    store = creds.store
            if not store:
                logger.warning(f"⚠️ Tienda no encontrada para phone_number_id: {phone_number_id}")
                return

            # Idempotencia (#5): si ya procesamos este wa_message_id, ignorar.
            if wa_message_id and Message.objects.filter(external_id=wa_message_id).exists():
                logger.info(f"♻️ Mensaje duplicado {wa_message_id} ignorado")
                return

            # Cliente (tracking por canal)
            customer, _ = Customer.objects.get_or_create(
                store=store,
                channel_id=from_number,
                channel_type=Customer.ChannelType.WHATSAPP,
            )

            # Enforcement de suscripción: cuota agotada → no responde el bot.
            from .billing import register_conversation, should_send_quota_notice, QUOTA_NOTICE_TEXT
            if not register_conversation(store, customer):
                logger.warning(f"🚫 Cuota de conversaciones agotada (tienda {store.id})")
                if should_send_quota_notice(customer):
                    send_whatsapp_message.delay(from_number, QUOTA_NOTICE_TEXT, store_id=str(store.id))
                return

            # Carrito ABIERTO = estados antes de cerrar el pago. Una vez el cliente
            # manda el comprobante (VERIFYING_PAYMENT) o paga (CONFIRMED), ese pedido
            # deja de capturar mensajes nuevos: lo siguiente es pedido aparte o
            # consulta de estado (el bot lo resuelve con el "pedido en curso").
            # Ventana de 24h (alineada con la conversación facturable): un carrito
            # abandonado no captura conversaciones días después — se crea pedido
            # nuevo y el dashboard lo ve como NUEVO (antes: orden zombi eterna).
            from datetime import timedelta
            from django.utils import timezone
            active_statuses = ['NEW', 'WAITING_PAYMENT', 'SALES_CONVERSATION', 'WAITING_PAYMENT_PROOF']

            order = Order.objects.filter(
                store=store,
                customer_phone=from_number,
                status__in=active_statuses,
                created_at__gte=timezone.now() - timedelta(hours=24),
            ).first()

            if not order:
                order = Order.objects.create(
                    store=store,
                    customer=customer,
                    customer_phone=from_number,
                    customer_name=customer.name,
                    bot_state='IDLE',
                    status=Order.Status.NEW,
                    source=Order.Source.WHATSAPP,
                )
                logger.info(f"✨ Nueva orden creada: {order.id}")
            else:
                if not order.customer:
                    order.customer = customer
                    order.save()
                logger.info(f"🔄 Orden existente: {order.id}")

            # Guardar mensaje entrante con su id externo (para idempotencia y memoria).
            # El unique constraint (platform, external_id) es la garantía real
            # contra duplicados concurrentes; el filter().exists() de arriba
            # es solo el camino rápido (evita crear Order/Customer de más).
            try:
                Message.objects.create(
                    order=order,
                    sender='USER',
                    content=text or '[Archivo adjunto]',
                    platform='WHATSAPP',
                    external_id=wa_message_id,
                )
            except IntegrityError:
                logger.info(f"♻️ Mensaje duplicado {wa_message_id} (carrera) ignorado")
                return

            # ⚡ Disparar tarea Celery (NO esperar resultado). Texto: debounce de
            # 2s para agrupar ráfagas en UNA respuesta (anti-ráfaga en tasks.py).
            process_whatsapp_message_task.apply_async(
                kwargs={'order_id': str(order.id), 'text': text, 'media_url': media_url},
                countdown=0 if media_url else 2,
            )

            logger.info(f"✅ Mensaje encolado para procesamiento asíncrono")

        except Exception as e:
            logger.error(f"❌ Error encolando mensaje: {e}", exc_info=True)
            # No lanzar excepción para no romper el webhook


@method_decorator(csrf_exempt, name='dispatch')
class PaymentWebhookView(APIView):
    """
    Webhook centralizado para recibir notificaciones de pasarelas de pago.
    
    Flujo:
    1. Recibir webhook de Wompi/Bold
    2. Extraer referencia (ORD-{store_id}-{order_id})
    3. Buscar configuración de pago de ESA tienda específica
    4. Validar firma usando el integrity_secret de ESA tienda
    5. Actualizar estado de orden y notificar vía WebSocket

    PÚBLICO A PROPÓSITO: las pasarelas llaman sin JWT. Con el
    `IsAuthenticated` por defecto de DRF este webhook devolvía 401 a Wompi y
    ningún pago se confirmaba solo. La seguridad la da la verificación de
    firma por proveedor (se rechaza con 403 cualquiera sin firma verificable).
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    # Ver nota del webhook de WhatsApp: el throttle `anon` cortaría ráfagas
    # legítimas de la pasarela. La firma por proveedor es la que protege.
    throttle_classes = []

    def post(self, request):
        """
        Procesa notificación de pago desde la pasarela.
        """
        try:
            data = json.loads(request.body)
            logger.info(f"💳 Webhook de pago recibido: {data.get('event')}")
            
            # Extraer datos del evento
            event_type = data.get('event')
            transaction = data.get('data', {}).get('transaction', {})
            reference = transaction.get('reference', '')
            
            # Parsear referencia: ORD-{store_id}-{order_id}
            if not reference.startswith('ORD-'):
                logger.warning(f"Referencia inválida: {reference}")
                return HttpResponse('OK', status=200)  # Responder OK para no reintentar
            
            parts = reference.split('-')
            if len(parts) != 3:
                logger.warning(f"Formato de referencia incorrecto: {reference}")
                return HttpResponse('OK', status=200)
            
            store_id = parts[1]
            order_id = parts[2]
            
            # Buscar orden
            order = Order.objects.filter(id=order_id, store__id=store_id).first()
            if not order:
                logger.warning(f"Orden no encontrada: {reference}")
                return HttpResponse('OK', status=200)
            
            # Buscar configuración de pago de la tienda
            payment_config = getattr(order.store, 'payment_config', None)
            if not payment_config:
                logger.error(f"Configuración de pago no encontrada para tienda {store_id}")
                return HttpResponse('OK', status=200)
            
            # Validar firma según el proveedor. Solo WOMPI tiene verificación de
            # firma implementada. NEQUI_MANUAL nunca confirma por este webhook
            # (el pago se confirma por foto de comprobante, no por API). BOLD
            # no tiene integración real todavía (ver payment_service.py) — sin
            # validación de firma, un POST falso confirmaría pedidos sin pagar.
            if payment_config.provider == 'WOMPI':
                from .services.payment_service import validate_wompi_signature

                if not validate_wompi_signature(data, payment_config.integrity_secret):
                    logger.error(f"Firma inválida para orden {order_id}")
                    return HttpResponse('Forbidden', status=403)
            else:
                logger.error(
                    f"🚨 Webhook de pago rechazado: proveedor '{payment_config.provider}' "
                    f"sin verificación de firma soportada (orden {order_id})"
                )
                return HttpResponse('Forbidden', status=403)

            # Procesar estado de la transacción
            transaction_status = transaction.get('status')
            
            if transaction_status == 'APPROVED':
                order.status = Order.Status.CONFIRMED
                order.bot_state = 'COMPLETED'
                order.save()
                
                logger.info(f"✅ Pago APROBADO para orden {order_id}")
                
                # Notificar vía WebSocket (UUID/Decimal → primitivos JSON-safe).
                channel_layer = get_channel_layer()
                payload = json.loads(json.dumps(OrderSerializer(order).data, default=str))
                async_to_sync(channel_layer.group_send)(
                    f'store_{order.store.id}',
                    {
                        'type': 'order_update',
                        'message': payload
                    }
                )
                
            elif transaction_status in ['DECLINED', 'ERROR']:
                order.status = Order.Status.CANCELLED
                order.save()
                logger.warning(f"❌ Pago RECHAZADO para orden {order_id}")
            
            return HttpResponse('OK', status=200)
            
        except Exception as e:
            logger.error(f"❌ Error procesando webhook de pago: {e}", exc_info=True)
            return HttpResponse('OK', status=200)  # Responder OK para evitar reintentos


from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.throttling import ScopedRateThrottle


class MenuExtractView(APIView):
    """
    Lee el menú de una tienda a partir de fotos/PDF usando IA con visión.

    POST /api/menu/extract/   (multipart/form-data)
      - store_id: UUID de la tienda (del usuario)
      - images: hasta 7 archivos (imágenes o PDF, máx 8MB c/u)

    NO escribe en DB: devuelve la estructura detectada para que el dueño la
    revise/edite en el preview del panel y luego confirme (MenuConfirmView).
    PDF digital → texto directo (sin visión); PDF escaneado → páginas a imagen.
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'menu_extract'

    def post(self, request):
        from .services.menu_extractor import (
            MAX_FILES, MAX_FILE_MB,
            extract_menu_from_images, extract_menu_from_text,
            pdf_extract_text, pdf_to_images, _MIN_TEXT_CHARS_PDF,
        )

        store_id = request.data.get('store_id')
        store = Store.objects.filter(id=store_id, owner=request.user).first()
        if not store:
            return Response({'error': 'Tienda no encontrada'}, status=status.HTTP_404_NOT_FOUND)

        files = request.FILES.getlist('images')
        if not files:
            return Response({'error': 'Adjunta al menos una imagen del menú'},
                            status=status.HTTP_400_BAD_REQUEST)
        if len(files) > MAX_FILES:
            return Response({'error': f'Máximo {MAX_FILES} archivos por carga'},
                            status=status.HTTP_400_BAD_REQUEST)
        for f in files:
            if f.size > MAX_FILE_MB * 1024 * 1024:
                return Response(
                    {'error': f'"{f.name}" supera el máximo de {MAX_FILE_MB}MB por archivo'},
                    status=status.HTTP_400_BAD_REQUEST)

        images = []
        pdf_texts = []
        try:
            for f in files:
                data = f.read()
                ct = (f.content_type or '').lower()
                is_pdf = ct == 'application/pdf' or (f.name or '').lower().endswith('.pdf')
                if is_pdf:
                    # PDF digital: texto directo (sin visión = más barato y preciso).
                    # Escaneado (sin capa de texto): fallback a imágenes.
                    text = pdf_extract_text(data)
                    if len(text) >= _MIN_TEXT_CHARS_PDF:
                        pdf_texts.append(text)
                    else:
                        images.extend(pdf_to_images(data))
                else:
                    images.append({'bytes': data, 'content_type': ct or 'image/jpeg'})
        except Exception as e:
            logger.error(f"❌ Error preparando archivos de menú: {e}", exc_info=True)
            return Response({'error': 'No se pudo procesar el archivo (¿PDF dañado?)'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        # Tope global tras expandir PDFs escaneados (protección de tokens).
        images = images[:MAX_FILES]

        try:
            if pdf_texts and not images:
                categories = extract_menu_from_text("\n\n".join(pdf_texts))
            elif images and not pdf_texts:
                categories = extract_menu_from_images(images)
            elif images and pdf_texts:
                # Mezcla rara (fotos + PDF): prioriza imágenes e ignora nada —
                # une los resultados de ambos caminos.
                categories = extract_menu_from_images(images)
                categories += extract_menu_from_text("\n\n".join(pdf_texts))
            else:
                return Response({'error': 'No se pudo leer ningún archivo'},
                                status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        except Exception as e:
            logger.error(f"❌ Error extrayendo menú: {e}", exc_info=True)
            return Response({'error': str(e) or 'No se pudo leer el menú'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        # Solo preview: precios como número plano para que el front los edite.
        preview = [{
            'name': cat['name'],
            'products': [{
                'name': p['name'],
                'description': p['description'],
                'price': float(p['price']),
                'variants': [{'name': v['name'], 'price': float(v['price'])}
                             for v in p.get('variants', [])],
            } for p in cat['products']],
        } for cat in categories]

        total_products = sum(len(c['products']) for c in preview)
        return Response({
            'success': True,
            'preview': True,
            'categories_detected': len(preview),
            'products_detected': total_products,
            'categories': preview,
        }, status=status.HTTP_200_OK)


class MenuConfirmView(APIView):
    """
    Crea en DB el menú revisado/editado por el dueño en el preview.

    POST /api/menu/confirm/   (JSON)
      {
        "store_id": "...",
        "categories": [{"name", "products": [{"name","description","price",
                        "variants": [{"name","price"}]}]}]
      }

    Idempotente con nombres normalizados (sin tildes/puntuación/mayúsculas):
    categorías y productos ya existentes no se duplican.
    """
    permission_classes = [IsAuthenticated]

    MAX_CATEGORIES = 30
    MAX_PRODUCTS = 300

    def post(self, request):
        from decimal import Decimal, InvalidOperation
        from .services.menu_extractor import normalize_product_name

        store_id = request.data.get('store_id')
        store = Store.objects.filter(id=store_id, owner=request.user).first()
        if not store:
            return Response({'error': 'Tienda no encontrada'}, status=status.HTTP_404_NOT_FOUND)

        categories_in = request.data.get('categories') or []
        if not isinstance(categories_in, list) or not categories_in:
            return Response({'error': 'No hay categorías para crear'},
                            status=status.HTTP_400_BAD_REQUEST)
        if len(categories_in) > self.MAX_CATEGORIES:
            return Response({'error': f'Máximo {self.MAX_CATEGORIES} categorías por carga'},
                            status=status.HTTP_400_BAD_REQUEST)
        total_in = sum(len(c.get('products') or []) for c in categories_in)
        if total_in > self.MAX_PRODUCTS:
            return Response({'error': f'Máximo {self.MAX_PRODUCTS} productos por carga'},
                            status=status.HTTP_400_BAD_REQUEST)

        def as_price(value):
            try:
                d = Decimal(str(value if value not in (None, '') else 0))
                return d if d >= 0 else Decimal('0')
            except (InvalidOperation, ValueError):
                return Decimal('0')

        # Categorías existentes indexadas por nombre normalizado (idempotencia
        # real: "PIZZAS" y "Pizzas" son la misma categoría).
        existing_cats = {
            normalize_product_name(c.name): c
            for c in store.categories.all()
        }

        touched_categories = []
        created_products = 0
        skipped_products = 0
        for c_order, cat_in in enumerate(categories_in):
            cat_name = str(cat_in.get('name') or 'Menú').strip()[:100]
            cat_key = normalize_product_name(cat_name)
            category = existing_cats.get(cat_key)
            if not category:
                category = Category.objects.create(
                    store=store, name=cat_name, display_order=c_order)
                existing_cats[cat_key] = category

            existing_names = {
                normalize_product_name(n)
                for n in category.products.values_list('name', flat=True)
            }
            for p_order, prod_in in enumerate(cat_in.get('products') or []):
                name = str(prod_in.get('name') or '').strip()[:200]
                if not name:
                    continue
                key = normalize_product_name(name)
                if key in existing_names:
                    skipped_products += 1
                    continue
                existing_names.add(key)

                base_price = as_price(prod_in.get('price'))
                product = Product.objects.create(
                    category=category,
                    name=name,
                    description=str(prod_in.get('description') or '').strip(),
                    price=base_price,
                    display_order=p_order,
                )
                for v_in in prod_in.get('variants') or []:
                    v_name = str(v_in.get('name') or '').strip()[:100]
                    if not v_name:
                        continue
                    ProductVariant.objects.create(
                        product=product,
                        name=v_name,
                        # El preview edita precios absolutos; el modelo guarda ajuste.
                        price_adjustment=as_price(v_in.get('price')) - base_price,
                    )
                created_products += 1
            touched_categories.append(category)

        data = CategorySerializer(touched_categories, many=True).data
        return Response({
            'success': True,
            'categories_created': len(touched_categories),
            'products_created': created_products,
            'products_skipped': skipped_products,
            'categories': data,
        }, status=status.HTTP_201_CREATED)




class MenuImageView(APIView):
    """
    Menú digital: la imagen que el bot envía cuando piden el menú completo.

    GET  /api/menu/image/?store_id=<uuid>  → estado (url, origen, fecha)
    POST /api/menu/image/                  → regenera desde la DB (render Pillow,
                                             fuerza GENERATED aunque haya UPLOADED)
    """
    permission_classes = [IsAuthenticated]

    def _get_store(self, request):
        store_id = request.query_params.get('store_id') or request.data.get('store_id')
        qs = Store.objects.filter(owner=request.user)
        if store_id:
            qs = qs.filter(id=store_id)
        return qs.first()

    def _payload(self, request, store):
        url = None
        if store.menu_image:
            url = request.build_absolute_uri(store.menu_image.url)
        return {
            'menu_image_url': url,
            'menu_image_source': store.menu_image_source,
            'menu_image_updated_at': store.menu_image_updated_at,
            'menu_has_ai_bg': bool(store.menu_bg_image),
        }

    def get(self, request):
        store = self._get_store(request)
        if not store:
            return Response({'error': 'Tienda no encontrada'}, status=status.HTTP_404_NOT_FOUND)
        return Response(self._payload(request, store))

    def post(self, request):
        from .services.menu_image import update_store_menu_image
        store = self._get_store(request)
        if not store:
            return Response({'error': 'Tienda no encontrada'}, status=status.HTTP_404_NOT_FOUND)
        try:
            updated = update_store_menu_image(store, force=True)
        except Exception:
            logger.error("Error regenerando menú digital", exc_info=True)
            return Response({'error': 'No se pudo generar la imagen del menú'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        if not updated:
            return Response(
                {'error': 'El menú está vacío: crea categorías y productos primero'},
                status=status.HTTP_400_BAD_REQUEST)
        return Response(self._payload(request, store))


class MenuImageUploadView(APIView):
    """
    POST /api/menu/image/upload/ (multipart) — el dueño sube su propio menú
    digital. Se marca UPLOADED: la regeneración automática no lo toca.
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    MAX_MB = 8

    def post(self, request):
        from django.utils import timezone as dj_timezone
        from PIL import Image as PILImage, UnidentifiedImageError

        store_id = request.data.get('store_id')
        qs = Store.objects.filter(owner=request.user)
        if store_id:
            qs = qs.filter(id=store_id)
        store = qs.first()
        if not store:
            return Response({'error': 'Tienda no encontrada'}, status=status.HTTP_404_NOT_FOUND)

        upload = request.FILES.get('image') or request.FILES.get('file')
        if not upload:
            return Response({'error': 'Adjunta la imagen del menú'},
                            status=status.HTTP_400_BAD_REQUEST)
        if upload.size > self.MAX_MB * 1024 * 1024:
            return Response({'error': f'La imagen no puede superar {self.MAX_MB}MB'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            img = PILImage.open(upload)
            img.verify()
        except (UnidentifiedImageError, OSError):
            return Response({'error': 'El archivo no es una imagen válida'},
                            status=status.HTTP_400_BAD_REQUEST)
        upload.seek(0)

        if store.menu_image:
            store.menu_image.delete(save=False)
        ext = (upload.name.rsplit('.', 1)[-1] if '.' in upload.name else 'png').lower()[:5]
        store.menu_image.save(f"menu_{store.id.hex}.{ext}", upload, save=False)
        store.menu_image_source = Store.MenuImageSource.UPLOADED
        store.menu_image_updated_at = dj_timezone.now()
        store.save(update_fields=['menu_image', 'menu_image_source', 'menu_image_updated_at'])

        return Response({
            'menu_image_url': request.build_absolute_uri(store.menu_image.url),
            'menu_image_source': store.menu_image_source,
            'menu_image_updated_at': store.menu_image_updated_at,
        }, status=status.HTTP_201_CREATED)


class MenuBackgroundView(APIView):
    """
    Fondo decorativo del menú digital generado por IA (sin texto).

    POST   /api/menu/image/background/  {store_id, style_hint?} — genera el
           fondo con AI_IMAGE_MODEL, lo cachea y re-renderiza el menú.
    DELETE /api/menu/image/background/  — quita el fondo y re-renderiza plano.

    El texto/precios JAMÁS los genera la IA: solo decoración; el render de
    Pillow compone los datos exactos de la DB encima (con velo de legibilidad).
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'menu_extract'

    def _get_store(self, request):
        store_id = request.data.get('store_id') or request.query_params.get('store_id')
        qs = Store.objects.filter(owner=request.user)
        if store_id:
            qs = qs.filter(id=store_id)
        return qs.first()

    def _payload(self, request, store):
        url = request.build_absolute_uri(store.menu_image.url) if store.menu_image else None
        return {
            'menu_image_url': url,
            'menu_image_source': store.menu_image_source,
            'menu_image_updated_at': store.menu_image_updated_at,
            'menu_has_ai_bg': bool(store.menu_bg_image),
        }

    def post(self, request):
        from .services.menu_image import generate_menu_background, update_store_menu_image
        store = self._get_store(request)
        if not store:
            return Response({'error': 'Tienda no encontrada'}, status=status.HTTP_404_NOT_FOUND)
        style_hint = str(request.data.get('style_hint') or '')[:300]
        try:
            ok = generate_menu_background(store, style_hint=style_hint)
        except Exception:
            logger.error("Error generando fondo IA del menú", exc_info=True)
            ok = False
        if not ok:
            return Response(
                {'error': 'No se pudo generar el fondo con IA. Intenta de nuevo en un momento.'},
                status=status.HTTP_502_BAD_GATEWAY)
        try:
            update_store_menu_image(store, force=True)
        except Exception:
            logger.error("Error re-renderizando menú tras fondo IA", exc_info=True)
        store.refresh_from_db()
        return Response(self._payload(request, store))

    def delete(self, request):
        from .services.menu_image import update_store_menu_image
        store = self._get_store(request)
        if not store:
            return Response({'error': 'Tienda no encontrada'}, status=status.HTTP_404_NOT_FOUND)
        if store.menu_bg_image:
            store.menu_bg_image.delete(save=False)
            store.menu_bg_image = None
            store.save(update_fields=['menu_bg_image'])
            try:
                update_store_menu_image(store, force=True)
            except Exception:
                logger.error("Error re-renderizando menú tras quitar fondo", exc_info=True)
            store.refresh_from_db()
        return Response(self._payload(request, store))
