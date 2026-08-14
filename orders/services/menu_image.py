"""
Menú digital — render de la imagen del menú desde la base de datos.

La imagen que el bot envía cuando el cliente pide el menú completo NO la
genera un modelo de imagen (alucina precios/nombres = dinero inventado):
se renderiza con Pillow desde Category/Product/Variant, la única fuente de
verdad. Texto 100% exacto, gratis, instantáneo y regenerable en cada cambio
del menú.

Tipografías OFL bundleadas en orders/services/fonts/ (variable fonts):
Playfair Display (títulos) + Inter (cuerpo). El acento visual sale de
store.theme_color (oscurecido si no contrasta sobre el fondo crema).
"""
import base64
import io
import logging
import os
from decimal import Decimal

from PIL import Image, ImageDraw, ImageFont, ImageOps

logger = logging.getLogger(__name__)

FONTS_DIR = os.path.join(os.path.dirname(__file__), 'fonts')
FONT_DISPLAY = os.path.join(FONTS_DIR, 'PlayfairDisplay-Variable.ttf')
FONT_BODY = os.path.join(FONTS_DIR, 'Inter-Variable.ttf')

# Lienzo
W = 1080
MARGIN = 96
CONTENT_W = W - 2 * MARGIN

# Paleta base (el acento viene de la tienda)
BG = (250, 247, 242)        # crema cálido
INK = (28, 26, 22)          # casi negro cálido
MUTED = (128, 120, 108)     # gris cálido para descripciones
RULE = (216, 209, 198)      # líneas sutiles


def _hex_to_rgb(hex_color, fallback=(214, 90, 49)):
    try:
        h = (hex_color or '').lstrip('#')
        if len(h) == 3:
            h = ''.join(c * 2 for c in h)
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except (ValueError, IndexError):
        return fallback


def _luminance(rgb):
    r, g, b = [c / 255 for c in rgb]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _accent_for_text(rgb):
    """Oscurece el acento hasta que sea legible sobre el fondo crema."""
    while _luminance(rgb) > 0.45:
        rgb = tuple(max(0, int(c * 0.82)) for c in rgb)
    return rgb


def _font(path, size, weight=400):
    """Carga una variable font en el peso pedido; degrada sin romper."""
    f = ImageFont.truetype(path, size)
    try:
        f.set_variation_by_axes([weight])
    except OSError:
        pass
    return f


def _fmt_price(value):
    """$12.000 estilo COP (punto de miles, sin decimales)."""
    try:
        n = int(Decimal(value))
    except Exception:
        n = 0
    return f"${n:,}".replace(',', '.')


def _wrap(draw, text, font, max_w):
    """Corta texto en líneas que quepan en max_w px."""
    words = text.split()
    lines, current = [], ''
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= max_w:
            current = candidate
        else:
            if current:
                lines.append(current)
            # Palabra sola más ancha que la caja: se deja pasar (raro)
            current = word
    if current:
        lines.append(current)
    return lines or ['']


def _line_h(font):
    ascent, descent = font.getmetrics()
    return ascent + descent


def _paint_ai_background(img, store):
    """Pinta el fondo IA cacheado (si existe) + velo crema para legibilidad.

    El velo (86% de crema sobre el fondo) garantiza contraste del texto sin
    importar qué haya generado el modelo. Sin fondo o con error: queda el
    crema plano de siempre (fail-open).
    """
    if not getattr(store, 'menu_bg_image', None):
        return False
    try:
        bg = Image.open(store.menu_bg_image.path).convert('RGB')
    except Exception as e:
        logger.warning(f"Fondo IA ilegible para {store.id}: {e}")
        return False

    w, h = img.size
    scale = w / bg.width
    bg = bg.resize((w, max(1, int(bg.height * scale))), Image.LANCZOS)

    # Cubrir toda la altura: tile vertical espejado (transición continua)
    y, flip = 0, False
    while y < h:
        tile = ImageOps.flip(bg) if flip else bg
        img.paste(tile, (0, y))
        y += bg.height
        flip = not flip

    # Velo crema encima del fondo
    veil = Image.new('RGB', (w, h), BG)
    img.paste(veil, (0, 0), mask=Image.new('L', (w, h), 220))
    return True


def generate_menu_background(store, style_hint=''):
    """Genera con IA el fondo decorativo del menú (SIN texto) y lo cachea.

    Usa el modelo de imagen configurado (AI_IMAGE_MODEL) vía el cliente
    OpenAI-compatible del proyecto. El texto del menú JAMÁS lo genera la IA
    (alucina precios): solo produce decoración; el render de Pillow pone los
    datos exactos encima. Devuelve True si guardó fondo nuevo.
    """
    from django.conf import settings
    from django.core.files.base import ContentFile

    from .menu_extractor import _build_vision_client

    client = _build_vision_client()

    business = (store.business_description or '').strip() or store.name
    hint = f"\nIndicaciones extra del dueño: {style_hint.strip()}" if style_hint.strip() else ''
    # ── Prompt de generación de fondo omitido por confidencialidad ──
    # El de producción especifica paleta derivada del color de marca del
    # comercio, estilo ilustrativo, composición con centro despejado (para que
    # el texto del menú sea legible encima) y una lista de prohibiciones
    # afinada a fuerza de descartar fondos inservibles. Versión mínima:
    prompt = (
        "Genera una imagen de fondo decorativa para el menú de un negocio de comida.\n"
        f"El negocio: {business}.\n"
        f"Paleta armónica con el color {store.theme_color}.\n"
        "Centro y zona media despejados para que el texto sea legible encima.\n"
        "PROHIBIDO: texto, letras, números, logotipos, marcas de agua.\n"
        f"Formato vertical (retrato).{hint}"
    )

    response = client.chat.completions.create(
        model=settings.AI_IMAGE_MODEL,
        messages=[{"role": "user", "content": prompt}],
        extra_body={"modalities": ["image", "text"]},
        timeout=90,
    )
    data = response.model_dump()
    msg = (data.get('choices') or [{}])[0].get('message') or {}
    images = msg.get('images') or []
    if not images:
        logger.error(f"El modelo de imagen no devolvió fondo (model={settings.AI_IMAGE_MODEL}). "
                     f"content={str(msg.get('content'))[:200]!r}")
        return False

    url = (images[0].get('image_url') or {}).get('url') or ''
    if ',' in url and url.startswith('data:'):
        b64 = url.split(',', 1)[1]
    else:
        b64 = url  # algunos providers devuelven el base64 pelado
    try:
        raw = base64.b64decode(b64)
        bg = Image.open(io.BytesIO(raw)).convert('RGB')
    except Exception as e:
        logger.error(f"Fondo IA indecodificable: {e}")
        return False

    # Normalizar: ancho máx 1080 (el render escala igual), JPEG compacto
    if bg.width > 1080:
        bg = bg.resize((1080, int(bg.height * 1080 / bg.width)), Image.LANCZOS)
    buf = io.BytesIO()
    bg.save(buf, format='JPEG', quality=88)

    if store.menu_bg_image:
        store.menu_bg_image.delete(save=False)
    store.menu_bg_image.save(f"menubg_{store.id.hex}.jpg", ContentFile(buf.getvalue()), save=False)
    store.save(update_fields=['menu_bg_image'])
    logger.info(f"🎨 Fondo IA del menú generado para {store.name} ({store.id})")
    return True


def render_menu_image(store):
    """Renderiza el menú de la tienda a PNG. Devuelve bytes o None si no hay menú."""
    categories = []
    for category in store.categories.filter(is_active=True).order_by('display_order', 'name'):
        products = list(
            category.products.filter(is_active=True)
            .prefetch_related('variants')
            .order_by('display_order', 'name')
        )
        if products:
            categories.append((category, products))
    if not categories:
        return None

    accent = _accent_for_text(_hex_to_rgb(store.theme_color))

    # Fuentes
    f_title = _font(FONT_DISPLAY, 76, 700)
    f_category = _font(FONT_DISPLAY, 46, 600)
    f_product = _font(FONT_BODY, 33, 600)
    f_price = _font(FONT_BODY, 33, 650)
    f_desc = _font(FONT_BODY, 26, 400)
    f_meta = _font(FONT_BODY, 27, 450)
    f_footer = _font(FONT_BODY, 28, 600)

    # ---- Pasada 1: medir altura ----
    scratch = ImageDraw.Draw(Image.new('RGB', (1, 1)))

    def measure():
        y = 110
        y += len(_wrap(scratch, store.name, f_title, CONTENT_W)) * _line_h(f_title)
        y += 26 + 4 + 30  # regla del header
        if store.business_description.strip():
            desc = store.business_description.strip()
            y += len(_wrap(scratch, desc, f_meta, CONTENT_W)) * _line_h(f_meta) + 12
        for meta in _meta_lines(store):
            y += len(_wrap(scratch, meta, f_meta, CONTENT_W)) * _line_h(f_meta) + 6
        y += 64
        for category, products in categories:
            y += _line_h(f_category) + 40
            for product in products:
                price_w = scratch.textlength(_fmt_price(product.price), font=f_price)
                name_max = CONTENT_W - price_w - 48
                y += len(_wrap(scratch, product.name, f_product, name_max)) * _line_h(f_product)
                if product.description.strip():
                    y += len(_wrap(scratch, product.description.strip(), f_desc, CONTENT_W - 60)) * _line_h(f_desc) + 4
                variants = _variant_line(product)
                if variants:
                    y += len(_wrap(scratch, variants, f_desc, CONTENT_W - 60)) * _line_h(f_desc) + 4
                y += 28
            y += 48
        y += 30 + _line_h(f_footer) + 90  # footer
        return int(y)

    def _meta_lines(store):
        lines = []
        if store.business_hours.strip():
            lines.append(store.business_hours.strip().replace('\n', ' · '))
        if store.address.strip():
            lines.append(store.address.strip())
        return lines

    def _variant_line(product):
        variants = [v for v in product.variants.all() if v.is_active]
        if not variants:
            return ''
        parts = []
        for v in variants:
            adj = Decimal(v.price_adjustment or 0)
            parts.append(f"{v.name} (+{_fmt_price(adj)})" if adj > 0 else v.name)
        return "Opciones: " + " · ".join(parts)

    height = max(measure(), 1080)

    # ---- Pasada 2: dibujar ----
    img = Image.new('RGB', (W, height), BG)
    _paint_ai_background(img, store)
    draw = ImageDraw.Draw(img)

    # Marco fino exterior (toque de carta impresa)
    draw.rectangle([28, 28, W - 29, height - 29], outline=RULE, width=2)

    y = 110

    # Nombre de la tienda
    for line in _wrap(draw, store.name, f_title, CONTENT_W):
        lw = draw.textlength(line, font=f_title)
        draw.text(((W - lw) / 2, y), line, font=f_title, fill=INK)
        y += _line_h(f_title)

    # Regla con rombo central
    y += 26
    cx = W / 2
    draw.line([cx - 120, y, cx - 14, y], fill=accent, width=3)
    draw.line([cx + 14, y, cx + 120, y], fill=accent, width=3)
    draw.polygon([(cx, y - 7), (cx + 7, y), (cx, y + 7), (cx - 7, y)], fill=accent)
    y += 4 + 30

    # Descripción + horario + dirección
    if store.business_description.strip():
        for line in _wrap(draw, store.business_description.strip(), f_meta, CONTENT_W):
            lw = draw.textlength(line, font=f_meta)
            draw.text(((W - lw) / 2, y), line, font=f_meta, fill=MUTED)
            y += _line_h(f_meta)
        y += 12
    for meta in _meta_lines(store):
        for line in _wrap(draw, meta, f_meta, CONTENT_W):
            lw = draw.textlength(line, font=f_meta)
            draw.text(((W - lw) / 2, y), line, font=f_meta, fill=MUTED)
            y += _line_h(f_meta)
        y += 6
    y += 64

    for category, products in categories:
        # Título de categoría centrado con reglas laterales
        cat_name = category.name
        cw = draw.textlength(cat_name, font=f_category)
        cy = y + _line_h(f_category) / 2
        pad = 28
        rule_max = (CONTENT_W - cw) / 2 - pad
        if rule_max > 30:
            draw.line([MARGIN, cy, MARGIN + rule_max, cy], fill=RULE, width=2)
            draw.line([W - MARGIN - rule_max, cy, W - MARGIN, cy], fill=RULE, width=2)
        draw.text(((W - cw) / 2, y), cat_name, font=f_category, fill=accent)
        y += _line_h(f_category) + 40

        for product in products:
            price = _fmt_price(product.price)
            price_w = draw.textlength(price, font=f_price)
            name_max = CONTENT_W - price_w - 48
            name_lines = _wrap(draw, product.name, f_product, name_max)

            # Primera línea: nombre + puntos conductores + precio
            first = name_lines[0]
            draw.text((MARGIN, y), first, font=f_product, fill=INK)
            name_w = draw.textlength(first, font=f_product)
            draw.text((W - MARGIN - price_w, y), price, font=f_price, fill=INK)
            dot_y = y + _line_h(f_product) - 14
            x = MARGIN + name_w + 18
            while x < W - MARGIN - price_w - 18:
                draw.ellipse([x, dot_y, x + 3, dot_y + 3], fill=RULE)
                x += 14
            y += _line_h(f_product)
            for extra in name_lines[1:]:
                draw.text((MARGIN, y), extra, font=f_product, fill=INK)
                y += _line_h(f_product)

            if product.description.strip():
                for line in _wrap(draw, product.description.strip(), f_desc, CONTENT_W - 60):
                    draw.text((MARGIN + 30, y), line, font=f_desc, fill=MUTED)
                    y += _line_h(f_desc)
                y += 4
            variants = _variant_line(product)
            if variants:
                for line in _wrap(draw, variants, f_desc, CONTENT_W - 60):
                    draw.text((MARGIN + 30, y), line, font=f_desc, fill=MUTED)
                    y += _line_h(f_desc)
                y += 4
            y += 28
        y += 48

    # Footer
    y += 30
    footer = "Haz tu pedido por este chat"
    fw = draw.textlength(footer, font=f_footer)
    draw.text(((W - fw) / 2, y), footer, font=f_footer, fill=accent)

    # Si el menú es enorme, reescala para que WhatsApp no lo degrade tanto
    if height > 4200:
        scale = 4200 / height
        img = img.resize((int(W * scale), 4200), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def update_store_menu_image(store, force=False):
    """Renderiza y guarda la imagen del menú en store.menu_image.

    No sobreescribe una imagen subida por el dueño (UPLOADED) salvo force=True.
    Devuelve True si se actualizó.
    """
    from django.core.files.base import ContentFile
    from django.utils import timezone

    from ..models import Store

    if store.menu_image_source == Store.MenuImageSource.UPLOADED and not force:
        return False

    png = render_menu_image(store)
    if png is None:
        return False

    if store.menu_image:
        store.menu_image.delete(save=False)
    store.menu_image.save(f"menu_{store.id.hex}.png", ContentFile(png), save=False)
    store.menu_image_source = Store.MenuImageSource.GENERATED
    store.menu_image_updated_at = timezone.now()
    store.save(update_fields=['menu_image', 'menu_image_source', 'menu_image_updated_at'])
    logger.info(f"🖼️ Menú digital regenerado para {store.name} ({store.id})")
    return True
