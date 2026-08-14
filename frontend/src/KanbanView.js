import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Clock, Flame, CheckCircle, Package, Phone, MapPin, ArrowRight, Receipt,
    MoreVertical, Copy, MessageSquare, Printer, Ban, XCircle, ChevronDown, Inbox
} from 'lucide-react';
import { useLanguage } from './LanguageContext';
import { formatCOP } from './config';
import { SkeletonCard, EmptyState, Badge, Avatar, Button, IconButton, ICON, cx } from './ui';

/**
 * Vista Kanban — columnas de estado, Material 3.
 *
 * Reglas visuales (design-audit.md S4, S5, E2, E3, I12, O3):
 *  - Cero hex: el estado de cada columna es un ROL (`warning`/`primary`/
 *    `info`/`success`), no un color fijo, así el tablero se lee igual en los
 *    tres presets de tema.
 *  - La tarjeta no lleva barra lateral de color: el estado lo comunica un chip
 *    tonal (`Badge`). Tres tamaños tipográficos como máximo por tarjeta:
 *    `title` (nombre y total), `body` (items), `body-sm` (metadatos).
 *  - La urgencia conserva su SIGNIFICADO (rojo) con el rol `danger` y el
 *    `.urgent-pulse` ya tokenizado en index.css.
 *  - El menú de acciones es un `menu` navegable con teclado (flechas, Home/End,
 *    Escape) — antes solo respondía al ratón.
 *
 * Drag & drop nativo (desktop): arrastrar tarjeta a otra columna cambia el
 * estado. En móvil se usa el botón de acción de siempre.
 */

// Tiempo transcurrido desde la creación. Urgente si lleva 20+ min sin resolver.
const elapsedInfo = (createdAt, now = Date.now()) => {
    const mins = Math.floor((now - new Date(createdAt).getTime()) / 60000);
    if (mins < 1) return { label: 'ahora', urgent: false, mins: 0 };
    if (mins < 60) return { label: `hace ${mins} min`, urgent: mins >= 20, mins };
    const hours = Math.floor(mins / 60);
    if (hours < 24) return { label: `hace ${hours} h`, urgent: true, mins };
    return { label: `hace ${Math.floor(hours / 24)} d`, urgent: false, mins };
};

/* Clases del botón "Ver comprobante". Se comparte entre <button> y <a>: es el
   mismo control, solo cambia el elemento según haya handler de lightbox. */
const PROOF_CLS = 'state-layer state-on-primary w-full inline-flex items-center justify-center gap-2 h-10 rounded-shape-xl text-label-lg bg-success text-success-on transition-colors duration-short ease-standard';

const KanbanView = ({ orders, onStatusChange, onSelectOrder, onPrint, onViewProof, loading = false }) => {
    const { t } = useLanguage();
    const [now, setNow] = useState(Date.now());
    const [draggedOrder, setDraggedOrder] = useState(null);
    const [dragOverCol, setDragOverCol] = useState(null);
    const [openMenuId, setOpenMenuId] = useState(null);
    const [showCancelled, setShowCancelled] = useState(false);

    // Tick de 30s: "hace X min" y la urgencia se actualizan solos.
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);

    const columns = [
        { id: 'pending', title: t.dashboard.kanban.columns.pending, icon: Clock, tone: 'amber', statuses: ['NEW', 'WAITING_PAYMENT', 'VERIFYING_PAYMENT'], dropStatus: null },
        { id: 'preparing', title: t.dashboard.kanban.columns.preparing, icon: Flame, tone: 'accent', statuses: ['CONFIRMED', 'PREPARING'], dropStatus: 'CONFIRMED' },
        { id: 'ready', title: t.dashboard.kanban.columns.ready, icon: Package, tone: 'blue', statuses: ['READY'], dropStatus: 'READY' },
        { id: 'done', title: t.dashboard.kanban.columns.done, icon: CheckCircle, tone: 'green', statuses: ['COMPLETED', 'DELIVERED'], dropStatus: 'COMPLETED' }
    ];

    const cancelledOrders = useMemo(
        () => orders
            .filter(o => ['CANCELLED', 'REJECTED'].includes(o.status))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
        [orders]
    );

    // Orden dentro de columna: activas = urgentes primero, luego más viejas
    // primero (orden de llegada); completados = más recientes primero.
    const sortColumn = (list, colId) => {
        const active = ['pending', 'preparing'].includes(colId);
        return [...list].sort((a, b) => {
            if (active) {
                const ua = elapsedInfo(a.created_at, now).urgent ? 1 : 0;
                const ub = elapsedInfo(b.created_at, now).urgent ? 1 : 0;
                if (ua !== ub) return ub - ua;
                return new Date(a.created_at) - new Date(b.created_at);
            }
            return new Date(b.created_at) - new Date(a.created_at);
        });
    };

    if (loading) {
        return (
            <div className="flex gap-5 overflow-x-auto no-scrollbar pb-2">
                {columns.map(c => (
                    <div key={c.id} className="flex-1 min-w-[300px] space-y-3">
                        <div className="skeleton h-9 rounded-shape-md" />
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                ))}
            </div>
        );
    }

    // Tablero completamente vacío.
    if (orders.length === 0) {
        return (
            <EmptyState
                icon={Inbox}
                title={t.dashboard.kanban.emptyBoardTitle}
                description={t.dashboard.kanban.emptyBoardDesc}
            />
        );
    }

    const handleDrop = (column) => {
        setDragOverCol(null);
        if (!draggedOrder || !column.dropStatus) return;
        if (column.statuses.includes(draggedOrder.status)) return; // misma columna
        onStatusChange(draggedOrder.id, column.dropStatus);
        setDraggedOrder(null);
    };

    return (
        <div className="flex gap-5 overflow-x-auto no-scrollbar pb-2" onClick={() => openMenuId && setOpenMenuId(null)}>
            {columns.map(column => {
                const colOrders = sortColumn(orders.filter(o => column.statuses.includes(o.status)), column.id);
                const colTotal = colOrders.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
                const isDropTarget = dragOverCol === column.id && draggedOrder && column.dropStatus && !column.statuses.includes(draggedOrder.status);
                return (
                    <div
                        key={column.id}
                        className={cx('flex-1 min-w-[300px] transition-colors duration-short ease-standard', isDropTarget && 'drop-target')}
                        onDragOver={(e) => {
                            if (!draggedOrder || !column.dropStatus) return;
                            e.preventDefault();
                            setDragOverCol(column.id);
                        }}
                        onDragLeave={(e) => {
                            if (e.currentTarget.contains(e.relatedTarget)) return;
                            setDragOverCol(prev => (prev === column.id ? null : prev));
                        }}
                        onDrop={(e) => { e.preventDefault(); handleDrop(column); }}
                    >
                        <div className="flex items-center justify-between gap-3 px-1 pb-3 mb-4 border-b border-outline-variant">
                            <div className="flex items-center gap-2 min-w-0">
                                <column.icon
                                    size={ICON.sm}
                                    strokeWidth={ICON.stroke}
                                    className="text-on-surface-variant flex-shrink-0"
                                    aria-hidden="true"
                                />
                                <h3 className="text-title text-on-surface truncate" title={column.title}>{column.title}</h3>
                                <Badge tone={colOrders.length > 0 ? column.tone : 'neutral'} className="tabular-nums">
                                    {colOrders.length}
                                </Badge>
                            </div>
                            {colTotal > 0 && (
                                <span className="text-body-sm text-on-surface-muted tabular-nums flex-shrink-0">
                                    {formatCOP(colTotal)}
                                </span>
                            )}
                        </div>

                        <div className="space-y-3">
                            <AnimatePresence>
                                {colOrders.map((order, index) => (
                                    <OrderCard
                                        key={order.id}
                                        order={order}
                                        column={column}
                                        index={index}
                                        now={now}
                                        onStatusChange={onStatusChange}
                                        onClick={() => onSelectOrder(order.id)}
                                        onPrint={onPrint}
                                        onViewProof={onViewProof}
                                        menuOpen={openMenuId === order.id}
                                        onToggleMenu={() => setOpenMenuId(prev => (prev === order.id ? null : order.id))}
                                        isDragging={draggedOrder?.id === order.id}
                                        onDragStartCard={() => { setOpenMenuId(null); setDraggedOrder(order); }}
                                        onDragEndCard={() => { setDraggedOrder(null); setDragOverCol(null); }}
                                        t={t}
                                    />
                                ))}
                            </AnimatePresence>

                            {colOrders.length === 0 && (
                                <EmptyState
                                    icon={column.icon}
                                    title={isDropTarget ? t.dashboard.kanban.dropHere : t.dashboard.kanban.empty}
                                    className="py-10"
                                />
                            )}
                        </div>
                    </div>
                );
            })}

            {/* Cancelados — colapsados por defecto, solo si existen */}
            {cancelledOrders.length > 0 && (
                <div className="flex-shrink-0 w-[220px]">
                    <button
                        onClick={() => setShowCancelled(v => !v)}
                        aria-expanded={showCancelled}
                        className="state-layer w-full flex items-center justify-between gap-2 h-12 px-3 rounded-shape-md bg-surface-low transition-colors duration-short ease-standard mb-3"
                    >
                        <span className="flex items-center gap-2 min-w-0">
                            <Ban size={ICON.sm} strokeWidth={ICON.stroke} className="text-danger flex-shrink-0" aria-hidden="true" />
                            <span className="text-title text-on-surface truncate">{t.dashboard.kanban.cancelledColumn}</span>
                        </span>
                        <span className="flex items-center gap-1.5 flex-shrink-0">
                            <Badge tone="red" className="tabular-nums">{cancelledOrders.length}</Badge>
                            <ChevronDown
                                size={ICON.xs}
                                strokeWidth={ICON.stroke}
                                className={cx('text-on-surface-variant transition-transform duration-short ease-standard', showCancelled && 'rotate-180')}
                                aria-hidden="true"
                            />
                        </span>
                    </button>
                    {showCancelled && (
                        <div className="space-y-2 anim-fade-up">
                            {cancelledOrders.slice(0, 12).map(order => (
                                <button
                                    key={order.id}
                                    onClick={() => onSelectOrder(order.id)}
                                    className="state-layer w-full text-left bg-surface-low rounded-shape-lg p-3 transition-colors duration-short ease-standard"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-body text-on-surface truncate">
                                            {order.customer_name || t.dashboard.kanban.customerFallback}
                                        </span>
                                        <XCircle size={ICON.xs} strokeWidth={ICON.stroke} className="text-danger flex-shrink-0" aria-hidden="true" />
                                    </div>
                                    <div className="flex items-center justify-between gap-2 mt-1">
                                        <span className="text-body-sm text-on-surface-muted tabular-nums">{elapsedInfo(order.created_at, now).label}</span>
                                        <span className="text-body-sm text-on-surface-variant tabular-nums">{formatCOP(order.total_amount)}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

/* ============================== OrderCard ============================== */

const OrderCard = ({
    order, column, index, now, onStatusChange, onClick, onPrint, onViewProof,
    menuOpen, onToggleMenu, isDragging, onDragStartCard, onDragEndCard, t
}) => {
    const flow = { NEW: 'VERIFYING_PAYMENT', WAITING_PAYMENT: 'CONFIRMED', VERIFYING_PAYMENT: 'CONFIRMED', CONFIRMED: 'COMPLETED', COMPLETED: 'DELIVERED' };
    const nextStatus = flow[order.status] || order.status;
    const isNew = order.status === 'NEW';
    // Urgencia solo aplica a columnas activas (pendiente/preparando).
    const isActiveColumn = ['pending', 'preparing'].includes(column.id);
    const elapsed = elapsedInfo(order.created_at, now);

    const isUrgent = isActiveColumn && elapsed.urgent;

    const copyPhone = async (e) => {
        e.stopPropagation();
        onToggleMenu();
        try {
            await navigator.clipboard.writeText(order.customer_phone || '');
        } catch { /* clipboard bloqueado — sin drama */ }
    };

    const menuItems = [
        order.customer_phone && { icon: Copy, label: t.dashboard.kanban.menu.copyPhone, onClick: copyPhone },
        { icon: MessageSquare, label: t.dashboard.kanban.menu.openChat, onClick: (e) => { e.stopPropagation(); onToggleMenu(); onClick(); } },
        onPrint && { icon: Printer, label: t.dashboard.kanban.menu.printTicket, onClick: (e) => { e.stopPropagation(); onToggleMenu(); onPrint(order); } },
        !['COMPLETED', 'DELIVERED', 'CANCELLED', 'REJECTED'].includes(order.status) && {
            icon: Ban, label: t.dashboard.kanban.menu.cancelOrder, danger: true,
            onClick: (e) => { e.stopPropagation(); onToggleMenu(); onStatusChange(order.id, 'CANCELLED'); }
        },
    ].filter(Boolean);

    /* --- Accesibilidad del menú: foco al abrir, flechas, Home/End, Escape --- */
    const itemRefs = useRef([]);
    // El ref va en el contenedor porque `IconButton` de ui.js no reenvía refs
    // (no usa forwardRef); desde aquí se recupera el disparador para devolverle
    // el foco al cerrar con Escape.
    const menuWrapRef = useRef(null);
    const [activeIdx, setActiveIdx] = useState(0);
    const itemCount = menuItems.length;

    useEffect(() => {
        if (menuOpen) setActiveIdx(0);
    }, [menuOpen]);

    useEffect(() => {
        if (!menuOpen) return;
        itemRefs.current[activeIdx]?.focus();
    }, [menuOpen, activeIdx]);

    const handleMenuKeyDown = useCallback((e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onToggleMenu();
            menuWrapRef.current?.querySelector('button')?.focus();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault(); e.stopPropagation();
            setActiveIdx(i => (i + 1) % itemCount);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault(); e.stopPropagation();
            setActiveIdx(i => (i - 1 + itemCount) % itemCount);
        } else if (e.key === 'Home') {
            e.preventDefault(); e.stopPropagation();
            setActiveIdx(0);
        } else if (e.key === 'End') {
            e.preventDefault(); e.stopPropagation();
            setActiveIdx(itemCount - 1);
        } else if (e.key === 'Tab') {
            onToggleMenu();
        }
    }, [itemCount, onToggleMenu]);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -14 }}
            transition={{ delay: index * 0.03, duration: 0.25 }}
        >
            <div
                draggable
                onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', order.id);
                    onDragStartCard();
                }}
                onDragEnd={onDragEndCard}
                onClick={onClick}
                className={cx(
                    'state-layer group relative bg-surface-low rounded-shape-lg cursor-pointer overflow-visible',
                    'transition-colors duration-short ease-standard',
                    isUrgent && 'urgent-pulse',
                    isDragging && 'dragging-card'
                )}
            >
                <div className="p-4">
                    <div className="flex items-start gap-3">
                        <Avatar name={order.customer_name} size="md" />

                        <div className="min-w-0 flex-1">
                            <span className="block text-title text-on-surface truncate">
                                {order.customer_name || t.dashboard.kanban.customerFallback}
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5 text-body-sm text-on-surface-muted">
                                <Phone size={ICON.xs} strokeWidth={ICON.stroke} className="flex-shrink-0" aria-hidden="true" />
                                <span className="truncate">{order.customer_phone || t.dashboard.kanban.noPhone}</span>
                            </div>
                        </div>

                        {/* Menú de acciones rápidas */}
                        <div ref={menuWrapRef} className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            <IconButton
                                icon={MoreVertical}
                                label="Acciones del pedido"
                                size="sm"
                                aria-haspopup="menu"
                                aria-expanded={menuOpen}
                                onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
                            />
                            {menuOpen && (
                                <div
                                    role="menu"
                                    aria-label="Acciones del pedido"
                                    onKeyDown={handleMenuKeyDown}
                                    className="absolute right-0 top-full mt-1 z-30 w-56 bg-surface-high rounded-shape-md shadow-2 py-2 anim-scale-up"
                                >
                                    {menuItems.map((item, i) => (
                                        <button
                                            key={item.label}
                                            ref={(el) => { itemRefs.current[i] = el; }}
                                            role="menuitem"
                                            tabIndex={i === activeIdx ? 0 : -1}
                                            onClick={item.onClick}
                                            className={cx(
                                                'state-layer w-full flex items-center gap-3 h-12 px-4 text-label-lg text-left',
                                                'transition-colors duration-short ease-standard',
                                                item.danger ? 'text-danger' : 'text-on-surface'
                                            )}
                                        >
                                            <item.icon size={ICON.sm} strokeWidth={ICON.stroke} className="flex-shrink-0" aria-hidden="true" />
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Estado, canal y tiempo transcurrido */}
                    <div className="flex items-center gap-2 flex-wrap mt-3">
                        <Badge tone={column.tone}>
                            {isNew ? t.dashboard.kanban.newBadge : column.title}
                        </Badge>
                        {order.source === 'TELEGRAM' && <Badge tone="blue">TG</Badge>}
                        {order.source === 'WHATSAPP' && <Badge tone="green">WA</Badge>}
                        {/* El bot está mudo en esta conversación: se ve desde el
                            tablero, sin tener que abrir el chat. */}
                        {order.bot_paused && <Badge tone="amber" dot>{t.dashboard.detail.botPaused}</Badge>}
                        {isUrgent
                            ? <Badge tone="red" className="tabular-nums">{elapsed.label}</Badge>
                            : <span className="text-body-sm text-on-surface-muted tabular-nums ml-auto">{elapsed.label}</span>}
                    </div>

                    {/* Items */}
                    <div className="bg-surface-container rounded-shape-md p-3 my-3">
                        <div className="text-body text-on-surface-variant space-y-1.5">
                            {order.items?.slice(0, 2).map((item, i) => (
                                <div key={i} className="flex justify-between gap-2">
                                    <span className="truncate">
                                        <span className="text-on-surface tabular-nums">{item.quantity}×</span> {item.product_name}
                                    </span>
                                    <span className="text-on-surface-muted flex-shrink-0 tabular-nums">{formatCOP(item.unit_price)}</span>
                                </div>
                            ))}
                            {order.items?.length > 2 && (
                                <span className="text-body-sm text-on-surface-muted">+{order.items.length - 2} {t.dashboard.kanban.moreItems}</span>
                            )}
                            {(!order.items || order.items.length === 0) && (
                                <span className="text-body-sm text-on-surface-muted">—</span>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-title text-on-surface tabular-nums">{formatCOP(order.total_amount)}</div>
                            <div className="text-body-sm text-on-surface-muted tabular-nums">
                                {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>

                        {nextStatus !== order.status && (
                            <Button
                                size="sm"
                                variant={isNew ? 'primary' : 'dark'}
                                onClick={(e) => { e.stopPropagation(); onStatusChange(order.id, nextStatus); }}
                                className="flex-shrink-0"
                            >
                                {t.dashboard.kanban.actions[order.status] || t.dashboard.kanban.actions.default}
                                <ArrowRight size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" />
                            </Button>
                        )}
                    </div>

                    {order.delivery_address && (
                        <div className="mt-3 pt-3 border-t border-outline-variant flex items-start gap-1.5 text-body-sm text-on-surface-muted">
                            <MapPin size={ICON.xs} strokeWidth={ICON.stroke} className="mt-0.5 shrink-0" aria-hidden="true" />
                            <span className="line-clamp-1">{order.delivery_address}</span>
                        </div>
                    )}

                    {order.notes && (
                        <div className="mt-2 text-body-sm bg-warning-container text-warning-on-container rounded-shape-sm px-3 py-2 whitespace-pre-wrap">
                            {order.notes}
                        </div>
                    )}

                    {/* Comprobante de pago: lightbox si hay handler, tab nueva de fallback */}
                    <div className="mt-3">
                        {order.payment_proof ? (
                            onViewProof ? (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onViewProof(order); }}
                                    className={PROOF_CLS}
                                >
                                    <Receipt size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                                    Ver comprobante
                                </button>
                            ) : (
                                <a
                                    href={order.payment_proof}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className={PROOF_CLS}
                                >
                                    <Receipt size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                                    Ver comprobante
                                </a>
                            )
                        ) : (
                            <div
                                className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-shape-xl text-label-lg bg-surface-container text-on-surface-muted"
                                title="El cliente aún no ha enviado el comprobante"
                            >
                                <Receipt size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                                Sin comprobante
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default KanbanView;
