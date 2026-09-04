/**
 * CompatibilityAdapter.js — Puente ImportContract → SmartImportWizard (shadow mode).
 *
 * REGLA DE FASE 4: el Universal Analyzer NO tiene permiso de cambiar la DB.
 * Este adaptador produce EXACTAMENTE la estructura que el wizard legacy
 * espera, de modo que:
 *
 *   Universal Analyzer
 *         ↓
 *   ImportContract
 *         ↓
 *   CompatibilityAdapter.toLegacyView()   ← esto
 *         ↓
 *   SmartImportWizard (flujo existente SIN modificar)
 *
 * Y por separado:
 *   CompatibilityAdapter.toBulkPayload()  → payload /api/accounts/bulk
 *   que se compara 1:1 contra el payload legacy en shadow tests.
 *
 * JAMÁS mutar el contract: este adapter es de solo lectura hacia el contract
 * y produce estructuras nuevas para el wizard.
 */

import { UniversalPlanAnalyzer } from './UniversalPlanAnalyzer.js';

export class CompatibilityAdapter {

    /**
     * ImportContract → vista legacy completa para el wizard.
     * Produce { rawData, columnMapping, structureConfig, previewData, planAnalysis }
     * con la MISMA forma que generan loadSheetData/analyzeStructure/generatePreview.
     */
    static toLegacyView(contract) {
        if (!contract) return null;

        // rawData estilo wizard: [{ excelRow, data: [code, name] }]
        const rawData = contract.nodes.map((n, i) => ({
            excelRow: i + 1,
            data: [n.normalizedCode, n.name ?? '']
        }));

        // columnMapping estilo wizard: índices en el array `data`
        const columnMapping = { code: 0, name: 1, type: 2 };

        // structureConfig estilo wizard, derivado del contract SIN re-inferir
        const sep = contract.separator || null;
        const levelLengths = (contract.levels && contract.levels.length > 0)
            ? contract.levels
            : (contract.hierarchy && contract.hierarchy.levelLengths) || [1, 2, 4];
        const structureConfig = {
            hasSeparator: !!sep,
            separator: sep || '',
            levelCount: levelLengths.length,
            levelLengths,
            levelIncrements: levelLengths.map(() => 1),
            smartZeroCheck: false,
            useCustomLengths: false
        };

        // previewData estilo wizard: { id, code, name, type, confidence, level, parent_code, isDuplicate }
        const seen = new Set();
        const previewData = contract.nodes.map((n, i) => {
            const isDuplicate = seen.has(n.normalizedCode);
            seen.add(n.normalizedCode);
            return {
                id: i + 1,
                code: n.normalizedCode,
                name: n.name,
                type: n.type,
                confidence: n.natureConfidence ?? 0.6,
                level: n.level,
                parent_code: n.parent,
                isDuplicate,
                // Evidencia adicional (el wizard la ignora, los shadow tests la usan)
                _rawCode: n.rawCode,
                _nature: n.nature,
                _classification: n.classification,
                _isPostable: n.isPostable,
                _requiresReview: n.requiresReview
            };
        });

        // planAnalysis estilo wizard (lo que AccountPlanProfile.analyze devuelve)
        const planAnalysis = {
            separator: sep,
            mask: this._maskFromLevels(levelLengths, sep),
            regex: this._regexFromLevels(levelLengths, sep),
            levelsCount: levelLengths.length,
            segments: [],
            levelInsights: levelLengths.map((len, i) => ({
                level: i + 1,
                name: `Nivel ${i + 1}`,
                chars: len,
                type: 'Numérico',
                behavior: 'Aumenta secuencialmente (+1)',
                isFixed: false
            })),
            behavior: { strictlyNumerical: true },
            // Datos universales que el legacy no tiene:
            warnings: contract.warnings,
            errors: contract.errors,
            confidence: contract.confidence,
            dataLoss: contract.dataLoss
        };

        return {
            rawData,
            columnMapping,
            structureConfig,
            previewData,
            planAnalysis,
            // Metadatos shadow para comparar contra legacy
            shadowMeta: {
                nodeCount: contract.nodes.length,
                rootCount: contract.nodeCounts.roots,
                requiresConfirmation: contract.requiresConfirmation,
                blocks: (contract.errors || []).filter(e => e.severity === 'BLOCK'),
                warnings: contract.warnings
            }
        };
    }

    /**
     * ImportContract → payload EXACTO para POST /api/accounts/bulk.
     * PREFLIGHT GATE: si hay BLOCK → allowed:false y payload null.
     * Si requiresConfirmation y no hay natureMap confirmado → allowed:false.
     *
     * Este payload se compara 1:1 contra el que produce performImport()
     * en los shadow tests ANTES de permitir cualquier reemplazo.
     */
    static toBulkPayload(contract, companyId, { confirmedNatureMap = null } = {}) {
        // Delegación al gate del analyzer (única fuente de verdad del gate)
        return UniversalPlanAnalyzer.generateBulkPayload(contract, companyId, { confirmedNatureMap });
    }

    /**
     * Comparación shadow: legacyResult vs universalResult.
     * Devuelve { equivalent, differences[], summary } para los golden tests.
     * No opina sobre "quién es correcto": solo reporta divergencias.
     */
    static compareLegacyVsUniversal(legacyPreview, contract, options = {}) {
        const universal = this.toLegacyView(contract);
        const differences = [];

        if (!legacyPreview || legacyPreview.length === 0) {
            if (universal.previewData.length > 0) {
                differences.push({
                    type: 'count_mismatch',
                    detail: `legacy: 0 filas vs universal: ${universal.previewData.length} filas`
                });
            }
            return { equivalent: differences.length === 0, differences, summary: 'legacy vacío' };
        }

        // Mapas por código para comparación por identidad
        const legacyByCode = new Map();
        legacyPreview.forEach(r => legacyByCode.set(String(r.code).trim(), r));
        const universalByCode = new Map();
        universal.previewData.forEach(r => universalByCode.set(String(r.code).trim(), r));

        // Campos a comparar por nodo (los que el importer realmente escribe)
        const fields = options.fields || ['code', 'name', 'type', 'level', 'parent_code'];

        // Solo en legacy
        for (const [code] of legacyByCode) {
            if (!universalByCode.has(code)) {
                differences.push({ type: 'only_in_legacy', code, detail: 'existe en legacy, no en universal' });
            }
        }
        // Solo en universal
        for (const [code] of universalByCode) {
            if (!legacyByCode.has(code)) {
                differences.push({ type: 'only_in_universal', code, detail: 'existe en universal, no en legacy' });
            }
        }
        // Campos divergentes en comunes
        for (const [code, lRow] of legacyByCode) {
            const uRow = universalByCode.get(code);
            if (!uRow) continue;
            for (const f of fields) {
                const lv = String(lRow[f] ?? '').trim();
                const uv = String(uRow[f] ?? '').trim();
                if (lv !== uv) {
                    // parent divergente es tolerable si universal resolvió fuzzy
                    differences.push({ type: 'field_mismatch', code, field: f, legacy: lv, universal: uv });
                }
            }
        }

        return {
            equivalent: differences.length === 0,
            differences,
            summary: {
                legacyCount: legacyPreview.length,
                universalCount: universal.previewData.length,
                matched: Math.min(legacyByCode.size, universalByCode.size) - differences.filter(d => d.type.includes('only_in')).length,
                mismatchedFields: differences.filter(d => d.type === 'field_mismatch').length,
                onlyLegacy: differences.filter(d => d.type === 'only_in_legacy').length,
                onlyUniversal: differences.filter(d => d.type === 'only_in_universal').length
            }
        };
    }

    static _maskFromLevels(levelLengths, sep) {
        if (!levelLengths || levelLengths.length === 0) return '#';
        let prev = 0;
        return levelLengths.map(l => {
            const part = '#'.repeat(Math.max(1, l - prev));
            prev = l;
            return part;
        }).join(sep || '');
    }

    static _regexFromLevels(levelLengths, sep) {
        if (!levelLengths || levelLengths.length === 0) return '^\\d+$';
        let prev = 0;
        const parts = levelLengths.map(l => {
            const part = `\\d{${Math.max(1, l - prev)}}`;
            prev = l;
            return part;
        });
        const s = sep ? `\\${sep}` : '';
        return `^${parts.join(s)}$`;
    }
}
