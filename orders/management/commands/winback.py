"""
Dispara la recompra automática (win-back) manualmente.

Uso:
    python manage.py winback           # ejecuta y reporta
"""
from django.core.management.base import BaseCommand
from orders.tasks import winback_inactive_customers


class Command(BaseCommand):
    help = "Re-contacta clientes inactivos (recompra automática)."

    def handle(self, *args, **options):
        result = winback_inactive_customers()
        self.stdout.write(self.style.SUCCESS(
            f"Win-back ejecutado: {result['sent']} enviados, {result['skipped']} omitidos"
        ))
