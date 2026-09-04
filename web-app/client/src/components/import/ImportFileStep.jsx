/**
 * ImportFileStep.jsx — Paso 1 del UniversalImportWizard: archivo + extracción.
 *
 * Presentacional: no analiza, no infiere. Solo presenta el archivo, las
 * opciones de extracción (hoja / páginas) y el estado de la extracción.
 * Toda la inteligencia vive en FormatAdapter (engine).
 */

import React from 'react';

const ACCEPT = '.xlsx,.xls,.xlsm,.pdf,.csv,.txt';

export default function ImportFileStep({
    file,
    formatLabel,
    sheets,
    sheetName,
    onSheetChange,
    isPdf,
    pdfPages,
    onPagesChange,
    busy,
    docSummary,
    error,
    onFile,
    onAnalyze,
    onRetry
}) {
    return (
        <div data-testid="u2-file-step">
            {!file && (
                <div className="text-center p-4">
                    <div className="mb-3 d-inline-block p-4 rounded-circle bg-primary bg-opacity-10 border border-primary border-opacity-25">
                        <i className="bi bi-file-earmark-arrow-up display-4 text-primary"></i>
                    </div>
                    <h5 className="fw-bold mb-2">Selecciona el archivo del plan de cuentas</h5>
                    <p className="text-white-50 mb-3">
                        Formatos: <span className="text-info fw-bold">.xlsx, .xls, .xlsm, .pdf, .csv, .txt</span>
                    </p>
                    <div className="p-4 rounded-4 border border-dashed border-secondary bg-dark bg-opacity-50" style={{ maxWidth: '520px', margin: '0 auto' }}>
                        <input
                            type="file"
                            data-testid="u2-file-input"
                            className="form-control bg-dark text-white border-secondary mb-2"
                            accept={ACCEPT}
                            onChange={e => onFile(e.target.files && e.target.files[0])}
                        />
                        <small className="text-white-50 mt-2 d-block">
                            <i className="bi bi-shield-lock me-1 text-success"></i>
                            Tus datos se procesan de forma local en tu navegador. Nada se envía.
                        </small>
                    </div>
                </div>
            )}

            {file && (
                <div className="row g-3">
                    <div className="col-12">
                        <div className="alert alert-info d-flex align-items-center justify-content-between flex-wrap gap-2">
                            <div>
                                <i className="bi bi-file-earmark-text me-2"></i>
                                <strong>{file.name}</strong>
                                <span className="text-white-50 ms-2">({(file.size / 1024).toFixed(1)} KB)</span>
                                {formatLabel && (
                                    <span className="badge bg-primary ms-2" data-testid="u2-format-badge">{formatLabel}</span>
                                )}
                            </div>
                            <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                onClick={() => onFile(null)}
                                disabled={busy}
                            >
                                Cambiar archivo
                            </button>
                        </div>
                    </div>

                    {sheets && sheets.length > 1 && (
                        <div className="col-md-6">
                            <label className="form-label text-white-50 small fw-bold">Hoja del Excel</label>
                            <select
                                data-testid="u2-sheet-select"
                                className="form-select bg-dark text-white border-secondary"
                                value={sheetName}
                                disabled={busy}
                                onChange={e => onSheetChange(e.target.value)}
                            >
                                {sheets.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    )}

                    {isPdf && (
                        <>
                            <div className="col-md-3">
                                <label className="form-label text-white-50 small fw-bold">Página inicio</label>
                                <input
                                    data-testid="u2-pdf-start"
                                    type="number" min="1"
                                    className="form-control bg-dark text-white border-secondary text-center"
                                    value={pdfPages.startPage}
                                    disabled={busy}
                                    onChange={e => onPagesChange({ ...pdfPages, startPage: Math.max(1, parseInt(e.target.value) || 1) })}
                                />
                            </div>
                            <div className="col-md-3">
                                <label className="form-label text-white-50 small fw-bold">Página fin (vacío = todas)</label>
                                <input
                                    data-testid="u2-pdf-end"
                                    type="number" min="1"
                                    className="form-control bg-dark text-white border-secondary text-center"
                                    value={pdfPages.endPage || ''}
                                    placeholder="Todas"
                                    disabled={busy}
                                    onChange={e => onPagesChange({ ...pdfPages, endPage: parseInt(e.target.value) || null })}
                                />
                            </div>
                        </>
                    )}

                    {docSummary && (
                        <div className="col-12">
                            <div className="card glass-panel border-secondary" data-testid="u2-extraction-summary">
                                <div className="card-body py-2 d-flex flex-wrap gap-3 small">
                                    <span><i className="bi bi-table me-1 text-info"></i><strong>{docSummary.rows}</strong> filas extraídas</span>
                                    <span><i className="bi bi-speedometer2 me-1 text-info"></i>confianza extracción: <strong>{docSummary.confidence}</strong></span>
                                    {docSummary.ocrUsed && <span className="badge bg-warning text-dark">OCR</span>}
                                    <span className="text-white-50">Formato: {docSummary.format}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="col-12">
                            <div className="alert alert-danger" data-testid="u2-error">
                                <i className="bi bi-exclamation-triangle me-2"></i>
                                <strong>{error.where}: </strong>{error.message}
                                <div className="mt-2 d-flex gap-2">
                                    <button type="button" data-testid="u2-retry-btn" className="btn btn-sm btn-outline-light" onClick={onRetry} disabled={busy}>
                                        <i className="bi bi-arrow-repeat me-1"></i>Reintentar
                                    </button>
                                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onFile(null)} disabled={busy}>
                                        Elegir otro archivo
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="col-12 text-end pt-2">
                        <button
                            type="button"
                            data-testid="u2-analyze-btn"
                            className="btn btn-premium px-5"
                            onClick={onAnalyze}
                            disabled={busy || !file}
                        >
                            {busy ? (
                                <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>{busy === 'extracting' ? 'Extrayendo…' : 'Analizando…'}</>
                            ) : (
                                <><i className="bi bi-cpu me-2"></i>Extraer y analizar</>
                            )}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
