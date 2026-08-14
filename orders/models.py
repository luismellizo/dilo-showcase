import uuid
from django.db import models
from django.utils import timezone


class Store(models.Model):
    """Tienda que vende productos por WhatsApp."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    owner = models.ForeignKey('auth.User', on_delete=models.CASCADE, unique=True)
    # Vestigial: el número de negocio real llega por WhatsAppCredentials
    # (phone_number_id). Opcional para permitir provisionar la tienda al registrarse.
    whatsapp_number = models.CharField(max_length=20, unique=True, null=True, blank=True)
    theme_color = models.CharField(max_length=7, default="#25D366")

    # --- Contexto del negocio para el bot de IA (anti-alucinación) ---
    # Todo opcional: el prompt solo inyecta lo que esté configurado y le
    # prohíbe al bot inventar lo que falte.
    bot_name = models.CharField(
        max_length=50, blank=True, default="",
        verbose_name="Nombre del asistente")
    bot_personality = models.TextField(
        blank=True, default="",
        verbose_name="Personalidad del bot",
        help_text="Tono y estilo. Vacío = mesero colombiano carismático por defecto.")
    business_description = models.TextField(
        blank=True, default="",
        verbose_name="Descripción del negocio",
        help_text="Qué vende, especialidad, qué lo hace diferente.")
    address = models.CharField(
        max_length=255, blank=True, default="",
        verbose_name="Dirección / ubicación")
    business_hours = models.TextField(
        blank=True, default="",
        verbose_name="Horarios de atención",
        help_text="Ej: Lun-Vie 11am-10pm, Sáb-Dom 12pm-11pm.")
    delivery_info = models.TextField(
        blank=True, default="",
        verbose_name="Domicilios",
        help_text="Zonas de cobertura, tiempos de entrega (texto libre informativo).")
    delivery_fee = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        verbose_name="Costo del domicilio",
        help_text="Tarifa fija de domicilio. 0 = sin costo / domicilio gratis.")
    free_delivery_min = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        verbose_name="Domicilio gratis desde",
        help_text="Si el subtotal alcanza este monto, el domicilio es gratis. "
                  "Vacío = nunca gratis automático.")
    prep_time_minutes = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name="Tiempo de preparación/entrega (min)",
        help_text="Estimado que el bot le da al cliente que pregunta por su pedido. "
                  "Ej: 40 → 'estará en ~40 min'. Vacío = el bot no promete tiempo.")
    payment_instructions = models.TextField(
        blank=True, default="",
        verbose_name="Datos de pago manual",
        help_text="Ej: Nequi 3001234567 a nombre de Juan. Se le dictan al cliente "
                  "cuando elige pagar por transferencia.")
    bot_extra_info = models.TextField(
        blank=True, default="",
        verbose_name="Información adicional",
        help_text="Promociones, preguntas frecuentes, parqueadero, etc.")
    bot_custom_instructions = models.TextField(
        blank=True, default="",
        verbose_name="Instrucciones para el bot",
        help_text="Reglas del dueño. Ej: 'Nunca ofrezcas descuentos', "
                  "'Avisa que los viernes hay 2x1'.")

    # Wizard de bienvenida del panel: False = la cuenta aún no pasó por el
    # onboarding (nombre, descripción, horario, tema). Las tiendas existentes
    # se marcan True en la migración para no re-preguntarles.
    onboarding_completed = models.BooleanField(
        default=False, verbose_name="Onboarding completado")

    # --- Menú digital (imagen que el bot envía al cliente) ---
    # GENERATED = renderizada desde la DB (fuente de verdad: Category/Product),
    # se regenera sola cuando cambia el menú. UPLOADED = subida por el dueño,
    # jamás se sobreescribe automáticamente.
    class MenuImageSource(models.TextChoices):
        GENERATED = 'GENERATED', 'Generada desde el menú'
        UPLOADED = 'UPLOADED', 'Subida por el dueño'

    menu_image = models.ImageField(
        upload_to='menu_images/', null=True, blank=True,
        verbose_name="Imagen del menú digital")
    menu_image_source = models.CharField(
        max_length=10, choices=MenuImageSource.choices, blank=True, default="",
        verbose_name="Origen de la imagen del menú")
    menu_image_updated_at = models.DateTimeField(
        null=True, blank=True, verbose_name="Última actualización del menú digital")
    # Fondo decorativo generado por IA (SIN texto — el texto siempre lo pone
    # el render de Pillow con datos exactos de la DB). Se genera bajo demanda
    # y se cachea: las regeneraciones del menú lo reutilizan gratis.
    menu_bg_image = models.ImageField(
        upload_to='menu_backgrounds/', null=True, blank=True,
        verbose_name="Fondo IA del menú digital")

    def __str__(self):
        return self.name

    def compute_delivery_fee(self, subtotal):
        """Domicilio a cobrar dado el subtotal de productos.

        Tarifa fija, salvo que el subtotal alcance free_delivery_min (gratis).
        """
        from decimal import Decimal
        fee = self.delivery_fee or Decimal('0')
        if self.free_delivery_min is not None and subtotal >= self.free_delivery_min:
            return Decimal('0')
        return fee

    class Meta:
        verbose_name = "Tienda"
        verbose_name_plural = "Tiendas"


class Category(models.Model):
    """Categoría de productos dentro de una tienda."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, related_name='categories', on_delete=models.CASCADE)
    name = models.CharField(max_length=100, verbose_name="Nombre")
    display_order = models.IntegerField(default=0, verbose_name="Orden de visualización")
    is_active = models.BooleanField(default=True, verbose_name="Activa")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.store.name} - {self.name}"

    class Meta:
        verbose_name = "Categoría"
        verbose_name_plural = "Categorías"
        ordering = ['display_order', 'name']
        unique_together = [['store', 'name']]


class Product(models.Model):
    """Producto de una categoría."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category = models.ForeignKey(Category, related_name='products', on_delete=models.CASCADE)
    name = models.CharField(max_length=200, verbose_name="Nombre")
    description = models.TextField(blank=True, verbose_name="Descripción")
    price = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Precio")
    is_active = models.BooleanField(default=True, verbose_name="Activo")
    image_url = models.URLField(blank=True, null=True, verbose_name="URL de imagen")
    display_order = models.IntegerField(default=0, verbose_name="Orden de visualización")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} - ${self.price}"

    class Meta:
        verbose_name = "Producto"
        verbose_name_plural = "Productos"
        ordering = ['display_order', 'name']


class ProductVariant(models.Model):
    """Variante de producto (extras, tamaños, salsas, etc.)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(Product, related_name='variants', on_delete=models.CASCADE)
    name = models.CharField(max_length=100, verbose_name="Nombre")  # e.g., "Salsa Picante", "Tamaño Grande"
    price_adjustment = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        default=0,
        verbose_name="Ajuste de precio"
    )
    is_active = models.BooleanField(default=True, verbose_name="Activa")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        sign = "+" if self.price_adjustment >= 0 else ""
        return f"{self.product.name} - {self.name} ({sign}${self.price_adjustment})"

    class Meta:
        verbose_name = "Variante de Producto"
        verbose_name_plural = "Variantes de Productos"


class Customer(models.Model):
    """
    Cliente identificado por su canal de comunicación.
    Permite tracking de historial, preferencias y métricas para marketing.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey('Store', related_name='customers', on_delete=models.CASCADE)
    
    # Identificación única por canal (phone o chat_id)
    channel_id = models.CharField(
        max_length=50, 
        db_index=True,
        verbose_name="ID del Canal"
    )
    
    class ChannelType(models.TextChoices):
        WHATSAPP = 'WHATSAPP', 'WhatsApp'
        TELEGRAM = 'TELEGRAM', 'Telegram'
    
    channel_type = models.CharField(
        max_length=20,
        choices=ChannelType.choices,
        default=ChannelType.WHATSAPP,
        verbose_name="Tipo de Canal"
    )
    
    # Datos del cliente (capturados naturalmente en conversación)
    name = models.CharField(max_length=100, blank=True, verbose_name="Nombre")
    phone = models.CharField(max_length=20, blank=True, verbose_name="Teléfono")
    default_address = models.TextField(
        blank=True,
        default="",
        verbose_name="Dirección habitual",
        help_text="Última dirección de entrega usada; el bot la ofrece para no re-pedirla"
    )
    
    # Métricas para marketing y IA
    total_orders = models.IntegerField(default=0, verbose_name="Total de pedidos")
    total_spent = models.DecimalField(
        max_digits=12, 
        decimal_places=2, 
        default=0,
        verbose_name="Total gastado"
    )
    last_order_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Último pedido"
    )
    last_winback_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Último mensaje de recompra",
        help_text="Evita re-contactar al mismo cliente repetidamente"
    )
    # Marca de la última vez que el cliente escribió. Define la "conversación"
    # facturable: un mensaje fuera de la ventana de 24h abre conversación nueva.
    last_user_message_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Último mensaje del cliente"
    )
    first_contact_at = models.DateTimeField(auto_now_add=True, verbose_name="Primer contacto")
    
    # Preferencias detectadas (para contexto de IA)
    favorite_products = models.JSONField(
        default=list,
        verbose_name="Productos favoritos"
    )
    notes = models.TextField(
        blank=True,
        verbose_name="Notas",
        help_text="Notas del restaurante sobre el cliente (alergias, preferencias, etc.)"
    )
    
    def __str__(self):
        return f"{self.name or self.channel_id} ({self.get_channel_type_display()})"
    
    class Meta:
        unique_together = ['store', 'channel_id', 'channel_type']
        verbose_name = "Cliente"
        verbose_name_plural = "Clientes"
        ordering = ['-last_order_at', '-first_contact_at']


class Order(models.Model):
    """Orden de compra de un cliente."""
    class Status(models.TextChoices):
        NEW = 'NEW', 'Nuevo'
        WAITING_PAYMENT = 'WAITING_PAYMENT', 'Esperando Pago'
        VERIFYING_PAYMENT = 'VERIFYING_PAYMENT', 'Verificando Comprobante'
        CONFIRMED = 'CONFIRMED', 'Confirmado'
        COMPLETED = 'COMPLETED', 'Entregado'
        CANCELLED = 'CANCELLED', 'Cancelado'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.ForeignKey(Store, related_name='orders', on_delete=models.CASCADE)
    customer = models.ForeignKey(
        'Customer',
        related_name='orders',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Cliente"
    )
    customer_phone = models.CharField(max_length=20, verbose_name="Teléfono del cliente")
    customer_name = models.CharField(max_length=100, blank=True, verbose_name="Nombre del cliente")

    class Source(models.TextChoices):
        WHATSAPP = 'WHATSAPP', 'WhatsApp'
        TELEGRAM = 'TELEGRAM', 'Telegram'

    source = models.CharField(max_length=20, choices=Source.choices, default=Source.WHATSAPP, verbose_name="Fuente del pedido")

    # Estado del Bot
    bot_state = models.CharField(max_length=50, default='IDLE')

    # --- Toma de control humana -------------------------------------------
    # Cuando el dueño interviene el chat desde el panel, el bot se calla para
    # ESTA conversación. Se reanuda solo tras BOT_PAUSE_MINUTES: una pausa
    # olvidada dejaría al cliente sin atención y sin que nadie se entere.
    bot_paused = models.BooleanField(
        default=False,
        verbose_name="Bot en pausa",
        help_text="El dueño tomó el control de esta conversación",
    )
    bot_paused_at = models.DateTimeField(null=True, blank=True)

    # Datos del Pedido
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0, verbose_name="Total")
    delivery_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0, verbose_name="Costo domicilio (snapshot)")
    delivery_address = models.TextField(blank=True, verbose_name="Dirección de entrega")
    payment_method = models.CharField(max_length=50, blank=True, verbose_name="Método de pago")
    notes = models.TextField(
        blank=True,
        default="",
        verbose_name="Notas del pedido",
        help_text="Instrucciones del cliente para el negocio/domiciliario (las registra el bot)"
    )
    
    # Comprobante de pago (URL temporal de WhatsApp - válida 24 horas)
    payment_proof_url = models.URLField(blank=True, null=True, verbose_name="Comprobante de pago (URL)")
    
    # Comprobante de pago (almacenamiento permanente)
    payment_proof_image = models.ImageField(
        upload_to='payment_proofs/%Y/%m/%d/',
        blank=True,
        null=True,
        verbose_name="Comprobante de pago (imagen)"
    )

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Orden {self.id} - {self.customer_name or self.customer_phone}"

    def bot_is_muted(self):
        """True si el bot debe callarse ahora mismo en esta conversación.

        Vence sola: si la pausa lleva más de BOT_PAUSE_MINUTES, se considera
        expirada (el caller es responsable de persistir la reanudación).
        """
        if not self.bot_paused:
            return False
        from django.conf import settings
        from django.utils import timezone
        from datetime import timedelta
        ttl = getattr(settings, 'BOT_PAUSE_MINUTES', 60)
        if not self.bot_paused_at:
            return True
        return timezone.now() < self.bot_paused_at + timedelta(minutes=ttl)

    class Meta:
        verbose_name = "Orden"
        verbose_name_plural = "Órdenes"
        ordering = ['-created_at']


class OrderItem(models.Model):
    """Item individual dentro de una orden."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, related_name='items', on_delete=models.CASCADE)
    product = models.ForeignKey(Product, null=True, blank=True, on_delete=models.SET_NULL)
    product_name = models.CharField(
        max_length=200, blank=True, default="",
        verbose_name="Nombre del producto"
    )  # Snapshot del nombre al momento de la orden (sobrevive si el producto se borra)
    quantity = models.PositiveIntegerField(default=1, verbose_name="Cantidad")
    unit_price = models.DecimalField(
        max_digits=10, 
        decimal_places=2,
        verbose_name="Precio unitario"
    )  # Snapshot del precio al momento de la orden
    notes = models.TextField(blank=True, verbose_name="Notas")  # e.g., "sin cebolla"
    variants = models.ManyToManyField(ProductVariant, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.quantity}x {self.display_name}"

    @property
    def display_name(self):
        """Nombre del producto: snapshot primero, FK como fallback."""
        if self.product_name:
            return self.product_name
        return self.product.name if self.product else "Producto eliminado"

    @property
    def subtotal(self):
        """Calcula el subtotal del item."""
        return self.quantity * self.unit_price

    class Meta:
        verbose_name = "Item de Orden"
        verbose_name_plural = "Items de Órdenes"


class PaymentConfiguration(models.Model):
    """
    Configuración de pasarela de pagos para una tienda específica.
    Permite BYOK (Bring Your Own Keys) - cada tienda usa sus propias credenciales.
    """
    
    class Provider(models.TextChoices):
        WOMPI = 'WOMPI', 'Wompi'
        BOLD = 'BOLD', 'Bold'
        NEQUI_MANUAL = 'NEQUI_MANUAL', 'Nequi Manual (Foto Comprobante)'
    
    # Relación con tienda
    store = models.OneToOneField(
        Store, 
        on_delete=models.CASCADE, 
        related_name='payment_config',
        verbose_name="Tienda"
    )
    
    # Configuración del proveedor
    provider = models.CharField(
        max_length=20, 
        choices=Provider.choices, 
        default=Provider.NEQUI_MANUAL,
        verbose_name="Proveedor de Pago"
    )
    
    is_active = models.BooleanField(
        default=False,
        verbose_name="Activo",
        help_text="Si está inactivo, se usará método manual"
    )
    
    # Credenciales (específicas por proveedor)
    public_key = models.CharField(
        max_length=255, 
        blank=True, 
        verbose_name="API Key Pública",
        help_text="Public key del proveedor de pagos"
    )
    
    private_key = models.CharField(
        max_length=255, 
        blank=True, 
        verbose_name="API Key Privada",
        help_text="Private key del proveedor de pagos"
    )
    
    integrity_secret = models.CharField(
        max_length=255, 
        blank=True, 
        verbose_name="Secret de Integridad (Wompi)",
        help_text="Usado para validar webhooks de Wompi"
    )
    
    webhook_secret = models.CharField(
        max_length=255, 
        blank=True, 
        verbose_name="Webhook Secret",
        help_text="Secret adicional para validar webhooks"
    )
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"{self.store.name} - {self.get_provider_display()}"
    
    class Meta:
        verbose_name = "Configuración de Pago"
        verbose_name_plural = "Configuraciones de Pago"


class UserProfile(models.Model):
    """
    Perfil extendido del usuario con datos de WhatsApp para verificación.
    """
    user = models.OneToOneField(
        'auth.User',
        on_delete=models.CASCADE,
        related_name='profile',
        verbose_name="Usuario"
    )
    whatsapp_number = models.CharField(
        max_length=20,
        unique=True,
        verbose_name="Número de WhatsApp"
    )
    is_whatsapp_verified = models.BooleanField(
        default=False,
        verbose_name="WhatsApp Verificado"
    )
    otp_code = models.CharField(
        max_length=6,
        blank=True,
        verbose_name="Código OTP"
    )
    otp_expires_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Expiración OTP"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.email} - {self.whatsapp_number}"

    def generate_otp(self):
        """Genera un código OTP de 6 dígitos válido por 10 minutos."""
        import random
        from datetime import timedelta
        self.otp_code = str(random.randint(100000, 999999))
        self.otp_expires_at = timezone.now() + timedelta(minutes=10)
        self.save()
        return self.otp_code

    def verify_otp(self, code):
        """Verifica si el código OTP es válido."""
        if not self.otp_code or not self.otp_expires_at:
            return False
        if timezone.now() > self.otp_expires_at:
            return False
        if self.otp_code != code:
            return False
        # OTP válido, limpiar y marcar como verificado
        self.otp_code = ''
        self.otp_expires_at = None
        self.is_whatsapp_verified = True
        self.save()
        return True

    class Meta:
        verbose_name = "Perfil de Usuario"
        verbose_name_plural = "Perfiles de Usuario"


class WhatsAppCredentials(models.Model):
    """
    Credenciales de WhatsApp Business API para cada tienda.
    
    Almacena el System User Access Token (SUAT) obtenido a través del
    flujo de Embedded Signup de Meta. El token se encripta antes de 
    guardarse en la base de datos.
    """
    store = models.OneToOneField(
        Store,
        on_delete=models.CASCADE,
        related_name='whatsapp_credentials',
        verbose_name="Tienda"
    )
    waba_id = models.CharField(
        max_length=50,
        verbose_name="WhatsApp Business Account ID"
    )
    phone_number_id = models.CharField(
        max_length=50,
        verbose_name="Phone Number ID",
        unique=True,  # Evita que dos tiendas queden apuntando al mismo número
        db_index=True  # Índice para búsqueda rápida en webhook
    )
    display_phone_number = models.CharField(
        max_length=20,
        verbose_name="Número de teléfono (display)"
    )
    verified_name = models.CharField(
        max_length=120,
        blank=True,
        default='',
        verbose_name="Nombre visible aprobado por Meta"
    )
    # Token encriptado - NUNCA almacenar en texto plano
    encrypted_token = models.TextField(
        verbose_name="Token encriptado (SUAT)"
    )
    # PIN de verificación en dos pasos del número, encriptado. Se genera uno
    # por tienda (jamás un PIN fijo compartido) y se reusa al re-registrar.
    encrypted_pin = models.TextField(
        blank=True,
        default='',
        verbose_name="PIN de dos pasos (encriptado)"
    )
    # Meta solo envía los webhooks de una WABA a las apps suscritas a ella.
    # Sin esto en True el comercio no recibe mensajes: es el check de salud
    # más importante del onboarding.
    is_subscribed = models.BooleanField(
        default=False,
        verbose_name="App suscrita a los webhooks de la WABA"
    )
    is_active = models.BooleanField(
        default=True,
        verbose_name="Activo"
    )
    connected_at = models.DateTimeField(
        auto_now_add=True,
        verbose_name="Fecha de conexión"
    )
    updated_at = models.DateTimeField(
        auto_now=True,
        verbose_name="Última actualización"
    )

    def __str__(self):
        return f"{self.store.name} - {self.display_phone_number}"

    class Meta:
        verbose_name = "Credencial de WhatsApp"
        verbose_name_plural = "Credenciales de WhatsApp"


class TelegramCredentials(models.Model):
    """
    Credenciales de bot de Telegram por tienda (multi-tienda).

    Cada comercio crea su propio bot vía BotFather y registra aquí su token.
    El webhook entrante se enruta a la tienda correcta mediante `webhook_secret`
    (parte de la URL del webhook), no por un bot global compartido.
    """
    store = models.OneToOneField(
        Store,
        on_delete=models.CASCADE,
        related_name='telegram_credentials',
        verbose_name="Tienda"
    )
    # Token del bot de BotFather, encriptado (Fernet derivado de SECRET_KEY).
    encrypted_bot_token = models.TextField(
        verbose_name="Token del bot (encriptado)"
    )
    bot_username = models.CharField(
        max_length=64,
        blank=True,
        verbose_name="Username del bot (@...)"
    )
    # Secreto que identifica la tienda en la URL del webhook entrante.
    webhook_secret = models.CharField(
        max_length=64,
        unique=True,
        db_index=True,
        verbose_name="Secreto de webhook"
    )
    is_active = models.BooleanField(default=True, verbose_name="Activo")
    connected_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.store.name} - Telegram {self.bot_username or ''}".strip()

    class Meta:
        verbose_name = "Credencial de Telegram"
        verbose_name_plural = "Credenciales de Telegram"


class Plan(models.Model):
    """
    Plan comercial de DILO (lo que paga el restaurante por usar la plataforma).

    `conversation_limit` es el tope de conversaciones/mes (ventana de 24h por
    cliente, estilo Meta). NULL = ilimitado. El tope protege el costo de LLM.
    """
    code = models.CharField(max_length=20, unique=True, verbose_name="Código")  # FREE, PRO, PREMIUM
    name = models.CharField(max_length=50, verbose_name="Nombre")
    price_cop = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        verbose_name="Precio mensual (COP)"
    )
    conversation_limit = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name="Conversaciones/mes",
        help_text="NULL = ilimitado"
    )
    features = models.JSONField(
        default=list,
        blank=True,
        verbose_name="Características",
        help_text="Lista de strings para mostrar en el paywall"
    )
    display_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True, verbose_name="Activo")

    def __str__(self):
        return f"{self.name} (${self.price_cop:,.0f} COP/mes)"

    class Meta:
        verbose_name = "Plan"
        verbose_name_plural = "Planes"
        ordering = ['display_order']


class Subscription(models.Model):
    """
    Suscripción de una tienda a un plan de DILO.

    Ciclo: TRIALING (14 días en plan Pro) → ACTIVE. Si un plan pago vence sin
    renovación → PAST_DUE (opera con límites del plan Gratis hasta pagar).
    Lógica de negocio en `orders/billing.py`.
    """

    class Status(models.TextChoices):
        TRIALING = 'TRIALING', 'En prueba'
        ACTIVE = 'ACTIVE', 'Activa'
        PAST_DUE = 'PAST_DUE', 'Pago vencido'
        CANCELED = 'CANCELED', 'Cancelada'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    store = models.OneToOneField(
        Store,
        on_delete=models.CASCADE,
        related_name='subscription',
        verbose_name="Tienda"
    )
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, verbose_name="Plan")
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.TRIALING,
        verbose_name="Estado"
    )
    trial_ends_at = models.DateTimeField(null=True, blank=True, verbose_name="Fin del trial")
    current_period_start = models.DateTimeField(verbose_name="Inicio del período")
    current_period_end = models.DateTimeField(verbose_name="Fin del período")
    conversations_used = models.PositiveIntegerField(
        default=0,
        verbose_name="Conversaciones usadas (período actual)"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.store.name} - {self.plan.name} ({self.get_status_display()})"

    class Meta:
        verbose_name = "Suscripción"
        verbose_name_plural = "Suscripciones"


class AuditLog(models.Model):
    """
    Bitácora de acciones del equipo interno de DILO en el panel /admin.

    Registra QUIÉN hizo QUÉ sobre QUÉ tienda, desde qué IP y con qué diff.
    Los snapshots (actor_email, store_name) sobreviven al borrado del FK.
    """

    class Action(models.TextChoices):
        STORE_UPDATE = 'STORE_UPDATE', 'Edición de configuración de tienda'
        SUBSCRIPTION_CHANGE = 'SUBSCRIPTION_CHANGE', 'Cambio de plan/suscripción'
        IMPERSONATE = 'IMPERSONATE', 'Inicio de sesión como usuario'
        # Puerta independiente del panel (/admin/login): se registran los
        # intentos exitosos Y los fallidos — un fallido repetido es un ataque.
        STAFF_LOGIN = 'STAFF_LOGIN', 'Acceso al panel interno'
        # Rastro de cumplimiento: hay que poder acreditar ante Meta y ante la
        # ley que un borrado solicitado se ejecutó, y cuándo.
        ACCOUNT_DELETION = 'ACCOUNT_DELETION', 'Eliminación de cuenta y datos'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        'auth.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='staff_audit_logs',
        verbose_name="Miembro del equipo"
    )
    actor_email = models.CharField(max_length=254, blank=True, default="")
    action = models.CharField(max_length=30, choices=Action.choices, db_index=True)
    store = models.ForeignKey(
        Store,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_logs',
        verbose_name="Tienda afectada"
    )
    store_name = models.CharField(max_length=100, blank=True, default="")
    target_user_email = models.CharField(
        max_length=254, blank=True, default="",
        help_text="Usuario impersonado (solo acción IMPERSONATE)"
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    detail = models.JSONField(
        default=dict, blank=True,
        help_text="Diff de campos {campo: {antes, despues}} u otros metadatos"
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    def __str__(self):
        return f"{self.actor_email} {self.action} {self.store_name} @ {self.created_at:%Y-%m-%d %H:%M}"

    class Meta:
        verbose_name = "Registro de auditoría"
        verbose_name_plural = "Registros de auditoría"
        ordering = ['-created_at']


class DataDeletionRequest(models.Model):
    """
    Solicitud de eliminación de datos.

    Existe por dos motivos: Meta exige un callback de eliminación de datos
    para aprobar la app, y ese callback debe devolver un código de
    confirmación consultable por el usuario después de que sus datos ya no
    existen. Por eso el registro sobrevive al borrado: guarda el código y el
    estado, nunca datos personales del negocio.
    """

    class Status(models.TextChoices):
        RECEIVED = 'RECEIVED', 'Recibida'
        COMPLETED = 'COMPLETED', 'Completada'
        FAILED = 'FAILED', 'Fallida'

    class Source(models.TextChoices):
        META_CALLBACK = 'META_CALLBACK', 'Callback de Meta'
        USER_REQUEST = 'USER_REQUEST', 'Solicitud del usuario'

    confirmation_code = models.CharField(
        max_length=32, unique=True, db_index=True,
        verbose_name="Código de confirmación"
    )
    facebook_user_id = models.CharField(
        max_length=64, blank=True, default='',
        verbose_name="ID de usuario de Facebook"
    )
    requester_email = models.EmailField(
        blank=True, default='', verbose_name="Correo del solicitante"
    )
    source = models.CharField(
        max_length=20, choices=Source.choices, default=Source.USER_REQUEST
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.RECEIVED, db_index=True
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    def mark_completed(self):
        from django.utils import timezone
        self.status = self.Status.COMPLETED
        self.completed_at = timezone.now()
        self.save(update_fields=['status', 'completed_at'])

    def __str__(self):
        return f"{self.confirmation_code} · {self.get_status_display()}"

    class Meta:
        verbose_name = "Solicitud de eliminación de datos"
        verbose_name_plural = "Solicitudes de eliminación de datos"
        ordering = ['-created_at']


class Message(models.Model):
    """
    Mensaje de chat asociado a una orden.
    """
    SENDER_CHOICES = [
        ('USER', 'Usuario'),
        ('BOT', 'Bot'),
        ('AGENT', 'Agente'),
    ]

    order = models.ForeignKey(Order, related_name='messages', on_delete=models.CASCADE)
    sender = models.CharField(max_length=20, choices=SENDER_CHOICES)
    content = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)
    
    # Metadatos opcionales
    platform = models.CharField(max_length=20, default='WHATSAPP') # WHATSAPP, TELEGRAM, WEB
    external_id = models.CharField(max_length=100, null=True, blank=True) # ID del mensaje en WA/TG

    class Meta:
        ordering = ['timestamp']
        constraints = [
            models.UniqueConstraint(
                fields=['platform', 'external_id'],
                condition=models.Q(external_id__isnull=False),
                name='unique_platform_external_id',
            )
        ]

    def __str__(self):
        return f"{self.sender} -> Order {self.order.id}: {self.content[:20]}"



class StaffLoginChallenge(models.Model):
    """
    Segundo factor del panel interno: el codigo que se envia por correo cuando
    alguien pasa el usuario/contrasena en /admin/login.

    Vive en DB y no en cache por dos razones: sobrevive a un reinicio de Redis
    (nadie queda fuera del panel por eso) y deja rastro de cuantos desafios se
    emitieron, que es informacion de seguridad.

    El codigo se guarda HASHEADO (mismos hashers que las contrasenas): quien
    lea la base de datos no puede completar un login ajeno.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        'auth.User',
        on_delete=models.CASCADE,
        related_name='staff_login_challenges',
        verbose_name="Miembro del equipo"
    )
    code_hash = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    expires_at = models.DateTimeField(db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True, default="")

    class Meta:
        ordering = ['-created_at']
        verbose_name = "Código de acceso al panel"
        verbose_name_plural = "Códigos de acceso al panel"

    def __str__(self):
        return f"Código de {self.user_id} ({'usado' if self.consumed_at else 'pendiente'})"

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at

    @property
    def is_usable(self):
        """Un desafio solo sirve una vez, antes de vencer y con intentos libres."""
        from django.conf import settings
        return (
            self.consumed_at is None
            and not self.is_expired
            and self.attempts < settings.STAFF_MFA_MAX_ATTEMPTS
        )

    @property
    def seconds_left(self):
        return max(0, int((self.expires_at - timezone.now()).total_seconds()))


class AccountToken(models.Model):
    """
    Token de un solo uso para acciones sensibles de la cuenta del comercio:
    restablecer contraseña y confirmar un correo nuevo.

    Un solo modelo para ambos flujos porque el ciclo de vida es idéntico
    (nace, vence, se consume una vez) y así hay UN lugar donde auditar quién
    pidió qué. Lo que cambia es `purpose` y, en el cambio de correo, el buzón
    destino en `new_email`.

    El token se guarda como SHA-256 del valor que viaja en el enlace: si
    alguien lee la base de datos NO puede reconstruir el enlace y tomar la
    cuenta. Se usa sha256 y no el hasher de contraseñas a propósito — el token
    es aleatorio de 256 bits (no hay diccionario que atacar) y necesitamos
    poder buscarlo por igualdad exacta, cosa que un hash con sal impide.
    """

    class Purpose(models.TextChoices):
        PASSWORD_RESET = 'PASSWORD_RESET', 'Restablecer contraseña'
        EMAIL_CHANGE = 'EMAIL_CHANGE', 'Confirmar correo nuevo'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        'auth.User',
        on_delete=models.CASCADE,
        related_name='account_tokens',
        verbose_name="Usuario"
    )
    purpose = models.CharField(max_length=20, choices=Purpose.choices, db_index=True)
    token_hash = models.CharField(max_length=64, unique=True)
    # Solo para EMAIL_CHANGE: el buzón que se está probando. Hasta que el
    # token se consuma, la cuenta sigue con el correo viejo.
    new_email = models.EmailField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    expires_at = models.DateTimeField(db_index=True)
    consumed_at = models.DateTimeField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True, default="")

    class Meta:
        ordering = ['-created_at']
        verbose_name = "Token de cuenta"
        verbose_name_plural = "Tokens de cuenta"
        indexes = [models.Index(fields=['user', 'purpose', 'consumed_at'])]

    def __str__(self):
        return f"{self.get_purpose_display()} de {self.user_id} ({'usado' if self.consumed_at else 'pendiente'})"

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at

    @property
    def is_usable(self):
        return self.consumed_at is None and not self.is_expired
