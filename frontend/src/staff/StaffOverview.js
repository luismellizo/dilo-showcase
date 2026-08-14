import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, MoonStar, Info } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { API_BASE_URL, formatCOP } from '../config';
import { Badge, Card, EmptyState, SectionCard, Skeleton } from '../ui';
import StaffLayout from './StaffLayout';

/** Home del panel admin: KPIs globales de la plataforma + alertas. */

const Kpi = ({ label, value, sub }) => (
    <Card className="p-5">
        <p className="text-[11px] font-extrabold uppercase tracking-widest text-gray-400 mb-1.5">{label}</p>
        <p className="text-2xl font-black text-gray-900 tracking-tight tabular-nums">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </Card>
);

const ALERT_META = {
    past_due: { icon: AlertTriangle, tone: 'red', label: 'Pago vencido' },
    trial_ending: { icon: Clock, tone: 'amber', label: 'Trial por vencer' },
    inactive: { icon: MoonStar, tone: 'neutral', label: 'Inactiva' },
};

export default function StaffOverview() {
    const { fetchWithAuth } = useAuth();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetchWithAuth(`${API_BASE_URL}/api/staff/overview/`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                setData(await res.json());
            } catch (e) {
                setError('No se pudo cargar el resumen. Reintenta.');
            }
        })();
    }, [fetchWithAuth]);

    const k = data?.kpis;
    const subsStatus = k?.subscriptions_by_status || {};

    return (
        <StaffLayout title="Resumen de plataforma" subtitle="Todos los clientes de DILO">
            {error && (
                <EmptyState icon={AlertTriangle} title="Error" description={error} />
            )}
            {!error && !data && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
                </div>
            )}
            {data && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <Kpi label="Tiendas" value={k.total_stores} sub={`${k.active_stores_30d} activas · ${k.inactive_stores_30d} inactivas (30d)`} />
                        <Kpi label="MRR" value={formatCOP(k.mrr_cop)} sub="Suscripciones ACTIVE (cobro manual)" />
                        <Kpi label="Pedidos 30d" value={k.orders_30d} sub={`${k.sold_orders_30d} vendidos`} />
                        <Kpi label="GMV 30d" value={formatCOP(k.gmv_30d_cop)} sub="Confirmados + entregados" />
                        <Kpi label="Usuarios" value={k.total_users} sub="Cuentas activas" />
                        <Kpi label="Consumidores" value={k.customers_total} sub="Clientes finales de las tiendas" />
                        <Kpi label="Mensajes 30d" value={k.messages_30d} sub="Todos los canales" />
                        <Kpi
                            label="Suscripciones"
                            value={`${subsStatus.ACTIVE || 0} / ${subsStatus.TRIALING || 0}`}
                            sub={`activas / trial · ${subsStatus.PAST_DUE || 0} vencidas`}
                        />
                    </div>

                    <SectionCard title="Alertas" description="Clientes que necesitan atención">
                        {data.alerts.length === 0 ? (
                            <p className="text-sm text-gray-400">Sin alertas. Todo en orden.</p>
                        ) : (
                            <div className="divide-y divide-gray-100">
                                {data.alerts.map((a, i) => {
                                    const meta = ALERT_META[a.type] || ALERT_META.inactive;
                                    const Icon = meta.icon;
                                    return (
                                        <button
                                            key={i}
                                            onClick={() => navigate(`/admin/stores/${a.store_id}`)}
                                            className="w-full flex items-center gap-3 py-3 text-left hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                                        >
                                            <Icon size={16} className="text-gray-400 flex-shrink-0" />
                                            <span className="text-sm font-semibold text-gray-900 truncate">{a.store_name}</span>
                                            <span className="text-sm text-gray-500 truncate flex-1">{a.message}</span>
                                            <Badge tone={meta.tone}>{meta.label}</Badge>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </SectionCard>

                    <SectionCard
                        title="Métricas no disponibles"
                        description="Requieren instrumentación — no se simulan"
                    >
                        <div className="space-y-2">
                            {data.requires_instrumentation.map((m) => (
                                <div key={m.metric} className="flex items-start gap-2 text-sm">
                                    <Info size={15} className="text-gray-400 mt-0.5 flex-shrink-0" />
                                    <p className="text-gray-500">
                                        <span className="font-semibold text-gray-700">{m.metric.replaceAll('_', ' ')}</span>
                                        {' — '}{m.reason}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </SectionCard>
                </div>
            )}
        </StaffLayout>
    );
}
