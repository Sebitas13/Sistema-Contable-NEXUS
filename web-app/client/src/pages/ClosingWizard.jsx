import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import API_URL from '../api';
import { useCompany } from '../context/CompanyContext';
import { getFiscalYearDetails } from '../utils/fiscalYearUtils';

export default function ClosingWizard({ onClose, onSuccess }) {
    const { selectedCompany } = useCompany();
    const [step, setStep] = useState(1);
    const [gestion, setGestion] = useState(new Date().getFullYear() - 1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [proposal, setProposal] = useState(null);

    const fiscalYearDetails = useMemo(() => {
        if (!selectedCompany) return null;
        return getFiscalYearDetails(selectedCompany.activity_type, gestion);
    }, [selectedCompany, gestion]);

    const handleGenerateProposal = async () => {
        setLoading(true);
        setError('');
        try {
            // Recuperar configuración de reserva legal guardada por Worksheet
            const key = `worksheet_custom_section_${selectedCompany.id}`;
            const savedState = JSON.parse(localStorage.getItem(key) || '{}');
            const { reservaLegalPct = 5, overrideReservaLegal = false } = savedState;

            const response = await axios.post(`${API_URL}/api/reports/closing-entries-proposal`, {
                companyId: selectedCompany.id,
                gestion: gestion,
                reservaLegalPct,
                overrideReservaLegal
            });
            setProposal(response.data.data);
            setStep(2);
        } catch (err) {
            setError(err.response?.data?.error || 'Error al generar la propuesta de cierre.');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmAndSave = async () => {
        if (!proposal || !proposal.proposedTransactions) {
            alert('No hay asientos propuestos para guardar.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const transactionsToSave = proposal.proposedTransactions.map(t => ({
                ...t,
                date: proposal.closingDate,
                type: 'Cierre',
            }));

            await axios.post(`${API_URL}/api/transactions/batch`, {
                companyId: selectedCompany.id,
                transactions: transactionsToSave,
            });

            alert('¡Cierre de gestión guardado exitosamente!');
            onSuccess();
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Error al guardar los asientos de cierre.');
        } finally {
            setLoading(false);
        }
    };

    const totalBatchDebit = useMemo(() => {
        if (!proposal) return 0;
        return proposal.proposedTransactions.reduce((total, trans) =>
            total + trans.entries.reduce((sub, entry) => sub + (entry.debit || 0), 0), 0);
    }, [proposal]);

    const totalBatchCredit = useMemo(() => {
        if (!proposal) return 0;
        return proposal.proposedTransactions.reduce((total, trans) =>
            total + trans.entries.reduce((sub, entry) => sub + (entry.credit || 0), 0), 0);
    }, [proposal]);

    const isBalanced = Math.abs(totalBatchDebit - totalBatchCredit) < 0.01;

    return (
        <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2050 }}>
            <div className="modal-dialog modal-fullscreen">
                <div className="modal-content glass-panel border-secondary shadow">
                    <div className="modal-header border-warning" style={{ backgroundColor: 'rgba(255, 193, 7, 0.1)' }}>
                        <h5 className="modal-title text-warning">
                            <i className="bi bi-archive-fill me-2"></i>Asistente de Cierre de Gestión
                        </h5>
                        <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
                    </div>
                    <div className="modal-body p-4 text-white">
                        {error && <div className="alert border-danger text-danger mb-4" style={{ backgroundColor: 'rgba(220, 53, 69, 0.1)' }}>{error}</div>}

                        {step === 1 && (
                            <div className="text-center p-5">
                                <i className="bi bi-calendar-x display-1 text-warning mb-4"></i>
                                <h4>Seleccione la Gestión a Cerrar</h4>
                                <p className="text-white-50 mb-4">
                                    El sistema generará los asientos de cierre para el período fiscal seleccionado.
                                    <br />
                                    Para la empresa <strong className="text-white">{selectedCompany?.name}</strong>, el período fiscal es del
                                    <strong className="text-white"> {fiscalYearDetails?.startDate}</strong> al <strong className="text-white">{fiscalYearDetails?.endDate}</strong>.
                                </p>
                                <div className="d-flex justify-content-center">
                                    <div className="w-25">
                                        <label className="form-label text-white-50">Año de Inicio de Gestión</label>
                                        <input
                                            type="number"
                                            className="form-control form-control-lg text-center bg-dark text-white border-secondary"
                                            value={gestion}
                                            onChange={(e) => setGestion(parseInt(e.target.value))}
                                            min="2000"
                                            max={new Date().getFullYear()}
                                        />
                                    </div>
                                </div>
                                <button className="btn btn-warning btn-lg mt-4 text-dark" onClick={handleGenerateProposal} disabled={loading}>
                                    {loading ? 'Generando...' : <><i className="bi bi-magic me-2"></i>Generar Propuesta de Cierre</>}
                                </button>
                            </div>
                        )}

                        {step === 2 && proposal && (
                            <div>
                                <div className="alert border-info d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3 mb-4" style={{ backgroundColor: 'rgba(13, 202, 240, 0.1)', color: '#0dcaf0' }}>
                                    <div>
                                        <h5 className="alert-heading text-info">Propuesta de Asientos de Cierre</h5>
                                        <p className="mb-0 text-white">
                                            Se han generado <strong>{proposal.proposedTransactions.length}</strong> asientos para cerrar la gestión <strong>{gestion}</strong>.
                                            La fecha de los comprobantes será <strong>{proposal.closingDate}</strong>.
                                        </p>
                                    </div>
                                    <div className="d-flex flex-wrap gap-2">
                                        <button className="btn btn-sm btn-outline-light" onClick={() => setStep(1)}>
                                            <i className="bi bi-arrow-left me-1"></i>Cambiar Gestión
                                        </button>
                                    </div>
                                </div>

                                <div className="d-flex flex-column gap-3" style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
                                    {proposal.proposedTransactions.map((trans, transIdx) => (
                                        <div key={transIdx} className="card glass-panel border-secondary shadow-sm">
                                            <div className="card-header border-secondary text-white" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                                                <div className="d-flex justify-content-between">
                                                    <span className="fw-bold">Asiento Propuesto #{transIdx + 1}</span>
                                                    <span className="text-white-50">{trans.gloss}</span>
                                                </div>
                                            </div>
                                            <div className="card-body p-0">
                                                <table className="table table-dark table-sm table-bordered border-secondary mb-0" style={{ backgroundColor: 'transparent' }}>
                                                    <thead style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                                                        <tr>
                                                            <th className="text-white-50">Cuenta</th>
                                                            <th className="text-end text-white-50">Debe</th>
                                                            <th className="text-end text-white-50">Haber</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {trans.entries.map((entry, entryIdx) => (
                                                            <tr key={entryIdx}>
                                                                <td className="border-secondary">
                                                                    <small className="text-white-50 d-block">{entry.accountId}</small>
                                                                    <span className="text-white">{entry.accountName}</span>
                                                                </td>
                                                                <td className="text-end font-monospace border-secondary text-white">
                                                                    {entry.debit > 0 ? entry.debit.toFixed(2) : ''}
                                                                </td>
                                                                <td className="text-end font-monospace border-secondary text-white">
                                                                    {entry.credit > 0 ? entry.credit.toFixed(2) : ''}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot className="fw-bold" style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                                                        <tr>
                                                            <td className="text-end border-secondary text-white">Total Asiento:</td>
                                                            <td className="text-end border-secondary text-white">
                                                                {trans.entries.reduce((sum, e) => sum + (e.debit || 0), 0).toFixed(2)}
                                                            </td>
                                                            <td className="text-end border-secondary text-white">
                                                                {trans.entries.reduce((sum, e) => sum + (e.credit || 0), 0).toFixed(2)}
                                                            </td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="modal-footer border-secondary" style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                        <div className="d-flex w-100 justify-content-between align-items-center">
                            {step === 2 && (
                                <div className="d-flex gap-4">
                                    <div className="text-center">
                                        <small className="text-white-50 d-block">Total Debe</small>
                                        <h5 className="mb-0 text-success">{totalBatchDebit.toFixed(2)}</h5>
                                    </div>
                                    <div className="text-center">
                                        <small className="text-white-50 d-block">Total Haber</small>
                                        <h5 className="mb-0 text-danger">{totalBatchCredit.toFixed(2)}</h5>
                                    </div>
                                    {isBalanced ? (
                                        <div className="d-flex align-items-center text-success">
                                            <i className="bi bi-check-circle-fill me-2"></i>
                                            <strong>Balance Correcto</strong>
                                        </div>
                                    ) : (
                                        <div className="d-flex align-items-center text-danger">
                                            <i className="bi bi-exclamation-triangle-fill me-2"></i>
                                            <strong>Descuadrado por: {Math.abs(totalBatchDebit - totalBatchCredit).toFixed(2)}</strong>
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="ms-auto">
                                <button type="button" className="btn btn-outline-light me-2" onClick={onClose}>
                                    Cancelar
                                </button>
                                {step === 2 && (
                                    <button
                                        type="button"
                                        className="btn btn-success btn-lg"
                                        onClick={handleConfirmAndSave}
                                        disabled={loading || !isBalanced}
                                    >
                                        {loading ? 'Guardando...' : <><i className="bi bi-check-circle-fill me-2"></i>Confirmar y Guardar Cierre</>}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

