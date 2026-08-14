// Paywall del dashboard: planes + uso de la suscripción actual.
// Cobro recurrente automático aún no existe (Fase A4) → la mejora de plan se
// gestiona manual (Nequi/transferencia + activación por soporte). El CTA abre
// instrucciones de pago. Datos: /api/billing/plans/ + user.subscription (/me).
//
// Visual (M3): tarjetas llenas sobre `surface-low`, sin sombra ni elevación al
// pasar el mouse. El plan actual se marca con borde `primary` + Badge EN FLUJO
// (el badge flotante `-top-3` es el sello de las tablas de precios genéricas).
import React, { useEffect, useState } from 'react';
import { Check, Crown, MessageSquare } from 'lucide-react';
import { useAuth } from './AuthContext';
import DashboardLayout from './DashboardLayout';
import { Badge, Button, Card, ProgressBar, Skeleton, ICON, cx } from './ui';
import { API_BASE_URL, formatCOP } from './config';

const SUPPORT_WA = 'https://wa.me/573000000000?text=Quiero%20mejorar%20mi%20plan%20DILO';

const STATUS_META = {
  TRIALING: { label: 'En prueba', tone: 'amber' },
  ACTIVE: { label: 'Activo', tone: 'green' },
  PAST_DUE: { label: 'Vencido', tone: 'red' },
  CANCELED: { label: 'Cancelado', tone: 'neutral' },
};

export default function BillingPage() {
  const { user } = useAuth();
  const sub = user?.subscription || null;

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE_URL}/api/billing/plans/`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (alive) setPlans(Array.isArray(data) ? data : (data.results || [])); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const currentCode = sub?.plan?.code;
  const limit = sub?.conversation_limit;
  const used = sub?.conversations_used || 0;
  const ratio = limit ? Math.min(1, used / limit) : 0;
  const statusMeta = STATUS_META[sub?.status] || { label: sub?.status, tone: 'neutral' };
  // El color de la barra es semántico, no decorativo: rojo solo cuando el bot
  // ya dejó de atender clientes nuevos.
  const usageTone = ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'primary';

  return (
    <DashboardLayout title="Plan y facturación" subtitle="Gestiona el plan de tu tienda y revisa tu consumo">
      {/* Estado actual */}
      {sub && (
        <Card className="p-6 mb-8 anim-fade-up">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-body text-on-surface-variant">Plan actual</div>
              <div className="text-title-lg text-on-surface mt-0.5">{sub.plan?.name}</div>
            </div>
            <Badge tone={statusMeta.tone} dot>
              {statusMeta.label}
              {sub.status === 'TRIALING' && sub.trial_days_left != null
                ? ` · ${sub.trial_days_left}d restantes` : ''}
            </Badge>
          </div>

          {/* Uso de conversaciones */}
          <div className="mt-6">
            <div className="flex justify-between items-baseline text-body text-on-surface-variant mb-2">
              <span className="flex items-center gap-2">
                <MessageSquare size={ICON.xs} strokeWidth={ICON.stroke} aria-hidden="true" />
                Conversaciones este mes
              </span>
              <span className="text-on-surface tabular-nums">
                {used}{limit != null ? ` / ${limit}` : ' · ilimitado'}
              </span>
            </div>
            {limit != null && (
              <ProgressBar
                value={ratio}
                tone={usageTone}
                thick
                label={`${used} de ${limit} conversaciones usadas`}
              />
            )}
          </div>
        </Card>
      )}

      {/* Planes */}
      {loading ? (
        <div className="grid gap-6 md:grid-cols-3">
          {[0, 1, 2].map(i => (
            <Card key={i} className="p-6">
              <Skeleton className="h-5 w-24 mb-3" />
              <Skeleton className="h-9 w-32 mb-4" />
              <Skeleton className="h-3 w-full mb-2" />
              <Skeleton className="h-3 w-4/5 mb-2" />
              <Skeleton className="h-3 w-3/5 mb-6" />
              <Skeleton className="h-10 w-full rounded-shape-xl" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((p, i) => {
            const isCurrent = p.code === currentCode;
            const isPaid = p.price_cop > 0;
            return (
              <div
                key={p.code}
                className={cx(
                  'bg-surface-low rounded-shape-lg p-6 flex flex-col anim-fade-up',
                  isCurrent ? 'border-2 border-primary' : 'border border-outline-variant'
                )}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {isPaid && (
                    <Crown size={ICON.sm} strokeWidth={ICON.stroke} className="text-primary" aria-hidden="true" />
                  )}
                  <h3 className="text-title-lg text-on-surface">{p.name}</h3>
                  {isCurrent && <Badge tone="accent">Tu plan</Badge>}
                </div>

                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-headline text-on-surface tabular-nums">{formatCOP(p.price_cop)}</span>
                  <span className="text-body text-on-surface-variant">/mes</span>
                </div>

                <div className="text-body text-on-surface-variant mt-1 mb-6">
                  {p.conversation_limit != null
                    ? `${p.conversation_limit.toLocaleString('es-CO')} conversaciones/mes`
                    : 'Conversaciones ilimitadas'}
                </div>

                <ul className="space-y-3 mb-6 flex-1">
                  {(p.features || []).map((f, j) => (
                    <li key={j} className="flex items-start gap-3 text-body text-on-surface-variant">
                      <Check
                        size={ICON.sm}
                        strokeWidth={ICON.stroke}
                        className="text-primary flex-shrink-0"
                        aria-hidden="true"
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <Button variant="secondary" disabled className="w-full">Plan activo</Button>
                ) : isPaid ? (
                  /* Sigue siendo un enlace: abre WhatsApp de soporte en otra
                     pestaña. Se le da el aspecto de un botón lleno de M3. */
                  <a
                    href={SUPPORT_WA}
                    target="_blank"
                    rel="noreferrer"
                    className={cx(
                      'state-layer state-on-primary inline-flex items-center justify-center w-full h-10 px-6',
                      'rounded-shape-xl bg-primary text-primary-on text-label-lg',
                      'transition-colors duration-short ease-standard'
                    )}
                  >
                    Mejorar a este plan
                  </a>
                ) : (
                  <Button variant="secondary" disabled className="w-full">Plan gratis</Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-center text-body-sm text-on-surface-variant mt-8">
        El cobro se gestiona por Nequi o transferencia. Al mejorar tu plan, soporte lo
        activa en minutos. Pronto: pago automático con tarjeta.
      </p>
    </DashboardLayout>
  );
}
