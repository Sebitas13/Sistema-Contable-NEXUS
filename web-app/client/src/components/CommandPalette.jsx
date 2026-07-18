import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * CommandPalette - Navegación instantánea con Ctrl/Cmd + K.
 *
 * Herramienta de uso diario, no adorno: permite saltar a cualquier módulo sin
 * tocar el ratón. Búsqueda difusa por etiqueta, navegación con flechas y Enter,
 * cierre con Esc. Se monta una vez en el layout y escucha el atajo globalmente.
 */

// Destinos navegables (espejo del menú lateral) + palabras clave para búsqueda.
const COMMANDS = [
    { label: 'Dashboard', path: '/app', icon: 'bi-speedometer2', keywords: 'inicio centro mando resumen' },
    { label: 'Plan de Cuentas', path: '/app/accounts', icon: 'bi-journal-text', keywords: 'cuentas catalogo puct' },
    { label: 'Libro Diario', path: '/app/journal', icon: 'bi-pencil-square', keywords: 'asientos diario registrar' },
    { label: 'Libro Mayor', path: '/app/ledger', icon: 'bi-book', keywords: 'mayor movimientos' },
    { label: 'Balance de Comprobación', path: '/app/trial-balance', icon: 'bi-calculator', keywords: 'balance comprobacion sumas saldos' },
    { label: 'Hoja de Trabajo', path: '/app/worksheet', icon: 'bi-file-earmark-spreadsheet', keywords: 'hoja trabajo ajustes' },
    { label: 'Costos y Almacén', path: '/app/cost-centers', icon: 'bi-diagram-3', keywords: 'costos almacen centros inventario' },
    { label: 'Activos Fijos', path: '/app/fixed-assets', icon: 'bi-building', keywords: 'activos fijos depreciacion' },
    { label: 'UFV', path: '/app/ufv', icon: 'bi-graph-up-arrow', keywords: 'ufv unidad fomento vivienda' },
    { label: 'Tipo de Cambio', path: '/app/exchange-rate', icon: 'bi-currency-exchange', keywords: 'tipo cambio dolar moneda' },
    { label: 'Reportes', path: '/app/reports', icon: 'bi-graph-up', keywords: 'reportes estados financieros' },
    { label: 'Estados Financieros', path: '/app/financial-statements', icon: 'bi-clipboard-data', keywords: 'balance general estado resultados' },
    { label: 'Configuración', path: '/app/settings', icon: 'bi-gear', keywords: 'configuracion ajustes mahoraga ia' },
];

export default function CommandPalette() {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const inputRef = useRef(null);

    // Atajo global Ctrl/Cmd + K para abrir/cerrar.
    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setOpen(prev => !prev);
            } else if (e.key === 'Escape') {
                setOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        // Permite abrir el paleta desde un botón del header (descubribilidad).
        const openEvt = () => setOpen(true);
        window.addEventListener('open-command-palette', openEvt);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('open-command-palette', openEvt);
        };
    }, []);

    // Al abrir: limpiar y enfocar. Al cerrar: resetear selección.
    useEffect(() => {
        if (open) {
            setQuery('');
            setActive(0);
            setTimeout(() => inputRef.current?.focus(), 40);
        }
    }, [open]);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return COMMANDS;
        return COMMANDS.filter(c =>
            c.label.toLowerCase().includes(q) || c.keywords.includes(q)
        );
    }, [query]);

    useEffect(() => { setActive(0); }, [query]);

    const go = (cmd) => {
        if (!cmd) return;
        setOpen(false);
        navigate(cmd.path);
    };

    const onInputKey = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(a => Math.min(a + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(a => Math.max(a - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            go(results[active]);
        }
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="command-palette-backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    onClick={() => setOpen(false)}
                >
                    <motion.div
                        className="command-palette glass-panel"
                        initial={{ opacity: 0, y: -20, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom border-secondary border-opacity-25">
                            <i className="bi bi-search text-white-50"></i>
                            <input
                                ref={inputRef}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={onInputKey}
                                className="form-control border-0 bg-transparent text-white shadow-none"
                                placeholder="Buscar módulo o acción..."
                                autoComplete="off"
                            />
                            <kbd className="command-kbd d-none d-sm-inline">Esc</kbd>
                        </div>
                        <div className="command-list">
                            {results.length === 0 ? (
                                <div className="text-center text-white-50 py-4 small">Sin resultados para "{query}"</div>
                            ) : (
                                results.map((cmd, idx) => (
                                    <button
                                        key={cmd.path}
                                        className={`command-item ${idx === active ? 'active' : ''}`}
                                        onMouseEnter={() => setActive(idx)}
                                        onClick={() => go(cmd)}
                                    >
                                        <i className={`bi ${cmd.icon} me-3`}></i>
                                        <span>{cmd.label}</span>
                                        <i className="bi bi-arrow-return-left ms-auto text-white-50 small"></i>
                                    </button>
                                ))
                            )}
                        </div>
                        <div className="d-flex justify-content-between align-items-center px-3 py-2 border-top border-secondary border-opacity-25 small text-white-50">
                            <span><kbd className="command-kbd">↑</kbd><kbd className="command-kbd ms-1">↓</kbd> navegar</span>
                            <span><kbd className="command-kbd">↵</kbd> abrir</span>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
