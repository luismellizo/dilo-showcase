"""
Motor de IA conversacional para ventas por WhatsApp.
Reemplaza la máquina de estados frágil con un agente LLM inteligente.
"""

import json
import logging
import httpx
from decimal import Decimal
from typing import Dict, List, Optional

from django.conf import settings

from .models import Order, OrderItem, Product
from .prompts import (
    DEFAULT_PERSONALITY_BLOCK,
    MENU_RULE_TEXT_ONLY,
    MENU_RULE_WITH_IMAGE,
    OWNER_RULES_TEMPLATE,
    SYSTEM_PROMPT_TEMPLATE,
)

# Configurar logging
logger = logging.getLogger(__name__)

# Importación condicional según provider
try:
    if settings.AI_PROVIDER == 'openai':
        from openai import OpenAI
        ai_client = OpenAI(
            api_key=settings.OPENAI_API_KEY,
            http_client=httpx.Client()
        )
    elif settings.AI_PROVIDER == 'deepseek':
        # DeepSeek usa API compatible con OpenAI
        from openai import OpenAI
        ai_client = OpenAI(
            api_key=settings.DEEPSEEK_API_KEY,
            base_url="https://api.deepseek.com",
            http_client=httpx.Client()
        )
        logger.info("Cliente DeepSeek inicializado correctamente")
    elif settings.AI_PROVIDER == 'openrouter':
        # OpenRouter usa API compatible con OpenAI
        from openai import OpenAI
        ai_client = OpenAI(
            api_key=settings.OPENROUTER_API_KEY,
            base_url="https://openrouter.ai/api/v1",
            http_client=httpx.Client()
        )
        logger.info("Cliente OpenRouter inicializado correctamente")
    elif settings.AI_PROVIDER in ('gemini', 'google'):
        # Google Gemini vía su endpoint compatible con OpenAI
        from openai import OpenAI
        ai_client = OpenAI(
            api_key=settings.GEMINI_API_KEY,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            http_client=httpx.Client()
        )
        logger.info("Cliente Google Gemini inicializado correctamente")
    elif settings.AI_PROVIDER == 'anthropic':
        from anthropic import Anthropic
        ai_client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    else:
        ai_client = None
        logger.warning(f"AI Provider '{settings.AI_PROVIDER}' no es válido. Bot funcionará sin IA.")
except Exception as e:
    ai_client = None
    logger.error(f"Error inicializando cliente de IA: {e}")


# Definición de herramientas para function calling
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "confirmar_pedido",
            "description": "Registra el pedido confirmado del cliente con todos los items solicitados. Usa esto cuando el cliente confirme explícitamente su pedido.",
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "description": "Lista de productos que el cliente desea ordenar",
                        "items": {
                            "type": "object",
                            "properties": {
                                "product_name": {
                                    "type": "string",
                                    "description": "Nombre exacto del producto del menú"
                                },
                                "quantity": {
                                    "type": "integer",
                                    "description": "Cantidad de unidades",
                                    "minimum": 1
                                },
                                "notes": {
                                    "type": "string",
                                    "description": "Notas especiales (ej: 'sin cebolla', 'extra queso')"
                                }
                            },
                            "required": ["product_name", "quantity"]
                        }
                    },
                    "customer_name": {
                        "type": "string",
                        "description": "Nombre del cliente si lo proporcionó"
                    }
                },
                "required": ["items"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "guardar_datos_cliente",
            "description": "Guarda información del cliente cuando la proporciona naturalmente en la conversación. Úsalo cuando el cliente diga su nombre, teléfono, dirección o cualquier dato útil para futuras interacciones.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Nombre completo del cliente"
                    },
                    "phone": {
                        "type": "string",
                        "description": "Número de teléfono si lo proporciona"
                    },
                    "notes": {
                        "type": "string",
                        "description": "Notas relevantes como alergias, preferencias especiales, etc."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "actualizar_direccion",
            "description": "Guarda o corrige la dirección de entrega del cliente para su pedido en curso. ÚSALA SIEMPRE que el cliente dé una dirección nueva o corrija la anterior. Jamás digas que guardaste una dirección sin llamar esta función.",
            "parameters": {
                "type": "object",
                "properties": {
                    "direccion": {
                        "type": "string",
                        "description": "Dirección de entrega completa tal como la dio el cliente"
                    }
                },
                "required": ["direccion"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "agregar_nota_pedido",
            "description": "Registra una instrucción del cliente para el negocio/domiciliario sobre su pedido en curso (ej: 'llevar cambio de $50.000', 'no timbrar', 'entregar en portería'). ÚSALA SIEMPRE que el cliente pida avisar algo al equipo. Jamás digas que ya avisaste sin llamar esta función.",
            "parameters": {
                "type": "object",
                "properties": {
                    "nota": {
                        "type": "string",
                        "description": "La instrucción o aviso del cliente, breve y clara"
                    }
                },
                "required": ["nota"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "enviar_menu",
            "description": "Envía al cliente la imagen del menú completo del negocio. ÚSALA cuando el cliente pida ver el menú, la carta, qué venden o los precios en general. Si el cliente pregunta por UNA categoría o producto puntual, NO la uses: responde en texto solo esa parte.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    }
]


class WhatsAppBotEngine:
    """
    Motor de IA conversacional para ventas por WhatsApp.
    
    Arquitectura:
    - System Prompt Dinámico: Inyecta menú desde DB relacional
    - Function Calling: Extrae pedidos estructurados
    - Estados Simplificados: SALES_CONVERSATION → WAITING_PAYMENT_PROOF → COMPLETED
    """
    
    def __init__(self, order: Order, message_text: str, media_url: Optional[str] = None):
        """
        Inicializa el motor del bot.
        
        Args:
            order: Instancia de Order asociada a esta conversación
            message_text: Mensaje del cliente
            media_url: URL de archivo adjunto (imagen, video, etc.)
        """
        self.order = order
        self.text = message_text.strip()
        self.media_url = media_url
        self.store = order.store
        self.system_prompt = self._build_system_prompt()
        # Memoria: cargar historial previo desde DB (el mensaje actual lo re-agrega
        # _handle_sales_conversation, por eso se descarta el último USER aquí).
        self.conversation_history: List[Dict] = self._load_history()

    # Cuántos mensajes de historial cargar como contexto del LLM.
    MAX_HISTORY_MESSAGES = 20

    def _load_history(self) -> List[Dict]:
        """
        Carga el historial de conversación de la orden desde el modelo Message
        y lo mapea al formato esperado por el LLM (role: user/assistant).

        - USER  → 'user'
        - BOT / AGENT → 'assistant'
        Descarta la cola final de mensajes USER sin responder: el texto de
        entrada del engine ya los trae (la task los agrupa en un solo input
        cuando el cliente escribe en ráfaga) y _handle_sales_conversation lo
        re-agrega — sin esto se duplicarían en el contexto.
        """
        # Tomar los más recientes y devolverlos en orden cronológico.
        msgs = list(
            self.order.messages.order_by('-timestamp')
            .values('sender', 'content')[: self.MAX_HISTORY_MESSAGES]
        )
        msgs.reverse()

        # Descartar TODOS los USER finales aún sin respuesta (vienen en self.text).
        while msgs and msgs[-1]['sender'] == 'USER':
            msgs = msgs[:-1]

        history: List[Dict] = []
        for m in msgs:
            content = m['content']
            if not content:
                continue
            role = 'user' if m['sender'] == 'USER' else 'assistant'
            history.append({'role': role, 'content': content})
        return history
    
    def process(self) -> str:
        """
        Procesa el mensaje del cliente y retorna la respuesta del bot.
        
        Returns:
            Respuesta del bot para el cliente
        """
        try:
            # Estado: SALES_CONVERSATION (conversación de ventas con IA)
            if self.order.bot_state in ['IDLE', 'SALES_CONVERSATION']:
                response = self._handle_sales_conversation()

            # Estado: WAITING_PAYMENT_PROOF (esperando comprobante de pago)
            elif self.order.bot_state == 'WAITING_PAYMENT_PROOF':
                response = self._handle_payment_proof()

            # Estado: COMPLETED (orden completada)
            else:
                response = "Tu pedido ya está en proceso. ¡Gracias por tu compra! 🙏"

            # Garantía global: jamás retornar vacío (rompe el envío al canal).
            return (response or '').strip() or "¿Me lo repites, porfa? No te entendí bien. 😅"

        except Exception as e:
            logger.error(f"Error procesando mensaje: {e}", exc_info=True)
            return "Disculpa, tuve un problema. ¿Puedes repetir tu mensaje? 😅"
    
    def _build_system_prompt(self) -> str:
        """
        Construye el prompt de sistema dinámicamente inyectando el menú actual
        y el contexto del cliente para personalización.
        
        Este prompt define la personalidad y conocimiento del bot.
        El menú se obtiene desde la base de datos relacional en tiempo real.
        
        Returns:
            System prompt completo con menú y contexto del cliente inyectados
        """
        # Obtener categorías y productos activos
        categories = self.store.categories.filter(is_active=True).prefetch_related(
            'products'
        ).order_by('display_order', 'name')
        
        # Construir menú en texto plano
        menu_text = ""
        if categories.exists():
            for category in categories:
                active_products = category.products.filter(is_active=True).order_by('display_order', 'name')
                if active_products.exists():
                    menu_text += f"\n**{category.name}**\n"
                    for product in active_products:
                        menu_text += f"- {product.name}: ${product.price:,.0f}"
                        if product.description:
                            menu_text += f" ({product.description})"
                        menu_text += "\n"
        else:
            menu_text = "\n(Menú aún no configurado)"
        
        # Obtener contexto del cliente
        customer_context = self._get_customer_context()

        # Pedido reciente ya pagado / en cocina (para responder "¿va en camino?")
        fulfillment_context = self._get_active_fulfillment_context()

        # Contexto del negocio configurado por el dueño (solo campos llenos)
        business_context = self._get_business_context()

        # Identidad y personalidad configurables
        bot_identity = (
            f"Te llamas *{self.store.bot_name}* y eres el asistente virtual de"
            if self.store.bot_name
            else "Eres un mesero virtual experto de"
        )
        # El comercio puede sobrescribir la personalidad base desde su panel.
        personality_block = (
            self.store.bot_personality.strip()
            or DEFAULT_PERSONALITY_BLOCK
        )

        # Menú digital: con imagen disponible, el menú completo se envía como
        # imagen (tool 'enviar_menu') en vez de un muro de texto. Preguntas
        # puntuales siguen siendo texto.
        menu_display_rule = (
            MENU_RULE_WITH_IMAGE if self.store.menu_image else MENU_RULE_TEXT_ONLY
        )

        # Las instrucciones del dueño se inyectan al final y prevalecen sobre
        # las reglas base — es el punto de extensión por comercio.
        owner_rules = ""
        if self.store.bot_custom_instructions.strip():
            owner_rules = OWNER_RULES_TEMPLATE.format(
                instructions=self.store.bot_custom_instructions.strip()
            )

        # Ensamblado final: las capas se concatenan en orden de precedencia
        # creciente (lo último pesa más para el modelo).
        return SYSTEM_PROMPT_TEMPLATE.format(
            bot_identity=bot_identity,
            store_name=self.store.name,
            business_context=business_context,
            customer_context=customer_context,
            fulfillment_context=fulfillment_context,
            menu_text=menu_text,
            menu_display_rule=menu_display_rule,
            personality_block=personality_block,
            owner_rules=owner_rules,
        )

    def _get_business_context(self) -> str:
        """
        Construye el bloque de información del negocio desde la configuración
        de la tienda. Solo incluye campos llenos; el prompt prohíbe al bot
        inventar lo que falte.
        """
        store = self.store

        # Costo del domicilio (dato estructurado, no inventable).
        delivery_cost = ""
        if store.delivery_fee and store.delivery_fee > 0:
            delivery_cost = f"${store.delivery_fee:,.0f} fijo"
            if store.free_delivery_min is not None:
                delivery_cost += f" (GRATIS desde ${store.free_delivery_min:,.0f} en productos)"
        elif store.delivery_fee == 0:
            delivery_cost = "Gratis"

        sections = [
            ("Descripción", store.business_description),
            ("Dirección", store.address),
            ("Horarios de atención", store.business_hours),
            ("Costo del domicilio", delivery_cost),
            ("Domicilios (zonas, tiempos)", store.delivery_info),
            ("Información adicional (promos, FAQ)", store.bot_extra_info),
        ]
        lines = [
            f"- {label}: {value.strip()}"
            for label, value in sections if value and value.strip()
        ]
        if not lines:
            return ("- (El dueño aún no configuró la información del negocio. "
                    "NO inventes horarios, dirección ni datos de entrega.)")
        return "\n".join(lines)
    
    def _get_customer_context(self) -> str:
        """
        Obtiene información histórica del cliente para enriquecer el contexto del LLM.
        
        Returns:
            Contexto del cliente en formato texto para el system prompt
        """
        customer = self.order.customer
        
        if not customer:
            return "- Cliente nuevo (primera interacción)"
        
        # Construir contexto básico
        lines = []
        
        if customer.name:
            lines.append(f"- Nombre: {customer.name}")
        else:
            lines.append("- Nombre: No proporcionado aún")
        
        lines.append(f"- Pedidos anteriores: {customer.total_orders}")
        
        if customer.total_spent > 0:
            lines.append(f"- Total gastado históricamente: ${customer.total_spent:,.0f}")
        
        if customer.last_order_at:
            lines.append(f"- Último pedido: {customer.last_order_at.strftime('%d/%m/%Y')}")
        
        if customer.favorite_products:
            favorites = customer.favorite_products[:3]  # Top 3
            lines.append(f"- Productos favoritos: {', '.join(favorites)}")
        
        if customer.notes:
            lines.append(f"- Notas importantes: {customer.notes}")
        
        # Cargar últimos pedidos para contexto detallado
        from .models import Order as OrderModel
        recent_orders = OrderModel.objects.filter(
            customer=customer,
            status__in=['CONFIRMED', 'COMPLETED']
        ).order_by('-created_at')[:3]
        
        if recent_orders.exists():
            lines.append("\n- Pedidos recientes:")
            for order in recent_orders:
                items_list = [f"{i.quantity}x {i.display_name}" for i in order.items.all()[:3]]
                items_str = ", ".join(items_list)
                if order.items.count() > 3:
                    items_str += "..."
                lines.append(f"  • {order.created_at.strftime('%d/%m')}: {items_str} (${order.total_amount:,.0f})")

        return "\n".join(lines)

    def _get_recent_fulfillment_order(self) -> Optional[Order]:
        """Pedido reciente ya pagado / en preparación de este cliente (o None).

        Ventana de 3h: la entrega real tarda máx ~1.5h; el resto es buffer por si
        el cliente pregunta un rato después de recibir. Es el pedido "real" al
        que aplican correcciones de dirección y notas para el domiciliario.
        """
        from datetime import timedelta
        from django.utils import timezone
        from .models import Order as OrderModel

        window_start = timezone.now() - timedelta(hours=3)
        return OrderModel.objects.filter(
            store=self.store,
            customer_phone=self.order.customer_phone,
            status__in=[Order.Status.VERIFYING_PAYMENT, Order.Status.CONFIRMED],
            created_at__gte=window_start,
        ).exclude(id=self.order.id).order_by('-created_at').first()

    def _get_active_fulfillment_context(self) -> str:
        """Bloque del prompt sobre un pedido reciente ya pagado / en preparación.

        Permite al bot responder "¿va en camino?" sin reiniciar una venta y
        tratar un pedido nuevo como adicional. Devuelve "" si no hay nada en curso.
        """
        from django.utils import timezone

        order = self._get_recent_fulfillment_order()

        if not order:
            return ""

        status_label = {
            Order.Status.VERIFYING_PAYMENT: "Pago en verificación (confirmando el comprobante)",
            Order.Status.CONFIRMED: "Confirmado, en preparación 👨‍🍳",
        }.get(order.status, order.get_status_display())

        items_list = [f"{i.quantity}x {i.display_name}" for i in order.items.all()[:5]]
        items_str = ", ".join(items_list) if items_list else "tu pedido"
        mins_ago = int((timezone.now() - order.created_at).total_seconds() // 60)

        lines = [
            "\n**PEDIDO EN CURSO DEL CLIENTE (NO es un pedido nuevo):**",
            f"- Pedido de hace {mins_ago} min: {items_str} (${order.total_amount:,.0f})",
            f"- Estado: {status_label}",
            "- ⚠️ Estos items YA están en cocina. Si el cliente pide algo más, el pedido "
            "adicional NO debe incluirlos ni volver a contarlos — solo los items nuevos.",
        ]
        if (order.delivery_address or '').strip():
            lines.append(f"- Dirección de entrega registrada: {order.delivery_address.strip()}")
        if (order.notes or '').strip():
            lines.append(f"- Notas registradas para el equipo: {order.notes.strip()}")
        if self.store.prep_time_minutes:
            lines.append(
                f"- Tiempo estimado total: ~{self.store.prep_time_minutes} min desde que se confirmó."
            )
        else:
            lines.append("- Tiempo estimado: no configurado (no prometas minutos exactos).")
        return "\n".join(lines) + "\n"

    def _handle_sales_conversation(self) -> str:
        """
        Maneja la conversación de ventas usando el LLM.
        
        El LLM decide cuándo confirmar el pedido usando function calling.
        
        Returns:
            Respuesta del bot
        """
        # Verificar que el cliente IA esté disponible
        if not ai_client:
            return self._fallback_response()
        
        # Agregar mensaje del usuario al historial. Si mandó solo una imagen
        # (sin texto) durante la venta, darle contexto al LLM en vez de un
        # string vacío (que produce respuestas vacías del modelo).
        user_content = self.text
        if not user_content and self.media_url:
            user_content = ("(El cliente envió una imagen adjunta. Si parece un comprobante "
                            "de pago, recuérdale amablemente que primero debe confirmar su "
                            "pedido; si no, pregúntale en qué le puedes ayudar.)")
        self.conversation_history.append({
            "role": "user",
            "content": user_content or "(mensaje vacío)"
        })
        
        try:
            # Llamar al LLM
            response_data = self._call_llm()

            # Extraer tool calls y texto según el provider.
            # OJO: en la API estilo OpenAI los tool_calls viven en
            # choices[0].message.tool_calls, NO en la raíz de la respuesta.
            # (Bug histórico: se leía response_data['tool_calls'] → siempre None
            # → confirmar_pedido jamás se ejecutaba y el carrito quedaba vacío.)
            tool_calls = None
            assistant_message = None
            if settings.AI_PROVIDER in ['openai', 'deepseek', 'openrouter', 'gemini', 'google']:
                msg = (response_data.get('choices') or [{}])[0].get('message') or {}
                tool_calls = msg.get('tool_calls')
                assistant_message = msg.get('content')
            elif settings.AI_PROVIDER == 'anthropic':
                blocks = response_data.get('content') or []
                tool_calls = [b for b in blocks if b.get('type') == 'tool_use'] or None
                texts = [b.get('text', '') for b in blocks if b.get('type') == 'text']
                assistant_message = '\n'.join(t for t in texts if t)
            else:
                assistant_message = "Error de configuración"

            # Function calling: confirmar pedido / guardar datos del cliente.
            if tool_calls:
                return self._handle_tool_calls(tool_calls)

            # Defensa: nunca filtrar tokens de control / razonamiento al cliente.
            assistant_message = self._sanitize_output(assistant_message)
            # Red de seguridad anti-fraude: bloquear números de pago inventados.
            assistant_message = self._redact_payment_leak(assistant_message)

            # Nunca devolver vacío: Telegram rechaza "message text is empty" y
            # la task de envío entra en loop de reintentos.
            if not (assistant_message or '').strip():
                logger.warning(f"⚠️ LLM devolvió respuesta vacía (orden {self.order.id}); usando fallback.")
                assistant_message = "¿Me lo repites, porfa? No te entendí bien. 😅"

            # Guardar respuesta en historial
            self.conversation_history.append({
                "role": "assistant",
                "content": assistant_message
            })
            
            # Actualizar estado
            self.order.bot_state = 'SALES_CONVERSATION'
            self.order.save()
            
            return assistant_message
        
        except Exception as e:
            logger.error(f"Error en conversación con LLM: {e}", exc_info=True)
            return self._fallback_response()
    
    def _redact_payment_leak(self, text: str) -> str:
        """RED DE SEGURIDAD ANTI-FRAUDE: bloquea números de pago inventados.

        El LLM jamás debe dictar datos de pago, pero si se le escapa un número
        (Nequi/cel) que NO está en `store.payment_instructions`, lo redactamos y
        entregamos los datos REALES (o un mensaje seguro). Esto evita que un
        número alucinado desvíe el dinero del cliente.
        """
        import re
        # ── Patrón de detección simplificado — el de producción se omite ──
        # El real está calibrado contra los formatos que efectivamente escriben
        # los modelos (separadores, indicativos, longitudes por tipo de cuenta)
        # y contra los falsos positivos que aparecieron en conversaciones
        # reales: precios, cantidades, direcciones, horarios. Ese ajuste fino
        # es la parte cara y no se publica.
        #
        # Lo que sí importa del diseño está intacto abajo: allowlist derivada
        # de la configuración del comercio, normalización antes de comparar,
        # tolerancia al indicativo de país, y fallback a los datos reales.
        NUM = re.compile(r'\+?\d[\d\-\.\s]{5,17}\d')
        norm = lambda s: re.sub(r'\D', '', s)

        def strip_cc(d):
            # Quita el indicativo de país 57 si el número quedó con ese prefijo.
            return d[2:] if d.startswith('57') and len(d) > 10 else d

        instr = self.store.payment_instructions or ''
        allowed_raw = {norm(m) for m in NUM.findall(instr)}
        allowed = allowed_raw | {strip_cc(a) for a in allowed_raw}

        leaked = []
        for m in NUM.findall(text or ''):
            d = norm(m)
            if not (7 <= len(d) <= 15):
                continue
            if d in allowed or strip_cc(d) in allowed:
                continue
            leaked.append(d)

        if not leaked:
            return text

        logger.error(
            f"🚨 ANTI-FRAUDE: el LLM filtró número(s) de pago NO autorizado(s) "
            f"{leaked} en orden {self.order.id}. Mensaje redactado."
        )
        if instr.strip():
            return (
                f"Para completar tu pago, estos son los datos oficiales:\n\n"
                f"{instr.strip()}\n\n"
                f"📸 Cuando pagues, envíame la foto del comprobante por aquí. ¡Gracias! 🙏"
            )
        return (
            "Dame un momentico y te confirmo los datos exactos de pago con el "
            "equipo 🙌 (no quiero pasarte un número equivocado)."
        )

    @staticmethod
    def _sanitize_output(text: str) -> str:
        """Limpia tokens de control / razonamiento que algunos modelos filtran.

        Maneja formato 'harmony' (gpt-oss): canales analysis/thought/commentary
        + el canal final. Si hay un canal 'final', devuelve solo su contenido;
        si no, descarta los bloques de razonamiento y los tokens <|...|>.
        """
        import re
        if not text:
            return ""
        raw = text

        # 1. Si existe canal 'final', quedarse solo con lo que va después
        #    (ahí va la respuesta real al usuario).
        m = re.search(r'<\|?channel\|?>?\s*final\b[^\n]*?(<\|?message\|?>?)?', raw, re.IGNORECASE)
        if m:
            raw = raw[m.end():]
        else:
            # 2. Sin canal 'final': la respuesta al usuario va ANTES del primer
            #    marcador de control; el razonamiento filtrado va después. Cortar ahí.
            cut = re.search(r'<\|?(channel|start|end|message)\b', raw, re.IGNORECASE)
            if not cut:
                cut = re.search(r'<\|', raw)
            if cut:
                raw = raw[:cut.start()]

        # 3. Quitar cualquier token de control suelto residual.
        raw = re.sub(r'<\|[^>]*\|?>', ' ', raw)
        raw = re.sub(r'<[^>]*\|>', ' ', raw)
        # 4. Etiquetas de rol/canal residuales al inicio.
        raw = re.sub(r'^\s*(assistant|final|message)\b[:\s]*', '', raw, flags=re.IGNORECASE)

        cleaned = raw.strip()
        # Fallback: si la limpieza dejó vacío, devolver el original sin tokens duros.
        if not cleaned:
            cleaned = re.sub(r'<[^>]*>', ' ', text).strip()
        return cleaned

    def _call_llm(self) -> Dict:
        """
        Llama al LLM (OpenAI o Anthropic) con el contexto actual.
        
        Returns:
            Respuesta del LLM (diccionario)
        """
        if settings.AI_PROVIDER in ['openai', 'deepseek', 'openrouter', 'gemini', 'google']:
            response = ai_client.chat.completions.create(
                model=settings.AI_MODEL,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    *self.conversation_history
                ],
                tools=TOOLS,
                tool_choice="auto",  # La IA decide cuándo usar herramientas
                temperature=0.7,
                max_tokens=900
            )
            return response.model_dump()
        
        elif settings.AI_PROVIDER == 'anthropic':
            response = ai_client.messages.create(
                model=settings.AI_MODEL,
                system=self.system_prompt,
                messages=self.conversation_history,
                tools=TOOLS,
                temperature=0.7,
                max_tokens=500
            )
            return response.model_dump()
        
        else:
            raise ValueError(f"AI Provider '{settings.AI_PROVIDER}' no soportado")
    
    def _parse_tool_call(self, tool_call):
        """Normaliza un tool call a (name, args) según el provider."""
        if settings.AI_PROVIDER in ['openai', 'deepseek', 'openrouter', 'gemini', 'google']:
            return tool_call['function']['name'], json.loads(tool_call['function']['arguments'])
        if settings.AI_PROVIDER == 'anthropic':
            return tool_call['name'], tool_call['input']
        return None, None

    def _handle_tool_calls(self, tool_calls: List) -> str:
        """
        Maneja las llamadas a funciones (function calling) del LLM.

        - confirmar_pedido: respuesta DETERMINISTA (dinero — nunca se delega
          el resumen/total al LLM).
        - guardar_datos_cliente: efecto secundario silencioso + SEGUNDA llamada
          al LLM con el resultado, para que la respuesta continúe la
          conversación (antes devolvía un texto enlatado que re-ofrecía el
          menú y mataba el pedido en curso).
        """
        parsed = []
        for tc in tool_calls:
            name, args = self._parse_tool_call(tc)
            if name:
                parsed.append((tc, name, args))

        # Prioridad: confirmar_pedido (flujo de dinero, respuesta fija).
        for _, name, args in parsed:
            if name == 'confirmar_pedido':
                return self._process_order_confirmation(args)

        # Tools de efecto secundario: ejecutar y continuar la conversación.
        side_effect_handlers = {
            'guardar_datos_cliente': self._save_customer_data,
            'actualizar_direccion': self._update_delivery_address,
            'agregar_nota_pedido': self._add_order_note,
            'enviar_menu': self._send_menu_image,
        }
        executed = []
        for tc, name, args in parsed:
            handler = side_effect_handlers.get(name)
            if handler:
                summary = handler(args)
                executed.append((tc, summary))

        if executed:
            return self._continue_after_tools(executed)

        return "Disculpa, no pude procesar eso. ¿Puedes repetir? 😅"

    def _continue_after_tools(self, executed) -> str:
        """Segunda pasada del LLM tras ejecutar tools de efecto secundario.

        Inyecta el tool call + su resultado al historial y pide la respuesta
        final. Así el bot retoma el hilo (ej: seguía tomando un pedido cuando
        el cliente dio su nombre) en vez de responder con texto enlatado.
        """
        try:
            if settings.AI_PROVIDER in ['openai', 'deepseek', 'openrouter', 'gemini', 'google']:
                self.conversation_history.append({
                    'role': 'assistant',
                    'content': None,
                    'tool_calls': [tc for tc, _ in executed],
                })
                for tc, summary in executed:
                    self.conversation_history.append({
                        'role': 'tool',
                        'tool_call_id': tc.get('id', 'call_0'),
                        'content': summary,
                    })
                response = ai_client.chat.completions.create(
                    model=settings.AI_MODEL,
                    messages=[
                        {"role": "system", "content": self.system_prompt},
                        *self.conversation_history
                    ],
                    tools=TOOLS,
                    tool_choice="auto",
                    temperature=0.7,
                    max_tokens=900,
                )
                data = response.model_dump()
                msg = (data.get('choices') or [{}])[0].get('message') or {}
                # Si en la segunda pasada decide confirmar el pedido, procesarlo.
                for tc in (msg.get('tool_calls') or []):
                    name, args = self._parse_tool_call(tc)
                    if name == 'confirmar_pedido':
                        return self._process_order_confirmation(args)
                text = self._redact_payment_leak(self._sanitize_output(msg.get('content')))
                if text.strip():
                    self.order.bot_state = 'SALES_CONVERSATION'
                    self.order.save()
                    return text
        except Exception as e:
            logger.error(f"Error en continuación post-tool: {e}", exc_info=True)

        # Fallback (anthropic o error): respuesta corta que no rompe el hilo.
        name = (self.order.customer.name if self.order.customer else '') or ''
        saludo = f"¡Listo, {name.split()[0]}! 🙌" if name else "¡Listo, anotado! 🙌"
        return f"{saludo} Sigamos con tu pedido: ¿en qué íbamos?"
    
    def _save_customer_data(self, data: Dict) -> str:
        """
        Guarda información del cliente capturada en la conversación.

        Returns:
            Resumen del resultado PARA EL LLM (tool result), no para el
            cliente — la respuesta al cliente la genera la segunda pasada
            en _continue_after_tools, retomando el hilo de la conversación.
        """
        customer = self.order.customer

        if not customer:
            logger.warning("No hay cliente asociado a esta orden para guardar datos")
            return "No hay cliente asociado; nada que guardar. Continúa la conversación."

        updated_fields = []

        # El nombre dicho explícitamente por el cliente gana al del perfil
        # del canal (Telegram pre-llena customer.name con el display name).
        if data.get('name') and data['name'].strip() and data['name'].strip() != customer.name:
            customer.name = data['name'].strip()
            # También actualizar en el order para compatibilidad
            self.order.customer_name = customer.name
            updated_fields.append('nombre')

        if data.get('phone') and not customer.phone:
            customer.phone = data['phone']
            updated_fields.append('teléfono')

        if data.get('notes'):
            # Agregar a notas existentes
            if customer.notes:
                customer.notes += f"\n{data['notes']}"
            else:
                customer.notes = data['notes']
            updated_fields.append('preferencias')

        if updated_fields:
            customer.save()
            self.order.save()
            logger.info(f"✅ Datos del cliente actualizados: {', '.join(updated_fields)}")
            return (f"Datos guardados correctamente ({', '.join(updated_fields)}). "
                    "Ahora responde al cliente CONTINUANDO la conversación exactamente "
                    "donde iba (si estaba armando un pedido, retómalo; NO vuelvas a "
                    "ofrecer el menú desde cero).")
        return ("Los datos ya estaban registrados. Continúa la conversación donde iba, "
                "sin reiniciar ni volver a ofrecer el menú.")
    
    def _update_delivery_address(self, data: Dict) -> str:
        """Tool 'actualizar_direccion': corrige la dirección del pedido en curso.

        Aplica sobre el pedido reciente ya confirmado/pagado (el que va a salir
        a la calle) y guarda la dirección como default del cliente. Devuelve el
        tool result para la segunda pasada del LLM.
        """
        address = (data.get('direccion') or data.get('address') or '').strip()
        if not address:
            return ("No se recibió una dirección válida. Pídele al cliente que "
                    "escriba su dirección completa.")

        target = self._get_recent_fulfillment_order()
        # Sin pedido en cocina: aplica al pedido actual (venta en curso).
        if not target:
            target = self.order

        target.delivery_address = address
        target.save(update_fields=['delivery_address'])

        customer = self.order.customer
        if customer:
            customer.default_address = address
            customer.save(update_fields=['default_address'])

        # Avisar al dashboard: el dueño ve la dirección corregida en vivo.
        try:
            from .tasks import notify_dashboard
            notify_dashboard.delay(str(target.id))
        except Exception:
            logger.warning("No se pudo notificar el cambio de dirección al dashboard", exc_info=True)

        logger.info(f"📍 Dirección actualizada en orden {target.id}: {address!r}")
        return (f"Dirección guardada correctamente para el pedido: {address}. "
                "Confírmale al cliente que quedó registrada y continúa la conversación.")

    def _add_order_note(self, data: Dict) -> str:
        """Tool 'agregar_nota_pedido': instrucción del cliente para el negocio.

        La nota queda en Order.notes del pedido en curso (visible en el
        dashboard) — sin esto el LLM prometía "ya avisé al equipo" sin que
        nadie se enterara.
        """
        note = (data.get('nota') or data.get('note') or '').strip()
        if not note:
            return "No se recibió una nota válida. Pídele al cliente que aclare qué necesita."

        target = self._get_recent_fulfillment_order()
        if not target and self.order.items.exists():
            target = self.order

        if target:
            stamped = f"🗒️ Cliente: {note}"
            target.notes = f"{target.notes}\n{stamped}".strip() if target.notes else stamped
            target.save(update_fields=['notes'])
            try:
                from .tasks import notify_dashboard
                notify_dashboard.delay(str(target.id))
            except Exception:
                logger.warning("No se pudo notificar la nota al dashboard", exc_info=True)
            logger.info(f"🗒️ Nota agregada a orden {target.id}: {note!r}")
            return (f"Nota registrada para el equipo del negocio: '{note}'. "
                    "Confírmale al cliente que quedó anotada y continúa la conversación.")

        # Sin pedido al cual anclar: guardar en el perfil del cliente.
        customer = self.order.customer
        if customer:
            customer.notes = f"{customer.notes}\n{note}".strip() if customer.notes else note
            customer.save(update_fields=['notes'])
            return (f"Nota guardada en el perfil del cliente: '{note}'. "
                    "Confírmale que quedó registrada y continúa la conversación.")
        return "No hay pedido ni cliente donde registrar la nota. Continúa la conversación."

    def _send_menu_image(self, data: Dict) -> str:
        """Tool 'enviar_menu': manda la imagen del menú digital al cliente.

        La imagen se renderiza desde la DB (services/menu_image.py) o la sube
        el dueño en Config → Menú digital. Sin imagen disponible, el tool
        result le pide al LLM mostrar el menú en texto (comportamiento previo).
        """
        store = self.store
        if not store.menu_image:
            return ("No hay imagen del menú disponible. Muestra el menú completo "
                    "en TEXTO usando el MENÚ ACTUAL de este prompt.")
        try:
            image_path = store.menu_image.path
            sent = False
            if self.order.source == Order.Source.TELEGRAM:
                from .services.telegram_service import resolve_store_token, send_telegram_photo
                token = resolve_store_token(store)
                sent = bool(send_telegram_photo(self.order.customer_phone, image_path, token=token))
            else:
                from .services.whatsapp_service import resolve_store_sender, send_image_message
                phone_number_id, token = resolve_store_sender(store)
                sent = bool(send_image_message(
                    phone_number_id, token, self.order.customer_phone, image_path))
            if not sent:
                raise RuntimeError("el canal no aceptó la imagen")

            # Dejar rastro en el historial del chat (dashboard + memoria del LLM)
            try:
                from .models import Message
                Message.objects.create(
                    order=self.order, sender='BOT',
                    content='🖼️ [Menú enviado como imagen]',
                    platform=self.order.source)
            except Exception:
                logger.warning("No se pudo registrar el mensaje del menú", exc_info=True)

            logger.info(f"🖼️ Menú digital enviado a {self.order.customer_phone} ({self.order.source})")
            return ("La imagen del menú YA fue enviada al cliente. NO repitas el menú "
                    "en texto: responde solo una frase corta invitando a elegir.")
        except Exception as e:
            logger.error(f"❌ Error enviando imagen del menú: {e}", exc_info=True)
            return ("No se pudo enviar la imagen del menú. Muestra el menú completo "
                    "en TEXTO usando el MENÚ ACTUAL de este prompt.")

    def _process_order_confirmation(self, order_data: Dict) -> str:
        """
        Procesa la confirmación del pedido y crea OrderItems en la base de datos.
        
        Args:
            order_data: Datos estructurados del pedido desde el LLM
            
        Returns:
            Mensaje de confirmación para el cliente
        """
        # Extraer nombre del cliente si está disponible
        if order_data.get('customer_name'):
            self.order.customer_name = order_data['customer_name']
        
        total = Decimal('0.00')
        items_created = []
        items_not_found = []
        
        # Crear OrderItem por cada producto
        for item_data in order_data.get('items', []):
            # Buscar producto por nombre (fuzzy match)
            product = self._find_product(item_data['product_name'])
            
            if product:
                order_item = OrderItem.objects.create(
                    order=self.order,
                    product=product,
                    product_name=product.name,  # Snapshot: sobrevive si el producto se borra
                    quantity=item_data['quantity'],
                    unit_price=product.price,  # Snapshot del precio actual
                    notes=item_data.get('notes', '')
                )
                total += order_item.subtotal
                items_created.append(order_item)
            else:
                items_not_found.append(item_data['product_name'])
        
        # Si no se encontró ningún producto válido
        if not items_created:
            return f"Disculpa, no encontré los productos que mencionaste: {', '.join(items_not_found)}. ¿Puedes verificar el nombre? 🤔"
        
        # Domicilio: tarifa fija de la tienda (gratis si supera el umbral).
        subtotal = total
        delivery_fee = self.store.compute_delivery_fee(subtotal)
        total = subtotal + delivery_fee

        # Actualizar total y estado de la orden
        self.order.delivery_fee = delivery_fee
        self.order.total_amount = total
        self.order.bot_state = 'WAITING_PAYMENT_PROOF'
        self.order.status = Order.Status.WAITING_PAYMENT
        self.order.save()
        
        # ==================== ACTUALIZAR ESTADÍSTICAS DEL CLIENTE ====================
        from django.utils import timezone
        
        customer = self.order.customer
        if customer:
            customer.total_orders += 1
            customer.total_spent += subtotal
            customer.last_order_at = timezone.now()
            
            # Actualizar productos favoritos
            for item in items_created:
                prod_name = item.display_name
                if prod_name not in customer.favorite_products:
                    customer.favorite_products.append(prod_name)
                    # Mantener solo los últimos 10 favoritos
                    if len(customer.favorite_products) > 10:
                        customer.favorite_products = customer.favorite_products[-10:]
            
            customer.save()
            logger.info(f"📊 Stats del cliente actualizadas: {customer.total_orders} pedidos, ${customer.total_spent:,.0f} gastados")
        # =============================================================================
        
        # Construir resumen de items
        items_summary = "\n".join([
            f"• {item.quantity}x {item.display_name} - ${item.unit_price:,.0f}"
            for item in items_created
        ])
        
        # Mensaje de productos no encontrados (si hay)
        not_found_msg = ""
        if items_not_found:
            not_found_msg = f"\n\n⚠️ No encontré: {', '.join(items_not_found)}\n"

        # Bloque de totales con desglose de domicilio.
        if delivery_fee > 0:
            totals_block = (
                f"Subtotal: ${subtotal:,.0f}\n"
                f"🛵 Domicilio: ${delivery_fee:,.0f}\n"
                f"💰 **TOTAL: ${total:,.0f}**"
            )
        elif self.store.delivery_fee and self.store.delivery_fee > 0:
            # Hay tarifa pero quedó gratis por superar el umbral.
            totals_block = (
                f"Subtotal: ${subtotal:,.0f}\n"
                f"🛵 Domicilio: ¡GRATIS! 🎉\n"
                f"💰 **TOTAL: ${total:,.0f}**"
            )
        else:
            totals_block = f"💰 **TOTAL: ${total:,.0f}**"
        
        # ========== INTEGRACIÓN CON SERVICIO DE PAGOS ==========
        from .services.payment_service import generate_payment_link
        
        payment_link = generate_payment_link(self.order)
        
        if payment_link:
            # Flujo automático con link de pago
            return f"""✅ ¡Pedido confirmado!

{items_summary}

{totals_block}{not_found_msg}

💳 Para confirmar, paga aquí de forma segura:
{payment_link}

El sistema validará tu pago automáticamente. ¡Gracias! 🙏"""
        else:
            # Flujo manual (NEQUI_MANUAL o error)
            saved_address = ''
            if self.order.customer:
                saved_address = (self.order.customer.default_address or '').strip()
            if saved_address:
                address_prompt = (
                    f"📍 ¿Te lo enviamos a **{saved_address}**?\n"
                    "Responde **SÍ** para usar esa dirección, o escribe la nueva dirección."
                )
            else:
                address_prompt = "📍 Por favor ingresa tu **dirección de entrega**."
            return f"""✅ ¡Pedido confirmado!

{items_summary}

{totals_block}{not_found_msg}

{address_prompt}"""
    
    def _handle_payment_proof(self) -> str:
        """
        Maneja el flujo después de confirmar el pedido:
        - Recibe dirección de entrega
        - Recibe método de pago
        - Recibe comprobante de pago
        
        Returns:
            Respuesta para el cliente
        """
        # Sub-estado: Esperando dirección
        if not self.order.delivery_address:
            customer = self.order.customer
            saved_address = (customer.default_address or '').strip() if customer else ''
            if saved_address and self._is_affirmative(self.text):
                # El cliente aceptó su dirección habitual — no la re-escribe.
                self.order.delivery_address = saved_address
            elif saved_address and (self.text or '').strip().lower() in ('no', 'otra', 'no esa', 'otra direccion', 'otra dirección', 'cambiar'):
                return "📍 Claro, escribe la **nueva dirección de entrega**."
            else:
                self.order.delivery_address = (self.text or '').strip()
                if customer and self.order.delivery_address:
                    # Recordarla para el próximo pedido.
                    customer.default_address = self.order.delivery_address
                    customer.save(update_fields=['default_address'])
            if not self.order.delivery_address:
                return "📍 Por favor escribe tu **dirección de entrega**."
            self.order.save()
            return """Perfecto! 📦

¿Cómo deseas pagar?
1️⃣ Nequi/Transferencia
2️⃣ Efectivo (contra entrega)

Escribe el número o el método."""
        
        # Sub-estado: Esperando método de pago
        if not self.order.payment_method:
            method = self._match_payment_method(self.text)

            if method == 'NEQUI':
                self.order.payment_method = 'NEQUI'
                self.order.save()
                # Datos de pago configurados por el dueño; jamás dictar datos inventados.
                payment_details = self.store.payment_instructions.strip()
                if payment_details:
                    return f"""💳 Perfecto!

**Realiza tu pago de ${self.order.total_amount:,.0f} a:**
{payment_details}

📸 **Adjunta la foto del comprobante aquí** para confirmar tu pago."""
                return f"""💳 Perfecto!

Tu pago es de **${self.order.total_amount:,.0f}**. El negocio te confirmará los datos de la cuenta en un momento.

📸 Cuando pagues, **adjunta la foto del comprobante aquí** para confirmar tu pedido."""
            
            elif method == 'CASH':
                self.order.payment_method = 'CASH'
                self.order.status = Order.Status.CONFIRMED
                self.order.bot_state = 'COMPLETED'
                self.order.save()
                return """✅ ¡Listo!

Tu pedido está confirmado. Pagarás en efectivo al recibir.

👨‍🍳 Estamos preparando tu pedido...
🚚 Te avisaremos cuando esté en camino.

¡Gracias por tu compra! 🙏"""
            
            else:
                return "Por favor elige:\n1️⃣ Nequi/Transferencia\n2️⃣ Efectivo"
        
        # Sub-estado: Esperando comprobante
        if self.media_url:
            self.order.payment_proof_url = self.media_url
            self.order.status = Order.Status.VERIFYING_PAYMENT
            self.order.bot_state = 'COMPLETED'
            self.order.save()
            return """✅ ¡Comprobante recibido!

Estamos validando tu pago. Te confirmaremos en breve.

👨‍🍳 Mientras tanto, comenzamos a preparar tu pedido.

¡Gracias! 🙏"""
        else:
            return "Por favor envía la **IMAGEN** del comprobante de pago. 📸"
    
    @staticmethod
    def _match_payment_method(text: str) -> Optional[str]:
        """Clasifica la respuesta del cliente como 'NEQUI', 'CASH' o None.

        Reconoce sinónimos coloquiales ("cash", "billete", "contraentrega") y
        los dígitos 1/2 como token aislado — nunca como substring ('1' dentro
        de "billete de 100" NO clasifica, bug histórico del `'1' in text`).
        """
        import re
        import unicodedata

        raw = text or ''
        norm = ''.join(
            c for c in unicodedata.normalize('NFD', raw.lower())
            if unicodedata.category(c) != 'Mn'
        )

        nequi_words = (r'\b(nequi|transferencia|transferir|transfiero|consignar|'
                       r'consignacion|daviplata|bancolombia|banco|qr)\b')
        cash_words = (r'\b(efectivo|cash|billete|billetes|contraentrega|money|'
                      r'sencillo|contado)\b')

        has_nequi = bool(re.search(nequi_words, norm)) or '1️⃣' in raw
        has_cash = (bool(re.search(cash_words, norm))
                    or 'contra entrega' in norm
                    or 'al recibir' in norm
                    or 'en la puerta' in norm
                    or '2️⃣' in raw)

        # Dígito como token aislado (no parte de otro número).
        if not has_nequi and re.search(r'(?<!\d)1(?!\d)', norm):
            has_nequi = True
        if not has_cash and re.search(r'(?<!\d)2(?!\d)', norm):
            has_cash = True

        # Ambiguo (mencionó ambos) → volver a preguntar.
        if has_nequi and has_cash:
            return None
        if has_nequi:
            return 'NEQUI'
        if has_cash:
            return 'CASH'
        return None

    @staticmethod
    def _is_affirmative(text: str) -> bool:
        """True si el mensaje es un 'sí' corto (acepta la dirección guardada).

        Solo respuestas breves e inequívocas: una dirección nueva jamás debe
        clasificar como afirmación (perderíamos la dirección real).
        """
        import re
        import unicodedata

        normalized = ''.join(
            c for c in unicodedata.normalize('NFD', (text or '').lower())
            if unicodedata.category(c) != 'Mn'
        )
        normalized = re.sub(r'[^a-z\s]', '', normalized).strip()
        normalized = re.sub(r'\s+', ' ', normalized)
        return normalized in {
            'si', 'sii', 'siii', 'yes', 'ok', 'okay', 'dale', 'de una',
            'listo', 'claro', 'claro que si', 'correcto', 'confirmo',
            'esa', 'esa misma', 'la misma', 'misma', 'a esa', 'si esa',
            'si a esa', 'si por favor', 'si porfa', 'porfa si', 'perfecto',
        }

    def _find_product(self, product_name: str) -> Optional[Product]:
        """
        Busca un producto por nombre usando fuzzy matching.
        
        Args:
            product_name: Nombre del producto a buscar
            
        Returns:
            Instancia de Product o None si no se encuentra
        """
        # Obtener todos los productos activos de la tienda
        products = Product.objects.filter(
            category__store=self.store,
            is_active=True
        )
        
        # 1. Búsqueda exacta (case-insensitive)
        product = products.filter(name__iexact=product_name).first()
        if product:
            return product
        
        # 2. Búsqueda parcial (contiene)
        product = products.filter(name__icontains=product_name).first()
        if product:
            return product
        
        # 3. Búsqueda inversa (el nombre del producto contiene lo que buscamos)
        for product in products:
            if product_name.lower() in product.name.lower():
                return product
        
        return None
    
    def _fallback_response(self) -> str:
        """
        Respuesta de fallback cuando el LLM no está disponible.
        
        Returns:
            Mensaje básico para el cliente
        """
        if self.order.bot_state == 'IDLE':
            self.order.bot_state = 'SALES_CONVERSATION'
            self.order.save()
            return f"¡Hola! 👋 Bienvenido a *{self.store.name}*. Escribe 'menu' para ver nuestros productos."
        
        return "Estoy teniendo problemas técnicos. Por favor intenta de nuevo en un momento. 🙏"