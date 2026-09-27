/**
 * companyStructure.js — Derivación pura de code_mask/plan_structure.
 *
 * Convierte la jerarquía declarada por el Effective Contract en la forma que
 * el endpoint PUT /api/companies/:id ya acepta (misma fórmula que el
 * asistente clásico). Pura: sin React, sin red.
 *
 * REGLA: jerarquía desconocida o longitudes lógicas no representables → null y
 * se omite el PUT. El ancho físico nunca sustituye longitudes por nivel.
 */

export function deriveCompanyStructure(effective) {
    if (!effective || typeof effective !== 'object') return null;
    const hierarchy = effective.hierarchy || {};
    if (hierarchy.status === 'UNKNOWN') return null;
    const sep = effective.separator || null;
    const levelLengths = Array.isArray(hierarchy.logicalLevelLengths)
        ? hierarchy.logicalLevelLengths.slice()
        : [effective.levels, hierarchy.levelLengths]
            .find(lengths => Array.isArray(lengths) && lengths.length > 0)?.slice() || [];
    const observedCodeLengths = (hierarchy.observedCodeLengths || []).slice();
    const levelCount = Number.isInteger(hierarchy.levelCount) ? hierarchy.levelCount : levelLengths.length;
    if (!levelLengths.length || levelCount !== levelLengths.length) return null;
    const codeMask = sep
        ? levelLengths.map((len, i) => '#'.repeat(Math.max(1, len - (i > 0 ? levelLengths[i - 1] : 0)))).join(sep)
        : '#'.repeat(Math.max(1, ...levelLengths));
    if (!codeMask) return null;
    return {
        code_mask: codeMask,
        plan_structure: JSON.stringify({
            regex: sep ? `^\\d+(?:\\${sep}\\d+)*$` : '^\\d+$',
            separator: sep,
            levelsCount: levelCount,
            levelLengths,
            observedCodeLengths,
            hierarchySource: hierarchy.status,
            behavior: { strictlyNumerical: true }
        })
    };
}
