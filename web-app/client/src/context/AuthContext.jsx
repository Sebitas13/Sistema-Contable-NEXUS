import { createContext, useContext, useEffect, useState } from 'react';
import API_URL from '../api';

/**
 * Provee si la app requiere login (consultando GET /api/auth/config una sola vez).
 * Rollout graceful: si el backend no tiene APP_PASSWORD, authRequired = false y la app
 * funciona sin login (como antes).
 */
const AuthContext = createContext({ authRequired: false, ready: false });

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
    const [state, setState] = useState({ authRequired: false, ready: false });

    useEffect(() => {
        let active = true;
        fetch(`${API_URL}/api/auth/config`)
            .then((r) => r.json())
            .then((d) => {
                if (active) setState({ authRequired: Boolean(d && d.authRequired), ready: true });
            })
            .catch(() => {
                // Si no se pudo consultar (p.ej. cold start), asumir sin login; las llamadas de
                // datos que devuelvan 401 redirigirán a /login igualmente.
                if (active) setState({ authRequired: false, ready: true });
            });
        return () => {
            active = false;
        };
    }, []);

    return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
