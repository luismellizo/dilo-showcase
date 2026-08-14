"""
Configuración de Celery para whatsapp_orders.

Este módulo inicializa la aplicación de Celery y la configura
para descubrir tareas automáticamente en todas las apps de Django.
"""

import os
from celery import Celery

# Configurar settings de Django por defecto
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'whatsapp_orders.settings')

# Crear aplicación de Celery
app = Celery('whatsapp_orders')

# Cargar configuración desde Django settings (namespace='CELERY')
# Esto significa que todas las variables CELERY_* en settings.py serán usadas
app.config_from_object('django.conf:settings', namespace='CELERY')

# Descubrir tareas automáticamente en todas las apps Django
# Busca archivos tasks.py en cada app instalada
app.autodiscover_tasks()

# Tareas programadas (Celery Beat). Requiere un proceso beat:
#   celery -A whatsapp_orders worker -B -l info   (worker + beat embebido, dev)
#   o un proceso separado:  celery -A whatsapp_orders beat -l info  (prod)
from celery.schedules import crontab  # noqa: E402

app.conf.beat_schedule = {
    'winback-clientes-inactivos': {
        'task': 'orders.tasks.winback_inactive_customers',
        'schedule': crontab(hour=15, minute=0),  # diario 15:00 (hora del server / America/Bogota)
    },
}


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    """Tarea de debugging para verificar que Celery funciona."""
    print(f'Request: {self.request!r}')
