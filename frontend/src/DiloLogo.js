import React from 'react';

// ============================================================
// Logo DILO — 100% código (SVG). La "O" es una burbuja de chat.
// Compartido entre landing, auth y dashboard.
//
// Es MARCA, no interfaz: el naranja y el peso 900 del wordmark son fijos a
// propósito y no siguen el acento que elige cada comercio (si una tienda pone
// su acento en verde, el logo de DILO sigue siendo el de DILO). Los valores
// viven en tokens.css como `--logo-*` para que no haya hex sueltos en el JSX.
// ============================================================

// El default sigue siendo blanco: lo usa el AuthModal sobre su panel oscuro,
// que está fuera de este rediseño. El panel pasa `color="currentColor"`.
const DiloLogo = ({ height = 30, color = '#FFFFFF' }) => (
    <span className="inline-flex items-center" style={{ height }}>
        <span
            className="tracking-tight"
            style={{ fontSize: height * 0.92, lineHeight: 1, color, letterSpacing: '-0.04em', fontWeight: 900 }}
        >
            DIL
        </span>
        <svg
            width={height}
            height={height}
            viewBox="0 0 40 40"
            fill="none"
            style={{ marginLeft: height * 0.04 }}
            aria-label="O"
        >
            {/* Burbuja de chat naranja como la letra O */}
            <path
                d="M20 4C10.6 4 3 10.9 3 19.4c0 3.9 1.6 7.5 4.3 10.2-.3 2.4-1.1 4.5-2.4 6.1-.5.6-.1 1.5.7 1.4 3.3-.3 5.9-1.5 7.8-2.8 2 .7 4.2 1.1 6.6 1.1 9.4 0 17-6.9 17-15.4S29.4 4 20 4Z"
                fill="var(--logo-orange)"
            />
            {/* Tres puntos de "escribiendo" */}
            <circle cx="13" cy="19" r="2.4" fill="var(--logo-dots)" />
            <circle cx="20" cy="19" r="2.4" fill="var(--logo-dots)" />
            <circle cx="27" cy="19" r="2.4" fill="var(--logo-dots)" />
        </svg>
    </span>
);

export default DiloLogo;
