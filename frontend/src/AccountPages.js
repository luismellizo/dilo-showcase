/**
 * Páginas públicas de recuperación de cuenta: restablecer contraseña y
 * confirmar un correo nuevo.
 *
 * Son PÁGINAS y no modales porque se abren desde un enlace de correo, muchas
 * veces en otro dispositivo y sin sesión iniciada. El token de la URL es la
 * única credencial: se manda al backend y no se guarda en ningún lado.
 *
 * Visual: el mismo Material 3 del panel (`app-shell` + `data-theme` +
 * primitivos de `ui.js`), así que quien llega desde el correo aterriza en la
 * misma superficie que verá al entrar. Cero hex.
 *
 * Los cuatro estados —cargando, éxito, error y enlace vencido (410)— se
 * distinguen por ICONO + rol de color (primary / success / danger / warning),
 * no por una caja de color plano.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    AlertCircle, ArrowRight, CheckCircle2, Clock, KeyRound, Loader2, Mail, XCircle,
} from 'lucide-react';

import DiloLogo from './DiloLogo';
import { API_BASE_URL } from './config';
import { useTheme } from './ThemeContext';
import { Button, Card, Field, ICON, cx, inputCls } from './ui';

// ============================================
// Piezas compartidas
// ============================================

/* Contenedor tonal del icono de cabecera: es el que dice de un vistazo si la
   pantalla es informativa, un éxito, un fallo o un enlace vencido. */
const TONES = {
    primary: 'bg-primary-container text-primary-on-container',
    success: 'bg-success-container text-success-on-container',
    warning: 'bg-warning-container text-warning-on-container',
    danger: 'bg-danger-container text-danger-on-container',
};

const Shell = ({ icon: Icon, tone = 'primary', spin = false, title, subtitle, children }) => {
    const { mode } = useTheme();
    return (
        <div className="app-shell flex flex-col items-center justify-center px-4 py-12" data-theme={mode}>
            <Link to="/" className="mb-8 text-on-surface" aria-label="Ir al inicio de DILO">
                <DiloLogo height={34} color="currentColor" />
            </Link>

            <Card className="w-full max-w-md p-8 shadow-1 anim-fade-up">
                {Icon && (
                    <span
                        className={cx(
                            'inline-flex items-center justify-center w-12 h-12 rounded-shape-md mb-5',
                            TONES[tone] || TONES.primary
                        )}
                        aria-hidden="true"
                    >
                        <Icon
                            size={ICON.md}
                            strokeWidth={ICON.stroke}
                            className={spin ? 'animate-spin' : undefined}
                        />
                    </span>
                )}
                <h1 className="text-headline text-on-surface">{title}</h1>
                {subtitle && <p className="text-body-lg text-on-surface-variant mt-3">{subtitle}</p>}
                {children && <div className="mt-8">{children}</div>}
            </Card>

            <p className="mt-6 text-body-sm text-on-surface-muted">
                ¿Necesitas ayuda? Escríbenos a{' '}
                <a href="mailto:hola@example.com" className="text-primary underline">hola@example.com</a>
            </p>
        </div>
    );
};

/* Mensaje de error del formulario: icono + rol `danger`, sin caja de color. */
const ErrorLine = ({ children }) => (
    <p role="alert" className="flex items-start gap-2 text-body text-danger">
        <AlertCircle size={ICON.xs} strokeWidth={ICON.stroke} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
        {children}
    </p>
);

const post = async (path, body) => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    let data = {};
    try { data = await response.json(); } catch { /* 500 sin cuerpo */ }
    return { ok: response.ok, status: response.status, data };
};

// ============================================
// /reset-password — sin token pide el correo; con token pide la contraseña
// ============================================

export const ResetPassword = () => {
    const [params] = useSearchParams();
    const token = params.get('token') || '';

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [repeat, setRepeat] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);
    const [done, setDone] = useState(false);

    const pedirEnlace = async (e) => {
        e.preventDefault();
        setError('');
        if (!/\S+@\S+\.\S+/.test(email)) return setError('Escribe un correo válido.');
        setLoading(true);
        const { ok, data } = await post('/api/auth/password-reset/', { email });
        setLoading(false);
        if (!ok) return setError(data.error || 'No pudimos procesar la solicitud.');
        setSent(true);
    };

    const guardarContrasena = async (e) => {
        e.preventDefault();
        setError('');
        if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
        if (password !== repeat) return setError('Las dos contraseñas no coinciden.');
        setLoading(true);
        const { ok, data } = await post('/api/auth/password-reset/confirm/', { token, password });
        setLoading(false);
        if (!ok) return setError(data.error || 'Este enlace ya no sirve. Pide uno nuevo.');
        setDone(true);
    };

    // --- Paso 2: llegó por el enlace del correo ---
    if (token) {
        if (done) {
            return (
                <Shell
                    icon={CheckCircle2}
                    tone="success"
                    title="Contraseña lista"
                    subtitle="Ya puedes entrar a DILO con tu contraseña nueva."
                >
                    <Link to="/" className="block">
                        <Button type="button" className="w-full">
                            Ir a iniciar sesión
                            <ArrowRight size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                        </Button>
                    </Link>
                </Shell>
            );
        }

        return (
            <Shell
                icon={KeyRound}
                title="Crea tu contraseña nueva"
                subtitle="Elige una que no uses en otro lado. Mínimo 8 caracteres."
            >
                <form onSubmit={guardarContrasena} className="space-y-5">
                    <Field label="Contraseña nueva">
                        <input
                            type="password"
                            placeholder="Mínimo 8 caracteres"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={inputCls(false)}
                            autoFocus
                        />
                    </Field>
                    <Field label="Repite la contraseña">
                        <input
                            type="password"
                            placeholder="La misma otra vez"
                            value={repeat}
                            onChange={(e) => setRepeat(e.target.value)}
                            className={inputCls(false)}
                        />
                    </Field>
                    {error && <ErrorLine>{error}</ErrorLine>}
                    <Button type="submit" loading={loading} className="w-full">
                        Guardar contraseña
                        <ArrowRight size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                    </Button>
                    <p className="text-center text-body-sm text-on-surface-muted">
                        ¿El enlace venció?{' '}
                        <Link to="/reset-password" className="text-primary underline">Pide uno nuevo</Link>
                    </p>
                </form>
            </Shell>
        );
    }

    // --- Paso 1: pedir el enlace ---
    if (sent) {
        return (
            <Shell
                icon={Mail}
                tone="success"
                title="Revisa tu correo"
                subtitle={`Si ${email} tiene cuenta en DILO, ahí está el enlace para crear una contraseña nueva. Vence en una hora.`}
            >
                <Link to="/" className="block">
                    <Button type="button" className="w-full">
                        Volver al inicio
                        <ArrowRight size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                    </Button>
                </Link>
            </Shell>
        );
    }

    return (
        <Shell
            icon={KeyRound}
            title="¿Olvidaste tu contraseña?"
            subtitle="Escribe el correo de tu cuenta y te mandamos un enlace para crear una nueva."
        >
            <form onSubmit={pedirEnlace} className="space-y-5">
                <Field label="Correo de tu cuenta">
                    <input
                        type="email"
                        placeholder="tu@correo.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputCls(false)}
                        autoFocus
                    />
                </Field>
                {error && <ErrorLine>{error}</ErrorLine>}
                <Button type="submit" loading={loading} className="w-full">
                    Enviar enlace
                    <ArrowRight size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                </Button>
                <p className="text-center text-body-sm text-on-surface-muted">
                    <Link to="/" className="text-primary underline">Volver a iniciar sesión</Link>
                </p>
            </form>
        </Shell>
    );
};

// ============================================
// /confirm-email — canjea el token apenas se abre el enlace
// ============================================

export const ConfirmEmail = () => {
    const [params] = useSearchParams();
    const token = params.get('token') || '';
    const [estado, setEstado] = useState(token ? 'cargando' : 'invalido');
    const [mensaje, setMensaje] = useState('');
    const [email, setEmail] = useState('');
    // El backend responde 410 + {expired:true} cuando el enlace venció. Es el
    // mismo desenlace ("no se pudo"), pero no la misma causa: un enlace vencido
    // se resuelve pidiendo otro, no reportando un fallo. Solo cambia el icono
    // y el rol de color; el mensaje sigue saliendo del backend.
    const [vencido, setVencido] = useState(false);

    const confirmar = useCallback(async () => {
        const { ok, status, data } = await post('/api/auth/email-change/confirm/', { token });
        if (ok) {
            setEmail(data.email || '');
            return setEstado('ok');
        }
        setVencido(status === 410 || Boolean(data.expired));
        setMensaje(data.error || 'Esta solicitud ya no sirve.');
        setEstado('invalido');
    }, [token]);

    useEffect(() => {
        if (token) confirmar();
    }, [token, confirmar]);

    if (estado === 'cargando') {
        return <Shell icon={Loader2} spin title="Confirmando tu correo…" subtitle="Un segundo." />;
    }

    if (estado === 'ok') {
        return (
            <Shell
                icon={CheckCircle2}
                tone="success"
                title="Correo confirmado"
                subtitle={`${email} es ahora el correo de acceso de tu cuenta. Úsalo la próxima vez que inicies sesión.`}
            >
                <Link to="/dashboard" className="block">
                    <Button type="button" className="w-full">
                        Ir a mi panel
                        <ArrowRight size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                    </Button>
                </Link>
            </Shell>
        );
    }

    return (
        <Shell
            icon={vencido ? Clock : XCircle}
            tone={vencido ? 'warning' : 'danger'}
            title="No pudimos confirmar el cambio"
            subtitle={mensaje || 'El enlace está incompleto o ya venció. Pide el cambio otra vez desde tu perfil.'}
        >
            <Link to="/dashboard/profile" className="block">
                <Button type="button" className="w-full">
                    Ir a mi perfil
                    <ArrowRight size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                </Button>
            </Link>
        </Shell>
    );
};
