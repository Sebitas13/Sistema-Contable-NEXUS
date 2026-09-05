/**
 * ImportConfirmationStep.jsx — Paso 6 del UniversalImportWizard: confirmación final.
 *
 * ÚLTIMA BARRERA: muestra exactamente lo que se enviará y solo entonces
 * permite importar. Es el ÚNICO archivo del wizard nuevo con acceso a red,
 * limitado a: POST /api/accounts/bulk (lotes de 500, con cancelación) y
 * PUT /api/companies/:id (estructura, solo tras import exitoso).
 * Semántica idéntica al performImport() del asistente clásico.
 */

import React, { useMemo, useState, useRef } from 'react';
import axios from 'axios';
import API_URL from '../../api.js';
import { canImport, simulate, effectiveContractOf } from '../../importSession/index.js';
import { deriveCompanyStructure } from './companyStructure.js';
import { useToast } from '../ToastProvider.jsx';

const BATCH_SIZE = 500;

export default function ImportConfirmationStep({ session, companyId, companyName, onBack, onSuccess, onClose }) {
    const can = useMemo(() => canImport(session), [session]);
    const sim = useMemo(() => simulate(session, { companyId: companyId || null }), [session, companyId]);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [result, setResult] = useState(null); // { successCount, errorCount, companyPutOk, total }
    const [error, setError] = useState(null);
    const cancelRef = useRef(null);
    let toast = null;
    try {
        toast = useToast();
    } catch {
        toast = null; // sin provider (harness E2E): el panel inline es la fuente primaria
    }

    const blockedReason = !companyId
        ? 'No hay empresa activa para importar.'
        : (!can ? 'Hay puntos sin resolver: vuelve a la revisión.' : null);
    const payloadAccounts = (sim.payload && Array.isArray(sim.payload.accounts)) ? sim.payload.accounts : [];

    async function handleConfirm() {
        if (blockedReason || importing) return;
        setError(null);
        setResult(null);
        setImporting(true);
        setProgress(0);
        const source = axios.CancelToken.source();
        cancelRef.current = source;
        let success = 0, fails = 0;
        try {
            // Re-simular en el momento de confirmar: el payload nace del Effective actual.
            const fresh = simulate(session, { companyId });
            if (!fresh.allowed || !fresh.payload) {
                throw new Error(fresh.reason || 'La simulación previa al envío no está permitida.');
            }
            const accounts = fresh.payload.accounts;
            const total = accounts.length;
            if (total === 0) throw new Error('No hay cuentas para importar.');
            for (let i = 0; i < total; i += BATCH_SIZE) {
                if (source.token.reason) throw new Error('Importación cancelada');
                const batch = accounts.slice(i, i + BATCH_SIZE);
                const response = await axios.post(`${API_URL}/api/accounts/bulk`, {
                    companyId,
                    accounts: batch
                }, { cancelToken: source.token });
                const resData = response.data || {};
                success += (resData.successCount ?? batch.length);
                fails += (resData.errorCount ?? 0);
                setProgress(Math.round(((i + batch.length) / total) * 100));
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            // Persistir la estructura SOLO si el import terminó sin lanzar errores
            // Y SOLO si el contrato declara longitudes de nivel (sin inventar máscara).
            let companyPut = 'skipped';
            const structure = deriveCompanyStructure(effectiveContractOf(session));
            if (structure) {
                try {
                    await axios.put(`${API_URL}/api/companies/${companyId}`, structure);
                    companyPut = 'updated';
                } catch (structureErr) {
                    companyPut = 'failed';
                    toast?.warning?.('Cuentas importadas, pero la estructura de la empresa no se pudo actualizar.');
                }
            }
            setResult({ successCount: success, errorCount: fails, companyPut, total });
            if (fails === 0) toast?.success?.(`${success} cuentas importadas correctamente.`);
            else toast?.warning?.(`Importadas ${success} cuentas · ${fails} con error (duplicadas o inválidas).`);
            if (onSuccess) onSuccess();
        } catch (err) {
            if (axios.isCancel(err) || String(err.message || '').includes('cancelada')) {
                toast?.info?.('Importación cancelada.');
            } else {
                const message = 'Error en la importación: ' + (err.response?.data?.error || err.message);
                setError(message);
            }
        } finally {
            setImporting(false);
            setProgress(0);
            cancelRef.current = null;
        }
    }

    function handleCancel() {
        if (cancelRef.current) cancelRef.current.cancel('Importación cancelada por el usuario');
    }

    return (
        <div data-testid="u2-confirm">
            <div className="alert alert-info">
                <i className="bi bi-info-circle me-2"></i>
                <strong>Estos son los datos que se enviarán.</strong> Revisa el resumen antes de confirmar.
                {companyName && <span className="d-block mt-1">Empresa destino: <strong>{companyName}</strong></span>}
            </div>

            {!companyId && (
                <div className="alert alert-warning" data-testid="u2-no-company">
                    <i className="bi bi-exclamation-triangle me-2"></i>
                    No hay empresa activa para importar. Abre el asistente desde el plan de cuentas de una empresa.
                </div>
            )}
            {companyId && !can && (
                <div className="alert alert-danger">
                    <i className="bi bi-x-octagon me-2"></i>
                    Hay puntos sin resolver: vuelve a la revisión antes de confirmar.
                </div>
            )}

            <div className="card glass-panel border-secondary mb-3">
                <div className="card-body small">
                    <div>Nodos a importar: <strong>{payloadAccounts.length}</strong> en lotes de {BATCH_SIZE}</div>
                    <div className="mt-1">Destino: <code>POST /api/accounts/bulk</code></div>
                    <div className="mt-1 text-white-50">Tras el import se actualizará la estructura de la empresa (máscara de códigos).</div>
                </div>
            </div>

            {error && (
                <div className="alert alert-danger" data-testid="u2-import-error">
                    <i className="bi bi-exclamation-triangle me-2"></i>{error}
                </div>
            )}

            {result ? (
                <div data-testid="u2-import-result">
                    <div className={`alert ${result.errorCount === 0 ? 'alert-success' : 'alert-warning'}`}>
                        <i className={`bi ${result.errorCount === 0 ? 'bi-check-circle' : 'bi-exclamation-triangle'} me-2`}></i>
                        {result.errorCount === 0
                            ? <><strong>{result.successCount} cuentas importadas correctamente.</strong></>
                            : <><strong>Importadas {result.successCount} cuentas · {result.errorCount} con error</strong> (duplicadas o inválidas).</>}
                        <span className="d-block mt-1 small" data-testid="u2-structure-state">Estructura de la empresa: {result.companyPut === 'updated'
                            ? 'actualizada'
                            : (result.companyPut === 'skipped'
                                ? 'no determinada por el análisis — no actualizada'
                                : 'no actualizada')}.</span>
                    </div>
                    <div className="text-end">
                        <button type="button" data-testid="u2-close-btn" className="btn btn-premium px-5" onClick={onClose}>
                            Cerrar
                        </button>
                    </div>
                </div>
            ) : importing ? (
                <div className="text-center" data-testid="u2-import-progress">
                    <h5>Importando cuentas...</h5>
                    <div className="progress mb-2 bg-dark border border-secondary" style={{ height: '25px', borderRadius: '12px' }}>
                        <div className="progress-bar progress-bar-striped progress-bar-animated bg-primary" role="progressbar"
                            style={{ width: `${progress}%` }} aria-valuenow={progress} aria-valuemin="0" aria-valuemax="100">
                            {progress}%
                        </div>
                    </div>
                    <button type="button" data-testid="u2-cancel-btn" className="btn btn-danger" onClick={handleCancel}>
                        <i className="bi bi-x-circle me-2"></i>Cancelar importación
                    </button>
                </div>
            ) : (
                <div className="d-flex justify-content-between pt-3 border-top">
                    <button type="button" data-testid="u2-back-btn" className="btn btn-outline-secondary px-4" onClick={onBack}>
                        <i className="bi bi-arrow-left me-2"></i>Atrás
                    </button>
                    <button type="button" data-testid="u2-confirm-btn" className="btn btn-premium px-5" onClick={handleConfirm}
                        disabled={!!blockedReason} title={blockedReason || 'Importar ahora'}>
                        <i className="bi bi-cloud-upload me-2"></i>Confirmar e importar
                    </button>
                </div>
            )}
        </div>
    );
}
