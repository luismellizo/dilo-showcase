/**
 * Impersonation (soporte): manejo de sesión "ver como usuario".
 *
 * Al impersonar se guarda la sesión staff aparte (staff_access_token/
 * staff_refresh_token), se reemplaza access_token por el token corto (30 min,
 * SIN refresh) y se marca `impersonation` con los metadatos para el banner.
 * Salir restaura la sesión staff intacta.
 */

const IMP_KEY = 'impersonation';

export function getImpersonation() {
    try {
        const raw = localStorage.getItem(IMP_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function startImpersonation(data) {
    // data = respuesta de POST /api/staff/impersonate/
    localStorage.setItem('staff_access_token', localStorage.getItem('access_token') || '');
    localStorage.setItem('staff_refresh_token', localStorage.getItem('refresh_token') || '');
    localStorage.setItem('access_token', data.access);
    // Sin refresh: la sesión de impersonation expira dura a los 30 min.
    localStorage.removeItem('refresh_token');
    localStorage.setItem(IMP_KEY, JSON.stringify({
        user: data.user,
        store: data.store,
        expires_at: Date.now() + data.expires_in * 1000,
    }));
    // Full reload: AuthProvider re-lee /me con el token del usuario impersonado.
    window.location.href = '/dashboard';
}

export function endImpersonation() {
    const access = localStorage.getItem('staff_access_token');
    const refresh = localStorage.getItem('staff_refresh_token');
    if (access) localStorage.setItem('access_token', access);
    else localStorage.removeItem('access_token');
    if (refresh) localStorage.setItem('refresh_token', refresh);
    else localStorage.removeItem('refresh_token');
    localStorage.removeItem('staff_access_token');
    localStorage.removeItem('staff_refresh_token');
    localStorage.removeItem(IMP_KEY);
    window.location.href = '/admin';
}
