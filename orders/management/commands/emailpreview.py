"""
Renderiza los correos de DILO a archivos HTML para revisarlos en el navegador.

    python manage.py emailpreview                      # todas, a .preview_emails/
    python manage.py emailpreview --out /tmp/correos
    python manage.py emailpreview --send tu@correo.com # los manda de verdad

Existe para poder iterar el diseño sin mandar un solo correo real, y para
revisar los cuatro lado a lado: si una variante se sale del sistema visual, se
ve al instante.
"""
import pathlib

from django.core.management.base import BaseCommand

from orders.services import mailer

# Datos de muestra: realistas a propósito (nombres largos, IP, dispositivo),
# porque un diseño solo se rompe con contenido real, nunca con "Lorem ipsum".
SAMPLES = {
    'verification_code': {
        'subject': '482913 es tu código de acceso al panel DILO',
        'context': {
            'code': '482913',
            'ttl_label': '3 minutos',
            'greeting_name': 'Ana',
            'purpose': 'entrar al panel interno de DILO',
            'ip': '203.0.113.42',
            'header_tag': 'Panel interno',
        },
    },
    'login_alert': {
        'subject': 'Nuevo inicio de sesión en el panel DILO',
        'context': {
            'greeting_name': 'Ana',
            'rows': [
                {'label': 'Cuenta', 'value': 'hola@example.com'},
                {'label': 'Fecha y hora', 'value': '08/08/2026, 09:41 p. m.'},
                {'label': 'Dispositivo', 'value': 'Chrome en Linux'},
                {'label': 'Ubicación', 'value': 'Bucaramanga, Colombia'},
                {'label': 'Dirección IP', 'value': '203.0.113.42'},
                {'label': 'Acceso', 'value': 'Panel interno DILO', 'accent': True},
            ],
            'account_url': 'https://dilo.example.com/admin/audit',
            'panel_label': 'Ver la bitácora del panel',
            'header_tag': 'Panel interno',
        },
    },
    'password_reset': {
        'subject': 'Restablece tu contraseña de DILO',
        'context': {
            'greeting_name': 'Ana',
            'reset_url': 'https://dilo.example.com/reset/9f2c1a7e-4b3d-4a19-9d21-77c0f5b8e412',
            'ttl_label': '30 minutos',
            'rows': [
                {'label': 'Cuenta', 'value': 'hola@example.com'},
                {'label': 'Solicitado desde', 'value': 'Chrome en Windows · 203.0.113.42'},
            ],
            'header_tag': 'Cuenta y seguridad',
        },
    },
    'email_change': {
        'subject': 'Confirma tu nuevo correo en DILO',
        'context': {
            'greeting_name': 'Ana',
            'confirm_url': 'https://dilo.example.com/email-change/3ac91b55-27e8-4f0a-bb6d-1e9d4c2af330',
            'ttl_label': '24 horas',
            'old_email': 'hola@example.com',
            'new_email': 'nuevo@example.com',
            'rows': [
                {'label': 'Correo actual', 'value': 'hola@example.com'},
                {'label': 'Correo nuevo', 'value': 'nuevo@example.com', 'accent': True},
            ],
            'header_tag': 'Datos de la cuenta',
        },
    },
    'security_notice': {
        'subject': 'Se solicitó cambiar el correo de tu cuenta DILO',
        'context': {
            'greeting_name': 'Ana',
            'eyebrow': 'Seguridad de la cuenta',
            'headline': 'Se solicitó cambiar tu correo',
            'intro': ('pediste mover el acceso de tu cuenta DILO a otro buzón. '
                      'El cambio solo se aplica cuando se confirme desde el correo nuevo.'),
            'card_title': 'La solicitud',
            'rows': [
                {'label': 'Correo actual', 'value': 'hola@example.com'},
                {'label': 'Correo solicitado', 'value': 'nuevo@example.com', 'accent': True},
                {'label': 'Fecha y hora', 'value': '08/08/2026, 09:41 p. m.'},
            ],
            'account_url': 'https://dilo.example.com/dashboard/profile',
            'panel_label': 'Revisar mi cuenta',
            'alert_heading': '¿No pediste este cambio?',
            'alert_text': ('Cambia tu contraseña ahora mismo: alguien con acceso a tu '
                           'sesión intentó quedarse con la cuenta.'),
            'header_tag': 'Cuenta y seguridad',
        },
    },
}


class Command(BaseCommand):
    help = "Renderiza (o envía) los correos de marca con datos de muestra"

    def add_arguments(self, parser):
        parser.add_argument('--out', default='.preview_emails',
                            help="Carpeta donde escribir los HTML")
        parser.add_argument('--send', default='',
                            help="Envía los correos de verdad a estas direcciones "
                                 "(separadas por coma)")
        parser.add_argument('--only', default='',
                            help="Una sola plantilla (ej. login_alert)")

    def handle(self, *args, **options):
        nombres = [options['only']] if options['only'] else list(SAMPLES)
        desconocidas = [n for n in nombres if n not in SAMPLES]
        if desconocidas:
            self.stderr.write(self.style.ERROR(
                f"Plantilla desconocida: {', '.join(desconocidas)}. "
                f"Disponibles: {', '.join(SAMPLES)}"))
            return

        if options['send']:
            destinatarios = [d.strip() for d in options['send'].split(',') if d.strip()]
            # Aviso ruidoso: sin SMTP configurado el backend cae a consola y los
            # correos se "envían" al log. Sin esto uno cree que llegaron.
            from django.conf import settings
            if 'console' in settings.EMAIL_BACKEND:
                self.stderr.write(self.style.WARNING(
                    "SIN SMTP (falta EMAIL_HOST_PASSWORD): los correos van a la "
                    "consola, no a un buzón real."))
            for nombre in nombres:
                muestra = SAMPLES[nombre]
                # Un envío por destinatario: nadie ve el buzón del otro en el To.
                for destino in destinatarios:
                    ok = mailer.send_brand_email(
                        nombre, to=destino,
                        subject=muestra['subject'], context=muestra['context'])
                    estilo = self.style.SUCCESS if ok else self.style.ERROR
                    self.stdout.write(estilo(
                        f"{'enviado' if ok else 'FALLÓ'}: {nombre} → {destino}"))
            return

        destino = pathlib.Path(options['out'])
        destino.mkdir(parents=True, exist_ok=True)
        for nombre in nombres:
            muestra = SAMPLES[nombre]
            html, texto = mailer.render_brand_email(nombre, muestra['context'])
            (destino / f"{nombre}.html").write_text(html, encoding='utf-8')
            (destino / f"{nombre}.txt").write_text(texto, encoding='utf-8')
            self.stdout.write(self.style.SUCCESS(f"{destino / nombre}.html"))
