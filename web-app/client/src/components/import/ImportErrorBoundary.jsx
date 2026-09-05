/**
 * ImportErrorBoundary.jsx — Red de seguridad del asistente universal (U-6).
 *
 * Si UniversalImportWizard lanza una excepción NO controlada durante el
 * render (fuera de los errores gestionados de extracción/análisis, que tienen
 * su propia UI con reintento), este boundary:
 *   1. registra el error en consola,
 *   2. fija el flag a 'legacy' (fallback persistente),
 *   3. monta el asistente clásico con los mismos callbacks.
 *
 * El modo legacy sigue siendo el camino productivo hasta la decisión U-9.
 */

import React from 'react';
import SmartImportWizard from '../SmartImportWizard.jsx';
import { setImportEngineMode } from './engineFlag.js';

export default class ImportErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, info) {
        try {
            console.error('[universal-import] fallo inesperado, volviendo al clásico:', error, info && info.componentStack);
        } catch {
            // el logging jamás debe romper el fallback
        }
        try {
            setImportEngineMode('legacy');
        } catch {
            // sin almacenamiento: igual se muestra el clásico esta vez
        }
    }

    render() {
        if (this.state.hasError) {
            const { onClose, onSuccess } = this.props;
            return <SmartImportWizard onClose={onClose} onSuccess={onSuccess} />;
        }
        return this.props.children;
    }
}
