from django.contrib import admin
from .models import Store, Category, Product, ProductVariant, Order, OrderItem, PaymentConfiguration


# ============================================================
# INLINES
# ============================================================

class CategoryInline(admin.TabularInline):
    """Inline para gestionar categorías desde la tienda."""
    model = Category
    extra = 1
    fields = ('name', 'display_order', 'is_active')
    ordering = ('display_order', 'name')


class ProductInline(admin.StackedInline):
    """Inline para gestionar productos desde la categoría."""
    model = Product
    extra = 0
    fields = ('name', 'description', 'price', 'is_active', 'image_url', 'display_order')
    ordering = ('display_order', 'name')


class ProductVariantInline(admin.TabularInline):
    """Inline para gestionar variantes desde el producto."""
    model = ProductVariant
    extra = 1
    fields = ('name', 'price_adjustment', 'is_active')


class OrderItemInline(admin.TabularInline):
    """Inline para visualizar items de la orden."""
    model = OrderItem
    extra = 0
    readonly_fields = ('product', 'quantity', 'unit_price', 'notes', 'get_subtotal')
    fields = ('product', 'quantity', 'unit_price', 'get_subtotal', 'notes')
    can_delete = False  # Evitar eliminación accidental de items históricos
    
    def get_subtotal(self, obj):
        """Muestra el subtotal del item."""
        if obj.id:
            return f"${obj.subtotal:,.2f}"
        return "-"
    get_subtotal.short_description = "Subtotal"


# ============================================================
# MODEL ADMINS
# ============================================================

@admin.register(Store)
class StoreAdmin(admin.ModelAdmin):
    """Administración de tiendas."""
    list_display = ('name', 'owner', 'whatsapp_number', 'theme_color', 'get_categories_count')
    list_filter = ('owner',)
    search_fields = ('name', 'whatsapp_number', 'owner__username')
    inlines = [CategoryInline]
    
    def get_categories_count(self, obj):
        """Muestra el número de categorías de la tienda."""
        return obj.categories.count()
    get_categories_count.short_description = "Categorías"


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    """Administración de categorías."""
    list_display = ('name', 'store', 'display_order', 'is_active', 'get_products_count')
    list_filter = ('is_active', 'store')
    search_fields = ('name', 'store__name')
    inlines = [ProductInline]
    ordering = ('store', 'display_order', 'name')
    
    def get_products_count(self, obj):
        """Muestra el número de productos en la categoría."""
        return obj.products.count()
    get_products_count.short_description = "Productos"


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    """Administración de productos."""
    list_display = ('name', 'category', 'price', 'is_active', 'display_order', 'get_variants_count')
    list_filter = ('is_active', 'category__store', 'category')
    search_fields = ('name', 'description', 'category__name')
    inlines = [ProductVariantInline]
    ordering = ('category', 'display_order', 'name')
    
    def get_variants_count(self, obj):
        """Muestra el número de variantes del producto."""
        return obj.variants.count()
    get_variants_count.short_description = "Variantes"


@admin.register(ProductVariant)
class ProductVariantAdmin(admin.ModelAdmin):
    """Administración de variantes de productos."""
    list_display = ('name', 'product', 'price_adjustment', 'is_active')
    list_filter = ('is_active', 'product__category__store')
    search_fields = ('name', 'product__name')


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    """Administración de órdenes."""
    list_display = ('id', 'store', 'customer_name', 'customer_phone', 'status', 
                    'total_amount', 'created_at', 'get_items_count')
    list_filter = ('status', 'created_at', 'store')
    search_fields = ('customer_name', 'customer_phone', 'id')
    readonly_fields = ('id', 'created_at', 'bot_state')
    inlines = [OrderItemInline]
    date_hierarchy = 'created_at'
    
    def get_items_count(self, obj):
        """Muestra el número de items en la orden."""
        return obj.items.count()
    get_items_count.short_description = "Items"


@admin.register(OrderItem)
class OrderItemAdmin(admin.ModelAdmin):
    """Administración de items de órdenes."""
    list_display = ('order', 'product', 'quantity', 'unit_price', 'get_subtotal')
    list_filter = ('order__status', 'product__category')
    search_fields = ('order__id', 'product__name', 'order__customer_name')
    readonly_fields = ('order', 'product', 'unit_price', 'created_at')
    
    def get_subtotal(self, obj):
        """Muestra el subtotal del item."""
        return f"${obj.subtotal:,.2f}"
    get_subtotal.short_description = "Subtotal"


# ============================================================
# BILLING (planes y suscripciones DILO)
# ============================================================

from .models import (Plan, Subscription, AuditLog, WhatsAppCredentials,
                     DataDeletionRequest, StaffLoginChallenge)


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    """Planes comerciales de DILO."""
    list_display = ('code', 'name', 'price_cop', 'conversation_limit', 'is_active', 'display_order')
    list_editable = ('is_active',)
    ordering = ('display_order',)


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    """
    Suscripciones por tienda. Mientras no exista cobro recurrente automático,
    la acción "Activar/renovar plan actual (30 días)" registra un pago manual.
    """
    list_display = ('store', 'plan', 'status', 'conversations_used',
                    'trial_ends_at', 'current_period_end')
    list_filter = ('status', 'plan')
    search_fields = ('store__name', 'store__owner__email')
    actions = ('renew_current_plan',)

    @admin.action(description="Activar/renovar plan actual (30 días, pago manual)")
    def renew_current_plan(self, request, queryset):
        from .billing import activate_plan
        for sub in queryset.select_related('store', 'plan'):
            activate_plan(sub.store, sub.plan)
        self.message_user(request, f"{queryset.count()} suscripción(es) renovada(s).")


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    """Bitácora del panel interno — solo lectura (la escribe staff_views)."""
    list_display = ('created_at', 'actor_email', 'action', 'store_name',
                    'target_user_email', 'ip_address')
    list_filter = ('action',)
    search_fields = ('actor_email', 'store_name', 'target_user_email')
    date_hierarchy = 'created_at'

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser


@admin.register(StaffLoginChallenge)
class StaffLoginChallengeAdmin(admin.ModelAdmin):
    """
    Códigos de acceso al panel interno — solo lectura y diagnóstico.

    El código va hasheado: esta pantalla sirve para ver si se emitió, desde
    qué IP y si se usó, nunca para leerlo. Una ráfaga de desafíos sin consumir
    del mismo usuario es señal de que alguien tiene su contraseña.
    """
    list_display = ('created_at', 'user', 'ip_address', 'attempts',
                    'consumed_at', 'expires_at')
    list_filter = ('consumed_at',)
    search_fields = ('user__email', 'user__username', 'ip_address')
    date_hierarchy = 'created_at'
    exclude = ('code_hash',)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(WhatsAppCredentials)
class WhatsAppCredentialsAdmin(admin.ModelAdmin):
    """Credenciales de WhatsApp por tienda.

    `is_subscribed` es el diagnóstico clave: en False, Meta NO nos envía los
    mensajes de ese comercio aunque todo lo demás luzca conectado.
    El token y el PIN nunca se muestran (van encriptados en la BD).
    """
    list_display = ('store', 'display_phone_number', 'verified_name',
                    'is_active', 'is_subscribed', 'connected_at')
    list_filter = ('is_active', 'is_subscribed')
    search_fields = ('store__name', 'display_phone_number', 'waba_id',
                     'phone_number_id')
    readonly_fields = ('waba_id', 'phone_number_id', 'connected_at', 'updated_at')
    exclude = ('encrypted_token', 'encrypted_pin')


@admin.register(DataDeletionRequest)
class DataDeletionRequestAdmin(admin.ModelAdmin):
    """Solicitudes de eliminación de datos — solo lectura.

    Es el rastro que acredita ante Meta y ante la ley que un borrado pedido se
    ejecutó. Editarlo a mano destruiría su valor probatorio.
    """
    list_display = ('created_at', 'confirmation_code', 'source', 'status',
                    'requester_email', 'completed_at')
    list_filter = ('status', 'source')
    search_fields = ('confirmation_code', 'requester_email', 'facebook_user_id')
    date_hierarchy = 'created_at'

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
