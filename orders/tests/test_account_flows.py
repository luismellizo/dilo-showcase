"""Tests de los flujos sensibles de la cuenta: contraseña olvidada y cambio de
correo.

Esto es la puerta de la cuenta de un comercio: quien la abra ve pedidos,
clientes, teléfonos y comprobantes de pago. Lo que se protege aquí:

- Un enlace sirve UNA vez y vence.
- El token viaja en la URL pero en DB solo queda su SHA-256.
- Cambiar la contraseña quema cualquier otro enlace pendiente.
- Ninguna respuesta permite averiguar si un correo está registrado
  (enumeración de usuarios).
- El correo de acceso se mueve junto con el `username`: en DILO son el mismo
  dato, y separarlos deja al usuario sin poder entrar.

Correo en memoria (locmem): la suite jamás manda un mensaje real.
"""
import pytest
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from orders.models import AccountToken
from orders.services import account_security

RESET = '/api/auth/password-reset/'
RESET_CONFIRM = '/api/auth/password-reset/confirm/'
CHANGE = '/api/auth/email-change/'
CHANGE_CONFIRM = '/api/auth/email-change/confirm/'


@pytest.fixture(autouse=True)
def _entorno(settings):
    settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
    mail.outbox.clear()
    # El throttle de DRF cuenta por IP en cache y TODOS los tests salen de
    # 127.0.0.1: sin limpiar, el sexto test del archivo recibe un 429 que no
    # tiene nada que ver con lo que estaba probando. Subir el rate por settings
    # no sirve — `SimpleRateThrottle.THROTTLE_RATES` se captura al importar.
    from django.core.cache import cache
    cache.clear()


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(
        username='dueno@test.dilo', email='dueno@test.dilo',
        password='ContrasenaVieja1', first_name='Luis',
    )


def _url_token(purpose):
    """El token en claro no se guarda: se saca del enlace que salió por correo."""
    cuerpo = mail.outbox[-1].body
    marca = 'token='
    return cuerpo[cuerpo.index(marca) + len(marca):].split()[0].strip()


# ---------------------------------------------------------------------------
# Contraseña olvidada
# ---------------------------------------------------------------------------

def test_reset_de_correo_desconocido_responde_igual_y_no_manda_nada(api, db):
    r = api.post(RESET, {'email': 'nadie@test.dilo'}, format='json')

    assert r.status_code == 200
    assert r.data['success'] is True
    assert mail.outbox == []          # ni un correo a un buzón que no pidió nada


def test_reset_de_cuenta_real_manda_enlace_y_no_delata_nada(api, user):
    r = api.post(RESET, {'email': 'DUENO@test.dilo'}, format='json')

    assert r.status_code == 200
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ['dueno@test.dilo']
    # La respuesta es idéntica a la del correo inexistente: ese es el punto.
    assert r.data['message'] == \
        'Si el correo está registrado, te enviamos un enlace para crear una contraseña nueva.'

    token = AccountToken.objects.get(purpose=AccountToken.Purpose.PASSWORD_RESET)
    assert token.user == user
    assert len(token.token_hash) == 64                 # sha256 hex
    assert token.token_hash not in mail.outbox[0].body  # en DB va el hash, no el token


def test_reset_cambia_la_contrasena_y_el_enlace_muere(api, user):
    api.post(RESET, {'email': user.email}, format='json')
    raw = _url_token(AccountToken.Purpose.PASSWORD_RESET)

    r = api.post(RESET_CONFIRM, {'token': raw, 'password': 'ContrasenaNueva1'}, format='json')
    assert r.status_code == 200

    assert authenticate(username=user.email, password='ContrasenaNueva1') is not None
    assert authenticate(username=user.email, password='ContrasenaVieja1') is None

    # Segundo intento con el mismo enlace: ya no sirve.
    r2 = api.post(RESET_CONFIRM, {'token': raw, 'password': 'OtraMas12345'}, format='json')
    assert r2.status_code == 400
    assert authenticate(username=user.email, password='ContrasenaNueva1') is not None


def test_reset_avisa_al_usuario_que_su_contrasena_cambio(api, user):
    api.post(RESET, {'email': user.email}, format='json')
    raw = _url_token(AccountToken.Purpose.PASSWORD_RESET)
    mail.outbox.clear()

    api.post(RESET_CONFIRM, {'token': raw, 'password': 'ContrasenaNueva1'}, format='json')

    assert len(mail.outbox) == 1
    assert 'contraseña' in mail.outbox[0].subject.lower()


def test_reset_vencido_devuelve_410(api, user):
    token, raw = account_security.issue_token(user, AccountToken.Purpose.PASSWORD_RESET)
    AccountToken.objects.filter(pk=token.pk).update(expires_at=timezone.now())

    r = api.post(RESET_CONFIRM, {'token': raw, 'password': 'ContrasenaNueva1'}, format='json')

    assert r.status_code == 410
    assert r.data['expired'] is True


def test_reset_rechaza_contrasenas_cortas(api, user):
    _, raw = account_security.issue_token(user, AccountToken.Purpose.PASSWORD_RESET)

    r = api.post(RESET_CONFIRM, {'token': raw, 'password': 'corta'}, format='json')

    assert r.status_code == 400
    # El token NO se consume por un error de forma: el usuario reintenta.
    assert AccountToken.objects.get(pk=_ultimo_token().pk).consumed_at is None


def test_pedir_un_reset_nuevo_invalida_el_anterior(api, user):
    _, viejo = account_security.issue_token(user, AccountToken.Purpose.PASSWORD_RESET)
    _, nuevo = account_security.issue_token(user, AccountToken.Purpose.PASSWORD_RESET)

    assert api.post(RESET_CONFIRM, {'token': viejo, 'password': 'ContrasenaNueva1'},
                    format='json').status_code == 410
    assert api.post(RESET_CONFIRM, {'token': nuevo, 'password': 'ContrasenaNueva1'},
                    format='json').status_code == 200


def test_cambiar_contrasena_quema_el_cambio_de_correo_pendiente(api, user):
    """Si el reset lo pidió un atacante, no le dejamos abierta la otra puerta."""
    _, correo_token = account_security.issue_token(
        user, AccountToken.Purpose.EMAIL_CHANGE, new_email='nuevo@test.dilo')
    _, reset_token = account_security.issue_token(
        user, AccountToken.Purpose.PASSWORD_RESET)

    api.post(RESET_CONFIRM, {'token': reset_token, 'password': 'ContrasenaNueva1'},
             format='json')

    r = api.post(CHANGE_CONFIRM, {'token': correo_token}, format='json')
    assert r.status_code == 410
    user.refresh_from_db()
    assert user.email == 'dueno@test.dilo'


def _ultimo_token():
    return AccountToken.objects.order_by('-created_at').first()


# ---------------------------------------------------------------------------
# Cambio de correo
# ---------------------------------------------------------------------------

def test_cambio_de_correo_exige_sesion(api, db):
    assert api.post(CHANGE, {'new_email': 'nuevo@test.dilo'}, format='json').status_code == 401


def test_cambio_de_correo_exige_la_contrasena_actual(api, user):
    api.force_authenticate(user=user)

    r = api.post(CHANGE, {'new_email': 'nuevo@test.dilo', 'password': 'equivocada'},
                 format='json')

    assert r.status_code == 401
    assert mail.outbox == []


def test_cambio_de_correo_manda_confirmacion_al_nuevo_y_aviso_al_viejo(api, user):
    api.force_authenticate(user=user)

    r = api.post(CHANGE, {'new_email': 'Nuevo@Test.Dilo', 'password': 'ContrasenaVieja1'},
                 format='json')

    assert r.status_code == 200
    destinatarios = [m.to[0] for m in mail.outbox]
    assert 'nuevo@test.dilo' in destinatarios      # confirmación (normalizado)
    assert 'dueno@test.dilo' in destinatarios      # alarma del dueño legítimo
    # Nada cambió todavía: el correo viejo sigue siendo el de acceso.
    user.refresh_from_db()
    assert user.email == 'dueno@test.dilo'


def test_confirmar_mueve_correo_y_username(api, user):
    api.force_authenticate(user=user)
    api.post(CHANGE, {'new_email': 'nuevo@test.dilo', 'password': 'ContrasenaVieja1'},
             format='json')
    raw = [m for m in mail.outbox if m.to == ['nuevo@test.dilo']][0].body
    raw = raw[raw.index('token=') + 6:].split()[0].strip()

    r = APIClient().post(CHANGE_CONFIRM, {'token': raw}, format='json')

    assert r.status_code == 200
    user.refresh_from_db()
    assert user.email == 'nuevo@test.dilo'
    # username == email en DILO: si no se mueve, el usuario no vuelve a entrar.
    assert user.username == 'nuevo@test.dilo'
    assert authenticate(username='nuevo@test.dilo', password='ContrasenaVieja1') is not None


def test_correo_ya_registrado_responde_igual_pero_no_emite_token(api, user, db):
    User.objects.create_user(username='ocupado@test.dilo', email='ocupado@test.dilo',
                             password='x')
    api.force_authenticate(user=user)

    r = api.post(CHANGE, {'new_email': 'ocupado@test.dilo', 'password': 'ContrasenaVieja1'},
                 format='json')

    assert r.status_code == 200          # no se delata que la cuenta existe
    assert mail.outbox == []
    assert not AccountToken.objects.filter(
        purpose=AccountToken.Purpose.EMAIL_CHANGE).exists()


def test_confirmar_cuando_el_correo_fue_tomado_mientras_tanto_da_409(api, user, db):
    _, raw = account_security.issue_token(
        user, AccountToken.Purpose.EMAIL_CHANGE, new_email='nuevo@test.dilo')
    User.objects.create_user(username='nuevo@test.dilo', email='nuevo@test.dilo',
                             password='x')

    r = api.post(CHANGE_CONFIRM, {'token': raw}, format='json')

    assert r.status_code == 409
    user.refresh_from_db()
    assert user.email == 'dueno@test.dilo'


def test_cuenta_de_google_cambia_correo_sin_contrasena(api, db):
    """Las cuentas creadas con Google no tienen contraseña utilizable: exigirla
    las dejaría sin forma de cambiar el correo."""
    google = User.objects.create_user(username='g@test.dilo', email='g@test.dilo')
    google.set_unusable_password()
    google.save()
    api.force_authenticate(user=google)

    r = api.post(CHANGE, {'new_email': 'nuevo@test.dilo'}, format='json')

    assert r.status_code == 200
    assert AccountToken.objects.filter(
        purpose=AccountToken.Purpose.EMAIL_CHANGE, new_email='nuevo@test.dilo').exists()


def test_token_de_un_proposito_no_sirve_para_el_otro(api, user):
    """Un enlace de cambio de correo NO puede canjearse por una contraseña
    nueva: serían dos puertas con la misma llave."""
    _, raw = account_security.issue_token(
        user, AccountToken.Purpose.EMAIL_CHANGE, new_email='nuevo@test.dilo')

    r = api.post(RESET_CONFIRM, {'token': raw, 'password': 'ContrasenaNueva1'}, format='json')

    assert r.status_code == 400
    assert authenticate(username=user.email, password='ContrasenaVieja1') is not None
