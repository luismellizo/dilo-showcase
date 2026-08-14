import React from 'react';
import { useTheme } from './ThemeContext';

/**
 * Fondo decorativo del panel: patrón sutil de vectores según el rubro del
 * negocio (comida / bebidas / tienda). El motivo lo elige el dueño en
 * Config → Tienda (ThemeContext.backdrop). Tinta vía --backdrop-ink
 * (oscura en tema claro, blanca en oscuros).
 */

const FoodPattern = () => (
  <g fill="var(--backdrop-ink)">
    {/* Hamburguesa */}
    <g transform="translate(52 56) rotate(-10)">
      <path d="M-20 -2 q0 -15 20 -15 q20 0 20 15 z" />
      <rect x="-20" y="0" width="40" height="5" rx="2.5" />
      <rect x="-18" y="7" width="36" height="4" rx="2" />
      <path d="M-20 13 q0 9 20 9 q20 0 20 -9 z" />
    </g>

    {/* Porción de pizza */}
    <g transform="translate(214 46) rotate(12)">
      <path d="M0 -23 L17 14 Q0 23 -17 14 Z" />
    </g>

    {/* Papas fritas */}
    <g transform="translate(132 142) rotate(-6)">
      <path d="M-12 0 L12 0 L9 22 L-9 22 Z" />
      <rect x="-10" y="-14" width="3" height="16" rx="1.5" />
      <rect x="-4" y="-18" width="3" height="20" rx="1.5" />
      <rect x="2" y="-15" width="3" height="17" rx="1.5" />
      <rect x="8" y="-12" width="3" height="14" rx="1.5" />
    </g>

    {/* Vaso de bebida */}
    <g transform="translate(252 178) rotate(8)">
      <path d="M-11 -16 L11 -16 L8 18 L-8 18 Z" />
      <rect x="-13" y="-19" width="26" height="4" rx="2" />
      <rect x="2" y="-30" width="3" height="15" rx="1.5" transform="rotate(12 3 -22)" />
    </g>

    {/* Dona (anillo) */}
    <g transform="translate(56 206)">
      <path fillRule="evenodd" d="M-16 0 a16 16 0 1 0 32 0 a16 16 0 1 0 -32 0 M-6 0 a6 6 0 1 1 12 0 a6 6 0 1 1 -12 0" />
    </g>

    {/* Helado en cono */}
    <g transform="translate(206 256) rotate(-14)">
      <path d="M-10 -5 L10 -5 L0 17 Z" />
      <circle cx="-3" cy="-11" r="8" />
      <circle cx="5" cy="-11" r="8" />
    </g>
  </g>
);

const DrinksPattern = () => (
  <g fill="var(--backdrop-ink)">
    {/* Copa de cóctel */}
    <g transform="translate(52 56) rotate(-8)">
      <path d="M-18 -18 L18 -18 L0 4 Z" />
      <rect x="-1.5" y="4" width="3" height="14" rx="1.5" />
      <rect x="-9" y="18" width="18" height="3" rx="1.5" />
      <circle cx="9" cy="-24" r="4" />
      <rect x="4" y="-30" width="2" height="14" rx="1" transform="rotate(24 5 -23)" />
    </g>

    {/* Jarra de cerveza */}
    <g transform="translate(214 48) rotate(6)">
      <rect x="-12" y="-14" width="24" height="32" rx="3" />
      <path fillRule="evenodd" d="M12 -6 h6 a4 4 0 0 1 4 4 v8 a4 4 0 0 1 -4 4 h-6 v-4 h5 a1.5 1.5 0 0 0 1.5 -1.5 v-5 a1.5 1.5 0 0 0 -1.5 -1.5 h-5 z" />
      <circle cx="-6" cy="-17" r="4.5" />
      <circle cx="2" cy="-19" r="5" />
      <circle cx="9" cy="-16" r="4" />
    </g>

    {/* Taza de café con vapor */}
    <g transform="translate(130 144) rotate(-4)">
      <path d="M-14 -6 h28 v14 a10 10 0 0 1 -10 10 h-8 a10 10 0 0 1 -10 -10 z" />
      <path fillRule="evenodd" d="M14 -2 h5 a5 5 0 0 1 5 5 v2 a5 5 0 0 1 -5 5 h-5 v-4 h4 a1.5 1.5 0 0 0 1.5 -1.5 v-1 a1.5 1.5 0 0 0 -1.5 -1.5 h-4 z" />
      <path d="M-6 -20 q3 4 0 8 q-3 4 0 8 l3 0 q-3 -4 0 -8 q3 -4 0 -8 z" />
      <path d="M4 -20 q3 4 0 8 q-3 4 0 8 l3 0 q-3 -4 0 -8 q3 -4 0 -8 z" />
    </g>

    {/* Botella */}
    <g transform="translate(252 180) rotate(10)">
      <path d="M-4 -26 h8 v8 q8 4 8 14 v18 a4 4 0 0 1 -4 4 h-16 a4 4 0 0 1 -4 -4 v-18 q8 -10 8 -14 z" />
      <rect x="-5" y="-30" width="10" height="3" rx="1.5" />
    </g>

    {/* Copa de vino */}
    <g transform="translate(56 208)">
      <path d="M-11 -20 h22 q0 16 -9 18 l0 12 h7 a1.5 1.5 0 0 1 0 3 h-18 a1.5 1.5 0 0 1 0 -3 h7 l0 -12 q-9 -2 -9 -18 z" />
    </g>

    {/* Vaso con pitillo (jugo/boba) */}
    <g transform="translate(206 258) rotate(-12)">
      <path d="M-11 -14 L11 -14 L8 18 L-8 18 Z" />
      <rect x="-13" y="-17" width="26" height="4" rx="2" />
      <rect x="1" y="-30" width="3" height="16" rx="1.5" transform="rotate(14 2.5 -22)" />
      <circle cx="-3" cy="10" r="2" />
      <circle cx="3" cy="6" r="2" />
      <circle cx="-1" cy="1" r="2" />
    </g>
  </g>
);

const RetailPattern = () => (
  <g fill="var(--backdrop-ink)">
    {/* Bolsa de compras */}
    <g transform="translate(52 56) rotate(-8)">
      <path fillRule="evenodd" d="M-15 -8 h30 l3 28 a4 4 0 0 1 -4 4 h-28 a4 4 0 0 1 -4 -4 z M-8 -8 v-4 a8 8 0 0 1 16 0 v4 h-4 v-4 a4 4 0 0 0 -8 0 v4 z" />
    </g>

    {/* Etiqueta de precio */}
    <g transform="translate(214 48) rotate(18)">
      <path fillRule="evenodd" d="M-18 -10 L2 -10 L18 6 a4 4 0 0 1 0 5.6 L7.6 22 a4 4 0 0 1 -5.6 0 L-18 -2 z M-8 -2 a4 4 0 1 0 0.01 0" />
    </g>

    {/* Caja / paquete */}
    <g transform="translate(130 144) rotate(-4)">
      <path fillRule="evenodd" d="M-16 -12 h32 v28 a3 3 0 0 1 -3 3 h-26 a3 3 0 0 1 -3 -3 z M-3 -12 h6 v10 l-3 -3 -3 3 z" />
      <rect x="-18" y="-16" width="36" height="5" rx="2" />
    </g>

    {/* Camiseta (ropa) */}
    <g transform="translate(252 180) rotate(8)">
      <path d="M-8 -18 q8 6 16 0 l10 8 -5 7 -4 -3 v22 a3 3 0 0 1 -3 3 h-12 a3 3 0 0 1 -3 -3 v-22 l-4 3 -5 -7 z" />
    </g>

    {/* Carrito de compras */}
    <g transform="translate(56 208)">
      <path d="M-18 -14 h5 l2 5 h26 a2.5 2.5 0 0 1 2.4 3.2 l-4 13 a3 3 0 0 1 -2.9 2.2 h-17 a3 3 0 0 1 -2.9 -2.2 l-5.4 -17.2 h-3.2 a2 2 0 0 1 0 -4 z" />
      <circle cx="-4" cy="16" r="3.5" />
      <circle cx="10" cy="16" r="3.5" />
    </g>

    {/* Regalo */}
    <g transform="translate(206 258) rotate(-10)">
      <rect x="-14" y="-4" width="28" height="22" rx="3" />
      <rect x="-16" y="-12" width="32" height="7" rx="2" />
      <path d="M0 -14 q-8 -8 -12 -3 q-3 4 6 5 z" />
      <path d="M0 -14 q8 -8 12 -3 q3 4 -6 5 z" />
    </g>
  </g>
);

const PATTERNS = { food: FoodPattern, drinks: DrinksPattern, retail: RetailPattern };

export default function FoodBackdrop({ inline = false }) {
  const { backdrop } = useTheme();
  if (backdrop === 'none') return null;
  const Pattern = PATTERNS[backdrop] || FoodPattern;
  // id único por motivo (+ variante inline) — evita colisión de <pattern> si
  // conviven dos shells (ej. preview del onboarding sobre el panel real).
  const patternId = `dilo-bg-${backdrop || 'food'}${inline ? '-inline' : ''}`;

  return (
    <div
      className={`${inline ? 'absolute' : 'fixed'} inset-0 pointer-events-none`}
      style={{ zIndex: 0 }} aria-hidden="true">
      <svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id={patternId} width="300" height="300" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
            <Pattern />
          </pattern>
        </defs>
        {/* La opacidad va por `style` y no por atributo: un atributo de
            presentación SVG no resuelve `var()`. */}
        <rect width="100%" height="100%" fill={`url(#${patternId})`} style={{ opacity: 'var(--backdrop-opacity)' }} />
      </svg>
    </div>
  );
}
