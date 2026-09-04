/**
 * ImportDiagnosticStep.jsx — Paso 2 del UniversalImportWizard: diagnóstico.
 *
 * Presentacional: RENDERIZA el Contract (y el resumen de ImportSession).
 * No recalcula niveles, padres ni naturalezas. Agregados = conteos/lecturas
 * directas de los datos que ya declaró el engine.
 */

import React from 'react';
import { summaryOf, effectiveContractOf } from '../../importSession/index.js';

function pct(x) {
    return typeof x === 'number' ? x.toFixed(2) : '—';
}

export default function ImportDiagnosticStep({ session, onSelectRegion, onBack, onNext, showNotice }) {
    const summary = summaryOf(session);
    const contract = effectiveContractOf(session);
    const regions = session.regions.map(r => ({
        regionId: r.regionId,
        meta: r.meta,
        nodes: r.contract.nodes.length,
        requiresConfirmation: r.contract.requiresConfirmation,
        blocks: (r.contract.errors || []).filter(e => e.severity === 'BLOCK').length,
        reviews: (r.contract.warnings || []).filter(w => w && w.severity === 'REVIEW').length
    }));

    const mapping = contract.columnMapping || {};
    const hierarchy = contract.hierarchy || {};
    const confidence = contract.confidence || {};
    const dataLoss = contract.dataLoss || {};
    const levelLengths = contract.levels || hierarchy.levelLengths || [];
    // Niveles observados en los nodos del Contract (lectura, no inferencia):
    // algunos formatos (ej. DASH) no declaran levelLengths.
    const observedLevels = {};
    for (const n of contract.nodes) {
        observedLevels[n.level] = (observedLevels[n.level] || 0) + 1;
    }
    const observedSummary = Object.keys(observedLevels).sort((a, b) => a - b).map(l => `N${l}×${observedLevels[l]}`).join(' · ');

    // Agregados de lectura: métodos de inferencia de padre observados en el Contract
    const methodCounts = {};
    for (const n of contract.nodes) {
        const m = (n.parentInfo && n.parentInfo.method) || '?';
        methodCounts[m] = (methodCounts[m] || 0) + 1;
    }
    const inferredRoots = contract.nodes.filter(n => n.nature === 'INFERRED' && n.classification === 'ROOT');
    const unknownPostable = contract.nodes.filter(n => n.isPostable === 'UNKNOWN');
    const roots = contract.nodes.filter(n => n.classification === 'ROOT').slice(0, 5);
    const sample = contract.nodes.slice(0, 8);
    const transformations = (contract.transformations || []).slice(0, 5);

    return (
        <div data-testid="u2-diag">
            {regions.length > 1 && (
                <div className="mb-3" data-testid="u2-region-tabs">
                    <small className="text-white-50 fw-bold d-block mb-2">
                        <i className="bi bi-layers me-1"></i>El archivo contiene {regions.length} regiones. Elige cuál revisar:
                    </small>
                    <div className="btn-group flex-wrap" role="group">
                        {regions.map((r, i) => (
                            <button
                                key={r.regionId}
                                type="button"
                                data-testid={`u2-region-tab-${i}`}
                                className={`btn btn-sm ${r.regionId === session.activeRegionId ? 'btn-primary' : 'btn-outline-primary'}`}
                                onClick={() => onSelectRegion(r.regionId)}
                            >
                                {r.meta.extractionMode === 'narrative' ? 'Narrativa' : `Región ${i + 1}`} ({r.nodes})
                                {r.blocks > 0 && <span className="badge bg-danger ms-1">{r.blocks} BLOCK</span>}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {contract.requiresConfirmation && (
                <div className="alert alert-warning" data-testid="u2-confirm-banner">
                    <i className="bi bi-exclamation-triangle me-2"></i>
                    <strong>Requiere tu confirmación.</strong> Hay naturalezas inferidas
                    ({inferredRoots.length} raíces) o revisiones pendientes. Nada se importará sin tu decisión explícita.
                </div>
            )}

            <div className="row g-3">
                <div className="col-md-6">
                    <div className="card glass-panel border-secondary h-100">
                        <div className="card-header bg-secondary bg-opacity-25 py-2">
                            <small className="fw-bold"><i className="bi bi-columns-gap me-2"></i>Columnas detectadas</small>
                        </div>
                        <div className="card-body small">
                            <div>Código: <code>{String(mapping.codeColumn ?? '—')}</code> · Nombre: <code>{String(mapping.nameColumn ?? '—')}</code> · Padre: <code>{String(mapping.parentColumn ?? '—')}</code> · Tipo: <code>{String(mapping.typeColumn ?? '—')}</code></div>
                            <div className="mt-1 text-white-50">Confianza del mapeo: <strong className="text-white">{pct(mapping.confidence)}</strong>{mapping.ambiguous ? ' (ambiguo)' : ''}</div>
                        </div>
                    </div>
                </div>
                <div className="col-md-6">
                    <div className="card glass-panel border-secondary h-100">
                        <div className="card-header bg-secondary bg-opacity-25 py-2">
                            <small className="fw-bold"><i className="bi bi-diagram-3 me-2"></i>Jerarquía detectada</small>
                        </div>
                        <div className="card-body small">
                            <div>Separador: <code>{hierarchy.separator || '(longitud fija)'}</code> · Niveles declarados: <strong>{hierarchy.levelCount ?? levelLengths.length}</strong></div>
                            <div className="mt-1 text-white-50">Longitudes: <code>{levelLengths.join(' · ') || '—'}</code></div>
                            <div className="mt-1 text-white-50" data-testid="u2-observed-levels">Observados en nodos: <strong className="text-white">{observedSummary || '—'}</strong></div>
                        </div>
                    </div>
                </div>
                <div className="col-md-6">
                    <div className="card glass-panel border-secondary h-100">
                        <div className="card-header bg-secondary bg-opacity-25 py-2">
                            <small className="fw-bold"><i className="bi bi-speedometer2 me-2"></i>Confianza del análisis</small>
                        </div>
                        <div className="card-body small">
                            <div>Global: <strong>{pct(confidence.overall)}</strong> · Margen de ambigüedad: <strong>{pct(confidence.ambiguityMargin)}</strong></div>
                            <div className="mt-1 text-white-50">Métodos de padre observados: {Object.entries(methodCounts).map(([m, c]) => `${m}×${c}`).join(' · ') || '—'}</div>
                        </div>
                    </div>
                </div>
                <div className="col-md-6">
                    <div className="card glass-panel border-secondary h-100">
                        <div className="card-header bg-secondary bg-opacity-25 py-2">
                            <small className="fw-bold"><i className="bi bi-clipboard-check me-2"></i>Reconciliación</small>
                        </div>
                        <div className="card-body small" data-testid="u2-reconciliation">
                            <div>Válidas: <strong>{summary.reconciliation.validRows}</strong> · Rechazadas: <strong>{summary.reconciliation.rejectedRows}</strong> · Transformadas: <strong>{summary.reconciliation.transformedNodes}</strong></div>
                            <div className="mt-1">Sin contabilizar: <strong className={dataLoss.unaccountedRows ? 'text-danger' : 'text-success'}>{dataLoss.unaccountedRows ?? 0}</strong> · Corrupción silenciosa: <strong className={(contract.silentCorruptionCount ?? 0) ? 'text-danger' : 'text-success'}>{contract.silentCorruptionCount ?? 0}</strong></div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card glass-panel border-secondary mt-3">
                <div className="card-header bg-secondary bg-opacity-25 py-2">
                    <small className="fw-bold"><i className="bi bi-exclamation-circle me-2"></i>Estado de validación (contrato)</small>
                </div>
                <div className="card-body small d-flex flex-wrap gap-2" data-testid="u2-issues">
                    <span className={`badge ${(summary.issues.blocks || 0) > 0 ? 'bg-danger' : 'bg-success'}`}>BLOCK: {summary.issues.blocks || 0}</span>
                    <span className={`badge ${(summary.issues.reviewWarningsUnresolved || 0) > 0 ? 'bg-warning text-dark' : 'bg-success'}`}>REVIEW: {summary.issues.reviewWarningsUnresolved || 0} pendientes</span>
                    <span className={`badge ${(summary.issues.unknownNatureUnresolved || 0) > 0 ? 'bg-warning text-dark' : 'bg-success'}`}>UNKNOWN: {summary.issues.unknownNatureUnresolved || 0} sin confirmar</span>
                    <span className="badge bg-info text-dark">Raíces inferidas: {inferredRoots.length}</span>
                    <span className="badge bg-secondary">Nodos: {summary.nodeCounts.effective}</span>
                </div>
            </div>

            {transformations.length > 0 && (
                <div className="card glass-panel border-secondary mt-3">
                    <div className="card-header bg-secondary bg-opacity-25 py-2">
                        <small className="fw-bold"><i className="bi bi-arrow-left-right me-2"></i>Transformaciones auditadas (muestra)</small>
                    </div>
                    <div className="card-body p-0">
                        <div className="table-responsive">
                            <table className="table table-sm table-dark table-striped mb-0" style={{ fontSize: '0.85rem' }}>
                                <thead><tr><th>Código</th><th>Transformación</th></tr></thead>
                                <tbody>
                                    {transformations.map((t, i) => (
                                        <tr key={i}><td className="font-monospace">{t.code}</td><td className="small text-white-50">{JSON.stringify(t.transformations)}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            <div className="card bg-dark border-secondary mt-3">
                <div className="card-header bg-secondary bg-opacity-25 py-2">
                    <small className="fw-bold text-muted">Muestra de nodos (primeros {sample.length})</small>
                </div>
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-sm table-striped mb-0" style={{ fontSize: '0.85rem' }}>
                            <thead><tr><th>Código</th><th>Nivel</th><th>Padre (método)</th><th>Nombre</th></tr></thead>
                            <tbody>
                                {sample.map((n, i) => (
                                    <tr key={i}>
                                        <td className="font-monospace">{n.normalizedCode}</td>
                                        <td><span className="badge bg-secondary">{n.level}</span></td>
                                        <td className="text-muted small">{n.parent || '—'} <span className="badge bg-dark border ms-1">{n.parentInfo?.method}</span></td>
                                        <td>{(n.name || '').slice(0, 60)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {roots.length > 0 && (
                <small className="text-white-50 d-block mt-2">
                    <i className="bi bi-star me-1"></i>Raíces: {roots.map(r => `${r.normalizedCode} ${(r.name || '').slice(0, 24)}`).join(' · ')}
                </small>
            )}
            {unknownPostable.length > 0 && (
                <div className="alert alert-warning mt-3 py-2 small" data-testid="u2-unknown-banner">
                    <i className="bi bi-question-circle me-2"></i>
                    {unknownPostable.length} nodos con naturaleza UNKNOWN requieren tu decisión explícita en el paso de revisión.
                </div>
            )}

            <div className="d-flex justify-content-between pt-3 mt-2 border-top">
                <button type="button" data-testid="u2-back-btn" className="btn btn-outline-secondary px-4" onClick={onBack}>
                    <i className="bi bi-arrow-left me-2"></i>Atrás
                </button>
                <button type="button" data-testid="u2-next-btn" className="btn btn-premium px-4" onClick={onNext}>
                    Continuar a validación <i className="bi bi-arrow-right ms-2"></i>
                </button>
            </div>

            {showNotice && (
                <div className="alert alert-info mt-3" data-testid="u2-u3-notice">
                    <i className="bi bi-info-circle me-2"></i>
                    <strong>Paso 3 (Validación / Simulación) llega en el incremento U-3.</strong> Este
                    asistente aún no importa nada: todo lo visto es diagnóstico en memoria.
                </div>
            )}
        </div>
    );
}
