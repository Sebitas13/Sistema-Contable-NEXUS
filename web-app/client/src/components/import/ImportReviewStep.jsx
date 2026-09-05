/**
 * ImportReviewStep.jsx — Paso 4 del UniversalImportWizard: revisión con overrides.
 *
 * El usuario corrige el Contract mediante la capa explícita UserOverrides
 * (ImportSession): editar celdas, excluir/re-incluir filas, confirmar
 * naturalezas, resolver revisiones, asignar tipo en lote. Nada se re-analiza
 * aquí: los valores editados se guardan con traza (original → valor) y los
 * gates se recalculan en vivo desde la sesión.
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
    canImportReport, summaryOf, effectiveContractOf
} from '../../importSession/index.js';

// Vocabulario de tipos de cuenta (mismo que el asistente clásico; el backend
// /bulk solo exige valores no vacíos). No hay heurística: es un catálogo.
const TYPE_OPTIONS = [
    'Activo', 'Pasivo', 'Patrimonio', 'Reguladora', 'Orden', 'Contingente',
    'Costo', 'Gasto', 'Ingreso', 'Resultado', 'Otra cuenta de resultados'
];

const PAGE_SIZE = 100;

/** Arma las filas revisables por lectura de la sesión (sin re-inferir nada). */
function reviewRowsOf(session) {
    const region = session.regions.find(r => r.regionId === session.activeRegionId);
    const excluded = new Set(session.exclusions.filter(u => u.startsWith(`${region.regionId}:`)));
    const ovByUid = {};
    for (const o of session.overrides) {
        if (o.regionId !== region.regionId) continue;
        if (!ovByUid[o.uid]) ovByUid[o.uid] = {};
        ovByUid[o.uid][o.field] = o.value;
    }
    const confByUid = {};
    for (const e of session.natureConfirmations) {
        if (e.regionId === region.regionId) confByUid[e.uid] = e.nature;
    }
    const effective = effectiveContractOf(session, { regionId: region.regionId });
    const blockedCodes = new Set(
        (effective.errors || []).filter(e => e && e.severity === 'BLOCK' && e.code).map(e => e.code)
    );
    const resolvedNodes = new Set(
        session.reviewResolutions.filter(r => r.uid && r.regionId === region.regionId).map(r => r.uid)
    );

    const rows = [];
    const excludedRows = [];
    for (let index = 0; index < region.contract.nodes.length; index++) {
        const node = region.contract.nodes[index];
        const uid = `${region.regionId}:${index}`;
        const ov = ovByUid[uid] || {};
        const effCode = ov.code ?? node.code;
        const entry = {
            uid,
            nodeIndex: index,
            code: effCode,
            normalizedCode: ov.code ?? node.normalizedCode,
            rawCode: node.rawCode,
            name: ov.name ?? node.name,
            type: confByUid[uid] ?? ov.type ?? node.type,
            level: ov.level ?? node.level,
            parent: node.parent,
            parentInfo: node.parentInfo,
            nature: node.nature,
            classification: node.classification,
            isPostable: node.isPostable,
            transformations: node.transformations || [],
            overriddenFields: Object.keys(ov),
            confirmed: uid in confByUid,
            isBlocked: blockedCodes.has(ov.code ?? node.normalizedCode),
            needsReview: !!((node.requiresReview || (node.parentInfo && node.parentInfo.requiresReview)) && !resolvedNodes.has(uid)),
            isUnknown: node.isPostable === 'UNKNOWN' && !(uid in confByUid),
            inferredRoot: node.nature === 'INFERRED' && node.classification === 'ROOT' && !(uid in confByUid)
        };
        (excluded.has(uid) ? excludedRows : rows).push(entry);
    }
    return { region, rows, excludedRows };
}

export default function ImportReviewStep({
    session,
    onOverride,
    onExclude,
    onInclude,
    onConfirmNature,
    onResolveReview,
    onBulkType,
    onBack,
    onNext,
    showNotice
}) {
    const { region, rows, excludedRows } = useMemo(() => reviewRowsOf(session), [session]);
    const report = useMemo(() => canImportReport(session), [session]);
    const summary = useMemo(() => summaryOf(session), [session]);

    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState([]);
    const [bulkType, setBulkType] = useState('Activo');
    const [expandedUid, setExpandedUid] = useState(null);
    const [showExcluded, setShowExcluded] = useState(false);
    const [showRejected, setShowRejected] = useState(false);
    const [showTrace, setShowTrace] = useState(false);

    useEffect(() => {
        setPage(1);
        setSelected([]);
        setExpandedUid(null);
    }, [session.activeRegionId]);

    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const myOverrides = session.overrides.filter(o => o.regionId === region.regionId);
    const myConfirmations = session.natureConfirmations.filter(e => e.regionId === region.regionId);
    const reviewWarnings = (region.contract.warnings || [])
        .map((w, i) => ({ w, i }))
        .filter(({ w }) => w && typeof w === 'object' && w.severity === 'REVIEW');
    const resolvedWarnKeys = new Set(
        session.reviewResolutions.filter(r => r.warnKey && r.regionId === region.regionId).map(r => r.warnKey)
    );
    const pendingWarnings = reviewWarnings.filter(({ i }) => !resolvedWarnKeys.has(`${region.regionId}:w${i}`));
    const rejectedRows = region.contract.rejectedRows || [];

    function toggleSelect(uid) {
        setSelected(prev => prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid]);
    }
    function toggleSelectAll() {
        const ids = pageRows.map(r => r.uid);
        const allIn = ids.every(id => selected.includes(id));
        setSelected(prev => allIn ? prev.filter(u => !ids.includes(u)) : [...new Set([...prev, ...ids])]);
    }

    function commitField(uid, field, raw) {
        const value = field === 'level' ? parseInt(raw, 10) : String(raw);
        if (field === 'level' && (!Number.isInteger(value) || value < 1)) return;
        if (field !== 'level' && String(value).trim() === '') return;
        onOverride(uid, field, value);
    }

    return (
        <div data-testid="u2-review">
            <div className={`alert ${report.can ? 'alert-success' : 'alert-secondary'} py-2`} data-testid="u2-gates-live">
                <i className={`bi ${report.can ? 'bi-check-circle' : 'bi-hourglass-split'} me-2`}></i>
                {report.can
                    ? <><strong>Listo para el resumen.</strong> Sin bloqueos ni revisiones pendientes en esta región.</>
                    : <><strong>Puertas en vivo:</strong> {report.reasons.length} punto(s) por resolver — cada corrección recalcula este panel.</>}
            </div>

            <div className="card glass-panel border-secondary mb-3">
                <div className="card-body py-2 small d-flex flex-wrap gap-2">
                    <span className="badge bg-primary">{rows.length} revisables</span>
                    <span className="badge bg-secondary">{excludedRows.length} excluidas</span>
                    <span className="badge bg-secondary">{myOverrides.length} overrides</span>
                    <span className="badge bg-secondary">{myConfirmations.length} naturalezas confirmadas</span>
                    <span className="badge bg-secondary">{pendingWarnings.length} REVIEW pendientes</span>
                    <button type="button" className="btn btn-sm btn-link text-white-50 p-0 ms-auto" data-testid="u2-trace-toggle" onClick={() => setShowTrace(v => !v)}>
                        {showTrace ? 'Ocultar traza' : 'Ver traza de mis cambios'}
                    </button>
                </div>
                {showTrace && (
                    <div className="card-body border-top pt-2" data-testid="u2-trace">
                        {myOverrides.length === 0 && myConfirmations.length === 0
                            ? <small className="text-white-50">Aún no hiciste cambios. Cada edición quedará registrada aquí con su valor original.</small>
                            : <ul className="small mb-0">
                                {myOverrides.map((o, i) => (
                                    <li key={`o${i}`}><code>{o.uid}</code> · {o.field}: <s className="text-white-50">{String(o.originalValue)}</s> → <strong>{String(o.value)}</strong></li>
                                ))}
                                {myConfirmations.map((e, i) => (
                                    <li key={`c${i}`}><code>{e.uid}</code> · naturaleza confirmada: <strong>{e.nature}</strong> (código {e.code})</li>
                                ))}
                            </ul>}
                    </div>
                )}
            </div>

            {pendingWarnings.length > 0 && (
                <div className="card border-warning mb-3">
                    <div className="card-header bg-warning bg-opacity-10 py-2">
                        <small className="fw-bold text-warning"><i className="bi bi-eye me-2"></i>Revisiones del contrato ({pendingWarnings.length})</small>
                    </div>
                    <div className="list-group list-group-flush">
                        {pendingWarnings.slice(0, 5).map(({ w, i }) => (
                            <div key={i} className="list-group-item bg-dark text-white d-flex gap-2 align-items-start">
                                <span className="small flex-grow-1">{w.message || w.type} {w.code ? <code>{w.code}</code> : ''}</span>
                                <button type="button" data-testid={`u2-resolve-warn-${i}`} className="btn btn-sm btn-outline-warning" onClick={() => onResolveReview(`${region.regionId}:w${i}`)}>
                                    Marcar revisado
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {selected.length > 0 && (
                <div className="card glass-panel border-primary mb-3" data-testid="u2-bulk-bar">
                    <div className="card-body py-2 d-flex align-items-center gap-2 flex-wrap">
                        <span className="badge bg-primary fs-6"><i className="bi bi-check2-all me-1"></i>{selected.length} seleccionadas</span>
                        <div className="input-group input-group-sm" style={{ maxWidth: '280px' }}>
                            <select data-testid="u2-bulk-type-select" className="form-select bg-dark text-white border-secondary" value={bulkType} onChange={e => setBulkType(e.target.value)}>
                                {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <button type="button" data-testid="u2-bulk-apply" className="btn btn-premium" onClick={() => { onBulkType(selected, bulkType); setSelected([]); }}>
                                Asignar tipo
                            </button>
                        </div>
                        <button type="button" className="btn btn-sm btn-link text-white-50" onClick={() => setSelected([])}>Desmarcar</button>
                    </div>
                </div>
            )}

            {rows.length > PAGE_SIZE && (
                <div className="d-flex justify-content-between align-items-center mb-2 bg-dark bg-opacity-50 border border-secondary p-2 rounded">
                    <small className="text-white-50">Mostrando {(safePage - 1) * PAGE_SIZE + 1} - {Math.min(safePage * PAGE_SIZE, rows.length)} de {rows.length}</small>
                    <div className="btn-group btn-group-sm">
                        <button type="button" className="btn btn-outline-secondary text-white" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}><i className="bi bi-chevron-left"></i></button>
                        <span className="btn btn-outline-secondary disabled text-white fw-bold" style={{ minWidth: '80px' }}>Pág {safePage} / {totalPages}</span>
                        <button type="button" className="btn btn-outline-secondary text-white" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}><i className="bi bi-chevron-right"></i></button>
                    </div>
                </div>
            )}

            <div className="table-responsive" style={{ maxHeight: '480px' }}>
                <table className="table table-sm table-dark table-hover table-striped border-secondary mb-0">
                    <thead className="sticky-top" style={{ backgroundColor: '#1a1f2e', top: 0 }}>
                        <tr>
                            <th style={{ width: '40px' }} className="text-center">
                                <input type="checkbox" className="form-check-input bg-dark border-secondary"
                                    checked={pageRows.length > 0 && pageRows.every(r => selected.includes(r.uid))}
                                    onChange={toggleSelectAll} aria-label="Seleccionar página" />
                            </th>
                            <th style={{ width: '120px' }} className="text-white-50">Código</th>
                            <th className="text-white-50">Nombre</th>
                            <th style={{ width: '150px' }} className="text-white-50">Tipo</th>
                            <th style={{ width: '70px' }} className="text-white-50">Nivel</th>
                            <th style={{ width: '120px' }} className="text-white-50">Estado</th>
                            <th style={{ width: '90px' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.map(row => (
                            <React.Fragment key={row.uid}>
                                <tr className={row.isBlocked ? 'table-danger' : ''}>
                                    <td className="text-center">
                                        <input type="checkbox" className="form-check-input bg-dark border-secondary"
                                            checked={selected.includes(row.uid)}
                                            onChange={() => toggleSelect(row.uid)} aria-label={`Seleccionar ${row.code}`} />
                                    </td>
                                    <td>
                                        <input type="text" data-testid={`u2-cell-code-${row.uid}`}
                                            className="form-control form-control-sm bg-dark text-white border-secondary font-monospace"
                                            value={row.code} onChange={e => commitField(row.uid, 'code', e.target.value)}
                                            title={row.overriddenFields.includes('code') ? `Original: ${region.contract.nodes[row.nodeIndex].code}` : row.rawCode} />
                                    </td>
                                    <td>
                                        <input type="text" data-testid={`u2-cell-name-${row.uid}`}
                                            className="form-control form-control-sm bg-dark text-white border-secondary"
                                            value={row.name} onChange={e => commitField(row.uid, 'name', e.target.value)}
                                            title={row.overriddenFields.includes('name') ? `Original: ${region.contract.nodes[row.nodeIndex].name}` : ''} />
                                    </td>
                                    <td>
                                        <select data-testid={`u2-cell-type-${row.uid}`}
                                            className="form-select form-select-sm bg-dark text-white border-secondary"
                                            value={TYPE_OPTIONS.includes(row.type) ? row.type : TYPE_OPTIONS[0]}
                                            onChange={e => commitField(row.uid, 'type', e.target.value)}>
                                            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </td>
                                    <td>
                                        <input type="number" min="1" data-testid={`u2-cell-level-${row.uid}`}
                                            className="form-control form-control-sm bg-dark text-white border-secondary text-center"
                                            style={{ width: '60px' }} value={row.level}
                                            onChange={e => commitField(row.uid, 'level', e.target.value)} />
                                    </td>
                                    <td>
                                        <div className="d-flex flex-wrap gap-1">
                                            {row.isBlocked && <span className="badge bg-danger">BLOCK</span>}
                                            {row.needsReview && <span className="badge bg-warning text-dark">REVIEW</span>}
                                            {(row.isUnknown || row.inferredRoot) && <span className="badge bg-warning text-dark">CONFIRMAR</span>}
                                            {row.overriddenFields.length > 0 && <span className="badge bg-info text-dark" title={row.overriddenFields.join(', ')}>EDITADO</span>}
                                            {row.confirmed && <span className="badge bg-success">CONFIRMADO</span>}
                                            {!row.isBlocked && !row.needsReview && !row.isUnknown && !row.inferredRoot && <span className="badge bg-secondary">OK</span>}
                                        </div>
                                    </td>
                                    <td className="text-center">
                                        <div className="btn-group btn-group-sm">
                                            <button type="button" data-testid={`u2-evidence-${row.uid}`} className="btn btn-outline-info py-0 px-1" title="Ver evidencia (padre inferido y transformaciones)"
                                                onClick={() => setExpandedUid(u => (u === row.uid ? null : row.uid))}>
                                                <i className="bi bi-search"></i>
                                            </button>
                                            <button type="button" data-testid={`u2-del-${row.uid}`} className="btn btn-outline-danger py-0 px-1" title="Excluir fila"
                                                onClick={() => onExclude(row.uid)}>
                                                <i className="bi bi-trash"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                {expandedUid === row.uid && (
                                    <tr>
                                        <td colSpan="7" className="bg-dark">
                                            <div className="small d-flex flex-wrap gap-3 p-1">
                                                <span>Padre: <code>{row.parent || '—'}</code> <span className="badge bg-dark border ms-1">{row.parentInfo?.method}</span> <span className="text-white-50">confianza {row.parentInfo?.confidence ?? '—'}</span></span>
                                                <span className="text-white-50">Evidencia: {(row.parentInfo?.evidence || []).join(' · ') || '—'}</span>
                                                <span className="text-white-50">Transformaciones: {row.transformations.length > 0 ? JSON.stringify(row.transformations) : 'ninguna'}</span>
                                                <span className="text-white-50">Naturaleza: {row.nature} · Clasificación: {row.classification} · Posteable: {row.isPostable}</span>
                                                {(row.needsReview || row.isUnknown || row.inferredRoot) && !row.confirmed && (
                                                    <button type="button" data-testid={`u2-confirm-nature-${row.uid}`} className="btn btn-sm btn-outline-success ms-auto"
                                                        onClick={() => onConfirmNature(row.uid, row.type)}>
                                                        <i className="bi bi-check2 me-1"></i>Confirmar «{row.type}»
                                                    </button>
                                                )}
                                                {row.needsReview && (
                                                    <button type="button" data-testid={`u2-resolve-node-${row.uid}`} className="btn btn-sm btn-outline-warning"
                                                        onClick={() => onResolveReview(row.uid)}>
                                                        Aceptar revisión
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="d-flex gap-2 mt-3 flex-wrap">
                <button type="button" data-testid="u2-excluded-toggle" className="btn btn-sm btn-outline-secondary" onClick={() => setShowExcluded(v => !v)}>
                    {showExcluded ? 'Ocultar' : 'Ver'} excluidas ({excludedRows.length})
                </button>
                <button type="button" data-testid="u2-rejected-toggle" className="btn btn-sm btn-outline-secondary" onClick={() => setShowRejected(v => !v)}>
                    {showRejected ? 'Ocultar' : 'Ver'} filas rechazadas ({rejectedRows.length})
                </button>
            </div>

            {showExcluded && excludedRows.length > 0 && (
                <div className="card border-secondary mt-2">
                    <div className="card-body p-2 small">
                        {excludedRows.slice(0, 20).map(r => (
                            <div key={r.uid} className="d-flex gap-2 align-items-center py-1 border-bottom">
                                <code>{r.code}</code><span className="text-white-50">{(r.name || '').slice(0, 50)}</span>
                                <button type="button" data-testid={`u2-include-${r.uid}`} className="btn btn-sm btn-outline-success ms-auto py-0" onClick={() => onInclude(r.uid)}>Re-incluir</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {showRejected && (
                <div className="card border-secondary mt-2">
                    <div className="card-body p-0">
                        <div className="table-responsive" style={{ maxHeight: '200px' }}>
                            <table className="table table-sm table-dark mb-0" style={{ fontSize: '0.8rem' }}>
                                <thead><tr><th>Fila</th><th>Código</th><th>Nombre</th><th>Motivo</th></tr></thead>
                                <tbody>
                                    {rejectedRows.slice(0, 50).map((r, i) => (
                                        <tr key={i}><td>{r.row}</td><td className="font-monospace">{r.rawCode}</td><td>{(r.rawName || '').slice(0, 50)}</td><td><span className="badge bg-secondary">{r.reason}</span></td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            <div className="d-flex justify-content-between pt-3 mt-3 border-top">
                <button type="button" data-testid="u2-back-btn" className="btn btn-outline-secondary px-4" onClick={onBack}>
                    <i className="bi bi-arrow-left me-2"></i>Atrás
                </button>
                <button type="button" data-testid="u2-next-btn" className="btn btn-premium px-4" onClick={onNext}>
                    Continuar al resumen <i className="bi bi-arrow-right ms-2"></i>
                </button>
            </div>

            {showNotice && (
                <div className="alert alert-info mt-3" data-testid="u2-u5-notice">
                    <i className="bi bi-info-circle me-2"></i>
                    <strong>Paso 5 (Resumen final) llega en el incremento U-5.</strong>{' '}
                    {report.can
                        ? 'Tus puertas están en verde: el resumen mostrará reconciliación completa.'
                        : `Aún hay ${report.reasons.length} punto(s) por resolver antes del resumen.`}
                </div>
            )}
        </div>
    );
}
