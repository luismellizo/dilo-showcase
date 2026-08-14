// Configuración compartida de URLs del backend (API + WebSocket).
// Única fuente de verdad — NO hardcodear localhost en componentes.
export const getBaseUrls = () => {
  if (process.env.REACT_APP_API_URL) {
    const apiUrl = process.env.REACT_APP_API_URL;
    const wsUrl = apiUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    return { api: apiUrl, ws: wsUrl };
  }
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return { api: 'http://localhost:8000', ws: 'ws://localhost:8000' };
  }
  // El dominio de producción sirve la SPA y proxea /api/ y /ws/ al backend en
  // el mismo origen — misma URL para la API que para el propio frontend.
  // (Dominios reales sustituidos por placeholders en este snapshot público.)
  if (hostname === 'dilo.example.com' || hostname === 'app.dilo.example.com') {
    return { api: 'https://dilo.example.com', ws: 'wss://dilo.example.com' };
  }
  return { api: 'http://localhost:8000', ws: 'ws://localhost:8000' };
};

const urls = getBaseUrls();
export const API_BASE_URL = urls.api;
export const WS_BASE_URL = urls.ws;

// Formato de moneda colombiana (sin decimales).
export const formatCOP = (value) =>
  `$${Math.round(parseFloat(value || 0)).toLocaleString('es-CO')}`;
