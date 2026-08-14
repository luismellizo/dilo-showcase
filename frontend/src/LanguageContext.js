import React, { createContext, useContext, useState, useEffect } from 'react';

// ============================================
// TRADUCCIONES - ESPAÑOL / INGLÉS
// ============================================

const translations = {
    es: {
        // Navbar
        nav: {
            product: 'Producto',
            pricing: 'Precios',
            privacy: 'Privacidad',
            dashboard: 'Dashboard',
            login: 'Iniciar sesión',
            getStarted: 'Comenzar gratis'
        },
        // Hero
        hero: {
            badge: '+500 restaurantes activos',
            title: 'Vende más por',
            titleHighlight: 'WhatsApp',
            subtitle: 'DILO es el asistente de IA que atiende pedidos 24/7, procesa pagos y sincroniza tu equipo en tiempo real.',
            cta: 'Empezar gratis',
            demo: 'Ver demo'
        },
        // Features
        features: {
            title: 'Todo lo que necesitas',
            subtitle: 'Una plataforma completa para automatizar tu negocio de delivery',
            items: [
                {
                    title: 'Ventas Automáticas',
                    description: 'Tu asistente IA atiende pedidos 24/7 por WhatsApp como si fueras tú.'
                },
                {
                    title: 'Analytics en Vivo',
                    description: 'Dashboard intuitivo con métricas de ventas y comportamiento de clientes.'
                },
                {
                    title: 'Tiempo Real',
                    description: 'Sincronización instantánea entre cocina, caja y delivery.'
                },
                {
                    title: 'Pagos Seguros',
                    description: 'Integración con pasarelas de pago confiables y verificación automática.'
                }
            ]
        },
        // Pricing
        pricing: {
            title: 'Precios simples',
            subtitle: 'Sin sorpresas. Cancela cuando quieras.',
            month: '/mes',
            popular: 'Popular',
            getStarted: 'Empezar',
            plans: [
                {
                    name: 'Starter',
                    features: ['100 pedidos/mes', 'Dashboard básico', '1 usuario', 'Soporte email']
                },
                {
                    name: 'Pro',
                    features: ['Pedidos ilimitados', 'Analytics avanzado', 'Usuarios ilimitados', 'Soporte prioritario', 'API access']
                },
                {
                    name: 'Enterprise',
                    features: ['Todo de Pro', 'Multi-restaurante', 'Onboarding dedicado', 'SLA garantizado', 'Personalización']
                }
            ]
        },
        // CTA
        cta: {
            title: 'Empieza a vender más hoy',
            subtitle: 'Configura tu asistente de IA en menos de 5 minutos. No requiere tarjeta de crédito.',
            button: 'Comenzar gratis'
        },
        // Footer
        footer: {
            privacyLink: 'Política de Privacidad',
            terms: 'Términos',
            privacyNotice: 'Tu privacidad es importante.',
            privacyDescription: 'DILO cumple con las políticas de Meta y WhatsApp Business Platform. Lee nuestra',
            privacyLinkText: 'Política de Privacidad',
            copyright: '© 2024 DILO. Todos los derechos reservados.',
            compliance: 'Cumplimos con GDPR y políticas de WhatsApp Business.'
        },
        // Dashboard Preview
        dashboard: {
            title: 'Dashboard',
            date: 'Hoy, 16 de diciembre',
            salesToday: 'Ventas hoy',
            orders: 'Pedidos',
            avgTicket: 'Ticket promedio',
            newOrder: 'Nuevo pedido',
            now: 'Ahora',
            statuses: {
                NEW: 'Nuevo',
                WAITING_PAYMENT: 'Esperando Pago',
                VERIFYING_PAYMENT: 'Verificar Pago',
                CONFIRMED: 'En Cocina',
                PREPARING: 'Preparando',
                READY: 'Listo',
                COMPLETED: 'Completado',
                DELIVERED: 'Entregado',
                REJECTED: 'Rechazado',
                CANCELLED: 'Cancelado'
            },
            liveStates: {
                connecting: 'Conectando',
                live: 'En vivo',
                closing: 'Cerrando',
                disconnected: 'Desconectado',
                idle: 'Sin iniciar',
                unknown: 'Desconocido'
            },
            views: {
                kanban: 'Kanban',
                chat: 'Chat'
            },
            notify: {
                enable: 'Activar avisos de pedidos nuevos',
                enabled: 'Avisos de pedidos activados',
                denied: 'Avisos bloqueados — reactívalos desde el candado del navegador'
            },
            header: {
                pending: 'pendientes',
                customers: 'Clientes',
                settings: 'Configuración',
                profile: 'Mi perfil',
                logout: 'Salir'
            },
            list: {
                searchPlaceholder: 'Buscar pedido...',
                noResults: 'Sin resultados',
                noOrders: 'No hay pedidos',
                loadMore: 'Cargar más',
                loadingMore: 'Cargando...'
            },
            orderList: {
                unknownCustomer: 'Cliente desconocido',
                newOrder: 'Nuevo pedido',
                noItems: 'Sin items'
            },
            detail: {
                emptyTitle: 'DILO Orders',
                emptyDescription: 'Selecciona un pedido para ver los detalles, chatear con el cliente y gestionar el estado.',
                orderLabel: 'PEDIDO',
                total: 'Total',
                orderSummary: 'Resumen del Pedido',
                paymentProof: 'Comprobante de Pago',
                reject: 'Rechazar',
                confirmOrder: 'Confirmar Pedido',
                writeMessage: 'Escribe un mensaje...',
                back: 'Volver',
                botActive: 'Bot activo',
                botPaused: 'Atendiendo tú',
                pauseBot: 'Pausar el bot',
                resumeBot: 'Reactivar el bot'
            },
            stats: {
                salesToday: 'Ventas Hoy',
                pendingOrders: 'Pedidos Pendientes',
                avgTicket: 'Ticket Promedio',
                conversionRate: 'Tasa de Conversión',
                confirmedOrders: 'pedidos confirmados',
                totalOrders: 'pedidos totales',
                basedOnSales: 'Basado en {count} ventas',
                confirmedRejected: '{confirmed} confirmados / {rejected} rechazados'
            },
            kanban: {
                columns: {
                    pending: 'Pendientes',
                    preparing: 'En Preparación',
                    ready: 'Listos para Entrega',
                    done: 'Completados'
                },
                empty: 'Sin pedidos',
                actions: {
                    NEW: 'Revisar',
                    WAITING_PAYMENT: 'Confirmar',
                    VERIFYING_PAYMENT: 'Confirmar',
                    CONFIRMED: 'Marcar Listo',
                    COMPLETED: 'Entregar',
                    default: 'Siguiente'
                },
                newBadge: 'Nuevo',
                customerFallback: 'Cliente',
                noPhone: 'Sin teléfono',
                moreItems: 'más',
                cancelledColumn: 'Cancelados',
                dropHere: 'Suelta aquí',
                emptyBoardTitle: 'Todo tranquilo por ahora',
                emptyBoardDesc: 'Cuando un cliente escriba a tu bot, el pedido aparece aquí en tiempo real.',
                menu: {
                    copyPhone: 'Copiar teléfono',
                    openChat: 'Abrir chat',
                    printTicket: 'Imprimir comanda',
                    cancelOrder: 'Cancelar pedido',
                    copied: 'Teléfono copiado'
                }
            },
            toolbar: {
                searchPlaceholder: 'Buscar por cliente, teléfono o #pedido...',
                all: 'Todos',
                today: 'Hoy',
                undo: 'Deshacer',
                statusChanged: 'Pedido movido a "{status}"',
                undone: 'Cambio revertido'
            },
            greeting: {
                morning: 'Buenos días',
                afternoon: 'Buenas tardes',
                evening: 'Buenas noches',
                summary: '{count} pedidos hoy'
            },
            proof: {
                title: 'Comprobante de pago',
                openOriginal: 'Abrir original',
                approve: 'Aprobar pago',
                reject: 'Rechazar',
                zoomHint: 'Clic en la imagen para ampliar'
            }
        },
        storeConfig: {
            loading: 'Cargando configuración...',
            title: 'Configuración',
            defaultStoreName: 'Mi Tienda',
            tabs: {
                store: 'Tienda',
                categories: 'Categorías',
                products: 'Productos',
                menuImage: 'Menú digital',
                bot: 'Bot IA',
                payment: 'Pagos',
                channels: 'Canales'
            },
            menuImage: {
                heroTitle: 'Tu menú, como imagen profesional',
                heroDesc: 'Cuando un cliente pida el menú completo, el bot le envía esta imagen en vez de un texto gigante. Se genera desde tus categorías y productos — los precios siempre salen exactos de tu configuración.',
                generate: 'Generar menú',
                regenerate: 'Regenerar',
                uploadOwn: 'Subir mi propia imagen',
                previewTitle: 'Vista previa',
                sourceGenerated: 'Generada desde tu menú. Se actualiza sola cada vez que cambias categorías, productos o precios.',
                sourceUploaded: 'Imagen subida por ti — no se regenera automáticamente. Si cambias precios, recuerda actualizarla.',
                emptyDesc: 'Aún no hay imagen del menú.',
                emptyTitle: 'Sin menú digital todavía',
                emptyCta: 'Crea productos en las pestañas Categorías/Productos y pulsa "Generar menú".',
                updatedAt: 'Actualizado',
                generated: 'Menú digital generado',
                uploaded: 'Menú digital actualizado',
                bgTitle: 'Fondo con IA',
                bgDesc: 'La IA genera solo la decoración del fondo (sin texto): los nombres y precios siempre salen exactos de tu menú. El fondo se guarda y se reutiliza en cada actualización — solo se genera cuando tú lo pidas.',
                bgHintLabel: 'Indicaciones de estilo (opcional)',
                bgHintPlaceholder: 'Ej: estilo rústico con madera, tonos verdes, minimalista...',
                bgGenerate: 'Generar fondo con IA',
                bgRegenerate: 'Regenerar fondo',
                bgRemove: 'Quitar fondo',
                bgWait: 'Generando fondo... puede tardar hasta un minuto.',
                bgGenerated: 'Fondo generado y aplicado',
                bgRemoved: 'Fondo eliminado'
            },
            store: {
                title: 'Datos de la Tienda',
                name: 'Nombre',
                whatsapp: 'WhatsApp',
                themeColor: 'Color del Tema'
            }
        },
        // Auth Modal
        auth: {
            login: 'Iniciar sesión',
            register: 'Crear cuenta',
            verification: 'Verificación',
            email: 'tu@email.com',
            password: 'Tu contraseña',
            name: 'Tu nombre',
            phone: '+57 300 123 4567',
            passwordHint: 'Contraseña (mín. 8 caracteres)',
            loginButton: 'Iniciar Sesión',
            registerButton: 'Crear Cuenta',
            noAccount: '¿No tienes cuenta?',
            hasAccount: '¿Ya tienes cuenta?',
            signUp: 'Regístrate',
            signIn: 'Inicia sesión',
            verifyWhatsApp: 'Verifica tu WhatsApp',
            codeSent: 'Enviamos un código de 6 dígitos a tu WhatsApp',
            verify: 'Verificar',
            noCode: '¿No recibiste el código?',
            resend: 'Reenviar',
            sending: 'Enviando...',
            errors: {
                emailRequired: 'El email es requerido',
                emailInvalid: 'Email inválido',
                passwordRequired: 'La contraseña es requerida',
                passwordMin: 'Mínimo 8 caracteres',
                nameRequired: 'El nombre es requerido',
                whatsappRequired: 'El WhatsApp es requerido',
                enterDigits: 'Ingresa los 6 dígitos'
            }
        }
    },
    en: {
        // Navbar
        nav: {
            product: 'Product',
            pricing: 'Pricing',
            privacy: 'Privacy',
            dashboard: 'Dashboard',
            login: 'Log in',
            getStarted: 'Get started free'
        },
        // Hero
        hero: {
            badge: '+500 active restaurants',
            title: 'Sell more via',
            titleHighlight: 'WhatsApp',
            subtitle: 'DILO is the AI assistant that handles orders 24/7, processes payments, and syncs your team in real-time.',
            cta: 'Start free',
            demo: 'Watch demo'
        },
        // Features
        features: {
            title: 'Everything you need',
            subtitle: 'A complete platform to automate your delivery business',
            items: [
                {
                    title: 'Automatic Sales',
                    description: 'Your AI assistant handles orders 24/7 on WhatsApp as if it were you.'
                },
                {
                    title: 'Live Analytics',
                    description: 'Intuitive dashboard with sales metrics and customer behavior insights.'
                },
                {
                    title: 'Real-Time',
                    description: 'Instant sync between kitchen, cashier, and delivery.'
                },
                {
                    title: 'Secure Payments',
                    description: 'Integration with trusted payment gateways and automatic verification.'
                }
            ]
        },
        // Pricing
        pricing: {
            title: 'Simple pricing',
            subtitle: 'No surprises. Cancel anytime.',
            month: '/month',
            popular: 'Popular',
            getStarted: 'Get started',
            plans: [
                {
                    name: 'Starter',
                    features: ['100 orders/month', 'Basic dashboard', '1 user', 'Email support']
                },
                {
                    name: 'Pro',
                    features: ['Unlimited orders', 'Advanced analytics', 'Unlimited users', 'Priority support', 'API access']
                },
                {
                    name: 'Enterprise',
                    features: ['Everything in Pro', 'Multi-restaurant', 'Dedicated onboarding', 'Guaranteed SLA', 'Customization']
                }
            ]
        },
        // CTA
        cta: {
            title: 'Start selling more today',
            subtitle: 'Set up your AI assistant in less than 5 minutes. No credit card required.',
            button: 'Get started free'
        },
        // Footer
        footer: {
            privacyLink: 'Privacy Policy',
            terms: 'Terms',
            privacyNotice: 'Your privacy matters.',
            privacyDescription: 'DILO complies with Meta and WhatsApp Business Platform policies. Read our',
            privacyLinkText: 'Privacy Policy',
            copyright: '© 2024 DILO. All rights reserved.',
            compliance: 'GDPR and WhatsApp Business compliant.'
        },
        // Dashboard Preview
        dashboard: {
            title: 'Dashboard',
            date: 'Today, December 16',
            salesToday: 'Sales today',
            orders: 'Orders',
            avgTicket: 'Avg. ticket',
            newOrder: 'New order',
            now: 'Now',
            statuses: {
                NEW: 'New',
                WAITING_PAYMENT: 'Awaiting Payment',
                VERIFYING_PAYMENT: 'Verify Payment',
                CONFIRMED: 'In Kitchen',
                PREPARING: 'Preparing',
                READY: 'Ready',
                COMPLETED: 'Completed',
                DELIVERED: 'Delivered',
                REJECTED: 'Rejected',
                CANCELLED: 'Cancelled'
            },
            liveStates: {
                connecting: 'Connecting',
                live: 'Live',
                closing: 'Closing',
                disconnected: 'Disconnected',
                idle: 'Not started',
                unknown: 'Unknown'
            },
            views: {
                kanban: 'Kanban',
                chat: 'Chat'
            },
            notify: {
                enable: 'Turn on new order alerts',
                enabled: 'Order alerts are on',
                denied: 'Alerts blocked — re-enable them from the browser padlock'
            },
            header: {
                pending: 'pending',
                customers: 'Customers',
                settings: 'Settings',
                profile: 'My profile',
                logout: 'Log out'
            },
            list: {
                searchPlaceholder: 'Search order...',
                noResults: 'No results',
                noOrders: 'No orders yet',
                loadMore: 'Load more',
                loadingMore: 'Loading...'
            },
            orderList: {
                unknownCustomer: 'Unknown customer',
                newOrder: 'New order',
                noItems: 'No items'
            },
            detail: {
                emptyTitle: 'DILO Orders',
                emptyDescription: 'Select an order to view details, chat with the customer, and manage its status.',
                orderLabel: 'ORDER',
                total: 'Total',
                orderSummary: 'Order Summary',
                paymentProof: 'Payment Proof',
                reject: 'Reject',
                confirmOrder: 'Confirm Order',
                writeMessage: 'Write a message...',
                back: 'Back',
                botActive: 'Bot on',
                botPaused: 'You are replying',
                pauseBot: 'Pause the bot',
                resumeBot: 'Resume the bot'
            },
            stats: {
                salesToday: 'Sales Today',
                pendingOrders: 'Pending Orders',
                avgTicket: 'Average Ticket',
                conversionRate: 'Conversion Rate',
                confirmedOrders: 'confirmed orders',
                totalOrders: 'total orders',
                basedOnSales: 'Based on {count} sales',
                confirmedRejected: '{confirmed} confirmed / {rejected} rejected'
            },
            kanban: {
                columns: {
                    pending: 'Pending',
                    preparing: 'Preparing',
                    ready: 'Ready for Delivery',
                    done: 'Completed'
                },
                empty: 'No orders',
                actions: {
                    NEW: 'Review',
                    WAITING_PAYMENT: 'Confirm',
                    VERIFYING_PAYMENT: 'Confirm',
                    CONFIRMED: 'Mark Ready',
                    COMPLETED: 'Deliver',
                    default: 'Next'
                },
                newBadge: 'New',
                customerFallback: 'Customer',
                noPhone: 'No phone',
                moreItems: 'more',
                cancelledColumn: 'Cancelled',
                dropHere: 'Drop here',
                emptyBoardTitle: 'All quiet for now',
                emptyBoardDesc: 'When a customer messages your bot, the order shows up here in real time.',
                menu: {
                    copyPhone: 'Copy phone',
                    openChat: 'Open chat',
                    printTicket: 'Print ticket',
                    cancelOrder: 'Cancel order',
                    copied: 'Phone copied'
                }
            },
            toolbar: {
                searchPlaceholder: 'Search by customer, phone or #order...',
                all: 'All',
                today: 'Today',
                undo: 'Undo',
                statusChanged: 'Order moved to "{status}"',
                undone: 'Change reverted'
            },
            greeting: {
                morning: 'Good morning',
                afternoon: 'Good afternoon',
                evening: 'Good evening',
                summary: '{count} orders today'
            },
            proof: {
                title: 'Payment proof',
                openOriginal: 'Open original',
                approve: 'Approve payment',
                reject: 'Reject',
                zoomHint: 'Click the image to zoom'
            }
        },
        storeConfig: {
            loading: 'Loading settings...',
            title: 'Settings',
            defaultStoreName: 'My Store',
            tabs: {
                store: 'Store',
                categories: 'Categories',
                products: 'Products',
                menuImage: 'Digital menu',
                bot: 'AI Bot',
                payment: 'Payments',
                channels: 'Channels'
            },
            menuImage: {
                heroTitle: 'Your menu, as a professional image',
                heroDesc: 'When a customer asks for the full menu, the bot sends this image instead of a giant wall of text. It is rendered from your categories and products — prices always come straight from your setup.',
                generate: 'Generate menu',
                regenerate: 'Regenerate',
                uploadOwn: 'Upload my own image',
                previewTitle: 'Preview',
                sourceGenerated: 'Generated from your menu. It refreshes automatically whenever you change categories, products or prices.',
                sourceUploaded: 'Uploaded by you — it is never regenerated automatically. If you change prices, remember to update it.',
                emptyDesc: 'No menu image yet.',
                emptyTitle: 'No digital menu yet',
                emptyCta: 'Create products under Categories/Products and press "Generate menu".',
                updatedAt: 'Updated',
                generated: 'Digital menu generated',
                uploaded: 'Digital menu updated',
                bgTitle: 'AI background',
                bgDesc: 'AI only generates the background decoration (no text): names and prices always come straight from your menu. The background is cached and reused on every update — it is only generated when you ask for it.',
                bgHintLabel: 'Style hints (optional)',
                bgHintPlaceholder: 'E.g.: rustic wood style, green tones, minimalist...',
                bgGenerate: 'Generate AI background',
                bgRegenerate: 'Regenerate background',
                bgRemove: 'Remove background',
                bgWait: 'Generating background... may take up to a minute.',
                bgGenerated: 'Background generated and applied',
                bgRemoved: 'Background removed'
            },
            store: {
                title: 'Store Details',
                name: 'Name',
                whatsapp: 'WhatsApp',
                themeColor: 'Theme Color'
            }
        },
        // Auth Modal
        auth: {
            login: 'Log in',
            register: 'Create account',
            verification: 'Verification',
            email: 'you@email.com',
            password: 'Your password',
            name: 'Your name',
            phone: '+1 555 123 4567',
            passwordHint: 'Password (min. 8 characters)',
            loginButton: 'Log In',
            registerButton: 'Create Account',
            noAccount: "Don't have an account?",
            hasAccount: 'Already have an account?',
            signUp: 'Sign up',
            signIn: 'Log in',
            verifyWhatsApp: 'Verify your WhatsApp',
            codeSent: 'We sent a 6-digit code to your WhatsApp',
            verify: 'Verify',
            noCode: "Didn't receive the code?",
            resend: 'Resend',
            sending: 'Sending...',
            errors: {
                emailRequired: 'Email is required',
                emailInvalid: 'Invalid email',
                passwordRequired: 'Password is required',
                passwordMin: 'Minimum 8 characters',
                nameRequired: 'Name is required',
                whatsappRequired: 'WhatsApp is required',
                enterDigits: 'Enter the 6 digits'
            }
        }
    }
};

// ============================================
// CONTEXTO DE IDIOMA
// ============================================

const LanguageContext = createContext();

export const LanguageProvider = ({ children }) => {
    const [language, setLanguage] = useState(() => {
        // Recuperar idioma guardado o usar español por defecto
        const saved = localStorage.getItem('dilo-language');
        return saved || 'es';
    });

    useEffect(() => {
        localStorage.setItem('dilo-language', language);
    }, [language]);

    const toggleLanguage = () => {
        setLanguage(prev => prev === 'es' ? 'en' : 'es');
    };

    const t = translations[language];

    return (
        <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};

export default LanguageContext;
