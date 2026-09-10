/**
 * ImportTrailViewer.jsx — Bitácora de importaciones (U-9, monitoreo).
 *
 * Lee las trazas guardadas en este navegador (readTrails) y permite
 * inspeccionar cada camino completo (eventos), copiarlo, descargarlo como
 * .json para enviarlo a revisión, o borrarlo. Solo lectura + export local.
 */

import React, { useState } from 'react';
import NexusModal from '../NexusModal.jsx';
import { readTrails, clearTrails } from './importTrail.js';

function safeRead() {
    try {
        return readTrails();
    } catch {
        return [];
    }
}

function resultOf(trail) {
    const results = (trail.events || []).filter(e => e && e.kind === 'result');
    return results.length > 0 ? results[results.length - 1] : null;
}

export default function ImportTrailViewer({ onClose, onChanged }) {
    const [trails, setTrails] = useState(safeRead);
    const [openId, setOpenId] = useState(null);
    const [copiedId, setCopiedId] = useState(null);

    async function handleCopy(trail) {
        const text = JSON.stringify(trail, null, 1);
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setCopiedId(trail.id);
            setTimeout(() => setCopiedId(current => (current === trail.id ? null : current)), 2000);
        } catch {
            // portapapeles no disponible: usar Descargar
        }
    }

    function handleDownload(trail) {
        try {
            const blob = new Blob([JSON.stringify(trail, null, 1)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `trayectoria-${(trail.fileName || 'importacion').replace(/[^\w.\-]+/g, '_')}-${trail.id}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
            // descarga no disponible en este contexto
        }
    }

    function handleClear() {
        try {
            clearTrails();
        } catch {
            // igual se refresca la vista
        }
        setTrails([]);
        setOpenId(null);
        if (onChanged) onChanged();
    }

    return (
        <NexusModal
            isOpen
            onClose={onClose}
            title="Bitácora de importaciones (este navegador)"
            icon="bi-journal-text text-info"
            size="lg"
            contentClassName="shadow-lg"
        >
            <div className="modal-body p-3" data-testid="u2-trail-viewer">
                <p className="small text-white-50">
                    Cada importación guarda su camino completo (extracción, análisis,
                    validación, tus correcciones, simulación y resultado) <strong>solo aquí</strong>.
                    Sin nombres de empresa ni NIT. Para revisión, copia o descarga la bitácora.
                </p>
                {trails.length === 0 ? (
                    <div className="alert alert-secondary">Aún no hay bitácoras en este navegador.</div>
                ) : (
                    <div className="list-group">
                        {trails.map((t, i) => {
                            const res = resultOf(t);
                            const open = openId === t.id;
                            return (
                                <div key={t.id || i} className="list-group-item bg-dark text-white border-secondary">
                                    <div className="d-flex gap-2 align-items-center flex-wrap">
                                        <div className="flex-grow-1">
                                            <strong>{t.fileName || '(sin archivo)'}</strong>
                                            <span className="text-white-50 ms-2 small">{t.at ? new Date(t.at).toLocaleString() : ''}</span>
                                            <div className="small text-white-50">
                                                {(t.events || []).length} eventos
                                                {res && <span className="ms-2">· ok:{res.successCount ?? 0} err:{res.errorCount ?? 0} · {res.status || ''}</span>}
                                            </div>
                                        </div>
                                        <button type="button" className="btn btn-sm btn-outline-info" onClick={() => setOpenId(open ? null : t.id)}>
                                            {open ? 'Ocultar' : 'Ver detalle'}
                                        </button>
                                        <button type="button" data-testid={`u2-trail-copy-${i}`} className="btn btn-sm btn-outline-secondary" onClick={() => handleCopy(t)}>
                                            {copiedId === t.id ? '¡Copiado!' : 'Copiar'}
                                        </button>
                                        <button type="button" data-testid={`u2-trail-download-${i}`} className="btn btn-sm btn-outline-secondary" onClick={() => handleDownload(t)}>
                                            Descargar
                                        </button>
                                    </div>
                                    {open && (
                                        <pre className="mt-2 p-2 bg-black border border-secondary rounded small" style={{ maxHeight: '320px', overflow: 'auto' }}>
                                            {JSON.stringify(t, null, 1)}
                                        </pre>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                <div className="d-flex justify-content-between mt-3">
                    <button type="button" data-testid="u2-trail-clear" className="btn btn-sm btn-outline-danger" onClick={handleClear} disabled={trails.length === 0}>
                        Borrar bitácoras
                    </button>
                    <button type="button" data-testid="u2-trail-close" className="btn btn-sm btn-outline-secondary" onClick={onClose}>
                        Cerrar
                    </button>
                </div>
            </div>
        </NexusModal>
    );
}
