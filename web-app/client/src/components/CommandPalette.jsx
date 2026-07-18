import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * CommandPalette - Navegación instantánea con Ctrl/Cmd + K.
 *
 * Paleta de comandos premium con bordes glassmórficos neon, resaltado de
 * caracteres coincidentes, descripciones contextuales, y animaciones
 * escalonadas en la lista de resultados.
 */

// Destinos navegables + palabras clave y descripciones.
const COMMANDS = [
    { label: 'Dashboard', path: '/app', icon: 'bi-speedometer2', keywords: 'inicio centro mando resumen', desc: 'Vista general de la empresa' },
    { label: 'Plan de Cuentas', path: '/app/accounts', icon: 'bi-journal-text', keywords: 'cuentas catalogo puct', desc: 'Estructura contable y clasificación' },
    { label: 'Libro Diario', path: '/app/journal', icon: 'bi-pencil-square', keywords: 'asientos diario registrar', desc: 'Registrar asientos contables' },
    { label: 'Libro Mayor', path: '/app/ledger', icon: 'bi-book', keywords: 'mayor movimientos', desc: 'Movimientos por cuenta' },
    { label: 'Balance de Comprobación', path: '/app/trial-balance', icon: 'bi-calculator', keywords: 'balance comprobacion sumas saldos', desc: 'Verificar sumas y saldos' },
    { label: 'Hoja de Trabajo', path: '/app/worksheet', icon: 'bi-file-earmark-spreadsheet', keywords: 'hoja trabajo ajustes', desc: 'Formato completo de 16 columnas' },
    { label: 'Costos y Almacén', path: '/app/cost-centers', icon: 'bi-diagram-3', keywords: 'costos almacen centros inventario', desc: 'Centros de costo e inventario' },
    { label: 'Activos Fijos', path: '/app/fixed-assets', icon: 'bi-building', keywords: 'activos fijos depreciacion', desc: 'Gestión y depreciación de activos' },
    { label: 'UFV', path: '/app/ufv', icon: 'bi-graph-up-arrow', keywords: 'ufv unidad fomento vivienda', desc: 'Valores UFV actualizados' },
    { label: 'Tipo de Cambio', path: '/app/exchange-rate', icon: 'bi-currency-exchange', keywords: 'tipo cambio dolar moneda', desc: 'Tasas de cambio vigentes' },
    { label: 'Reportes', path: '/app/reports', icon: 'bi-graph-up', keywords: 'reportes estados financieros', desc: 'Generar reportes financieros' },
    { label: 'Estados Financieros', path: '/app/financial-statements', icon: 'bi-clipboard-data', keywords: 'balance general estado resultados', desc: 'Balance General y Estado de Resultados' },
    { label: 'Configuración', path: '/app/settings', icon: 'bi-gear', keywords: 'configuracion ajustes mahoraga ia', desc: 'Ajustes del sistema e IA' },
];

/** Highlight matching characters in a label */
function HighlightedText({ text, query }) {
    if (!query) return <span>{text}</span>;

    const q = query.toLowerCase();
    const lower = text.toLowerCase();
    const parts = [];
    let lastIdx = 0;

    for (let i = 0; i < q.length; i++) {
        const idx = lower.indexOf(q[i], lastIdx);
        if (idx === -1) continue;
        if (idx > lastIdx) {
            parts.push(<span key={`t-${lastIdx}`}>{text.slice(lastIdx, idx)}</span>);
        }
        parts.push(
            <span key={`h-${idx}`} style={{
                color: 'var(--accent-primary)',
                fontWeight: 700,
                textShadow: '0 0 8px rgba(59,130,246,0.4)',
            }}>
                {text[idx]}
            </span>
        );
        lastIdx = idx + 1;
    }
    if (lastIdx < text.length) {
        parts.push(<span key={`e-${lastIdx}`}>{text.slice(lastIdx)}</span>);
    }

    return <>{parts}</>;
}

// Animation variants for staggered list entry
const listVariants = {
    hidden: {},
    visible: {
        transition: { staggerChildren: 0.035 },
    },
};

const itemVariants = {
    hidden: { opacity: 0, y: 8, scale: 0.97 },
    visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { type: 'spring', stiffness: 400, damping: 28 },
    },
};

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
            c.label.toLowerCase().includes(q) ||
            c.keywords.includes(q) ||
            c.desc.toLowerCase().includes(q)
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
                        initial={{ opacity: 0, y: -20, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.96 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            borderImage: 'linear-gradient(135deg, rgba(59,130,246,0.4), rgba(139,92,246,0.3), rgba(16,185,129,0.3)) 1',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                        }}
                    >
                        {/* Search bar */}
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

                        {/* Results list */}
                        <motion.div
                            className="command-list"
                            variants={listVariants}
                            initial="hidden"
                            animate="visible"
                            key={query}
                        >
                            {results.length === 0 ? (
                                <div className="text-center text-white-50 py-4 small">Sin resultados para "{query}"</div>
                            ) : (
                                results.map((cmd, idx) => (
                                    <motion.button
                                        key={cmd.path}
                                        variants={itemVariants}
                                        className={`command-item ${idx === active ? 'active' : ''}`}
                                        onMouseEnter={() => setActive(idx)}
                                        onClick={() => go(cmd)}
                                    >
                                        <i className={`bi ${cmd.icon} me-3`} style={{ fontSize: '1.1rem' }}></i>
                                        <div className="d-flex flex-column align-items-start" style={{ minWidth: 0, flex: 1 }}>
                                            <span style={{ fontWeight: 500 }}>
                                                <HighlightedText text={cmd.label} query={query} />
                                            </span>
                                            <span style={{
                                                fontSize: '0.72rem',
                                                color: 'var(--text-muted)',
                                                lineHeight: 1.3,
                                                marginTop: '1px',
                                            }}>
                                                {cmd.desc}
                                            </span>
                                        </div>
                                        <i className="bi bi-arrow-return-left ms-auto text-white-50 small"></i>
                                    </motion.button>
                                ))
                            )}
                        </motion.div>

                        {/* Footer shortcuts */}
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
