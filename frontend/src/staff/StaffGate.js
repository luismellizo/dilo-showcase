import React, { createContext, useContext, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { API_BASE_URL } from '../config';

/**
 * Guard de las rutas /admin: verifica contra el backend (/api/staff/me/) que
 * el usuario autenticado sea del equipo interno y expone su rol vía contexto.
 * No confía en estado del cliente.
 *
 * Salidas cuando no pasa:
 * - Sin sesión (o token vencido) → /admin/login, la puerta propia del panel.
 * - Con sesión válida de comercio pero sin rol interno → /dashboard (su casa).
 */

const StaffRoleContext = createContext(null);
export const useStaffRole = () => useContext(StaffRoleContext);

export default function StaffGate({ children }) {
    const { fetchWithAuth } = useAuth();
    const [state, setState] = useState({ loading: true, me: null, redirect: null });

    useEffect(() => {
        let alive = true;
        // La sesión staff no tiene refresh token: un 401 significa vencida,
        // y fetchWithAuth ya limpió el localStorage al intentar refrescar.
        const deniedTarget = () => (
            localStorage.getItem('access_token') ? '/dashboard' : '/admin/login'
        );
        (async () => {
            if (!localStorage.getItem('access_token')) {
                if (alive) setState({ loading: false, me: null, redirect: '/admin/login' });
                return;
            }
            try {
                const res = await fetchWithAuth(`${API_BASE_URL}/api/staff/me/`);
                if (!alive) return;
                if (res.ok) {
                    setState({ loading: false, me: await res.json(), redirect: null });
                } else {
                    setState({
                        loading: false, me: null,
                        redirect: res.status === 401 ? '/admin/login' : deniedTarget(),
                    });
                }
            } catch {
                if (alive) setState({ loading: false, me: null, redirect: deniedTarget() });
            }
        })();
        return () => { alive = false; };
    }, [fetchWithAuth]);

    if (state.loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-2 border-gray-200 rounded-full" style={{ borderTopColor: 'var(--accent)' }} />
            </div>
        );
    }
    if (state.redirect) return <Navigate to={state.redirect} replace />;

    return (
        <StaffRoleContext.Provider value={state.me}>
            {children}
        </StaffRoleContext.Provider>
    );
}
