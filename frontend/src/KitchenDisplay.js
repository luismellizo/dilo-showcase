import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useWebSocket from 'react-use-websocket';
import { Clock, CheckCircle2, ChefHat, ArrowLeft, Maximize, Minimize, ZoomIn, BellOff } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';
import { API_BASE_URL, WS_BASE_URL } from './config';
import { cx, ICON, Button, IconButton, EmptyState } from './ui';
import { playNotificationSound, notifyNewOrder, unlockAudio, isAudioUnlocked } from './notify';

// Estados que la cocina debe ver (pedido pagado/confirmado por preparar).
const KITCHEN_STATUSES = ['CONFIRMED', 'VERIFYING_PAYMENT'];

/* Semáforo de espera. El SIGNIFICADO no cambia (verde <5m, ámbar <10m, rojo
   10m+): lo que cambia es que el valor sale de los roles del tema en vez de
   tres hex sueltos, así funciona igual en Claro, Carbón y Medianoche. */
const waitTone = (mins) => {
  if (mins < 5) return { fill: 'bg-success', chip: 'bg-success-container text-success-on-container' };
  if (mins < 10) return { fill: 'bg-warning', chip: 'bg-warning-container text-warning-on-container' };
  return { fill: 'bg-danger', chip: 'bg-danger-container text-danger-on-container' };
};

const OrderCard = ({ order, now, onReady }) => {
  const created = new Date(order.created_at).getTime();
  const mins = Math.max(0, Math.floor((now - created) / 60000));
  const tone = waitTone(mins);
  const paying = order.status === 'VERIFYING_PAYMENT';
  // Barra de espera: llena a los 15 min (crítico).
  const waitPct = Math.min(100, (mins / 15) * 100);

  return (
    <div className="flex flex-col rounded-shape-lg bg-surface-low overflow-hidden anim-fade-up">
      {/* Barra de tiempo de espera */}
      <div className="h-1.5 w-full bg-surface-high">
        <div className={cx('h-full transition-[width] duration-long ease-standard', tone.fill)} style={{ width: `${waitPct}%` }} />
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          {/* En una pantalla de cocina se lee a 2 m: el nombre sube a 22px,
              que es el `title-large` de la escala, no un tamaño inventado. */}
          <p className="text-title-lg text-on-surface truncate">
            {order.customer_name || 'Cliente'}
          </p>
          <p className="text-body-sm text-on-surface-muted tabular-nums mt-0.5">#{String(order.id).slice(0, 6)}</p>
        </div>
        <div className={cx('flex items-center gap-1.5 tabular-nums px-3 h-8 rounded-shape-sm text-label-lg flex-shrink-0', tone.chip)}>
          <Clock size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" /> {mins}m
        </div>
      </div>

      <ul className="flex-1 px-4 pb-3 space-y-3">
        {(order.items || []).map((it) => (
          <li key={it.id} className="flex gap-3 items-start">
            <span className="text-title-lg text-primary tabular-nums flex-shrink-0 leading-tight">
              {it.quantity}×
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-body-lg text-on-surface break-words">{it.product_name}</span>
              {it.notes ? (
                <span className="mt-1.5 block text-body bg-warning-container text-warning-on-container rounded-shape-sm px-2.5 py-1.5 break-words">
                  {it.notes}
                </span>
              ) : null}
            </div>
          </li>
        ))}
        {(!order.items || order.items.length === 0) && (
          <li className="text-body text-on-surface-muted">Sin items</li>
        )}
        {order.notes ? (
          <li className="text-body bg-warning-container text-warning-on-container rounded-shape-sm px-2.5 py-1.5 whitespace-pre-wrap break-words">
            {order.notes}
          </li>
        ) : null}
      </ul>

      <div className="px-4 pb-4">
        {paying && (
          <p className="mb-2 flex items-center justify-center gap-1.5 rounded-shape-sm bg-warning-container text-warning-on-container py-1.5 text-center text-body">
            Verificando pago
          </p>
        )}
        <button
          onClick={() => onReady(order.id)}
          className="state-layer state-on-primary flex w-full items-center justify-center gap-2 rounded-shape-xl h-14 text-label-lg bg-success text-success-on transition-colors duration-short ease-standard"
        >
          <CheckCircle2 size={ICON.md} strokeWidth={ICON.stroke} aria-hidden="true" /> Listo / Despachar
        </button>
      </div>
    </div>
  );
};

export default function KitchenDisplay() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { mode } = useTheme();
  const storeId = user?.store?.id;
  const [orders, setOrders] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [xlMode, setXlMode] = useState(false);
  // El navegador no deja sonar audio sin un gesto previo del usuario. En una
  // tablet recién abierta eso significa cero alarma y nadie entiende por qué.
  const [audioReady, setAudioReady] = useState(isAudioUnlocked);

  // Wake lock: la pantalla de cocina no se apaga sola (re-adquiere al volver
  // de segundo plano). Fail-open si el navegador no lo soporta.
  useEffect(() => {
    let lock = null;
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator) lock = await navigator.wakeLock.request('screen');
      } catch (e) { /* sin soporte o sin permiso — seguimos */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release?.().catch(() => {});
    };
  }, []);

  // Estado real de fullscreen (Escape también sale).
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    'Content-Type': 'application/json'
  }), []);

  // Reloj para refrescar tiempos de espera.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  // Carga inicial.
  const load = useCallback(async () => {
    if (!storeId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/orders/?store_id=${storeId}&page_size=80`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.results || []);
        setOrders(list.filter((o) => KITCHEN_STATUSES.includes(o.status)));
      }
    } catch (e) { /* silencioso */ }
  }, [storeId, authHeaders]);

  useEffect(() => { load(); }, [load]);

  // Tiempo real.
  const wsToken = localStorage.getItem('access_token');
  const { lastMessage } = useWebSocket(
    storeId && wsToken ? `${WS_BASE_URL}/ws/store/${storeId}/?token=${wsToken}` : null,
    { shouldReconnect: () => true }
  );

  useEffect(() => {
    if (!lastMessage) return;
    try {
      const data = JSON.parse(lastMessage.data);
      if (data.type !== 'ORDER_UPDATE') return;
      const o = data.payload;
      setOrders((prev) => {
        const rest = prev.filter((x) => x.id !== o.id);
        if (!KITCHEN_STATUSES.includes(o.status)) return rest;
        // Suena SOLO cuando el pedido entra a cocina por primera vez. Sonar en
        // cada cambio de estado de un pedido ya visible convierte la alarma en
        // ruido de fondo y la cocina deja de hacerle caso.
        if (rest.length === prev.length) {
          playNotificationSound();
          notifyNewOrder(o);
        }
        return [...rest, o];
      });
    } catch (e) { /* ignore */ }
  }, [lastMessage]);

  const markReady = useCallback(async (orderId) => {
    setOrders((prev) => prev.filter((o) => o.id !== orderId)); // optimista
    try {
      await fetch(`${API_BASE_URL}/api/orders/${orderId}/update_status/`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ status: 'COMPLETED' })
      });
    } catch (e) { load(); }
  }, [authHeaders, load]);

  // Más antiguos primero (la cocina respeta el orden de llegada).
  const sorted = useMemo(
    () => [...orders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    [orders]
  );

  const clock = new Date(now).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="app-shell min-h-screen" data-theme={mode}>
      <header className="sticky top-0 z-10 flex items-center justify-between bg-surface px-4 sm:px-6 h-topbar gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-shape-sm bg-primary-container text-primary-on-container flex-shrink-0">
            <ChefHat size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-title-lg text-on-surface truncate">Cocina · {user?.store?.name || 'DILO'}</h1>
            <p className="flex items-center gap-2 text-body-sm text-on-surface-muted">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-shape-xl bg-success" aria-hidden="true" />
              {sorted.length} {sorted.length === 1 ? 'pedido' : 'pedidos'} en preparación · tiempo real
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Leyenda del semáforo de espera */}
          <div className="hidden items-center gap-3 rounded-shape-xl bg-surface-high px-4 h-8 text-label text-on-surface-variant lg:flex">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-shape-xl bg-success" aria-hidden="true" /> &lt;5m</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-shape-xl bg-warning" aria-hidden="true" /> &lt;10m</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-shape-xl bg-danger" aria-hidden="true" /> 10m+</span>
          </div>
          <span className="text-title-lg tabular-nums text-on-surface mr-1">{clock}</span>
          {!audioReady && (
            <Button
              variant="secondary"
              icon={BellOff}
              onClick={async () => setAudioReady(await unlockAudio())}
            >
              <span className="hidden sm:inline">Activar sonido</span>
            </Button>
          )}
          <button
            onClick={() => setXlMode(v => !v)}
            aria-pressed={xlMode}
            aria-label="Texto grande"
            title="Texto grande"
            className={cx(
              'state-layer w-10 h-10 rounded-shape-xl flex items-center justify-center transition-colors duration-short ease-standard',
              xlMode
                ? 'bg-secondary-container text-secondary-on-container state-on-secondary-container'
                : 'text-on-surface-variant'
            )}
          >
            <ZoomIn size={ICON.sm} strokeWidth={ICON.stroke} />
          </button>
          <IconButton
            icon={isFullscreen ? Minimize : Maximize}
            label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            onClick={toggleFullscreen}
          />
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/dashboard')}>
            <span className="hidden sm:inline">Panel</span>
          </Button>
        </div>
      </header>

      {sorted.length === 0 ? (
        <div className="flex min-h-[70vh] flex-col items-center justify-center">
          <EmptyState
            icon={ChefHat}
            title="Sin pedidos en cocina"
            description="Todo al día. Los pedidos nuevos aparecen aquí solos."
          />
        </div>
      ) : (
        <div
          className={cx(
            'grid grid-cols-1 gap-4 p-4 sm:p-6',
            xlMode ? 'sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
          )}
          style={xlMode ? { zoom: 1.22 } : undefined}
        >
          {sorted.map((o) => (
            <OrderCard key={o.id} order={o} now={now} onReady={markReady} />
          ))}
        </div>
      )}
    </div>
  );
}
