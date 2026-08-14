// Banner de estado de suscripción para el dashboard.
// Se alimenta de user.subscription (viene en /api/auth/me/). Muestra:
//  - trial restante (TRIALING)
//  - cuota casi/totalmente agotada
//  - plan vencido (PAST_DUE)
// Sin nada urgente → no renderiza.
//
// Visual (M3): tarjeta sobre superficie normal con el ICONO en el rol de
// urgencia, igual que la fila de "recomendaciones de seguridad" de las apps de
// Google. Un contenedor tonal a lo ancho (la barra mostaza que había antes)
// grita más que el propio panel y se lee como error incluso cuando solo dice
// "te quedan 5 días". El color va donde señala, no donde llena.
// El aviso de dinero perdido (PAST_DUE / cuota agotada) SÍ usa contenedor
// tonal: ahí el volumen está justificado.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Zap } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Button, ICON, cx } from './ui';

export default function TrialBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const sub = user?.subscription;
  if (!sub) return null;

  const limit = sub.conversation_limit;          // null = ilimitado
  const used = sub.conversations_used || 0;
  const status = sub.status;
  const trialLeft = sub.trial_days_left;

  // Cuánto de la cuota se consumió (0..1) cuando hay límite.
  const ratio = limit ? used / limit : 0;
  const quotaExhausted = limit != null && used >= limit;
  const quotaNear = limit != null && ratio >= 0.8 && !quotaExhausted;

  let tone = null; // {cls, iconCls, icon, msg, cta}

  if (status === 'PAST_DUE') {
    tone = {
      cls: 'bg-danger-container text-danger-on-container',
      iconCls: 'text-danger-on-container',
      ctaCls: 'text-danger-on-container',
      icon: AlertTriangle,
      msg: 'Tu plan venció. Estás operando con el límite gratis. Renueva para recuperar tu plan.',
      cta: 'Renovar plan',
    };
  } else if (quotaExhausted) {
    tone = {
      cls: 'bg-danger-container text-danger-on-container',
      iconCls: 'text-danger-on-container',
      ctaCls: 'text-danger-on-container',
      icon: AlertTriangle,
      msg: `Agotaste tus ${limit} conversaciones del mes. El bot deja de atender clientes nuevos hasta renovar.`,
      cta: 'Mejorar plan',
    };
  } else if (status === 'TRIALING' && trialLeft != null) {
    tone = {
      cls: 'bg-surface-low text-on-surface',
      iconCls: 'text-warning',
      icon: Clock,
      msg: trialLeft <= 0
        ? 'Tu prueba gratis termina hoy. Activa un plan para no perder el servicio.'
        : `Prueba gratis: te quedan ${trialLeft} día${trialLeft === 1 ? '' : 's'}.`,
      cta: 'Ver planes',
    };
  } else if (quotaNear) {
    tone = {
      cls: 'bg-surface-low text-on-surface',
      iconCls: 'text-warning',
      icon: Zap,
      msg: `Llevas ${used} de ${limit} conversaciones este mes (${Math.round(ratio * 100)}%).`,
      cta: 'Mejorar plan',
    };
  }

  if (!tone) return null;
  const Icon = tone.icon;

  return (
    <div
      role="status"
      className={cx(
        'mb-6 flex items-center justify-between gap-4 rounded-shape-lg px-4 py-4 anim-fade-up',
        tone.cls
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Icon
          size={ICON.sm}
          strokeWidth={ICON.stroke}
          className={cx('flex-shrink-0', tone.iconCls)}
          aria-hidden="true"
        />
        <span className="text-body">{tone.msg}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate('/dashboard/billing')}
        /* En las variantes sobre superficie normal el CTA conserva el color
           `primary` del botón de texto; solo en contenedor tonal hay que
           forzar el color de contenido para que contraste. */
        className={cx('flex-shrink-0', tone.ctaCls)}
      >
        {tone.cta}
      </Button>
    </div>
  );
}
