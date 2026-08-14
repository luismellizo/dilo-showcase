"""
Views para WhatsApp Embedded Signup (v4) y gestión de plantillas.

Endpoints para conectar/desconectar cuentas de WhatsApp Business a través del
flujo de Embedded Signup de Meta, y para administrar las plantillas de mensaje
de la WABA del comercio.

Orden real del onboarding (no se puede saltar ningún paso):
  1. El navegador completa el Embedded Signup y captura, vía session logging,
     el `waba_id` y el `phone_number_id` del cliente + el `code` canjeable.
  2. Canjeamos el code por el business token del cliente.
  3. **Suscribimos nuestra app a los webhooks de esa WABA** — sin esto Meta
     no nos envía NADA de ese comercio.
  4. Registramos el número en Cloud API con un PIN propio de la tienda.
  5. Guardamos las credenciales encriptadas.
"""
import logging

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.db import IntegrityError
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt

from .models import Store, WhatsAppCredentials
from .services.whatsapp_service import (
    MetaAPIError,
    exchange_code_for_token,
    resolve_onboarding_assets,
    subscribe_app_to_waba,
    unsubscribe_app_from_waba,
    list_waba_subscriptions,
    register_phone_number,
    generate_registration_pin,
    list_message_templates,
    create_message_template,
    delete_message_template,
    encrypt_token,
    decrypt_token,
)

logger = logging.getLogger(__name__)


def _get_store_or_none(request, store_id):
    """Tienda del usuario autenticado. Nunca deja tocar tienda ajena."""
    if not store_id:
        return None
    return Store.objects.filter(id=store_id, owner=request.user).first()


def _resolve_credentials(store):
    """Devuelve (credentials, token_desencriptado) o (None, None)."""
    creds = WhatsAppCredentials.objects.filter(store=store, is_active=True).first()
    if not creds or not creds.encrypted_token:
        return None, None
    try:
        return creds, decrypt_token(creds.encrypted_token)
    except Exception as e:
        logger.error(f"No se pudo desencriptar el token de {store}: {e}")
        return creds, None


@method_decorator(csrf_exempt, name='dispatch')
class WhatsAppTokenExchangeView(APIView):
    """
    Completa el onboarding de un comercio tras el Embedded Signup.

    POST /api/whatsapp/token-exchange/

    Body:
    {
        "code": "<code del callback de FB.login>",
        "store_id": "<uuid de la tienda>",
        "waba_id": "<del session logging>",
        "phone_number_id": "<del session logging>",
        "pin": "123456"            // opcional: solo si el número ya tenía 2FA
    }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        code = request.data.get('code')
        store_id = request.data.get('store_id')
        waba_id = (request.data.get('waba_id') or '').strip()
        phone_number_id = (request.data.get('phone_number_id') or '').strip()
        supplied_pin = (request.data.get('pin') or '').strip()

        if not code or not store_id:
            return Response({'error': 'Se requiere code y store_id'},
                            status=status.HTTP_400_BAD_REQUEST)

        if supplied_pin and (not supplied_pin.isdigit() or len(supplied_pin) != 6):
            return Response({'error': 'El PIN debe tener exactamente 6 dígitos'},
                            status=status.HTTP_400_BAD_REQUEST)

        store = _get_store_or_none(request, store_id)
        if not store:
            return Response({'error': 'Tienda no encontrada'},
                            status=status.HTTP_404_NOT_FOUND)

        try:
            # 1. Canjear el code por el business token del cliente
            logger.info(f"🔄 Canjeando code del Embedded Signup para {store.name}")
            token_data = exchange_code_for_token(code)
            access_token = token_data.get('access_token')
            if not access_token:
                return Response({'error': 'Meta no devolvió un token de acceso'},
                                status=status.HTTP_400_BAD_REQUEST)

            # 2. Resolver los activos (los IDs vienen del session logging)
            assets = resolve_onboarding_assets(access_token, waba_id, phone_number_id)

            # 3. Suscribir la app a los webhooks de la WABA — OBLIGATORIO.
            #    Si esto falla, el comercio jamás recibiría un mensaje, así que
            #    se aborta la conexión en vez de dejarla "conectada" pero muda.
            subscribed = subscribe_app_to_waba(assets['waba_id'], access_token)
            if not subscribed:
                return Response(
                    {'error': 'Meta no confirmó la suscripción a los webhooks de tu '
                              'cuenta. Intenta conectar de nuevo.'},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            # 4. Registrar el número en Cloud API con un PIN propio de la tienda
            existing = WhatsAppCredentials.objects.filter(store=store).first()
            pin = supplied_pin
            if not pin and existing and existing.encrypted_pin:
                try:
                    pin = decrypt_token(existing.encrypted_pin)
                except Exception:
                    pin = ''
            if not pin:
                pin = generate_registration_pin()

            registration = register_phone_number(
                assets['phone_number_id'], access_token, pin
            )
            if not registration['ok']:
                # No guardamos credenciales a medias: un número sin registrar
                # no puede enviar mensajes.
                return Response(
                    {'error': registration['message'],
                     'needs_pin': registration['needs_pin']},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # 5. Guardar credenciales encriptadas
            try:
                credentials, created = WhatsAppCredentials.objects.update_or_create(
                    store=store,
                    defaults={
                        'waba_id': assets['waba_id'],
                        'phone_number_id': assets['phone_number_id'],
                        'display_phone_number': assets['display_phone_number'],
                        'verified_name': assets['verified_name'],
                        'encrypted_token': encrypt_token(access_token),
                        'encrypted_pin': encrypt_token(pin),
                        'is_subscribed': True,
                        'is_active': True,
                    }
                )
            except IntegrityError:
                # phone_number_id es unique: ese número ya está en otra tienda.
                return Response(
                    {'error': 'Ese número de WhatsApp ya está conectado a otra '
                              'cuenta de DILO. Desconéctalo allí primero.'},
                    status=status.HTTP_409_CONFLICT,
                )

            action = "conectado" if created else "actualizado"
            logger.info(
                f"✅ WhatsApp {action} para {store.name}: "
                f"{assets['display_phone_number']} (WABA {assets['waba_id']})"
            )

            return Response({
                'success': True,
                'phone_number': credentials.display_phone_number,
                'verified_name': credentials.verified_name,
                'waba_id': credentials.waba_id,
                'subscribed': True,
                'already_registered': registration['already_registered'],
                'message': f'WhatsApp {action} exitosamente',
            })

        except ValueError as e:
            logger.error(f"❌ Error de validación en el onboarding: {e}")
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except MetaAPIError as e:
            logger.error(f"❌ Meta rechazó el onboarding: {e}")
            return Response({'error': f'Meta rechazó la conexión: {e.message}'},
                            status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f"❌ Error inesperado en el onboarding: {e}", exc_info=True)
            return Response({'error': 'Error interno del servidor'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@method_decorator(csrf_exempt, name='dispatch')
class WhatsAppDisconnectView(APIView):
    """
    Desconecta WhatsApp Business de una tienda.

    POST /api/whatsapp/disconnect/  {"store_id": "<uuid>"}

    Además de limpiar el token local, **desuscribe la app de la WABA** para
    que Meta deje de enviarnos los mensajes de un comercio que ya no atendemos.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        store = _get_store_or_none(request, request.data.get('store_id'))
        if not store:
            return Response({'error': 'Se requiere un store_id válido'},
                            status=status.HTTP_400_BAD_REQUEST)

        credentials = WhatsAppCredentials.objects.filter(store=store).first()
        if not credentials:
            return Response({'error': 'No hay WhatsApp conectado a esta tienda'},
                            status=status.HTTP_404_NOT_FOUND)

        phone = credentials.display_phone_number

        # Desuscribir en Meta antes de perder el token (best-effort: si Meta
        # falla no se puede dejar al comercio sin poder desconectarse).
        if credentials.encrypted_token and credentials.waba_id:
            try:
                unsubscribe_app_from_waba(
                    credentials.waba_id, decrypt_token(credentials.encrypted_token)
                )
            except Exception as e:
                logger.warning(f"No se pudo desuscribir la app en Meta: {e}")

        credentials.is_active = False
        credentials.is_subscribed = False
        credentials.encrypted_token = ''
        credentials.save(update_fields=['is_active', 'is_subscribed',
                                        'encrypted_token', 'updated_at'])

        logger.info(f"✅ WhatsApp desconectado para {store.name}: {phone}")
        return Response({'success': True,
                         'message': f'WhatsApp {phone} desconectado exitosamente'})


class WhatsAppStatusView(APIView):
    """
    Estado de conexión de WhatsApp de una tienda.

    GET /api/whatsapp/status/?store_id=<uuid>[&verify=1]

    Con `verify=1` consulta a Meta si la app sigue suscrita a la WABA — el
    diagnóstico que explica el 100% de los "el bot no responde en WhatsApp".
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        store = _get_store_or_none(request, request.query_params.get('store_id'))
        if not store:
            return Response({'error': 'Se requiere un store_id válido'},
                            status=status.HTTP_400_BAD_REQUEST)

        credentials = WhatsAppCredentials.objects.filter(
            store=store, is_active=True
        ).first()
        if not credentials:
            return Response({'connected': False})

        payload = {
            'connected': True,
            'phone_number': credentials.display_phone_number,
            'verified_name': credentials.verified_name,
            'waba_id': credentials.waba_id,
            'subscribed': credentials.is_subscribed,
            'connected_at': credentials.connected_at.isoformat(),
        }

        if request.query_params.get('verify') in ('1', 'true'):
            payload['webhook_verified'] = self._verify_subscription(credentials)

        return Response(payload)

    def _verify_subscription(self, credentials):
        """Confirma contra Meta que la app sigue suscrita. Nunca rompe el GET."""
        try:
            token = decrypt_token(credentials.encrypted_token)
            apps = list_waba_subscriptions(credentials.waba_id, token)
            subscribed = bool(apps)
            if subscribed != credentials.is_subscribed:
                credentials.is_subscribed = subscribed
                credentials.save(update_fields=['is_subscribed', 'updated_at'])
            return subscribed
        except Exception as e:
            logger.warning(f"No se pudo verificar la suscripción de la WABA: {e}")
            return None


@method_decorator(csrf_exempt, name='dispatch')
class WhatsAppTemplatesView(APIView):
    """
    Plantillas de mensaje de la WABA del comercio.

    GET    /api/whatsapp/templates/?store_id=<uuid>   → lista con su estado
    POST   /api/whatsapp/templates/                   → crea una plantilla
    DELETE /api/whatsapp/templates/                   → borra por nombre

    Las plantillas son el único modo de escribirle primero a un cliente fuera
    de la ventana de 24 horas (recompra automática).
    """
    permission_classes = [IsAuthenticated]

    VALID_CATEGORIES = {'MARKETING', 'UTILITY', 'AUTHENTICATION'}

    def get(self, request):
        store = _get_store_or_none(request, request.query_params.get('store_id'))
        if not store:
            return Response({'error': 'Se requiere un store_id válido'},
                            status=status.HTTP_400_BAD_REQUEST)

        credentials, token = _resolve_credentials(store)
        if not token:
            return Response({'error': 'Conecta WhatsApp Business antes de '
                                      'gestionar plantillas'},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            templates = list_message_templates(credentials.waba_id, token)
        except MetaAPIError as e:
            logger.error(f"Error listando plantillas: {e}")
            return Response({'error': e.message}, status=status.HTTP_400_BAD_REQUEST)

        return Response({'templates': templates, 'count': len(templates)})

    def post(self, request):
        store = _get_store_or_none(request, request.data.get('store_id'))
        if not store:
            return Response({'error': 'Se requiere un store_id válido'},
                            status=status.HTTP_400_BAD_REQUEST)

        name = (request.data.get('name') or '').strip().lower()
        category = (request.data.get('category') or 'UTILITY').strip().upper()
        language = (request.data.get('language') or 'es').strip()
        body = (request.data.get('body') or '').strip()
        footer = (request.data.get('footer') or '').strip()
        components = request.data.get('components')

        if not name:
            return Response({'error': 'La plantilla necesita un nombre'},
                            status=status.HTTP_400_BAD_REQUEST)
        # Regla de Meta: solo minúsculas, números y guiones bajos.
        if not all(c.isalnum() and c.isascii() or c == '_' for c in name) or name[0].isdigit():
            return Response(
                {'error': 'El nombre solo admite letras minúsculas, números y '
                          'guiones bajos, y no puede empezar con número'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if category not in self.VALID_CATEGORIES:
            return Response({'error': f'Categoría inválida. Usa una de: '
                                      f'{", ".join(sorted(self.VALID_CATEGORIES))}'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not components and not body:
            return Response({'error': 'La plantilla necesita un cuerpo (body)'},
                            status=status.HTTP_400_BAD_REQUEST)

        if not components:
            components = [{'type': 'BODY', 'text': body}]
            if footer:
                components.append({'type': 'FOOTER', 'text': footer})

        credentials, token = _resolve_credentials(store)
        if not token:
            return Response({'error': 'Conecta WhatsApp Business antes de '
                                      'gestionar plantillas'},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            created = create_message_template(
                credentials.waba_id, token, name, category, language, components
            )
        except MetaAPIError as e:
            logger.error(f"Error creando plantilla '{name}': {e}")
            return Response({'error': e.message}, status=status.HTTP_400_BAD_REQUEST)

        logger.info(f"✅ Plantilla '{name}' creada para {store.name}")
        return Response({'success': True, 'template': created},
                        status=status.HTTP_201_CREATED)

    def delete(self, request):
        store = _get_store_or_none(request, request.data.get('store_id'))
        if not store:
            return Response({'error': 'Se requiere un store_id válido'},
                            status=status.HTTP_400_BAD_REQUEST)

        name = (request.data.get('name') or '').strip()
        if not name:
            return Response({'error': 'Se requiere el nombre de la plantilla'},
                            status=status.HTTP_400_BAD_REQUEST)

        credentials, token = _resolve_credentials(store)
        if not token:
            return Response({'error': 'Conecta WhatsApp Business antes de '
                                      'gestionar plantillas'},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            delete_message_template(credentials.waba_id, token, name)
        except MetaAPIError as e:
            logger.error(f"Error borrando plantilla '{name}': {e}")
            return Response({'error': e.message}, status=status.HTTP_400_BAD_REQUEST)

        return Response({'success': True, 'message': f"Plantilla '{name}' eliminada"})
