"""
Eliminación de datos de usuario.

Cubre los dos caminos que exige Meta para aprobar una app:

1. **Data Deletion Request Callback** — Meta hace POST con un `signed_request`
   firmado con el app secret cuando un usuario elimina la app desde Facebook.
   Hay que responder con una URL de estado y un código de confirmación.
2. **Borrado iniciado por el dueño** — un endpoint autenticado que borra de
   verdad la cuenta y todos sus datos, más una página pública que explica
   cómo hacerlo (`/data-deletion` en el frontend).

Regla del módulo: aquí NUNCA se simula un borrado. Si un dato no se puede
eliminar (obligación contable), se dice explícitamente en la respuesta.
"""
import base64
import hashlib
import hmac
import json
import logging
import uuid

from django.conf import settings
from django.db import transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

from .models import AuditLog, DataDeletionRequest, Store

logger = logging.getLogger(__name__)


def _b64url_decode(segment: str) -> bytes:
    """Decodifica base64url tolerando el padding que Meta omite."""
    padding = '=' * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def parse_signed_request(signed_request: str, app_secret: str) -> dict:
    """
    Valida y decodifica el `signed_request` de Meta.

    Formato: `<firma_base64url>.<payload_base64url>`, donde la firma es
    HMAC-SHA256 del payload **codificado** usando el app secret.

    Returns:
        dict con el payload (incluye `user_id`).

    Raises:
        ValueError si el formato o la firma no son válidos. Nunca se confía
        en un payload sin firma verificada: cualquiera podría pedir el borrado
        de la cuenta de otro.
    """
    if not app_secret:
        raise ValueError("META_APP_SECRET no configurado")
    if not signed_request or '.' not in signed_request:
        raise ValueError("signed_request con formato inválido")

    encoded_sig, encoded_payload = signed_request.split('.', 1)

    try:
        signature = _b64url_decode(encoded_sig)
        payload = json.loads(_b64url_decode(encoded_payload))
    except (ValueError, TypeError, json.JSONDecodeError) as e:
        raise ValueError(f"signed_request ilegible: {e}")

    if payload.get('algorithm', '').upper() != 'HMAC-SHA256':
        raise ValueError(f"Algoritmo no soportado: {payload.get('algorithm')}")

    expected = hmac.new(
        app_secret.encode(), encoded_payload.encode(), hashlib.sha256
    ).digest()

    if not hmac.compare_digest(signature, expected):
        raise ValueError("Firma del signed_request inválida")

    return payload


def purge_store_data(store):
    """
    Borra TODOS los datos de una tienda y su dueño.

    El cascade de Django arrastra categorías, productos, clientes, pedidos,
    items, mensajes, credenciales y suscripción. Se hace en una transacción:
    o se borra todo o no se borra nada.

    Returns:
        dict con el conteo de lo eliminado (para la bitácora).
    """
    from .models import Customer, Message, Order

    counts = {
        'orders': Order.objects.filter(store=store).count(),
        'customers': Customer.objects.filter(store=store).count(),
        'messages': Message.objects.filter(order__store=store).count(),
    }

    owner = store.owner
    with transaction.atomic():
        store.delete()   # cascade: todo lo del comercio
        owner.delete()   # la cuenta de acceso
    return counts


@method_decorator(csrf_exempt, name='dispatch')
class MetaDataDeletionCallbackView(APIView):
    """
    Callback de solicitud de eliminación de datos de Meta.

    POST /api/meta/data-deletion/
    Body (form-encoded): signed_request=<firma>.<payload>

    Respuesta esperada por Meta:
    {"url": "<url de estado>", "confirmation_code": "<código>"}
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        signed_request = request.data.get('signed_request') or request.POST.get('signed_request')

        try:
            payload = parse_signed_request(signed_request, settings.META_APP_SECRET)
        except ValueError as e:
            logger.error(f"🚨 signed_request rechazado en data deletion: {e}")
            return Response({'error': 'signed_request inválido'},
                            status=status.HTTP_400_BAD_REQUEST)

        facebook_user_id = str(payload.get('user_id', '')).strip()
        if not facebook_user_id:
            return Response({'error': 'signed_request sin user_id'},
                            status=status.HTTP_400_BAD_REQUEST)

        confirmation_code = uuid.uuid4().hex[:16]
        deletion = DataDeletionRequest.objects.create(
            confirmation_code=confirmation_code,
            facebook_user_id=facebook_user_id,
            source=DataDeletionRequest.Source.META_CALLBACK,
            status=DataDeletionRequest.Status.RECEIVED,
        )

        logger.info(
            f"📥 Solicitud de eliminación de datos de Meta para el usuario "
            f"{facebook_user_id} — código {confirmation_code}"
        )

        base = (settings.FRONTEND_URL or '').rstrip('/')
        return Response({
            'url': f"{base}/data-deletion?code={deletion.confirmation_code}",
            'confirmation_code': deletion.confirmation_code,
        })


class DataDeletionStatusView(APIView):
    """
    Estado de una solicitud de eliminación.

    GET /api/meta/data-deletion/status/?code=<confirmation_code>

    Público a propósito: es la URL que Meta le muestra al usuario y no
    requiere sesión. Solo devuelve el estado, jamás datos personales.
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        code = (request.query_params.get('code') or '').strip()
        if not code:
            return Response({'error': 'Se requiere el código de confirmación'},
                            status=status.HTTP_400_BAD_REQUEST)

        deletion = DataDeletionRequest.objects.filter(confirmation_code=code).first()
        if not deletion:
            return Response({'error': 'Código de confirmación no encontrado'},
                            status=status.HTTP_404_NOT_FOUND)

        return Response({
            'confirmation_code': deletion.confirmation_code,
            'status': deletion.status,
            'status_display': deletion.get_status_display(),
            'requested_at': deletion.created_at.isoformat(),
            'completed_at': deletion.completed_at.isoformat() if deletion.completed_at else None,
        })


class DeleteMyAccountView(APIView):
    """
    Borrado de cuenta iniciado por el dueño del negocio.

    POST /api/auth/delete-account/  {"confirm": "ELIMINAR"}

    Borra la tienda, su menú, sus clientes, sus pedidos, sus mensajes y la
    cuenta de acceso. Es irreversible y así se le advierte en el frontend.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if (request.data.get('confirm') or '').strip().upper() != 'ELIMINAR':
            return Response(
                {'error': 'Para confirmar el borrado escribe ELIMINAR'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        store = Store.objects.filter(owner=user).first()
        email = user.email or user.username

        confirmation_code = uuid.uuid4().hex[:16]
        deletion = DataDeletionRequest.objects.create(
            confirmation_code=confirmation_code,
            requester_email=email,
            source=DataDeletionRequest.Source.USER_REQUEST,
            status=DataDeletionRequest.Status.RECEIVED,
        )

        # Bitácora ANTES de borrar: después el usuario ya no existe.
        try:
            AuditLog.objects.create(
                actor=None,
                actor_email=email,
                action=AuditLog.Action.ACCOUNT_DELETION,
                store=None,
                target=f"account_deletion:{email}",
                diff={'confirmation_code': confirmation_code,
                      'store_id': str(store.id) if store else None},
            )
        except Exception as e:
            logger.warning(f"No se pudo escribir la bitácora del borrado: {e}")

        try:
            if store:
                counts = purge_store_data(store)
            else:
                counts = {}
                user.delete()
        except Exception as e:
            logger.error(f"❌ Falló el borrado de la cuenta {email}: {e}", exc_info=True)
            deletion.status = DataDeletionRequest.Status.FAILED
            deletion.save(update_fields=['status'])
            return Response({'error': 'No se pudo completar el borrado. '
                                      'Escríbenos y lo hacemos manualmente.'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        deletion.mark_completed()
        logger.info(f"🗑️ Cuenta {email} eliminada por completo: {counts}")

        return Response({
            'success': True,
            'confirmation_code': confirmation_code,
            'deleted': counts,
            'message': 'Tu cuenta y todos tus datos fueron eliminados.',
        })
