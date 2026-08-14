# Arquitectura

Documento de apoyo del [README](../README.md). Describe cómo está organizado el
sistema y por qué.

> Recordatorio: este repositorio es un snapshot parcial. Los prompts de
> producción y la orquestación afinada del motor conversacional no están
> incluidos.

---

## 1. Ciclo de vida de un pedido

Desde que el comensal escribe hasta que la cocina lo ve en pantalla.

```mermaid
sequenceDiagram
    autonumber
    participant C as Comensal
    participant M as WhatsApp
    participant W as Webhook
    participant Q as Celery
    participant E as bot_engine
    participant L as LLM
    participant DB as PostgreSQL
    participant WS as WebSocket
    participant K as Cocina / Dashboard

    C->>M: "hola, qué tienen?"
    M->>W: POST webhook
    W->>W: verifica firma
    W->>Q: encola (responde 200 de inmediato)
    Q->>E: procesa mensaje
    E->>DB: carga tienda, menú, historial, cliente
    E->>E: compone system prompt por capas
    E->>L: mensaje + tools disponibles
    L-->>E: respuesta o tool call
    E->>E: filtro anti-fuga de datos de pago
    E->>DB: persiste mensaje y estado

    Note over C,L: ... la conversación avanza ...

    L-->>E: tool call `confirmar_pedido`
    E->>DB: crea Order + OrderItems
    E->>M: datos de pago (los entrega el sistema, no el LLM)
    C->>M: foto del comprobante
    M->>W: webhook con media
    W->>Q: encola
    Q->>E: transición a pago verificado
    E->>DB: actualiza estado
    DB->>WS: signal post_save
    WS->>K: push en tiempo real
    K-->>K: suena la alerta, entra al Kanban
```

**Por qué el webhook responde antes de procesar.** Meta reintenta cualquier
webhook que no conteste rápido. Procesar el mensaje en línea significa timeouts
y mensajes duplicados en horas pico. El webhook solo verifica la firma, encola y
devuelve 200; el trabajo real ocurre en Celery.

---

## 2. Modelo de datos

```mermaid
erDiagram
    User ||--o{ Store : posee
    Store ||--o{ Category : tiene
    Category ||--o{ Product : contiene
    Store ||--o{ Order : recibe
    Store ||--|| Subscription : tiene
    Store ||--o| WhatsAppCredentials : conecta
    Store ||--o| PaymentConfig : configura
    Plan ||--o{ Subscription : define
    Customer ||--o{ Order : hace
    Order ||--o{ OrderItem : compone
    Order ||--o{ Message : conversa
    Product ||--o{ OrderItem : referencia
    User ||--o{ AuditLog : genera
```

Decisiones que valen la pena señalar:

- **`OrderItem` guarda un snapshot del nombre del producto.** Si el comercio
  renombra o borra un producto, los pedidos históricos siguen siendo legibles.
  Un reporte de ventas del mes pasado no puede depender del catálogo de hoy.
- **`Customer` es por tienda, no global.** El mismo número de teléfono en dos
  comercios distintos son dos clientes distintos, con historiales que jamás se
  cruzan.
- **Credenciales en tablas propias**, no como columnas de `Store`: permite
  cifrado por campo y que un comercio exista sin canal conectado.
- **`AuditLog` es append-only.** Registra la actividad del panel interno; su
  valor depende de que nadie pueda editarlo.

---

## 3. Suscripciones y cuotas

```mermaid
stateDiagram-v2
    [*] --> TRIALING: se crea la tienda
    TRIALING --> ACTIVE: se activa un plan pago
    TRIALING --> ACTIVE_FREE: vence el trial
    ACTIVE --> PAST_DUE: vence el período sin renovar
    PAST_DUE --> ACTIVE: se renueva el pago
    ACTIVE_FREE --> ACTIVE: hace upgrade
    ACTIVE --> ACTIVE: renueva y reinicia el consumo

    note right of PAST_DUE
        Sigue operando con el
        límite del plan gratis.
        No se apaga el servicio.
    end note
```

**Unidad de cobro: la conversación.** Una ventana de 24 horas por cliente, la
misma que usa Meta para facturar. Se eligió así porque es también la unidad de
costo del LLM: el precio del plan queda anclado al gasto que genera, en vez de
a una métrica que no se correlaciona con el costo (mensajes, pedidos, usuarios).

**El enforcement falla hacia abierto.** Si la verificación de cuota lanza una
excepción, se registra y se deja pasar el mensaje. Un error interno de
facturación no puede costarle una venta a un comercio.

📁 `orders/billing.py` · `orders/migrations/0013_seed_plans.py`

---

## 4. Capa de tiempo real

```mermaid
flowchart LR
    DB[("PostgreSQL")] -->|post_save signal| SIG["orders/signals.py"]
    SIG -->|group_send| RD[("Redis<br/>channel layer")]
    RD --> CON["OrdersConsumer"]
    CON -->|grupo por tienda| C1["Dashboard"]
    CON -->|grupo por tienda| C2["Pantalla de cocina"]
    CON -->|grupo por tienda| C3["Otras pestañas abiertas"]
```

- Un **grupo de Channels por tienda**: el aislamiento multi-tenant se mantiene
  también en el canal de tiempo real, no solo en la API REST.
- La autenticación del WebSocket va por **JWT en el handshake**
  (`orders/channels_auth.py`), no por sesión de Django.
- El frontend usa `react-use-websocket` con reconexión automática y un
  indicador de estado visible (`ConnectionStatus.js`): en una cocina, un socket
  caído en silencio es peor que un error a la vista.

---

## 5. Digitalización del menú desde una foto

El onboarding más frágil de un SaaS de restaurantes es pedirle al dueño que
escriba su menú producto por producto. Casi nadie termina ese formulario.

```mermaid
flowchart TD
    UP["El comercio sube foto o PDF"] --> TYPE{"¿Es PDF?"}
    TYPE -->|sí| PDF["Render de páginas a imagen<br/>(PyMuPDF)"]
    TYPE -->|no| IMG["Imagen directa"]
    PDF --> PRE
    IMG --> PRE
    PRE["Prevalidación con Google Vision:<br/>¿hay texto suficiente?"] --> OK{"¿Legible?"}
    OK -->|no| ERR["Se rechaza y se pide otra foto<br/>antes de gastar una llamada al LLM"]
    OK -->|sí| LLM["Modelo con visión →<br/>JSON estructurado"]
    LLM --> PARSE["Parseo tolerante<br/>y validación"]
    PARSE --> REVIEW["El comercio revisa y corrige"]
    REVIEW --> DB[("Categorías y productos")]
```

**Por qué la prevalidación existe.** Una llamada a un modelo con visión cuesta
y tarda. Una foto borrosa, oscura o que ni siquiera es un menú va a fallar de
todos modos — pero falla *cara* y *lenta*, y el dueño se queda mirando un
spinner para recibir un error. Google Vision responde en milisegundos y por
centavos: si no encuentra texto suficiente, se corta ahí y se pide otra foto.

**El resultado siempre pasa por revisión humana.** La extracción no escribe
directo al catálogo: el comercio ve lo que se detectó y lo corrige antes de
guardar. Un precio mal leído que entra al menú sin supervisión se convierte en
una venta a pérdida.

📁 `orders/services/menu_extractor.py`

---

## 6. Seguridad

| Superficie | Medida |
|---|---|
| API pública | JWT con rotación y blacklist tras rotación |
| Webhooks | Verificación de firma; endpoints exentos de autenticación pero validados criptográficamente |
| Multi-tenant | Filtrado por propietario en queryset + constraints de BD |
| Panel interno | Login separado, MFA por correo, restricción por dominio, throttle agresivo (5/min por IP) |
| Impersonation | Banner permanente + registro en `AuditLog` de cada acción |
| Respuestas del LLM | Filtro anti-fuga de datos de pago con allowlist por comercio |
| Credenciales de tienda | Cifradas y aisladas por tienda |
| Producción | HSTS, cookies seguras, `SECURE_PROXY_SSL_HEADER`, redirección SSL |
| Datos personales | Flujo de borrado de datos (cumplimiento Meta / habeas data) |

**Los mensajes de error del panel interno son deliberadamente indistinguibles.**
El paso 1 del login devuelve un 401 idéntico para "correo no existe",
"contraseña incorrecta" y "dominio no autorizado". Un atacante con una lista de
correos no debe poder averiguar cuáles pertenecen al equipo.

---

## 7. Despliegue

```mermaid
flowchart LR
    GH["push a main"] --> CI["GitHub Actions"]
    CI --> T1["Django system check"]
    CI --> T2["Migration drift guard"]
    CI --> T3["pytest"]
    CI --> T4["build del frontend"]
    T1 & T2 & T3 & T4 --> DEP["Trigger de despliegue"]
    DEP --> A1["backend (Daphne)"]
    DEP --> A2["Celery worker"]
    DEP --> A3["Celery beat"]
    DEP --> A4["frontend (nginx)"]
```

**Una sola imagen, cuatro roles.** El mismo `Dockerfile` sirve para Daphne, el
worker y el beat; la variable `CONTAINER_ROLE` decide qué arranca. Menos
imágenes que construir y ninguna posibilidad de que el worker corra una versión
distinta del código que el servidor web.

**Un push redespliega los cuatro servicios.** Antes solo se disparaba el
backend y el frontend seguía sirviendo el bundle viejo. Un despliegue parcial es
peor que ninguno: la SPA queda hablando con una API que ya cambió de contrato.

**Migration drift guard.** El CI falla si los modelos y las migraciones se
desincronizan. Es el error que no aparece en local y sí en producción, a mitad
de un despliegue.
