import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Building2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { API_BASE_URL } from '../config';
import { Badge, Button, Card, EmptyState, Skeleton, inputCls } from '../ui';
import StaffLayout from './StaffLayout';

/** Listado de tiendas (clientes de DILO) con búsqueda y paginación. */

export const SUB_STATUS_TONES = {
    ACTIVE: 'green', TRIALING: 'blue', PAST_DUE: 'red', CANCELED: 'neutral',
};
export const SUB_STATUS_LABELS = {
    ACTIVE: 'Activa', TRIALING: 'Trial', PAST_DUE: 'Vencida', CANCELED: 'Cancelada',
};

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function StaffStores() {
    const { fetchWithAuth } = useAuth();
    const navigate = useNavigate();
    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async (query, pageNum) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ page: pageNum });
            if (query) params.set('q', query);
            const res = await fetchWithAuth(`${API_BASE_URL}/api/staff/stores/?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setData(await res.json());
        } catch {
            setError('No se pudo cargar el listado.');
        } finally {
            setLoading(false);
        }
    }, [fetchWithAuth]);

    useEffect(() => {
        const t = setTimeout(() => load(q, page), q ? 300 : 0);
        return () => clearTimeout(t);
    }, [q, page, load]);

    return (
        <StaffLayout title="Tiendas" subtitle={data ? `${data.count} clientes` : 'Cargando…'} wide>
            <div className="mb-4 max-w-sm relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setPage(1); }}
                    placeholder="Buscar por nombre o email del dueño…"
                    className={`${inputCls(false)} pl-10`}
                />
            </div>

            {error && <EmptyState icon={Building2} title="Error" description={error} action={<Button onClick={() => load(q, page)}>Reintentar</Button>} />}
            {loading && !error && <Skeleton className="h-96" />}

            {!loading && !error && data && (
                data.results.length === 0 ? (
                    <EmptyState icon={Building2} title="Sin resultados" description="Ninguna tienda coincide con la búsqueda." />
                ) : (
                    <Card className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[11px] font-extrabold uppercase tracking-widest text-gray-400 border-b border-gray-100">
                                    <th className="px-4 py-3">Tienda</th>
                                    <th className="px-4 py-3">Dueño</th>
                                    <th className="px-4 py-3">Plan</th>
                                    <th className="px-4 py-3">Uso</th>
                                    <th className="px-4 py-3">Pedidos</th>
                                    <th className="px-4 py-3">Última actividad</th>
                                    <th className="px-4 py-3">Registro</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {data.results.map((s) => (
                                    <tr
                                        key={s.id}
                                        onClick={() => navigate(`/admin/stores/${s.id}`)}
                                        className="cursor-pointer hover:bg-gray-50 transition-colors"
                                    >
                                        <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{s.name}</td>
                                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{s.owner_email}</td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            {s.plan_code ? (
                                                <span className="inline-flex items-center gap-2">
                                                    <span className="font-semibold text-gray-700">{s.plan_code}</span>
                                                    <Badge tone={SUB_STATUS_TONES[s.subscription_status] || 'neutral'}>
                                                        {SUB_STATUS_LABELS[s.subscription_status] || s.subscription_status}
                                                    </Badge>
                                                </span>
                                            ) : <span className="text-gray-400">Sin suscripción</span>}
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 tabular-nums whitespace-nowrap">
                                            {s.conversations_used != null
                                                ? `${s.conversations_used} / ${s.conversation_limit ?? '∞'} conv.`
                                                : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 tabular-nums">{s.order_count}</td>
                                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(s.last_activity)}</td>
                                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(s.registered_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Card>
                )
            )}

            {data && data.pages > 1 && (
                <div className="flex items-center justify-end gap-2 mt-4">
                    <span className="text-xs text-gray-400 mr-2">Página {data.page} de {data.pages}</span>
                    <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={data.page <= 1} onClick={() => setPage(page - 1)} />
                    <Button variant="secondary" size="sm" icon={ChevronRight} disabled={data.page >= data.pages} onClick={() => setPage(page + 1)} />
                </div>
            )}
        </StaffLayout>
    );
}
