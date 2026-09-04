/**
 * engineFlag.js — Resolución del modo del asistente de importación.
 *
 * Orden de prioridad: ?engine= en la URL > localStorage 'importEngine' > 'legacy'.
 * El default SIEMPRE es legacy: el modo universal solo se activa de forma
 * explícita. Sin React, sin red.
 */

const STORAGE_KEY = 'importEngine';
const PARAM = 'engine';

function readParam() {
    try {
        if (typeof window === 'undefined' || !window.location) return null;
        const v = new URLSearchParams(window.location.search).get(PARAM);
        return v === 'universal' || v === 'legacy' ? v : null;
    } catch {
        return null;
    }
}

function readStored() {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return null;
        const v = window.localStorage.getItem(STORAGE_KEY);
        return v === 'universal' || v === 'legacy' ? v : null;
    } catch {
        return null;
    }
}

/** 'legacy' | 'universal'. Default: 'legacy'. */
export function getImportEngineMode() {
    return readParam() || readStored() || 'legacy';
}

export function setImportEngineMode(mode) {
    if (mode !== 'universal' && mode !== 'legacy') {
        throw new TypeError(`engineFlag: modo inválido "${mode}" (universal|legacy)`);
    }
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(STORAGE_KEY, mode);
        }
    } catch {
        // almacenamiento no disponible: el modo por URL sigue funcionando
    }
    return mode;
}

/** true solo cuando el modo resuelto es 'universal'. */
export function isUniversalEnabled() {
    return getImportEngineMode() === 'universal';
}
