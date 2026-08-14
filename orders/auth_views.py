"""
Vistas de autenticación para DILO.
Implementa registro con verificación OTP por WhatsApp y login con JWT.
"""
import logging
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth.models import User
from django.contrib.auth import authenticate
from django.conf import settings
from .models import UserProfile

logger = logging.getLogger(__name__)


def get_or_create_store_for(user):
    """
    Garantiza que el usuario tenga SU tienda (1 cuenta = 1 restaurante).

    Se llama al verificar la cuenta y como red de seguridad en /me, de modo
    que ninguna cuenta quede sin restaurante. El nombre se deriva del nombre
    del usuario; el número de negocio se conecta luego vía Embedded Signup.
    """
    from django.db import IntegrityError, transaction
    from .models import Store

    store = Store.objects.filter(owner=user).first()
    if store:
        return store

    default_name = (user.get_full_name() or '').strip() or 'Mi Restaurante'
    try:
        with transaction.atomic():
            store = Store.objects.create(owner=user, name=default_name)
    except IntegrityError:
        # Carrera: otra request concurrente (ej. /verify y /me a la vez) ya
        # creó la tienda de este owner (owner es unique a nivel DB). Usamos
        # la que ganó la carrera en vez de fallar.
        return Store.objects.get(owner=user)

    # Toda tienda nueva arranca con trial (Plan Pro, TRIAL_DAYS días).
    from .billing import get_or_create_subscription
    get_or_create_subscription(store)
    return store


class RegisterView(APIView):
    """
    Registra un nuevo usuario y envía OTP por WhatsApp.
    
    POST /api/auth/register/
    {
        "email": "user@example.com",
        "password": "securepassword",
        "name": "John Doe",
        "whatsapp": "+573001234567"
    }
    """
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'otp'

    def post(self, request):
        email = request.data.get('email', '').strip().lower()
        password = request.data.get('password', '')
        name = request.data.get('name', '').strip()
        whatsapp = request.data.get('whatsapp', '').strip()

        # Validaciones
        if not email or not password or not whatsapp:
            return Response(
                {'error': 'Email, contraseña y WhatsApp son requeridos'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if len(password) < 8:
            return Response(
                {'error': 'La contraseña debe tener al menos 8 caracteres'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Verificar si el email ya existe
        if User.objects.filter(email=email).exists():
            return Response(
                {'error': 'Este email ya está registrado'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Verificar si el WhatsApp ya existe
        if UserProfile.objects.filter(whatsapp_number=whatsapp).exists():
            return Response(
                {'error': 'Este número de WhatsApp ya está registrado'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # Crear usuario (inactivo hasta verificar OTP)
            user = User.objects.create_user(
                username=email,
                email=email,
                password=password,
                first_name=name.split()[0] if name else '',
                last_name=' '.join(name.split()[1:]) if name and len(name.split()) > 1 else '',
                is_active=False  # Inactivo hasta verificar WhatsApp
            )

            # Crear perfil con WhatsApp
            profile = UserProfile.objects.create(
                user=user,
                whatsapp_number=whatsapp
            )

            # Generar y enviar OTP
            otp = profile.generate_otp()
            self._send_otp_whatsapp(whatsapp, otp)

            logger.info(f"✅ Usuario registrado: {email}, OTP enviado a {whatsapp}")

            return Response({
                'success': True,
                'message': 'Código de verificación enviado a tu WhatsApp',
                'email': email
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            logger.error(f"❌ Error en registro: {e}", exc_info=True)
            return Response(
                {'error': 'Error al crear la cuenta'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def _send_otp_whatsapp(self, phone_number, otp):
        """
        Envía el código OTP por WhatsApp.
        Si WhatsApp no está configurado, solo muestra en logs.
        """
        message = f"🔐 Tu código de verificación DILO es: *{otp}*\n\nEste código expira en 10 minutos."

        # Verificar si WhatsApp está configurado
        token = getattr(settings, 'WHATSAPP_API_TOKEN', None)
        phone_id = getattr(settings, 'WHATSAPP_PHONE_NUMBER_ID', None)

        if not token or not phone_id:
            # WhatsApp no configurado, mostrar en consola
            logger.warning(f"⚠️ WhatsApp no configurado. OTP para {phone_number}: {otp}")
            print(f"\n{'='*50}")
            print(f"📱 OTP para {phone_number}: {otp}")
            print(f"{'='*50}\n")
            return

        # Enviar por WhatsApp API
        try:
            import requests
            # La versión de la Graph API vive en un solo sitio: hardcodearla
            # aquí dejó este envío en v18.0 (sep-2023), ya fuera de soporte.
            from .services.whatsapp_service import META_GRAPH_API_BASE
            url = f"{META_GRAPH_API_BASE}/{phone_id}/messages"
            headers = {
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json'
            }
            data = {
                'messaging_product': 'whatsapp',
                'to': phone_number.replace('+', ''),
                'type': 'text',
                'text': {'body': message}
            }
            response = requests.post(url, headers=headers, json=data, timeout=10)
            if response.ok:
                logger.info(f"✅ OTP enviado por WhatsApp a {phone_number}")
            else:
                logger.error(f"❌ Error enviando OTP: {response.text}")
                # Fallback a logs
                print(f"\n{'='*50}")
                print(f"📱 OTP para {phone_number}: {otp}")
                print(f"{'='*50}\n")
        except Exception as e:
            logger.error(f"❌ Error en WhatsApp API: {e}")
            print(f"\n{'='*50}")
            print(f"📱 OTP para {phone_number}: {otp}")
            print(f"{'='*50}\n")


class VerifyOTPView(APIView):
    """
    Verifica el código OTP y activa la cuenta.
    
    POST /api/auth/verify/
    {
        "email": "user@example.com",
        "otp": "123456"
    }
    """
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'otp'

    def post(self, request):
        email = request.data.get('email', '').strip().lower()
        otp = request.data.get('otp', '').strip()

        if not email or not otp:
            return Response(
                {'error': 'Email y código OTP son requeridos'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
            profile = user.profile
        except (User.DoesNotExist, UserProfile.DoesNotExist):
            return Response(
                {'error': 'Usuario no encontrado'},
                status=status.HTTP_404_NOT_FOUND
            )

        if profile.verify_otp(otp):
            # Activar usuario
            user.is_active = True
            user.save()

            # Provisionar la tienda del usuario (1 cuenta = 1 restaurante).
            store = get_or_create_store_for(user)

            # Generar tokens JWT
            refresh = RefreshToken.for_user(user)

            logger.info(f"✅ Usuario verificado: {email}, tienda {store.id}")

            return Response({
                'success': True,
                'message': 'Cuenta verificada exitosamente',
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'user': {
                    'email': user.email,
                    'name': user.get_full_name(),
                    'whatsapp': profile.whatsapp_number
                },
                'store': {
                    'id': str(store.id),
                    'name': store.name,
                    'whatsapp_number': store.whatsapp_number,
                    'theme_color': store.theme_color,
                    'onboarding_completed': store.onboarding_completed
                }
            })
        else:
            return Response(
                {'error': 'Código inválido o expirado'},
                status=status.HTTP_400_BAD_REQUEST
            )


class ResendOTPView(APIView):
    """
    Reenvía el código OTP.
    
    POST /api/auth/resend-otp/
    {
        "email": "user@example.com"
    }
    """
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'otp'

    def post(self, request):
        email = request.data.get('email', '').strip().lower()

        if not email:
            return Response(
                {'error': 'Email es requerido'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
            profile = user.profile
        except (User.DoesNotExist, UserProfile.DoesNotExist):
            return Response(
                {'error': 'Usuario no encontrado'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Generar nuevo OTP
        otp = profile.generate_otp()
        RegisterView()._send_otp_whatsapp(profile.whatsapp_number, otp)

        return Response({
            'success': True,
            'message': 'Código reenviado'
        })


class LoginView(APIView):
    """
    Login con email y contraseña.
    
    POST /api/auth/login/
    {
        "email": "user@example.com",
        "password": "securepassword"
    }
    """
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'otp'

    def post(self, request):
        email = request.data.get('email', '').strip().lower()
        password = request.data.get('password', '')

        if not email or not password:
            return Response(
                {'error': 'Email y contraseña son requeridos'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Autenticar usuario
        user = authenticate(username=email, password=password)

        if not user:
            return Response(
                {'error': 'Credenciales inválidas'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        if not user.is_active:
            # Usuario no verificado, reenviar OTP
            try:
                profile = user.profile
                otp = profile.generate_otp()
                RegisterView()._send_otp_whatsapp(profile.whatsapp_number, otp)
                return Response({
                    'error': 'Cuenta no verificada',
                    'needs_verification': True,
                    'email': email
                }, status=status.HTTP_403_FORBIDDEN)
            except UserProfile.DoesNotExist:
                return Response(
                    {'error': 'Cuenta incompleta'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        # Generar tokens JWT
        refresh = RefreshToken.for_user(user)

        logger.info(f"✅ Login exitoso: {email}")

        return Response({
            'success': True,
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': {
                'email': user.email,
                'name': user.get_full_name(),
                'whatsapp': user.profile.whatsapp_number if hasattr(user, 'profile') else ''
            }
        })


class GoogleLoginView(APIView):
    """
    Login / registro con Google (Google Identity Services).

    POST /api/auth/google/
    { "credential": "<ID token JWT emitido por Google>" }

    El frontend obtiene el credential con el botón oficial de GIS y lo manda
    aquí. Se verifica la firma contra los certificados públicos de Google y
    que el aud sea NUESTRO client_id — jamás se confía en el payload sin
    verificar. Si el email no existe, se crea la cuenta (sin contraseña
    utilizable y sin UserProfile: no hay WhatsApp que verificar) y su tienda
    con trial, igual que el flujo de OTP.
    """
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'otp'

    def post(self, request):
        credential = (request.data.get('credential') or '').strip()
        if not credential:
            return Response({'error': 'credential es requerido'},
                            status=status.HTTP_400_BAD_REQUEST)

        client_id = settings.GOOGLE_OAUTH_CLIENT_ID
        if not client_id:
            return Response({'error': 'Login con Google no está configurado'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)

        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
        try:
            info = google_id_token.verify_oauth2_token(
                credential, google_requests.Request(), client_id)
        except ValueError:
            logger.warning("Google login: ID token inválido o expirado")
            return Response({'error': 'Token de Google inválido'},
                            status=status.HTTP_401_UNAUTHORIZED)

        if not info.get('email_verified'):
            return Response({'error': 'El email de Google no está verificado'},
                            status=status.HTTP_401_UNAUTHORIZED)

        email = info['email'].strip().lower()
        user = User.objects.filter(username=email).first()
        if user is None:
            user = User.objects.create_user(
                username=email,
                email=email,
                first_name=(info.get('given_name') or info.get('name') or '')[:150],
                last_name=(info.get('family_name') or '')[:150],
            )
            user.set_unusable_password()
            user.is_active = True
            user.save()
            logger.info(f"✅ Cuenta creada vía Google: {email}")
        elif not user.is_active:
            # Cuenta registrada por OTP que nunca verificó: Google ya
            # verificó la identidad del email, se activa.
            user.is_active = True
            user.save()

        # Misma provisión que el verify de OTP (tienda + trial). Cuentas del
        # equipo interno sin tienda no provisionan (igual que MeView).
        from .staff_permissions import staff_role
        from .models import Store
        store = Store.objects.filter(owner=user).first()
        if store is None and staff_role(user) is None:
            store = get_or_create_store_for(user)

        refresh = RefreshToken.for_user(user)
        profile = getattr(user, 'profile', None)
        logger.info(f"✅ Login con Google: {email}")

        return Response({
            'success': True,
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': {
                'email': user.email,
                'name': user.get_full_name(),
                'whatsapp': profile.whatsapp_number if profile else ''
            },
            'store': {
                'id': str(store.id),
                'name': store.name,
                'whatsapp_number': store.whatsapp_number,
                'theme_color': store.theme_color,
                'onboarding_completed': store.onboarding_completed
            } if store else None
        })


class MeView(APIView):
    """
    Retorna datos del usuario autenticado.
    
    GET /api/auth/me/
    Headers: Authorization: Bearer <access_token>
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        profile = getattr(user, 'profile', None)

        from .staff_permissions import staff_role
        role = staff_role(user)

        # Red de seguridad: garantizar que el usuario siempre tenga su tienda.
        # Excepción: cuentas del equipo interno sin tienda NO deben provisionar
        # una tienda + trial fantasma solo por consultar /me.
        from .models import Store
        store = Store.objects.filter(owner=user).first()
        if store is None and role is None:
            store = get_or_create_store_for(user)

        from .billing import subscription_summary

        return Response({
            'email': user.email,
            'name': user.get_full_name(),
            'whatsapp': profile.whatsapp_number if profile else '',
            'is_verified': profile.is_whatsapp_verified if profile else False,
            'staff_role': role,
            'store': {
                'id': str(store.id),
                'name': store.name,
                'whatsapp_number': store.whatsapp_number,
                'theme_color': store.theme_color,
                'onboarding_completed': store.onboarding_completed
            } if store else None,
            'subscription': subscription_summary(store) if store else None
        })


# ---------------------------------------------------------------------------
# Contraseña olvidada y cambio de correo
#
# Ambos flujos se apoyan en `services/account_security.py`: enlace de un solo
# uso, hasheado en DB, con vencimiento. Las vistas solo mandan y validan.
#
# Regla transversal: NINGUNA respuesta revela si un correo está registrado.
# Un atacante no puede usar estos endpoints para saber quién es cliente de
# DILO — por eso el pedido de reset siempre responde lo mismo.
# ---------------------------------------------------------------------------

class PasswordResetRequestView(APIView):
    """
    Pide el enlace para crear una contraseña nueva.

    POST /api/auth/password-reset/  { "email": "user@example.com" }

    Responde 200 siempre (exista o no la cuenta).
    """
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'account_action'

    GENERIC = {
        'success': True,
        'message': 'Si el correo está registrado, te enviamos un enlace para crear una contraseña nueva.'
    }

    def post(self, request):
        from .models import AccountToken
        from .services import account_security
        from .staff_permissions import client_ip

        email = request.data.get('email', '').strip().lower()
        if not email:
            return Response({'error': 'El correo es requerido'},
                            status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            logger.info("Reset de contraseña pedido para un correo no registrado")
            return Response(self.GENERIC)

        if not user.is_active:
            # Cuenta sin verificar: su camino es el OTP de WhatsApp, no este.
            # Aun así respondemos igual para no delatar el estado de la cuenta.
            logger.info("Reset pedido por cuenta sin verificar %s", user.pk)
            return Response(self.GENERIC)

        ip = client_ip(request)
        user_agent = request.META.get('HTTP_USER_AGENT', '')
        token, raw = account_security.issue_token(
            user, AccountToken.Purpose.PASSWORD_RESET, ip=ip, user_agent=user_agent
        )
        sent = account_security.send_password_reset_email(
            user, raw, ip=ip, user_agent=user_agent
        )
        if not sent:
            # El token ya no sirve de nada si el correo no salió: se quema para
            # no dejar enlaces válidos colgando.
            account_security.invalidate_tokens(user, AccountToken.Purpose.PASSWORD_RESET)
            logger.error("No se pudo enviar el reset de contraseña al usuario %s", user.pk)

        return Response(self.GENERIC)


class PasswordResetConfirmView(APIView):
    """
    Canjea el enlace por una contraseña nueva.

    POST /api/auth/password-reset/confirm/  { "token": "...", "password": "..." }
    """
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'account_action'

    def post(self, request):
        from .models import AccountToken
        from .services import account_security
        from .staff_permissions import client_ip

        raw = request.data.get('token', '').strip()
        password = request.data.get('password', '')

        if not raw or not password:
            return Response({'error': 'Token y contraseña son requeridos'},
                            status=status.HTTP_400_BAD_REQUEST)
        if len(password) < 8:
            return Response({'error': 'La contraseña debe tener al menos 8 caracteres'},
                            status=status.HTTP_400_BAD_REQUEST)

        token, reason = account_security.consume_token(
            raw, AccountToken.Purpose.PASSWORD_RESET
        )
        if token is None:
            return Response(
                {'error': 'Este enlace ya no sirve. Pide uno nuevo.',
                 'expired': reason == 'expirado'},
                status=status.HTTP_410_GONE if reason == 'expirado' else status.HTTP_400_BAD_REQUEST
            )

        user = token.user
        user.set_password(password)
        # Una cuenta que recupera su contraseña por correo demuestra que
        # controla el buzón: si estaba sin verificar por OTP, ya no tiene
        # sentido dejarla bloqueada.
        if not user.is_active:
            user.is_active = True
        user.save(update_fields=['password', 'is_active'])

        # Cualquier otro enlace pendiente (reset o cambio de correo) muere aquí:
        # si el reset lo pidió un atacante, no le dejamos una segunda puerta.
        account_security.invalidate_tokens(user)

        account_security.send_password_changed_notice(
            user,
            ip=client_ip(request),
            user_agent=request.META.get('HTTP_USER_AGENT', ''),
        )

        logger.info("🔑 Contraseña restablecida para el usuario %s", user.pk)
        return Response({
            'success': True,
            'message': 'Tu contraseña quedó lista. Ya puedes entrar.',
            'email': user.email,
        })


class EmailChangeRequestView(APIView):
    """
    Pide cambiar el correo de acceso. Manda la confirmación al buzón NUEVO y un
    aviso al viejo.

    POST /api/auth/email-change/  { "new_email": "...", "password": "..." }

    La contraseña actual es obligatoria salvo en cuentas creadas con Google
    (no tienen contraseña utilizable): ahí basta la sesión.
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'account_action'

    def post(self, request):
        from django.core.validators import validate_email
        from django.core.exceptions import ValidationError
        from .models import AccountToken
        from .services import account_security
        from .staff_permissions import client_ip

        user = request.user
        new_email = request.data.get('new_email', '').strip().lower()
        password = request.data.get('password', '')

        if not new_email:
            return Response({'error': 'El correo nuevo es requerido'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_email(new_email)
        except ValidationError:
            return Response({'error': 'Ese correo no es válido'},
                            status=status.HTTP_400_BAD_REQUEST)

        if new_email == (user.email or '').lower():
            return Response({'error': 'Ese ya es tu correo actual'},
                            status=status.HTTP_400_BAD_REQUEST)

        if user.has_usable_password():
            if not password:
                return Response({'error': 'Confirma tu contraseña actual'},
                                status=status.HTTP_400_BAD_REQUEST)
            if not user.check_password(password):
                return Response({'error': 'La contraseña no coincide'},
                                status=status.HTTP_401_UNAUTHORIZED)

        # Correo ya tomado: se responde igual que en el caso feliz para no
        # convertir esto en un detector de cuentas ajenas. El dueño del buzón
        # nuevo simplemente no recibirá nada.
        taken = User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists()
        if taken:
            logger.info("Cambio de correo a una dirección ya registrada (usuario %s)", user.pk)
            return Response({
                'success': True,
                'message': f'Te enviamos un correo a {new_email} para confirmar el cambio.',
            })

        token, raw = account_security.issue_token(
            user,
            AccountToken.Purpose.EMAIL_CHANGE,
            new_email=new_email,
            ip=client_ip(request),
            user_agent=request.META.get('HTTP_USER_AGENT', ''),
        )
        sent = account_security.send_email_change_email(user, raw, new_email)
        if not sent:
            account_security.invalidate_tokens(user, AccountToken.Purpose.EMAIL_CHANGE)
            return Response(
                {'error': 'No pudimos enviar el correo de confirmación. Inténtalo de nuevo.'},
                status=status.HTTP_502_BAD_GATEWAY
            )

        # Aviso al buzón viejo: es la alarma del dueño legítimo. No condiciona
        # el resultado — el cambio ya está pedido y solo se aplica al confirmar.
        account_security.send_email_change_notice(user, new_email)

        return Response({
            'success': True,
            'message': f'Te enviamos un correo a {new_email} para confirmar el cambio.',
        })


class EmailChangeConfirmView(APIView):
    """
    Canjea el enlace del buzón nuevo y aplica el cambio.

    POST /api/auth/email-change/confirm/  { "token": "..." }

    AllowAny a propósito: el enlace se abre desde el correo, donde el usuario
    puede no tener sesión iniciada. El token ES la prueba.
    """
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'account_action'

    def post(self, request):
        from .models import AccountToken
        from .services import account_security

        raw = request.data.get('token', '').strip()
        if not raw:
            return Response({'error': 'Token requerido'},
                            status=status.HTTP_400_BAD_REQUEST)

        token, reason = account_security.consume_token(
            raw, AccountToken.Purpose.EMAIL_CHANGE
        )
        if token is None:
            return Response(
                {'error': 'Esta solicitud ya no sirve. Pide el cambio otra vez desde tu perfil.',
                 'expired': reason == 'expirado'},
                status=status.HTTP_410_GONE if reason == 'expirado' else status.HTTP_400_BAD_REQUEST
            )

        user = token.user
        new_email = token.new_email

        # Alguien pudo registrarse con ese correo mientras el enlace viajaba.
        if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
            return Response(
                {'error': 'Ese correo ya está en uso por otra cuenta.'},
                status=status.HTTP_409_CONFLICT
            )

        # El username ES el correo en DILO (así se registra y así se hace
        # login): mover uno sin el otro deja al usuario sin poder entrar.
        user.email = new_email
        user.username = new_email
        user.save(update_fields=['email', 'username'])

        logger.info("📧 Correo de la cuenta %s cambiado", user.pk)
        return Response({
            'success': True,
            'message': 'Listo, tu correo quedó actualizado. Entra con él la próxima vez.',
            'email': new_email,
        })
