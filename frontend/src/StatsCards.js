import React, { useEffect, useRef, useState } from 'react';
import { DollarSign, TrendingUp, ShoppingBag, CheckCircle, TrendingDown, Minus } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from './LanguageContext';
import { Skeleton, Badge, ICON, cx } from './ui';

/**
 * Estadísticas — tarjetas M3. Datos 100% reales basados en pedidos.
 * Sparkline de 7 días (SVG puro) + delta vs ayer + count-up animado.
 *
 * Reglas visuales (ver design-audit.md S3, I10):
 *  - Una sola superficie tonal para las 4 tarjetas (`surface-container-low`).
 *    Los cuatro fondos pastel hardcodeados de antes no cambiaban con el tema y
 *    convertían la fila en un semáforo sin significado.
 *  - La única variación de color sale de roles semánticos: dinero = success,
 *    cola de trabajo = acento de la tienda, resto = info/neutral.
 *  - Tres tamaños tipográficos por tarjeta: headline (valor), body (etiqueta),
 *    body-sm (contexto).
 */

const SOLD_STATUSES = ['CONFIRMED', 'COMPLETED', 'DELIVERED'];

/* Roles de color por tarjeta. Clases completas (Tailwind no interpola). */
const TONES = {
    success: { chip: 'bg-success-container text-success-on-container', ink: 'text-success' },
    primary: { chip: 'bg-secondary-container text-secondary-on-container', ink: 'text-primary' },
    info: { chip: 'bg-info-container text-info-on-container', ink: 'text-info' },
    neutral: { chip: 'bg-surface-high text-on-surface-variant', ink: 'text-on-surface-variant' },
};

// Animación count-up: 0 → value en ~600ms con easing out.
const useCountUp = (value, duration = 600) => {
    const [display, setDisplay] = useState(0);
    const raf = useRef(null);

    useEffect(() => {
        const from = 0;
        const start = performance.now();
        const step = (ts) => {
            const p = Math.min(1, (ts - start) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            setDisplay(from + (value - from) * eased);
            if (p < 1) raf.current = requestAnimationFrame(step);
        };
        raf.current = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf.current);
    }, [value, duration]);

    return display;
};

const CountUp = ({ value, format }) => {
    const n = useCountUp(value);
    return <>{format(n)}</>;
};

/* Sparkline SVG minimalista (sin librerías). El color lo hereda del contenedor
   con `currentColor`, así cambia solo con el tema y con el acento de la
   tienda. Serie plana o vacía → no se pinta (I10: fallback de datos vacíos). */
const Sparkline = ({ points, className = '' }) => {
    if (!points || points.length < 2) return null;
    if (!points.some(v => v > 0)) return null;
    const w = 72, h = 24, pad = 2;
    const max = Math.max(...points, 1);
    const coords = points.map((v, i) => [
        pad + (i * (w - pad * 2)) / (points.length - 1),
        h - pad - ((v / max) * (h - pad * 2)),
    ]);
    const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${path} L${coords[coords.length - 1][0].toFixed(1)},${h - pad} L${coords[0][0].toFixed(1)},${h - pad} Z`;
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className={cx('w-[72px] h-6 flex-shrink-0', className)} aria-hidden="true">
            <path d={area} fill="currentColor" opacity="0.12" />
            <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="2" fill="currentColor" />
        </svg>
    );
};

const DeltaBadge = ({ delta }) => {
    if (delta === null) return null;
    const up = delta > 0;
    const flat = delta === 0;
    const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
    return (
        <Badge tone={flat ? 'neutral' : up ? 'green' : 'red'} className="tabular-nums">
            <Icon size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" />
            {flat ? '0%' : `${up ? '+' : ''}${delta}%`}
        </Badge>
    );
};

const StatsCards = ({ orders, loading = false }) => {
    const { t, language } = useLanguage();
    const today = new Date().toDateString();
    const todayOrders = orders.filter(o => new Date(o.created_at).toDateString() === today);

    const confirmedOrders = orders.filter(o => SOLD_STATUSES.includes(o.status));
    const rejectedOrders = orders.filter(o => ['REJECTED', 'CANCELLED'].includes(o.status));

    const salesOf = (dateString) => orders
        .filter(o => SOLD_STATUSES.includes(o.status) && new Date(o.created_at).toDateString() === dateString)
        .reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);

    const salesToday = salesOf(today);

    // Serie de 7 días (hoy incluido) para el sparkline de ventas.
    const last7 = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return salesOf(d.toDateString());
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const salesYesterday = salesOf(yesterday.toDateString());
    const salesDelta = salesYesterday > 0
        ? Math.round(((salesToday - salesYesterday) / salesYesterday) * 100)
        : (salesToday > 0 ? 100 : null);

    const pendingCount = orders.filter(o =>
        ['NEW', 'WAITING_PAYMENT', 'VERIFYING_PAYMENT', 'SALES_CONVERSATION'].includes(o.status)
    ).length;

    const avgTicket = confirmedOrders.length > 0
        ? confirmedOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0) / confirmedOrders.length
        : 0;

    const conversionRate = orders.length > 0
        ? Math.round((confirmedOrders.length / orders.length) * 100)
        : 0;

    const locale = language === 'en' ? 'en-US' : 'es-CO';
    const money = (n) => `$${Math.round(n).toLocaleString(locale)}`;
    const basedOnSales = t.dashboard.stats.basedOnSales.replace('{count}', confirmedOrders.length);
    const confirmedRejected = t.dashboard.stats.confirmedRejected
        .replace('{confirmed}', confirmedOrders.length)
        .replace('{rejected}', rejectedOrders.length);

    const cards = [
        {
            icon: DollarSign,
            label: t.dashboard.stats.salesToday,
            value: salesToday,
            format: money,
            sublabel: `${todayOrders.filter(o => SOLD_STATUSES.includes(o.status)).length} ${t.dashboard.stats.confirmedOrders}`,
            tone: 'success',
            spark: last7, delta: salesDelta
        },
        {
            icon: ShoppingBag,
            label: t.dashboard.stats.pendingOrders,
            value: pendingCount,
            format: (n) => Math.round(n),
            sublabel: `${orders.length} ${t.dashboard.stats.totalOrders}`,
            tone: 'primary'
        },
        {
            icon: TrendingUp,
            label: t.dashboard.stats.avgTicket,
            value: avgTicket,
            format: money,
            sublabel: basedOnSales,
            tone: 'info'
        },
        {
            icon: CheckCircle,
            label: t.dashboard.stats.conversionRate,
            value: conversionRate,
            format: (n) => `${Math.round(n)}%`,
            sublabel: confirmedRejected,
            tone: 'neutral'
        }
    ];

    if (loading) {
        return (
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map(i => (
                    <div key={i} className="rounded-shape-lg bg-surface-low p-6">
                        <Skeleton className="w-10 h-10 rounded-shape-xl mb-5" />
                        <Skeleton className="h-7 w-3/5 mb-3" />
                        <Skeleton className="h-4 w-4/5 mb-2" />
                        <Skeleton className="h-3 w-2/5" />
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((card, i) => {
                const tone = TONES[card.tone] || TONES.neutral;
                return (
                    <motion.div
                        key={card.label}
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05, duration: 0.35 }}
                        className="rounded-shape-lg bg-surface-low p-6"
                    >
                        <div className="flex items-start justify-between gap-3 mb-5">
                            <span
                                className={cx(
                                    'w-10 h-10 rounded-shape-xl flex items-center justify-center flex-shrink-0',
                                    tone.chip
                                )}
                                aria-hidden="true"
                            >
                                <card.icon size={ICON.md} strokeWidth={ICON.stroke} />
                            </span>
                            {card.delta !== undefined && <DeltaBadge delta={card.delta} />}
                        </div>

                        {/* Sin `truncate`: un importe recortado a "$166.0…" es peor que uno
                            que baje de tamaño. Se encoge con `text-title-lg` en
                            pantallas estrechas y se lee entero. */}
                        <div className="text-title-lg sm:text-headline text-on-surface tabular-nums">
                            <CountUp value={card.value} format={card.format} />
                        </div>
                        <div className="text-body text-on-surface-variant mt-1" title={card.label}>
                            {card.label}
                        </div>

                        {/* Sparkline en su propia fila: compartir línea con el
                            subtítulo dejaba textos como "3 pedidos confirmados"
                            recortados a "3 pedi…" en tarjetas estrechas. */}
                        {card.spark && (
                            <div className="mt-4 flex justify-end">
                                <Sparkline points={card.spark} className={tone.ink} />
                            </div>
                        )}
                        <div className={cx('text-body-sm text-on-surface-muted', card.spark ? 'mt-1' : 'mt-4')}>
                            {card.sublabel}
                        </div>
                    </motion.div>
                );
            })}
        </div>
    );
};

export default StatsCards;
