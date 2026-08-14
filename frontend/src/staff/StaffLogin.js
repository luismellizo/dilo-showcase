import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Eye, EyeOff, Loader2, AlertTriangle, ArrowLeft, MailCheck } from 'lucide-react';
import { useAuth } from '../AuthContext';

/**
 * Puerta independiente del panel interno — /admin/login. Dos pasos:
 *   1. correo del dominio interno + contraseña → el backend manda un código
 *   2. código de 6 dígitos            → sesión del panel
 *
 * Deliberadamente austera y desconectada del embudo de comercios: sin landing,
 * sin registro, sin Google, sin "olvidé mi contraseña" (el reset de una cuenta
 * del equipo se hace por consola, no por un formulario público).
 *
 * El backend responde un 401 idéntico para cualquier fallo del paso 1 — esta
 * pantalla jamás debe explicar cuál de las condiciones falló.
 */

const CODE_LENGTH = 6;

const inputCls = 'w-full px-4 py-3 rounded-xl bg-[#141416] border border-white/10 text-white ' +
    'placeholder-white/25 text-[15px] outline-none transition-colors ' +
    'focus:border-white/30 focus:bg-[#171719]';

const mmss = (total) => {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

export default function StaffLogin() {
    const navigate = useNavigate();
    const { staffRequestCode, staffVerifyCode } = useAuth();

    const [step, setStep] = useState('credentials');   // 'credentials' | 'code'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [challenge, setChallenge] = useState(null);  // { id, hint }
    const [digits, setDigits] = useState(Array(CODE_LENGTH).fill(''));
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const boxes = useRef([]);
    const submittedCode = useRef('');   // evita reenviar el mismo código dos veces

    // Cuenta regresiva del código. Al llegar a 0 el código deja de servir y el
    // backend responde 410: se ofrece pedir otro en vez de dejar reintentar.
    useEffect(() => {
        if (step !== 'code' || secondsLeft <= 0) return undefined;
        const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
        return () => clearTimeout(t);
    }, [step, secondsLeft]);

    const requestCode = async (e) => {
        if (e) e.preventDefault();
        if (loading) return;
        setError('');
        setLoading(true);
        try {
            const res = await staffRequestCode(email.trim().toLowerCase(), password);
            setChallenge({ id: res.challenge_id, hint: res.email_hint });
            setSecondsLeft(res.expires_in || 180);
            setDigits(Array(CODE_LENGTH).fill(''));
            submittedCode.current = '';
            setStep('code');
            setTimeout(() => boxes.current[0]?.focus(), 60);
        } catch (err) {
            setError(err.message === 'Failed to fetch'
                ? 'No se pudo contactar al servidor.'
                : err.message || 'Credenciales inválidas.');
            setPassword('');
        } finally {
            setLoading(false);
        }
    };

    const verifyCode = useCallback(async (code) => {
        if (loading || submittedCode.current === code) return;
        submittedCode.current = code;
        setError('');
        setLoading(true);
        try {
            await staffVerifyCode(challenge.id, code);
            navigate('/admin', { replace: true });
        } catch (err) {
            if (err.expired) {
                setSecondsLeft(0);
                setError('El código venció. Solicita uno nuevo.');
            } else {
                setError(err.message || 'Código inválido.');
            }
            setDigits(Array(CODE_LENGTH).fill(''));
            submittedCode.current = '';
            setTimeout(() => boxes.current[0]?.focus(), 60);
            setLoading(false);
        }
    }, [challenge, loading, navigate, staffVerifyCode]);

    const setDigit = (index, value) => {
        const clean = value.replace(/\D/g, '');
        if (!clean) {
            setDigits((prev) => prev.map((d, i) => (i === index ? '' : d)));
            return;
        }
        // Pegar el código completo desde el correo llena todas las casillas.
        const next = [...digits];
        clean.split('').forEach((char, offset) => {
            if (index + offset < CODE_LENGTH) next[index + offset] = char;
        });
        setDigits(next);

        const filled = Math.min(index + clean.length, CODE_LENGTH - 1);
        boxes.current[filled]?.focus();
        const joined = next.join('');
        if (joined.length === CODE_LENGTH && !joined.includes('')) verifyCode(joined);
    };

    const onKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            boxes.current[index - 1]?.focus();
        }
        if (e.key === 'ArrowLeft' && index > 0) boxes.current[index - 1]?.focus();
        if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) boxes.current[index + 1]?.focus();
    };

    const backToCredentials = () => {
        setStep('credentials');
        setChallenge(null);
        setError('');
        setPassword('');
        setSecondsLeft(0);
    };

    return (
        <div className="min-h-screen flex items-center justify-center px-5 py-10" style={{ background: '#09090b' }}>
            <div className="w-full max-w-[380px]">
                <div className="flex flex-col items-center text-center mb-8">
                    <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
                        style={{
                            background: 'linear-gradient(135deg, #FF441F, #b52c11)',
                            boxShadow: '0 10px 30px -12px rgba(255,68,31,0.7)'
                        }}
                    >
                        {step === 'code'
                            ? <MailCheck size={22} className="text-white" strokeWidth={2.2} />
                            : <ShieldCheck size={22} className="text-white" strokeWidth={2.2} />}
                    </div>
                    <h1 className="text-xl font-extrabold text-white tracking-tight">DILO Admin</h1>
                    <p className="text-[13px] text-white/40 mt-1">
                        {step === 'code'
                            ? <>Código enviado a <span className="text-white/70">{challenge?.hint}</span></>
                            : 'Acceso restringido al equipo interno'}
                    </p>
                </div>

                {step === 'credentials' ? (
                    <form onSubmit={requestCode} className="space-y-3.5" noValidate>
                        <div>
                            <label htmlFor="staff-email" className="block text-[12px] font-semibold text-white/50 mb-1.5">
                                Correo del equipo
                            </label>
                            <input
                                id="staff-email"
                                type="email"
                                autoComplete="username"
                                autoFocus
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className={inputCls}
                                placeholder="tunombre@dilo.example.com"
                            />
                        </div>

                        <div>
                            <label htmlFor="staff-password" className="block text-[12px] font-semibold text-white/50 mb-1.5">
                                Contraseña
                            </label>
                            <div className="relative">
                                <input
                                    id="staff-password"
                                    type={showPassword ? 'text' : 'password'}
                                    autoComplete="current-password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className={inputCls}
                                    style={{ paddingRight: '3rem' }}
                                    placeholder="••••••••"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-white/30 hover:text-white/70 transition-colors"
                                >
                                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                                </button>
                            </div>
                        </div>

                        {error && <ErrorBox message={error} />}

                        <button
                            type="submit"
                            disabled={loading || !email || !password}
                            className="w-full py-3 rounded-xl font-bold text-[15px] text-white transition-all
                                       disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            style={{ background: '#FF441F' }}
                        >
                            {loading ? <><Loader2 size={17} className="animate-spin" /> Verificando…</> : 'Continuar'}
                        </button>
                    </form>
                ) : (
                    <div className="space-y-4">
                        <div className="flex gap-2 justify-center" onPaste={(e) => {
                            e.preventDefault();
                            setDigit(0, (e.clipboardData.getData('text') || '').slice(0, CODE_LENGTH));
                        }}>
                            {digits.map((digit, i) => (
                                <input
                                    key={i}
                                    ref={(el) => { boxes.current[i] = el; }}
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={CODE_LENGTH}
                                    aria-label={`Dígito ${i + 1} de ${CODE_LENGTH}`}
                                    value={digit}
                                    disabled={loading || secondsLeft <= 0}
                                    onChange={(e) => setDigit(i, e.target.value)}
                                    onKeyDown={(e) => onKeyDown(i, e)}
                                    className="w-12 h-14 text-center text-[22px] font-bold rounded-xl bg-[#141416]
                                               border border-white/10 text-white outline-none transition-colors
                                               focus:border-white/40 focus:bg-[#171719] disabled:opacity-40"
                                />
                            ))}
                        </div>

                        <p className="text-center text-[12px] text-white/35">
                            {secondsLeft > 0
                                ? <>El código vence en <span className="text-white/70 font-semibold tabular-nums">{mmss(secondsLeft)}</span></>
                                : 'El código venció.'}
                        </p>

                        {error && <ErrorBox message={error} />}

                        <button
                            type="button"
                            onClick={requestCode}
                            disabled={loading || secondsLeft > 0}
                            className="w-full py-3 rounded-xl font-bold text-[14px] transition-all
                                       disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2
                                       text-white border border-white/15 hover:bg-white/5"
                        >
                            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Enviar un código nuevo'}
                        </button>

                        <button
                            type="button"
                            onClick={backToCredentials}
                            className="w-full flex items-center justify-center gap-2 text-[13px] text-white/35 hover:text-white/70 transition-colors py-1"
                        >
                            <ArrowLeft size={14} /> Usar otra cuenta
                        </button>
                    </div>
                )}

                <p className="text-center text-[11px] text-white/25 mt-7 leading-relaxed">
                    Cada intento de acceso queda registrado con fecha, IP y navegador.
                </p>
            </div>
        </div>
    );
}

const ErrorBox = ({ message }) => (
    <div
        role="alert"
        className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl text-[13px] font-medium"
        style={{ background: 'rgba(239,68,68,0.10)', color: '#fca5a5' }}
    >
        <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
        <span>{message}</span>
    </div>
);
