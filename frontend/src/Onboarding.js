import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    AlertCircle, ArrowLeft, ArrowRight, Briefcase, CupSoda, Loader2, Moon,
    Pencil, Plus, Rocket, ShoppingBag, Sparkles, UtensilsCrossed, Zap,
} from 'lucide-react';
import { useAuth } from './AuthContext';
import { useTheme, THEMES, BACKDROPS, ACCENT_PRESETS } from './ThemeContext';
import { API_BASE_URL } from './config';
import DiloLogo from './DiloLogo';
import FoodBackdrop from './FoodBackdrop';
import { Button, Field, ICON, cx, inputCls, textareaCls } from './ui';

// ============================================================
// Onboarding — wizard de bienvenida (primera vez en el panel).
// Recoge: nombre del negocio → descripción → horario → tema/acento/motivo.
// Al final hace UN solo PATCH a /api/stores/<id>/ con todo +
// onboarding_completed=true. El tema se aplica en vivo vía ThemeContext.
//
// Diseño Material 3: el wizard vive sobre el MISMO shell del panel
// (`app-shell` + `data-theme`), así que la elección de tema del paso 4 se ve
// aplicada al instante en la pantalla entera, no solo en un recuadro.
// Cero hex: todo color sale de `tokens.css`; los únicos valores crudos son
// los swatches de acento, que son DATOS (`ACCENT_PRESETS`) y tienen que
// enseñar su propio color.
// ============================================================

const EXAMPLE_DESCRIPTION =
    'Vendemos hamburguesas artesanales con ingredientes frescos y pan horneado ' +
    'a diario. Nuestra especialidad es la burger doble con tocineta y salsas de ' +
    'la casa. Hacemos domicilios en toda la ciudad.';

const HOUR_PRESETS = [
    { id: 'office', icon: Briefcase, label: 'Horario de oficina', value: 'Lunes a Viernes 8:00am – 6:00pm' },
    { id: 'commerce', icon: ShoppingBag, label: 'Comercio', value: 'Lunes a Sábado 10:00am – 8:00pm' },
    { id: 'food', icon: UtensilsCrossed, label: 'Restaurante', value: 'Todos los días 11:00am – 11:00pm' },
    { id: 'night', icon: Moon, label: 'Nocturno', value: 'Miércoles a Domingo 5:00pm – 2:00am' },
    { id: 'always', icon: Zap, label: 'Siempre abierto', value: 'Abierto 24/7' },
    { id: 'custom', icon: Pencil, label: 'Personalizado', value: '' },
];

const BACKDROP_ICONS = { food: UtensilsCrossed, drinks: CupSoda, retail: ShoppingBag };

const STEPS = ['Bienvenida', 'Nombre', 'Negocio', 'Horario', 'Estilo'];

// Transición entre pasos: desplazamiento corto + fundido, con las curvas de M3.
// Sin blur ni escalado: el movimiento acompaña, no protagoniza.
const stepVariants = {
    enter: (dir) => ({ opacity: 0, x: dir > 0 ? 24 : -24 }),
    center: { opacity: 1, x: 0 },
    exit: (dir) => ({ opacity: 0, x: dir > 0 ? -24 : 24 }),
};
const stepTransition = { duration: 0.25, ease: [0.2, 0, 0, 1] };

/* Tarjeta seleccionable — el MISMO patrón de StoreConfig (tema, motivo), para
   que no existan dos estilos distintos de "opción elegible" en el producto. */
const OptionCard = ({ active, onClick, className = '', children }) => (
    <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cx(
            'state-layer rounded-shape-lg border p-3 text-left',
            'transition-colors duration-short ease-standard',
            active
                ? 'bg-secondary-container text-secondary-on-container border-primary state-on-secondary-container'
                : 'bg-surface-container text-on-surface border-outline-variant',
            className
        )}
    >
        {children}
    </button>
);

/* Vista previa del panel con el tema elegido. Refleja el diseño real: riel de
   navegación con píldoras, superficies tonales y tipografía de 400.
   OJO: `minHeight: 0` en el `.app-shell` es obligatorio — la clase global
   fuerza `100vh` y sin esto la caja se estira a pantalla completa. */
const PanelPreview = ({ mode, storeName }) => (
    <div className="rounded-shape-lg overflow-hidden border border-outline-variant">
        <div className="app-shell relative" data-theme={mode} style={{ minHeight: 0 }}>
            <FoodBackdrop inline />
            <div className="relative flex" style={{ minHeight: 196 }}>
                {/* Riel de navegación */}
                <div className="hidden sm:flex w-44 flex-col gap-1 p-3 flex-shrink-0">
                    <div className="flex items-center gap-2 mb-2 px-1">
                        <span className="w-6 h-6 rounded-shape-sm bg-brand flex-shrink-0" aria-hidden="true" />
                        <span className="text-body-sm text-on-surface truncate">{storeName}</span>
                    </div>
                    <span className="rounded-shape-xl px-3 py-1.5 text-label bg-secondary-container text-secondary-on-container">
                        Pedidos
                    </span>
                    <span className="rounded-shape-xl px-3 py-1.5 text-label text-on-surface-variant">Clientes</span>
                    <span className="rounded-shape-xl px-3 py-1.5 text-label text-on-surface-variant">Configuración</span>
                </div>

                {/* Contenido */}
                <div className="flex-1 p-3 space-y-2 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-body text-on-surface">Pedidos</span>
                        <span className="rounded-shape-xl px-3 py-1 text-label bg-primary text-primary-on whitespace-nowrap">
                            Nuevo
                        </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {[['Hoy', '12'], ['Ventas', '$480.000'], ['Clientes', '38']].map(([k, v]) => (
                            <div key={k} className="rounded-shape-md bg-surface-low p-2 min-w-0">
                                <div className="text-label text-on-surface-muted truncate">{k}</div>
                                <div className="text-body text-on-surface truncate">{v}</div>
                            </div>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {[['128', 'w-4/5'], ['129', 'w-3/5']].map(([num, w]) => (
                            <div key={num} className="rounded-shape-md bg-surface-low p-2 min-w-0">
                                <div className="flex items-center gap-1.5 mb-2">
                                    <span className="w-1.5 h-1.5 rounded-shape-xl bg-primary flex-shrink-0" aria-hidden="true" />
                                    <span className="text-label text-on-surface truncate">Pedido #{num}</span>
                                </div>
                                <div className={cx('h-1.5 rounded-shape-xl bg-surface-highest', w)} />
                                <div className="h-1.5 rounded-shape-xl bg-surface-highest w-2/5 mt-1" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    </div>
);

export function Onboarding({ storeId, initialName, onComplete }) {
    const { fetchWithAuth } = useAuth();
    const { mode, accent, backdrop, setMode, setAccent, setBackdrop } = useTheme();

    const [step, setStep] = useState(0);
    const [dir, setDir] = useState(1);
    const [name, setName] = useState(initialName === 'Mi Restaurante' ? '' : (initialName || ''));
    const [description, setDescription] = useState('');
    const [hourPreset, setHourPreset] = useState(null);
    const [customHours, setCustomHours] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const inputRef = useRef(null);

    // Autofocus del input del paso activo.
    useEffect(() => {
        const t = setTimeout(() => inputRef.current?.focus(), 450);
        return () => clearTimeout(t);
    }, [step]);

    const hours = hourPreset === 'custom'
        ? customHours.trim()
        : (HOUR_PRESETS.find(h => h.id === hourPreset)?.value || '');

    const canAdvance = [
        true,                                   // bienvenida
        name.trim().length >= 2,                // nombre
        description.trim().length >= 10,        // descripción
        Boolean(hours),                         // horario
        true,                                   // estilo
    ][step];

    const go = useCallback((delta) => {
        setDir(delta);
        setStep(s => Math.min(STEPS.length - 1, Math.max(0, s + delta)));
    }, []);

    const finish = async () => {
        if (saving) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/stores/${storeId}/`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    business_description: description.trim(),
                    business_hours: hours,
                    theme_color: accent,
                    onboarding_completed: true,
                }),
            });
            if (!res.ok) throw new Error('bad status');
            onComplete();
        } catch (e) {
            setError('No pudimos guardar tu configuración. Revisa tu conexión e inténtalo de nuevo.');
            setSaving(false);
        }
    };

    const onKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && canAdvance && step > 0 && step < STEPS.length - 1) {
            e.preventDefault();
            go(1);
        }
    };

    return (
        <div className="app-shell fixed inset-0 z-50 overflow-y-auto" data-theme={mode}>
            <div className="relative min-h-full flex flex-col items-center justify-center px-4 py-10">
                {/* Marca + progreso */}
                <div className="mb-8 flex flex-col items-center gap-5 text-on-surface">
                    <DiloLogo height={34} color="currentColor" />
                    <div
                        className="flex items-center gap-2"
                        role="progressbar"
                        aria-valuemin={1}
                        aria-valuemax={STEPS.length}
                        aria-valuenow={step + 1}
                        aria-label={`Paso ${step + 1} de ${STEPS.length}: ${STEPS[step]}`}
                    >
                        {STEPS.map((label, i) => (
                            <span
                                key={label}
                                className={cx(
                                    'w-2 h-2 rounded-shape-xl transition-colors duration-medium ease-standard',
                                    i <= step ? 'bg-primary' : 'bg-outline-variant'
                                )}
                            />
                        ))}
                    </div>
                </div>

                {/* Tarjeta principal */}
                <div
                    className="w-full max-w-2xl rounded-shape-xl bg-surface-low shadow-1 p-6 sm:p-10"
                    onKeyDown={onKeyDown}
                >
                    <AnimatePresence mode="wait" custom={dir}>
                        <motion.div
                            key={step}
                            custom={dir}
                            variants={stepVariants}
                            initial="enter" animate="center" exit="exit"
                            transition={stepTransition}
                        >
                            {step === 0 && (
                                <div className="text-center py-4">
                                    <span
                                        className="inline-flex items-center justify-center w-16 h-16 rounded-shape-xl bg-primary-container text-primary-on-container mb-6"
                                        aria-hidden="true"
                                    >
                                        <Sparkles size={28} strokeWidth={ICON.stroke} />
                                    </span>
                                    <h1 className="text-headline text-on-surface">Bienvenido a DILO</h1>
                                    <p className="text-body-lg text-on-surface-variant max-w-md mx-auto mt-3">
                                        En menos de un minuto dejamos tu tienda lista para vender.
                                        Cuatro preguntas rápidas y tu bot queda entrenado con tu negocio.
                                    </p>
                                </div>
                            )}

                            {step === 1 && (
                                <div>
                                    <p className="text-label text-primary mb-2">Paso 1 de 4</p>
                                    <h1 className="text-headline text-on-surface">¿Cómo se llama tu negocio?</h1>
                                    <p className="text-body-lg text-on-surface-variant mt-3 mb-8">
                                        Así saludará tu bot a los clientes y así verás tu panel.
                                    </p>
                                    <Field label="Nombre del negocio">
                                        <input
                                            ref={inputRef}
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="Ej: Burger Bros"
                                            maxLength={100}
                                            className={inputCls(false)}
                                        />
                                    </Field>
                                </div>
                            )}

                            {step === 2 && (
                                <div>
                                    <p className="text-label text-primary mb-2">Paso 2 de 4</p>
                                    <h1 className="text-headline text-on-surface">¿De qué trata tu negocio?</h1>
                                    <p className="text-body-lg text-on-surface-variant mt-3 mb-8">
                                        Cuéntanos brevemente qué vendes y qué te hace especial.
                                        Tu bot usará esto para responder como un vendedor que conoce el negocio.
                                    </p>
                                    <Field label="Descripción del negocio">
                                        <textarea
                                            ref={inputRef}
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            rows={4}
                                            placeholder={EXAMPLE_DESCRIPTION}
                                            className={textareaCls(false)}
                                        />
                                    </Field>
                                    <div className="mt-4">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            icon={Sparkles}
                                            onClick={() => setDescription(EXAMPLE_DESCRIPTION)}
                                        >
                                            Usar el ejemplo como base
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {step === 3 && (
                                <div>
                                    <p className="text-label text-primary mb-2">Paso 3 de 4</p>
                                    <h1 className="text-headline text-on-surface">¿Cuál es tu horario de atención?</h1>
                                    <p className="text-body-lg text-on-surface-variant mt-3 mb-8">
                                        Tu bot lo informará cuando un cliente pregunte si están abiertos.
                                    </p>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                        {HOUR_PRESETS.map((h) => {
                                            const active = hourPreset === h.id;
                                            const PresetIcon = h.icon;
                                            return (
                                                <OptionCard key={h.id} active={active} onClick={() => setHourPreset(h.id)}>
                                                    <span
                                                        className={cx(
                                                            'w-10 h-10 rounded-shape-md flex items-center justify-center mb-2',
                                                            active
                                                                ? 'bg-primary-container text-primary-on-container'
                                                                : 'bg-surface-high text-on-surface-variant'
                                                        )}
                                                    >
                                                        <PresetIcon size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                                                    </span>
                                                    <span className="block text-label-lg">{h.label}</span>
                                                    {h.value && (
                                                        <span className={cx('block text-body-sm', !active && 'text-on-surface-muted')}>
                                                            {h.value}
                                                        </span>
                                                    )}
                                                </OptionCard>
                                            );
                                        })}
                                    </div>
                                    {hourPreset === 'custom' && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={stepTransition}
                                            className="mt-4"
                                        >
                                            <Field label="Tu horario">
                                                <input
                                                    value={customHours}
                                                    onChange={(e) => setCustomHours(e.target.value)}
                                                    placeholder="Ej: Lun-Vie 9am-7pm, Sáb 10am-2pm"
                                                    className={inputCls(false)}
                                                    autoFocus
                                                />
                                            </Field>
                                        </motion.div>
                                    )}
                                </div>
                            )}

                            {step === 4 && (
                                <div>
                                    <p className="text-label text-primary mb-2">Paso 4 de 4</p>
                                    <h1 className="text-headline text-on-surface">Dale tu estilo al panel</h1>
                                    <p className="text-body-lg text-on-surface-variant mt-3 mb-8">
                                        Elige tema, color de acento y motivo. Puedes cambiarlo cuando quieras en Configuración.
                                    </p>

                                    <div className="space-y-6">
                                        {/* Vista previa en vivo */}
                                        <Field label="Así se verá tu panel">
                                            <PanelPreview mode={mode} storeName={name.trim() || 'Mi negocio'} />
                                        </Field>

                                        {/* Tema */}
                                        <Field label="Tema del panel">
                                            <div className="grid grid-cols-3 gap-3">
                                                {Object.values(THEMES).map((th) => {
                                                    const active = mode === th.id;
                                                    return (
                                                        <OptionCard key={th.id} active={active} onClick={() => setMode(th.id)}>
                                                            <span className="flex items-center gap-2 mb-2">
                                                                <span
                                                                    className="w-5 h-5 rounded-shape-xl border border-outline-variant"
                                                                    style={{ background: th.surface }}
                                                                    aria-hidden="true"
                                                                />
                                                                <span className="w-3 h-3 rounded-shape-xl bg-primary" aria-hidden="true" />
                                                            </span>
                                                            <span className="block text-label-lg">{th.label}</span>
                                                            <span className={cx('block text-body-sm', !active && 'text-on-surface-muted')}>
                                                                {th.desc}
                                                            </span>
                                                        </OptionCard>
                                                    );
                                                })}
                                            </div>
                                        </Field>

                                        {/* Acento — los swatches son DATOS (ACCENT_PRESETS),
                                            un preset tiene que enseñar su propio color. */}
                                        <Field label="Color de acento">
                                            <div className="flex items-center gap-3 flex-wrap">
                                                {ACCENT_PRESETS.map((p) => {
                                                    const active = accent?.toUpperCase() === p.value.toUpperCase();
                                                    return (
                                                        <button
                                                            key={p.value}
                                                            type="button"
                                                            onClick={() => setAccent(p.value)}
                                                            aria-label={p.label}
                                                            aria-pressed={active}
                                                            title={p.label}
                                                            className={cx(
                                                                'w-10 h-10 rounded-shape-xl transition-shadow duration-short ease-standard',
                                                                active && 'ring-2 ring-primary ring-offset-2 ring-offset-transparent'
                                                            )}
                                                            style={{ background: p.value }}
                                                        />
                                                    );
                                                })}
                                                <label
                                                    className="state-layer w-10 h-10 rounded-shape-xl border border-outline flex items-center justify-center cursor-pointer text-on-surface-variant"
                                                    title="Color personalizado"
                                                >
                                                    <Plus size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" />
                                                    <input
                                                        type="color"
                                                        value={accent}
                                                        onChange={(e) => setAccent(e.target.value)}
                                                        aria-label="Color personalizado"
                                                        className="sr-only"
                                                    />
                                                </label>
                                            </div>
                                        </Field>

                                        {/* Motivo del fondo */}
                                        <Field label="Motivo del fondo">
                                            <div className="grid grid-cols-3 gap-3">
                                                {Object.values(BACKDROPS).map((b) => {
                                                    const active = backdrop === b.id;
                                                    const BackdropIcon = BACKDROP_ICONS[b.id] || UtensilsCrossed;
                                                    return (
                                                        <OptionCard key={b.id} active={active} onClick={() => setBackdrop(b.id)}>
                                                            <span
                                                                className={cx(
                                                                    'w-10 h-10 rounded-shape-md flex items-center justify-center mb-2',
                                                                    active
                                                                        ? 'bg-primary-container text-primary-on-container'
                                                                        : 'bg-surface-high text-on-surface-variant'
                                                                )}
                                                            >
                                                                <BackdropIcon size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                                                            </span>
                                                            <span className="block text-label-lg">{b.label}</span>
                                                            <span className={cx('block text-body-sm', !active && 'text-on-surface-muted')}>
                                                                {b.desc}
                                                            </span>
                                                        </OptionCard>
                                                    );
                                                })}
                                            </div>
                                        </Field>
                                    </div>

                                    {error && (
                                        <p
                                            role="alert"
                                            className="mt-6 flex items-start gap-2 text-body text-danger"
                                        >
                                            <AlertCircle
                                                size={ICON.xs}
                                                strokeWidth={ICON.stroke}
                                                className="flex-shrink-0 mt-0.5"
                                                aria-hidden="true"
                                            />
                                            {error}
                                        </p>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>

                    {/* Navegación */}
                    <div className="mt-10 flex items-center justify-between gap-3">
                        {step > 0 ? (
                            <Button variant="ghost" icon={ArrowLeft} onClick={() => go(-1)} disabled={saving}>
                                Anterior
                            </Button>
                        ) : <span />}

                        {step < STEPS.length - 1 ? (
                            <Button variant="primary" onClick={() => go(1)} disabled={!canAdvance}>
                                {step === 0 ? 'Empezar' : 'Seguir'}
                                <ArrowRight size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                            </Button>
                        ) : (
                            <Button variant="primary" icon={Rocket} loading={saving} onClick={finish}>
                                {saving ? 'Guardando…' : 'Entrar a mi panel'}
                            </Button>
                        )}
                    </div>
                </div>

                <p className="mt-6 text-body-sm text-on-surface-muted">
                    Podrás editar todo esto después en Configuración.
                </p>
            </div>
        </div>
    );
}

// ------------------------------------------------------------
// Gate: consulta /me y decide wizard vs dashboard. Envuelve /dashboard.
// Cuentas staff sin tienda y tiendas con onboarding hecho pasan directo.
// ------------------------------------------------------------
export function OnboardingGate({ children }) {
    const { fetchWithAuth } = useAuth();
    const { mode } = useTheme();
    const [state, setState] = useState({ checking: true, store: null });
    const [done, setDone] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await fetchWithAuth(`${API_BASE_URL}/api/auth/me/`);
                if (!res.ok) throw new Error('me failed');
                const data = await res.json();
                if (alive) setState({ checking: false, store: data.store });
            } catch {
                // Fail-open: ante un error nunca bloqueamos el panel.
                if (alive) setState({ checking: false, store: null });
            }
        })();
        return () => { alive = false; };
    }, [fetchWithAuth]);

    if (state.checking) {
        return (
            <div className="app-shell flex items-center justify-center" data-theme={mode}>
                <Loader2
                    size={ICON.md}
                    strokeWidth={ICON.stroke}
                    className="animate-spin text-primary"
                    aria-label="Cargando"
                />
            </div>
        );
    }

    const needsOnboarding = !done && state.store && state.store.onboarding_completed === false;
    if (needsOnboarding) {
        return (
            <Onboarding
                storeId={state.store.id}
                initialName={state.store.name}
                onComplete={() => setDone(true)}
            />
        );
    }

    return children;
}

export default Onboarding;
