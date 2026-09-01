import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Modal NEXUS: chrome único para todos los modales de la app (reemplaza los
 * wrappers artesanales "modal d-block" duplicados).
 *
 * Aporta: portal a document.body, cierre con Escape (solo el modal superior si
 * hay varios anidados), trampa de foco, cierre por backdrop configurable y
 * restauración del foco al abrir.
 *
 * Uso:
 *   <NexusModal isOpen={show} onClose={() => setShow(false)} title="Alta de Artículo" icon="bi-plus-circle" size="lg">
 *       <div className="modal-body">…</div>
 *       <div className="modal-footer">…</div>
 *   </NexusModal>
 *
 * ⚠️ IMPORTANTE: los children (y props) se EVALÚAN aunque isOpen sea false
 * (JSX se construye siempre). Si el contenido referencia un objeto que solo
 * existe al abrir el modal (p. ej. selectedTransaction.date), hay que
 * envolverlo:  {selectedTransaction && (<> … </>)}  — como hacía el patrón
 * viejo {cond && <div>…</div>}.
 */

const SIZE_CLASS = { sm: 'modal-sm', md: '', lg: 'modal-lg', xl: 'modal-xl' };

// Pila global de modales abiertos: solo el superior responde a Escape.
const modalStack = [];
let modalSeq = 0;

export default function NexusModal({
    isOpen,
    onClose,
    title,
    icon,
    size = 'md',
    children,
    closeOnBackdrop = true,
    contentClassName = ''
}) {
    const dialogRef = useRef(null);
    const lastActiveRef = useRef(null);
    const idRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return undefined;

        // Asignar id estable para esta apertura
        if (idRef.current === null) idRef.current = ++modalSeq;
        const id = idRef.current;

        lastActiveRef.current = document.activeElement;
        modalStack.push(id);

        const timer = setTimeout(() => {
            if (dialogRef.current) dialogRef.current.focus();
        }, 0);

        const onKeyDown = (e) => {
            if (modalStack[modalStack.length - 1] !== id) return; // hay un modal más arriba
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
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

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            clearTimeout(timer);
            modalStack.splice(modalStack.indexOf(id), 1);
            idRef.current = null;
            if (lastActiveRef.current && typeof lastActiveRef.current.focus === 'function') {
                lastActiveRef.current.focus();
            }
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div
            className="modal d-block"
            style={{ backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 2000 }}
            onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}
        >
            <div className={`modal-dialog modal-dialog-centered modal-dialog-scrollable ${SIZE_CLASS[size] || ''}`}>
                <div
                    className={`modal-content glass-panel border-secondary text-white ${contentClassName}`}
                    ref={dialogRef}
                    tabIndex={-1}
                    role="dialog"
                    aria-modal="true"
                    aria-label={typeof title === 'string' ? title : 'Diálogo'}
                >
                    <div className="modal-header border-secondary border-bottom py-3">
                        <h5 className="modal-title text-white">
                            {icon && <i className={`bi ${icon} me-2`}></i>}
                            {title}
                        </h5>
                        <button
                            type="button"
                            className="btn-close btn-close-white"
                            aria-label="Cerrar"
                            onClick={onClose}
                        ></button>
                    </div>
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}
