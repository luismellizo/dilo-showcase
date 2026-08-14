import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X, Mail, Lock, User, Eye, EyeOff, ArrowLeft, ArrowRight,
    Loader2, AlertCircle, Check, MessageCircle, Sparkles, ChevronDown, Search
} from 'lucide-react';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';
import DiloLogo from './DiloLogo';
import DiloMascots from './DiloMascots';

// ============================================
// Marca: negro + naranja Rapi (igual que la landing)
// ============================================
const ORANGE = '#FF441F';
const ORANGE_SOFT = '#FF7A2F';

// ============================================
// "Continuar con Google" — Google Identity Services.
// Carga el script de GIS una sola vez y renderiza el botón oficial.
// El callback entrega un credential (ID token) que el backend verifica
// en /api/auth/google/. Sin REACT_APP_GOOGLE_CLIENT_ID no se muestra nada.
// ============================================
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '';
let gsiScriptPromise = null;

const loadGsiScript = () => {
    if (gsiScriptPromise) return gsiScriptPromise;
    gsiScriptPromise = new Promise((resolve, reject) => {
        if (window.google?.accounts?.id) return resolve();
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.defer = true;
        s.onload = resolve;
        s.onerror = () => { gsiScriptPromise = null; reject(new Error('gsi load failed')); };
        document.head.appendChild(s);
    });
    return gsiScriptPromise;
};

const GoogleButton = ({ onCredential, onError }) => {
    const containerRef = useRef(null);
    const { t } = useLanguage();

    useEffect(() => {
        if (!GOOGLE_CLIENT_ID) return;
        let cancelled = false;
        loadGsiScript().then(() => {
            if (cancelled || !containerRef.current) return;
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: (response) => onCredential(response.credential),
            });
            window.google.accounts.id.renderButton(containerRef.current, {
                theme: 'filled_black',
                size: 'large',
                shape: 'pill',
                text: 'continue_with',
                width: 340,
                locale: 'es',
            });
        }).catch(() => onError?.('No se pudo cargar Google. Revisa tu conexión.'));
        return () => { cancelled = true; };
    }, [onCredential, onError]);

    if (!GOOGLE_CLIENT_ID) return null;

    return (
        <div className="mt-5">
            <div className="flex items-center gap-3 mb-5">
                <div className="h-px flex-1 bg-white/[0.08]" />
                <span className="text-xs text-gray-500 uppercase tracking-widest">{t?.auth?.orContinueWith || 'o continúa con'}</span>
                <div className="h-px flex-1 bg-white/[0.08]" />
            </div>
            <div ref={containerRef} className="flex justify-center min-h-[44px]" />
        </div>
    );
};

const Input = ({ icon: Icon, type, placeholder, value, onChange, error, ...props }) => {
    const [showPassword, setShowPassword] = useState(false);
    const [focused, setFocused] = useState(false);
    const isPassword = type === 'password';

    return (
        <div className="space-y-1">
            <div className="relative">
                <div
                    className="absolute left-4 top-1/2 -translate-y-1/2 transition-colors"
                    style={{ color: focused ? ORANGE_SOFT : '#6b7280' }}
                >
                    <Icon className="w-5 h-5" />
                </div>
                <input
                    type={isPassword && showPassword ? 'text' : type}
                    placeholder={placeholder}
                    value={value}
                    onChange={onChange}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    className={`w-full pl-12 ${isPassword ? 'pr-12' : 'pr-4'} py-3.5 bg-white/[0.05] border rounded-xl text-white placeholder-gray-500 transition-all focus:outline-none focus:bg-white/[0.07]`}
                    style={{
                        borderColor: error
                            ? 'rgba(239,68,68,0.5)'
                            : focused ? 'rgba(255,68,31,0.55)' : 'rgba(255,255,255,0.1)',
                        boxShadow: focused && !error ? '0 0 20px -6px rgba(255,68,31,0.35)' : 'none'
                    }}
                    {...props}
                />
                {isPassword && (
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                    >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                )}
            </div>
            {error && (
                <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm text-red-400 flex items-center gap-1 pl-1"
                >
                    <AlertCircle className="w-4 h-4" />
                    {error}
                </motion.p>
            )}
        </div>
    );
};

// ============================================
// Selector de país + teléfono (WhatsApp del dueño).
// LatAm primero (mercado DILO), búsqueda por nombre o indicativo.
// El valor entregado al form es "+<indicativo><número>" solo dígitos.
// ============================================

const COUNTRIES = [
    { iso: 'CO', name: 'Colombia', dial: '57' },
    { iso: 'MX', name: 'México', dial: '52' },
    { iso: 'AR', name: 'Argentina', dial: '54' },
    { iso: 'PE', name: 'Perú', dial: '51' },
    { iso: 'CL', name: 'Chile', dial: '56' },
    { iso: 'EC', name: 'Ecuador', dial: '593' },
    { iso: 'VE', name: 'Venezuela', dial: '58' },
    { iso: 'BO', name: 'Bolivia', dial: '591' },
    { iso: 'PY', name: 'Paraguay', dial: '595' },
    { iso: 'UY', name: 'Uruguay', dial: '598' },
    { iso: 'BR', name: 'Brasil', dial: '55' },
    { iso: 'PA', name: 'Panamá', dial: '507' },
    { iso: 'CR', name: 'Costa Rica', dial: '506' },
    { iso: 'GT', name: 'Guatemala', dial: '502' },
    { iso: 'HN', name: 'Honduras', dial: '504' },
    { iso: 'SV', name: 'El Salvador', dial: '503' },
    { iso: 'NI', name: 'Nicaragua', dial: '505' },
    { iso: 'DO', name: 'República Dominicana', dial: '1' },
    { iso: 'CU', name: 'Cuba', dial: '53' },
    { iso: 'PR', name: 'Puerto Rico', dial: '1' },
    { iso: 'US', name: 'Estados Unidos', dial: '1' },
    { iso: 'CA', name: 'Canadá', dial: '1' },
    { iso: 'ES', name: 'España', dial: '34' },
    { iso: 'PT', name: 'Portugal', dial: '351' },
    { iso: 'FR', name: 'Francia', dial: '33' },
    { iso: 'DE', name: 'Alemania', dial: '49' },
    { iso: 'IT', name: 'Italia', dial: '39' },
    { iso: 'GB', name: 'Reino Unido', dial: '44' },
];

const flagEmoji = (iso) =>
    String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

const normalize = (s) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const PhoneField = ({ value, onChange, error }) => {
    const { t } = useLanguage();
    const [country, setCountry] = useState(COUNTRIES[0]);
    const [local, setLocal] = useState('');
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [focused, setFocused] = useState(false);
    const wrapRef = useRef(null);
    const searchRef = useRef(null);

    // Cierra al hacer click afuera o con Escape.
    useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [open]);

    useEffect(() => {
        if (open) {
            setQuery('');
            setTimeout(() => searchRef.current?.focus(), 50);
        }
    }, [open]);

    const emit = (c, num) => onChange(num ? `+${c.dial}${num}` : '');

    const handleLocal = (raw) => {
        const digits = raw.replace(/\D/g, '').slice(0, 12);
        setLocal(digits);
        emit(country, digits);
    };

    const pick = (c) => {
        setCountry(c);
        setOpen(false);
        emit(c, local);
    };

    const filtered = COUNTRIES.filter((c) =>
        normalize(c.name).includes(normalize(query)) || c.dial.includes(query.replace(/\D/g, ''))
    );

    return (
        <div className="space-y-1">
            <div ref={wrapRef} className="relative">
                <div
                    className="flex rounded-xl border transition-all"
                    style={{
                        background: 'rgba(255,255,255,0.05)',
                        borderColor: error
                            ? 'rgba(239,68,68,0.5)'
                            : (focused || open) ? 'rgba(255,68,31,0.55)' : 'rgba(255,255,255,0.1)',
                        boxShadow: (focused || open) && !error ? '0 0 20px -6px rgba(255,68,31,0.35)' : 'none'
                    }}
                >
                    <button
                        type="button"
                        onClick={() => setOpen(!open)}
                        className="flex items-center gap-2 pl-4 pr-3 py-3.5 border-r border-white/[0.08] text-white hover:bg-white/[0.04] rounded-l-xl transition-colors flex-shrink-0"
                    >
                        <span className="text-lg leading-none">{flagEmoji(country.iso)}</span>
                        <span className="text-sm font-semibold text-gray-300">+{country.dial}</span>
                        <ChevronDown
                            className="w-4 h-4 text-gray-500 transition-transform"
                            style={{ transform: open ? 'rotate(180deg)' : 'none' }}
                        />
                    </button>
                    <input
                        type="tel"
                        inputMode="numeric"
                        placeholder="300 123 4567"
                        value={local}
                        onChange={(e) => handleLocal(e.target.value)}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        className="w-full bg-transparent px-4 py-3.5 text-white placeholder-gray-500 focus:outline-none rounded-r-xl"
                    />
                </div>

                <AnimatePresence>
                    {open && (
                        <motion.div
                            initial={{ opacity: 0, y: -6, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.98 }}
                            transition={{ duration: 0.15 }}
                            className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-white/[0.1] bg-[#232326] shadow-2xl"
                        >
                            <div className="flex items-center gap-2 border-b border-white/[0.07] px-3.5 py-2.5">
                                <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                <input
                                    ref={searchRef}
                                    type="text"
                                    placeholder={t?.auth?.searchCountry || 'Buscar país o indicativo…'}
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    className="w-full bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
                                />
                            </div>
                            <div className="max-h-52 overflow-y-auto py-1">
                                {filtered.length === 0 && (
                                    <p className="px-4 py-3 text-sm text-gray-500">Sin resultados</p>
                                )}
                                {filtered.map((c) => (
                                    <button
                                        key={c.iso}
                                        type="button"
                                        onClick={() => pick(c)}
                                        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-white/[0.06]"
                                        style={c.iso === country.iso ? { background: 'rgba(255,68,31,0.12)' } : undefined}
                                    >
                                        <span className="text-lg leading-none">{flagEmoji(c.iso)}</span>
                                        <span className="flex-1 text-gray-200">{c.name}</span>
                                        <span className="font-semibold text-gray-500">+{c.dial}</span>
                                        {c.iso === country.iso && <Check className="w-4 h-4" style={{ color: ORANGE_SOFT }} />}
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            {error && (
                <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm text-red-400 flex items-center gap-1 pl-1"
                >
                    <AlertCircle className="w-4 h-4" />
                    {error}
                </motion.p>
            )}
        </div>
    );
};

const Button = ({ children, loading, variant = 'primary', ...props }) => (
    <motion.button
        whileHover={{ scale: loading ? 1 : 1.02 }}
        whileTap={{ scale: loading ? 1 : 0.98 }}
        disabled={loading}
        className="w-full py-3.5 rounded-xl font-bold transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        style={variant === 'primary'
            ? { background: ORANGE, color: '#000', boxShadow: '0 12px 30px -10px rgba(255,68,31,0.6)' }
            : { background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
        {...props}
    >
        {loading && <Loader2 className="w-5 h-5 animate-spin" />}
        {children}
    </motion.button>
);

// Lo que gana al registrarse — refuerzo de valor dentro del modal.
const TRIAL_PERKS = [
    'Bot de IA vendiendo en tu WhatsApp',
    'Menú creado con una foto de tu carta',
    'Panel de pedidos en tiempo real'
];

const TrialBanner = () => (
    <div
        className="mb-5 rounded-xl border p-4"
        style={{ borderColor: 'rgba(255,68,31,0.35)', background: 'rgba(255,68,31,0.07)' }}
    >
        <p className="flex items-center gap-2 text-sm font-bold text-white">
            <Sparkles size={15} style={{ color: ORANGE_SOFT }} />
            14 días de PRO gratis · sin tarjeta
        </p>
        <ul className="mt-2.5 space-y-1.5">
            {TRIAL_PERKS.map((perk) => (
                <li key={perk} className="flex items-start gap-2 text-[13px] text-white/65">
                    <Check size={14} className="mt-0.5 flex-shrink-0" style={{ color: ORANGE }} /> {perk}
                </li>
            ))}
        </ul>
    </div>
);

// ============================================
// FORMULARIO DE LOGIN
// ============================================

const LoginForm = ({ onSubmit, onModeChange, loading }) => {
    const { t } = useLanguage();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [errors, setErrors] = useState({});

    const validate = () => {
        const newErrors = {};
        if (!email) newErrors.email = t.auth.errors.emailRequired;
        else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = t.auth.errors.emailInvalid;
        if (!password) newErrors.password = t.auth.errors.passwordRequired;
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (validate()) {
            onSubmit({ email, password });
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <Input
                icon={Mail}
                type="email"
                placeholder={t.auth.email}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
                autoFocus
            />

            <Input
                icon={Lock}
                type="password"
                placeholder={t.auth.password}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
            />

            {/* La recuperación es una PÁGINA, no otro modo del modal: el
                usuario tiene que salir a su correo y volver por un enlace. */}
            <div className="text-right -mt-1">
                <a
                    href="/reset-password"
                    className="text-xs text-gray-400 hover:underline"
                >
                    ¿Olvidaste tu contraseña?
                </a>
            </div>

            <Button type="submit" loading={loading}>
                {t.auth.loginButton} <ArrowRight size={16} />
            </Button>

            <p className="text-center text-gray-400 text-sm">
                {t.auth.noAccount}{' '}
                <button
                    type="button"
                    onClick={() => onModeChange('register')}
                    className="font-semibold hover:underline"
                    style={{ color: ORANGE_SOFT }}
                >
                    {t.auth.signUp}
                </button>
            </p>
        </form>
    );
};

// ============================================
// FORMULARIO DE REGISTRO
// ============================================

const RegisterForm = ({ onSubmit, onModeChange, loading }) => {
    const { t } = useLanguage();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [whatsapp, setWhatsapp] = useState('');
    const [password, setPassword] = useState('');
    const [errors, setErrors] = useState({});

    const validate = () => {
        const newErrors = {};
        if (!name) newErrors.name = t.auth.errors.nameRequired;
        if (!email) newErrors.email = t.auth.errors.emailRequired;
        else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = t.auth.errors.emailInvalid;
        if (!whatsapp) newErrors.whatsapp = t.auth.errors.whatsappRequired;
        if (!password) newErrors.password = t.auth.errors.passwordRequired;
        else if (password.length < 8) newErrors.password = t.auth.errors.passwordMin;
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (validate()) {
            onSubmit({ name, email, password, whatsapp });
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <TrialBanner />

            <Input
                icon={User}
                type="text"
                placeholder={t.auth.name}
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={errors.name}
                autoFocus
            />

            <Input
                icon={Mail}
                type="email"
                placeholder={t.auth.email}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
            />

            <PhoneField
                value={whatsapp}
                onChange={setWhatsapp}
                error={errors.whatsapp}
            />

            <Input
                icon={Lock}
                type="password"
                placeholder={t.auth.passwordHint}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
            />

            <Button type="submit" loading={loading}>
                {t.auth.registerButton} <ArrowRight size={16} />
            </Button>

            <p className="text-center text-gray-400 text-sm">
                {t.auth.hasAccount}{' '}
                <button
                    type="button"
                    onClick={() => onModeChange('login')}
                    className="font-semibold hover:underline"
                    style={{ color: ORANGE_SOFT }}
                >
                    {t.auth.signIn}
                </button>
            </p>
        </form>
    );
};

// ============================================
// FORMULARIO DE VERIFICACIÓN OTP (6 casillas)
// ============================================

const OTP_LENGTH = 6;

const OtpInput = ({ value, onChange, onComplete }) => {
    const refs = useRef([]);
    const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] || '');

    const commit = useCallback((next) => {
        onChange(next);
        if (next.length === OTP_LENGTH) onComplete?.(next);
    }, [onChange, onComplete]);

    const handleChange = (idx, raw) => {
        const clean = raw.replace(/\D/g, '');
        if (!clean) return;
        // Soporta pegar el código completo en cualquier casilla.
        const next = (value.slice(0, idx) + clean).slice(0, OTP_LENGTH);
        commit(next);
        const focusIdx = Math.min(next.length, OTP_LENGTH - 1);
        refs.current[focusIdx]?.focus();
    };

    const handleKeyDown = (idx, e) => {
        if (e.key === 'Backspace') {
            e.preventDefault();
            const next = value.slice(0, Math.max(0, idx === value.length ? idx - 1 : idx));
            onChange(next);
            refs.current[Math.max(0, next.length)]?.focus();
        } else if (e.key === 'ArrowLeft' && idx > 0) {
            refs.current[idx - 1]?.focus();
        } else if (e.key === 'ArrowRight' && idx < OTP_LENGTH - 1) {
            refs.current[idx + 1]?.focus();
        }
    };

    return (
        <div className="flex justify-center gap-2">
            {digits.map((d, i) => (
                <input
                    key={i}
                    ref={(el) => { refs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={OTP_LENGTH}
                    value={d}
                    onChange={(e) => handleChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    onFocus={(e) => e.target.select()}
                    className="h-14 w-12 rounded-xl border bg-white/[0.05] text-center text-2xl font-bold text-white transition-all focus:outline-none"
                    style={{
                        borderColor: d ? 'rgba(255,68,31,0.55)' : 'rgba(255,255,255,0.1)',
                        boxShadow: d ? '0 0 16px -8px rgba(255,68,31,0.5)' : 'none'
                    }}
                />
            ))}
        </div>
    );
};

const VerifyForm = ({ email, onVerify, onResend, loading }) => {
    const { t } = useLanguage();
    const [otp, setOtp] = useState('');
    const [resending, setResending] = useState(false);
    const [error, setError] = useState('');

    const submit = async (code) => {
        if (code.length !== OTP_LENGTH) {
            setError(t.auth.errors.enterDigits);
            return;
        }
        setError('');
        try {
            await onVerify(code);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        submit(otp);
    };

    const handleResend = async () => {
        setResending(true);
        setError('');
        try {
            await onResend();
        } catch (err) {
            setError(err.message);
        } finally {
            setResending(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="text-center">
                <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 border"
                    style={{ background: 'rgba(255,68,31,0.1)', borderColor: 'rgba(255,68,31,0.3)' }}
                >
                    <MessageCircle className="w-8 h-8" style={{ color: ORANGE_SOFT }} />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">{t.auth.verifyWhatsApp}</h3>
                <p className="text-gray-400 text-sm">
                    {t.auth.codeSent}
                </p>
            </div>

            <div className="space-y-3">
                <OtpInput value={otp} onChange={setOtp} onComplete={submit} />
                {error && (
                    <p className="text-sm text-red-400 text-center flex items-center justify-center gap-1">
                        <AlertCircle className="w-4 h-4" />
                        {error}
                    </p>
                )}
            </div>

            <Button type="submit" loading={loading}>
                {t.auth.verify}
            </Button>

            <p className="text-center text-gray-400 text-sm">
                {t.auth.noCode}{' '}
                <button
                    type="button"
                    onClick={handleResend}
                    disabled={resending}
                    className="font-semibold hover:underline disabled:opacity-50"
                    style={{ color: ORANGE_SOFT }}
                >
                    {resending ? t.auth.sending : t.auth.resend}
                </button>
            </p>
        </form>
    );
};

// ============================================
// MODAL PRINCIPAL — marca DILO (negro + naranja)
// ============================================

export default function AuthModal({ mode = 'login', onClose, onSuccess, onModeChange }) {
    const { login, register, verifyOTP, resendOTP, loginWithGoogle } = useAuth();
    const { t } = useLanguage();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [currentMode, setCurrentMode] = useState(mode);
    const [pendingEmail, setPendingEmail] = useState('');

    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = 'unset'; };
    }, []);

    const handleModeChange = (newMode) => {
        setCurrentMode(newMode);
        setError('');
        if (onModeChange) onModeChange(newMode);
    };

    const handleLogin = async (data) => {
        setLoading(true);
        setError('');
        try {
            await login(data.email, data.password);
            onSuccess();
        } catch (err) {
            if (err.needsVerification) {
                setPendingEmail(err.email);
                setCurrentMode('verify');
            } else {
                setError(err.message || 'Credenciales inválidas');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async (data) => {
        setLoading(true);
        setError('');
        try {
            await register(data);
            setPendingEmail(data.email);
            setCurrentMode('verify');
        } catch (err) {
            setError(err.message || 'Error al crear la cuenta');
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (otp) => {
        setLoading(true);
        try {
            await verifyOTP(pendingEmail, otp);
            onSuccess();
        } finally {
            setLoading(false);
        }
    };

    const handleResend = async () => {
        await resendOTP(pendingEmail);
    };

    // Credential del botón de Google → backend → sesión iniciada.
    const handleGoogleCredential = useCallback(async (credential) => {
        setError('');
        try {
            await loginWithGoogle(credential);
            onSuccess();
        } catch (err) {
            setError(err.message || 'No pudimos iniciar sesión con Google');
        }
    }, [loginWithGoogle, onSuccess]);

    const handleGoogleError = useCallback((msg) => setError(msg), []);

    const titles = {
        login: t.auth.login,
        register: t.auth.register,
        verify: t.auth.verification
    };

    const subtitles = {
        login: 'Tu vendedor IA te está esperando.',
        register: 'Tu restaurante vendiendo solo, en 5 minutos.',
        verify: 'Último paso y arrancamos.'
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/75 backdrop-blur-md"
            />

            {/* Modal */}
            <motion.div
                initial={{ scale: 0.92, opacity: 0, y: 24 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 12 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                className="relative w-full max-w-md lg:max-w-4xl max-h-[92vh] overflow-y-auto rounded-3xl border border-white/[0.08] bg-[#1c1c1f] shadow-2xl lg:grid lg:grid-cols-2"
            >
                {/* ============================================
                    Panel izquierdo — mascotas DILO (solo desktop).
                    Los formularios no cambian: viven en la columna derecha.
                ============================================ */}
                <div className="relative hidden lg:flex flex-col justify-between overflow-hidden border-r border-black/[0.06] bg-[#faf9f7] px-8 pt-8 pb-0">
                    {/* Glow de marca */}
                    <div
                        className="pointer-events-none absolute inset-0"
                        style={{ background: 'radial-gradient(80% 60% at 30% 20%, rgba(255,68,31,0.08), transparent 70%)' }}
                    />

                    <div className="relative z-10">
                        <DiloLogo height={30} color="#0d0d0f" />
                        <p className="mt-4 text-xl font-black tracking-tight text-[#0d0d0f] leading-snug">
                            Tu restaurante vendiendo solo,<br />
                            <span style={{ color: ORANGE }}>24/7 por WhatsApp.</span>
                        </p>
                    </div>

                    <div className="relative z-10 flex items-end justify-center">
                        <DiloMascots />
                    </div>
                </div>

                {/* Columna derecha — contenido original intacto */}
                <div className="relative">
                {/* Glow superior de marca */}
                <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-32"
                    style={{ background: 'radial-gradient(70% 100% at 50% 0%, rgba(255,68,31,0.16), transparent 75%)' }}
                />

                {/* Header */}
                <div className="relative px-6 sm:px-8 pt-7 pb-5">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                            {currentMode === 'verify' && (
                                <button
                                    onClick={() => handleModeChange('register')}
                                    className="p-1 -ml-1 text-gray-500 hover:text-gray-300"
                                >
                                    <ArrowLeft className="w-5 h-5" />
                                </button>
                            )}
                            <DiloLogo height={26} />
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-500 hover:text-gray-300 hover:bg-white/[0.05] rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    <h2 className="mt-5 text-2xl font-black tracking-tight text-white">
                        {titles[currentMode]}
                    </h2>
                    <p className="mt-1 text-sm text-gray-400">{subtitles[currentMode]}</p>
                </div>

                {/* Content */}
                <div className="relative px-6 sm:px-8 pb-7">
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-400 text-sm"
                        >
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {error}
                        </motion.div>
                    )}

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={currentMode}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.2 }}
                        >
                            {currentMode === 'login' && (
                                <LoginForm
                                    onSubmit={handleLogin}
                                    onModeChange={handleModeChange}
                                    loading={loading}
                                />
                            )}
                            {currentMode === 'register' && (
                                <RegisterForm
                                    onSubmit={handleRegister}
                                    onModeChange={handleModeChange}
                                    loading={loading}
                                />
                            )}
                            {currentMode === 'verify' && (
                                <VerifyForm
                                    email={pendingEmail}
                                    onVerify={handleVerify}
                                    onResend={handleResend}
                                    loading={loading}
                                />
                            )}
                        </motion.div>
                    </AnimatePresence>

                    {/* Continuar con Google (solo login/registro, no en OTP) */}
                    {currentMode !== 'verify' && (
                        <GoogleButton
                            onCredential={handleGoogleCredential}
                            onError={handleGoogleError}
                        />
                    )}
                </div>
                </div>
            </motion.div>
        </motion.div>
    );
}
