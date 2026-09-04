/**
 * UniversalImportWizard.jsx — Orquestador del asistente de importación universal.
 *
 * U-2: pasos 1 (Archivo + Extracción) y 2 (Diagnóstico) conectados al engine
 * en modo shadow. CERO escrituras: no hay POST/PUT/DELETE ni llamadas de red;
 * todo ocurre en memoria (FormatAdapter → Analyzer → ImportSession).
 *
 * REGLA DE ORO: este componente orquesta UI y sesión. No analiza, no infiere,
 * no re-calcula niveles/padres/naturalezas: renderiza el Contract.
 *
 * Props:
 *   onClose, onSuccess — mismo contrato que el wizard legacy (Accounts.jsx).
 *   initialFile, initialSheet, initialPages, autoStart, onStateChange —
 *     puntos de entrada del harness E2E (opcionales, sin efecto en producción).
 */

import React, { useState, useEffect, useRef } from 'react';
import NexusModal from '../NexusModal.jsx';
import { detectFormat } from '../../utils/FormatAdapter.js';
import { UniversalPlanAnalyzer } from '../../utils/UniversalPlanAnalyzer.js';
import { createImportSession, selectRegion, canImportReport, summaryOf, simulate } from '../../importSession/index.js';
import ImportFileStep from './ImportFileStep.jsx';
import ImportDiagnosticStep from './ImportDiagnosticStep.jsx';
import ImportValidationStep from './ImportValidationStep.jsx';

const SUPPORTED_LABEL = '.xlsx, .xls, .xlsm, .pdf, .csv, .txt';
const STEPS = ['Archivo', 'Diagnóstico', 'Validación', 'Revisión', 'Resumen', 'Confirmación'];

function adapterLabel(adapter) {
    if (!adapter) return null;
    if (adapter.name === 'ExcelAdapter') return 'Excel';
    if (adapter.name === 'PdfAdapter') return 'PDF';
    if (adapter.name === 'CsvAdapter') return 'CSV/TXT';
    return adapter.name;
}

export default function UniversalImportWizard({
    onClose,
    onSuccess,
    initialFile = null,
    initialSheet = null,
    initialPages = null,
    autoStart = false,
    onStateChange = null
}) {
    const [file, setFile] = useState(null);
    const [formatName, setFormatName] = useState(null);
    const [sheets, setSheets] = useState([]);
    const [sheetName, setSheetName] = useState('');
    const [pdfPages, setPdfPages] = useState({ startPage: 1, endPage: null });
    const [doc, setDoc] = useState(null);
    const [docMeta, setDocMeta] = useState(null); // { sheetName, pages } usados en la extracción vigente
    const [extractionMs, setExtractionMs] = useState(null);
    const [analysisMs, setAnalysisMs] = useState(null);
    const [session, setSession] = useState(null);
    const [phase, setPhase] = useState('pick'); // pick|extracting|ready|analyzing|diagnosed|error
    const [uiStep, setUiStep] = useState(1); // 1..3 en U-3 (4..6 llegan en U-4+)
    const [error, setError] = useState(null); // { where, message }
    const [showU4Notice, setShowU4Notice] = useState(false);
    const lastOpRef = useRef(null); // { kind: 'extract'|'analyze' } para reintentar
    const autoStartedRef = useRef(false);

    const busy = phase === 'extracting' ? 'extracting' : (phase === 'analyzing' ? 'analyzing' : null);
    const isPdf = formatName === 'PDF';

    function fail(where, err) {
        const message = err && err.message ? err.message : String(err);
        setError({ where, message });
        setPhase('error');
        lastOpRef.current = { kind: where === 'análisis' ? 'analyze' : 'extract' };
    }

    async function extract(fileToUse, opts = {}) {
        const adapter = detectFormat(fileToUse.name);
        if (!adapter) {
            throw new Error(`Formato no soportado: "${fileToUse.name}". Soportados: ${SUPPORTED_LABEL}`);
        }
        const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        let extracted;
        if (adapter.name === 'ExcelAdapter' && opts.sheetName) {
            extracted = await adapter.extract({ file: fileToUse, sheetName: opts.sheetName });
        } else if (adapter.name === 'PdfAdapter') {
            extracted = await adapter.extract(fileToUse, {
                startPage: opts.startPage || 1,
                endPage: opts.endPage || undefined
            });
        } else {
            extracted = await adapter.extract(fileToUse);
        }
        const ms = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));
        return { adapter, doc: extracted, ms };
    }

    async function runExtract(fileToUse, opts = {}) {
        setPhase('extracting');
        setError(null);
        try {
            const { adapter, doc: extracted, ms } = await extract(fileToUse, opts);
            setFile(fileToUse);
            setFormatName(adapterLabel(adapter));
            const names = (extracted.source && extracted.source.sheetNames) || [];
            setSheets(names);
            const effectiveSheet = opts.sheetName || names[0] || '';
            setSheetName(prev => opts.sheetName || prev || effectiveSheet);
            setDoc(extracted);
            setDocMeta({ sheetName: adapter.name === 'ExcelAdapter' ? effectiveSheet : null, pages: adapter.name === 'PdfAdapter' ? { ...pdfPages, ...(opts.pages || {}) } : null });
            setExtractionMs(ms);
            setSession(null);
            setAnalysisMs(null);
            setUiStep(1);
            setShowU4Notice(false);
            setPhase('ready');
            return extracted;
        } catch (err) {
            setFile(fileToUse);
            setDoc(null);
            fail('extracción', err);
            return null;
        }
    }

    async function runAnalyze(docToUse, fileToUse) {
        setPhase('analyzing');
        setError(null);
        try {
            const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            const analysis = UniversalPlanAnalyzer.analyzeCanonicalDocument(docToUse);
            const ms = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));
            if (!analysis || !Array.isArray(analysis.regions) || analysis.regions.length === 0) {
                throw new Error('El análisis no produjo ninguna región utilizable (¿hoja vacía o sin códigos?).');
            }
            const next = createImportSession({
                source: { fileName: fileToUse.name, fileSize: fileToUse.size || 0 },
                extraction: {
                    confidence: docToUse.extractionConfidence ?? null,
                    ocrUsed: !!docToUse.ocrUsed,
                    stats: docToUse.stats || null,
                    warnings: docToUse.warnings || null
                },
                regions: analysis.regions
            });
            setSession(next);
            setAnalysisMs(ms);
            setUiStep(2);
            setPhase('diagnosed');
            return next;
        } catch (err) {
            fail('análisis', err);
            return null;
        }
    }

    async function handleFileSelected(nextFile) {
        if (!nextFile) {
            setFile(null); setDoc(null); setSession(null); setSheets([]);
            setSheetName(''); setError(null); setPhase('pick'); setUiStep(1);
            setShowU4Notice(false);
            return;
        }
        await runExtract(nextFile, {});
    }

    async function handleSheetChange(nextSheet) {
        setSheetName(nextSheet);
        if (file) await runExtract(file, { sheetName: nextSheet });
    }

    async function handleAnalyze() {
        let currentDoc = doc;
        // Si la hoja o las páginas cambiaron tras la extracción, re-extraer antes de analizar.
        const needReextract =
            (formatName === 'Excel' && docMeta && docMeta.sheetName && docMeta.sheetName !== sheetName) ||
            (formatName === 'PDF' && docMeta && docMeta.pages &&
                (docMeta.pages.startPage !== pdfPages.startPage || docMeta.pages.endPage !== pdfPages.endPage));
        if (!currentDoc || needReextract) {
            currentDoc = await runExtract(file, {
                sheetName: formatName === 'Excel' ? (sheetName || undefined) : undefined,
                startPage: formatName === 'PDF' ? pdfPages.startPage : undefined,
                endPage: formatName === 'PDF' ? (pdfPages.endPage || undefined) : undefined
            });
            if (!currentDoc) return;
            if (phase === 'error') return;
        }
        await runAnalyze(currentDoc, file);
    }

    async function handleRetry() {
        const op = lastOpRef.current;
        if (!file) return;
        if (op && op.kind === 'analyze' && doc) {
            await runAnalyze(doc, file);
        } else {
            await runExtract(file, {
                sheetName: formatName === 'Excel' ? (sheetName || undefined) : undefined,
                startPage: formatName === 'PDF' ? pdfPages.startPage : undefined,
                endPage: formatName === 'PDF' ? (pdfPages.endPage || undefined) : undefined
            });
        }
    }

    function handleSelectRegion(regionId) {
        setSession(prev => (prev ? selectRegion(prev, regionId) : prev));
    }

    // Piloto automático del harness E2E (solo cuando se pide explícitamente).
    useEffect(() => {
        if (!autoStart || !initialFile || autoStartedRef.current) return;
        autoStartedRef.current = true;
        (async () => {
            const extracted = await runExtract(initialFile, {
                sheetName: initialSheet || undefined,
                startPage: initialPages ? initialPages[0] : undefined,
                endPage: initialPages && initialPages[1] ? initialPages[1] : undefined
            });
            if (extracted) await runAnalyze(extracted, initialFile);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoStart, initialFile]);

    // Snapshot para el harness E2E (no altera comportamiento en producción).
    useEffect(() => {
        if (typeof onStateChange !== 'function') return;
        const active = session ? session.regions.find(r => r.regionId === session.activeRegionId) : null;
        let validation = null;
        let simulation = null;
        if (session) {
            try {
                const rep = canImportReport(session);
                const sum = summaryOf(session);
                validation = {
                    can: rep.can,
                    blocks: sum.issues.blocks,
                    reviews: (sum.issues.reviewWarningsUnresolved || 0) + (sum.issues.nodeReviewsUnresolved || 0) + (sum.issues.unknownNatureUnresolved || 0)
                };
            } catch { validation = null; }
            try {
                const sim = simulate(session, { companyId: null });
                simulation = {
                    allowed: !!sim.allowed,
                    total: sim.expectedCounts ? sim.expectedCounts.total : sim.effectiveNodeCount,
                    fingerprint: sim.fingerprint ? String(sim.fingerprint).slice(0, 16) : null,
                    reason: sim.reason || null
                };
            } catch { simulation = null; }
        }
        onStateChange({
            phase,
            uiStep,
            fileName: file ? file.name : null,
            format: formatName,
            sheets,
            regionCount: session ? session.regions.length : 0,
            activeRegion: session ? session.activeRegionId : null,
            nodeCount: active ? active.contract.nodes.length : 0,
            blocks: active ? (active.contract.errors || []).filter(e => e.severity === 'BLOCK').length : 0,
            silent: active ? (active.contract.silentCorruptionCount ?? 0) : 0,
            unaccounted: active ? (active.contract.dataLoss?.unaccountedRows ?? 0) : 0,
            validation,
            simulation,
            error: error ? `${error.where}: ${error.message}` : null
        });
    }, [phase, uiStep, session, file, formatName, sheets, error, onStateChange]);

    const docSummary = doc ? {
        rows: doc.rows ? doc.rows.length : 0,
        confidence: doc.extractionConfidence ?? '—',
        ocrUsed: !!doc.ocrUsed,
        format: (doc.source && doc.source.format) || formatName || '—'
    } : null;

    return (
        <NexusModal
            isOpen
            onClose={onClose}
            title={<>Asistente de Importación Universal <span className="text-white-50 ms-2">Paso {uiStep} de 6</span></>}
            icon="bi-magic text-primary"
            size="xl"
            contentClassName="shadow-lg"
        >
            <div className="modal-body p-4" data-testid="u2-wizard" data-u2-phase={phase}>
                <div className="alert alert-secondary py-2 small d-flex align-items-center gap-2">
                    <i className="bi bi-flask me-1"></i>
                    <span>Vista previa del nuevo asistente (en memoria, sin importar). El asistente clásico sigue siendo el camino productivo.</span>
                </div>

                <div className="d-flex flex-wrap gap-1 mb-3" data-testid="u2-stepper" aria-label="Progreso del asistente">
                    {STEPS.map((label, i) => {
                        const n = i + 1;
                        const done = n < uiStep;
                        const current = n === uiStep;
                        const reachable = done && session;
                        const cls = current ? 'btn-primary' : (done ? 'btn-outline-primary' : 'btn-outline-secondary disabled');
                        const inner = (<><span className="badge bg-dark me-1">{n}</span>{label}</>);
                        return reachable ? (
                            <button key={label} type="button" data-testid={`u2-step-${n}`} className={`btn btn-sm ${cls}`} onClick={() => { setUiStep(n); setShowU4Notice(false); }}>
                                {inner}
                            </button>
                        ) : (
                            <span key={label} data-testid={`u2-step-${n}`} className={`btn btn-sm ${cls}`} aria-current={current ? 'step' : undefined}>
                                {inner}
                            </span>
                        );
                    })}
                </div>

                {uiStep === 1 && (
                    <ImportFileStep
                        file={file}
                        formatLabel={formatName}
                        sheets={sheets}
                        sheetName={sheetName}
                        onSheetChange={handleSheetChange}
                        isPdf={isPdf}
                        pdfPages={pdfPages}
                        onPagesChange={setPdfPages}
                        busy={busy}
                        docSummary={docSummary}
                        error={error}
                        onFile={handleFileSelected}
                        onAnalyze={handleAnalyze}
                        onRetry={handleRetry}
                    />
                )}

                {uiStep === 2 && session && (
                    <ImportDiagnosticStep
                        session={session}
                        onSelectRegion={handleSelectRegion}
                        onBack={() => { setUiStep(1); setShowU4Notice(false); }}
                        onNext={() => setUiStep(3)}
                    />
                )}

                {uiStep === 3 && session && (
                    <ImportValidationStep
                        session={session}
                        onBack={() => { setUiStep(2); setShowU4Notice(false); }}
                        onNext={() => setShowU4Notice(true)}
                        showNotice={showU4Notice}
                    />
                )}

                {(extractionMs !== null || analysisMs !== null) && (
                    <small className="text-white-50 d-block mt-3">
                        {extractionMs !== null && <>Extracción: {extractionMs} ms. </>}
                        {analysisMs !== null && <>Análisis: {analysisMs} ms.</>}
                        {/* onSuccess se usa desde U-5 (importación real); el contrato de props ya es el final. */}
                    </small>
                )}
            </div>
        </NexusModal>
    );
}
