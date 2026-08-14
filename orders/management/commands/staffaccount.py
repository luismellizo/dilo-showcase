"""
Crea una cuenta dedicada del equipo interno (acceso a /admin/login).

A diferencia de `createsuperuser`, esta cuenta nace pensada para el panel:
sin tienda, sin UserProfile, sin trial — solo administra la plataforma.

Uso:
    python manage.py staffaccount admin@dilo.example.com                # rol admin, pide password
    python manage.py staffaccount soporte@dilo.example.com --role soporte
    python manage.py staffaccount admin@dilo.example.com --generate-password
    python manage.py staffaccount admin@dilo.example.com --django-admin  # tambien /admin/ de Django

La contraseña nunca se pasa por argumento (quedaria en el historial del shell
y en los logs del contenedor): se pide por prompt oculto, se genera al azar,
o se lee de la variable de entorno STAFF_PASSWORD.

Sobre una cuenta existente solo cambia lo que se pida (rol, contraseña).
"""
import getpass
import os
import secrets
import string

from django.conf import settings
from django.contrib.auth.models import Group, User
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth.password_validation import validate_password

from orders.staff_permissions import STAFF_GROUP_ROLES, email_domain_allowed

ROLE_TO_GROUP = {role: group for group, role in STAFF_GROUP_ROLES.items()}
ALPHABET = string.ascii_letters + string.digits + "!@#$%^&*-_"


def generate_password(length=20):
    return ''.join(secrets.choice(ALPHABET) for _ in range(length))


class Command(BaseCommand):
    help = "Crea (o actualiza) una cuenta del equipo interno con acceso a /admin/login"

    def add_arguments(self, parser):
        parser.add_argument('email')
        parser.add_argument('--role', choices=list(ROLE_TO_GROUP), default='admin')
        parser.add_argument('--name', default='', help="Nombre visible en el panel")
        parser.add_argument('--generate-password', action='store_true',
                            help="Genera una contraseña fuerte y la imprime UNA vez")
        parser.add_argument('--django-admin', action='store_true',
                            help="Ademas da acceso al admin de Django (is_staff + is_superuser)")

    def handle(self, *args, **options):
        email = options['email'].strip().lower()
        role = options['role']

        # Crear la cuenta con un correo de otro dominio produciría una cuenta
        # muerta: `staff_role` la ignoraría y nunca podría entrar al panel.
        if not email_domain_allowed(email):
            permitidos = ', '.join('@' + d for d in settings.STAFF_EMAIL_DOMAINS)
            raise CommandError(
                f"El equipo interno solo admite correos de: {permitidos}. "
                f"El código de verificación del panel se envía a ese buzón."
            )

        password = self._resolve_password(options)
        try:
            validate_password(password)
        except ValidationError as exc:
            raise CommandError("Contraseña rechazada: " + "; ".join(exc.messages))

        user = User.objects.filter(username=email).first() or User.objects.filter(email=email).first()
        created = user is None
        if created:
            user = User.objects.create_user(username=email, email=email, password=password)
        else:
            user.set_password(password)

        user.is_active = True
        if options['name']:
            parts = options['name'].split(' ', 1)
            user.first_name = parts[0]
            user.last_name = parts[1] if len(parts) > 1 else ''
        if options['django_admin']:
            user.is_staff = True
            user.is_superuser = True
        user.save()

        # Un solo rol a la vez.
        for group_name in STAFF_GROUP_ROLES:
            group = Group.objects.filter(name=group_name).first()
            if group:
                user.groups.remove(group)
        group, _ = Group.objects.get_or_create(name=ROLE_TO_GROUP[role])
        user.groups.add(group)

        verbo = "creada" if created else "actualizada"
        self.stdout.write(self.style.SUCCESS(f"Cuenta interna {verbo}: {email} → rol '{role}'"))
        if options['generate_password']:
            self.stdout.write(self.style.WARNING(f"Contraseña (se muestra UNA vez): {password}"))
        self.stdout.write("Entrar por: https://dilo.example.com/admin/login")

    def _resolve_password(self, options):
        if options['generate_password']:
            return generate_password()
        from_env = os.getenv('STAFF_PASSWORD')
        if from_env:
            return from_env
        password = getpass.getpass("Contraseña: ")
        if password != getpass.getpass("Confirmar contraseña: "):
            raise CommandError("Las contraseñas no coinciden")
        if not password:
            raise CommandError("Contraseña vacía")
        return password
