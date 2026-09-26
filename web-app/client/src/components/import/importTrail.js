/**
 * importTrail.js — Registrador de vuelo de cada importación (U-9, monitoreo).
 *
 * Cada importación (desde que se elige archivo hasta el recibo) deja una
 * traza ordenada de eventos compactos: extracción, análisis, validación,
 * cada corrección del usuario (con valor original → valor), simulación y
 * resultado. Todo queda en localStorage de ESTE navegador (sin red).
 *
 * Privacidad (decisión D3): la traza incluye códigos/nombres del plan
 * (imprescindibles para auditar correcciones) pero JAMÁS identificadores
 * empresariales (companyId, NIT, razones sociales) ni datos de otras empresas.
 * Como el payload es determinista (misma entrada + mismas ops = mismo
 * resultado), la traza + el archivo original permiten REPRODUCIR el payload
 * exacto sin guardarlo (fingerprint como testigo).
 *
 * Puro en lógica; el único efecto es localStorage con try/catch.
 * Límites: MAX_TRAILS=20 bitácoras, MAX_EVENTS=5000 eventos c/u (FIFO con
 * marca de truncado). Sin PII más allá del propio plan en este navegador.
 */

const STORAGE_KEY = 'universalImportTrails';
const MAX_TRAILS = 20;
const MAX_EVENTS = 5000;
const MAX_INLINE_FINGERPRINT_LENGTH = 256;

function storage(store) {
    if (store) return store;
    try {
        if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
        return null;
    } catch {
        return null;
    }
}

/** Inicia la traza de un archivo cargado. */
export function startTrail({ fileName, fileSize = 0, at } = {}) {
    return {
        id: `t_${at !== undefined ? at : Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        at: at !== undefined ? at : Date.now(),
        fileName: fileName ? String(fileName) : '',
        fileSize: Number.isInteger(fileSize) ? fileSize : 0,
        events: []
    };
}

/**
 * Agrega un evento (inmutable). kind: extraction|analysis|validation|
 * override|exclude|include|confirm|resolve|bulk|simulation|result|note.
 * detail: objeto JSON-plain (sin identificadores empresariales).
 */
export function trailEvent(trail, kind, detail = {}, at) {
    if (!trail || typeof trail !== 'object') throw new TypeError('importTrail: trail inválida');
    const safeDetail = detail && typeof detail === 'object' && !Array.isArray(detail)
        ? { ...detail }
        : detail;
    if (safeDetail && typeof safeDetail.fingerprint === 'string' && safeDetail.fingerprint.length > MAX_INLINE_FINGERPRINT_LENGTH) {
        safeDetail.fingerprint = compactFingerprint(safeDetail.fingerprint);
    }
    const event = { kind: String(kind), at: at !== undefined ? at : Date.now(), ...cloneJson(safeDetail) };
    let events = trail.events.concat([event]);
    let truncated = 0;
    if (events.length > MAX_EVENTS) {
        truncated = events.length - MAX_EVENTS;
        events = events.slice(events.length - MAX_EVENTS);
        events.unshift({ kind: 'truncated', at: event.at, dropped: truncated });
    }
    return { ...trail, events };
}

function cloneJson(value) {
    if (value === undefined) return {};
    return JSON.parse(JSON.stringify(value));
}

export function readTrails(store) {
    const ls = storage(store);
    if (!ls) return [];
    try {
        const raw = ls.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function saveTrail(trail, store) {
    const ls = storage(store);
    if (!trail || !ls) return false;
    const trails = readTrails(ls).filter(t => t && t.id !== trail.id);
    trails.push(trail);
    while (trails.length > MAX_TRAILS) trails.shift();

    // localStorage quotas differ by browser. Preserve the current import by
    // evicting older trails only when the write would otherwise fail.
    while (trails.length > 0) {
        try {
            ls.setItem(STORAGE_KEY, JSON.stringify(trails));
            return true;
        } catch {
            if (trails.length === 1) return false;
            trails.shift();
        }
    }
    return false;
}

/** Compact deterministic signature for large canonical JSON fingerprints. */
export function compactFingerprint(value) {
    const text = String(value);
    let hashA = 0x811c9dc5;
    let hashB = 0x9e3779b9;
    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
        hashB = Math.imul(hashB ^ (code + i), 0x85ebca6b) >>> 0;
    }
    return `u9fp1:${text.length}:${hashA.toString(16).padStart(8, '0')}${hashB.toString(16).padStart(8, '0')}`;
}

export function clearTrails(store) {
    const ls = storage(store);
    if (!ls) return false;
    try {
        ls.removeItem(STORAGE_KEY);
        return true;
    } catch {
        return false;
    }
}

export function countTrails(store) {
    return readTrails(store).length;
}
