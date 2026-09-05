/**
 * companyStructure.js — Derivación pura de code_mask/plan_structure.
 *
 * Convierte la jerarquía declarada por el Effective Contract en la forma que
 * el endpoint PUT /api/companies/:id ya acepta (misma fórmula que el
 * asistente clásico). Pura: sin React, sin red.
 *
 * REGLA: si el contrato NO declara longitudes de nivel, devuelve null y el
 * llamador OMITE el PUT. Jamás se inventa una máscara ni se escribe vacía.
 */

export function deriveCompanyStructure(effective) {
    if (!effective || typeof effective !== 'object') return null;
    const sep = effective.separator || null;
    const levelLengths = (effective.levels && effective.levels.length > 0)
        ? effective.levels.slice()
        : ((effective.hierarchy && effective.hierarchy.levelLengths) || []).slice();
    if (!Array.isArray(levelLengths) || levelLengths.length === 0) return null;
    const codeMask = sep
        ? levelLengths.map((len, i) => '#'.repeat(Math.max(1, len - (i > 0 ? levelLengths[i - 1] : 0)))).join(sep)
        : '#'.repeat(levelLengths[levelLengths.length - 1] || 1);
    if (!codeMask) return null;
    return {
        code_mask: codeMask,
        plan_structure: JSON.stringify({
            regex: sep ? `^\\d+(?:\\${sep}\\d+)*$` : '^\\d+$',
            separator: sep,
            levelsCount: levelLengths.length,
            levelLengths,
            behavior: { strictlyNumerical: true }
        })
    };
}
