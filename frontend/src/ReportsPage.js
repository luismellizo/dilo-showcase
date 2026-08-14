import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    DollarSign, ShoppingBag, TrendingUp, CheckCircle, BarChart3,
    AlertCircle, Download, Trophy,
} from 'lucide-react';
import { useAuth } from './AuthContext';
import DashboardLayout from './DashboardLayout';
import {
    Button, Chip, Divider, EmptyState, ProgressBar, Skeleton, ICON, cx,
} from './ui';
import { API_BASE_URL, formatCOP } from './config';

/**
 * Reportes del comercio.
 *
 * El plan PRO se vendía con "Analytics avanzado" y no existía nada; los datos
 * ya estaban en la DB. Consume `GET /api/reports/summary/`, que cuenta con el
 * MISMO criterio de venta que las tarjetas del dashboard (SOLD_STATUSES) — si
 * los dos números no cuadran, el dueño deja de confiar en ambos.
 *
 * Gráficas en SVG a mano, como el sparkline de StatsCards: meter una librería
 * de charts por una barra y una línea es peso muerto en el bundle.
 */

const RANGES = [7, 30, 90];

const TONES = {
    success: 'bg-success-container text-success-on-container',
    primary: 'bg-secondary-container text-secondary-on-container',
    info: 'bg-info-container text-info-on-container',
    neutral: 'bg-surface-high text-on-surface-variant',
};

const KpiCard = ({ icon: Icon, label, value, sublabel, tone = 'neutral' }) => (
    <div className="rounded-shape-lg bg-surface-low p-6">
        <span
            className={cx('w-10 h-10 rounded-shape-xl flex items-center justify-center mb-5', TONES[tone])}
            aria-hidden="true"
        >
            <Icon size={ICON.md} strokeWidth={ICON.stroke} />
        </span>
        <div className="text-title-lg sm:text-headline text-on-surface tabular-nums">{value}</div>
        <div className="text-body text-on-surface-variant mt-1">{label}</div>
        {sublabel && <div className="text-body-sm text-on-surface-muted mt-4">{sublabel}</div>}
    </div>
);

/* Gráfica de ventas por día: barras SVG. El color lo hereda por currentColor,
   así sigue al acento del comercio y al tema sin una sola línea extra. */
const SalesChart = ({ series }) => {
    const max = Math.max(...series.map(d => d.total), 1);
    const w = 720, h = 180, padB = 22;
    const slot = w / Math.max(series.length, 1);
    const barW = Math.max(2, Math.min(28, slot * 0.62));
    // Con 90 días no caben 90 etiquetas: se muestra una de cada N.
    const labelEvery = Math.ceil(series.length / 8);

    return (
        <svg
            viewBox={`0 0 ${w} ${h}`}
            className="w-full h-[180px] text-primary"
            role="img"
            aria-label={`Ventas por día: ${series.length} días`}
        >
            {series.map((d, i) => {
                const barH = Math.max(d.total > 0 ? 2 : 0, ((d.total / max) * (h - padB - 8)));
                const x = i * slot + (slot - barW) / 2;
                return (
                    <g key={d.date}>
                        <rect
                            x={x} y={h - padB - barH} width={barW} height={barH}
                            rx="3" fill="currentColor" opacity={d.total > 0 ? 0.9 : 0.18}
                        >
                            <title>{`${d.date}: ${formatCOP(d.total)} · ${d.orders} pedidos`}</title>
                        </rect>
                        {i % labelEvery === 0 && (
                            <text
                                x={x + barW / 2} y={h - 6} textAnchor="middle"
                                className="fill-current text-on-surface-muted"
                                fontSize="10"
                            >
                                {d.date.slice(5)}
                            </text>
                        )}
                    </g>
                );
            })}
        </svg>
    );
};

const FunnelStage = ({ label, value, base }) => (
    <div>
        <div className="flex items-baseline justify-between gap-3 mb-2">
            <span className="text-body text-on-surface-variant">{label}</span>
            <span className="text-body text-on-surface tabular-nums">
                {value} <span className="text-on-surface-muted">
                    · {base > 0 ? Math.round((value / base) * 100) : 0}%
                </span>
            </span>
        </div>
        <ProgressBar value={base > 0 ? value / base : 0} thick label={label} />
    </div>
);

const ReportsPage = () => {
    const { user, fetchWithAuth } = useAuth();
    const [days, setDays] = useState(30);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const storeId = user?.store?.id;

    const load = useCallback(async () => {
        if (!storeId) return;
        try {
            setLoading(true);
            setError(false);
            const res = await fetchWithAuth(
                `${API_BASE_URL}/api/reports/summary/?store_id=${storeId}&days=${days}`
            );
            if (!res.ok) throw new Error(`summary HTTP ${res.status}`);
            setData(await res.json());
        } catch (err) {
            console.error('Error cargando reportes:', err);
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [fetchWithAuth, storeId, days]);

    useEffect(() => { load(); }, [load]);

    // Un <a href> directo no lleva el JWT: hay que bajarlo con fetch y crear
    // el blob a mano.
    const downloadCsv = async () => {
        if (!storeId || !data) return;
        setDownloading(true);
        try {
            const res = await fetchWithAuth(
                `${API_BASE_URL}/api/reports/orders.csv/?store_id=${storeId}`
                + `&date_from=${data.range.from}&date_to=${data.range.to}`
            );
            if (!res.ok) throw new Error(`csv HTTP ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pedidos-${data.range.from}_${data.range.to}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Error exportando CSV:', err);
        } finally {
            setDownloading(false);
        }
    };

    const hasData = Boolean(data && data.sales.orders > 0);
    const topMax = useMemo(
        () => Math.max(1, ...((data?.top_products || []).map(p => p.units))),
        [data]
    );

    const actions = (
        <Button
            variant="secondary"
            icon={Download}
            onClick={downloadCsv}
            disabled={!hasData || downloading}
        >
            <span className="hidden sm:inline">{downloading ? 'Exportando…' : 'Exportar CSV'}</span>
        </Button>
    );

    return (
        <DashboardLayout
            title="Reportes"
            subtitle={
                loading ? 'Cargando…'
                    : data ? `Del ${data.range.from} al ${data.range.to}`
                        : 'Ventas, productos más vendidos y embudo de conversión'
            }
            actions={actions}
            wide
        >
            {/* Selector de rango */}
            <div className="flex items-center gap-2 mb-6" role="group" aria-label="Rango del reporte">
                {RANGES.map(d => (
                    <Chip key={d} selected={days === d} onClick={() => setDays(d)}>
                        {d} días
                    </Chip>
                ))}
            </div>

            {loading ? (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-4">
                        {[0, 1, 2, 3].map(i => (
                            <div key={i} className="rounded-shape-lg bg-surface-low p-6">
                                <Skeleton className="w-10 h-10 rounded-shape-xl mb-5" />
                                <Skeleton className="h-7 w-3/5 mb-3" />
                                <Skeleton className="h-4 w-4/5" />
                            </div>
                        ))}
                    </div>
                    <div className="rounded-shape-lg bg-surface-low p-6">
                        <Skeleton className="h-5 w-40 mb-6" />
                        <Skeleton className="h-[180px] w-full" />
                    </div>
                </div>
            ) : error ? (
                <EmptyState
                    icon={AlertCircle}
                    title="No se pudieron cargar los reportes"
                    description="Revisa tu conexión e inténtalo de nuevo."
                    action={<Button variant="secondary" onClick={load}>Reintentar</Button>}
                />
            ) : !hasData ? (
                <EmptyState
                    icon={BarChart3}
                    title="Sin ventas en este rango"
                    description="Cuando cierres pedidos, aquí verás cuánto vendiste, qué se vende más y cuántas conversaciones terminan en venta."
                    action={
                        days < 90
                            ? <Button variant="secondary" onClick={() => setDays(90)}>Ver los últimos 90 días</Button>
                            : null
                    }
                />
            ) : (
                <div className="space-y-6 anim-fade-up">
                    {/* KPIs */}
                    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-4">
                        <KpiCard
                            icon={DollarSign} tone="success"
                            label="Ventas del período"
                            value={formatCOP(data.sales.total)}
                            sublabel={`${data.sales.orders} pedidos vendidos`}
                        />
                        <KpiCard
                            icon={ShoppingBag} tone="primary"
                            label="Pedidos"
                            value={data.sales.orders}
                            sublabel={`${data.funnel.conversations} conversaciones`}
                        />
                        <KpiCard
                            icon={TrendingUp} tone="info"
                            label="Ticket promedio"
                            value={formatCOP(data.sales.avg_ticket)}
                            sublabel={`en ${data.range.days} días`}
                        />
                        <KpiCard
                            icon={CheckCircle} tone="neutral"
                            label="Conversión"
                            value={`${data.funnel.conversion_rate}%`}
                            sublabel={`${data.funnel.abandoned} conversaciones sin pedido`}
                        />
                    </div>

                    {/* Ventas por día */}
                    <div className="rounded-shape-lg bg-surface-low p-6">
                        <h2 className="text-title text-on-surface mb-1">Ventas por día</h2>
                        <p className="text-body-sm text-on-surface-muted mb-5">
                            Los días sin ventas se muestran en cero, no se omiten.
                        </p>
                        <SalesChart series={data.sales.series} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Más vendidos */}
                        <div className="rounded-shape-lg bg-surface-low p-6">
                            <h2 className="text-title text-on-surface mb-5">Más vendidos</h2>
                            {data.top_products.length === 0 ? (
                                <EmptyState
                                    icon={Trophy}
                                    size="compact"
                                    title="Sin productos vendidos"
                                    description="Los pedidos del rango no tienen items registrados."
                                />
                            ) : (
                                <div>
                                    {data.top_products.map((p, i) => (
                                        <React.Fragment key={`${p.name}-${i}`}>
                                            {i > 0 && <Divider />}
                                            <div className="flex items-center gap-4 min-h-[56px]">
                                                <span className="text-body text-on-surface-muted tabular-nums w-6 flex-shrink-0">
                                                    {i + 1}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-body text-on-surface truncate">{p.name}</p>
                                                    <ProgressBar value={p.units / topMax} className="mt-1.5" />
                                                </div>
                                                <div className="text-right flex-shrink-0">
                                                    <div className="text-body text-on-surface tabular-nums">{p.units} u.</div>
                                                    <div className="text-body-sm text-on-surface-muted tabular-nums">
                                                        {formatCOP(p.revenue)}
                                                    </div>
                                                </div>
                                            </div>
                                        </React.Fragment>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Embudo */}
                        <div className="rounded-shape-lg bg-surface-low p-6">
                            <h2 className="text-title text-on-surface mb-1">Embudo</h2>
                            <p className="text-body-sm text-on-surface-muted mb-5">
                                De cuántas conversaciones sale una venta.
                            </p>
                            <div className="space-y-5">
                                <FunnelStage
                                    label="Conversaciones"
                                    value={data.funnel.conversations}
                                    base={data.funnel.conversations}
                                />
                                <FunnelStage
                                    label="Con productos en el carrito"
                                    value={data.funnel.with_items}
                                    base={data.funnel.conversations}
                                />
                                <FunnelStage
                                    label="Pedidos vendidos"
                                    value={data.funnel.confirmed}
                                    base={data.funnel.conversations}
                                />
                            </div>
                            <p className="text-body-sm text-on-surface-muted mt-5">
                                {data.funnel.abandoned} conversaciones se quedaron sin ningún producto.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
};

export default ReportsPage;
