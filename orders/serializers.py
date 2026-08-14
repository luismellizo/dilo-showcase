from rest_framework import serializers
from .models import (Store, Category, Product, ProductVariant, Order, OrderItem,
                     Message, PaymentConfiguration, Customer)


# ============================================================
# SERIALIZERS ANIDADOS (DE HOJA A RAÍZ)
# ============================================================

class ProductVariantSerializer(serializers.ModelSerializer):
    """Serializer para variantes de productos."""

    class Meta:
        model = ProductVariant
        fields = ('id', 'name', 'price_adjustment', 'is_active')


class ProductSerializer(serializers.ModelSerializer):
    """Serializer para productos con sus variantes (variantes escribibles)."""
    variants = ProductVariantSerializer(many=True, required=False)
    category_name = serializers.CharField(source='category.name', read_only=True)

    class Meta:
        model = Product
        fields = ('id', 'category', 'name', 'description', 'price', 'is_active',
                  'image_url', 'display_order', 'category_name', 'variants')

    def create(self, validated_data):
        variants = validated_data.pop('variants', [])
        product = Product.objects.create(**validated_data)
        for v in variants:
            ProductVariant.objects.create(product=product, **v)
        return product

    def update(self, instance, validated_data):
        # None = el cliente no mandó variantes (no tocar); [] = borrarlas todas.
        variants = validated_data.pop('variants', None)
        instance = super().update(instance, validated_data)
        if variants is not None:
            instance.variants.all().delete()
            for v in variants:
                ProductVariant.objects.create(product=instance, **v)
        return instance


class CategorySerializer(serializers.ModelSerializer):
    """Serializer para categorías con sus productos."""
    products = ProductSerializer(many=True, read_only=True)
    active_products = serializers.SerializerMethodField()
    
    class Meta:
        model = Category
        fields = ('id', 'store', 'name', 'display_order', 'is_active', 'products', 'active_products')
    
    def get_active_products(self, obj):
        """Returns solo productos activos."""
        active_prods = obj.products.filter(is_active=True).order_by('display_order', 'name')
        return ProductSerializer(active_prods, many=True).data


class PaymentConfigurationSerializer(serializers.ModelSerializer):
    """Config de pagos de la tienda. Solo visible/escribible por el dueño.

    `private_key`/`webhook_secret` no los usa el frontend (no hay campo que
    los edite) — se marcan write_only para no reenviarlos en cada GET de
    /api/stores/<id>/ innecesariamente en texto plano.
    """

    class Meta:
        model = PaymentConfiguration
        fields = ('provider', 'is_active', 'public_key', 'private_key',
                  'integrity_secret', 'webhook_secret')
        extra_kwargs = {
            'private_key': {'write_only': True},
            'webhook_secret': {'write_only': True},
        }


class StoreSerializer(serializers.ModelSerializer):
    """Serializer para tiendas con toda su estructura de menú."""
    categories = CategorySerializer(many=True, read_only=True)
    active_categories = serializers.SerializerMethodField()
    owner_username = serializers.CharField(source='owner.username', read_only=True)
    payment_config = PaymentConfigurationSerializer(required=False)
    menu_image_url = serializers.SerializerMethodField()

    class Meta:
        model = Store
        fields = ('id', 'name', 'owner', 'owner_username', 'whatsapp_number',
                  'theme_color', 'categories', 'active_categories', 'payment_config',
                  # Contexto del negocio para el bot de IA
                  'bot_name', 'bot_personality', 'business_description', 'address',
                  'business_hours', 'delivery_info', 'delivery_fee',
                  'free_delivery_min', 'prep_time_minutes', 'payment_instructions',
                  'bot_extra_info', 'bot_custom_instructions',
                  'onboarding_completed',
                  # Menú digital (se gestiona vía /api/menu/image/*, aquí solo lectura)
                  'menu_image_url', 'menu_image_source', 'menu_image_updated_at',
                  'menu_has_ai_bg')
        read_only_fields = ('owner', 'menu_image_source', 'menu_image_updated_at')

    menu_has_ai_bg = serializers.SerializerMethodField()

    def get_menu_has_ai_bg(self, obj):
        return bool(obj.menu_bg_image)

    def get_menu_image_url(self, obj):
        if not obj.menu_image:
            return None
        url = obj.menu_image.url
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url

    def get_active_categories(self, obj):
        """Returns solo categorías activas con productos activos."""
        active_cats = obj.categories.filter(is_active=True).order_by('display_order', 'name')
        return CategorySerializer(active_cats, many=True).data

    def update(self, instance, validated_data):
        pc_data = validated_data.pop('payment_config', None)
        instance = super().update(instance, validated_data)
        if pc_data is not None:
            PaymentConfiguration.objects.update_or_create(store=instance, defaults=pc_data)
        return instance


# ============================================================
# ORDER SERIALIZERS
# ============================================================

class OrderItemSerializer(serializers.ModelSerializer):
    """Serializer para items de orden."""
    product_name = serializers.SerializerMethodField()
    product_price = serializers.SerializerMethodField()
    product_image = serializers.SerializerMethodField()
    variants = ProductVariantSerializer(many=True, read_only=True)
    subtotal = serializers.SerializerMethodField()
    
    class Meta:
        model = OrderItem
        fields = ('id', 'product', 'product_name', 'product_price', 'product_image',
                  'quantity', 'unit_price', 'notes', 'variants', 'subtotal')
    
    def get_subtotal(self, obj):
        """Calcula el subtotal del item."""
        return float(obj.subtotal)

    def get_product_name(self, obj):
        return obj.display_name

    def get_product_price(self, obj):
        return str(obj.product.price) if obj.product else None

    def get_product_image(self, obj):
        return obj.product.image_url if obj.product else None


class OrderSerializer(serializers.ModelSerializer):
    """Serializer para órdenes con todos sus items."""
    store_name = serializers.CharField(source='store.name', read_only=True)
    store_whatsapp = serializers.CharField(source='store.whatsapp_number', read_only=True)
    items = OrderItemSerializer(many=True, read_only=True)
    items_count = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    payment_proof = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = ('id', 'store', 'store_name', 'store_whatsapp',
                  'customer_phone', 'customer_name', 'bot_state',
                  'bot_paused', 'bot_paused_at',
                  'items', 'items_count', 'total_amount', 'delivery_fee',
                  'delivery_address', 'payment_method', 'payment_proof_url',
                  'payment_proof', 'notes', 'status', 'status_display', 'created_at')
        read_only_fields = ('id', 'created_at', 'bot_state',
                            'bot_paused', 'bot_paused_at')

    def get_items_count(self, obj):
        """Returns el número total de items en la orden."""
        return obj.items.count()

    def get_payment_proof(self, obj):
        """URL del comprobante de pago (imagen permanente; fallback a URL temporal).

        Devuelve None si el cliente aún no envió comprobante → el dashboard
        deshabilita el botón "Ver comprobante".
        """
        if obj.payment_proof_image:
            url = obj.payment_proof_image.url
            request = self.context.get('request')
            return request.build_absolute_uri(url) if request else url
        return obj.payment_proof_url or None


# ============================================================
# SERIALIZERS COMPACTOS (PARA LISTADOS)
# ============================================================

class StoreListSerializer(serializers.ModelSerializer):
    """Serializer compacto para listados de tiendas."""
    owner_username = serializers.CharField(source='owner.username', read_only=True)
    categories_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Store
        fields = ('id', 'name', 'owner_username', 'whatsapp_number', 
                  'theme_color', 'categories_count')
    
    def get_categories_count(self, obj):
        return obj.categories.count()


class OrderListSerializer(serializers.ModelSerializer):
    """Serializer compacto para listados de órdenes."""
    store_name = serializers.CharField(source='store.name', read_only=True)
    items_count = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    
    class Meta:
        model = Order
        fields = ('id', 'store_name', 'customer_name', 'customer_phone',
                  'items_count', 'total_amount', 'status', 'status_display', 'created_at')
    
    def get_items_count(self, obj):
        return obj.items.count()


class CustomerSerializer(serializers.ModelSerializer):
    """Serializer de solo lectura para la página de Clientes del dashboard."""
    phone = serializers.SerializerMethodField()
    order_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Customer
        fields = (
            'id', 'name', 'phone', 'channel_type', 'default_address',
            'total_spent', 'order_count', 'last_order_at', 'first_contact_at',
            'favorite_products', 'notes',
        )

    def get_phone(self, obj):
        # En WhatsApp el channel_id ES el teléfono; en Telegram es el chat_id (no un teléfono).
        if obj.phone:
            return obj.phone
        if obj.channel_type == Customer.ChannelType.WHATSAPP:
            return obj.channel_id
        return ''


class MessageSerializer(serializers.ModelSerializer):
    """Serializer para mensajes de chat."""
    
    class Meta:
        model = Message
        fields = ('id', 'order', 'sender', 'content', 'timestamp', 'is_read', 'platform')
        read_only_fields = ('id', 'timestamp', 'is_read', 'platform')