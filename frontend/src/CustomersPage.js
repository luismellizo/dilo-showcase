import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Phone, Mail, Users, AlertCircle, SearchX, X, MapPin, ShoppingBag,
} from 'lucide-react';
import { useAuth } from './AuthContext';
import DashboardLayout from './DashboardLayout';
import {
  Avatar, Badge, Button, Divider, EmptyState, IconButton, Modal, Skeleton, ICON, cx,
} from './ui';
import { API_BASE_URL, formatCOP } from './config';

/* Estados que ya son venta cerrada — mismo criterio que StatsCards y el
   reporte; con tres tablas distintas de estados nadie sabe qué es un pedido. */
const ORDER_TONES = {
  CONFIRMED: 'green',
  COMPLETED: 'green',
  DELIVERED: 'green',
  CANCELLED: 'red',
  WAITING_PAYMENT: 'amber',
  VERIFYING_PAYMENT: 'amber',
  NEW: 'neutral',
};

/* Ficha del cliente: quién es, dónde vive y qué ha pedido. Antes la página
   solo listaba nombre, teléfono y un contador — no se podía abrir a nadie. */
const CustomerDetail = ({ customer, onClose }) => {
  const { fetchWithAuth } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!customer) return;
    try {
      setLoading(true);
      setError(false);
      const res = await fetchWithAuth(`${API_BASE_URL}/api/customers/${customer.id}/orders/`);
      if (!res.ok) throw new Error(`orders HTTP ${res.status}`);
      const data = await res.json();
      setOrders(data.results || data);
    } catch (err) {
      console.error('Error cargando historial del cliente:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [customer, fetchWithAuth]);

  useEffect(() => { load(); }, [load]);

  if (!customer) return null;

  const rows = [
    { icon: Phone, label: 'Teléfono', value: customer.phone || 'Sin teléfono' },
    { icon: MapPin, label: 'Dirección habitual', value: customer.default_address || 'Sin dirección guardada' },
  ];

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" title={customer.name || 'Cliente sin nombre'}>
      <div className="flex items-center gap-4 mb-6">
        <Avatar name={customer.name} size="xl" icon={Users} />
        <div className="min-w-0">
          <Badge tone={customer.channel_type === 'TELEGRAM' ? 'blue' : 'green'}>
            {customer.channel_type === 'TELEGRAM' ? 'Telegram' : 'WhatsApp'}
          </Badge>
          <p className="text-body-sm text-on-surface-muted mt-2">
            Cliente desde {new Date(customer.first_contact_at).toLocaleDateString('es-CO')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-shape-md bg-surface-low p-4">
          <div className="text-title-lg text-on-surface tabular-nums">
            {formatCOP(customer.total_spent || 0)}
          </div>
          <div className="text-body-sm text-on-surface-variant mt-1">Total gastado</div>
        </div>
        <div className="rounded-shape-md bg-surface-low p-4">
          <div className="text-title-lg text-on-surface tabular-nums">{customer.order_count || 0}</div>
          <div className="text-body-sm text-on-surface-variant mt-1">Pedidos</div>
        </div>
      </div>

      <div className="space-y-3 mb-6">
        {rows.map(r => (
          <div key={r.label} className="flex items-start gap-3">
            <r.icon size={ICON.xs} strokeWidth={ICON.stroke} className="text-on-surface-variant mt-1 flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-body-sm text-on-surface-muted">{r.label}</p>
              <p className="text-body text-on-surface break-words">{r.value}</p>
            </div>
          </div>
        ))}
      </div>

      <h4 className="text-title text-on-surface mb-2">Historial de pedidos</h4>
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertCircle}
          size="compact"
          title="No se pudo cargar el historial"
          action={<Button variant="secondary" onClick={load}>Reintentar</Button>}
        />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          size="compact"
          title="Sin pedidos todavía"
          description="Este cliente escribió pero aún no cerró una compra."
        />
      ) : (
        <div>
          {orders.map((o, i) => (
            <React.Fragment key={o.id}>
              {i > 0 && <Divider />}
              <button
                onClick={() => navigate(`/dashboard?order=${o.id}`)}
                className="state-layer w-full flex items-center justify-between gap-3 min-h-[56px] px-2 rounded-shape-sm text-left"
              >
                <div className="min-w-0">
                  <p className="text-body text-on-surface">
                    {new Date(o.created_at).toLocaleDateString('es-CO', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}
                  </p>
                  <p className="text-body-sm text-on-surface-muted">
                    {o.items_count || 0} productos
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-body text-on-surface tabular-nums">
                    {formatCOP(o.total_amount)}
                  </span>
                  <Badge tone={ORDER_TONES[o.status] || 'neutral'}>{o.status_display}</Badge>
                </div>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </Modal>
  );
};

/**
 * Página de Clientes - GAP-10
 * Lista todos los clientes únicos que han hecho pedidos.
 *
 * Visual (M3): barra de búsqueda de 56px + lista de densidad estándar
 * (filas de 72px, avatar, dos líneas de texto, métrica a la derecha y
 * divisores de 1px). El título de la página lo pinta DashboardLayout.
 */
const CustomersPage = () => {
  const { user, fetchWithAuth } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const storeId = user?.store?.id;

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      const response = await fetchWithAuth(`${API_BASE_URL}/api/customers/?store_id=${storeId}`);

      if (response.ok) {
        const data = await response.json();
        setCustomers(data.results || data);
      } else {
        setError(true);
      }
    } catch (err) {
      console.error('Error loading customers:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, storeId]);

  useEffect(() => {
    if (storeId) {
      loadCustomers();
    }
  }, [storeId, loadCustomers]);

  const filteredCustomers = customers.filter(c =>
    !searchQuery ||
    c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone?.includes(searchQuery)
  );

  return (
    <DashboardLayout
      title="Clientes"
      subtitle={loading ? 'Cargando…' : `${customers.length} clientes registrados`}
    >
      {/* Barra de búsqueda M3 (56px, píldora). El fondo va en el contenedor y
          en el input a la vez: los controles del panel llevan su superficie
          impuesta por index.css, así que un input transparente aquí se vería
          como un parche de otro tono. */}
      <div className="flex items-center gap-2 h-14 pl-4 pr-2 rounded-shape-xl bg-surface-highest mb-6 max-w-md">
        <Search
          size={ICON.sm}
          strokeWidth={ICON.stroke}
          className="text-on-surface-variant flex-shrink-0"
          aria-hidden="true"
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar por nombre o teléfono..."
          aria-label="Buscar clientes"
          className="flex-1 min-w-0 h-full border-none outline-none text-body-lg bg-surface-highest"
        />
        {searchQuery && (
          <IconButton
            icon={X}
            label="Limpiar búsqueda"
            size="sm"
            onClick={() => setSearchQuery('')}
          />
        )}
      </div>

      {loading ? (
        <div className="bg-surface-low rounded-shape-lg overflow-hidden">
          {[0, 1, 2, 3, 4].map(i => (
            <React.Fragment key={i}>
              {i > 0 && <Divider className="ml-20" />}
              <div className="flex items-center gap-4 px-4 min-h-[72px]">
                <Skeleton className="w-12 h-12 rounded-shape-xl flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
                <Skeleton className="h-6 w-8" />
              </div>
            </React.Fragment>
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertCircle}
          title="No se pudieron cargar los clientes"
          description="Revisa tu conexión e inténtalo de nuevo."
          action={<Button variant="secondary" onClick={loadCustomers}>Reintentar</Button>}
        />
      ) : customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Sin clientes todavía"
          description="Los clientes aparecerán aquí automáticamente cuando hagan su primer pedido por WhatsApp o Telegram."
        />
      ) : filteredCustomers.length === 0 ? (
        /* Hay clientes, pero la búsqueda no encontró ninguno: es un estado
           distinto del vacío general y pide una salida distinta (limpiar). */
        <EmptyState
          icon={SearchX}
          title={`Sin resultados para «${searchQuery}»`}
          description="Prueba con otro nombre o con el teléfono completo."
          action={<Button variant="secondary" onClick={() => setSearchQuery('')}>Limpiar búsqueda</Button>}
        />
      ) : (
        <div className="bg-surface-low rounded-shape-lg overflow-hidden anim-fade-up">
          {filteredCustomers.map((customer, i) => (
            <React.Fragment key={customer.id}>
              {i > 0 && <Divider className="ml-20" />}
              <button
                onClick={() => setSelected(customer)}
                aria-label={`Ver ficha de ${customer.name || 'cliente sin nombre'}`}
                className="state-layer w-full text-left flex items-center justify-between gap-4 px-4 min-h-[72px]"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <Avatar name={customer.name} size="lg" icon={Users} />
                  <div className="min-w-0">
                    <h3 className="text-body-lg text-on-surface truncate">
                      {customer.name || 'Cliente sin nombre'}
                    </h3>
                    <div className="flex items-center gap-4 text-body text-on-surface-variant mt-0.5">
                      <span className="flex items-center gap-1.5">
                        <Phone size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" />
                        {customer.phone || 'Sin teléfono'}
                      </span>
                      {customer.email && (
                        <span className={cx('hidden sm:flex items-center gap-1.5 truncate')}>
                          <Mail size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" />
                          {customer.email}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-title-lg text-on-surface tabular-nums">
                    {customer.order_count || 0}
                  </div>
                  <div className="text-body-sm text-on-surface-variant">pedidos</div>
                </div>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {selected && <CustomerDetail customer={selected} onClose={() => setSelected(null)} />}
    </DashboardLayout>
  );
};

export default CustomersPage;
