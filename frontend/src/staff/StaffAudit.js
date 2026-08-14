import React, { useCallback, useEffect, useState } from 'react';
import { ScrollText, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { API_BASE_URL } from '../config';
import { Badge, Card, EmptyState, Skeleton, inputCls } from '../ui';
import StaffLayout from './StaffLayout';

/** Bitácora de acciones del equipo interno, filtrable por miembro y acción. */

const ACTION_TONES = {
    STORE_UPDATE: 'blue',
    SUBSCRIPTION_CHANGE: 'amber',
    IMPERSONATE: 'red',
};

const fmtDate = (iso) => new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

const DetailDiff = ({ detail }) => {
    if (!detail || Object.keys(detail).length === 0) return null;
    return (
        <pre className="text-[11px] text-gray-500 bg-gray-50 rounded-lg p-2 mt-1.5 overflow-x-auto whitespace-pre-wrap break-words">
            {JSON.stringify(detail, null, 1).replace(/[{}"]/g, '').trim()}
        </pre>
    );
};

export default function StaffAudit() {
    const { fetchWithAuth } = useAuth();
    const [actor, setActor] = useState('');
    const [action, setAction] = useState('');
    const [page, setPage] = useState(1);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page });
            if (actor) params.set('actor', actor);
            if (action) params.set('action', action);
            const res = await fetchWithAuth(`${API_BASE_URL}/api/staff/audit/?${params}`);
            if (res.ok) setData(await res.json());
        } finally {
            setLoading(false);
        }
    }, [fetchWithAuth, actor, action, page]);

    useEffect(() => {
        const t = setTimeout(load, actor ? 300 : 0);
        return () => clearTimeout(t);
    }, [load, actor]);

    return (
        <StaffLayout title="Auditoría" subtitle="Toda acción del equipo queda aquí" wide>
            <div className="flex flex-wrap gap-3 mb-4">
                <input
                    value={actor}
                    onChange={(e) => { setActor(e.target.value); setPage(1); }}
                    placeholder="Filtrar por miembro (email)…"
                    className={`${inputCls(false)} max-w-xs`}
                />
                <select
                    value={action}
                    onChange={(e) => { setAction(e.target.value); setPage(1); }}
                    className={`${inputCls(false)} max-w-[240px]`}
                >
                    <option value="">Todas las acciones</option>
                    <option value="STORE_UPDATE">Edición de configuración</option>
                    <option value="SUBSCRIPTION_CHANGE">Cambio de plan</option>
                    <option value="IMPERSONATE">Impersonation</option>
                </select>
            </div>

            {loading && <Skeleton className="h-96" />}
            {!loading && data && (
                data.results.length === 0 ? (
                    <EmptyState icon={ScrollText} title="Sin registros" description="Ninguna acción coincide con los filtros." />
                ) : (
                    <Card className="divide-y divide-gray-100">
                        {data.results.map((log) => (
                            <div key={log.id} className="px-5 py-3.5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge tone={ACTION_TONES[log.action] || 'neutral'}>{log.action_display}</Badge>
                                    <span className="text-sm font-semibold text-gray-900">{log.actor_email}</span>
                                    {log.store_name && <span className="text-sm text-gray-500">→ {log.store_name}</span>}
                                    {log.target_user_email && (
                                        <span className="text-sm text-gray-500">como <strong>{log.target_user_email}</strong></span>
                                    )}
                                    <span className="ml-auto text-xs text-gray-400 tabular-nums whitespace-nowrap">
                                        {log.ip_address && <span className="mr-3">IP {log.ip_address}</span>}
                                        {fmtDate(log.created_at)}
                                    </span>
                                </div>
                                <DetailDiff detail={log.detail} />
                            </div>
                        ))}
                    </Card>
                )
            )}

            {data && data.pages > 1 && (
                <div className="flex items-center justify-end gap-2 mt-4">
                    <span className="text-xs text-gray-400 mr-2">Página {data.page} de {data.pages}</span>
                    <button className="p-2 rounded-lg border border-gray-200 disabled:opacity-40" disabled={data.page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button>
                    <button className="p-2 rounded-lg border border-gray-200 disabled:opacity-40" disabled={data.page >= data.pages} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button>
                </div>
            )}
        </StaffLayout>
    );
}
