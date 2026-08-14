/**
 * Datos legales de la empresa — fuente única de verdad.
 *
 * Por qué existe este archivo: Meta cruza lo que dice el sitio web contra los
 * documentos que subes en la Verificación del Negocio. Si el footer, la
 * política de privacidad y los términos dicen cosas distintas, la verificación
 * se rechaza. Centralizar los datos en un solo módulo — consumido por el
 * footer, PrivacyPolicy, TermsOfService y LegalShell — hace imposible esa
 * divergencia.
 *
 * Los campos vacíos no se renderizan: es preferible omitir un dato a publicar
 * uno inventado.
 *
 * ⚠️ DATOS REALES REEMPLAZADOS POR PLACEHOLDERS en este snapshot público.
 *    La estructura y el patrón son los de producción.
 */

export const COMPANY = {
    // Nombre comercial del producto (marca). NO es la razón social: el producto
    // pertenece a la sociedad que opera el servicio (ver legalName). Meta acepta
    // marca != razón social siempre que el sitio DECLARE la relación — lo que
    // tumba la verificación es que el revisor no pueda atar el dominio a la
    // entidad cuyos documentos subiste.
    brand: 'DILO',

    // Razón social exacta del certificado de cámara de comercio.
    legalName: 'ACME S.A.S.',

    // Identificación tributaria con dígito de verificación.
    taxId: '900000000-0',

    // Dirección del domicilio principal, literal del certificado.
    address: 'Calle 00 # 00-00, Ciudad, Colombia',

    // Teléfono comercial del registro mercantil. Debe coincidir con el que se
    // declara en la Verificación del Negocio de Meta.
    phone: '+57 300 000 0000',

    country: 'Colombia',

    // Correos sobre el dominio real del producto. Un correo en un dominio que
    // no controlas es motivo de rechazo en la verificación.
    emails: {
        support: 'soporte@example.com',
        privacy: 'privacidad@example.com',
        legal: 'legal@example.com',
    },

    website: 'https://dilo.example.com',
};

/**
 * Línea de identificación legal para footers. Omite lo que no esté definido.
 *
 * Declara explícitamente marca -> entidad legal ("DILO es un producto de
 * <razón social>"): es el puente que el revisor de Meta necesita entre el
 * dominio del producto y los documentos de la Verificación del Negocio.
 */
export const legalLine = () => {
    const parts = [`${COMPANY.brand} es un producto de ${COMPANY.legalName}`];
    if (COMPANY.taxId) parts.push(`NIT ${COMPANY.taxId}`);
    if (COMPANY.address) parts.push(COMPANY.address);
    return parts.join(' · ');
};

export const CURRENT_YEAR = new Date().getFullYear();

export default COMPANY;
