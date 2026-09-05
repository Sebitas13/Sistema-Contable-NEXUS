/**
 * ImportSummaryStep.jsx — Paso 5 del UniversalImportWizard: resumen final.
 *
 * Reconciliación visual ANTES de importar. Todos los números vienen del
 * Contract real (summaryOf) y del Effective Contract. La barrera para
 * continuar es estricta: sin BLOCK/REVIEW pendientes, silent=0 y
 * unaccounted=0. Muestra el fingerprint antes/después de overrides.
 */

import React, { useMemo } from 'react';
import { summaryOf, effectiveContractOf, canImport } from '../../importSession/index.js';
import { contractFingerprint } from '../../utils/ImportContractSchema.js';

function Row({ label, value, tone }) {
    return (
        <div className="d-flex justify-content-between py-1 border-bottom">
            <span className="text-white-50">{label}</span>
            <strong className={tone === 'bad' ? 'text-danger' : (tone === 'good' ? 'text-success' : '')}>{value}</strong>
        </div>
    );
}

export default function ImportSummaryStep({ session, onBack, onNext }) {
    const summary = useMemo(() => summaryOf(session), [session]);
    const effective = useMemo(() => effectiveContractOf(session), [session]);
    const can = useMemo(() => canImport(session), [session]);
    const fingerprints = useMemo(() => {
        const region = session.regions.find(r => r.regionId === session.activeRegionId);
        let original = null, final = null;
        try { original = contractFingerprint(region.contract); } catch { original = null; }
        try { final = contractFingerprint(effective); } catch { final = null; }
        return { original, final };
    }, [session, effective]);

    const issues = summary.issues;
    const dl = summary.dataLoss;
    const dupCount = (effective.errors || []).filter(e => e && e.type && String(e.type).toLowerCase().includes('duplicate')).length;
    const gateOk = can && (dl.silentCorruptionCount ?? 0) === 0 && (dl.unaccountedRows ?? 0) === 0;

    return (
        <div data-testid="u2-summary">
            <div className={`alert ${gateOk ? 'alert-success' : 'alert-danger'}`} data-testid="u2-sum-gate">
                <i className={`bi ${gateOk ? 'bi-check-circle' : 'bi-x-octagon'} me-2`}></i>
                {gateOk
                    ? <><strong>Reconciliación completa.</strong> Puedes continuar a la confirmación final.</>
                    : <><strong>Aún no puedes continuar.</strong> Vuelve a la revisión y resuelve los puntos pendientes.</>}
            </div>

            <div className="row g-3">
                <div className="col-md-6">
                    <div className="card glass-panel border-secondary h-100">
                        <div className="card-header bg-secondary bg-opacity-25 py-2">
                            <small className="fw-bold"><i className="bi bi-clipboard-data me-2"></i>Filas detectadas</small>
                        </div>
                        <div className="card-body small">
                            <Row label="Filas totales del archivo" value={summary.reconciliation.rowsTotal} />
                            <Row label="Válidas (se importan)" value={summary.nodeCounts.effective} tone="good" />
                            <Row label="Rechazadas con motivo" value={summary.reconciliation.rejectedRows} />
                            <Row label="Excluidas por ti" value={summary.nodeCounts.excluded} />
                            <Row label="Sin contabilizar" value={dl.unaccountedRows ?? 0} tone={(dl.unaccountedRows ?? 0) ? 'bad' : 'good'} />
                            <Row label="Corrupción silenciosa" value={dl.silentCorruptionCount ?? 0} tone={(dl.silentCorruptionCount ?? 0) ? 'bad' : 'good'} />
                        </div>
                    </div>
                </div>
                <div className="col-md-6">
                    <div className="card glass-panel border-secondary h-100">
                        <div className="card-header bg-secondary bg-opacity-25 py-2">
                            <small className="fw-bold"><i className="bi bi-diagram-3 me-2"></i>Nodos finales</small>
                        </div>
                        <div className="card-body small">
                            <Row label="Nodos a importar" value={summary.nodeCounts.effective} tone="good" />
                            <Row label="Raíces / Grupos / Hojas" value={`${summary.nodeCounts.roots} / ${summary.nodeCounts.groups} / ${summary.nodeCounts.leaves}`} />
                            <Row label="Transformadas" value={summary.reconciliation.transformedNodes} />
                            <Row label="Duplicados bloqueantes" value={dupCount} tone={dupCount ? 'bad' : 'good'} />
                            <Row label="Bloqueadas (BLOCK)" value={issues.blocks} tone={issues.blocks ? 'bad' : 'good'} />
                            <Row label="En revisión" value={(issues.reviewWarningsUnresolved || 0) + (issues.nodeReviewsUnresolved || 0)} tone={((issues.reviewWarningsUnresolved || 0) + (issues.nodeReviewsUnresolved || 0)) ? 'bad' : 'good'} />
                        </div>
                    </div>
                </div>
                <div className="col-12">
                    <div className="card glass-panel border-secondary">
                        <div className="card-header bg-secondary bg-opacity-25 py-2">
                            <small className="fw-bold"><i className="bi bi-fingerprint me-2"></i>Trazabilidad del contrato</small>
                        </div>
                        <div className="card-body small">
                            <div>Original (engine): {fingerprints.original ? <code title={fingerprints.original} data-testid="u2-fp-orig">{String(fingerprints.original).slice(0, 24)}…</code> : '—'}</div>
                            <div className="mt-1">Final (con tus cambios): {fingerprints.final ? <code title={fingerprints.final} data-testid="u2-fp-eff">{String(fingerprints.final).slice(0, 24)}…</code> : '—'}</div>
                            <div className="mt-1 text-white-50">
                                Overrides: <strong className="text-white">{summary.userActions.overrides}</strong> ·
                                Exclusiones: <strong className="text-white">{summary.userActions.exclusions}</strong> ·
                                Naturalezas confirmadas: <strong className="text-white">{summary.userActions.natureConfirmations}</strong> ·
                                Revisiones resueltas: <strong className="text-white">{summary.userActions.reviewResolutions}</strong>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="d-flex justify-content-between pt-3 mt-3 border-top">
                <button type="button" data-testid="u2-back-btn" className="btn btn-outline-secondary px-4" onClick={onBack}>
                    <i className="bi bi-arrow-left me-2"></i>Atrás
                </button>
                <button type="button" data-testid="u2-next-btn" className="btn btn-premium px-4" onClick={onNext} disabled={!gateOk}
                    title={gateOk ? 'Ver exactamente qué se enviará' : 'Resuelve los puntos pendientes para continuar'}>
                    Ver qué se enviará <i className="bi bi-arrow-right ms-2"></i>
                </button>
            </div>
        </div>
    );
}
