"""
WhatsApp Embedded Signup Service.

Maneja la integración con Meta Graph API para el flujo de Embedded Signup.
Incluye:
- Encriptación/desencriptación de tokens
- Intercambio de code por System User Access Token (SUAT)
- Obtención de información del número de WhatsApp
"""
import logging
import os
import secrets
import requests
from django.conf import settings
from cryptography.fernet import Fernet
import base64
import hashlib

logger = logging.getLogger(__name__)

# ============================================
# CONFIGURACIÓN DE ENCRIPTACIÓN
# ============================================

def _get_encryption_key():
    """
    Genera una clave de encriptación derivada de SECRET_KEY.
    
    Esto permite encriptar tokens sin necesidad de manejar 
    una clave adicional de Fernet.
    """
    # Usar los primeros 32 bytes del hash de SECRET_KEY
    key = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return base64.urlsafe_b64encode(key)


def encrypt_token(token: str) -> str:
    """
    Encripta un token antes de guardarlo en la base de datos.
    
    Args:
        token: El System User Access Token en texto plano
        
    Returns:
        Token encriptado como string base64
    """
    try:
        f = Fernet(_get_encryption_key())
        encrypted = f.encrypt(token.encode())
        return encrypted.decode()
    except Exception as e:
        logger.error(f"Error encriptando token: {e}")
        raise


def decrypt_token(encrypted_token: str) -> str:
    """
    Desencripta un token almacenado en la base de datos.
    
    Args:
        encrypted_token: Token encriptado como string base64
        
    Returns:
        Token desencriptado en texto plano
    """
    try:
        f = Fernet(_get_encryption_key())
        decrypted = f.decrypt(encrypted_token.encode())
        return decrypted.decode()
    except Exception as e:
        logger.error(f"Error desencriptando token: {e}")
        raise


# ============================================
# META GRAPH API
# ============================================

# Versión de la Graph API. Meta soporta cada versión ~2 años; v18.0 (sep-2023)
# quedó fuera de soporte. La doc vigente de Embedded Signup v4 recomienda usar
# la última. Overridable por env para poder fijarla sin tocar código.
META_GRAPH_API_VERSION = os.getenv('META_GRAPH_API_VERSION', 'v23.0')
META_GRAPH_API_BASE = f"https://graph.facebook.com/{META_GRAPH_API_VERSION}"


class MetaAPIError(Exception):
    """Error devuelto por la Graph API de Meta, con su código real.

    Se necesita el código (no solo el mensaje) para distinguir errores
    recuperables (PIN equivocado, número ya registrado) de fallos duros.
    """

    def __init__(self, message, code=None, subcode=None, http_status=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.subcode = subcode
        self.http_status = http_status

    def __str__(self):
        return f"[{self.code}/{self.subcode}] {self.message}"


def _raise_for_meta_error(response):
    """Convierte una respuesta de Graph con `error` en MetaAPIError.

    Devuelve el JSON parseado si no hay error.
    """
    try:
        data = response.json()
    except ValueError:
        raise MetaAPIError(
            f"Respuesta no-JSON de Meta (HTTP {response.status_code})",
            http_status=response.status_code,
        )

    if isinstance(data, dict) and 'error' in data:
        err = data['error'] or {}
        raise MetaAPIError(
            err.get('message', 'Error desconocido de Meta'),
            code=err.get('code'),
            subcode=err.get('error_subcode'),
            http_status=response.status_code,
        )
    return data


def _graph_get(path: str, access_token: str, params: dict | None = None, timeout: int = 30):
    response = requests.get(
        f"{META_GRAPH_API_BASE}/{path}",
        headers={'Authorization': f'Bearer {access_token}'},
        params=params or {},
        timeout=timeout,
    )
    return _raise_for_meta_error(response)


def _graph_post(path: str, access_token: str, payload: dict | None = None, timeout: int = 30):
    response = requests.post(
        f"{META_GRAPH_API_BASE}/{path}",
        headers={'Authorization': f'Bearer {access_token}'},
        json=payload or {},
        timeout=timeout,
    )
    return _raise_for_meta_error(response)


def _graph_delete(path: str, access_token: str, params: dict | None = None, timeout: int = 30):
    response = requests.delete(
        f"{META_GRAPH_API_BASE}/{path}",
        headers={'Authorization': f'Bearer {access_token}'},
        params=params or {},
        timeout=timeout,
    )
    return _raise_for_meta_error(response)


def exchange_code_for_token(code: str) -> dict:
    """
    Intercambia el authorization code del Embedded Signup por un business token.

    En Embedded Signup v4 el código lo devuelve `FB.login` (response_type=code)
    y se canjea server-to-server. El token resultante es un
    *business integration system user access token* del cliente comercial: no
    expira mientras el cliente no revoque el acceso a la app.

    Args:
        code: Authorization code recibido del callback del SDK

    Returns:
        dict con access_token y metadata

    Raises:
        ValueError: si falta configuración de la app
        MetaAPIError: si Meta responde con error
    """
    app_id = getattr(settings, 'META_APP_ID', None)
    app_secret = getattr(settings, 'META_APP_SECRET', None)

    if not app_id or not app_secret:
        raise ValueError("META_APP_ID y META_APP_SECRET deben estar configurados en settings")

    response = requests.get(
        f"{META_GRAPH_API_BASE}/oauth/access_token",
        params={'client_id': app_id, 'client_secret': app_secret, 'code': code},
        timeout=30,
    )
    data = _raise_for_meta_error(response)
    logger.info("✅ Token de negocio obtenido del Embedded Signup")
    return data


def subscribe_app_to_waba(waba_id: str, access_token: str) -> bool:
    """
    Suscribe NUESTRA app a los webhooks de la WABA del cliente.

    PASO OBLIGATORIO del onboarding. Sin él, Meta nunca envía a nuestro
    callback los mensajes que reciben los números de ese cliente: el bot
    queda mudo para ese comercio aunque todo lo demás esté bien.

    Docs: POST /{waba-id}/subscribed_apps

    Returns:
        True si quedó suscrita.

    Raises:
        MetaAPIError si Meta rechaza la suscripción (es un fallo duro:
        sin webhooks el comercio no puede operar).
    """
    data = _graph_post(f"{waba_id}/subscribed_apps", access_token)
    ok = bool(data.get('success', True))
    if ok:
        logger.info(f"✅ App suscrita a webhooks de WABA {waba_id}")
    else:
        logger.error(f"❌ Meta no confirmó la suscripción a WABA {waba_id}: {data}")
    return ok


def unsubscribe_app_from_waba(waba_id: str, access_token: str) -> bool:
    """
    Quita la suscripción de nuestra app a los webhooks de la WABA.

    Se llama al desconectar un comercio: deja de mandarnos sus mensajes en vez
    de que sigan llegando a un webhook que ya no los va a atender.
    Nunca revienta la desconexión — si Meta falla, se registra y se sigue.
    """
    try:
        _graph_delete(f"{waba_id}/subscribed_apps", access_token)
        logger.info(f"✅ App desuscrita de webhooks de WABA {waba_id}")
        return True
    except (MetaAPIError, requests.RequestException) as e:
        logger.warning(f"⚠️ No se pudo desuscribir la app de WABA {waba_id}: {e}")
        return False


def list_waba_subscriptions(waba_id: str, access_token: str) -> list:
    """Lista las apps suscritas a la WABA (para verificar el onboarding)."""
    data = _graph_get(f"{waba_id}/subscribed_apps", access_token)
    return data.get('data', [])


def get_waba_phone_numbers(waba_id: str, access_token: str) -> list:
    """
    Lista los números de teléfono de una WABA.

    Fallback cuando el session logging no entregó el phone_number_id (ej.
    el cliente completó el flujo sin agregar número y lo agregó después).
    """
    data = _graph_get(
        f"{waba_id}/phone_numbers",
        access_token,
        params={'fields': 'id,display_phone_number,verified_name,'
                          'code_verification_status,quality_rating,platform_type'},
    )
    return data.get('data', [])


def get_phone_number_details(phone_number_id: str, access_token: str) -> dict:
    """Detalle de un número de negocio (incluye si ya está en Cloud API)."""
    return _graph_get(
        phone_number_id,
        access_token,
        params={'fields': 'id,display_phone_number,verified_name,'
                          'code_verification_status,quality_rating,platform_type'},
    )


def resolve_onboarding_assets(access_token: str, waba_id: str = '',
                              phone_number_id: str = '') -> dict:
    """
    Resuelve los datos de la WABA/número que se van a guardar.

    Los IDs correctos vienen del **session logging** del Embedded Signup
    (evento `WA_EMBEDDED_SIGNUP` en el navegador). Esta función NO los
    adivina: los completa. Solo si el frontend no mandó `phone_number_id`
    se consulta `/{waba-id}/phone_numbers` para tomar el primero.

    Args:
        access_token: business token del cliente
        waba_id: id de la WABA (del session logging) — obligatorio
        phone_number_id: id del número (del session logging) — opcional

    Returns:
        dict con waba_id, phone_number_id, display_phone_number, verified_name,
        platform_type, code_verification_status

    Raises:
        ValueError si no hay waba_id o la WABA no tiene números.
    """
    if not waba_id:
        raise ValueError(
            "No se recibió el identificador de la cuenta de WhatsApp Business. "
            "Vuelve a intentar la conexión desde el botón."
        )

    if phone_number_id:
        phone = get_phone_number_details(phone_number_id, access_token)
    else:
        numbers = get_waba_phone_numbers(waba_id, access_token)
        if not numbers:
            raise ValueError(
                "Tu cuenta de WhatsApp Business no tiene ningún número agregado. "
                "Agrega y verifica un número y vuelve a conectar."
            )
        phone = numbers[0]

    return {
        'waba_id': waba_id,
        'phone_number_id': phone['id'],
        'display_phone_number': phone.get('display_phone_number', ''),
        'verified_name': phone.get('verified_name', ''),
        'platform_type': phone.get('platform_type', ''),
        'code_verification_status': phone.get('code_verification_status', ''),
    }


def resolve_store_sender(store):
    """
    Resuelve las credenciales de envío de WhatsApp para una tienda.

    Devuelve (phone_number_id, access_token). Usa las credenciales encriptadas
    por tienda (WhatsAppCredentials); si no existen (ej. dev de una sola tienda),
    cae a las credenciales globales de settings.

    Args:
        store: instancia de Store

    OJO — el fallback global SOLO aplica si la tienda nunca conectó WhatsApp.
    Si tiene credenciales propias pero están inactivas o ilegibles se devuelve
    (None, None): caer al número global significaría responderle al cliente de
    ESE comercio desde el número de otro (o desde el de DILO), que es una
    suplantación de identidad ante el cliente final y una violación de las
    políticas de Meta.

    Returns:
        tuple (phone_number_id, token) o (None, None) si no hay credenciales.
    """
    creds = getattr(store, 'whatsapp_credentials', None)
    if creds:
        if not creds.is_active or not creds.encrypted_token:
            logger.warning(
                f"WhatsApp desconectado para {store} — no se envía "
                f"(jamás caer al número global de otra identidad)"
            )
            return None, None
        try:
            return creds.phone_number_id, decrypt_token(creds.encrypted_token)
        except Exception as e:
            logger.error(f"No se pudo desencriptar token de {store}: {e}")
            return None, None

    # Fallback global: solo para el entorno de una sola tienda (dev / instalación
    # propia), donde no existe fila de credenciales por tienda.
    return settings.WHATSAPP_PHONE_NUMBER_ID, settings.WHATSAPP_API_TOKEN


def send_text_message(phone_number_id: str, access_token: str, to: str, text: str) -> dict:
    """
    Envía un mensaje de texto vía Cloud API usando credenciales explícitas.

    Args:
        phone_number_id: Phone Number ID emisor (de la tienda)
        access_token: token de acceso de la tienda
        to: número destino del cliente
        text: cuerpo del mensaje

    Returns:
        dict con la respuesta de la API.

    Raises:
        requests.RequestException si el envío falla (para que Celery reintente).
    """
    if not phone_number_id or not access_token:
        raise ValueError("Faltan credenciales de WhatsApp (phone_number_id/token)")

    url = f"{META_GRAPH_API_BASE}/{phone_number_id}/messages"
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
    }
    data = {
        'messaging_product': 'whatsapp',
        'to': to,
        'type': 'text',
        'text': {'body': text}
    }
    response = requests.post(url, headers=headers, json=data, timeout=10)
    response.raise_for_status()
    return response.json()


def send_image_message(phone_number_id: str, access_token: str, to: str,
                       image_path: str, caption: str = '') -> dict:
    """
    Envía una imagen vía Cloud API subiendo el archivo local.

    Dos pasos: 1) sube la imagen a /{phone_number_id}/media (multipart),
    2) envía el mensaje type=image referenciando el media_id. Se sube el
    archivo (no se pasa link) para no depender de que MEDIA_URL sea
    públicamente accesible.

    Raises:
        requests.RequestException si el envío falla (para que Celery reintente).
    """
    if not phone_number_id or not access_token:
        raise ValueError("Faltan credenciales de WhatsApp (phone_number_id/token)")

    headers = {'Authorization': f'Bearer {access_token}'}

    # 1) Subir la imagen
    upload_url = f"{META_GRAPH_API_BASE}/{phone_number_id}/media"
    with open(image_path, 'rb') as f:
        response = requests.post(
            upload_url, headers=headers,
            data={'messaging_product': 'whatsapp', 'type': 'image/png'},
            files={'file': (os.path.basename(image_path), f, 'image/png')},
            timeout=30,
        )
    response.raise_for_status()
    media_id = response.json().get('id')

    # 2) Enviar el mensaje con la imagen
    url = f"{META_GRAPH_API_BASE}/{phone_number_id}/messages"
    image_payload = {'id': media_id}
    if caption:
        image_payload['caption'] = caption[:1024]
    data = {
        'messaging_product': 'whatsapp',
        'to': to,
        'type': 'image',
        'image': image_payload,
    }
    response = requests.post(url, headers=headers, json=data, timeout=10)
    response.raise_for_status()
    return response.json()


def generate_registration_pin() -> str:
    """
    Genera el PIN de verificación en dos pasos del número (6 dígitos).

    Se genera uno por tienda y se guarda encriptado. Nunca usar un PIN fijo:
    es la segunda credencial del número del comercio y un valor compartido
    entre todos los clientes es una llave maestra.
    """
    return f"{secrets.randbelow(1000000):06d}"


# Códigos de error de registro de la Cloud API que significan
# "el número ya está operativo" — no son fallo.
_ALREADY_REGISTERED_CODES = {
    # Meta responde con estos cuando el número ya está en Cloud API con
    # verificación en dos pasos activa y el PIN enviado no aplica.
    133005,  # Two-step verification PIN mismatch
    133008,  # Demasiados intentos de PIN
    133009,  # Intentos de PIN demasiado rápidos
}


def register_phone_number(phone_number_id: str, access_token: str, pin: str) -> dict:
    """
    Registra el número del cliente en la Cloud API.

    Paso obligatorio para poder enviar mensajes con ese número.

    NO se traga los errores: devuelve un resultado estructurado para que la
    vista pueda decirle al comercio exactamente qué pasó (ej. "ya tenías
    verificación en dos pasos: escribe tu PIN").

    Args:
        phone_number_id: ID del número a registrar
        access_token: business token del cliente
        pin: PIN de 6 dígitos de verificación en dos pasos

    Returns:
        dict {'ok': bool, 'already_registered': bool, 'needs_pin': bool,
              'code': int|None, 'message': str}
    """
    try:
        _graph_post(
            f"{phone_number_id}/register",
            access_token,
            {'messaging_product': 'whatsapp', 'pin': pin},
        )
        logger.info(f"✅ Número {phone_number_id} registrado en Cloud API")
        return {'ok': True, 'already_registered': False, 'needs_pin': False,
                'code': None, 'message': 'Número registrado'}

    except MetaAPIError as e:
        # El número puede estar YA registrado y operativo: se confirma
        # consultando su platform_type en vez de asumirlo por el código.
        try:
            details = get_phone_number_details(phone_number_id, access_token)
            if details.get('platform_type') == 'CLOUD_API':
                logger.info(f"ℹ️ Número {phone_number_id} ya estaba en Cloud API")
                return {'ok': True, 'already_registered': True, 'needs_pin': False,
                        'code': e.code, 'message': 'El número ya estaba registrado'}
        except (MetaAPIError, requests.RequestException) as probe_error:
            logger.warning(f"No se pudo verificar el estado del número: {probe_error}")

        needs_pin = e.code in _ALREADY_REGISTERED_CODES
        logger.warning(f"⚠️ Registro de {phone_number_id} falló: {e}")
        message = (
            "Ese número ya tiene verificación en dos pasos activa. "
            "Escribe el PIN de 6 dígitos que configuraste para conectarlo."
            if needs_pin else e.message
        )
        return {'ok': False, 'already_registered': False, 'needs_pin': needs_pin,
                'code': e.code, 'message': message}

    except requests.RequestException as e:
        logger.error(f"Error de red registrando número: {e}")
        return {'ok': False, 'already_registered': False, 'needs_pin': False,
                'code': None, 'message': 'No se pudo contactar a Meta. Intenta de nuevo.'}


# ============================================
# PLANTILLAS DE MENSAJE (whatsapp_business_management)
# ============================================

def list_message_templates(waba_id: str, access_token: str, limit: int = 50) -> list:
    """
    Lista las plantillas de mensaje de la WABA del cliente.

    Las plantillas son obligatorias para escribirle primero a un cliente
    fuera de la ventana de 24 horas (recompra / win-back).
    """
    data = _graph_get(
        f"{waba_id}/message_templates",
        access_token,
        params={'fields': 'id,name,status,category,language,components,'
                          'quality_score,rejected_reason',
                'limit': limit},
    )
    return data.get('data', [])


def create_message_template(waba_id: str, access_token: str, name: str,
                            category: str, language: str, components: list) -> dict:
    """
    Crea una plantilla de mensaje en la WABA del cliente.

    Args:
        name: minúsculas, números y guiones bajos (regla de Meta)
        category: MARKETING | UTILITY | AUTHENTICATION
        language: código de idioma (ej. es, es_MX, en_US)
        components: lista de componentes (HEADER/BODY/FOOTER/BUTTONS)

    Returns:
        dict con id, status y category de la plantilla creada.
    """
    return _graph_post(
        f"{waba_id}/message_templates",
        access_token,
        {'name': name, 'category': category, 'language': language,
         'components': components},
    )


def delete_message_template(waba_id: str, access_token: str, name: str) -> bool:
    """Borra una plantilla por nombre (borra todos sus idiomas)."""
    _graph_delete(f"{waba_id}/message_templates", access_token, params={'name': name})
    logger.info(f"🗑️ Plantilla '{name}' eliminada de WABA {waba_id}")
    return True


def send_template_message(phone_number_id: str, access_token: str, to: str,
                          template_name: str, language: str = 'es',
                          components: list | None = None) -> dict:
    """
    Envía un mensaje de plantilla (único modo permitido fuera de la ventana 24h).

    Raises:
        requests.RequestException si el envío falla (para que Celery reintente).
    """
    if not phone_number_id or not access_token:
        raise ValueError("Faltan credenciales de WhatsApp (phone_number_id/token)")

    template = {'name': template_name, 'language': {'code': language}}
    if components:
        template['components'] = components

    response = requests.post(
        f"{META_GRAPH_API_BASE}/{phone_number_id}/messages",
        headers={'Authorization': f'Bearer {access_token}',
                 'Content-Type': 'application/json'},
        json={'messaging_product': 'whatsapp', 'to': to,
              'type': 'template', 'template': template},
        timeout=10,
    )
    response.raise_for_status()
    return response.json()
