/**
 * importLog.js — Bitácora local de importaciones universales (U-9, monitoreo).
 *
 * Persistencia mínima en localStorage (cap 50, FIFO) para demostrar el período
 * controlado sin telemetría remota. Sin PII: jamás guarda nombres de cuenta,
 * códigos, ni identificadores de empresa (decisión D3: solo evidencia del
 * importador). Puro en lógica; el único efecto es localStorage con try/catch.
 *
 * Entrada: { at, fileName, nodes, successCount, errorCount, companyPut, fp, status }
 *   status: 'completed' | 'cancelled' | 'failed'
 *   companyPut: 'updated' | 'failed' | 'skipped'
 */

const STORAGE_KEY = 'universalImportLog';
const MAX_ENTRIES = 50;

function storage() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
        return null;
    } catch {
        return null;
    }
}

export function readImportLog() {
    const ls = storage();
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

export function appendImportLog(entry) {
    const ls = storage();
    const record = {
        at: entry && entry.at !== undefined ? entry.at : Date.now(),
        fileName: entry && entry.fileName ? String(entry.fileName) : '',
        nodes: entry && Number.isInteger(entry.nodes) ? entry.nodes : 0,
        successCount: entry && Number.isInteger(entry.successCount) ? entry.successCount : 0,
        errorCount: entry && Number.isInteger(entry.errorCount) ? entry.errorCount : 0,
        companyPut: ['updated', 'failed', 'skipped'].includes(entry && entry.companyPut) ? entry.companyPut : 'skipped',
        fp: entry && entry.fp ? String(entry.fp).slice(0, 32) : null,
        status: ['completed', 'cancelled', 'failed'].includes(entry && entry.status) ? entry.status : 'completed'
    };
    if (!ls) return record;
    try {
        const log = readImportLog();
        log.push(record);
        while (log.length > MAX_ENTRIES) log.shift();
        ls.setItem(STORAGE_KEY, JSON.stringify(log));
    } catch {
        // almacenamiento no disponible: se pierde el registro, no la importación
    }
    return record;
}

export function countImportLog() {
    return readImportLog().length;
}
