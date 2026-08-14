"""Tests del sistema de correo de marca (orders/services/mailer.py + plantillas).

Un correo roto no lanza excepción visible: se envía feo, o no se envía y el
usuario se queda esperando un código que nunca llega. Por eso se testea el
render, no solo el envío.

Lo que se protege aqui:
- Las 4 variantes renderizan HTML y texto plano sin reventar.
- Ninguna deja etiquetas de plantilla sin resolver (el sintoma de un include
  mal escrito es texto crudo `{{ code }}` en la bandeja del usuario).
- Todas comparten el marco: logo, filete naranja y pie.
- El envio va en multipart (texto + HTML): sin la parte de texto cae la
  reputacion de envio.
"""
import re

import pytest
from django.core import mail

from orders.services import mailer

# Contextos minimos de cada variante — lo que el codigo real le pasa.
CONTEXTS = {
    'verification_code': {
        'code': '482913', 'ttl_label': '3 minutos',
        'greeting_name': 'Ana', 'purpose': 'entrar al panel', 'ip': '203.0.113.42',
    },
    'login_alert': {
        'greeting_name': 'Ana',
        'rows': [
            {'label': 'Cuenta', 'value': 'hola@dilo.example.com'},
            {'label': 'Dispositivo', 'value': 'Chrome en Linux'},
        ],
        'account_url': 'https://dilo.example.com/admin/audit',
    },
    'password_reset': {
        'reset_url': 'https://dilo.example.com/reset/abc123', 'ttl_label': '30 minutos',
        'greeting_name': 'Ana', 'rows': [{'label': 'Cuenta', 'value': 'hola@dilo.example.com'}],
    },
    'email_change': {
        'confirm_url': 'https://dilo.example.com/email-change/abc123', 'ttl_label': '24 horas',
        'greeting_name': 'Ana', 'old_email': 'hola@dilo.example.com', 'new_email': 'luis@dilo.example.com',
        'rows': [{'label': 'Correo nuevo', 'value': 'luis@dilo.example.com', 'accent': True}],
    },
    'security_notice': {
        'greeting_name': 'Ana', 'headline': 'Tu contraseña quedó cambiada',
        'intro': 'ya puedes entrar a DILO con tu contraseña nueva.',
        'rows': [{'label': 'Cuenta', 'value': 'hola@dilo.example.com'}],
        'account_url': 'https://dilo.example.com/dashboard',
    },
}


@pytest.fixture(autouse=True)
def _smtp_en_memoria(settings):
    settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
    mail.outbox.clear()


@pytest.mark.parametrize('template', list(CONTEXTS))
def test_cada_variante_renderiza(template):
    html, texto = mailer.render_brand_email(template, CONTEXTS[template])

    assert len(html) > 3000          # una plantilla vacia pasaria desapercibida
    assert len(texto) > 120
    assert html.strip().startswith('<!DOCTYPE html>')


@pytest.mark.parametrize('template', list(CONTEXTS))
def test_sin_etiquetas_de_plantilla_sin_resolver(template):
    """`{{ code }}` crudo en la bandeja del usuario es el fallo mas vergonzoso
    y el mas facil de no ver en una revision visual."""
    html, texto = mailer.render_brand_email(template, CONTEXTS[template])

    for salida in (html, texto):
        assert '{{' not in salida
        assert '{%' not in salida


@pytest.mark.parametrize('template', list(CONTEXTS))
def test_todas_comparten_el_marco_de_marca(template):
    """El punto del sistema: los cuatro correos se reconocen como el mismo
    producto. Si alguien salta la plantilla base, este test cae."""
    html, _ = mailer.render_brand_email(template, CONTEXTS[template])

    assert '#FF441F' in html                       # acento de marca
    assert 'DILO' in html
    assert 'no hace falta responderlo' in html     # pie compartido
    assert 'width="560"' in html                   # ancho del sistema


@pytest.mark.parametrize('template', list(CONTEXTS))
def test_el_logo_es_el_oficial(template):
    """El logo de DILO es "DIL" + burbuja de chat naranja con tres puntos (el
    mismo isotipo de `DiloLogo.js`). Si alguien lo devuelve al cuadrito con la
    "D", el correo deja de parecerse al producto."""
    html, _ = mailer.render_brand_email(template, CONTEXTS[template])

    assert 'aria-label="DILO"' in html          # lo que oye un lector de pantalla
    assert '>DIL<' in html or 'DIL</span>' in html
    assert html.count('&#8226;&#8226;&#8226;') >= 2   # burbuja en header y pie
    # Sin imagenes remotas: siguen bloqueadas por defecto en la mayoria de
    # clientes, y un logo invisible es peor que no tener logo.
    assert '<img' not in html


@pytest.mark.parametrize('template', list(CONTEXTS))
def test_lleva_preheader(template):
    """Sin preheader, el cliente rellena la vista previa con lo primero que
    encuentre (normalmente basura del header)."""
    html, _ = mailer.render_brand_email(template, CONTEXTS[template])

    bloque = re.search(r'<div style="display:none;.*?</div>', html, re.S)
    assert bloque, "no hay bloque de preheader"
    # Dentro del div hay texto real, no solo los espaciadores invisibles.
    texto = re.sub(r'&#\d+;|<[^>]+>|\s+', ' ', bloque.group(0)).strip()
    assert len(texto) > 25


def test_el_codigo_es_visible_en_ambas_versiones():
    html, texto = mailer.render_brand_email('verification_code', CONTEXTS['verification_code'])

    assert '482913' in html
    assert '482913' in texto          # quien lee en texto plano tambien entra


def test_login_alert_muestra_todas_las_filas():
    html, texto = mailer.render_brand_email('login_alert', CONTEXTS['login_alert'])

    for salida in (html, texto):
        assert 'hola@dilo.example.com' in salida
        assert 'Chrome en Linux' in salida


def test_envio_va_en_multipart_con_texto_y_html():
    ok = mailer.send_brand_email(
        'verification_code', to='admin@dilo.example.com',
        subject='482913 es tu código', context=CONTEXTS['verification_code'])

    assert ok is True
    assert len(mail.outbox) == 1
    mensaje = mail.outbox[0]
    assert mensaje.body.strip()                                   # texto plano
    assert mensaje.alternatives[0][1] == 'text/html'              # y HTML
    assert '482913' in mensaje.subject


def test_envio_fallido_devuelve_false_sin_propagar(monkeypatch):
    """Quien llama decide si un correo es critico. `send_brand_email` nunca
    tumba la operacion de negocio que lo invoco."""
    def explota(*args, **kwargs):
        raise OSError("smtp caido")

    monkeypatch.setattr(
        'django.core.mail.EmailMultiAlternatives.send', explota)

    assert mailer.send_brand_email(
        'login_alert', to='admin@dilo.example.com', subject='x',
        context=CONTEXTS['login_alert']) is False


def test_el_pie_nunca_muestra_localhost(settings):
    """En dev FRONTEND_URL es localhost; un correo no puede enseñar eso."""
    settings.FRONTEND_URL = 'http://localhost:3000'

    html, texto = mailer.render_brand_email('login_alert', CONTEXTS['login_alert'])

    assert 'localhost' not in html
    assert 'localhost' not in texto
    assert 'dilo.example.com' in html


def test_la_hora_de_los_avisos_es_la_de_colombia(settings):
    """Un correo de seguridad con la hora equivocada es peor que no mandarlo:
    el dueño ve una hora en la que no estaba conectado y cree que lo hackearon.
    Con TIME_ZONE='UTC' los avisos salían 5 horas adelantados."""
    from django.utils import timezone

    assert settings.TIME_ZONE == 'America/Bogota'
    # Celery no hereda el TIME_ZONE de Django: si se desincroniza, el beat del
    # win-back corre a una hora distinta de la que dice su propio comentario.
    assert settings.CELERY_TIMEZONE == settings.TIME_ZONE

    desfase = timezone.localtime().utcoffset().total_seconds() / 3600
    assert desfase == -5


def test_describe_user_agent():
    from orders.services.staff_mfa import describe_user_agent

    chrome_linux = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
    iphone = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
              "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1")

    assert describe_user_agent(chrome_linux) == 'Chrome en Linux'
    assert describe_user_agent(iphone) == 'Safari en iPhone'
    assert describe_user_agent('') == 'Dispositivo desconocido'
    # Ante algo irreconocible se devuelve el crudo recortado, no un invento.
    assert describe_user_agent('curl/8.4.0') == 'curl/8.4.0'
