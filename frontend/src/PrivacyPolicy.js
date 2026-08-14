import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Shield, Mail, Phone, Lock, Database, UserCheck, Trash2, FileText } from 'lucide-react';
import { COMPANY, legalLine, CURRENT_YEAR } from './companyInfo';

// ============================================
// POLÍTICA DE PRIVACIDAD - CONFORME A META
// ============================================

export default function PrivacyPolicy() {
    const sections = [
        {
            id: 'introduccion',
            icon: Shield,
            title: '1. Introducción',
            content: `
                Bienvenido a DILO ("nosotros", "nuestro" o "la Empresa"). Nos comprometemos a proteger la privacidad y seguridad de la información personal de nuestros usuarios ("usted", "usuario" o "cliente").
                
                Esta Política de Privacidad describe cómo recopilamos, usamos, almacenamos, compartimos y protegemos su información personal cuando utiliza nuestra plataforma de gestión de pedidos por WhatsApp (el "Servicio").
                
                Al utilizar DILO, usted acepta las prácticas descritas en esta política. Si no está de acuerdo con alguna parte de esta política, le rogamos que no utilice nuestros servicios.
            `
        },
        {
            id: 'responsable',
            icon: UserCheck,
            title: '2. Responsable del Tratamiento de Datos',
            content: `
                **DILO** actúa como Responsable del Tratamiento de sus datos personales.
                
                • **Razón Social:** ${COMPANY.legalName}
                ${COMPANY.taxId ? `• **NIT:** ${COMPANY.taxId}` : ''}
                • **Domicilio:** ${COMPANY.address}
                • **Correo de contacto:** ${COMPANY.emails.privacy}
                ${COMPANY.phone ? `• **Teléfono:** ${COMPANY.phone}` : ''}
                • **Sitio web:** ${COMPANY.website}

                Para cualquier consulta relacionada con el tratamiento de sus datos personales o el ejercicio de sus derechos, puede contactarnos a través de los canales anteriores.
            `
        },
        {
            id: 'datos-recopilados',
            icon: Database,
            title: '3. Información que Recopilamos',
            content: `
                Recopilamos diferentes tipos de información para proporcionar y mejorar nuestro Servicio:
                
                **3.1 Información proporcionada directamente por usted:**
                • Nombre completo
                • Dirección de correo electrónico
                • Número de teléfono/WhatsApp
                • Nombre del negocio/restaurante
                • Dirección del negocio
                • Información de pago (procesada por terceros seguros)
                
                **3.2 Información recopilada automáticamente:**
                • Direcciones IP
                • Tipo de navegador y dispositivo
                • Páginas visitadas y tiempo de navegación
                • Información de uso del Servicio
                
                **3.3 Información de WhatsApp Business Platform:**
                • Mensajes enviados y recibidos a través del Servicio
                • Número de teléfono del cliente final
                • Nombre de perfil de WhatsApp del cliente
                • Historial de conversaciones relacionadas con pedidos
                • Información de pedidos (productos, cantidades, direcciones de entrega)
                
                **Importante:** No tenemos acceso a conversaciones privadas de WhatsApp que no estén relacionadas con nuestro Servicio.
            `
        },
        {
            id: 'uso-datos',
            icon: FileText,
            title: '4. Cómo Utilizamos su Información',
            content: `
                Utilizamos la información recopilada para los siguientes propósitos:
                
                **4.1 Prestación del Servicio:**
                • Procesar y gestionar pedidos de sus clientes
                • Facilitar la comunicación entre su negocio y sus clientes
                • Enviar confirmaciones de pedido y actualizaciones de estado
                • Proporcionar soporte automatizado mediante IA
                
                **4.2 Mejora del Servicio:**
                • Analizar patrones de uso para mejorar la experiencia
                • Desarrollar nuevas funcionalidades
                • Personalizar el Servicio según sus preferencias
                
                **4.3 Comunicaciones:**
                • Enviar notificaciones sobre su cuenta
                • Informar sobre actualizaciones del Servicio
                • Proporcionar soporte técnico
                
                **4.4 Seguridad y Cumplimiento:**
                • Detectar y prevenir fraudes
                • Cumplir con obligaciones legales
                • Proteger los derechos de DILO y sus usuarios
            `
        },
        {
            id: 'base-legal',
            icon: Lock,
            title: '5. Base Legal para el Tratamiento',
            content: `
                Procesamos sus datos personales bajo las siguientes bases legales:
                
                **5.1 Ejecución de Contrato:** El tratamiento es necesario para la prestación del Servicio contratado (Art. 6.1.b RGPD).
                
                **5.2 Consentimiento:** Cuando usted nos proporciona explícitamente su consentimiento para fines específicos (Art. 6.1.a RGPD).
                
                **5.3 Interés Legítimo:** Para mejorar nuestros servicios, prevenir fraudes y garantizar la seguridad (Art. 6.1.f RGPD).
                
                **5.4 Obligación Legal:** Cuando el tratamiento es necesario para cumplir con una obligación legal (Art. 6.1.c RGPD).
            `
        },
        {
            id: 'whatsapp',
            icon: Phone,
            title: '6. Uso de WhatsApp Business Platform',
            content: `
                DILO utiliza la **WhatsApp Business Platform** proporcionada por Meta Platforms, Inc. para facilitar la comunicación entre negocios y sus clientes.
                
                **6.1 Datos procesados a través de WhatsApp:**
                • Mensajes de texto relacionados con pedidos
                • Números de teléfono de clientes
                • Nombres de perfil de WhatsApp
                • Información contenida en los mensajes (pedidos, direcciones, etc.)
                
                **6.2 Cumplimiento con políticas de Meta:**
                • Cumplimos con la [Política de WhatsApp Business](https://www.whatsapp.com/legal/business-policy/)
                • Cumplimos con los [Términos de Servicio de WhatsApp Business](https://www.whatsapp.com/legal/business-terms/)
                • No utilizamos los datos para publicidad de terceros
                • No vendemos información de clientes
                
                **6.3 Retención de mensajes:**
                • Los mensajes se almacenan de forma segura para el procesamiento de pedidos
                • Los datos se eliminan según nuestra política de retención (ver sección 7)
                
                **6.4 Responsabilidad compartida:**
                Meta y DILO actúan como corresponsables del tratamiento para ciertos datos procesados a través de WhatsApp Business Platform.
            `
        },
        {
            id: 'retencion',
            icon: Trash2,
            title: '7. Retención y Eliminación de Datos',
            content: `
                Conservamos sus datos personales solo durante el tiempo necesario para cumplir con los fines para los que fueron recopilados:
                
                **7.1 Datos de cuenta:** Mientras mantenga una cuenta activa con nosotros.
                
                **7.2 Datos de pedidos:** 
                • Historial de pedidos: 2 años para fines operativos
                • Datos contables: Según requisitos legales (generalmente 5-10 años)
                
                **7.3 Mensajes de WhatsApp:**
                • Mensajes activos: Durante el período de procesamiento del pedido
                • Historial de conversaciones: 90 días para soporte y mejora del servicio
                • Después de este período, los datos son anonimizados o eliminados
                
                **7.4 Eliminación de datos:**
                Puede solicitar la eliminación de sus datos en cualquier momento y por tres vías: desde su panel (Perfil → Eliminar mi cuenta, borrado inmediato), eliminando la app de DILO desde la configuración de su cuenta de Facebook, o escribiendo a ${COMPANY.emails.privacy}.

                El detalle de qué se borra, cómo hacerlo y cómo verificar que se completó está en nuestra página de eliminación de datos: ${COMPANY.website}/data-deletion

                Las solicitudes por correo o por Facebook se procesan dentro de los 30 días siguientes, salvo cuando exista una obligación legal de conservación.
            `
        },
        {
            id: 'seguridad',
            icon: Lock,
            title: '8. Seguridad de los Datos',
            content: `
                Implementamos medidas técnicas y organizativas apropiadas para proteger sus datos personales:
                
                **8.1 Medidas técnicas:**
                • Encriptación de datos en tránsito (TLS 1.3)
                • Encriptación de datos en reposo (AES-256)
                • Autenticación de dos factores disponible
                • Monitoreo continuo de seguridad
                • Copias de seguridad cifradas
                
                **8.2 Medidas organizativas:**
                • Acceso restringido a datos personales (principio de necesidad)
                • Capacitación regular del personal en protección de datos
                • Evaluaciones periódicas de seguridad
                • Políticas de gestión de incidentes
                
                **8.3 Notificación de brechas:**
                En caso de una brecha de seguridad que afecte sus datos personales, le notificaremos dentro de las 72 horas siguientes a su detección, según lo requiere la normativa aplicable.
            `
        },
        {
            id: 'terceros',
            icon: Database,
            title: '9. Compartición con Terceros',
            content: `
                Podemos compartir sus datos con terceros en las siguientes circunstancias:
                
                **9.1 Proveedores de servicios:**
                • Meta Platforms (WhatsApp Business Platform)
                • Proveedores de hosting y servicios en la nube
                • Procesadores de pago
                • Servicios de análisis
                
                **9.2 Obligaciones legales:**
                Cuando sea requerido por ley, orden judicial o autoridad competente.
                
                **9.3 Protección de derechos:**
                Para proteger los derechos, propiedad o seguridad de DILO, nuestros usuarios u otros.
                
                **9.4 Transferencias empresariales:**
                En caso de fusión, adquisición o venta de activos, sus datos podrían ser transferidos al nuevo propietario.
                
                **Importante:** No vendemos, alquilamos ni comercializamos sus datos personales con terceros para fines de marketing.
            `
        },
        {
            id: 'derechos',
            icon: UserCheck,
            title: '10. Sus Derechos',
            content: `
                Usted tiene los siguientes derechos respecto a sus datos personales:
                
                **10.1 Derecho de acceso:** Solicitar información sobre los datos que tenemos sobre usted.
                
                **10.2 Derecho de rectificación:** Corregir datos inexactos o incompletos.
                
                **10.3 Derecho de supresión:** Solicitar la eliminación de sus datos ("derecho al olvido").
                
                **10.4 Derecho de portabilidad:** Recibir sus datos en formato estructurado y transferible.
                
                **10.5 Derecho de oposición:** Oponerse al tratamiento de sus datos para fines específicos.
                
                **10.6 Derecho a limitar el tratamiento:** Restringir el procesamiento de sus datos.
                
                **10.7 Derecho a retirar el consentimiento:** Retirar su consentimiento en cualquier momento.
                
                **Cómo ejercer sus derechos:**
                Envíe su solicitud a **privacidad@example.com** con el asunto "Ejercicio de Derechos ARCO". Responderemos dentro de los 30 días hábiles.
            `
        },
        {
            id: 'cookies',
            icon: FileText,
            title: '11. Cookies y Tecnologías Similares',
            content: `
                Utilizamos cookies y tecnologías similares para mejorar su experiencia:
                
                **11.1 Cookies esenciales:** Necesarias para el funcionamiento del Servicio.
                
                **11.2 Cookies de rendimiento:** Nos ayudan a entender cómo utiliza el Servicio.
                
                **11.3 Cookies de funcionalidad:** Recuerdan sus preferencias.
                
                Puede gestionar sus preferencias de cookies a través de la configuración de su navegador.
            `
        },
        {
            id: 'menores',
            icon: Shield,
            title: '12. Menores de Edad',
            content: `
                DILO no está dirigido a menores de 18 años. No recopilamos intencionalmente información personal de menores. Si descubrimos que hemos recopilado datos de un menor sin el consentimiento parental verificable, procederemos a eliminar dicha información.
            `
        },
        {
            id: 'cambios',
            icon: FileText,
            title: '13. Cambios a esta Política',
            content: `
                Podemos actualizar esta Política de Privacidad ocasionalmente. Le notificaremos sobre cambios significativos mediante:
                
                • Publicación de la nueva política en nuestro sitio web
                • Notificación por correo electrónico
                • Aviso destacado en la plataforma
                
                La fecha de "Última actualización" al final de este documento indica cuándo se realizó la última revisión.
            `
        },
        {
            id: 'contacto',
            icon: Mail,
            title: '14. Contacto',
            content: `
                Si tiene preguntas, comentarios o solicitudes relacionadas con esta Política de Privacidad o el tratamiento de sus datos personales, contáctenos:
                
                **Correo electrónico:** privacidad@example.com
                **Asunto sugerido:** Consulta de Privacidad
                
                **Para ejercicio de derechos ARCO:**
                **Correo:** privacidad@example.com
                **Asunto:** Ejercicio de Derechos ARCO
                
                Nos comprometemos a responder todas las solicitudes dentro de los plazos legales establecidos.
            `
        }
    ];

    return (
        <div className="min-h-screen bg-[#0a0a0f] text-white">
            {/* Header */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0f]/80 backdrop-blur-2xl border-b border-white/[0.05]">
                <div className="max-w-4xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <Link
                            to="/"
                            className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors"
                        >
                            <ArrowLeft size={20} />
                            <span className="text-sm font-medium">Volver al inicio</span>
                        </Link>
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg overflow-hidden bg-gradient-to-br from-emerald-500/20 to-teal-500/20 p-0.5">
                                <img
                                    src="/logo192.png"
                                    alt="DILO"
                                    className="w-full h-full object-contain rounded-md"
                                />
                            </div>
                            <span className="font-bold text-white">DILO</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Hero */}
            <section className="pt-32 pb-16 px-6 relative overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-radial from-emerald-500/10 via-transparent to-transparent blur-3xl pointer-events-none" />

                <div className="max-w-4xl mx-auto text-center relative z-10">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full mb-6"
                    >
                        <Shield className="w-5 h-5 text-emerald-400" />
                        <span className="text-emerald-400 text-sm font-medium">Documento Legal</span>
                    </motion.div>

                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="text-4xl md:text-5xl font-bold mb-4"
                    >
                        Política de Privacidad
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="text-gray-400 text-lg max-w-2xl mx-auto"
                    >
                        Tu privacidad es nuestra prioridad. Conoce cómo protegemos y utilizamos tus datos.
                    </motion.p>

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                        className="text-gray-500 text-sm mt-6"
                    >
                        Última actualización: 4 de agosto de 2026
                    </motion.p>
                </div>
            </section>

            {/* Table of Contents */}
            <section className="px-6 pb-12">
                <div className="max-w-4xl mx-auto">
                    <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-6">
                        <h2 className="text-lg font-semibold text-white mb-4">Contenido</h2>
                        <div className="grid md:grid-cols-2 gap-2">
                            {sections.map((section, index) => (
                                <a
                                    key={section.id}
                                    href={`#${section.id}`}
                                    className="flex items-center gap-2 py-2 px-3 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.03] transition-colors text-sm"
                                >
                                    <section.icon size={14} className="text-emerald-400" />
                                    <span>{section.title}</span>
                                </a>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* Content */}
            <section className="px-6 pb-24">
                <div className="max-w-4xl mx-auto space-y-8">
                    {sections.map((section, index) => (
                        <motion.article
                            key={section.id}
                            id={section.id}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: index * 0.05 }}
                            className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-8 scroll-mt-24"
                        >
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 rounded-xl flex items-center justify-center">
                                    <section.icon className="w-5 h-5 text-emerald-400" />
                                </div>
                                <h2 className="text-xl font-bold text-white">{section.title}</h2>
                            </div>
                            <div className="prose prose-invert prose-sm max-w-none">
                                {section.content.split('\n').map((paragraph, pIndex) => {
                                    const trimmed = paragraph.trim();
                                    if (!trimmed) return null;

                                    // Handle bold text
                                    const formattedText = trimmed.split(/(\*\*.*?\*\*)/g).map((part, i) => {
                                        if (part.startsWith('**') && part.endsWith('**')) {
                                            return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
                                        }
                                        return part;
                                    });

                                    // Handle bullet points
                                    if (trimmed.startsWith('•')) {
                                        return (
                                            <p key={pIndex} className="text-gray-400 leading-relaxed pl-4 py-0.5">
                                                {formattedText}
                                            </p>
                                        );
                                    }

                                    return (
                                        <p key={pIndex} className="text-gray-400 leading-relaxed mb-3">
                                            {formattedText}
                                        </p>
                                    );
                                })}
                            </div>
                        </motion.article>
                    ))}
                </div>
            </section>

            {/* Footer */}
            <footer className="border-t border-white/[0.05] py-8 px-6">
                <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
                    <div>
                        <p className="text-sm text-gray-400 font-medium">{legalLine()}</p>
                        <p className="text-xs text-gray-600 mt-1">
                            © {CURRENT_YEAR} {COMPANY.brand}. Todos los derechos reservados.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
                        <Link to="/terms" className="text-gray-500 hover:text-white">Términos</Link>
                        <Link to="/data-deletion" className="text-gray-500 hover:text-white">Eliminar datos</Link>
                        <Link to="/" className="text-emerald-400 hover:text-emerald-300 font-medium">
                            Volver al inicio →
                        </Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
