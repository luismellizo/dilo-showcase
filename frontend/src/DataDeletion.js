/**
 * Página de eliminación de datos.
 *
 * Cumple el requisito de Meta de tener una URL pública que explique cómo
 * eliminar los datos, y sirve como página de estado del callback de
 * eliminación: Meta le entrega al usuario un código de confirmación y esta
 * página lo consulta contra el backend.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trash2, Search, CheckCircle2, Clock, XCircle, Loader2, Mail, ListChecks } from 'lucide-react';
import LegalShell from './LegalShell';
import { COMPANY } from './companyInfo';
import { API_BASE_URL } from './config';

const STATUS_UI = {
    RECEIVED: { icon: Clock, color: 'text-amber-400', label: 'Recibida — en proceso' },
    COMPLETED: { icon: CheckCircle2, color: 'text-emerald-400', label: 'Completada' },
    FAILED: { icon: XCircle, color: 'text-red-400', label: 'Fallida — escríbenos' },
};

function StatusChecker() {
    const [searchParams] = useSearchParams();
    const [code, setCode] = useState(searchParams.get('code') || '');
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const lookup = useCallback(async (value) => {
        const trimmed = (value || '').trim();
        if (!trimmed) {
            setError('Escribe el código de confirmación');
            return;
        }

        setLoading(true);
        setError('');
        setResult(null);

        try {
            const response = await fetch(
                `${API_BASE_URL}/api/meta/data-deletion/status/?code=${encodeURIComponent(trimmed)}`
            );
            const data = await response.json();
            if (response.ok) {
                setResult(data);
            } else {
                setError(data.error || 'No encontramos ese código');
            }
        } catch {
            setError('No pudimos consultar el estado. Intenta de nuevo.');
        } finally {
            setLoading(false);
        }
    }, []);

    // Si Meta redirige con ?code=..., se consulta solo.
    useEffect(() => {
        const fromUrl = searchParams.get('code');
        if (fromUrl) lookup(fromUrl);
    }, [searchParams, lookup]);

    const statusUi = result ? STATUS_UI[result.status] : null;
    const StatusIcon = statusUi?.icon;

    return (
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 rounded-xl flex items-center justify-center">
                    <Search className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                    <h2 className="text-lg font-semibold text-white">Consultar una solicitud</h2>
                    <p className="text-sm text-gray-500">
                        Pega el código de confirmación que recibiste.
                    </p>
                </div>
            </div>

            <form
                className="flex flex-col sm:flex-row gap-3"
                onSubmit={(e) => { e.preventDefault(); lookup(code); }}
            >
                <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Código de confirmación"
                    aria-label="Código de confirmación"
                    className="flex-1 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
                />
                <button
                    type="submit"
                    disabled={loading}
                    className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                    {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                    Consultar
                </button>
            </form>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            {result && statusUi && (
                <div className="mt-5 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <div className={`flex items-center gap-2 font-medium ${statusUi.color}`}>
                        {StatusIcon && <StatusIcon size={18} />}
                        {statusUi.label}
                    </div>
                    <dl className="mt-3 text-sm text-gray-400 space-y-1">
                        <div className="flex gap-2">
                            <dt className="text-gray-600">Código:</dt>
                            <dd className="font-mono">{result.confirmation_code}</dd>
                        </div>
                        <div className="flex gap-2">
                            <dt className="text-gray-600">Solicitada:</dt>
                            <dd>{new Date(result.requested_at).toLocaleString('es-CO')}</dd>
                        </div>
                        {result.completed_at && (
                            <div className="flex gap-2">
                                <dt className="text-gray-600">Completada:</dt>
                                <dd>{new Date(result.completed_at).toLocaleString('es-CO')}</dd>
                            </div>
                        )}
                    </dl>
                </div>
            )}
        </div>
    );
}

export default function DataDeletion() {
    const sections = [
        {
            id: 'que-borramos',
            icon: Trash2,
            title: '1. Qué se elimina',
            content: `
                Al eliminar tu cuenta de ${COMPANY.brand} borramos de forma permanente:

                • Tu cuenta de acceso y tus datos de perfil.
                • Los datos de tu negocio: nombre, descripción, horarios, dirección y configuración del asistente.
                • Tu menú completo: categorías, productos y variantes.
                • Tus clientes finales: nombres, números de teléfono y direcciones guardadas.
                • Todos tus pedidos y su historial.
                • Todas las conversaciones y comprobantes de pago almacenados.
                • Las credenciales de tu canal de WhatsApp conectado, que además queda desvinculado de nuestra app en Meta.

                **La eliminación es irreversible.** No hay copia de seguridad que restaurar después.
            `
        },
        {
            id: 'como-borrar',
            icon: ListChecks,
            title: '2. Cómo eliminar tus datos',
            content: `
                Tienes tres caminos, todos válidos:

                **Desde tu panel (el más rápido)**
                • Entra a ${COMPANY.brand} con tu cuenta.
                • Ve a Perfil → Eliminar mi cuenta.
                • Escribe ELIMINAR para confirmar. El borrado ocurre de inmediato y recibes un código de confirmación.

                **Desde Facebook** (si conectaste WhatsApp con tu cuenta de Meta)
                • Entra a Configuración y privacidad → Configuración → Apps y sitios web.
                • Busca ${COMPANY.brand} y elimínala.
                • Facebook nos envía la solicitud automáticamente y te entrega un código de confirmación que puedes consultar en esta misma página.

                **Por correo**
                • Escribe a ${COMPANY.emails.privacy} desde el correo con el que te registraste.
                • Responderemos con el código de confirmación y ejecutaremos el borrado en un máximo de 30 días.
            `
        },
        {
            id: 'plazos',
            icon: Clock,
            title: '3. Plazos y excepciones',
            content: `
                El borrado iniciado desde el panel es **inmediato**. Las solicitudes recibidas por Facebook o por correo se procesan en un plazo máximo de treinta (30) días.

                Puede sobrevivir al borrado, únicamente lo siguiente:
                • Registros contables y facturas de tu suscripción, por el tiempo que exija la ley tributaria. No incluyen las conversaciones ni los datos de tus clientes.
                • Registros de la solicitud de eliminación (código, fecha y estado), para poder acreditar que se cumplió. No contienen datos personales de tu negocio ni de tus clientes.
                • Copias en registros técnicos que se rotan automáticamente y se destruyen en un plazo máximo de noventa (90) días.

                Los datos que WhatsApp o Meta conserven por su cuenta se rigen por las políticas de Meta, no por las nuestras.
            `
        },
        {
            id: 'contacto',
            icon: Mail,
            title: '4. Contacto',
            content: `
                ¿Dudas sobre tus datos o sobre una solicitud en curso?

                • Privacidad: ${COMPANY.emails.privacy}
                • Soporte: ${COMPANY.emails.support}

                Responsable del tratamiento: ${COMPANY.legalName}${COMPANY.address ? `, ${COMPANY.address}` : ''}.
            `
        },
    ];

    return (
        <LegalShell
            badge="Tus datos, tus reglas"
            badgeIcon={Trash2}
            title="Eliminación de datos"
            subtitle="Cómo borrar tu cuenta y todo lo que guardamos de ti, y cómo verificar que se hizo."
            updatedAt="4 de agosto de 2026"
            sections={sections}
        >
            <StatusChecker />
        </LegalShell>
    );
}
