/**
 * Términos y Condiciones del Servicio.
 *
 * Meta exige una URL de Términos de Servicio en la configuración básica de la
 * app, además de la política de privacidad. Sin ella la revisión no avanza.
 */
import React from 'react';
import {
    FileText, Handshake, CreditCard, MessageSquare, Ban, ShieldAlert,
    Scale, RefreshCw, Mail
} from 'lucide-react';
import LegalShell from './LegalShell';
import { COMPANY } from './companyInfo';

export default function TermsOfService() {
    const sections = [
        {
            id: 'aceptacion',
            icon: Handshake,
            title: '1. Aceptación de los Términos',
            content: `
                Estos Términos y Condiciones ("Términos") regulan el uso de la plataforma ${COMPANY.brand} ("el Servicio"), operada por ${COMPANY.legalName} ("nosotros").

                Al crear una cuenta, conectar un canal de mensajería o usar el Servicio de cualquier forma, usted ("el Comercio") acepta estos Términos en su totalidad. Si no está de acuerdo, no utilice el Servicio.

                Estos Términos se complementan con nuestra Política de Privacidad, que forma parte integral del acuerdo.
            `
        },
        {
            id: 'descripcion',
            icon: MessageSquare,
            title: '2. Descripción del Servicio',
            content: `
                ${COMPANY.brand} es una plataforma de ventas conversacionales que permite a un comercio atender pedidos por WhatsApp mediante un asistente automatizado.

                El Servicio incluye:
                • Un asistente conversacional que responde a los clientes del Comercio con la información del menú y las reglas que el propio Comercio configura.
                • Un panel de control con pedidos en tiempo real, historial de clientes y pantalla de cocina.
                • Conexión del número de WhatsApp Business del Comercio mediante el registro insertado (Embedded Signup) de Meta.

                **${COMPANY.brand} no es WhatsApp ni Meta.** Somos un proveedor de tecnología independiente que integra la Plataforma de WhatsApp Business. El uso de WhatsApp está sujeto además a los términos de Meta.
            `
        },
        {
            id: 'cuenta',
            icon: FileText,
            title: '3. Cuenta y Responsabilidades del Comercio',
            content: `
                Para usar el Servicio, el Comercio debe:
                • Ser mayor de edad y tener capacidad legal para contratar.
                • Proporcionar información veraz sobre su negocio.
                • Mantener la confidencialidad de sus credenciales de acceso.
                • Ser el titular legítimo del número de WhatsApp que conecte.

                El Comercio es el **responsable único** del contenido que publica (menú, precios, horarios, políticas de entrega y pago) y de la información que su asistente entrega a los clientes finales. ${COMPANY.brand} provee la herramienta; el Comercio provee y responde por su contenido comercial.

                El Comercio es también responsable de cumplir la normativa aplicable a su actividad: sanitaria, tributaria, de protección al consumidor y de protección de datos personales frente a sus propios clientes.
            `
        },
        {
            id: 'uso-aceptable',
            icon: Ban,
            title: '4. Uso Aceptable',
            content: `
                Está prohibido usar el Servicio para:
                • Enviar mensajes no solicitados masivos (spam) o contactar personas que no hayan iniciado conversación ni dado su consentimiento.
                • Comercializar productos o servicios ilegales, o cuya venta a distancia esté restringida.
                • Suplantar la identidad de otra persona, negocio o marca.
                • Vulnerar las Políticas de Comercio y de Mensajería de WhatsApp, o los Términos de la Plataforma de WhatsApp Business de Meta.
                • Intentar acceder a datos de otros comercios, a la infraestructura del Servicio o a cuentas ajenas.
                • Automatizar el Servicio con fines de reventa sin autorización escrita.

                El incumplimiento faculta la suspensión inmediata de la cuenta. Las infracciones a las políticas de Meta pueden además provocar la restricción del número de WhatsApp del Comercio directamente por Meta, sin que ${COMPANY.brand} pueda revertirla.
            `
        },
        {
            id: 'planes-pagos',
            icon: CreditCard,
            title: '5. Planes, Pagos y Prueba Gratuita',
            content: `
                El Servicio se ofrece bajo planes de suscripción con un límite mensual de conversaciones. Una conversación es una ventana de 24 horas por cliente final, contada desde su primer mensaje — el mismo criterio que usa Meta.

                • Las cuentas nuevas reciben una **prueba gratuita** del plan PRO por el periodo indicado al registrarse. Al vencer, la cuenta pasa al plan gratuito si no se activa un plan pago.
                • Los planes se facturan por periodos de 30 días.
                • Al agotar la cuota del plan, el asistente deja de responder automáticamente hasta la renovación o la mejora de plan. Los datos del Comercio no se borran.
                • Los precios están expresados en pesos colombianos (COP) e incluyen los impuestos aplicables cuando así se indique.
                • Los pagos realizados no son reembolsables por periodos ya consumidos, salvo que la ley aplicable disponga lo contrario.

                Los costos que Meta cobre directamente al Comercio por el uso de la Plataforma de WhatsApp Business son ajenos a la suscripción de ${COMPANY.brand} y corren por cuenta del Comercio.
            `
        },
        {
            id: 'datos',
            icon: ShieldAlert,
            title: '6. Datos y Privacidad',
            content: `
                El tratamiento de datos personales se rige por nuestra Política de Privacidad.

                Respecto de los datos de los **clientes finales** del Comercio (nombre, número de teléfono, dirección de entrega, historial de pedidos), el Comercio actúa como responsable del tratamiento y ${COMPANY.brand} actúa como encargado: los tratamos únicamente para prestar el Servicio y siguiendo las instrucciones del Comercio.

                El Comercio puede solicitar en cualquier momento la eliminación de su cuenta y de todos sus datos desde la página de eliminación de datos o escribiendo a ${COMPANY.emails.privacy}. La eliminación es irreversible.
            `
        },
        {
            id: 'disponibilidad',
            icon: RefreshCw,
            title: '7. Disponibilidad y Limitación de Responsabilidad',
            content: `
                Trabajamos para mantener el Servicio disponible de forma continua, pero **no garantizamos disponibilidad ininterrumpida**. El Servicio depende de terceros —Meta, proveedores de modelos de inteligencia artificial, pasarelas de pago e infraestructura en la nube— cuyas caídas o cambios de política pueden afectarlo.

                El asistente es un sistema automatizado: puede cometer errores de interpretación. El Comercio debe revisar los pedidos antes de despacharlos. ${COMPANY.brand} no responde por pedidos mal tomados, entregas fallidas ni pérdidas comerciales derivadas del uso del asistente.

                En la máxima medida permitida por la ley, la responsabilidad total de ${COMPANY.brand} frente al Comercio por cualquier reclamación se limita al monto efectivamente pagado por el Comercio en los tres (3) meses anteriores al hecho que la origine.
            `
        },
        {
            id: 'terminacion',
            icon: Scale,
            title: '8. Terminación',
            content: `
                El Comercio puede cancelar su cuenta en cualquier momento desde el panel o solicitando la eliminación de sus datos.

                Podemos suspender o terminar una cuenta si: se incumplen estos Términos, se incumplen las políticas de Meta, hay falta de pago, o existe un uso que ponga en riesgo la plataforma o a otros comercios. Salvo casos de abuso grave o exigencia legal, avisaremos previamente por correo.

                Al terminar la relación, el Comercio deja de tener acceso al panel. Los datos se eliminan conforme a la Política de Privacidad.
            `
        },
        {
            id: 'cambios-ley',
            icon: FileText,
            title: '9. Cambios, Ley Aplicable y Contacto',
            content: `
                Podemos modificar estos Términos. Los cambios sustanciales se comunicarán por correo o dentro del panel con al menos quince (15) días de antelación. Seguir usando el Servicio después de esa fecha implica su aceptación.

                Estos Términos se rigen por las leyes de la República de ${COMPANY.country}. Cualquier controversia se someterá a los jueces competentes de ${COMPANY.country}.

                **Contacto:**
                • Soporte: ${COMPANY.emails.support}
                • Asuntos legales: ${COMPANY.emails.legal}
                • Privacidad: ${COMPANY.emails.privacy}
            `
        },
    ];

    return (
        <LegalShell
            badge="Documento Legal"
            badgeIcon={Mail}
            title="Términos y Condiciones"
            subtitle={`Las reglas del juego entre tu negocio y ${COMPANY.brand}. Claras, sin letra chiquita.`}
            updatedAt="4 de agosto de 2026"
            sections={sections}
        />
    );
}
