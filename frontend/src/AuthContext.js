import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const getApiUrl = () => {
    if (process.env.REACT_APP_API_URL) {
        return process.env.REACT_APP_API_URL;
    }
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:8000';
    }
    if (hostname === 'dilo.example.com' || hostname === 'app.dilo.example.com') {
        return 'https://dilo.example.com';
    }
    return 'http://localhost:8000';
};

const API_BASE_URL = getApiUrl();

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    // Cargar usuario al iniciar
    useEffect(() => {
        const token = localStorage.getItem('access_token');
        if (token) {
            fetchUser(token);
        } else {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // GAP-7: Refresh token functionality
    const refreshAccessToken = useCallback(async () => {
        const refresh = localStorage.getItem('refresh_token');
        if (!refresh) {
            logout();
            return null;
        }
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/refresh/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh })
            });
            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('access_token', data.access);
                return data.access;
            } else {
                logout();
                return null;
            }
        } catch (error) {
            console.error('Error refreshing token:', error);
            logout();
            return null;
        }
    }, []);

    // GAP-7: Wrapper fetchWithAuth que maneja 401 y refresh automático
    const fetchWithAuth = useCallback(async (url, options = {}) => {
        let token = localStorage.getItem('access_token');
        if (!token) {
            throw new Error('No access token');
        }

        // Primera intento con token actual
        let response = await fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`
            }
        });

        // Si es 401, intentar refresh
        if (response.status === 401) {
            token = await refreshAccessToken();
            if (token) {
                response = await fetch(url, {
                    ...options,
                    headers: {
                        ...options.headers,
                        'Authorization': `Bearer ${token}`
                    }
                });
            }
        }

        return response;
    }, [refreshAccessToken]);

    const fetchUser = async (token) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/me/`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (response.ok) {
                const data = await response.json();
                setUser(data);
                setIsAuthenticated(true);
            } else {
                // Token inválido, intentar refresh
                const newToken = await refreshAccessToken();
                if (newToken) {
                    fetchUser(newToken);
                }
            }
        } catch (error) {
            console.error('Error fetching user:', error);
        } finally {
            setLoading(false);
        }
    };

    const register = async (data) => {
        const response = await fetch(`${API_BASE_URL}/api/auth/register/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Error en registro');
        }
        return result;
    };

    const verifyOTP = async (email, otp) => {
        const response = await fetch(`${API_BASE_URL}/api/auth/verify/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Error en verificación');
        }
        // Guardar tokens
        localStorage.setItem('access_token', result.access);
        localStorage.setItem('refresh_token', result.refresh);
        setUser(result.user);
        setIsAuthenticated(true);
        // El payload de verify no trae la tienda anidada: /me sí (el
        // dashboard necesita user.store.id para pedidos y WebSocket).
        await fetchUser(result.access);
        return result;
    };

    const login = async (email, password) => {
        const response = await fetch(`${API_BASE_URL}/api/auth/login/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const result = await response.json();

        if (response.status === 403 && result.needs_verification) {
            // Usuario no verificado
            const err = new Error('needs_verification');
            err.needsVerification = true;
            err.email = result.email;
            throw err;
        }

        if (!response.ok) {
            throw new Error(result.error || 'Error en login');
        }

        // Guardar tokens
        localStorage.setItem('access_token', result.access);
        localStorage.setItem('refresh_token', result.refresh);
        setUser(result.user);
        setIsAuthenticated(true);
        // El payload de login no trae la tienda: sin user.store.id el
        // dashboard quedaba vacío hasta recargar. /me la trae siempre.
        await fetchUser(result.access);
        return result;
    };

    // Acceso al panel interno (/admin/login) — puerta independiente del login
    // de comercios, en dos pasos: credenciales → código por correo.
    //
    // Paso 1: valida usuario/contraseña y dispara el código. NO devuelve sesión.
    const staffRequestCode = async (email, password) => {
        const response = await fetch(`${API_BASE_URL}/api/staff/login/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || 'Credenciales inválidas');
        }
        return result;   // { challenge_id, expires_in, email_hint }
    };

    // Paso 2: canjea el código por la sesión. El backend emite un access token
    // corto y SIN refresh: al vencer, la sesión muere y hay que re-autenticar.
    const staffVerifyCode = async (challengeId, code) => {
        const response = await fetch(`${API_BASE_URL}/api/staff/login/verify/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challenge_id: challengeId, code })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            const err = new Error(result.error || 'Código inválido');
            err.expired = response.status === 410 || !!result.expired;
            throw err;
        }
        localStorage.setItem('access_token', result.access);
        // No hay refresh de sesión staff: si quedó uno viejo de una sesión de
        // comercio, borrarlo evita que se reviva con permisos distintos.
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('impersonation');
        setUser({ email: result.user?.email, staff_role: result.role });
        setIsAuthenticated(true);
        await fetchUser(result.access);
        return result;
    };

    const resendOTP = async (email) => {
        const response = await fetch(`${API_BASE_URL}/api/auth/resend-otp/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Error reenviando OTP');
        }
        return result;
    };

    // Login/registro con Google: recibe el credential (ID token) que emite
    // el botón de Google Identity Services y lo canjea por nuestros JWT.
    const loginWithGoogle = async (credential) => {
        const response = await fetch(`${API_BASE_URL}/api/auth/google/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Error con Google');
        }
        localStorage.setItem('access_token', result.access);
        localStorage.setItem('refresh_token', result.refresh);
        setUser(result.user);
        setIsAuthenticated(true);
        // Igual que login/verify: /me trae user.store anidada.
        await fetchUser(result.access);
        return result;
    };

    const logout = () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setUser(null);
        setIsAuthenticated(false);
    };

    const value = {
        user,
        loading,
        isAuthenticated,
        register,
        verifyOTP,
        login,
        staffRequestCode,
        staffVerifyCode,
        loginWithGoogle,
        resendOTP,
        logout,
        refreshAccessToken,
        fetchWithAuth
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
