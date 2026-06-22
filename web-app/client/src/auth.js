/**
 * Autenticación del cliente (contraseña única compartida).
 *
 * - Guarda el token (= sha256(APP_PASSWORD) que devuelve el backend) en localStorage.
 * - Inyecta `Authorization: Bearer <token>` en TODAS las llamadas al backend, tanto las que
 *   usan `fetch` (la mayoría de la app) como las que usan `axios`.
 * - Ante un 401 limpia el token y redirige a /login.
 *
 * No hay wrapper central de red en la app (se usa `fetch` directo en ~27 archivos), por eso
 * aquí se "monkey-patchea" `window.fetch` y se agrega un interceptor global de axios. Así no
 * hace falta editar cada llamada una por una.
 */

import axios from 'axios';
import API_URL from './api';

const TOKEN_KEY = 'authToken';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);
export const isAuthenticated = () => Boolean(getToken());

/** ¿La URL apunta a nuestro backend? (para no filtrar el token a terceros) */
const targetsBackend = (url) => {
    const u = String(url || '');
    if (API_URL && u.startsWith(API_URL)) return true;
    if (u.startsWith('/api/')) return true; // mismo origen vía proxy de Vercel
    return false;
};

let redirecting = false;
export const handleUnauthorized = () => {
    clearToken();
    if (!redirecting && !window.location.pathname.startsWith('/login')) {
        redirecting = true;
        window.location.assign('/login');
    }
};

/** Instala los interceptores de fetch y axios. Llamar una sola vez al arrancar la app. */
export const installAuthInterceptors = () => {
    // --- fetch ---
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        let opts = init || {};
        if (targetsBackend(url)) {
            const token = getToken();
            if (token) {
                const headers = new Headers(opts.headers || {});
                if (!headers.has('Authorization')) {
                    headers.set('Authorization', `Bearer ${token}`);
                }
                opts = { ...opts, headers };
            }
        }
        const response = await originalFetch(input, opts);
        if (response.status === 401 && targetsBackend(url)) {
            handleUnauthorized();
        }
        return response;
    };

    // --- axios (instancia global por defecto) ---
    axios.interceptors.request.use((config) => {
        const url = (config.baseURL || '') + (config.url || '');
        if (targetsBackend(url) || targetsBackend(config.url)) {
            const token = getToken();
            if (token) {
                config.headers = config.headers || {};
                if (!config.headers.Authorization) {
                    config.headers.Authorization = `Bearer ${token}`;
                }
            }
        }
        return config;
    });
    axios.interceptors.response.use(
        (response) => response,
        (error) => {
            if (error.response && error.response.status === 401) {
                handleUnauthorized();
            }
            return Promise.reject(error);
        }
    );
};

/** Interceptor para instancias propias de axios (las creadas con axios.create no heredan los globales). */
export const attachAuthToAxiosInstance = (instance) => {
    instance.interceptors.request.use((config) => {
        const token = getToken();
        if (token) {
            config.headers = config.headers || {};
            if (!config.headers.Authorization) {
                config.headers.Authorization = `Bearer ${token}`;
            }
        }
        return config;
    });
    instance.interceptors.response.use(
        (response) => response,
        (error) => {
            if (error.response && error.response.status === 401) {
                handleUnauthorized();
            }
            return Promise.reject(error);
        }
    );
};
