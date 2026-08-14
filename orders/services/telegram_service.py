import logging
import json
import requests
from typing import List, Dict, Optional
from django.conf import settings

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org/bot"


def resolve_store_token(store) -> Optional[str]:
    """
    Resuelve el token del bot de Telegram para una tienda (multi-tienda).

    Usa TelegramCredentials (token encriptado por tienda); si no existe,
    cae al token global de settings (entorno de una sola tienda).
    """
    creds = getattr(store, 'telegram_credentials', None)
    if creds and creds.is_active:
        try:
            from .whatsapp_service import decrypt_token
            return decrypt_token(creds.encrypted_bot_token)
        except Exception as e:
            logger.error(f"No se pudo desencriptar token Telegram de {store}: {e}")
    return getattr(settings, 'TELEGRAM_BOT_TOKEN', None)


def _token(token: Optional[str]) -> Optional[str]:
    """Devuelve el token dado o el global de settings como fallback."""
    return token or getattr(settings, 'TELEGRAM_BOT_TOKEN', None)


def _strip_markdown(text: str) -> str:
    """Quita marcas Markdown para envío en texto plano (fallback ante 400)."""
    import re
    if not text:
        return ""
    # **negrita** / *itálica* / __sub__ / _it_ / `code` → texto pelado
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    text = re.sub(r'__([^_]+)__', r'\1', text)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    # [texto](url) → texto (url)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1 (\2)', text)
    return text


def send_telegram_message(chat_id: str, text: str, buttons: Optional[List[List[Dict]]] = None,
                          token: Optional[str] = None) -> dict:
    """
    Envía un mensaje de texto a un chat de Telegram, opcionalmente con botones inline.
    
    Args:
        chat_id: ID del chat de Telegram (usuario)
        text: Texto del mensaje
        buttons: Lista de filas de botones. Cada fila es una lista de dicts con:
                 - text: Texto del botón
                 - callback_data: Datos que se envían al hacer click
                 
    Example buttons:
        [
            [{"text": "✅ Confirmar", "callback_data": "confirm_order"}],
            [{"text": "➕ Agregar más", "callback_data": "add_more"}, {"text": "❌ Cancelar", "callback_data": "cancel"}]
        ]
        
    Returns:
        dict: Respuesta de la API de Telegram
    """
    token = _token(token)
    if not token:
        logger.error("Token de Telegram no disponible (ni por tienda ni global)")
        return None

    url = f"{TELEGRAM_API_BASE}{token}/sendMessage"
    data = {
        'chat_id': chat_id,
        'text': text,
        'parse_mode': 'Markdown'
    }

    # Agregar botones inline si se proporcionan
    if buttons:
        data['reply_markup'] = json.dumps({
            'inline_keyboard': buttons
        })

    try:
        response = requests.post(url, json=data, timeout=10)
        # Telegram devuelve 400 si el Markdown viene mal formado (ej: '**'
        # estándar que el parser 'Markdown' legacy no entiende, o '_'/'[' sueltos
        # del LLM). En ese caso NO perdemos el mensaje: reenviamos en texto plano.
        if response.status_code == 400:
            logger.warning(
                f"Telegram 400 con Markdown ({chat_id}): {response.text[:200]}. "
                "Reintentando en texto plano.")
            data.pop('parse_mode', None)
            data['text'] = _strip_markdown(text)
            response = requests.post(url, json=data, timeout=10)
        response.raise_for_status()
        logger.info(f"📤 Mensaje enviado a Telegram {chat_id}" + (" con botones" if buttons else ""))
        return response.json()
    except requests.RequestException as e:
        logger.error(f"Error enviando mensaje a Telegram {chat_id}: {e}")
        return None


def send_telegram_photo(chat_id: str, photo_path: str, caption: str = '',
                        token: Optional[str] = None) -> Optional[dict]:
    """
    Envía una foto a un chat de Telegram subiendo el archivo local (multipart).

    Se sube el archivo en vez de pasar URL para no depender de que MEDIA sea
    público (en dev el túnel puede estar caído y Telegram no podría descargarla).

    Args:
        chat_id: ID del chat de Telegram
        photo_path: Ruta local del archivo de imagen
        caption: Texto opcional que acompaña la foto (texto plano)
        token: Token del bot de la tienda. None → token global.

    Returns:
        dict: Respuesta de la API de Telegram, o None si falló
    """
    token = _token(token)
    if not token:
        logger.error("Token de Telegram no disponible (ni por tienda ni global)")
        return None

    url = f"{TELEGRAM_API_BASE}{token}/sendPhoto"
    data = {'chat_id': chat_id}
    if caption:
        data['caption'] = caption[:1024]  # límite de Telegram
    try:
        with open(photo_path, 'rb') as f:
            response = requests.post(url, data=data, files={'photo': f}, timeout=30)
        response.raise_for_status()
        logger.info(f"📤 Foto enviada a Telegram {chat_id}")
        return response.json()
    except (requests.RequestException, OSError) as e:
        logger.error(f"Error enviando foto a Telegram {chat_id}: {e}")
        return None


def answer_callback_query(callback_query_id: str, text: str = None, show_alert: bool = False,
                          token: Optional[str] = None) -> dict:
    """
    Responde a un callback query (click en botón inline).
    
    Args:
        callback_query_id: ID del callback query
        text: Texto opcional para mostrar como notificación
        show_alert: Si True, muestra un alert en vez de notificación
        
    Returns:
        dict: Respuesta de la API
    """
    token = _token(token)
    if not token:
        return None

    url = f"{TELEGRAM_API_BASE}{token}/answerCallbackQuery"
    data = {
        'callback_query_id': callback_query_id
    }
    
    if text:
        data['text'] = text
        data['show_alert'] = show_alert
    
    try:
        response = requests.post(url, json=data, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        logger.error(f"Error respondiendo callback query: {e}")
        return None


def edit_message_remove_buttons(chat_id: str, message_id: int, token: Optional[str] = None) -> dict:
    """
    Edita un mensaje para remover los botones inline (después de hacer click).
    
    Args:
        chat_id: ID del chat
        message_id: ID del mensaje a editar
        
    Returns:
        dict: Respuesta de la API
    """
    token = _token(token)
    if not token:
        return None

    url = f"{TELEGRAM_API_BASE}{token}/editMessageReplyMarkup"
    data = {
        'chat_id': chat_id,
        'message_id': message_id,
        'reply_markup': json.dumps({'inline_keyboard': []})
    }
    
    try:
        response = requests.post(url, json=data, timeout=10)
        return response.json()
    except requests.RequestException as e:
        logger.error(f"Error editando mensaje: {e}")
        return None


def get_telegram_file_url(file_id: str, token: Optional[str] = None) -> str:
    """
    Obtiene la URL de descarga directa de un archivo de Telegram.
    """
    token = _token(token)
    if not token:
        return None
        
    try:
        # 1. Obtener path del archivo
        url = f"{TELEGRAM_API_BASE}{token}/getFile"
        response = requests.get(url, params={'file_id': file_id}, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if not data.get('ok'):
            return None
            
        file_path = data['result']['file_path']
        
        # 2. Construir URL de descarga
        return f"https://api.telegram.org/file/bot{token}/{file_path}"
        
    except Exception as e:
        logger.error(f"Error resolviendo archivo Telegram {file_id}: {e}")
        return None


# ==================== GESTIÓN DEL BOT (conexión por tienda) ====================

def get_bot_info(token: str) -> Optional[dict]:
    """Valida el token y devuelve info del bot (getMe). None si inválido."""
    try:
        resp = requests.get(f"{TELEGRAM_API_BASE}{token}/getMe", timeout=10)
        data = resp.json()
        if data.get('ok'):
            return data['result']  # incluye 'username', 'first_name', 'id'
        logger.warning(f"Token de Telegram inválido: {data}")
        return None
    except requests.RequestException as e:
        logger.error(f"Error validando token Telegram: {e}")
        return None


def set_webhook(token: str, webhook_url: str) -> bool:
    """Registra el webhook del bot apuntando a webhook_url."""
    try:
        resp = requests.post(
            f"{TELEGRAM_API_BASE}{token}/setWebhook",
            json={'url': webhook_url, 'allowed_updates': ['message', 'callback_query']},
            timeout=10
        )
        data = resp.json()
        if data.get('ok'):
            logger.info(f"✅ Webhook Telegram registrado: {webhook_url}")
            return True
        logger.error(f"Error registrando webhook Telegram: {data}")
        return False
    except requests.RequestException as e:
        logger.error(f"Error en setWebhook: {e}")
        return False


def delete_webhook(token: str) -> bool:
    """Elimina el webhook del bot."""
    try:
        resp = requests.post(f"{TELEGRAM_API_BASE}{token}/deleteWebhook", timeout=10)
        return resp.json().get('ok', False)
    except requests.RequestException as e:
        logger.error(f"Error en deleteWebhook: {e}")
        return False


# ==================== BOTONES PREDEFINIDOS ====================

def get_confirm_order_buttons() -> List[List[Dict]]:
    """Botones para confirmar pedido."""
    return [
        [
            {"text": "✅ Confirmar Pedido", "callback_data": "confirm_order"},
            {"text": "➕ Agregar más", "callback_data": "add_more"}
        ],
        [
            {"text": "❌ Cancelar", "callback_data": "cancel_order"}
        ]
    ]


def get_payment_method_buttons() -> List[List[Dict]]:
    """Botones para seleccionar método de pago."""
    return [
        [{"text": "💳 Nequi/Transferencia", "callback_data": "pay_nequi"}],
        [{"text": "💵 Efectivo (contra entrega)", "callback_data": "pay_cash"}]
    ]


def get_yes_no_buttons(yes_data: str = "yes", no_data: str = "no") -> List[List[Dict]]:
    """Botones genéricos Sí/No."""
    return [
        [
            {"text": "✅ Sí", "callback_data": yes_data},
            {"text": "❌ No", "callback_data": no_data}
        ]
    ]

