import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * Sistema de toasts NEXUS: feedback no bloqueante para reemplazar los alert()
 * nativos del navegador. Tema oscuro glass consistente con el resto de la app.
 *
 * Uso:
 *   const toast = useToast();
 *   toast.success('Guardado');
 *   toast.error('No se pudo guardar');       // 6 s por defecto
 *   toast.warning('Revisa el formato');      // 5.5 s
 *   toast.info('Datos sincronizados');       // 4.5 s
 */

const ToastContext = createContext(null);

export const useToast = () => {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
    return ctx;
};

const TOAST_CONFIG = {
    success: { icon: 'bi-check-circle-fill', className: 'toast-nexus-success' },
    error: { icon: 'bi-x-circle-fill', className: 'toast-nexus-error' },
    warning: { icon: 'bi-exclamation-triangle-fill', className: 'toast-nexus-warning' },
    info: { icon: 'bi-info-circle-fill', className: 'toast-nexus-info' }
};

const DEFAULT_TIMEOUT = { success: 4500, error: 6000, warning: 5500, info: 4500 };

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const idRef = useRef(0);

    const dismiss = useCallback((id) => {
        setToasts(current => current.filter(t => t.id !== id));
    }, []);

    const showToast = useCallback((message, type) => {
        const id = ++idRef.current;
        // Los mensajes pueden llegar con \n (importadores): los convertimos en saltos reales vía CSS white-space.
        setToasts(current => [...current, { id, message: String(message ?? ''), type }]);
        const timeout = DEFAULT_TIMEOUT[type] || DEFAULT_TIMEOUT.info;
        setTimeout(() => dismiss(id), timeout);
        return id;
    }, [dismiss]);

    const api = {
        success: (msg) => showToast(msg, 'success'),
        error: (msg) => showToast(msg, 'error'),
        warning: (msg) => showToast(msg, 'warning'),
        info: (msg) => showToast(msg, 'info')
    };

    return (
        <ToastContext.Provider value={api}>
            {children}
            <div className="toast-nexus-stack" aria-live="polite">
                {toasts.map(t => {
                    const cfg = TOAST_CONFIG[t.type] || TOAST_CONFIG.info;
                    return (
                        <div
                            key={t.id}
                            className={`toast-nexus ${cfg.className}`}
                            role="status"
                            onClick={() => dismiss(t.id)}
                        >
                            <i className={`bi ${cfg.icon} toast-nexus-icon`}></i>
                            <span className="toast-nexus-message">{t.message}</span>
                            <button
                                type="button"
                                className="toast-nexus-close"
                                aria-label="Cerrar notificación"
                                onClick={(e) => { e.stopPropagation(); dismiss(t.id); }}
                            >
                                <i className="bi bi-x-lg"></i>
                            </button>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
}
