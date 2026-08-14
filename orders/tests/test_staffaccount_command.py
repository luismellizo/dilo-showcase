"""Tests del comando `staffaccount` — creacion de cuentas del equipo interno.

Crea las llaves del panel que controla TODAS las tiendas, asi que se verifica
que el rol quede realmente asignado y que la cuenta pueda entrar por
/api/staff/login/ de punta a punta.
"""
import re

import pytest
from django.contrib.auth.models import User
from django.core import mail
from django.core.management import CommandError, call_command
from rest_framework.test import APIClient

from orders.staff_permissions import staff_role

PASSWORD = "Panel-Interno-2026!"


@pytest.fixture(autouse=True)
def _password_por_env(monkeypatch):
    """Evita el prompt interactivo de getpass dentro de los tests."""
    monkeypatch.setenv("STAFF_PASSWORD", PASSWORD)


@pytest.fixture(autouse=True)
def _reset_throttle():
    from django.core.cache import cache
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
def test_crea_cuenta_con_rol_admin():
    call_command("staffaccount", "nuevo@dilo.example.com")

    user = User.objects.get(username="nuevo@dilo.example.com")
    assert user.is_active
    assert staff_role(user) == "admin"
    assert user.check_password(PASSWORD)
    # Cuenta dedicada: administra la plataforma, no vende.
    assert not hasattr(user, "store")


@pytest.mark.django_db
def test_rol_explicito_y_no_toca_django_admin_por_defecto():
    call_command("staffaccount", "soporte@dilo.example.com", "--role", "soporte")

    user = User.objects.get(username="soporte@dilo.example.com")
    assert staff_role(user) == "soporte"
    assert not user.is_superuser and not user.is_staff


@pytest.mark.django_db
def test_flag_django_admin_eleva_la_cuenta():
    call_command("staffaccount", "root@dilo.example.com", "--django-admin")

    user = User.objects.get(username="root@dilo.example.com")
    assert user.is_staff and user.is_superuser


@pytest.mark.django_db
def test_reejecutar_cambia_rol_sin_duplicar_cuenta():
    call_command("staffaccount", "mueve@dilo.example.com", "--role", "admin")
    call_command("staffaccount", "mueve@dilo.example.com", "--role", "lectura")

    assert User.objects.filter(username="mueve@dilo.example.com").count() == 1
    assert staff_role(User.objects.get(username="mueve@dilo.example.com")) == "lectura"


@pytest.mark.django_db
def test_rechaza_password_debil(monkeypatch):
    monkeypatch.setenv("STAFF_PASSWORD", "1234")

    with pytest.raises(CommandError):
        call_command("staffaccount", "debil@dilo.example.com")
    assert not User.objects.filter(username="debil@dilo.example.com").exists()


@pytest.mark.django_db
def test_rechaza_dominio_fuera_del_equipo():
    """Crear la cuenta con un correo personal produciria una cuenta muerta:
    `staff_role` la ignora y el codigo del panel iria a un buzon ajeno."""
    with pytest.raises(CommandError):
        call_command("staffaccount", "luis@gmail.com")
    assert not User.objects.filter(username="luis@gmail.com").exists()


@pytest.mark.django_db
def test_la_cuenta_creada_entra_al_panel(settings):
    """Recorrido completo: comando → credenciales → codigo por correo → sesion."""
    settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
    mail.outbox.clear()
    call_command("staffaccount", "e2e@dilo.example.com")

    client = APIClient()
    paso1 = client.post("/api/staff/login/",
                        {"email": "e2e@dilo.example.com", "password": PASSWORD}, format="json")
    assert paso1.status_code == 200
    assert paso1.json()["mfa_required"] is True

    code = re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)
    paso2 = client.post("/api/staff/login/verify/",
                        {"challenge_id": paso1.json()["challenge_id"], "code": code},
                        format="json")

    assert paso2.status_code == 200
    assert paso2.json()["role"] == "admin"
