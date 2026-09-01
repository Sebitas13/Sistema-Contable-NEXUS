import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * Diálogo de confirmación NEXUS: reemplaza los window.confirm() nativos por un
 * modal accesible consistente con el tema glass.
 *
 * Uso:
 *   const confirmDialog = useConfirm();
 *   const ok = await confirmDialog({
 *       title: 'Eliminar cuenta',
 *       message: 'Esta acción no se puede deshacer.',
 *       confirmText: 'Eliminar',
 *       danger: true
 *   });
 *   if (!ok) return;
 *
 * Accesibilidad: rol alertdialog, foco inicial en "Cancelar" (acción menos
 * destructiva), trampa de foco con Tab, cierre con Escape (devuelve false) y
 * restauración del foco al elemento que abrió el diálogo.
 */

const ConfirmContext = createContext(null);

export const useConfirm = () => {
    const ctx = useContext(ConfirmContext);
    if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>');
    return ctx;
};

export function ConfirmProvider({ children }) {
    const [dialog, setDialog] = useState(null);
    const dialogRef = useRef(null);
    const lastActiveRef = useRef(null);

    const close = useCallback((result) => {
        setDialog(current => {
            if (current) current.resolve(result);
            return null;
        });
        // Restaurar el foco al elemento que abrió el diálogo
        if (lastActiveRef.current && typeof lastActiveRef.current.focus === 'function') {
            lastActiveRef.current.focus();
        }
        lastActiveRef.current = null;
    }, []);

    const confirmDialog = useCallback((options) => {
        lastActiveRef.current = document.activeElement;
        return new Promise((resolve) => {
            setDialog({
                title: '¿Confirmar acción?',
                message: '',
                confirmText: 'Confirmar',
                cancelText: 'Cancelar',
                danger: false,
                ...options,
                resolve
            });
        });
    }, []);

    // Escape cierra (false) + trampa de foco con Tab
    useEffect(() => {
        if (!dialog) return undefined;

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(false);
                return;
            }
            if (e.key === 'Tab' && dialogRef.current) {
                const focusables = dialogRef.current.querySelectorAll(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if (focusables.length === 0) return;
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        window.addEventListener('keydown', onKeyDown);
        // Foco inicial en la acción menos destructiva (Cancelar)
        const timer = setTimeout(() => {
            if (dialogRef.current) {
                const cancelBtn = dialogRef.current.querySelector('[data-confirm-cancel]');
                if (cancelBtn) cancelBtn.focus();
            }
        }, 0);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            clearTimeout(timer);
        };
    }, [dialog, close]);

    return (
        <ConfirmContext.Provider value={confirmDialog}>
            {children}
            {dialog && (
                <div
                    className="modal d-block"
                    style={{ backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 3050 }}
                    onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}
                >
                    <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '420px' }}>
                        <div
                            className="modal-content glass-panel border-secondary text-white"
                            ref={dialogRef}
                            role="alertdialog"
                            aria-modal="true"
                            aria-labelledby="confirm-dialog-title"
                        >
                            <div className="modal-body p-4">
                                <div className="d-flex align-items-start gap-3">
                                    <div
                                        className={`p-3 rounded-3 flex-shrink-0 ${dialog.danger ? 'bg-danger bg-opacity-25 text-danger' : 'bg-warning bg-opacity-25 text-warning'}`}
                                        aria-hidden="true"
                                    >
                                        <i className={`bi ${dialog.danger ? 'bi-exclamation-octagon' : 'bi-question-circle'} fs-3`}></i>
                                    </div>
                                    <div>
                                        <h5 id="confirm-dialog-title" className="mb-2 text-white">{dialog.title}</h5>
                                        {dialog.message && (
                                            <p className="text-white-50 mb-0" style={{ whiteSpace: 'pre-line' }}>{dialog.message}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="modal-footer border-secondary px-4 pb-3 pt-0">
                                <button
                                    type="button"
                                    className="btn btn-outline-secondary"
                                    data-confirm-cancel
                                    onClick={() => close(false)}
                                >
                                    {dialog.cancelText}
                                </button>
                                <button
                                    type="button"
                                    className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`}
                                    onClick={() => close(true)}
                                >
                                    {dialog.confirmText}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmContext.Provider>
    );
}
