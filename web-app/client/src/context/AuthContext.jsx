import { createContext, useContext, useEffect, useState } from 'react';
import API_URL from '../api';

/**
 * Provee si la app requiere login (consultando GET /api/auth/config una sola vez).
 * Rollout graceful: si el backend no tiene APP_PASSWORD, authRequired = false y la app
 * funciona sin login (como antes).
 *
 * Cold start: si el backend está despertando (Render free), el primer fetch falla.
 * Antes se asumía "sin login" al primer fallo y el usuario terminaba con un 401 y un
 * logout forzado apenas el servidor despertaba. Ahora se reintenta hasta ~30 s con
 * spinner honesto antes de caer al fallback graceful.
 */
const AuthContext = createContext({ authRequired: false, ready: false });

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
    const [state, setState] = useState({ authRequired: false, ready: false });

    useEffect(() => {
        let active = true;
        let timer = null;
        let attempts = 0;

        const loadConfig = () => {
            fetch(`${API_URL}/api/auth/config`)
                .then((r) => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.json();
                })
                .then((d) => {
                    if (active) setState({ authRequired: Boolean(d && d.authRequired), ready: true });
                })
                .catch(() => {
                    attempts += 1;
                    if (attempts <= 6 && active) {
                        timer = setTimeout(loadConfig, 5000);
                    } else if (active) {
                        // Fallback graceful (comportamiento original) tras agotar los reintentos.
                        setState({ authRequired: false, ready: true });
                    }
                });
        };

        loadConfig();

        return () => {
            active = false;
            if (timer) clearTimeout(timer);
        };
    }, []);

    return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
