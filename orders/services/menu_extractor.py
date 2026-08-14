"""
Extractor de menú por foto usando un LLM con visión (vía OpenRouter).

Recibe una o varias imágenes (o un PDF) del menú de un restaurante y devuelve
una estructura de categorías/productos para PREVISUALIZAR en el panel. La
creación en DB ocurre después, cuando el dueño confirma (MenuConfirmView).

Pipeline:
  1. Límite de archivos/tamaño (protección de costo de tokens).
  2. PDF digital → texto directo (PyMuPDF, sin visión = barato). PDF escaneado
     (sin capa de texto) → páginas a imagen (fallback).
  3. Imágenes: validación de confianza con Google Vision (TEXT_DETECTION) —
     si la foto no tiene texto legible, se rechaza antes de gastar en el LLM.
  4. Redimensión a máx 1600px + JPEG (menos tokens de visión).
  5. LLM devuelve JSON; parseo robusto de fences.
"""
import base64
import io
import json
import logging
import re
import unicodedata
from decimal import Decimal, InvalidOperation
from typing import List, Dict

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Límites defensivos (protección de costo)
# ---------------------------------------------------------------------------
MAX_FILES = 7            # archivos por request
MAX_FILE_MB = 8          # tamaño por archivo
MAX_PDF_PAGES = 7        # páginas de PDF procesadas
MAX_IMAGE_DIM = 1600     # lado mayor tras redimensión (px)
_JPEG_QUALITY = 85

# Umbral de texto para dar una imagen por "menú legible" (Google Vision).
_MIN_TEXT_CHARS_IMAGE = 20
# Umbral para considerar que un PDF tiene capa de texto utilizable.
# Un menú real de una página con precios ronda 100+ chars; 80 evita tratar
# como digital un escaneo con restos de OCR basura.
_MIN_TEXT_CHARS_PDF = 80


# ─────────────────────────────────────────────────────────────────────────────
#  ⚠️  PROMPT DE PRODUCCIÓN OMITIDO — SECRETO COMERCIAL
#
#  El prompt real de extracción está calibrado contra menús reales de comercios
#  colombianos: pizarras con fotos torcidas, volantes escaneados, cartas con
#  precios en formatos inconsistentes, combos con letra pequeña. Buena parte de
#  su longitud son reglas de desambiguación aprendidas de fallos concretos
#  (variantes vs. adiciones, precios absolutos vs. diferenciales, productos
#  duplicados entre páginas). Eso es el producto y no se publica.
#
#  Abajo queda la versión mínima: el contrato de salida en JSON, que es lo que
#  el resto del módulo necesita para parsear y validar. El pipeline completo
#  (prevalidación con Google Vision, render de PDF a imagen, parseo tolerante,
#  validación y persistencia) sí está íntegro más abajo.
# ─────────────────────────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """Eres un asistente que digitaliza menús de restaurantes.
Analiza todo el material como partes de un mismo menú y extrae los productos.

Devuelve ÚNICAMENTE un JSON válido, sin markdown ni comentarios, con esta forma:
{
  "categories": [
    {
      "name": "Nombre de la categoría",
      "products": [
        {
          "name": "Nombre del producto",
          "description": "Descripción corta o vacío",
          "price": 12000,
          "variants": [
            {"name": "Personal", "price": 15000},
            {"name": "Familiar", "price": 35000}
          ]
        }
      ]
    }
  ]
}

Reglas base:
- No inventes productos, precios ni descripciones que no estén en el material.
- "price" es un entero sin símbolos ni separadores ("$12.000" -> 12000).
- Si un producto no tiene variantes, usa "variants": [] (no omitas la clave).
- Si no hay categorías claras, agrupa todo en una categoría "Menú".

[Reglas de desambiguación de producción omitidas por confidencialidad.]
"""


def _build_vision_client():
    """Crea un cliente OpenAI-compatible apuntando al proveedor configurado."""
    from openai import OpenAI

    provider = settings.AI_PROVIDER
    if provider in ('gemini', 'google'):
        return OpenAI(api_key=settings.GEMINI_API_KEY,
                      base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                      http_client=httpx.Client())
    if provider == 'openrouter':
        return OpenAI(api_key=settings.OPENROUTER_API_KEY,
                      base_url="https://openrouter.ai/api/v1",
                      http_client=httpx.Client())
    if provider == 'openai':
        return OpenAI(api_key=settings.OPENAI_API_KEY, http_client=httpx.Client())
    # Fallbacks si el provider activo no tiene visión: Gemini directo, luego OpenRouter.
    if settings.GEMINI_API_KEY:
        return OpenAI(api_key=settings.GEMINI_API_KEY,
                      base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                      http_client=httpx.Client())
    if settings.OPENROUTER_API_KEY:
        return OpenAI(api_key=settings.OPENROUTER_API_KEY,
                      base_url="https://openrouter.ai/api/v1",
                      http_client=httpx.Client())
    raise ValueError("No hay proveedor con visión configurado (usa GEMINI_API_KEY u OPENROUTER_API_KEY)")


# ---------------------------------------------------------------------------
# Normalización de nombres (idempotencia)
# ---------------------------------------------------------------------------

def normalize_product_name(name: str) -> str:
    """Clave de dedupe: sin tildes, minúsculas, sin puntuación.

    "Coca-Cola 1.5L" == "coca cola 15l" — evita duplicados por variaciones
    de escritura entre la foto y lo que ya existe en la tienda.
    """
    s = unicodedata.normalize('NFKD', name or '')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', '', s.lower())


# ---------------------------------------------------------------------------
# PDF: texto directo (barato) o render a imágenes (fallback para escaneados)
# ---------------------------------------------------------------------------

def pdf_extract_text(pdf_bytes: bytes) -> str:
    """Extrae la capa de texto de un PDF digital (máx MAX_PDF_PAGES páginas).

    Devuelve "" si el PDF es un escaneo sin texto — el caller decide caer al
    render de imágenes.
    """
    import fitz  # PyMuPDF

    parts: List[str] = []
    with fitz.open(stream=pdf_bytes, filetype='pdf') as doc:
        for i in range(min(doc.page_count, MAX_PDF_PAGES)):
            parts.append(doc.load_page(i).get_text())
    return "\n".join(parts).strip()


def pdf_to_images(pdf_bytes: bytes, dpi: int = 150) -> List[Dict]:
    """Renderiza cada página de un PDF a una imagen PNG en memoria.

    Solo para PDFs escaneados (sin capa de texto). Devuelve la misma forma que
    consume extract_menu_from_images: [{'bytes': b'...', 'content_type': 'image/png'}].
    """
    import fitz  # PyMuPDF

    images: List[Dict] = []
    with fitz.open(stream=pdf_bytes, filetype='pdf') as doc:
        n = min(doc.page_count, MAX_PDF_PAGES)
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        for i in range(n):
            page = doc.load_page(i)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            images.append({'bytes': pix.tobytes('png'), 'content_type': 'image/png'})
    if not images:
        raise ValueError("El PDF no tiene páginas legibles")
    return images


# ---------------------------------------------------------------------------
# Validación de confianza con Google Vision (antes de gastar en el LLM)
# ---------------------------------------------------------------------------

def _google_vision_text_length(image_bytes: bytes) -> int:
    """Cuenta caracteres de texto detectados por Google Vision (TEXT_DETECTION).

    Devuelve -1 si la API no está configurada o falla (fail-open: nunca
    bloquea la extracción por un error de infraestructura ajena).
    """
    api_key = getattr(settings, 'GOOGLE_VISION_API_KEY', '')
    if not api_key:
        return -1
    try:
        payload = {
            "requests": [{
                "image": {"content": base64.b64encode(image_bytes).decode()},
                "features": [{"type": "TEXT_DETECTION", "maxResults": 1}],
            }]
        }
        resp = httpx.post(
            f"https://vision.googleapis.com/v1/images:annotate?key={api_key}",
            json=payload, timeout=20,
        )
        resp.raise_for_status()
        body = resp.json().get('responses', [{}])[0]
        if 'error' in body:
            logger.warning(f"Google Vision devolvió error: {body['error']}")
            return -1
        text = (body.get('fullTextAnnotation') or {}).get('text', '')
        return len(text.strip())
    except Exception as e:
        logger.warning(f"Google Vision no disponible ({e}); se omite validación")
        return -1


def validate_menu_images(images: List[Dict]) -> None:
    """Rechaza imágenes sin texto legible ANTES de mandarlas al LLM de visión.

    Raises ValueError con mensaje amigable si alguna imagen no parece un menú.
    Si Google Vision no está configurado o falla, deja pasar (fail-open).
    """
    bad: List[int] = []
    for idx, img in enumerate(images, start=1):
        chars = _google_vision_text_length(img['bytes'])
        if chars == -1:
            continue
        if chars < _MIN_TEXT_CHARS_IMAGE:
            bad.append(idx)
        else:
            logger.info(f"✅ Vision: imagen {idx} con {chars} caracteres de texto")
    if bad:
        nums = ", ".join(str(n) for n in bad)
        raise ValueError(
            f"La imagen {nums} no parece un menú legible (no se detectó texto). "
            "Intenta con una foto más nítida, de frente y con buena luz."
        )


# ---------------------------------------------------------------------------
# Imágenes: redimensión + normalización de formato
# ---------------------------------------------------------------------------

def _normalize_image(image_bytes: bytes, content_type: str) -> tuple[bytes, str]:
    """Redimensiona (máx MAX_IMAGE_DIM px) y re-codifica a JPEG.

    Fotos de celular de 4000px consumen tokens de visión de sobra sin mejorar
    la lectura; 1600px es suficiente para leer un menú. También normaliza
    formatos que los modelos no aceptan (AVIF, HEIC, BMP...).
    """
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(image_bytes))
        if im.mode not in ('RGB', 'L'):
            im = im.convert('RGB')
        if max(im.size) > MAX_IMAGE_DIM:
            im.thumbnail((MAX_IMAGE_DIM, MAX_IMAGE_DIM), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, format='JPEG', quality=_JPEG_QUALITY)
        return out.getvalue(), 'image/jpeg'
    except Exception as e:
        logger.warning(f"No se pudo normalizar imagen ({content_type}): {e}; se envía tal cual")
        return image_bytes, (content_type or 'image/jpeg').lower()


def _image_to_data_uri(image_bytes: bytes, content_type: str = 'image/jpeg') -> str:
    img_bytes, ct = _normalize_image(image_bytes, content_type)
    b64 = base64.b64encode(img_bytes).decode()
    return f"data:{ct};base64,{b64}"


# ---------------------------------------------------------------------------
# Parseo de la respuesta del LLM
# ---------------------------------------------------------------------------

def _parse_price(value) -> Decimal:
    try:
        if isinstance(value, str):
            value = value.replace('$', '').replace('.', '').replace(',', '').strip() or '0'
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return Decimal('0')


def _close_truncated_json(text: str) -> str:
    """Rescata un JSON cortado a mitad (respuesta truncada por max_tokens).

    Recorre el texto llevando la pila de llaves/corchetes (ignorando strings),
    recorta en el último cierre completo y añade los cierres pendientes —
    descarta el último producto incompleto en vez de perder TODO el menú.
    """
    stack = []
    in_str = False
    escaped = False
    close_points = []  # (índice del cierre, copia de la pila tras cerrarlo)
    for i, ch in enumerate(text):
        if in_str:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in '{[':
            stack.append(ch)
        elif ch in '}]':
            if stack:
                stack.pop()
            close_points.append((i, list(stack)))
    for i, pending in reversed(close_points[-80:]):
        candidate = text[:i + 1] + ''.join(
            '}' if c == '{' else ']' for c in reversed(pending))
        try:
            json.loads(candidate)
            logger.warning(f"⚠️ JSON de menú truncado: rescatados {i + 1}/{len(text)} chars")
            return candidate
        except json.JSONDecodeError:
            continue
    raise ValueError("La IA no pudo leer el menú de la imagen")


def _extract_json(raw: str) -> dict:
    """Saca el JSON de la respuesta del LLM, tolerando fences, texto extra
    y truncamiento por max_tokens."""
    text = (raw or '').strip()
    # Fence de markdown (```json ... ``` o ``` ... ```), en cualquier posición.
    m = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if m:
        text = m.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Recortar al primer { y último } (texto extra alrededor).
    start, end = text.find('{'), text.rfind('}')
    if start == -1:
        logger.error(f"IA no devolvió JSON de menú: {raw[:300]}")
        raise ValueError("La IA no pudo leer el menú de la imagen")
    if end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass
    # Respuesta truncada a mitad: salvar lo completo.
    return json.loads(_close_truncated_json(text[start:]))


def _clean_categories(data: dict) -> List[Dict]:
    """Valida/normaliza la estructura devuelta por el LLM.

    Las variantes conservan su precio ABSOLUTO (el preview del panel edita
    precios absolutos; el ajuste vs precio base se calcula al confirmar).
    Dedupe interno por nombre normalizado (el LLM a veces repite productos).
    """
    categories = []
    for cat in data.get('categories', []):
        products = []
        seen = set()
        for p in cat.get('products', []):
            name = (p.get('name') or '').strip()
            if not name:
                continue
            key = normalize_product_name(name)
            if key in seen:
                continue
            seen.add(key)
            base_price = _parse_price(p.get('price', 0))

            variants = []
            v_seen = set()
            for v in p.get('variants', []) or []:
                v_name = (v.get('name') or '').strip()
                v_key = normalize_product_name(v_name)
                if not v_name or v_key in v_seen:
                    continue
                v_seen.add(v_key)
                variants.append({
                    'name': v_name[:100],
                    'price': _parse_price(v.get('price', 0)),
                })

            products.append({
                'name': name[:200],
                'description': (p.get('description') or '').strip(),
                'price': base_price,
                'variants': variants,
            })
        cat_name = (cat.get('name') or 'Menú').strip()[:100]
        if products:
            categories.append({'name': cat_name, 'products': products})

    if not categories:
        raise ValueError("No se detectaron productos en la imagen")
    return categories


def _run_llm(content: list) -> List[Dict]:
    client = _build_vision_client()
    response = client.chat.completions.create(
        model=settings.AI_VISION_MODEL,
        messages=[{"role": "user", "content": content}],
        temperature=0,
        # Menús grandes: 2000 truncaba el JSON; 8000 también se quedó corto en
        # pruebas reales (~950 líneas de JSON). Gemini 2.5 Flash soporta hasta
        # 65k de salida; solo se paga lo que realmente genera.
        max_tokens=32000,
    )
    raw = response.choices[0].message.content or ""
    finish = response.choices[0].finish_reason
    if finish == 'length':
        logger.warning("⚠️ Respuesta de menú truncada por max_tokens; el menú puede salir incompleto")
    return _clean_categories(_extract_json(raw))


def extract_menu_from_images(images: List[Dict]) -> List[Dict]:
    """Extrae el menú de una lista de imágenes (ya validadas y con límite).

    Args:
        images: lista de {'bytes': b'...', 'content_type': 'image/jpeg'}

    Returns:
        [{'name': str, 'products': [{'name','description','price': Decimal,
          'variants': [{'name','price': Decimal}]}]}]

    Raises:
        ValueError si la IA no devuelve un JSON utilizable o una imagen no
        parece un menú (validación Google Vision).
    """
    if len(images) > MAX_FILES:
        images = images[:MAX_FILES]

    validate_menu_images(images)

    content = [{"type": "text", "text": EXTRACTION_PROMPT}]
    for img in images:
        content.append({
            "type": "image_url",
            "image_url": {"url": _image_to_data_uri(img['bytes'], img.get('content_type', 'image/jpeg'))}
        })
    return _run_llm(content)


def extract_menu_from_text(menu_text: str) -> List[Dict]:
    """Extrae el menú desde texto plano (capa de texto de un PDF digital).

    Sin visión = mucho más barato y preciso que renderizar el PDF a imágenes.
    """
    if len(menu_text.strip()) < _MIN_TEXT_CHARS_PDF:
        raise ValueError("El PDF no tiene texto suficiente para leer el menú")
    content = [
        {"type": "text", "text": EXTRACTION_PROMPT},
        {"type": "text", "text": f"MENÚ (texto extraído del PDF):\n\n{menu_text[:30000]}"},
    ]
    return _run_llm(content)


def pdf_has_text_layer(pdf_bytes: bytes) -> bool:
    """True si el PDF es digital (texto extraíble), False si es un escaneo."""
    try:
        return len(pdf_extract_text(pdf_bytes)) >= _MIN_TEXT_CHARS_PDF
    except Exception:
        return False
