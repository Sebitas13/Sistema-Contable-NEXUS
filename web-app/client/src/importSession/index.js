/**
 * importSession — API pública de la capa de dominio de la sesión de importación.
 *
 * Capa pura (Fase 7 U-1): sin React, sin DOM, sin red, sin I/O y sin
 * almacenamiento persistente del navegador.
 *
 * Uso típico (desde el wizard, en el futuro):
 *
 *   import { createImportSession, selectRegion, applyOverride, excludeRow,
 *            confirmNature, resolveReview, effectiveContractOf,
 *            simulate, canImport, canImportReport, summaryOf } from './importSession';
 *
 *   let session = createImportSession({ source, extraction, regions: analysis.regions });
 *   session = applyOverride(session, 'tabla_0:4', 'type', 'Pasivo');
 *   session = excludeRow(session, 'narrative:120');
 *   const can = canImport(session);
 *   const report = simulate(session, { companyId });
 */

export {
    createImportSession,
    selectRegion,
    applyOverride,
    excludeRow,
    confirmNature,
    resolveReview,
    effectiveContractOf,
    simulate,
    canImport,
    canImportReport,
    summaryOf,
    applyExclusions
} from './createImportSession.js';
