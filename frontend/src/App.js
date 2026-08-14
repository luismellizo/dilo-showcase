import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import {
  MessageSquare, ShoppingBag, Check, X,
  Search, Send, ArrowLeft, LayoutGrid, MessagesSquare, Receipt,
  RotateCcw, ExternalLink, ZoomIn, ZoomOut, MapPin, Compass, AlertTriangle,
  Bell, BellOff
} from 'lucide-react';
import printTicket from './printTicket';
import KanbanView from './KanbanView';
import StatsCards from './StatsCards';
import LandingPage from './LandingPage';
import StoreConfig from './StoreConfig';
import KitchenDisplay from './KitchenDisplay';
import PrivacyPolicy from './PrivacyPolicy';
import TermsOfService from './TermsOfService';
import DataDeletion from './DataDeletion';
import { ResetPassword, ConfirmEmail } from './AccountPages';
import CustomersPage from './CustomersPage';
import ReportsPage from './ReportsPage';
import Profile from './Profile';
import BillingPage from './BillingPage';
import TrialBanner from './TrialBanner';
import DashboardLayout from './DashboardLayout';
import { Badge, Button, IconButton, Avatar, EmptyState, Chip, Switch, ICON, cx } from './ui';
import { AuthProvider, useAuth } from './AuthContext';
import StaffGate from './staff/StaffGate';
import StaffLogin from './staff/StaffLogin';
import StaffOverview from './staff/StaffOverview';
import StaffStores from './staff/StaffStores';
import StaffStoreDetail from './staff/StaffStoreDetail';
import StaffAudit from './staff/StaffAudit';
import ImpersonationBanner from './staff/ImpersonationBanner';
import { OnboardingGate } from './Onboarding';
import { LanguageProvider, useLanguage } from './LanguageContext';
import { ThemeProvider } from './ThemeContext';
import { API_BASE_URL, WS_BASE_URL, formatCOP } from './config';
import {
  playNotificationSound, notifyNewOrder, canNotify,
  notificationPermission, requestNotificationPermission,
} from './notify';

// --- UTILIDADES ---
const formatTime = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Etiqueta de día para separadores del chat: Hoy / Ayer / fecha corta.
const formatDayLabel = (dateString) => {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoy';
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
};

// --- COMPONENTES ---

const STATUS_TONE = {
  NEW: 'blue',
  WAITING_PAYMENT: 'amber',
  VERIFYING_PAYMENT: 'amber',
  CONFIRMED: 'green',
  COMPLETED: 'neutral',
  DELIVERED: 'neutral',
  REJECTED: 'red',
  CANCELLED: 'red',
};

const OrderStatusBadge = ({ status }) => {
  const { t } = useLanguage();
  const labels = t.dashboard.statuses;
  return <Badge tone={STATUS_TONE[status] || 'blue'}>{labels[status] || status}</Badge>;
};

// Distintivo de canal. Los colores de WhatsApp y Telegram se expresan con los
// roles de estado del tema (éxito / información): así el canal se sigue
// distinguiendo de un vistazo sin meter dos verdes ajenos a la paleta.
const SOURCE_STYLE = {
  WHATSAPP: { chip: 'bg-success-container text-success-on-container', label: 'WA' },
  TELEGRAM: { chip: 'bg-info-container text-info-on-container', label: 'TG' },
};

const OrderListItem = ({ order, onClick, isSelected }) => {
  const { t } = useLanguage();
  const src = SOURCE_STYLE[order.source] || SOURCE_STYLE.WHATSAPP;
  const isNew = order.status === 'NEW';
  const itemsPreview = order.items?.length
    ? order.items.map(i => `${i.quantity}× ${i.product_name || i.name}`).join(' · ')
    : null;

  return (
    <button
      onClick={() => onClick(order.id)}
      aria-current={isSelected ? 'true' : undefined}
      className={cx(
        'state-layer relative w-full text-left flex items-start gap-4 px-4 py-3',
        'transition-colors duration-short ease-standard',
        isSelected && 'bg-secondary-container state-on-secondary-container'
      )}
    >
      {/* Avatar con distintivo de canal */}
      <div className="relative flex-shrink-0 mt-0.5">
        <Avatar name={order.customer_name} size="md" />
        <span
          className={cx(
            'absolute -bottom-1 -right-1 px-1 h-4 inline-flex items-center rounded-shape-xs text-label tabular-nums',
            src.chip
          )}
        >
          {src.label}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline gap-2">
          <h3 className={cx('truncate text-body-lg', isSelected ? 'text-secondary-on-container' : 'text-on-surface')}>
            {order.customer_name || t.dashboard.orderList.unknownCustomer}
          </h3>
          <span className="text-body-sm text-on-surface-muted flex-shrink-0 tabular-nums">{formatTime(order.created_at)}</span>
        </div>
        <div className="flex justify-between items-center mt-0.5 gap-2">
          <p className="text-body text-on-surface-variant truncate min-w-0">
            {isNew ? (
              <span className="flex items-center gap-1.5 text-success">
                <MessageSquare size={ICON.xs} strokeWidth={ICON.stroke} className="flex-shrink-0" /> {t.dashboard.orderList.newOrder}
              </span>
            ) : (
              <span className="truncate">{itemsPreview || t.dashboard.orderList.noItems}</span>
            )}
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            {parseFloat(order.total_amount) > 0 && (
              <span className="text-body text-on-surface tabular-nums">{formatCOP(order.total_amount)}</span>
            )}
            {isNew && <span className="w-2 h-2 bg-success rounded-shape-xl animate-pulse" aria-hidden="true" />}
          </div>
        </div>
        <div className="mt-2">
          <OrderStatusBadge status={order.status} />
        </div>
      </div>
    </button>
  );
};

const ChatMessage = ({ text, sender, time, media, grouped }) => {
  const fromCustomer = sender === 'USER';
  return (
    <div className={cx('flex', fromCustomer ? 'justify-start' : 'justify-end', grouped ? 'mt-0.5' : 'mt-3')}>
      <div
        className={cx(
          'max-w-[75%] px-4 py-2.5 text-body',
          // La esquina "pegada" al hablante marca de quién es la burbuja;
          // el resto va a 16px, como los contenedores de M3.
          fromCustomer
            ? 'bg-surface-high text-on-surface rounded-shape-lg rounded-tl-shape-xs'
            : 'bg-primary-container text-primary-on-container rounded-shape-lg rounded-tr-shape-xs'
        )}
      >
        {media && (
          <img
            src={media}
            alt="Imagen adjunta"
            loading="lazy"
            className="rounded-shape-md mb-2 max-h-56 w-auto cursor-pointer transition-opacity duration-short ease-standard hover:opacity-90"
            onClick={() => window.open(media, '_blank')}
          />
        )}
        {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
        <span className="text-body-sm opacity-70 block text-right mt-1 tabular-nums">
          {time}
        </span>
      </div>
    </div>
  );
};

// Separador de día: etiqueta flotante centrada, en caja normal.
const DaySeparator = ({ label }) => (
  <div className="flex justify-center my-3">
    <span className="px-3 h-6 inline-flex items-center rounded-shape-sm bg-surface-high text-on-surface-variant text-label">
      {label}
    </span>
  </div>
);

const OrderDetailView = ({ order, onAction, messages, onSendMessage, onToggleBot }) => {
  const { t } = useLanguage();
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  // Al cambiar de pedido, saltar directo al final de la conversación
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [order?.id]);

  // Con mensajes nuevos, solo auto-scrollear si el usuario ya está cerca del fondo
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 120) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = () => {
    if (newMessage.trim()) {
      onSendMessage(order.id, newMessage);
      setNewMessage('');
    }
  };

  if (!order) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-surface-container">
        <EmptyState
          icon={ShoppingBag}
          title={t.dashboard.detail.emptyTitle}
          description={t.dashboard.detail.emptyDescription}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-surface-container relative min-h-0">
      {/* Header del chat */}
      <div className="bg-surface-low px-4 py-3 flex items-center justify-between gap-3 z-10 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={order.customer_name} size="md" />
          <div className="min-w-0">
            <h2 className="text-title text-on-surface truncate">{order.customer_name}</h2>
            <div className="text-body-sm text-on-surface-variant flex items-center gap-2 mt-0.5">
              <span className="truncate">{order.customer_phone}</span>
              <OrderStatusBadge status={order.status} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-title text-on-surface tabular-nums">{formatCOP(order.total_amount)}</span>
          {/* Toma de control humana: mientras el switch está apagado el bot no
              responde en ESTA conversación. El badge existe porque un switch
              apagado se pasa por alto y el cliente se queda esperando. */}
          {order.bot_paused && <Badge tone="amber" dot>{t.dashboard.detail.botPaused}</Badge>}
          <Switch
            checked={!order.bot_paused}
            onChange={() => onToggleBot?.(order.id, !order.bot_paused)}
            ariaLabel={order.bot_paused ? t.dashboard.detail.resumeBot : t.dashboard.detail.pauseBot}
          />
        </div>
      </div>

      {/* Área de conversación */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 flex flex-col">

        {/* Resumen del pedido */}
        <div className="flex justify-center mb-3">
          <div className="bg-surface-low rounded-shape-lg p-5 w-full max-w-sm">
            <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-outline-variant">
              <h3 className="text-title text-on-surface">{t.dashboard.detail.orderSummary}</h3>
              <span className="text-body-sm text-on-surface-muted tabular-nums">#{order.id.slice(0, 8)}</span>
            </div>
            <ul className="space-y-2 mb-3">
              {(order.items || []).map((item, idx) => (
                <li key={idx} className="flex justify-between text-body gap-3">
                  <span className="text-on-surface min-w-0 truncate">
                    <span className="tabular-nums text-on-surface-variant">{item.quantity}×</span> {item.product_name}
                  </span>
                  <span className="text-on-surface-variant tabular-nums flex-shrink-0">{formatCOP(item.unit_price)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between items-baseline pt-3 border-t border-outline-variant">
              <span className="text-body text-on-surface-variant">{t.dashboard.detail.total}</span>
              <span className="text-title-lg text-on-surface tabular-nums">{formatCOP(order.total_amount)}</span>
            </div>
            {order.payment_method && (
              <p className="text-body-sm text-on-surface-muted mt-1 text-right">{order.payment_method}</p>
            )}
            {order.delivery_address && (
              <p className="text-body text-on-surface-variant mt-3 pt-3 border-t border-outline-variant flex items-start gap-2">
                <MapPin size={ICON.xs} strokeWidth={ICON.stroke} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span className="min-w-0 break-words">{order.delivery_address}</span>
              </p>
            )}
            {order.notes && (
              <p className="text-body bg-warning-container text-warning-on-container rounded-shape-sm px-3 py-2 mt-3 whitespace-pre-wrap break-words">
                {order.notes}
              </p>
            )}
            {order.payment_proof_url && (
              <div className="mt-3 pt-3 border-t border-outline-variant">
                <p className="text-body-sm text-on-surface-variant mb-2 flex items-center gap-1.5">
                  <Receipt size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" /> {t.dashboard.detail.paymentProof}
                </p>
                <img
                  src={order.payment_proof_url}
                  alt={t.dashboard.detail.paymentProof}
                  className="w-full rounded-shape-md cursor-pointer transition-opacity duration-short ease-standard hover:opacity-90"
                  onClick={() => window.open(order.payment_proof_url, '_blank')}
                />
              </div>
            )}
          </div>
        </div>

        {/* Mensajes reales — con separadores de día y burbujas agrupadas */}
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.timestamp).toDateString() !== new Date(msg.timestamp).toDateString();
          const grouped = !newDay && prev && prev.sender === msg.sender
            && (new Date(msg.timestamp) - new Date(prev.timestamp)) < 3 * 60000;
          return (
            <React.Fragment key={msg.id}>
              {newDay && <DaySeparator label={formatDayLabel(msg.timestamp)} />}
              <ChatMessage
                text={msg.content}
                sender={msg.sender}
                time={formatTime(msg.timestamp)}
                media={msg.media_url || msg.media || null}
                grouped={grouped}
              />
            </React.Fragment>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Barra de acción */}
      <div className="bg-surface-low p-3 flex items-center gap-2 flex-shrink-0">
        {['NEW', 'WAITING_PAYMENT', 'VERIFYING_PAYMENT'].includes(order.status) ? (
          <>
            <Button variant="danger" className="flex-1" icon={X} onClick={() => onAction(order.id, 'CANCELLED')}>
              {t.dashboard.detail.reject}
            </Button>
            <Button variant="success" className="flex-[2]" icon={Check} onClick={() => onAction(order.id, 'CONFIRMED')}>
              {t.dashboard.detail.confirmOrder}
            </Button>
          </>
        ) : (
          <div className="flex-1 flex items-center gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={t.dashboard.detail.writeMessage}
              aria-label={t.dashboard.detail.writeMessage}
              className="flex-1 min-w-0 h-12 px-4 rounded-shape-xl bg-surface-high text-on-surface text-body border border-transparent outline-none transition-colors duration-short ease-standard focus:border-primary"
            />
            <button
              onClick={handleSend}
              disabled={!newMessage.trim()}
              className="state-layer state-on-primary btn-disabled w-12 h-12 rounded-shape-lg flex items-center justify-center bg-primary text-primary-on flex-shrink-0 transition-colors duration-short ease-standard"
              aria-label="Enviar"
            >
              <Send size={ICON.sm} strokeWidth={ICON.stroke} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// --- DASHBOARD PRINCIPAL DILO ---
function Dashboard() {
  const { t } = useLanguage();
  const { user, fetchWithAuth } = useAuth();
  const [orders, setOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [viewMode, setViewMode] = useState('kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState('ALL');
  const [todayOnly, setTodayOnly] = useState(false);
  const [undoInfo, setUndoInfo] = useState(null);
  const [proofOrder, setProofOrder] = useState(null);
  const [proofZoom, setProofZoom] = useState(false);
  // 'default' = todavía no se preguntó · 'granted' · 'denied' · 'unsupported'
  const [notifPermission, setNotifPermission] = useState(notificationPermission);
  const undoTimerRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreOrders, setHasMoreOrders] = useState(false);
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(true);

  const storeId = user?.store?.id;
  const wsToken = localStorage.getItem('access_token');

  const { lastMessage, readyState } = useWebSocket(
    storeId && wsToken ? `${WS_BASE_URL}/ws/store/${storeId}/?token=${wsToken}` : null,
    {
      shouldReconnect: () => true,
      reconnectInterval: 3000,
    }
  );

  const loadOrders = useCallback(async (page = 1, append = false) => {
    if (!storeId) return;
    try {
      if (append) {
        setLoadingMoreOrders(true);
      }
      const response = await fetchWithAuth(`${API_BASE_URL}/api/orders/?store_id=${storeId}&page=${page}&page_size=50`);
      const data = await response.json();
      const nextResults = Array.isArray(data) ? data : data.results || [];
      const hasNextPage = Array.isArray(data) ? nextResults.length === 50 : Boolean(data.next);

      setOrders(prev => (append ? [...prev, ...nextResults] : nextResults));
      setCurrentPage(page);
      setHasMoreOrders(hasNextPage);
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoadingMoreOrders(false);
      setLoadingOrders(false);
    }
  }, [fetchWithAuth, storeId]);

  const loadMessages = useCallback(async (orderId) => {
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/api/orders/${orderId}/messages/`);
      const data = await response.json();
      if (Array.isArray(data)) setMessages(data);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  }, [fetchWithAuth]);

  const handleSendMessage = async (orderId, content) => {
    try {
      // Optimistic update
      const tempMsg = {
        id: Date.now(),
        content: content,
        sender: 'AGENT',
        timestamp: new Date().toISOString(),
        is_read: true
      };
      setMessages(prev => [...prev, tempMsg]);

      const response = await fetchWithAuth(`${API_BASE_URL}/api/orders/${orderId}/send_message/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (response.ok) {
        const savedMsg = await response.json();
        setMessages(prev => prev.map(m => m.id === tempMsg.id ? savedMsg : m));
        // El backend pausa el bot al escribir a mano; reflejarlo ya en la UI
        // para que el switch no mienta hasta el siguiente refresco.
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, bot_paused: true } : o));
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  useEffect(() => {
    if (selectedOrderId) {
      loadMessages(selectedOrderId);
      // Polling para mensajes nuevos (temporal hasta implementar WS para mensajes)
      const interval = setInterval(() => loadMessages(selectedOrderId), 3000);
      return () => clearInterval(interval);
    } else {
      setMessages([]);
    }
  }, [selectedOrderId, loadMessages]);

  useEffect(() => {
    if (lastMessage !== null) {
      try {
        const data = JSON.parse(lastMessage.data);
        if (data.type === 'ORDER_UPDATE') {
          const orderData = data.payload;
          setOrders(prev => {
            const exists = prev.find(o => o.id === orderData.id);
            if (exists) {
              return prev.map(o => o.id === orderData.id ? { ...o, ...orderData } : o);
            } else {
              playNotificationSound();
              // Con la pestaña en segundo plano el sonido puede no bastar
              // (equipo silenciado): el aviso del sistema sí llega.
              notifyNewOrder(orderData);
              return [orderData, ...prev];
            }
          });
        }
      } catch (error) {
        console.error('Websocket Error:', error);
      }
    }
  }, [lastMessage]);

  useEffect(() => {
    if (storeId) {
      loadOrders(1, false);
    }
  }, [storeId, loadOrders]);

  // Enlace profundo `/dashboard?order=<uuid>` — lo usa la ficha de cliente
  // para saltar a un pedido concreto. Se consume una sola vez y se limpia de
  // la URL para que un F5 no vuelva a secuestrar la vista.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('order');
    if (!wanted || !orders.some(o => o.id === wanted)) return;
    setSelectedOrderId(wanted);
    setViewMode('chat');
    window.history.replaceState({}, '', window.location.pathname);
  }, [orders]);

  const handleAction = async (orderId, newStatus, { silent = false } = {}) => {
    const prevStatus = orders.find(o => o.id === orderId)?.status;
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/api/orders/${orderId}/update_status/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      // Un 400/500 no lanza excepción: sin este check el update optimista
      // dejaba la tarjeta en un estado que el backend rechazó.
      if (!response.ok) throw new Error(`update_status HTTP ${response.status}`);
      // Toast de deshacer: 6s para revertir un dedazo.
      if (!silent && prevStatus && prevStatus !== newStatus) {
        clearTimeout(undoTimerRef.current);
        setUndoInfo({ orderId, prevStatus, newStatus });
        undoTimerRef.current = setTimeout(() => setUndoInfo(null), 6000);
      }
    } catch (error) {
      console.error('Error updating status:', error);
      loadOrders();
    }
  };

  // Toma de control humana: callar/reactivar el bot en UNA conversación.
  // Mismo patrón que handleAction: optimista + recarga si el backend rechaza.
  const handleToggleBot = async (orderId, paused) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, bot_paused: paused } : o));
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/api/orders/${orderId}/toggle_bot/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused }),
      });
      if (!response.ok) throw new Error(`toggle_bot HTTP ${response.status}`);
    } catch (error) {
      console.error('Error pausando el bot:', error);
      loadOrders(1, false);
    }
  };

  const handleUndo = () => {
    if (!undoInfo) return;
    clearTimeout(undoTimerRef.current);
    handleAction(undoInfo.orderId, undoInfo.prevStatus, { silent: true });
    setUndoInfo(null);
  };

  useEffect(() => () => clearTimeout(undoTimerRef.current), []);

  const selectedOrder = orders.find(o => o.id === selectedOrderId);
  // Orden NEW sin items = contenedor de conversación (charla post-venta), no un
  // pedido real: fuera del Kanban y del contador de pendientes (visible en Chat).
  const isEmptyConversation = (o) => o.status === 'NEW' && !(o.items_count ?? (o.items ? o.items.length : 0));
  // El badge de pendientes ignora los filtros (semántica global).
  const pendingCount = orders.filter(o => !isEmptyConversation(o) && ['NEW', 'WAITING_PAYMENT', 'VERIFYING_PAYMENT'].includes(o.status)).length;

  // Búsqueda + canal + hoy — aplican a Kanban y a la lista del chat.
  const todayStr = new Date().toDateString();
  const matchesFilters = (o) => (
    (!searchQuery ||
      o.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.customer_phone?.includes(searchQuery) ||
      o.id?.toLowerCase().includes(searchQuery.toLowerCase())) &&
    (channelFilter === 'ALL' || o.source === channelFilter) &&
    (!todayOnly || new Date(o.created_at).toDateString() === todayStr)
  );
  const filteredOrders = orders.filter(matchesFilters);
  const kanbanOrders = filteredOrders.filter(o => !isEmptyConversation(o));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t.dashboard.greeting.morning : hour < 19 ? t.dashboard.greeting.afternoon : t.dashboard.greeting.evening;
  const todayCount = orders.filter(o => !isEmptyConversation(o) && new Date(o.created_at).toDateString() === todayStr).length;

  // El color del punto de conexión sale de los roles de estado del tema; el
  // significado (verde=en vivo, ámbar=conectando, rojo=caído) no cambia.
  const connectionStatus = {
    [ReadyState.CONNECTING]: { text: t.dashboard.liveStates.connecting, dot: 'bg-warning', live: false },
    [ReadyState.OPEN]: { text: t.dashboard.liveStates.live, dot: 'bg-success', live: true },
    [ReadyState.CLOSING]: { text: t.dashboard.liveStates.closing, dot: 'bg-warning', live: false },
    [ReadyState.CLOSED]: { text: t.dashboard.liveStates.disconnected, dot: 'bg-danger', live: false },
    [ReadyState.UNINSTANTIATED]: { text: t.dashboard.liveStates.idle, dot: 'bg-outline', live: false },
  }[readyState] || { text: t.dashboard.liveStates.unknown, dot: 'bg-outline', live: false };

  /* Segmented button de M3 para el cambio de vista: dos segmentos unidos con
     borde común, el activo con contenedor tonal y check implícito por color. */
  const headerActions = (
    <div className="flex items-center gap-2">
      {/* Permiso de notificaciones: SIEMPRE desde un clic real. Pedirlo al
          cargar la página lo bloquean los navegadores y es hostil. */}
      {canNotify() && (
        <IconButton
          icon={notifPermission === 'granted' ? Bell : BellOff}
          label={
            notifPermission === 'granted' ? t.dashboard.notify.enabled
              : notifPermission === 'denied' ? t.dashboard.notify.denied
                : t.dashboard.notify.enable
          }
          disabled={notifPermission !== 'default'}
          onClick={async () => setNotifPermission(await requestNotificationPermission())}
        />
      )}
      <div className="flex items-center rounded-shape-xl border border-outline overflow-hidden" role="group" aria-label="Vista">
      {[
        { id: 'kanban', icon: LayoutGrid, label: t.dashboard.views.kanban },
        { id: 'chat', icon: MessagesSquare, label: t.dashboard.views.chat },
      ].map((v, i) => (
        <button
          key={v.id}
          onClick={() => setViewMode(v.id)}
          aria-pressed={viewMode === v.id}
          className={cx(
            'state-layer flex items-center gap-2 h-10 px-4 text-label-lg transition-colors duration-short ease-standard',
            i > 0 && 'border-l border-outline',
            viewMode === v.id
              ? 'bg-secondary-container text-secondary-on-container state-on-secondary-container'
              : 'text-on-surface-variant'
          )}
        >
          <v.icon size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
          <span className="hidden sm:inline">{v.label}</span>
        </button>
      ))}
      </div>
    </div>
  );

  const liveSubtitle = (
    <span className="flex items-center gap-2">
      <span
        className={cx('w-2 h-2 rounded-shape-xl inline-block', connectionStatus.dot, connectionStatus.live && 'animate-pulse')}
        aria-hidden="true"
      />
      <span>{connectionStatus.text}</span>
      {pendingCount > 0 && (
        <span className="text-on-surface-muted">· {pendingCount} {t.dashboard.header.pending}</span>
      )}
    </span>
  );

  return (
    <DashboardLayout
      title={user?.store?.name || 'Pedidos'}
      subtitle={liveSubtitle}
      actions={headerActions}
      pendingCount={pendingCount}
      wide
    >
      {/* Estado de suscripción / trial / cuota */}
      <TrialBanner />

      {/* Saludo contextual */}
      {!loadingOrders && (
        <p className="text-body-lg text-on-surface-variant mb-6 anim-fade-in">
          <span className="text-on-surface">{greeting}{user?.first_name ? `, ${user.first_name}` : ''}.</span>{' '}
          {t.dashboard.greeting.summary.replace('{count}', todayCount)}
        </p>
      )}

      {/* Stats */}
      <StatsCards orders={orders} loading={loadingOrders} />

      {/* Toolbar: búsqueda + filtros de canal + hoy */}
      <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Barra de búsqueda M3: píldora de 56px sobre superficie tonal */}
        <div className="bg-surface-high rounded-shape-xl flex items-center h-14 pl-4 pr-2 flex-1 max-w-md">
          <Search size={ICON.md} strokeWidth={ICON.stroke} className="text-on-surface-variant mr-3 flex-shrink-0" aria-hidden="true" />
          <input
            type="search"
            placeholder={t.dashboard.toolbar.searchPlaceholder}
            onChange={(e) => setSearchQuery(e.target.value)}
            value={searchQuery}
            aria-label={t.dashboard.toolbar.searchPlaceholder}
            className="bg-transparent border-none outline-none text-body-lg text-on-surface w-full h-full min-w-0"
            style={{ boxShadow: 'none' }}
          />
          {searchQuery && (
            <IconButton icon={X} label="Limpiar búsqueda" size="sm" onClick={() => setSearchQuery('')} />
          )}
        </div>
        {/* Chips de filtro M3 */}
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { id: 'ALL', label: t.dashboard.toolbar.all },
            { id: 'WHATSAPP', label: 'WhatsApp' },
            { id: 'TELEGRAM', label: 'Telegram' },
          ].map(ch => (
            <Chip
              key={ch.id}
              selected={channelFilter === ch.id}
              onClick={() => setChannelFilter(ch.id)}
            >
              {ch.label}
            </Chip>
          ))}
          <Chip selected={todayOnly} onClick={() => setTodayOnly(v => !v)}>
            {t.dashboard.toolbar.today}
          </Chip>
        </div>
      </div>

      {/* View Content */}
      <div className="mt-6">
        {viewMode === 'kanban' ? (
          <KanbanView
            orders={kanbanOrders}
            loading={loadingOrders}
            onStatusChange={handleAction}
            onSelectOrder={setSelectedOrderId}
            onPrint={(o) => printTicket(o, user?.store?.name)}
            onViewProof={(o) => { setProofOrder(o); setProofZoom(false); }}
          />
        ) : (
          <div className="bg-surface-low rounded-shape-lg overflow-hidden" style={{ height: 'calc(100vh - 320px)', minHeight: 420 }}>
            <div className="flex h-full">
              {/* Lista de pedidos */}
              <div className={cx('w-full md:w-[360px] border-r border-outline-variant flex flex-col', selectedOrder ? 'hidden md:flex' : 'flex')}>
                <div className="flex-1 overflow-y-auto divide-y divide-outline-variant">
                  {filteredOrders.map(order => (
                    <OrderListItem
                      key={order.id}
                      order={order}
                      onClick={setSelectedOrderId}
                      isSelected={selectedOrderId === order.id}
                    />
                  ))}
                  {filteredOrders.length === 0 && (
                    <EmptyState
                      icon={searchQuery ? Search : MessagesSquare}
                      title={searchQuery ? t.dashboard.list.noResults : t.dashboard.list.noOrders}
                      description={searchQuery
                        ? `No hay pedidos que coincidan con «${searchQuery}».`
                        : undefined}
                      action={searchQuery
                        ? <Button variant="ghost" onClick={() => setSearchQuery('')}>Limpiar búsqueda</Button>
                        : undefined}
                    />
                  )}
                  {hasMoreOrders && !searchQuery && (
                    <div className="p-3">
                      <Button
                        variant="secondary"
                        className="w-full"
                        loading={loadingMoreOrders}
                        onClick={() => loadOrders(currentPage + 1, true)}
                      >
                        {loadingMoreOrders ? t.dashboard.list.loadingMore : t.dashboard.list.loadMore}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              {/* Detalle */}
              <div className={cx('flex-1 flex flex-col min-h-0', !selectedOrder ? 'hidden md:flex' : 'flex')}>
                {selectedOrder && (
                  <div className="md:hidden p-2 flex items-center gap-1 bg-surface-low">
                    <IconButton icon={ArrowLeft} label={t.dashboard.detail.back} onClick={() => setSelectedOrderId(null)} />
                    <span className="text-title text-on-surface">{t.dashboard.detail.back}</span>
                  </div>
                )}
                <OrderDetailView
                  order={selectedOrder}
                  onAction={handleAction}
                  messages={messages}
                  onSendMessage={handleSendMessage}
                  onToggleBot={handleToggleBot}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal para detalle en Kanban */}
      {viewMode === 'kanban' && selectedOrder && (
        <div
          className="fixed inset-0 bg-black/32 z-50 flex items-center justify-center p-4 anim-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedOrderId(null); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={selectedOrder.customer_name || selectedOrder.customer_phone}
            className="bg-surface-high rounded-shape-xl shadow-3 w-full max-w-2xl overflow-hidden flex flex-col anim-scale-up"
            style={{ height: '85vh' }}
          >
            <div className="px-5 py-4 flex items-center justify-between gap-3 flex-shrink-0 bg-surface-high">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={selectedOrder.customer_name} size="md" />
                <div className="min-w-0">
                  <h3 className="text-title-lg text-on-surface truncate">{selectedOrder.customer_name || selectedOrder.customer_phone}</h3>
                  <p className="text-body text-on-surface-variant truncate">
                    {selectedOrder.customer_phone} · {formatCOP(selectedOrder.total_amount)}
                  </p>
                </div>
              </div>
              <IconButton icon={X} label="Cerrar" onClick={() => setSelectedOrderId(null)} />
            </div>
            {/* El chat ocupa todo el alto restante (sin padding que lo colapse) */}
            <div className="flex-1 flex flex-col min-h-0">
              <OrderDetailView
                order={selectedOrder}
                onAction={handleAction}
                messages={messages}
                onSendMessage={handleSendMessage}
                onToggleBot={handleToggleBot}
              />
            </div>
          </div>
        </div>
      )}

      {/* Lightbox de comprobante de pago */}
      {proofOrder && (
        <div
          className="fixed inset-0 bg-black/32 z-[60] flex items-center justify-center p-4 anim-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setProofOrder(null); }}
          role="dialog"
          aria-modal="true"
          aria-label={t.dashboard.proof.title}
        >
          <div className="bg-surface-high rounded-shape-xl shadow-3 w-full max-w-lg max-h-[92vh] flex flex-col anim-scale-up overflow-hidden">
            <div className="px-5 py-3.5 flex items-center justify-between gap-3 flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-title-lg text-on-surface truncate">{t.dashboard.proof.title}</h3>
                <p className="text-body text-on-surface-variant truncate">
                  {proofOrder.customer_name || proofOrder.customer_phone} · {formatCOP(proofOrder.total_amount)}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <a
                  href={proofOrder.payment_proof || proofOrder.payment_proof_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t.dashboard.proof.openOriginal}
                  title={t.dashboard.proof.openOriginal}
                  className="state-layer w-10 h-10 rounded-shape-xl flex items-center justify-center text-on-surface-variant"
                >
                  <ExternalLink size={ICON.sm} strokeWidth={ICON.stroke} />
                </a>
                <IconButton icon={X} label="Cerrar" onClick={() => setProofOrder(null)} />
              </div>
            </div>
            {/* Fondo neutro oscuro fijo: un comprobante puede ser una foto clara
                o un pantallazo oscuro, y debe leerse igual en los 3 temas. */}
            <div className="flex-1 overflow-auto bg-black/90 flex items-center justify-center min-h-[240px]">
              <img
                src={proofOrder.payment_proof || proofOrder.payment_proof_url}
                alt={t.dashboard.proof.title}
                onClick={() => setProofZoom(z => !z)}
                className={cx(
                  'transition-transform duration-medium ease-standard select-none',
                  proofZoom ? 'scale-[1.8] cursor-zoom-out' : 'max-h-[58vh] w-auto cursor-zoom-in'
                )}
              />
            </div>
            <div className="px-5 py-3 flex items-center justify-between gap-3 flex-shrink-0">
              <span className="text-body-sm text-on-surface-muted flex items-center gap-1.5">
                {proofZoom
                  ? <ZoomOut size={ICON.xs} strokeWidth={ICON.stroke} />
                  : <ZoomIn size={ICON.xs} strokeWidth={ICON.stroke} />}
                {t.dashboard.proof.zoomHint}
              </span>
              {['NEW', 'WAITING_PAYMENT', 'VERIFYING_PAYMENT'].includes(proofOrder.status) && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    icon={X}
                    onClick={() => { handleAction(proofOrder.id, 'CANCELLED'); setProofOrder(null); }}
                  >
                    {t.dashboard.proof.reject}
                  </Button>
                  <Button
                    variant="success"
                    size="sm"
                    icon={Check}
                    onClick={() => { handleAction(proofOrder.id, 'CONFIRMED'); setProofOrder(null); }}
                  >
                    {t.dashboard.proof.approve}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast de deshacer cambio de estado */}
      {undoInfo && (
        /* Snackbar de M3: superficie inversa, acción textual a la derecha. */
        <div
          className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-[420px] z-[70] bg-surface-inverse text-on-surface-inverse pl-4 pr-2 min-h-[48px] py-2 rounded-shape-xs shadow-3 flex items-center gap-3 anim-slide-up"
          role="status"
        >
          <span className="text-body flex-1 truncate">
            {t.dashboard.toolbar.statusChanged.replace('{status}', t.dashboard.statuses[undoInfo.newStatus] || undoInfo.newStatus)}
          </span>
          <button
            onClick={handleUndo}
            className="state-layer flex items-center gap-2 h-9 px-3 rounded-shape-xl text-label-lg text-primary flex-shrink-0"
          >
            <RotateCcw size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" />
            {t.dashboard.toolbar.undo}
          </button>
        </div>
      )}
    </DashboardLayout>
  );
}

// --- RUTA PROTEGIDA ---
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-shell" data-theme={localStorage.getItem('dilo_theme_mode') || 'light'}>
        <div className="min-h-screen flex items-center justify-center">
          <div className="flex flex-col items-center gap-6" role="status" aria-live="polite">
            <div className="w-12 h-12 rounded-shape-md bg-brand flex items-center justify-center">
              <span className="text-white text-title-lg">D</span>
            </div>
            <div className="animate-spin w-6 h-6 border-2 border-outline-variant border-t-primary rounded-shape-xl" />
            <span className="sr-only">Cargando</span>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
};

// --- STORE CONFIG WRAPPER ---
// Obtiene el storeId del usuario autenticado dinámicamente
const StoreConfigWrapper = () => {
  const { user } = useAuth();
  const [storeId, setStoreId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStore = async () => {
      try {
        const token = localStorage.getItem('access_token');
        const response = await fetch(`${API_BASE_URL}/api/auth/me/`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.store) {
            setStoreId(data.store.id);
          } else {
            setError('No tienes una tienda configurada');
          }
        } else {
          setError('Error de autenticación');
        }
      } catch (err) {
        setError('Error de conexión');
      } finally {
        setLoading(false);
      }
    };

    fetchStore();
  }, [user]);

  if (loading) {
    return (
      <div className="app-shell" data-theme={localStorage.getItem('dilo_theme_mode') || 'light'}>
        <div className="min-h-screen flex items-center justify-center">
          <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
            <div className="animate-spin w-8 h-8 border-2 border-outline-variant border-t-primary rounded-shape-xl" />
            <span className="text-body text-on-surface-variant">Cargando configuración…</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-shell" data-theme={localStorage.getItem('dilo_theme_mode') || 'light'}>
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="text-center max-w-sm">
            <AlertTriangle size={40} strokeWidth={ICON.stroke} className="mx-auto mb-6 text-danger" aria-hidden="true" />
            <h2 className="text-headline text-on-surface">No se pudo cargar la configuración</h2>
            <p className="text-body-lg text-on-surface-variant mt-2 mb-8">{error}</p>
            <Button onClick={() => { window.location.href = '/dashboard'; }}>
              Volver al panel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <StoreConfig storeId={storeId} />;
};

// --- APP WRAPPER ---
export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <ThemeProvider>
        <Router>
          {/* Banner global de impersonation (soporte viendo como un usuario) */}
          <ImpersonationBanner />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/data-deletion" element={<DataDeletion />} />
            {/* Recuperación de cuenta: se abren desde un enlace de correo, sin
                sesión iniciada. El token de la URL es la única credencial. */}
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/confirm-email" element={<ConfirmEmail />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <OnboardingGate>
                    <Dashboard />
                  </OnboardingGate>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/config"
              element={
                <ProtectedRoute>
                  <StoreConfigWrapper />
                </ProtectedRoute>
              }
            />
            {/* GAP-10: Página de Clientes */}
            <Route
              path="/dashboard/customers"
              element={
                <ProtectedRoute>
                  <CustomersPage />
                </ProtectedRoute>
              }
            />
            {/* Reportes: ventas, más vendidos, embudo y exportación CSV */}
            <Route
              path="/dashboard/reports"
              element={
                <ProtectedRoute>
                  <ReportsPage />
                </ProtectedRoute>
              }
            />
            {/* GAP-12: Perfil de usuario */}
            <Route
              path="/dashboard/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            {/* Paywall: planes y suscripción */}
            <Route
              path="/dashboard/billing"
              element={
                <ProtectedRoute>
                  <BillingPage />
                </ProtectedRoute>
              }
            />
            {/* Pantalla de cocina (KDS) — monitor en cocina, tiempo real */}
            <Route
              path="/dashboard/kitchen"
              element={
                <ProtectedRoute>
                  <KitchenDisplay />
                </ProtectedRoute>
              }
            />
            {/* Panel administrativo interno (equipo DILO). Puerta propia en
                /admin/login — NO pasa por el AuthModal de comercios. StaffGate
                valida el rol contra /api/staff/me/ y decide a dónde sale quien
                no pasa (login del panel si no hay sesión, /dashboard si la hay
                pero sin rol interno). Por eso no llevan ProtectedRoute. */}
            <Route path="/admin/login" element={<StaffLogin />} />
            <Route path="/admin" element={<StaffGate><StaffOverview /></StaffGate>} />
            <Route path="/admin/stores" element={<StaffGate><StaffStores /></StaffGate>} />
            <Route path="/admin/stores/:id" element={<StaffGate><StaffStoreDetail /></StaffGate>} />
            <Route path="/admin/audit" element={<StaffGate><StaffAudit /></StaffGate>} />
            {/* GAP-15: Página 404. Va dentro de `app-shell` con el tema
                guardado, si no aparecía en gris claro fijo aunque el usuario
                tuviera el panel en oscuro. */}
            <Route path="*" element={
              <div className="app-shell" data-theme={localStorage.getItem('dilo_theme_mode') || 'light'}>
                <div className="min-h-screen flex items-center justify-center px-6">
                  <div className="text-center anim-fade-up max-w-sm">
                    <Compass size={40} strokeWidth={ICON.stroke} className="mx-auto mb-6 text-on-surface-muted" aria-hidden="true" />
                    <h1 className="text-headline text-on-surface">Página no encontrada</h1>
                    <p className="text-body-lg text-on-surface-variant mt-2 mb-8">
                      La ruta que buscas no existe o fue movida.
                    </p>
                    <a
                      href="/"
                      className="state-layer state-on-primary inline-flex items-center justify-center h-10 px-6 rounded-shape-xl bg-primary text-primary-on text-label-lg"
                    >
                      Volver al inicio
                    </a>
                  </div>
                </div>
              </div>
            } />
          </Routes>
        </Router>
        </ThemeProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
