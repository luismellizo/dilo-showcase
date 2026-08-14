import React, { createContext, useContext, useState, useEffect } from 'react';

// Presets de tema del panel. El acento (`--accent`) es independiente y elegible
// por el dueño. `tokens.css` deriva de ese acento la rampa tonal completa
// (primary, primary-container, secondary-container…), así que cualquier color
// que elija el comercio produce una paleta Material con contraste correcto.
// Los `swatch`/`surface` de aquí son solo la MINIATURA del selector.
export const THEMES = {
    light: { id: 'light', label: 'Claro', desc: 'Luminoso y limpio', swatch: '#ffffff', surface: '#f0f4f9' },
    dark: { id: 'dark', label: 'Carbón', desc: 'Oscuro elegante', swatch: '#1e1f20', surface: '#131314' },
    midnight: { id: 'midnight', label: 'Medianoche', desc: 'Azul profundo', swatch: '#171f34', surface: '#0d1220' },
};

// Acentos sugeridos del selector de color de marca. Son DATOS (el color que
// el comercio guarda en `Store.theme_color`), no tokens de diseño: por eso
// viven aquí junto al resto de la configuración de tema y no en `tokens.css`.
export const ACCENT_PRESETS = [
    { value: '#FF441F', label: 'Naranja DILO' },
    { value: '#1A73E8', label: 'Azul' },
    { value: '#188038', label: 'Verde' },
    { value: '#9334E6', label: 'Morado' },
    { value: '#E8710A', label: 'Ámbar' },
    { value: '#D93025', label: 'Rojo' },
];

// Motivos del fondo decorativo del panel (FoodBackdrop) según el rubro.
// `none` ya estaba soportado en FoodBackdrop (devuelve null) pero no se ofrecía
// en la interfaz: se expone ahora porque un fondo liso es lo que espera quien
// viene de un panel tipo Google, y hasta hoy no había forma de apagarlo.
export const BACKDROPS = {
    none: { id: 'none', label: 'Sin fondo', desc: 'Superficie lisa, sin motivo' },
    food: { id: 'food', label: 'Comida', desc: 'Hamburguesas, pizza, helado' },
    drinks: { id: 'drinks', label: 'Bebidas', desc: 'Café, cócteles, cerveza' },
    retail: { id: 'retail', label: 'Tienda', desc: 'Bolsas, cajas, etiquetas' },
};

export const DEFAULT_ACCENT = '#FF441F';
const MODE_KEY = 'dilo_theme_mode';
const ACCENT_KEY = 'dilo_theme_accent';
const BACKDROP_KEY = 'dilo_theme_backdrop';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
    const [mode, setModeState] = useState(() => {
        const saved = localStorage.getItem(MODE_KEY);
        return saved && THEMES[saved] ? saved : 'light';
    });
    const [accent, setAccentState] = useState(() => localStorage.getItem(ACCENT_KEY) || DEFAULT_ACCENT);
    const [backdrop, setBackdropState] = useState(() => {
        const saved = localStorage.getItem(BACKDROP_KEY);
        return saved && BACKDROPS[saved] ? saved : 'food';
    });

    // Acento global (--accent) en <html> → lo consumen todas las superficies del panel.
    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty('--accent', accent);
        // Tinte translúcido derivado para fondos seleccionados/badges.
        root.style.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 14%, transparent)`);
        localStorage.setItem(ACCENT_KEY, accent);
    }, [accent]);

    useEffect(() => {
        localStorage.setItem(MODE_KEY, mode);
    }, [mode]);

    useEffect(() => {
        localStorage.setItem(BACKDROP_KEY, backdrop);
    }, [backdrop]);

    const setMode = (m) => { if (THEMES[m]) setModeState(m); };
    const setAccent = (c) => { if (c) setAccentState(c); };
    const setBackdrop = (b) => { if (BACKDROPS[b]) setBackdropState(b); };

    return (
        <ThemeContext.Provider value={{
            mode, accent, backdrop, setMode, setAccent, setBackdrop,
            themes: Object.values(THEMES), backdrops: Object.values(BACKDROPS),
        }}>
            {children}
        </ThemeContext.Provider>
    );
}

// Fallback seguro si se usa fuera del provider (no rompe render).
export const useTheme = () => useContext(ThemeContext) || {
    mode: 'light', accent: DEFAULT_ACCENT, backdrop: 'food',
    setMode: () => { }, setAccent: () => { }, setBackdrop: () => { },
    themes: Object.values(THEMES), backdrops: Object.values(BACKDROPS),
};
