"""
Envío de correo transaccional con la identidad de DILO.

Un solo camino para TODOS los correos de la plataforma: cualquier código que
quiera mandar un correo llama `send_brand_email(...)` con el nombre de una
plantilla de `orders/templates/emails/`. Nadie compone HTML a mano — así el
sistema visual se mantiene idéntico correo a correo, que es justamente lo que
hace que se reconozca como DILO.

Cada correo va en multipart: texto plano primero, HTML después. El texto plano
no es un trámite — sin él la reputación de envío cae y hay clientes (y
lectores de pantalla) que solo muestran esa parte.
"""
import logging

from django.conf import settings
from django.template.loader import render_to_string
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone

logger = logging.getLogger(__name__)

# Identidad de marca disponible en todas las plantillas. El frontend tiene su
# equivalente en `companyInfo.js`; si allá cambian los datos legales, cambian
# aquí también.
BRAND = {
    'company_name': 'DILO',
    'company_city': 'Bucaramanga, Colombia',
    'footer_tagline': 'Ventas por WhatsApp, atendidas por IA.',
}


def public_site_url():
    """
    Dominio que se imprime en el pie y con el que se arman los enlaces de los
    correos. En dev `FRONTEND_URL` es localhost y un correo jamás debe
    enseñarle eso a nadie: se cae al dominio público.
    """
    url = (getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/')
    if not url or 'localhost' in url or '127.0.0.1' in url:
        return 'https://dilo.example.com'
    return url


def _base_context(extra=None):
    ctx = {
        **BRAND,
        'year': timezone.now().year,
        'site_url': public_site_url(),
    }
    ctx.update(extra or {})
    return ctx


def render_brand_email(template, context=None):
    """
    Renderiza `(html, texto_plano)` sin enviar nada.

    Se expone aparte del envío para poder previsualizar los correos (ver
    `manage.py emailpreview`) sin mandar un solo mensaje real.
    """
    ctx = _base_context(context)
    html = render_to_string(f'emails/{template}.html', ctx)
    text = render_to_string(f'emails/txt/{template}.txt', ctx)
    return html, text


def send_brand_email(template, *, to, subject, context=None, reply_to=None):
    """
    Envía la plantilla `template` a `to` (str o lista).

    Devuelve True/False en vez de propagar: quien llama decide si un correo
    fallido es fatal (el código de acceso al panel: sí) o accesorio (un aviso
    de inicio de sesión: no debe tumbar el login).
    """
    recipients = [to] if isinstance(to, str) else list(to)
    try:
        html, text = render_brand_email(template, context)
        message = EmailMultiAlternatives(
            subject=subject,
            body=text,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=recipients,
            reply_to=[reply_to] if reply_to else None,
        )
        message.attach_alternative(html, 'text/html')
        message.send(fail_silently=False)
        logger.info("📧 Correo '%s' enviado a %s", template, ', '.join(recipients))
        return True
    except Exception:
        logger.error("No se pudo enviar el correo '%s' a %s", template,
                     ', '.join(recipients), exc_info=True)
        return False
