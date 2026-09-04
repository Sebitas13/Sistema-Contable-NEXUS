/**
 * ImportContractSchema.js — Versionado del contrato y utilidades de fingerprint.
 *
 * El ImportContract es la ÚNICA fuente de verdad entre el analyzer y el
 * importer/wizard. Cualquier cambio de forma DEBE subir CONTRACT_VERSION y
 * quedar registrado aquí. El validator rechaza contratos con versiones
 * desconocidas.
 */

export const CONTRACT_SCHEMA_VERSION = '1.0';      // forma del JSON del contrato
export const ANALYZER_VERSION = '2.1.0';           // versión del UniversalPlanAnalyzer
export const VALIDATOR_VERSION = '1.0';            // versión del ImportContractValidator

/** Versión que el pipeline completo espera hoy. */
export const SUPPORTED_CONTRACT_VERSION = CONTRACT_SCHEMA_VERSION;

/**
 * Fingerprint canónico: serializa un objeto con claves ordenadas
 * recursivamente. Independiente del orden accidental de objetos JS.
 * Claves ignorables (no deterministas o metadata no semántica) se excluyen.
 */
export function canonicalStringify(value, { sortKeys = true, ignoredKeys = [] } = {}) {
    if (value === null || value === undefined) return 'null';
    const t = typeof value;
    if (t === 'number' || t === 'boolean') return String(value);
    if (t === 'string') return JSON.stringify(value);
    if (t === 'function' || t === 'symbol') return '"<fn>"';

    if (Array.isArray(value)) {
        return '[' + value.map(v => canonicalStringify(v, { sortKeys, ignoredKeys })).join(',') + ']';
    }

    // Objeto: claves ordenadas, excluyendo ignoradas
    const keys = Object.keys(value)
        .filter(k => !ignoredKeys.includes(k))
        .sort(sortKeys ? undefined : () => 0);
    const parts = keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(value[k], { sortKeys, ignoredKeys }));
    return '{' + parts.join(',') + '}';
}

/** Fingerprint del ImportContract (excluye metadata volátil). */
export function contractFingerprint(contract) {
    return canonicalStringify(contract, {
        ignoredKeys: ['source', 'transformations', 'requiresConfirmation', 'confidence', 'columnMapping']
    });
}

/** Fingerprint semántico de los nodos (lo que realmente se importará). */
export function nodesFingerprint(nodes) {
    const sorted = [...nodes].sort((a, b) => {
        const ca = String(a.normalizedCode ?? a.code ?? '');
        const cb = String(b.normalizedCode ?? b.code ?? '');
        if (ca !== cb) return ca.localeCompare(cb);
        // Tiebreaker determinista para nodos con el mismo código (duplicados)
        const na = String(a.name ?? '');
        const nb = String(b.name ?? '');
        if (na !== nb) return na.localeCompare(nb);
        return String(a.parent ?? '').localeCompare(String(b.parent ?? ''));
    });
    return canonicalStringify(sorted.map(n => ({
        code: n.normalizedCode ?? n.code,
        name: n.name ?? '',
        level: n.level ?? null,
        parent: n.parent ?? null,
        type: n.type ?? '',
        nature: n.nature ? (n.nature.value ?? n.nature) : null
    })));
}
