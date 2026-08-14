"""Tests de la puerta del panel interno — /api/staff/login/ (+ /verify/).

Es la unica via de acceso al panel /admin, asi que lo que se protege aqui es
el control total de la plataforma: config de todas las tiendas, planes e
impersonation. Se testea explicito que:

- Solo entran correos del dominio del equipo (@dilo.example.com).
- Ningun fallo revela informacion (mismo 401 para email inexistente, password
  mala, dominio ajeno, cuenta inactiva y cuenta de comercio sin rol).
- El paso 1 NO emite sesion: hace falta el codigo que llega por correo.
- El codigo vence a los 3 minutos, sirve una sola vez y se agota a intentos.
- Un token del login de comercios NO abre el panel (si no, el 2FA seria
  decorativo).
- Todo intento, exitoso o fallido, queda en AuditLog con IP.
"""
import re

import pytest
from django.contrib.auth.models import Group, User
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from orders.models import AuditLog, StaffLoginChallenge
from orders.staff_views import STAFF_SESSION_HOURS

LOGIN_URL = "/api/staff/login/"
VERIFY_URL = "/api/staff/login/verify/"
PASSWORD = "s3cr3t-de-panel"


@pytest.fixture(autouse=True)
def _reset_throttle():
    """El throttle cuenta por IP en la cache de Django, compartida entre tests:
    sin limpiarla, los tests posteriores heredan intentos ajenos y reciben 429.
    (No se desactiva el rate: `test_endpoints_tienen_throttle_propio` lo vigila.)"""
    from django.core.cache import cache
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _smtp_en_memoria(settings):
    settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
    mail.outbox.clear()


@pytest.fixture
def staff_user(db):
    user = User.objects.create_user(
        username="admin@dilo.example.com", email="admin@dilo.example.com", password=PASSWORD)
    group, _ = Group.objects.get_or_create(name="dilo_admin")
    user.groups.add(group)
    return user


def _login(email, password):
    return APIClient().post(LOGIN_URL, {"email": email, "password": password}, format="json")


def _verify(challenge_id, code):
    return APIClient().post(
        VERIFY_URL, {"challenge_id": challenge_id, "code": code}, format="json")


def _codigo_del_correo():
    """Extrae el codigo de 6 digitos del ultimo correo enviado."""
    assert mail.outbox, "no se envio ningun correo"
    return re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)


def _sesion_completa(email=None, password=PASSWORD):
    """Recorre los dos pasos y devuelve la respuesta del verify."""
    resp = _login(email or "admin@dilo.example.com", password)
    assert resp.status_code == 200, resp.content
    return _verify(resp.json()["challenge_id"], _codigo_del_correo())


# --------------------------------------------------------------------------
# Paso 1 — credenciales
# --------------------------------------------------------------------------

@pytest.mark.django_db
def test_paso1_no_entrega_sesion_solo_dispara_el_codigo(staff_user):
    resp = _login("admin@dilo.example.com", PASSWORD)

    assert resp.status_code == 200
    body = resp.json()
    assert body["mfa_required"] is True
    assert body["challenge_id"]
    assert body["expires_in"] <= 180
    # Lo critico: sin codigo no hay token.
    assert "access" not in body
    assert len(mail.outbox) == 1


@pytest.mark.django_db
def test_el_correo_lleva_el_codigo_y_no_lo_guarda_en_claro(staff_user):
    _login("admin@dilo.example.com", PASSWORD)

    code = _codigo_del_correo()
    challenge = StaffLoginChallenge.objects.get()
    assert mail.outbox[0].to == ["admin@dilo.example.com"]
    assert code in mail.outbox[0].subject      # visible sin abrir el correo
    assert code not in challenge.code_hash     # en DB va hasheado
    assert challenge.code_hash != code


@pytest.mark.django_db
def test_email_hint_no_dicta_la_direccion_completa(staff_user):
    hint = _login("admin@dilo.example.com", PASSWORD).json()["email_hint"]

    assert hint.endswith("@dilo.example.com")
    assert "admin@dilo.example.com" != hint
    assert "•" in hint


@pytest.mark.django_db
def test_dominio_ajeno_no_entra_ni_recibe_codigo(db):
    """Un admin con correo personal queda fuera aunque tenga rol y contraseña."""
    user = User.objects.create_user(
        username="luis@gmail.com", email="luis@gmail.com", password=PASSWORD)
    group, _ = Group.objects.get_or_create(name="dilo_admin")
    user.groups.add(group)

    resp = _login("luis@gmail.com", PASSWORD)

    assert resp.status_code == 401
    assert mail.outbox == []
    assert StaffLoginChallenge.objects.count() == 0


@pytest.mark.django_db
def test_password_incorrecta_da_401_generico_sin_codigo(staff_user):
    resp = _login("admin@dilo.example.com", "otra-cosa")

    assert resp.status_code == 401
    assert resp.json() == {"error": "Credenciales inválidas"}
    assert mail.outbox == []


@pytest.mark.django_db
def test_no_enumera_usuarios(staff_user):
    """Email inexistente, dominio ajeno y password mala son indistinguibles."""
    inexistente = _login("nadie@dilo.example.com", PASSWORD)
    password_mala = _login("admin@dilo.example.com", "no-es")
    dominio_ajeno = _login("quien@otra.com", PASSWORD)

    codigos = {inexistente.status_code, password_mala.status_code, dominio_ajeno.status_code}
    cuerpos = {inexistente.content, password_mala.content, dominio_ajeno.content}
    assert codigos == {401}
    assert len(cuerpos) == 1


@pytest.mark.django_db
def test_cuenta_de_comercio_no_entra_al_panel(make_user):
    owner = make_user(email="tienda@dilo.example.com")
    owner.set_password("clave-comercio")
    owner.save()

    resp = _login("tienda@dilo.example.com", "clave-comercio")

    assert resp.status_code == 401
    assert mail.outbox == []


@pytest.mark.django_db
def test_cuenta_staff_inactiva_no_entra(staff_user):
    staff_user.is_active = False
    staff_user.save()

    assert _login("admin@dilo.example.com", PASSWORD).status_code == 401
    assert mail.outbox == []


@pytest.mark.django_db
def test_faltan_campos(staff_user):
    assert _login("admin@dilo.example.com", "").status_code == 401
    assert _login("", PASSWORD).status_code == 401


@pytest.mark.django_db
def test_correo_caido_no_deja_desafio_huerfano(staff_user, monkeypatch):
    """Si el SMTP falla, el login responde 503 (no un silencio) y no queda un
    desafio que nadie podra completar."""
    monkeypatch.setattr("orders.services.staff_mfa.send_code_email", lambda *a, **k: False)

    resp = _login("admin@dilo.example.com", PASSWORD)

    assert resp.status_code == 503
    assert StaffLoginChallenge.objects.count() == 0


# --------------------------------------------------------------------------
# Paso 2 — código
# --------------------------------------------------------------------------

@pytest.mark.django_db
def test_codigo_correcto_abre_la_sesion(staff_user):
    resp = _sesion_completa()

    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "admin"
    assert body["expires_in"] == STAFF_SESSION_HOURS * 3600
    assert body["access"]
    assert "refresh" not in body               # la sesion del panel muere sola
    assert AccessToken(body["access"])["staff"] == "admin"


@pytest.mark.django_db
def test_el_token_del_panel_abre_los_endpoints_staff(staff_user):
    token = _sesion_completa().json()["access"]

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    resp = client.get("/api/staff/me/")

    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


@pytest.mark.django_db
def test_token_sin_segundo_factor_no_abre_el_panel(staff_user):
    """Un token del login de comercios pertenece a la MISMA cuenta admin pero
    no paso por el codigo: si abriera el panel, el 2FA seria decorativo."""
    token = RefreshToken.for_user(staff_user).access_token

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    assert client.get("/api/staff/me/").status_code == 403
    assert client.get("/api/staff/overview/").status_code == 403


@pytest.mark.django_db
def test_codigo_incorrecto_no_abre_sesion(staff_user):
    challenge_id = _login("admin@dilo.example.com", PASSWORD).json()["challenge_id"]

    resp = _verify(challenge_id, "000000" if _codigo_del_correo() != "000000" else "111111")

    assert resp.status_code == 401
    assert "access" not in resp.json()


@pytest.mark.django_db
def test_codigo_es_de_un_solo_uso(staff_user):
    challenge_id = _login("admin@dilo.example.com", PASSWORD).json()["challenge_id"]
    code = _codigo_del_correo()

    assert _verify(challenge_id, code).status_code == 200
    assert _verify(challenge_id, code).status_code == 401   # replay


@pytest.mark.django_db
def test_codigo_vencido_pide_uno_nuevo(staff_user):
    challenge_id = _login("admin@dilo.example.com", PASSWORD).json()["challenge_id"]
    code = _codigo_del_correo()
    StaffLoginChallenge.objects.filter(id=challenge_id).update(expires_at=timezone.now())

    resp = _verify(challenge_id, code)

    assert resp.status_code == 410
    assert resp.json()["expired"] is True    # la UI ofrece reenviar, no reintentar


@pytest.mark.django_db
def test_codigo_se_quema_tras_los_intentos_permitidos(staff_user, settings):
    settings.STAFF_MFA_MAX_ATTEMPTS = 3
    challenge_id = _login("admin@dilo.example.com", PASSWORD).json()["challenge_id"]
    code = _codigo_del_correo()
    malo = "999999" if code != "999999" else "888888"

    for _ in range(3):
        assert _verify(challenge_id, malo).status_code == 401

    # Ni con el codigo bueno: 6 digitos sin tope de intentos son papel.
    assert _verify(challenge_id, code).status_code == 401


@pytest.mark.django_db
def test_pedir_otro_codigo_invalida_el_anterior(staff_user):
    primero = _login("admin@dilo.example.com", PASSWORD).json()["challenge_id"]
    code_viejo = _codigo_del_correo()
    segundo = _login("admin@dilo.example.com", PASSWORD).json()["challenge_id"]
    code_nuevo = _codigo_del_correo()

    assert primero != segundo
    assert _verify(primero, code_viejo).status_code == 410   # vencido a la fuerza
    assert _verify(segundo, code_nuevo).status_code == 200


@pytest.mark.django_db
def test_challenge_id_basura_no_revienta(staff_user):
    assert _verify("no-es-un-uuid", "123456").status_code == 401
    assert _verify("", "123456").status_code == 401


@pytest.mark.django_db
def test_rol_revocado_durante_la_ventana_del_codigo(staff_user):
    """El rol se relee al canjear: un token no debe nacer con permiso muerto."""
    challenge_id = _login("admin@dilo.example.com", PASSWORD).json()["challenge_id"]
    code = _codigo_del_correo()
    staff_user.groups.clear()

    assert _verify(challenge_id, code).status_code == 401


# --------------------------------------------------------------------------
# Auditoría y defensas
# --------------------------------------------------------------------------

@pytest.mark.django_db
def test_login_completo_queda_auditado_en_sus_dos_pasos(staff_user):
    _sesion_completa()

    logs = list(AuditLog.objects.filter(action=AuditLog.Action.STAFF_LOGIN).order_by('created_at'))
    pasos = [log.detail.get('paso') for log in logs]
    assert pasos == ['codigo_enviado', 'sesion_iniciada']
    assert all(log.actor == staff_user and log.ip_address for log in logs)


@pytest.mark.django_db
def test_intento_fallido_queda_auditado(staff_user):
    _login("intruso@dilo.example.com", "adivinando")

    log = AuditLog.objects.get(action=AuditLog.Action.STAFF_LOGIN)
    assert log.actor is None                      # no hubo cuenta que atribuir
    assert log.actor_email == "intruso@dilo.example.com"
    assert log.detail["ok"] is False
    assert log.detail["motivo"] == "credenciales_invalidas"


@pytest.mark.django_db
def test_dominio_ajeno_queda_auditado_como_tal(db):
    _login("quien@otra.com", "loquesea")

    log = AuditLog.objects.get(action=AuditLog.Action.STAFF_LOGIN)
    assert log.detail["motivo"] == "dominio_no_autorizado"


@pytest.mark.django_db
def test_endpoints_tienen_throttle_propio():
    """Los scopes agresivos son la defensa contra fuerza bruta (contraseña y
    codigo de 6 digitos): si alguien los quita, este test cae."""
    from orders.staff_views import StaffLoginView, StaffLoginVerifyView
    assert StaffLoginView.throttle_scope == 'staff_login'
    assert StaffLoginVerifyView.throttle_scope == 'staff_mfa'


@pytest.mark.django_db
def test_me_responde_para_cuenta_staff_sin_tienda(staff_user):
    """El frontend llama /api/auth/me/ apenas entra al panel: una cuenta
    dedicada no tiene tienda ni UserProfile y aun asi debe responder 200
    (si no, la sesion staff moriria al instante)."""
    token = _sesion_completa().json()["access"]
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    resp = client.get("/api/auth/me/")

    assert resp.status_code == 200
    body = resp.json()
    assert body["staff_role"] == "admin"
    assert not body.get("store")   # jamas se le provisiona tienda ni trial
