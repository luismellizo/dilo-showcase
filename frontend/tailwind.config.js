/** @type {import('tailwindcss').Config} */

/* Los valores viven en `src/tokens.css`. Aquí solo se exponen como utilidades
   de Tailwind para poder escribir `bg-surface-container`, `rounded-lg`,
   `text-title` en el JSX sin volver a un hex.
   Regla: si algo no está aquí ni en tokens.css, no se usa. */
module.exports = {
    content: [
        "./src/**/*.{js,jsx,ts,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                /* acento crudo de la tienda — logo y adornos, nunca texto */
                brand: 'var(--brand)',
                accent: 'var(--accent)',
                'accent-soft': 'var(--accent-soft)',

                /* superficies */
                surface: {
                    DEFAULT: 'var(--surface)',
                    dim: 'var(--surface-dim)',
                    bright: 'var(--surface-bright)',
                    lowest: 'var(--surface-container-lowest)',
                    low: 'var(--surface-container-low)',
                    container: 'var(--surface-container)',
                    high: 'var(--surface-container-high)',
                    highest: 'var(--surface-container-highest)',
                    inverse: 'var(--inverse-surface)',
                },

                /* contenido */
                'on-surface': 'var(--on-surface)',
                'on-surface-variant': 'var(--on-surface-variant)',
                'on-surface-muted': 'var(--on-surface-muted)',
                'on-surface-inverse': 'var(--inverse-on-surface)',

                /* bordes */
                outline: {
                    DEFAULT: 'var(--outline)',
                    variant: 'var(--outline-variant)',
                },

                /* roles de acción */
                primary: {
                    DEFAULT: 'var(--primary)',
                    on: 'var(--on-primary)',
                    container: 'var(--primary-container)',
                    'on-container': 'var(--on-primary-container)',
                },
                secondary: {
                    container: 'var(--secondary-container)',
                    'on-container': 'var(--on-secondary-container)',
                },

                /* roles de estado */
                success: {
                    DEFAULT: 'var(--success)',
                    on: 'var(--on-success)',
                    container: 'var(--success-container)',
                    'on-container': 'var(--on-success-container)',
                },
                warning: {
                    DEFAULT: 'var(--warning)',
                    on: 'var(--on-warning)',
                    container: 'var(--warning-container)',
                    'on-container': 'var(--on-warning-container)',
                },
                danger: {
                    DEFAULT: 'var(--error)',
                    on: 'var(--on-error)',
                    container: 'var(--error-container)',
                    'on-container': 'var(--on-error-container)',
                },
                info: {
                    DEFAULT: 'var(--info)',
                    on: 'var(--on-info)',
                    container: 'var(--info-container)',
                    'on-container': 'var(--on-info-container)',
                },
            },

            /* Escala de forma M3. Se asigna por categoría de componente:
               xs indicadores · sm chips · md campos/menús · lg tarjetas ·
               xl diálogos · full botones, píldoras y avatares.
               Prefijo `shape-` a propósito: sobrescribir `rounded-lg`/`xl` de
               Tailwind reformaría en silencio 14.000 líneas de código antiguo.
               Los componentes se migran a `rounded-shape-*` loop a loop. */
            borderRadius: {
                'shape-xs': 'var(--shape-xs)',
                'shape-sm': 'var(--shape-sm)',
                'shape-md': 'var(--shape-md)',
                'shape-lg': 'var(--shape-lg)',
                'shape-xl': 'var(--shape-xl)',
            },

            fontFamily: {
                sans: ['Roboto Flex', 'Roboto', 'Helvetica Neue', 'system-ui', 'sans-serif'],
            },

            /* Escala tipográfica corta: tamaño + interlineado + peso van juntos,
               para que no se pueda usar un tamaño con el peso equivocado. */
            fontSize: {
                display: ['var(--type-display-size)', { lineHeight: 'var(--type-display-line)', fontWeight: 'var(--type-display-weight)' }],
                headline: ['var(--type-headline-size)', { lineHeight: 'var(--type-headline-line)', fontWeight: 'var(--type-headline-weight)' }],
                'title-lg': ['var(--type-title-lg-size)', { lineHeight: 'var(--type-title-lg-line)', fontWeight: 'var(--type-title-lg-weight)' }],
                title: ['var(--type-title-size)', { lineHeight: 'var(--type-title-line)', fontWeight: 'var(--type-title-weight)' }],
                'body-lg': ['var(--type-body-lg-size)', { lineHeight: 'var(--type-body-lg-line)', fontWeight: 'var(--type-body-lg-weight)' }],
                body: ['var(--type-body-size)', { lineHeight: 'var(--type-body-line)', fontWeight: 'var(--type-body-weight)' }],
                'body-sm': ['var(--type-body-sm-size)', { lineHeight: 'var(--type-body-sm-line)', fontWeight: 'var(--type-body-sm-weight)' }],
                'label-lg': ['var(--type-label-lg-size)', { lineHeight: 'var(--type-label-lg-line)', fontWeight: 'var(--type-label-lg-weight)' }],
                label: ['var(--type-label-size)', { lineHeight: 'var(--type-label-line)', fontWeight: 'var(--type-label-weight)' }],
            },

            maxWidth: {
                content: 'var(--content-max)',
                'content-wide': 'var(--content-wide)',
            },

            transitionTimingFunction: {
                standard: 'var(--ease-standard)',
                decelerate: 'var(--ease-decelerate)',
                accelerate: 'var(--ease-accelerate)',
                emphasized: 'var(--ease-emphasized)',
            },

            transitionDuration: {
                short: 'var(--motion-short)',
                medium: 'var(--motion-medium)',
                long: 'var(--motion-long)',
            },

            boxShadow: {
                1: 'var(--shadow-1)',
                2: 'var(--shadow-2)',
                3: 'var(--shadow-3)',
            },

            spacing: {
                topbar: 'var(--topbar-height)',
                nav: 'var(--nav-width)',
            },
        },
    },
    plugins: [],
};
