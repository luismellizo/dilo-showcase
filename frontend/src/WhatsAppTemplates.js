/**
 * Plantillas de mensaje de WhatsApp.
 *
 * Fuera de la ventana de 24 horas, WhatsApp solo permite escribirle primero a
 * un cliente con una plantilla aprobada por Meta. Sin esta pantalla la
 * recompra automática (win-back) no puede funcionar: el bot solo puede
 * responder, nunca iniciar.
 *
 * Consume /api/whatsapp/templates/ (permiso whatsapp_business_management).
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    FileText, Plus, Trash2, RefreshCw, CheckCircle2, Clock, XCircle, Info
} from 'lucide-react';
import { useAuth } from './AuthContext';
import {
    SectionCard, Button, IconButton, Field, Badge, EmptyState, Skeleton, Modal,
    inputCls, textareaCls, ICON
} from './ui';
import { API_BASE_URL } from './config';

const STATUS_STYLE = {
    APPROVED: { tone: 'green', icon: CheckCircle2, label: 'Aprobada' },
    PENDING: { tone: 'amber', icon: Clock, label: 'En revisión' },
    IN_APPEAL: { tone: 'amber', icon: Clock, label: 'En apelación' },
    REJECTED: { tone: 'red', icon: XCircle, label: 'Rechazada' },
    PAUSED: { tone: 'amber', icon: Clock, label: 'Pausada' },
    DISABLED: { tone: 'red', icon: XCircle, label: 'Deshabilitada' },
};

const CATEGORIES = [
    { value: 'UTILITY', label: 'Utilidad', hint: 'Estado del pedido, confirmaciones, recordatorios' },
    { value: 'MARKETING', label: 'Marketing', hint: 'Promociones y recompra. Requiere consentimiento del cliente' },
    { value: 'AUTHENTICATION', label: 'Autenticación', hint: 'Códigos de verificación' },
];

// Punto de partida real para el win-back: el comercio solo cambia el texto.
const STARTER = {
    name: 'recompra_clientes',
    category: 'MARKETING',
    language: 'es',
    body: 'Hola {{1}}, ¡te extrañamos en {{2}}! Escríbenos y te tomamos el pedido de una vez. 🍔',
    footer: 'Responde STOP para no recibir más mensajes',
};

const bodyText = (template) => {
    const body = (template.components || []).find((c) => c.type === 'BODY');
    return body?.text || '';
};

const WhatsAppTemplates = ({ storeId, connected }) => {
    const { fetchWithAuth } = useAuth();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(STARTER);

    const load = useCallback(async () => {
        if (!storeId || !connected) {
            setLoading(false);
            return;
        }
        setLoading(true);
        setError('');
        try {
            const res = await fetchWithAuth(
                `${API_BASE_URL}/api/whatsapp/templates/?store_id=${storeId}`
            );
            const data = await res.json();
            if (res.ok) {
                setTemplates(data.templates || []);
            } else {
                setError(data.error || 'No se pudieron cargar las plantillas');
            }
        } catch {
            setError('Error de conexión con el servidor');
        } finally {
            setLoading(false);
        }
    }, [fetchWithAuth, storeId, connected]);

    useEffect(() => { load(); }, [load]);

    const handleCreate = async () => {
        setSaving(true);
        setError('');
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/whatsapp/templates/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ store_id: storeId, ...form }),
            });
            const data = await res.json();
            if (res.ok) {
                setOpen(false);
                setNotice('Plantilla enviada a Meta. La revisión suele tardar unos minutos.');
                load();
            } else {
                setError(data.error || 'No se pudo crear la plantilla');
            }
        } catch {
            setError('Error de conexión con el servidor');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (name) => {
        if (!window.confirm(`¿Eliminar la plantilla "${name}"? Se borran todos sus idiomas.`)) return;
        setError('');
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/whatsapp/templates/`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ store_id: storeId, name }),
            });
            const data = await res.json();
            if (res.ok) {
                setTemplates((prev) => prev.filter((t) => t.name !== name));
            } else {
                setError(data.error || 'No se pudo eliminar la plantilla');
            }
        } catch {
            setError('Error de conexión con el servidor');
        }
    };

    if (!connected) {
        return (
            <SectionCard>
                <div className="flex items-center gap-4 mb-4">
                    <span className="w-10 h-10 bg-surface-high text-on-surface-variant rounded-shape-xl flex items-center justify-center flex-shrink-0">
                        <FileText size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                        <h2 className="text-title-lg text-on-surface">Plantillas de mensaje</h2>
                        <p className="text-body text-on-surface-variant mt-1">
                            Conecta WhatsApp Business para poder crearlas.
                        </p>
                    </div>
                </div>
                <p className="text-body text-on-surface-variant">
                    Las plantillas son el único modo de escribirle primero a un cliente
                    después de 24 horas sin conversación. Son las que hacen posible la
                    recompra automática.
                </p>
            </SectionCard>
        );
    }

    return (
        <SectionCard>
            <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-center gap-4 min-w-0">
                    <span className="w-10 h-10 bg-success-container text-success-on-container rounded-shape-xl flex items-center justify-center flex-shrink-0">
                        <FileText size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                        <h2 className="text-title-lg text-on-surface">Plantillas de mensaje</h2>
                        <p className="text-body text-on-surface-variant mt-1 truncate">
                            Para escribirle primero a un cliente fuera de las 24 horas
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <Button variant="secondary" size="sm" icon={RefreshCw} onClick={load} disabled={loading}>
                        Actualizar
                    </Button>
                    <Button size="sm" icon={Plus} onClick={() => { setForm(STARTER); setOpen(true); }}>
                        Nueva
                    </Button>
                </div>
            </div>

            {notice && (
                <div className="mb-4 flex items-start gap-3 rounded-shape-md bg-info-container text-info-on-container px-4 py-3 text-body">
                    <Info size={ICON.sm} strokeWidth={ICON.stroke} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{notice}</span>
                </div>
            )}
            {error && (
                <div className="mb-4 rounded-shape-md bg-danger-container text-danger-on-container px-4 py-3 text-body" role="alert">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                </div>
            ) : templates.length === 0 ? (
                <EmptyState
                    icon={FileText}
                    title="Sin plantillas todavía"
                    description="Crea una para poder reactivar clientes que llevan días sin pedir."
                />
            ) : (
                <ul className="space-y-2">
                    {templates.map((template) => {
                        const style = STATUS_STYLE[template.status] || {
                            tone: 'neutral', icon: Clock, label: template.status,
                        };
                        const StatusIcon = style.icon;
                        return (
                            <li
                                key={`${template.name}-${template.language}`}
                                className="flex items-start justify-between gap-4 rounded-shape-md bg-surface-container p-4"
                            >
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-title text-on-surface">{template.name}</span>
                                        <Badge tone={style.tone}>
                                            <StatusIcon size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" /> {style.label}
                                        </Badge>
                                        <span className="text-label text-on-surface-muted">
                                            {template.category} · {template.language}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-body text-on-surface-variant break-words">
                                        {bodyText(template)}
                                    </p>
                                    {template.status === 'REJECTED' && template.rejected_reason && (
                                        <p className="mt-1 text-body-sm text-danger">
                                            Motivo del rechazo: {template.rejected_reason}
                                        </p>
                                    )}
                                </div>
                                <IconButton
                                    icon={Trash2}
                                    size="sm"
                                    tone="danger"
                                    label={`Eliminar plantilla ${template.name}`}
                                    className="flex-shrink-0"
                                    onClick={() => handleDelete(template.name)}
                                />
                            </li>
                        );
                    })}
                </ul>
            )}

            <Modal open={open} onClose={() => !saving && setOpen(false)} title="Nueva plantilla">
                <div className="space-y-4">
                    <Field
                        label="Nombre"
                        hint="Solo minúsculas, números y guiones bajos. No se puede cambiar después."
                    >
                        <input
                            value={form.name}
                            onChange={(e) => setForm({
                                ...form,
                                name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                            })}
                            className={inputCls(false)}
                            placeholder="recompra_clientes"
                        />
                    </Field>

                    <Field
                        label="Categoría"
                        hint={CATEGORIES.find((c) => c.value === form.category)?.hint}
                    >
                        <select
                            value={form.category}
                            onChange={(e) => setForm({ ...form, category: e.target.value })}
                            className={inputCls(false)}
                        >
                            {CATEGORIES.map((c) => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                        </select>
                    </Field>

                    <Field label="Idioma" hint="Código de idioma de Meta: es, es_MX, en_US...">
                        <input
                            value={form.language}
                            onChange={(e) => setForm({ ...form, language: e.target.value.trim() })}
                            className={inputCls(false)}
                            placeholder="es"
                        />
                    </Field>

                    <Field
                        label="Mensaje"
                        hint="Usa {{1}}, {{2}}... para los datos variables (nombre del cliente, negocio)."
                    >
                        <textarea
                            value={form.body}
                            onChange={(e) => setForm({ ...form, body: e.target.value })}
                            rows={4}
                            className={textareaCls(false)}
                        />
                    </Field>

                    <Field label="Pie de página (opcional)">
                        <input
                            value={form.footer}
                            onChange={(e) => setForm({ ...form, footer: e.target.value })}
                            className={inputCls(false)}
                            placeholder="Responde STOP para no recibir más mensajes"
                        />
                    </Field>

                    <p className="text-body-sm text-on-surface-muted">
                        Meta revisa cada plantilla. Las de marketing solo pueden enviarse a
                        clientes que aceptaron recibirlas.
                    </p>

                    <div className="flex justify-end gap-2 pt-1">
                        <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button
                            icon={Plus}
                            loading={saving}
                            disabled={saving || !form.name || !form.body}
                            onClick={handleCreate}
                        >
                            Enviar a revisión
                        </Button>
                    </div>
                </div>
            </Modal>
        </SectionCard>
    );
};

export default WhatsAppTemplates;
