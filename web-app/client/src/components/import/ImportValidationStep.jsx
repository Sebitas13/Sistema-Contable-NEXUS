/**
 * ImportValidationStep.jsx — Paso 3 del UniversalImportWizard: validación + simulación.
 *
 * Presentacional: muestra el veredicto de los gates (ImportSession) y del
 * validador externo (engine) sobre el Effective Contract, y el payload que SE
 * ENVIARÍA (en memoria, sin POST). No decide nada: solo presenta.
 */

import React, { useMemo, useState } from 'react';
import { canImportReport, summaryOf, effectiveContractOf, simulate } from '../../importSession/index.js';
import { ImportContractValidator } from '../../utils/ImportContractValidator.js';

function reasonTone(reason) {
    if (reason.includes('BLOCK')) return 'danger';
    if (reason.includes('silentCorruptionCount') || reason.includes('unaccountedRows')) return 'danger';
    return 'warning';
}

function reasonIcon(reason) {
    if (reason.includes('BLOCK')) return 'bi-x-octagon';
    if (reason.includes('REVIEW')) return 'bi-eye';
    if (reason.includes('UNKNOWN') || reason.includes('Naturalezas')) return 'bi-question-circle';
    return 'bi-exclamation-triangle';
}

export default function ImportValidationStep({ session, onBack, onNext }) {
    const [tab, setTab] = useState('issues'); // issues | simulation

    const report = useMemo(() => canImportReport(session), [session]);
    const summary = useMemo(() => summaryOf(session), [session]);
    const effective = useMemo(() => effectiveContractOf(session), [session]);
    const external = useMemo(() => ImportContractValidator.validate(effective), [effective]);
    const sim = useMemo(() => simulate(session, { companyId: null }), [session]);

    const blocks = (effective.errors || []).filter(e => e && e.severity === 'BLOCK');
    const activeRegionId = session.activeRegionId;
    const confirmedCount = session.natureConfirmations.filter(e => e.regionId === activeRegionId).length;
    const sample = sim.payload && Array.isArray(sim.payload.accounts) ? sim.payload.accounts.slice(0, 10) : [];
    const fingerprint = sim.fingerprint || external.fingerprint || null;

    return (
        <div data-testid="u2-validation">
            <div className={`alert ${report.can ? 'alert-success' : 'alert-danger'}`} data-testid="u2-val-gate">
                <i className={`bi ${report.can ? 'bi-check-circle' : 'bi-x-octagon'} me-2`}></i>
                {report.can
                    ? <><strong>Contrato válido para continuar.</strong> Sin bloqueos ni revisiones pendientes.</>
                    : <><strong>No se puede continuar todavía.</strong> Hay {report.reasons.length} punto(s) por resolver. Se resuelven en el paso de revisión.</>}
            </div>

            <div className="card glass-panel border-secondary mb-3">
                <div className="card-body py-2 small d-flex flex-wrap gap-2 align-items-center">
                    <span className="text-white-50">Validador externo del engine:</span>
                    <span className={`badge ${external.valid ? 'bg-success' : 'bg-danger'}`}>{external.valid ? 'PASS' : 'BLOQUEADO'}</span>
                    <span className="text-white-50">errores: <strong className="text-white">{external.errors.length}</strong></span>
                    <span className="text-white-50">warnings: <strong className="text-white">{external.warnings.length}</strong></span>
                </div>
            </div>

            <div className="btn-group mb-3" role="group" aria-label="Validación o simulación">
                <button type="button" data-testid="u2-val-tab-issues" className={`btn ${tab === 'issues' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setTab('issues')}>
                    <i className="bi bi-list-check me-1"></i>Validación ({report.reasons.length + blocks.length > 0 ? report.reasons.length : 'ok'})
                </button>
                <button type="button" data-testid="u2-val-tab-sim" className={`btn ${tab === 'simulation' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setTab('simulation')}>
                    <i className="bi bi-play-circle me-1"></i>Simulación (sin escribir)
                </button>
            </div>

            {tab === 'issues' && (
                <div data-testid="u2-val-issues">
                    {blocks.length > 0 && (
                        <div className="card border-danger mb-3">
                            <div className="card-header bg-danger bg-opacity-10 py-2">
                                <small className="fw-bold text-danger"><i className="bi bi-x-octagon me-2"></i>Bloqueantes ({blocks.length}) — impiden importar</small>
                            </div>
                            <div className="card-body p-0">
                                <div className="table-responsive">
                                    <table className="table table-sm table-dark table-striped mb-0" style={{ fontSize: '0.85rem' }}>
                                        <thead><tr><th>Tipo</th><th>Código</th><th>Detalle</th></tr></thead>
                                        <tbody>
                                            {blocks.slice(0, 10).map((e, i) => (
                                                <tr key={i}>
                                                    <td><span className="badge bg-danger">{e.type}</span></td>
                                                    <td className="font-monospace">{e.code || `${e.from || ''}→${e.to || ''}`}</td>
                                                    <td className="small text-white-50">{(e.message || '').slice(0, 120)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {report.reasons.length > 0 ? (
                        <div className="list-group">
                            {report.reasons.map((r, i) => {
                                const tone = reasonTone(r);
                                const bar = tone === 'danger' ? 'var(--bs-danger)' : 'var(--bs-warning)';
                                const icon = tone === 'danger' ? 'text-danger' : 'text-warning';
                                return (
                                    <div key={i} className="list-group-item bg-dark text-white border-secondary d-flex gap-2 align-items-start" style={{ borderLeft: `3px solid ${bar}` }}>
                                        <i className={`bi ${reasonIcon(r)} mt-1 ${icon}`}></i>
                                        <span className="small">{r}</span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="alert alert-success"><i className="bi bi-check-circle me-2"></i>Sin puntos pendientes.</div>
                    )}

                    {external.warnings.length > 0 && (
                        <small className="text-white-50 d-block mt-2">Avisos del validador ({external.warnings.length}): {(external.warnings.slice(0, 2).join(' · ') || '').slice(0, 160)}</small>
                    )}
                </div>
            )}

            {tab === 'simulation' && (
                <div data-testid="u2-val-simulation">
                    <div className={`alert ${sim.allowed ? 'alert-success' : 'alert-warning'}`} data-testid="u2-sim-allowed">
                        <i className={`bi ${sim.allowed ? 'bi-check-circle' : 'bi-pause-circle'} me-2`}></i>
                        {sim.allowed
                            ? <><strong>Simulación exitosa.</strong> El payload está listo en memoria. Nada se ha enviado.</>
                            : <><strong>Simulación bloqueada:</strong> {sim.reason || 'revisa la pestaña Validación.'} Nada se ha enviado.</>}
                    </div>

                    <div className="row g-3">
                        <div className="col-md-6">
                            <div className="card glass-panel border-secondary h-100">
                                <div className="card-header bg-secondary bg-opacity-25 py-2">
                                    <small className="fw-bold"><i className="bi bi-box me-2"></i>Payload en memoria</small>
                                </div>
                                <div className="card-body small">
                                    {/* Nombre del endpoint destino: solo texto informativo, jamás se invoca (cero red). */}
                                    <div>Destino: <code>POST /api/accounts/bulk</code> <span className="badge bg-secondary ms-1">no llamado</span></div>
                                    <div className="mt-1">Registros: <strong>{sim.expectedCounts ? sim.expectedCounts.total : sim.effectiveNodeCount}</strong>
                                        {sim.expectedCounts && <span className="text-white-50"> (raíces {sim.expectedCounts.roots} · grupos {sim.expectedCounts.groups} · hojas {sim.expectedCounts.leaves})</span>}</div>
                                    <div className="mt-1">Naturalezas confirmadas en esta región: <strong>{confirmedCount}</strong></div>
                                    <div className="mt-1 text-white-50">Fingerprint: {fingerprint ? <code title={fingerprint} data-testid="u2-sim-fingerprint">{String(fingerprint).slice(0, 24)}…</code> : '—'}</div>
                                </div>
                            </div>
                        </div>
                        <div className="col-md-6">
                            <div className="card glass-panel border-secondary h-100">
                                <div className="card-header bg-secondary bg-opacity-25 py-2">
                                    <small className="fw-bold"><i className="bi bi-clipboard-data me-2"></i>Reconciliación previa</small>
                                </div>
                                <div className="card-body small">
                                    <div>Nodos efectivos: <strong>{summary.nodeCounts.effective}</strong> de {summary.nodeCounts.original} originales (excluidas: {summary.nodeCounts.excluded})</div>
                                    <div className="mt-1">Corrupción silenciosa: <strong>{summary.dataLoss.silentCorruptionCount}</strong> · Sin contabilizar: <strong>{summary.dataLoss.unaccountedRows}</strong></div>
                                    <div className="mt-1 text-white-50">Overrides: {summary.userActions.overrides} · Exclusiones: {summary.userActions.exclusions}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {sample.length > 0 && (
                        <div className="card bg-dark border-secondary mt-3">
                            <div className="card-header bg-secondary bg-opacity-25 py-2">
                                <small className="fw-bold text-muted">Muestra del payload (primeros {sample.length})</small>
                            </div>
                            <div className="card-body p-0">
                                <div className="table-responsive">
                                    <table className="table table-sm table-striped mb-0" style={{ fontSize: '0.85rem' }}>
                                        <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Nivel</th><th>Padre</th></tr></thead>
                                        <tbody>
                                            {sample.map((a, i) => (
                                                <tr key={i}>
                                                    <td className="font-monospace">{a.code}</td>
                                                    <td>{(a.name || '').slice(0, 50)}</td>
                                                    <td><span className="badge bg-info text-dark">{a.type}</span></td>
                                                    <td className="text-center">{a.level}</td>
                                                    <td className="font-monospace text-muted">{a.parent_code || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="d-flex justify-content-between pt-3 mt-3 border-top">
                <button type="button" data-testid="u2-back-btn" className="btn btn-outline-secondary px-4" onClick={onBack}>
                    <i className="bi bi-arrow-left me-2"></i>Atrás
                </button>
                <button type="button" data-testid="u2-next-btn" className="btn btn-premium px-4" onClick={onNext}>
                    Continuar a revisión <i className="bi bi-arrow-right ms-2"></i>
                </button>
            </div>
        </div>
    );
}
