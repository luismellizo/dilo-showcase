import React, { useEffect, useCallback, useRef, useId } from 'react';
import { X, CheckCircle, AlertCircle, Loader2, Check } from 'lucide-react';

/**
 * Primitivas UI del panel — Material 3.
 *
 * Reglas duras:
 *  1. Cero hex. Todo color sale de un rol de `tokens.css`
 *     (`bg-surface-container`, `text-on-surface-variant`, `bg-primary`…).
 *  2. Una forma por categoría: botones y píldoras `rounded-shape-xl`+`full`,
 *     tarjetas `shape-lg`, campos y menús `shape-md`, diálogos `shape-xl`.
 *  3. Peso 400 salvo botones y elementos seleccionados (500). Nada de 700+.
 *  4. El feedback de interacción es una CAPA DE ESTADO sobre la superficie
 *     (`.state-layer`), nunca un cambio de escala ni un gris fijo.
 *  5. Un solo set de iconos (lucide) con `ICON` como única fuente de tamaño.
 */

export const cx = (...cls) => cls.filter(Boolean).join(' ');

/**
 * Tamaños de icono. Un solo set (lucide, outlined) y un solo grosor.
 * `stroke: 1.5` a 24px es lo que más se acerca a Material Symbols Outlined;
 * el 2/2.4 que había antes se veía tosco al lado de la tipografía de 400.
 */
export const ICON = { xs: 16, sm: 20, md: 24, nav: 24, stroke: 1.5 };

/* ============================== Button ==============================
   Correspondencia con los tipos de botón de M3:
     primary   → Filled        (la acción principal de la pantalla)
     dark      → Filled tonal  (acción secundaria de peso)
     secondary → Outlined
     ghost     → Text
     danger    → Outlined en rol de error
     success   → Filled en rol de éxito
   Los nombres de variante NO cambian: los usan ~40 llamadas del panel.     */
const BTN_SIZES = {
    sm: 'h-8 px-4 text-label gap-1.5',
    md: 'h-10 px-6 text-label-lg gap-2',
    lg: 'h-12 px-6 text-label-lg gap-2',
};

/* Con icono a la izquierda M3 recorta el padding de ese lado. */
const BTN_SIZES_ICON = {
    sm: 'h-8 pl-3 pr-4 text-label gap-1.5',
    md: 'h-10 pl-4 pr-6 text-label-lg gap-2',
    lg: 'h-12 pl-4 pr-6 text-label-lg gap-2',
};

const BTN_VARIANTS = {
    primary: 'bg-primary text-primary-on state-on-primary',
    dark: 'bg-secondary-container text-secondary-on-container state-on-secondary-container',
    secondary: 'bg-transparent text-primary border border-outline state-primary',
    ghost: 'bg-transparent text-primary state-primary',
    danger: 'bg-transparent text-danger border border-outline state-primary',
    success: 'bg-success text-success-on state-on-primary',
};

export const Button = ({
    variant = 'primary', size = 'md', loading = false, icon: Icon,
    children, className = '', disabled, style, ...props
}) => {
    const hasIcon = Boolean(Icon || loading);
    const iconSize = size === 'sm' ? ICON.xs : ICON.sm;
    return (
        <button
            className={cx(
                'state-layer btn-disabled inline-flex items-center justify-center whitespace-nowrap',
                'rounded-shape-xl select-none transition-colors duration-short ease-standard',
                'disabled:cursor-not-allowed',
                hasIcon ? BTN_SIZES_ICON[size] : BTN_SIZES[size],
                BTN_VARIANTS[variant],
                className
            )}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            style={style}
            {...props}
        >
            {loading
                ? <Loader2 size={iconSize} strokeWidth={ICON.stroke} className="animate-spin" aria-hidden="true" />
                : Icon ? <Icon size={iconSize} strokeWidth={ICON.stroke} aria-hidden="true" /> : null}
            {children}
        </button>
    );
};

/* ============================ IconButton ============================
   Botón solo-icono con área táctil de 40px (M3 pide 48 mínimo en móvil; el
   `state-layer` circular cubre los 40 y el hit area lo amplía el padding).  */
export const IconButton = React.forwardRef(
    ({ icon: Icon, label, size = 'md', className = '', tone = 'variant', ...props }, ref) => (
        <button
            ref={ref}
            aria-label={label}
            title={label}
            className={cx(
                'state-layer inline-flex items-center justify-center rounded-shape-xl flex-shrink-0',
                'transition-colors duration-short ease-standard btn-disabled',
                size === 'sm' ? 'w-8 h-8' : 'w-10 h-10',
                tone === 'primary' ? 'text-primary' : tone === 'danger' ? 'text-danger' : 'text-on-surface-variant',
                className
            )}
            {...props}
        >
            <Icon size={size === 'sm' ? ICON.xs : ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
        </button>
    )
);
IconButton.displayName = 'IconButton';

/* =============================== Card ===============================
   M3 "filled card": la elevación se expresa con el TONO de la superficie, no
   con borde ni sombra. Sobre `surface` (#131314) una tarjeta en
   `surface-container-low` ya se lee como un plano por encima.               */
export const Card = ({ children, className = '', hover = false, ...props }) => (
    <div
        className={cx(
            'bg-surface-low rounded-shape-lg',
            hover && 'state-layer cursor-pointer',
            className
        )}
        {...props}
    >
        {children}
    </div>
);

export const SectionCard = ({ title, description, children, className = '', footer }) => (
    <Card className={cx('p-6', className)}>
        {(title || description) && (
            <div className="mb-6">
                {title && <h2 className="text-title-lg text-on-surface">{title}</h2>}
                {description && <p className="text-body text-on-surface-variant mt-1">{description}</p>}
            </div>
        )}
        {children}
        {footer && <div className="mt-6 pt-6 border-t border-outline-variant">{footer}</div>}
    </Card>
);

/* ============================== Divider ============================== */
export const Divider = ({ className = '' }) => (
    <hr className={cx('border-0 border-t border-outline-variant', className)} />
);

/* =============================== Badge ==============================
   Etiqueta de estado. Antes era `uppercase font-bold text-[11px]` — el sello
   del dashboard de plantilla. Ahora es un contenedor tonal en caja baja.
   `tone` mantiene los nombres antiguos para no tocar las llamadas.         */
const BADGE_TONES = {
    neutral: 'bg-surface-high text-on-surface-variant',
    accent: 'bg-secondary-container text-secondary-on-container',
    green: 'bg-success-container text-success-on-container',
    amber: 'bg-warning-container text-warning-on-container',
    red: 'bg-danger-container text-danger-on-container',
    blue: 'bg-info-container text-info-on-container',
};

export const Badge = ({ tone = 'neutral', dot = false, children, className = '' }) => (
    <span
        className={cx(
            'inline-flex items-center gap-1.5 px-2 h-6 rounded-shape-sm text-label whitespace-nowrap',
            BADGE_TONES[tone] || BADGE_TONES.neutral,
            className
        )}
    >
        {dot && <span className="w-1.5 h-1.5 rounded-shape-xl bg-current flex-shrink-0" aria-hidden="true" />}
        {children}
    </span>
);

/* =============================== Chip ===============================
   Chip de filtro/selección M3. Seleccionado = contenedor tonal + check.     */
export const Chip = ({ selected = false, icon: Icon, children, className = '', ...props }) => (
    <button
        type="button"
        aria-pressed={selected}
        className={cx(
            'state-layer inline-flex items-center gap-2 h-8 px-4 rounded-shape-sm text-label-lg',
            'transition-colors duration-short ease-standard btn-disabled',
            selected
                ? 'bg-secondary-container text-secondary-on-container state-on-secondary-container'
                : 'text-on-surface-variant border border-outline',
            className
        )}
        {...props}
    >
        {selected
            ? <Check size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" />
            : Icon ? <Icon size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" /> : null}
        {children}
    </button>
);

/* ============================== Avatar ==============================
   Antes había tres implementaciones distintas (gradiente + `rounded-xl` +
   gris). Una sola, circular, con contenedor tonal del acento.              */
const AVATAR_SIZES = {
    sm: 'w-8 h-8 text-label',
    md: 'w-10 h-10 text-label-lg',
    lg: 'w-12 h-12 text-title',
    xl: 'w-16 h-16 text-headline',
};

export const Avatar = ({ name, size = 'md', className = '', icon: Icon }) => {
    const initial = typeof name === 'string' && name.trim() ? name.trim().charAt(0).toUpperCase() : null;
    return (
        <span
            className={cx(
                'inline-flex items-center justify-center rounded-shape-xl flex-shrink-0 select-none',
                'bg-primary-container text-primary-on-container',
                AVATAR_SIZES[size], className
            )}
            aria-hidden="true"
        >
            {initial || (Icon ? <Icon size={ICON.xs} strokeWidth={ICON.stroke} /> : '·')}
        </span>
    );
};

/* ============================ ProgressBar =========================== */
export const ProgressBar = ({ value = 0, tone = 'primary', label, thick = false, className = '' }) => {
    const pct = Math.max(0, Math.min(1, value)) * 100;
    const fill = tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-primary';
    return (
        <div
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={label}
            /* 4px es la medida de M3; `thick` sube a 8px cuando la barra ES el
               dato principal de la pantalla (consumo del plan, por ejemplo). */
            className={cx(thick ? 'h-2' : 'h-1', 'w-full rounded-shape-xl bg-surface-high overflow-hidden', className)}
        >
            <div
                className={cx('h-full rounded-shape-xl transition-[width] duration-long ease-standard', fill)}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
};

/* ============================ EmptyState ============================
   Sin borde punteado: el `border-2 border-dashed` es la firma visual del
   dashboard genérico. M3 usa aire, un icono grande y copy que dice qué hacer. */
export const EmptyState = ({ icon: Icon, title, description, action, illustration, size = 'md', className = '' }) => {
    const compact = size === 'compact';
    return (
        <div className={cx(compact ? 'py-10 px-4' : 'py-16 px-6', 'text-center anim-fade-up', className)}>
            {illustration || (Icon && (
                <Icon
                    size={compact ? 28 : 40}
                    strokeWidth={ICON.stroke}
                    className={cx('mx-auto text-on-surface-muted', compact ? 'mb-3' : 'mb-5')}
                    aria-hidden="true"
                />
            ))}
            <h3 className={cx(compact ? 'text-title' : 'text-title-lg', 'text-on-surface')}>{title}</h3>
            {description && (
                <p className="text-body text-on-surface-variant max-w-sm mx-auto mt-2">{description}</p>
            )}
            {action && <div className={cx('flex justify-center', compact ? 'mt-4' : 'mt-6')}>{action}</div>}
        </div>
    );
};

/* ============================= Skeleton ============================= */
export const Skeleton = ({ className = '' }) => (
    <div className={cx('skeleton rounded-shape-sm', className)} aria-hidden="true" />
);

export const SkeletonCard = () => (
    <Card className="p-6">
        <div className="flex items-center gap-4 mb-5">
            <Skeleton className="w-10 h-10 rounded-shape-xl" />
            <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
            </div>
        </div>
        <Skeleton className="h-3 w-full mb-2" />
        <Skeleton className="h-3 w-4/5" />
    </Card>
);

/* ============================== Modal ===============================
   Diálogo M3: 28px de radio, `surface-container-high`, scrim al 32 %.
   Añadido respecto a la versión anterior: trampa de foco y devolución del
   foco al elemento que lo abrió (antes el teclado se perdía tras cerrar).   */
export const Modal = ({ open, onClose, title, children, footer, maxWidth = 'max-w-md', locked = false }) => {
    const panelRef = useRef(null);
    const returnRef = useRef(null);

    const handleKey = useCallback((e) => {
        if (e.key === 'Escape' && !locked) { onClose(); return; }
        if (e.key !== 'Tab' || !panelRef.current) return;
        const focusables = panelRef.current.querySelectorAll(
            'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }, [onClose, locked]);

    useEffect(() => {
        if (!open) return;
        returnRef.current = document.activeElement;
        document.addEventListener('keydown', handleKey);
        document.body.style.overflow = 'hidden';
        panelRef.current?.focus();
        return () => {
            document.removeEventListener('keydown', handleKey);
            document.body.style.overflow = '';
            if (returnRef.current instanceof HTMLElement) returnRef.current.focus();
        };
    }, [open, handleKey]);

    if (!open) return null;
    return (
        <div
            className="fixed inset-0 bg-black/32 z-50 flex items-center justify-center p-4 anim-fade-in"
            onClick={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}
        >
            <div
                ref={panelRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label={typeof title === 'string' ? title : undefined}
                className={cx(
                    'bg-surface-high rounded-shape-xl shadow-3 w-full max-h-[90vh] flex flex-col anim-scale-up outline-none',
                    maxWidth
                )}
            >
                {title && (
                    <div className="px-6 pt-6 pb-2 flex items-start justify-between gap-4 flex-shrink-0">
                        <h3 className="text-title-lg text-on-surface">{title}</h3>
                        <IconButton
                            icon={X}
                            label="Cerrar"
                            size="sm"
                            className="-mr-1 -mt-1"
                            onClick={() => !locked && onClose()}
                        />
                    </div>
                )}
                <div className="px-6 py-4 overflow-y-auto flex-1 text-body text-on-surface-variant">{children}</div>
                {footer && (
                    <div className="px-6 pb-6 pt-2 flex justify-end gap-2 flex-shrink-0">{footer}</div>
                )}
            </div>
        </div>
    );
};

/* =============================== Field ==============================
   Campo de texto "outlined" de M3 sin label flotante: la etiqueta va encima,
   que es como se comportan ya las ~40 llamadas del panel. Radio 4px (shape-xs)
   y alto 48px; el foco engorda el borde a 2px en vez de pintar un halo.     */
export const inputCls = (hasError) => cx(
    'w-full h-12 px-4 rounded-shape-xs text-body bg-surface-highest text-on-surface',
    'border transition-colors duration-short ease-standard outline-none',
    hasError ? 'border-danger' : 'border-outline focus:border-primary'
);

/* Para <textarea>: mismo lenguaje pero con alto libre. */
export const textareaCls = (hasError) => cx(
    'w-full min-h-[96px] px-4 py-3 rounded-shape-xs text-body bg-surface-highest text-on-surface',
    'border transition-colors duration-short ease-standard outline-none resize-y',
    hasError ? 'border-danger' : 'border-outline focus:border-primary'
);

export const Field = ({ label, hint, error, required, children, optional }) => {
    const describedBy = useId();
    return (
        <div>
            {label && (
                <label className="block text-body-sm text-on-surface-variant mb-1.5">
                    {label}
                    {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
                    {optional && <span className="text-on-surface-muted ml-1">{optional}</span>}
                </label>
            )}
            {children}
            {error
                ? (
                    <p id={describedBy} className="text-body-sm text-danger mt-1.5 flex items-center gap-1.5" role="alert">
                        <AlertCircle size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" /> {error}
                    </p>
                )
                : hint ? <p id={describedBy} className="text-body-sm text-on-surface-muted mt-1.5">{hint}</p> : null}
        </div>
    );
};

/* ============================= Checkbox ============================= */
export const Checkbox = ({ checked, onChange, label, disabled, className = '', ...props }) => (
    <label className={cx('inline-flex items-center gap-3 cursor-pointer select-none', disabled && 'opacity-[0.38] cursor-not-allowed', className)}>
        <span className="relative inline-flex items-center justify-center w-10 h-10 -m-2.5 rounded-shape-xl state-layer">
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                disabled={disabled}
                className="sr-only peer"
                {...props}
            />
            <span
                className={cx(
                    'w-[18px] h-[18px] rounded-shape-xs border-2 flex items-center justify-center',
                    'transition-colors duration-short ease-standard',
                    checked ? 'bg-primary border-primary text-primary-on' : 'border-outline'
                )}
            >
                {checked && <Check size={14} strokeWidth={3} aria-hidden="true" />}
            </span>
        </span>
        {label && <span className="text-body text-on-surface">{label}</span>}
    </label>
);

/* =============================== Radio ============================== */
export const Radio = ({ checked, onChange, label, name, value, disabled, className = '' }) => (
    <label className={cx('inline-flex items-center gap-3 cursor-pointer select-none', disabled && 'opacity-[0.38] cursor-not-allowed', className)}>
        <span className="relative inline-flex items-center justify-center w-10 h-10 -m-2.5 rounded-shape-xl state-layer">
            <input
                type="radio"
                name={name}
                value={value}
                checked={checked}
                onChange={onChange}
                disabled={disabled}
                className="sr-only peer"
            />
            <span
                className={cx(
                    'w-5 h-5 rounded-shape-xl border-2 flex items-center justify-center',
                    'transition-colors duration-short ease-standard',
                    checked ? 'border-primary' : 'border-outline'
                )}
            >
                {checked && <span className="w-2.5 h-2.5 rounded-shape-xl bg-primary" />}
            </span>
        </span>
        {label && <span className="text-body text-on-surface">{label}</span>}
    </label>
);

/* ============================== Switch ==============================
   Medidas de M3: pista 52×32, handle de 16 apagado y 24 encendido con check.
   El de antes (40×22) era el switch por defecto de cualquier plantilla.     */
export const Switch = ({ checked, onChange, label, ariaLabel, disabled }) => (
    <label className={cx('inline-flex items-center gap-3 cursor-pointer select-none', disabled && 'opacity-[0.38] cursor-not-allowed')}>
        <input
            type="checkbox"
            role="switch"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            aria-label={!label ? ariaLabel : undefined}
            className="sr-only peer"
        />
        <span
            className={cx(
                'relative w-[52px] h-8 rounded-shape-xl border-2 flex-shrink-0',
                'transition-colors duration-medium ease-standard',
                'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-primary peer-focus-visible:outline-offset-2',
                checked ? 'bg-primary border-primary' : 'bg-surface-highest border-outline'
            )}
        >
            <span
                className={cx(
                    'absolute top-1/2 -translate-y-1/2 rounded-shape-xl flex items-center justify-center',
                    'transition-all duration-medium ease-standard',
                    checked
                        ? 'left-[calc(100%-26px)] w-6 h-6 bg-primary-container text-primary-on-container'
                        : 'left-1.5 w-4 h-4 bg-outline'
                )}
            >
                {checked && <Check size={14} strokeWidth={3} aria-hidden="true" />}
            </span>
        </span>
        {label && <span className="text-body text-on-surface">{label}</span>}
    </label>
);

/* =============================== Tabs ===============================
   Tabs primarias de M3: indicador inferior de 3px con extremos redondeados,
   texto en `primary` cuando está activo. Sin píldoras grises.               */
export const Tabs = ({ tabs, value, onChange, className = '' }) => (
    <div className={cx('flex items-end gap-1 overflow-x-auto no-scrollbar border-b border-outline-variant', className)} role="tablist">
        {tabs.map((tab) => {
            const active = tab.id === value;
            const Icon = tab.icon;
            return (
                <button
                    key={tab.id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => onChange(tab.id)}
                    className={cx(
                        'state-layer relative flex items-center gap-2 h-12 px-4 flex-shrink-0',
                        'text-label-lg transition-colors duration-short ease-standard rounded-t-shape-sm',
                        active ? 'text-primary state-primary' : 'text-on-surface-variant'
                    )}
                >
                    {Icon && <Icon size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />}
                    {tab.label}
                    {active && (
                        <span className="absolute left-0 right-0 bottom-0 h-[3px] rounded-t-shape-xs bg-primary" />
                    )}
                </button>
            );
        })}
    </div>
);

/* =============================== Toast ==============================
   Snackbar de M3: superficie inversa, radio 4px, abajo a la izquierda en
   escritorio y a lo ancho en móvil. Los tres hex fijos anteriores
   (#16A34A/#DC2626/#111827) salían de la paleta en cuanto cambiabas de tema. */
export const Toast = ({ message, type = 'info', onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 4000);
        return () => clearTimeout(timer);
    }, [onClose]);

    const Icon = type === 'success' ? CheckCircle : AlertCircle;

    return (
        <div
            className={cx(
                'fixed z-[70] bottom-4 left-4 right-4 sm:right-auto sm:max-w-[420px]',
                'flex items-center gap-3 min-h-[48px] pl-4 pr-2 py-2 rounded-shape-xs shadow-3 anim-slide-up',
                'bg-surface-inverse text-on-surface-inverse'
            )}
            role={type === 'error' ? 'alert' : 'status'}
            aria-live={type === 'error' ? 'assertive' : 'polite'}
        >
            <Icon
                size={ICON.sm}
                strokeWidth={ICON.stroke}
                className={cx('flex-shrink-0', type === 'success' ? 'text-success' : type === 'error' ? 'text-danger' : '')}
                aria-hidden="true"
            />
            <span className="text-body flex-1">{message}</span>
            <button
                onClick={onClose}
                className="state-layer w-8 h-8 rounded-shape-xl flex items-center justify-center flex-shrink-0"
                aria-label="Cerrar"
            >
                <X size={ICON.xs} strokeWidth={ICON.stroke} />
            </button>
        </div>
    );
};

/* ============================ PageHeader ============================
   El título de página lo pinta `DashboardLayout` (28px/400 dentro del
   contenido, como en las apps de Google). Este primitivo queda para bloques
   con cabecera propia dentro de una página.                                 */
export const PageHeader = ({ title, subtitle, actions }) => (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="min-w-0">
            <h2 className="text-title-lg text-on-surface">{title}</h2>
            {subtitle && <p className="text-body text-on-surface-variant mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
);
