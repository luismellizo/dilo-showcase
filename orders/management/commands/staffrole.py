"""
Asigna (o quita) el rol interno de DILO a un usuario.

Uso:
    python manage.py staffrole luis@dilo.com admin
    python manage.py staffrole soporte@dilo.com soporte
    python manage.py staffrole ex@dilo.com none      # quitar todo rol
"""
from django.conf import settings
from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand, CommandError

from orders.staff_permissions import STAFF_GROUP_ROLES, email_domain_allowed

ROLE_TO_GROUP = {role: group for group, role in STAFF_GROUP_ROLES.items()}


class Command(BaseCommand):
    help = "Asigna el rol interno (admin/soporte/lectura/none) a un usuario por email"

    def add_arguments(self, parser):
        parser.add_argument('email')
        parser.add_argument('role', choices=[*ROLE_TO_GROUP.keys(), 'none'])

    def handle(self, *args, **options):
        email = options['email'].strip().lower()
        role = options['role']

        user = User.objects.filter(email=email).first()
        if not user:
            raise CommandError(f"No existe usuario con email {email}")

        # Quitar todos los grupos dilo_* primero (un solo rol a la vez).
        for group_name in STAFF_GROUP_ROLES:
            group = Group.objects.filter(name=group_name).first()
            if group:
                user.groups.remove(group)

        if role == 'none':
            self.stdout.write(self.style.SUCCESS(f"{email} ya no es parte del equipo interno"))
            return

        group, _ = Group.objects.get_or_create(name=ROLE_TO_GROUP[role])
        user.groups.add(group)
        self.stdout.write(self.style.SUCCESS(f"{email} → rol interno '{role}' ({group.name})"))

        # El grupo no basta: el panel exige correo del dominio del equipo, y el
        # código de acceso se manda a ese buzón. Sin esto el rol queda inerte.
        if not email_domain_allowed(email):
            permitidos = ', '.join('@' + d for d in settings.STAFF_EMAIL_DOMAINS)
            self.stdout.write(self.style.ERROR(
                f"OJO: {email} NO podrá entrar al panel. Solo se admiten correos de "
                f"{permitidos} (ahí llega el código de verificación). "
                f"Crea la cuenta con `manage.py staffaccount`."
            ))
