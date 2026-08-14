/**
 * WhatsAppConnect — Embedded Signup v4 de Meta
 *
 * Conecta el número de WhatsApp Business de un comercio con DILO.
 *
 * Dos datos salen del flujo y AMBOS son necesarios:
 *  1. El `code` canjeable, que llega por el callback de `FB.login`.
 *  2. Los identificadores de la cuenta (`waba_id`, `phone_number_id`), que
 *     llegan por el **session logging**: un evento `message` que la ventana
 *     de Meta postea a la que abrió el flujo. Meta exige escucharlo, y sin él
 *     el backend tendría que adivinar a qué cuenta pertenece el token.
 *
 * Requiere en el entorno del build:
 *  - REACT_APP_META_APP_ID
 *  - REACT_APP_META_CONFIG_ID  (config_id del Embedded Signup)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    MessageCircle,
    Check,
    X,
    AlertCircle,
    Unlink,
    ShieldAlert,
    KeyRound
} from 'lucide-react';
import { Button, IconButton, Field, inputCls, ICON, cx } from './ui';

// ============================================
// CONFIGURACIÓN
// ============================================

const META_APP_ID = process.env.REACT_APP_META_APP_ID || '';
const META_CONFIG_ID = process.env.REACT_APP_META_CONFIG_ID || '';
// v18.0 quedó fuera de soporte; el Embedded Signup v4 pide la última versión.
const GRAPH_VERSION = process.env.REACT_APP_META_GRAPH_VERSION || 'v23.0';

// Sin app id o sin config id el flujo no puede abrirse: la feature se apaga
// entera en vez de mostrar un botón que revienta al hacer clic.
export const isEmbeddedSignupConfigured = Boolean(META_APP_ID && META_CONFIG_ID);

// ============================================
// ESTILOS
// ============================================
// Todo el color sale de roles de `tokens.css`. Antes este componente pintaba
// su propio degradado verde y sus grises sobre `rgba(255,255,255,...)`, que
// solo se leían sobre un fondo oscuro: en el tema Claro el texto desaparecía.
// El estado de conexión ahora usa los roles semánticos: `success` conectado,
// `warning` advertencia, `danger` error.

const CLS = {
    container: 'rounded-shape-lg p-6 bg-surface-container',
    notice: 'flex items-start gap-3 rounded-shape-md px-4 py-3 text-body mb-3',
    connected: 'flex items-center gap-2 px-4 py-3 rounded-shape-md bg-success-container text-success-on-container mb-3',
};

// ============================================
// FACEBOOK SDK LOADER
// ============================================

let fbSDKLoaded = false;
let fbSDKLoading = false;
const fbSDKCallbacks = [];

const loadFacebookSDK = () => {
    return new Promise((resolve, reject) => {
        if (fbSDKLoaded && window.FB) {
            resolve(window.FB);
            return;
        }

        fbSDKCallbacks.push({ resolve, reject });

        if (fbSDKLoading) return;
        fbSDKLoading = true;

        window.fbAsyncInit = function () {
            window.FB.init({
                appId: META_APP_ID,
                autoLogAppEvents: true,
                xfbml: true,
                version: GRAPH_VERSION
            });

            fbSDKLoaded = true;
            fbSDKCallbacks.forEach(cb => cb.resolve(window.FB));
            fbSDKCallbacks.length = 0;
        };

        const script = document.createElement('script');
        script.src = 'https://connect.facebook.net/en_US/sdk.js';
        script.async = true;
        script.defer = true;
        script.crossOrigin = 'anonymous';
        script.onerror = () => {
            fbSDKLoading = false;
            fbSDKCallbacks.forEach(cb => cb.reject(new Error('Error cargando Facebook SDK')));
            fbSDKCallbacks.length = 0;
        };

        document.body.appendChild(script);
    });
};

// Mensajes legibles para los abandonos más comunes del flujo.
const ABANDON_MESSAGES = {
    ERROR: 'Meta reportó un error durante la conexión. Intenta de nuevo.',
    default: 'Cerraste la ventana antes de terminar. Tu número no quedó conectado.',
};

// ============================================
// COMPONENTE PRINCIPAL
// ============================================

const WhatsAppConnect = ({ storeId, apiBaseUrl = '', authToken }) => {
    const [status, setStatus] = useState('loading'); // loading | disconnected | connected | connecting
    const [phoneNumber, setPhoneNumber] = useState('');
    const [verifiedName, setVerifiedName] = useState('');
    const [subscribed, setSubscribed] = useState(true);
    const [error, setError] = useState('');
    const [sdkReady, setSdkReady] = useState(false);
    const [needsPin, setNeedsPin] = useState(false);
    const [pin, setPin] = useState('');

    // Datos que entrega el session logging. Viven en un ref porque llegan por
    // un listener global, fuera del ciclo de render de React, y el callback de
    // FB.login los lee justo después.
    const sessionInfoRef = useRef({ waba_id: '', phone_number_id: '' });
    const pendingCodeRef = useRef('');

    const getHeaders = useCallback(() => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
    }), [authToken]);

    // ------------------------------------------------
    // Session logging: escucha obligatoria del flujo
    // ------------------------------------------------
    useEffect(() => {
        const onMessage = (event) => {
            // Solo se confía en mensajes que vengan de Meta.
            if (!event.origin || !event.origin.endsWith('facebook.com')) return;

            let data;
            try {
                data = JSON.parse(event.data);
            } catch {
                return; // el flujo también postea strings sueltos; se ignoran
            }

            if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;

            const payload = data.data || {};

            if (payload.event === 'FINISH' ||
                payload.event === 'FINISH_ONLY_WABA' ||
                payload.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
                sessionInfoRef.current = {
                    waba_id: payload.waba_id || (payload.waba_ids || [])[0] || '',
                    phone_number_id: payload.phone_number_id || '',
                };
            } else if (payload.event === 'CANCEL') {
                sessionInfoRef.current = { waba_id: '', phone_number_id: '' };
                setError(
                    payload.current_step
                        ? `Saliste del proceso en el paso "${payload.current_step}". Tu número no quedó conectado.`
                        : ABANDON_MESSAGES.default
                );
                setStatus('disconnected');
            } else if (payload.event === 'ERROR') {
                sessionInfoRef.current = { waba_id: '', phone_number_id: '' };
                setError(payload.error_message || ABANDON_MESSAGES.ERROR);
                setStatus('disconnected');
            }
        };

        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    // ------------------------------------------------
    // Estado inicial + SDK
    // ------------------------------------------------
    useEffect(() => {
        const init = async () => {
            try {
                if (isEmbeddedSignupConfigured) {
                    await loadFacebookSDK();
                    setSdkReady(true);
                }

                const response = await fetch(
                    `${apiBaseUrl}/api/whatsapp/status/?store_id=${storeId}&verify=1`,
                    { headers: getHeaders() }
                );

                if (!response.ok) throw new Error('Error consultando estado');

                const data = await response.json();

                if (data.connected) {
                    setStatus('connected');
                    setPhoneNumber(data.phone_number);
                    setVerifiedName(data.verified_name || '');
                    // webhook_verified null = no se pudo comprobar; no alarmar.
                    setSubscribed(data.webhook_verified !== false);
                } else {
                    setStatus('disconnected');
                }
            } catch (err) {
                console.error('Error inicializando WhatsAppConnect:', err);
                setStatus('disconnected');
            }
        };

        if (storeId && authToken) init();
    }, [storeId, authToken, apiBaseUrl, getHeaders]);

    // ------------------------------------------------
    // Enviar code + IDs al backend
    // ------------------------------------------------
    const completeOnboarding = useCallback(async (code, suppliedPin = '') => {
        const { waba_id, phone_number_id } = sessionInfoRef.current;

        try {
            const response = await fetch(`${apiBaseUrl}/api/whatsapp/token-exchange/`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({
                    code,
                    store_id: storeId,
                    waba_id,
                    phone_number_id,
                    ...(suppliedPin ? { pin: suppliedPin } : {}),
                }),
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setStatus('connected');
                setPhoneNumber(data.phone_number);
                setVerifiedName(data.verified_name || '');
                setSubscribed(Boolean(data.subscribed));
                setNeedsPin(false);
                setPin('');
                pendingCodeRef.current = '';
                setError('');
                return;
            }

            // El número ya tenía verificación en dos pasos: hay que pedir el PIN
            // real del comercio; el code sigue sirviendo para el reintento.
            if (data.needs_pin) {
                pendingCodeRef.current = code;
                setNeedsPin(true);
            }
            setError(data.error || 'Error conectando WhatsApp');
            setStatus('disconnected');
        } catch (err) {
            setError('Error de conexión con el servidor');
            setStatus('disconnected');
        }
    }, [apiBaseUrl, getHeaders, storeId]);

    // ------------------------------------------------
    // Lanzar el Embedded Signup
    // ------------------------------------------------
    const handleConnect = useCallback(() => {
        if (!isEmbeddedSignupConfigured) {
            setError('La conexión con WhatsApp aún no está configurada en este entorno.');
            return;
        }
        if (!sdkReady || !window.FB) {
            setError('El SDK de Facebook no está listo. Intenta de nuevo.');
            return;
        }

        setStatus('connecting');
        setError('');
        setNeedsPin(false);
        sessionInfoRef.current = { waba_id: '', phone_number_id: '' };

        try {
            window.FB.login((response) => {
                const code = response?.authResponse?.code;
                if (code) {
                    completeOnboarding(code);
                } else {
                    // El listener de session logging ya puso un mensaje si el
                    // flujo reportó CANCEL/ERROR; aquí solo se cubre el resto.
                    setStatus((prev) => (prev === 'connecting' ? 'disconnected' : prev));
                    setError((prev) => prev || ABANDON_MESSAGES.default);
                }
            }, {
                config_id: META_CONFIG_ID,
                response_type: 'code',
                override_default_response_type: true,
                extras: { setup: {} },
            });
        } catch (err) {
            setError('Error iniciando el flujo de conexión');
            setStatus('disconnected');
        }
    }, [sdkReady, completeOnboarding]);

    const handleSubmitPin = useCallback(() => {
        if (!/^\d{6}$/.test(pin)) {
            setError('El PIN debe tener 6 dígitos');
            return;
        }
        if (!pendingCodeRef.current) {
            setError('La sesión de conexión expiró. Vuelve a pulsar "Conectar".');
            setNeedsPin(false);
            return;
        }
        setStatus('connecting');
        setError('');
        completeOnboarding(pendingCodeRef.current, pin);
    }, [pin, completeOnboarding]);

    const handleDisconnect = useCallback(async () => {
        if (!window.confirm('¿Desconectar WhatsApp? Dejarás de recibir mensajes de tus clientes.')) {
            return;
        }

        setStatus('connecting');
        setError('');

        try {
            const response = await fetch(`${apiBaseUrl}/api/whatsapp/disconnect/`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ store_id: storeId })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setStatus('disconnected');
                setPhoneNumber('');
                setVerifiedName('');
            } else {
                setError(data.error || 'Error desconectando');
                setStatus('connected');
            }
        } catch (err) {
            setError('Error de conexión con el servidor');
            setStatus('connected');
        }
    }, [storeId, apiBaseUrl, getHeaders]);

    // ------------------------------------------------
    // Render
    // ------------------------------------------------
    const renderContent = () => {
        if (!isEmbeddedSignupConfigured && status !== 'connected') {
            return (
                <div className={cx(CLS.notice, 'bg-warning-container text-warning-on-container')}>
                    <ShieldAlert size={ICON.sm} strokeWidth={ICON.stroke} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                        La conexión con WhatsApp Business todavía no está habilitada en
                        este entorno. Mientras tanto puedes vender por Telegram.
                    </span>
                </div>
            );
        }

        switch (status) {
            case 'loading':
                return (
                    <div className="py-5 text-center">
                        <Button variant="ghost" loading disabled>Cargando...</Button>
                    </div>
                );

            case 'connected':
                return (
                    <>
                        {!subscribed && (
                            <div className={cx(CLS.notice, 'bg-warning-container text-warning-on-container')}>
                                <ShieldAlert size={ICON.sm} strokeWidth={ICON.stroke} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                                <span>
                                    Tu número está conectado pero <span className="font-medium">Meta no está
                                    enviándonos tus mensajes</span>. Desconecta y vuelve a
                                    conectar para restablecer la suscripción.
                                </span>
                            </div>
                        )}
                        <div className={CLS.connected}>
                            <Check size={ICON.sm} strokeWidth={ICON.stroke} className="flex-shrink-0" aria-hidden="true" />
                            <span className="text-title tabular-nums">{phoneNumber}</span>
                            {verifiedName && <span className="text-body">· {verifiedName}</span>}
                            <span className="text-body ml-auto">Conectado</span>
                        </div>
                        <Button
                            variant="danger"
                            icon={Unlink}
                            className="w-full"
                            onClick={handleDisconnect}
                        >
                            Desconectar WhatsApp
                        </Button>
                    </>
                );

            case 'connecting':
                return (
                    <Button loading disabled className="w-full">Conectando...</Button>
                );

            case 'disconnected':
            default:
                return (
                    <>
                        {needsPin && (
                            <>
                                <div className={cx(CLS.notice, 'bg-warning-container text-warning-on-container')}>
                                    <KeyRound size={ICON.sm} strokeWidth={ICON.stroke} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                                    <span>
                                        Ese número ya tiene verificación en dos pasos.
                                        Escribe el PIN de 6 dígitos que configuraste en
                                        WhatsApp Business para terminar la conexión.
                                    </span>
                                </div>
                                <div className="flex items-end gap-2 mb-3">
                                    <div className="flex-1 min-w-0">
                                        <Field label="PIN de verificación en dos pasos">
                                            <input
                                                className={cx(inputCls(false), 'text-center tabular-nums')}
                                                value={pin}
                                                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                placeholder="••••••"
                                                inputMode="numeric"
                                                maxLength={6}
                                                aria-label="PIN de verificación en dos pasos"
                                            />
                                        </Field>
                                    </div>
                                    <Button onClick={handleSubmitPin}>Confirmar</Button>
                                </div>
                            </>
                        )}
                        <Button
                            icon={MessageCircle}
                            className="w-full"
                            onClick={handleConnect}
                            disabled={!sdkReady}
                        >
                            {needsPin ? 'Empezar de nuevo' : 'Conectar WhatsApp Business'}
                        </Button>
                    </>
                );
        }
    };

    return (
        <motion.div
            className={CLS.container}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
        >
            {/* Sin cabecera propia: la tarjeta que envuelve este componente
                (Config → Canales) ya rotula "WhatsApp Business". Antes el
                título salía dos veces seguidas. */}
            {renderContent()}

            <AnimatePresence>
                {error && (
                    <motion.div
                        className="flex items-center gap-3 px-4 py-3 rounded-shape-md mt-3 text-body bg-danger-container text-danger-on-container"
                        role="alert"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                    >
                        <AlertCircle size={ICON.sm} strokeWidth={ICON.stroke} className="flex-shrink-0" aria-hidden="true" />
                        <span className="min-w-0">{error}</span>
                        <IconButton
                            icon={X}
                            size="sm"
                            label="Cerrar aviso"
                            className="ml-auto flex-shrink-0"
                            onClick={() => setError('')}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default WhatsAppConnect;
