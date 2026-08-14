import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft, Building2, UserCog, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { API_BASE_URL, formatCOP } from '../config';
import {
    Badge, Button, Card, EmptyState, Field, Modal, SectionCard, Skeleton, Toast, inputCls,
} from '../ui';
import StaffLayout from './StaffLayout';
import { useStaffRole } from './StaffGate';
import { startImpersonation } from './impersonation';
import { SUB_STATUS_LABELS, SUB_STATUS_TONES } from './StaffStores';

/**
 * Ficha de un cliente (tienda): cuenta, suscripción, métricas, config
 * editable (con confirmación + audit en backend), canales y consumidores.
 */

const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

// Campos editables — espejo de STORE_EDITABLE_FIELDS del backend.
const CONFIG_FIELDS = [
    { key: 'name', label: 'Nombre de la tienda', type: 'text' },
    { key: 'theme_color', label: 'Color de acento', type: 'text' },
    { key: 'bot_name', label: 'Nombre del asistente', type: 'text' },
    { key: 'address', label: 'Dirección', type: 'text' },
    { key: 'business_hours', label: 'Horarios', type: 'textarea' },
    { key: 'business_description', label: 'Descripción del negocio', type: 'textarea' },
    { key: 'bot_personality', label: 'Personalidad del bot', type: 'textarea' },
    { key: 'delivery_info', label: 'Domicilios (texto)', type: 'textarea' },
    { key: 'delivery_fee', label: 'Costo de domicilio (COP)', type: 'number' },
    { key: 'free_delivery_min', label: 'Domicilio gratis desde (COP)', type: 'number' },
    { key: 'prep_time_minutes', label: 'Tiempo de preparación (min)', type: 'number' },
    { key: 'payment_instructions', label: 'Datos de pago manual', type: 'textarea' },
    { key: 'bot_extra_info', label: 'Información adicional', type: 'textarea' },
    { key: 'bot_custom_instructions', label: 'Instrucciones del dueño para el bot', type: 'textarea' },
];

const InfoRow = ({ label, children }) => (
    <div className="flex items-start justify-between gap-4 py-2">
        <span className="text-sm text-gray-500 flex-shrink-0">{label}</span>
        <span className="text-sm font-semibold text-gray-900 text-right min-w-0 break-words">{children}</span>
    </div>
);

export default function StaffStoreDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { fetchWithAuth } = useAuth();
    const me = useStaffRole();
    const isAdmin = me?.role === 'admin';
    const canImpersonate = me?.role === 'admin' || me?.role === 'soporte';

    const [store, setStore] = useState(null);
    const [error, setError] = useState(null);
    const [toast, setToast] = useState(null);

    // Config edit
    const [form, setForm] = useState({});
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    // Plan change
    const [plans, setPlans] = useState([]);
    const [planModal, setPlanModal] = useState(false);
    const [planCode, setPlanCode] = useState('');
    const [planMonths, setPlanMonths] = useState(1);
    const [planSaving, setPlanSaving] = useState(false);

    // Impersonation
    const [impModal, setImpModal] = useState(false);
    const [impLoading, setImpLoading] = useState(false);

    // Customers
    const [customers, setCustomers] = useState(null);
    const [custPage, setCustPage] = useState(1);

    const load = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/staff/stores/${id}/`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setStore(data);
            setForm(data.config);
        } catch {
            setError('No se pudo cargar la tienda.');
        }
    }, [fetchWithAuth, id]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetchWithAuth(`${API_BASE_URL}/api/staff/stores/${id}/customers/?page=${custPage}`);
                if (res.ok) setCustomers(await res.json());
            } catch { /* sección secundaria: silencioso */ }
        })();
    }, [fetchWithAuth, id, custPage]);

    useEffect(() => {
        if (!isAdmin) return;
        (async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/billing/plans/`);
                if (res.ok) {
                    const data = await res.json();
                    setPlans(data.results || data);
                }
            } catch { /* selector de plan queda vacío */ }
        })();
    }, [isAdmin]);

    const changes = useMemo(() => {
        if (!store) return [];
        return CONFIG_FIELDS.filter(({ key }) => {
            const before = store.config[key];
            const after = form[key];
            return String(before ?? '') !== String(after ?? '');
        }).map(({ key, label }) => ({ key, label, before: store.config[key], after: form[key] }));
    }, [store, form]);

    const saveConfig = async () => {
        setSaving(true);
        try {
            const payload = {};
            changes.forEach(({ key, after }) => {
                payload[key] = after === '' && ['delivery_fee', 'free_delivery_min', 'prep_time_minutes'].includes(key)
                    ? null : after;
            });
            const res = await fetchWithAuth(`${API_BASE_URL}/api/staff/stores/${id}/`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(Object.values(err).flat().join(' ') || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setStore(data);
            setForm(data.config);
            setToast({ type: 'success', message: 'Configuración guardada y auditada.' });
        } catch (e) {
            setToast({ type: 'error', message: `Error al guardar: ${e.message}` });
        } finally {
            setSaving(false);
            setConfirmOpen(false);
        }
    };

    const changePlan = async () => {
        setPlanSaving(true);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/staff/stores/${id}/subscription/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan_code: planCode, months: planMonths }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            setStore((prev) => ({ ...prev, subscription: data.subscription }));
            setToast({ type: 'success', message: `Plan ${planCode} activado (${planMonths} mes/es).` });
            setPlanModal(false);
        } catch (e) {
            setToast({ type: 'error', message: e.message });
        } finally {
            setPlanSaving(false);
        }
    };

    const impersonate = async () => {
        setImpLoading(true);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/staff/impersonate/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ store_id: id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            startImpersonation(data); // redirige a /dashboard como el usuario
        } catch (e) {
            setToast({ type: 'error', message: e.message });
            setImpLoading(false);
            setImpModal(false);
        }
    };

    if (error) {
        return (
            <StaffLayout title="Tienda">
                <EmptyState icon={Building2} title="Error" description={error} action={<Button onClick={load}>Reintentar</Button>} />
            </StaffLayout>
        );
    }
    if (!store) {
        return (
            <StaffLayout title="Cargando…">
                <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>
            </StaffLayout>
        );
    }

    const sub = store.subscription;
    const m = store.metrics;

    return (
        <StaffLayout
            title={store.name}
            subtitle={store.account.owner_email}
            wide
            actions={
                <>
                    <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/admin/stores')}>Tiendas</Button>
                    {canImpersonate && (
                        <Button variant="dark" size="sm" icon={UserCog} onClick={() => setImpModal(true)}>
                            Iniciar sesión como este usuario
                        </Button>
                    )}
                </>
            }
        >
            <div className="grid lg:grid-cols-2 gap-5">
                <SectionCard title="Cuenta">
                    <div className="divide-y divide-gray-100">
                        <InfoRow label="Dueño">{store.account.owner_name || '—'}</InfoRow>
                        <InfoRow label="Email">{store.account.owner_email}</InfoRow>
                        <InfoRow label="WhatsApp">
                            {store.account.owner_whatsapp || '—'}{' '}
                            {store.account.whatsapp_verified && <Badge tone="green">Verificado</Badge>}
                        </InfoRow>
                        <InfoRow label="Registro">{fmtDate(store.account.registered_at)}</InfoRow>
                        <InfoRow label="Último acceso">{fmtDate(store.account.last_login)}</InfoRow>
                        <InfoRow label="Última actividad de clientes">{fmtDate(m.last_activity)}</InfoRow>
                        <InfoRow label="Canales">
                            <span className="inline-flex gap-1.5">
                                <Badge tone={store.channels.whatsapp.is_active ? 'green' : 'neutral'}>
                                    WhatsApp {store.channels.whatsapp.connected ? (store.channels.whatsapp.display_phone_number || 'conectado') : 'sin conectar'}
                                </Badge>
                                <Badge tone={store.channels.telegram.is_active ? 'green' : 'neutral'}>
                                    Telegram {store.channels.telegram.connected ? (store.channels.telegram.bot_username || 'conectado') : 'sin conectar'}
                                </Badge>
                            </span>
                        </InfoRow>
                        <InfoRow label="Pasarela de pago">
                            {store.payment_provider.provider || 'Sin configurar'}{' '}
                            {store.payment_provider.provider && (
                                <Badge tone={store.payment_provider.is_active ? 'green' : 'neutral'}>
                                    {store.payment_provider.is_active ? 'Activa' : 'Inactiva'}
                                </Badge>
                            )}
                        </InfoRow>
                    </div>
                </SectionCard>

                <SectionCard
                    title="Suscripción"
                    description="Plan y consumo del período actual"
                    footer={isAdmin && (
                        <Button variant="secondary" size="sm" onClick={() => { setPlanCode(sub?.plan_code || ''); setPlanModal(true); }}>
                            Cambiar / renovar plan
                        </Button>
                    )}
                >
                    {sub ? (
                        <div className="divide-y divide-gray-100">
                            <InfoRow label="Plan">
                                {sub.plan_name} · {formatCOP(sub.price_cop)}/mes{' '}
                                <Badge tone={SUB_STATUS_TONES[sub.status] || 'neutral'}>{SUB_STATUS_LABELS[sub.status] || sub.status}</Badge>
                            </InfoRow>
                            <InfoRow label="Conversaciones">
                                {sub.conversations_used} / {sub.conversation_limit ?? '∞'}
                            </InfoRow>
                            <InfoRow label="Período">{fmtDate(sub.current_period_start)} → {fmtDate(sub.current_period_end)}</InfoRow>
                            {sub.trial_ends_at && <InfoRow label="Fin del trial">{fmtDate(sub.trial_ends_at)}</InfoRow>}
                        </div>
                    ) : <p className="text-sm text-gray-400">Sin suscripción (planes no sembrados).</p>}
                </SectionCard>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
                {[
                    ['Pedidos totales', m.orders_total],
                    ['Pedidos 30d', m.orders_30d],
                    ['GMV total', formatCOP(m.gmv_total_cop)],
                    ['GMV 30d', formatCOP(m.gmv_30d_cop)],
                    ['Consumidores', m.customers_total],
                    ['Mensajes 30d', m.messages_30d],
                    ['Productos', m.products_total],
                    ['Confirmados', m.orders_by_status?.CONFIRMED || 0],
                ].map(([label, value]) => (
                    <Card key={label} className="p-4">
                        <p className="text-[11px] font-extrabold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
                        <p className="text-xl font-black text-gray-900 tabular-nums">{value}</p>
                    </Card>
                ))}
            </div>

            <SectionCard
                className="mt-5"
                title="Configuración de la tienda"
                description={isAdmin
                    ? 'Cambios con confirmación; todo queda en el audit log.'
                    : 'Solo lectura para tu rol.'}
                footer={isAdmin && (
                    <div className="flex items-center gap-3">
                        <Button onClick={() => setConfirmOpen(true)} disabled={changes.length === 0}>
                            Guardar cambios{changes.length > 0 ? ` (${changes.length})` : ''}
                        </Button>
                        {changes.length > 0 && (
                            <Button variant="ghost" onClick={() => setForm(store.config)}>Descartar</Button>
                        )}
                    </div>
                )}
            >
                <div className="grid sm:grid-cols-2 gap-4">
                    {CONFIG_FIELDS.map(({ key, label, type }) => (
                        <Field key={key} label={label}>
                            {type === 'textarea' ? (
                                <textarea
                                    className={inputCls(false)}
                                    rows={3}
                                    disabled={!isAdmin}
                                    value={form[key] ?? ''}
                                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                                />
                            ) : (
                                <input
                                    type={type}
                                    className={inputCls(false)}
                                    disabled={!isAdmin}
                                    value={form[key] ?? ''}
                                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                                />
                            )}
                        </Field>
                    ))}
                </div>
            </SectionCard>

            <SectionCard className="mt-5" title="Consumidores de la tienda" description="Clientes finales que le compran por WhatsApp/Telegram">
                {!customers ? <Skeleton className="h-32" /> : customers.results.length === 0 ? (
                    <p className="text-sm text-gray-400">Esta tienda aún no tiene clientes.</p>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[11px] font-extrabold uppercase tracking-widest text-gray-400 border-b border-gray-100">
                                        <th className="py-2 pr-4">Nombre</th>
                                        <th className="py-2 pr-4">Canal</th>
                                        <th className="py-2 pr-4">Teléfono</th>
                                        <th className="py-2 pr-4">Pedidos</th>
                                        <th className="py-2 pr-4">Gastado</th>
                                        <th className="py-2 pr-4">Último mensaje</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {customers.results.map((c) => (
                                        <tr key={c.id}>
                                            <td className="py-2.5 pr-4 font-semibold text-gray-900">{c.name || 'Sin nombre'}</td>
                                            <td className="py-2.5 pr-4"><Badge tone={c.channel_type === 'WHATSAPP' ? 'green' : 'blue'}>{c.channel_type}</Badge></td>
                                            <td className="py-2.5 pr-4 text-gray-500">{c.phone || '—'}</td>
                                            <td className="py-2.5 pr-4 text-gray-500 tabular-nums">{c.total_orders}</td>
                                            <td className="py-2.5 pr-4 text-gray-500 tabular-nums">{formatCOP(c.total_spent)}</td>
                                            <td className="py-2.5 pr-4 text-gray-500">{fmtDate(c.last_user_message_at)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {customers.pages > 1 && (
                            <div className="flex items-center justify-end gap-2 mt-3">
                                <span className="text-xs text-gray-400 mr-2">Página {customers.page} de {customers.pages}</span>
                                <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={customers.page <= 1} onClick={() => setCustPage(custPage - 1)} />
                                <Button variant="secondary" size="sm" icon={ChevronRight} disabled={customers.page >= customers.pages} onClick={() => setCustPage(custPage + 1)} />
                            </div>
                        )}
                    </>
                )}
            </SectionCard>

            {/* Confirmación de edición de config */}
            <Modal
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                title="Confirmar cambios"
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
                        <Button loading={saving} onClick={saveConfig}>Guardar y auditar</Button>
                    </>
                }
            >
                <p className="text-sm text-gray-500 mb-4">
                    Vas a modificar la configuración de <strong>{store.name}</strong>. El cambio afecta al bot en el siguiente mensaje.
                </p>
                <div className="space-y-3">
                    {changes.map(({ key, label, before, after }) => (
                        <div key={key} className="text-sm">
                            <p className="font-semibold text-gray-700">{label}</p>
                            <p className="text-red-500 line-through break-words">{String(before ?? '') || '(vacío)'}</p>
                            <p className="text-green-600 break-words">{String(after ?? '') || '(vacío)'}</p>
                        </div>
                    ))}
                </div>
            </Modal>

            {/* Cambio de plan */}
            <Modal
                open={planModal}
                onClose={() => setPlanModal(false)}
                title="Cambiar / renovar plan"
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setPlanModal(false)}>Cancelar</Button>
                        <Button loading={planSaving} disabled={!planCode} onClick={changePlan}>Activar plan</Button>
                    </>
                }
            >
                <p className="text-sm text-gray-500 mb-4">
                    Activa o renueva el plan tras confirmar el cobro (Nequi/transferencia). Reinicia el período y el contador de conversaciones.
                </p>
                <div className="space-y-4">
                    <Field label="Plan">
                        <select className={inputCls(false)} value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                            <option value="">Selecciona…</option>
                            {plans.map((p) => (
                                <option key={p.code} value={p.code}>{p.name} — {formatCOP(p.price_cop)}/mes</option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Meses" hint="Períodos de 30 días a activar (1-12).">
                        <input type="number" min="1" max="12" className={inputCls(false)} value={planMonths}
                            onChange={(e) => setPlanMonths(Number(e.target.value) || 1)} />
                    </Field>
                </div>
            </Modal>

            {/* Confirmación de impersonation */}
            <Modal
                open={impModal}
                onClose={() => setImpModal(false)}
                title="Iniciar sesión como este usuario"
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setImpModal(false)}>Cancelar</Button>
                        <Button variant="dark" loading={impLoading} onClick={impersonate}>Impersonar 30 min</Button>
                    </>
                }
            >
                <p className="text-sm text-gray-600 leading-relaxed">
                    Vas a ver el panel exactamente como <strong>{store.account.owner_email}</strong> ({store.name}).
                </p>
                <ul className="text-sm text-gray-500 mt-3 space-y-1.5 list-disc pl-5">
                    <li>La sesión expira en <strong>30 minutos</strong> y no se puede renovar.</li>
                    <li>Verás un banner permanente mientras dure.</li>
                    <li>La acción queda registrada en el audit log con tu usuario e IP.</li>
                </ul>
            </Modal>

            {toast && <Toast {...toast} onClose={() => setToast(null)} />}
        </StaffLayout>
    );
}
