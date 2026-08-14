"""
Servicio de generación de links de pago.
Usa Factory Pattern para soportar múltiples proveedores (Wompi, Bold, etc.)
"""

import hashlib
import hmac
import logging
from decimal import Decimal
from typing import Optional, Dict
from urllib.parse import urlencode

from django.conf import settings

logger = logging.getLogger(__name__)


def generate_payment_link(order) -> Optional[str]:
    """
    Genera un link de pago para la orden usando las credenciales de la tienda.
    
    Args:
        order: Instancia de Order
        
    Returns:
        URL del link de pago, o None si es método manual
    """
    try:
        # Obtener configuración de pago de la tienda
        payment_config = getattr(order.store, 'payment_config', None)
        
        if not payment_config or not payment_config.is_active:
            logger.info(f"Pago manual para orden {order.id}")
            return None
        
        # Factory pattern: delegar a proveedor específico
        if payment_config.provider == 'WOMPI':
            return _generate_wompi_link(order, payment_config)
        elif payment_config.provider == 'BOLD':
            return _generate_bold_link(order, payment_config)
        else:  # NEQUI_MANUAL
            return None
            
    except Exception as e:
        logger.error(f"Error generando link de pago para {order.id}: {e}", exc_info=True)
        return None


def _generate_wompi_link(order, payment_config) -> Optional[str]:
    """
    Genera link del Web Checkout de Wompi.

    El Web Checkout NO es una API que devuelva un `permalink` via POST — es una
    URL GET con query params + una firma de integridad (`signature:integrity`).
    Documentación: https://docs.wompi.co/docs/en/widget-checkout-web
    """
    try:
        # Construir referencia única: ORD-{store_id}-{order_id}
        reference = f"ORD-{order.store.id}-{order.id}"

        # Convertir total a centavos (Wompi usa centavos)
        amount_in_cents = int(order.total_amount * 100)
        currency = "COP"

        # URL de retorno (configurable desde settings)
        redirect_url = f"{settings.FRONTEND_URL}/order/{order.id}/success"

        # Firma de integridad: SHA256(reference + amount_in_cents + currency + integrity_secret)
        integrity_secret = payment_config.integrity_secret or ''
        integrity_string = f"{reference}{amount_in_cents}{currency}{integrity_secret}"
        signature = hashlib.sha256(integrity_string.encode()).hexdigest()

        params = {
            "public-key": payment_config.public_key,
            "currency": currency,
            "amount-in-cents": amount_in_cents,
            "reference": reference,
            "signature:integrity": signature,
            "redirect-url": redirect_url,
        }

        payment_link = f"https://checkout.wompi.co/p/?{urlencode(params)}"
        logger.info(f"✅ Link Wompi generado para orden {order.id}")
        return payment_link

    except Exception as e:
        logger.error(f"Excepción generando Wompi link: {e}", exc_info=True)
        return None


def _generate_bold_link(order, payment_config) -> Optional[str]:
    """
    Genera link de pago usando API de Bold.
    
    TODO: Implementar según documentación de Bold
    """
    logger.warning("Integración con Bold pendiente de implementar")
    return None


def validate_wompi_signature(data: Dict, integrity_secret: str) -> bool:
    """
    Valida la firma de integridad de un webhook de Wompi.
    
    Args:
        data: Diccionario con los datos del webhook
        integrity_secret: Secret de integridad de la tienda
        
    Returns:
        True si la firma es válida
    """
    try:
        # Wompi envía checksum en los eventos
        received_checksum = data.get('signature', {}).get('checksum', '')
        
        if not received_checksum:
            logger.warning("Webhook sin checksum")
            return False
        
        # Construir string de verificación según docs de Wompi
        # Formato: {evento.data.transaction.id}{evento.data.transaction.status}{evento.data.transaction.amount_in_cents}{integrity_secret}
        transaction = data.get('data', {}).get('transaction', {})
        
        verification_string = (
            f"{transaction.get('id')}"
            f"{transaction.get('status')}"
            f"{transaction.get('amount_in_cents')}"
            f"{integrity_secret}"
        )
        
        # Calcular checksum esperado
        expected_checksum = hashlib.sha256(verification_string.encode()).hexdigest()
        
        # Comparación segura (evita timing attack)
        is_valid = hmac.compare_digest(expected_checksum, received_checksum)
        
        if not is_valid:
            logger.warning(f"Checksum inválido. Esperado: {expected_checksum}, Recibido: {received_checksum}")
        
        return is_valid
        
    except Exception as e:
        logger.error(f"Error validando firma Wompi: {e}", exc_info=True)
        return False
