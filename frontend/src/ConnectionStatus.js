import React from 'react';
import { Wifi, WifiOff, Loader, AlertCircle } from 'lucide-react';
import { ReadyState } from 'react-use-websocket';
import { cx, ICON } from './ui';

/**
 * Indicador del estado del WebSocket como chip tonal de Material 3.
 *
 * Antes usaba `bg-yellow-100 text-yellow-700 border-yellow-300` y compañía:
 * paletas que el remapeo del tema no cubría, así que en Carbón y Medianoche
 * salía un chip pastel ilegible. Ahora cada estado usa su rol
 * (`warning` / `success` / `danger`), que sí está definido en los 3 presets.
 *
 * OJO: hoy nadie importa este componente — el estado de conexión va en el
 * subtítulo del panel (`liveSubtitle` en App.js). Se deja alineado al sistema
 * para que no reintroduzca colores fuera de paleta si alguien lo reutiliza.
 */

const ConnectionStatus = ({ readyState }) => {
    const statusConfig = {
        [ReadyState.CONNECTING]: {
            label: 'Conectando…',
            tone: 'bg-warning-container text-warning-on-container',
            icon: Loader,
            animate: 'animate-spin',
        },
        [ReadyState.OPEN]: {
            label: 'En vivo',
            tone: 'bg-success-container text-success-on-container',
            icon: Wifi,
            animate: '',
        },
        [ReadyState.CLOSING]: {
            label: 'Cerrando…',
            tone: 'bg-warning-container text-warning-on-container',
            icon: WifiOff,
            animate: '',
        },
        [ReadyState.CLOSED]: {
            label: 'Desconectado',
            tone: 'bg-danger-container text-danger-on-container',
            icon: WifiOff,
            animate: 'animate-pulse',
        },
        [ReadyState.UNINSTANTIATED]: {
            label: 'No iniciado',
            tone: 'bg-surface-high text-on-surface-variant',
            icon: AlertCircle,
            animate: '',
        },
    };

    const status = statusConfig[readyState] || statusConfig[ReadyState.CLOSED];
    const Icon = status.icon;

    return (
        <div
            className={cx('inline-flex items-center gap-2 h-8 px-3 rounded-shape-sm text-label', status.tone)}
            role="status"
            aria-live="polite"
        >
            <Icon size={ICON.xs} strokeWidth={ICON.stroke} className={status.animate} aria-hidden="true" />
            <span>{status.label}</span>
        </div>
    );
};

export default ConnectionStatus;
