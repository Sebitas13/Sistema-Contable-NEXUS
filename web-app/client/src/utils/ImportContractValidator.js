/**
 * ImportContractValidator.js — Validador independiente del ImportContract.
 *
 * Garantías que verifica (todas deben pasar o el contrato se BLOQUEA):
 *
 *  1. Versión de schema conocida y soportada.
 *  2. Estructura y tipos mínimos.
 *  3. Todos los nodos con code/normalizedCode/rawCode y transformaciones
 *     coherentes (raw != normalized ⟹ transformations NO vacía).
 *  4. Sin ciclos de parent (DFS).
 *  5. Sin duplicateCode ni normalized-conflict con severidad BLOCK.
 *  6. Level y classification coherentes con la presencia de hijos.
 *  7. isPostable y naturaleza con valores válidos.
 *  8. rootNodes realmente raíces (nivel 1 sin padre).
 *  9. stats/rowCounts coherentes con nodes (reconciliación de filas).
 * 10. requiresConfirmation se activa si hay naturalezas INFERRED/ambigüedad.
 * 11. silentCorruptionCount === 0 y unaccountedRows === 0 (invariantes).
 * 12. warnings/errors no contradicen el estado (un BLOCK implica no-confirmado).
 *
 * Resultado: { valid, errors[], warnings[], blocks[] }
 */

import {
    SUPPORTED_CONTRACT_VERSION,
    nodesFingerprint
} from './ImportContractSchema.js';

const VALID_NATURES = ['EXPLICIT', 'INFERRED', 'INHERITED', 'USER_DEFINED', 'UNKNOWN'];
const VALID_CLASSIFICATIONS = ['ROOT', 'GROUP', 'LEAF', 'MIXED', 'UNKNOWN'];
const VALID_POSTABLE = ['EXPLICIT_TRUE', 'EXPLICIT_FALSE', 'INFERRED_TRUE', 'INFERRED_FALSE', 'UNKNOWN'];

export class ImportContractValidator {
    /**
     * @param {Object} contract  ImportContract a validar
     * @param {Object} [opts]
     * @param {boolean} [opts.requireVersion=true]  exige contractVersion soportada
     * @returns {{valid:boolean, errors:string[], warnings:string[], blocks:string[], fingerprint:string|null}}
     */
    static validate(contract, opts = {}) {
        const { requireVersion = true } = opts || {};
        const errors = [];
        const warnings = [];

        // ── 1) Versión ────────────────────────────────────────────
        if (!contract || typeof contract !== 'object') {
            return { valid: false, errors: ['Contrato nulo o no-objeto'], warnings: [], blocks: [], fingerprint: null };
        }
        if (requireVersion) {
            const v = contract.contractVersion || contract.schemaVersion;
            if (!v) errors.push('contractVersion/schemaVersion ausente');
            else if (v !== SUPPORTED_CONTRACT_VERSION) errors.push(`Versión de contrato ${v} no soportada (esperada ${SUPPORTED_CONTRACT_VERSION})`);
        }
        if (!Array.isArray(contract.nodes)) errors.push('nodes no es array');

        if (errors.length > 0) {
            return { valid: false, errors, warnings, blocks: errors, fingerprint: null };
        }

        const nodes = contract.nodes;
        const errorsSev = (contract.errors || []).filter(e => e.severity === 'BLOCK');
        const byCode = new Map();

        // ── 3) Nodos: campos mínimos + transformaciones auditables ──
        nodes.forEach((n, i) => {
            const tag = `node[${i}] (${n.normalizedCode || n.rawCode || n.code || '?'})`;
            if (n.code === undefined && n.normalizedCode === undefined) errors.push(`${tag}: sin code/normalizedCode`);
            if (n.rawCode === undefined) errors.push(`${tag}: rawCode no preservado`);
            const code = n.normalizedCode ?? n.code;
            if (code !== undefined && byCode.has(String(code))) {
                warnings.push(`${tag}: código duplicado en nodes (${code})`);
            }
            if (code !== undefined) byCode.set(String(code), n);
            // raw != normalized → transformations obligatoria
            const raw = String(n.rawCode ?? '');
            const norm = String(n.normalizedCode ?? n.code ?? '');
            if (raw !== norm && (!Array.isArray(n.transformations) || n.transformations.length === 0)) {
                errors.push(`${tag}: rawCode difiere de normalizedCode sin transformations (corrupción silenciosa)`);
            }
            if (n.requiresReview === undefined) warnings.push(`${tag}: sin flag requiresReview`);
        });

        // ── 4) Ciclos de parent (DFS sobre normalizedCode) ─────────
        const parentOf = new Map();
        nodes.forEach(n => {
            const code = n.normalizedCode ?? n.code;
            if (code !== undefined && n.parent) parentOf.set(String(code), String(n.parent));
        });
        const visiting = new Set();
        const done = new Set();
        const findCycle = (code, path) => {
            if (done.has(code)) return null;
            if (visiting.has(code)) {
                const idx = path.indexOf(code);
                return path.slice(idx).concat([code]);
            }
            visiting.add(code);
            const p = parentOf.get(code);
            if (p && parentOf.has(p)) {
                const cycle = findCycle(p, [...path, code]);
                if (cycle) { visiting.delete(code); return cycle; }
            }
            visiting.delete(code);
            done.add(code);
            return null;
        };
        for (const code of parentOf.keys()) {
            const cycle = findCycle(code, [code]);
            if (cycle) { errors.push(`Ciclo detectado: ${cycle.join(' → ')}`); break; }
        }

        // ── 5) BLOCKs de errores ya presentes ─────────────────────
        const dupBlocks = errorsSev.filter(e => e.type === 'duplicateCode' || e.type === 'normalizedDuplicate' || e.type === 'cycle' || e.type === 'explicitMissingParent');
        dupBlocks.forEach(e => errors.push(`BLOCK presente: ${e.type} — ${e.message || ''}`));

        // ── 6/7) classification, level, isPostable, naturaleza ─────
        nodes.forEach((n, i) => {
            const code = n.normalizedCode ?? n.code;
            const hasChildren = nodes.some(o => o.parent && code !== undefined && String(o.parent) === String(code));
            const level = n.level;
            if (n.classification && !VALID_CLASSIFICATIONS.includes(n.classification)) {
                errors.push(`node ${code}: classification inválida ${n.classification}`);
            } else if (n.classification === 'LEAF' && hasChildren) {
                errors.push(`node ${code}: LEAF pero tiene hijos`);
            } else if ((n.classification === 'ROOT' || n.classification === 'GROUP') && !hasChildren && level > 1 && n.classification === 'GROUP') {
                warnings.push(`node ${code}: GROUP sin hijos (posible inconsistencia)`);
            }
            if (level === 1 && n.parent) warnings.push(`node ${code}: nivel 1 con padre (${n.parent})`);
            if (level !== undefined && (!Number.isInteger(level) || level < 1)) errors.push(`node ${code}: level inválido ${level}`);
            if (n.isPostable && !VALID_POSTABLE.includes(n.isPostable)) errors.push(`node ${code}: isPostable inválido ${n.isPostable}`);
            if (n.nature && typeof n.nature === 'object') {
                const kind = n.nature.kind || n.nature.nature;
                if (kind && !VALID_NATURES.includes(kind)) errors.push(`node ${code}: naturaleza inválida ${kind}`);
            }
        });

        // ── 8) rootNodes ──────────────────────────────────────────
        if (Array.isArray(contract.rootNodes)) {
            contract.rootNodes.forEach(rn => {
                const code = rn.normalizedCode ?? rn.code;
                const node = byCode.get(String(code));
                if (!node) errors.push(`rootNode ${code} no existe en nodes`);
                else if ((node.level ?? 1) !== 1) errors.push(`rootNode ${code} no tiene level 1 (level=${node.level})`);
                else if (node.parent) errors.push(`rootNode ${code} tiene padre (${node.parent})`);
            });
        }

        // ── 9) Reconciliación de filas / stats ────────────────────
        const rowsTotal = contract.rowsTotal ?? (contract.stats && contract.stats.totalRows) ?? (contract.source && contract.source.rowCount);
        const validRows = nodes.length;
        const rejected = Array.isArray(contract.rejectedRows) ? contract.rejectedRows.length : (contract.droppedRows ? contract.droppedRows.length : 0);
        if (rowsTotal !== undefined && rowsTotal > 0) {
            if (rowsTotal !== validRows + rejected) {
                errors.push(`Reconciliación rota: rowsTotal=${rowsTotal} ≠ valid=${validRows} + rejected=${rejected} (unaccounted=${rowsTotal - validRows - rejected})`);
            }
        }
        if (contract.stats && contract.stats.total !== undefined && contract.stats.total !== nodes.length) {
            errors.push(`stats.total (${contract.stats.total}) ≠ nodes.length (${nodes.length})`);
        }
        if (contract.nodeCounts) {
            const roots = nodes.filter(n => n.classification === 'ROOT').length;
            const leaves = nodes.filter(n => n.classification === 'LEAF').length;
            const groups = nodes.filter(n => n.classification === 'GROUP').length;
            if (contract.nodeCounts.roots !== roots) errors.push(`nodeCounts.roots (${contract.nodeCounts.roots}) ≠ real (${roots})`);
            if (contract.nodeCounts.leaves !== leaves) errors.push(`nodeCounts.leaves (${contract.nodeCounts.leaves}) ≠ real (${leaves})`);
            if (contract.nodeCounts.groups !== groups) errors.push(`nodeCounts.groups (${contract.nodeCounts.groups}) ≠ real (${groups})`);
        }

        // ── 10) requiresConfirmation ──────────────────────────────
        const inferredRoots = nodes.filter(n =>
            n.classification === 'ROOT' &&
            (!n.nature || n.nature === 'INFERRED' || (typeof n.nature === 'object' && (n.nature.kind === 'INFERRED' || n.nature.nature === 'INFERRED')))
        );
        // La regla del margen de ambigüedad SOLO aplica cuando el mapeo de
        // columnas se decidió por scoring (no cuando fue explícito/dado).
        const mapping = contract.columnMapping || {};
        const mappingWasScored = mapping.ambiguous === true || mapping.scored === true;
        const margin = contract.confidence && contract.confidence.ambiguityMargin;
        const ambiguous = mappingWasScored && margin !== undefined && margin < 0.1;
        if (inferredRoots.length > 0 && !contract.requiresConfirmation) {
            errors.push('requiresConfirmation=false pero hay raíces con naturaleza INFERRED');
        }
        if (ambiguous && !contract.requiresConfirmation) {
            errors.push('requiresConfirmation=false pero column-mapping ambiguo (margen < 0.1)');
        }
        // BLOCKs implican que no debe estar "confirmado"
        if (errorsSev.length > 0 && contract.requiresConfirmation === false) {
            errors.push('Hay BLOCKs pero requiresConfirmation=false (contradicción)');
        }

        // ── 11) Invariantes de corrupción / pérdida ───────────────
        const silC = contract.silentCorruptionCount;
        if (silC !== 0) errors.push(`silentCorruptionCount=${silC} (debe ser 0)`);
        if (contract.dataLoss) {
            if (contract.dataLoss.unaccountedRows !== undefined && contract.dataLoss.unaccountedRows !== 0) {
                errors.push(`unaccountedRows=${contract.dataLoss.unaccountedRows} (debe ser 0)`);
            }
            if (contract.dataLoss.silentTransformationCount !== undefined && contract.dataLoss.silentTransformationCount !== 0) {
                errors.push(`silentTransformationCount=${contract.dataLoss.silentTransformationCount}`);
            }
        }

        // ── 12) Fingerprint ───────────────────────────────────────
        let fingerprint = null;
        try { fingerprint = nodesFingerprint(nodes); } catch { /* no bloqueante */ }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            blocks: errors,
            fingerprint
        };
    }
}
