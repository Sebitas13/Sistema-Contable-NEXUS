import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { exportToPDF, exportToExcel, generatePDFDoc } from '../utils/exportUtils';
import { useCompany } from '../context/CompanyContext';

// Importar API_URL explícitamente para evitar errores en producción
import API_URL from '../api';
import 'react-datepicker/dist/react-datepicker.css';
import * as XLSX from 'xlsx';
import MahoragaWheel from '../components/MahoragaWheel';
import { getFiscalYearDetails } from '../utils/fiscalYearUtils';


export default function TrialBalance() {
    const { selectedCompany } = useCompany();
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [totals, setTotals] = useState({ debit: 0, credit: 0, balanceDebit: 0, balanceCredit: 0 });

    // Export Modal State
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportConfig, setExportConfig] = useState({
        format: 'excel',
        fileName: '',
        orientation: 'portrait'
    });
    const [previewUrl, setPreviewUrl] = useState(null);

    const [mahoragaActive, setMahoragaActive] = useState(false);

    useEffect(() => {
        if (selectedCompany) {
            fetchTrialBalance();
            checkMahoragaStatus();
        }
    }, [selectedCompany]);

    const checkMahoragaStatus = async () => {
        try {
            const response = await axios.get(`${API_URL}/api/ai/mahoraga/config/${selectedCompany.id}`);
            if (response.data.success) {
                setMahoragaActive(response.data.active_pages.includes('TrialBalance'));
            }
        } catch (error) { console.error("Error checking Mahoraga status:", error); }
    };

    const fetchTrialBalance = async () => {
        setLoading(true);
        try {
            const response = await axios.get(`${API_URL}/api/reports/ledger`, {
                params: {
                    companyId: selectedCompany.id,
                    excludeAdjustments: true,
                    excludeClosing: true,
                }
            });
            const data = response.data.data || [];
            setAccounts(data);

            const totalDebit = data.reduce((sum, acc) => sum + (acc.total_debit || 0), 0);
            const totalCredit = data.reduce((sum, acc) => sum + (acc.total_credit || 0), 0);
            const totalBalanceDebit = data.reduce((sum, acc) => sum + (acc.balance > 0 ? acc.balance : 0), 0);
            const totalBalanceCredit = data.reduce((sum, acc) => sum + (acc.balance < 0 ? Math.abs(acc.balance) : 0), 0);
            setTotals({ debit: totalDebit, credit: totalCredit, balanceDebit: totalBalanceDebit, balanceCredit: totalBalanceCredit });

        } catch (error) {
            console.error('Error fetching trial balance:', error);
        } finally {
            setLoading(false);
        }
    };
    const formatCurrency = (value) => {
        const numValue = parseFloat(value || 0);
        return `Bs ${numValue.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };
    // Export Logic
    const handleOpenExport = (format) => {
        const defaultName = `Balance_Comprobacion_${selectedCompany?.name.replace(/\s/g, '_') || 'Empresa'}`;

        setExportConfig({
            format,
            fileName: defaultName,
            orientation: 'landscape' // Default to landscape for this report
        });
        setShowExportModal(true);
    };

    const getExportData = useCallback(() => {
        const data = accounts.map(acc => ({
            'Código': acc.code,
            'Cuenta': acc.name,
            'Debe': formatCurrency(acc.total_debit),
            'Haber': formatCurrency(acc.total_credit),
            'Saldo Deudor': acc.balance > 0 ? formatCurrency(acc.balance) : '-',
            'Saldo Acreedor': acc.balance < 0 ? formatCurrency(Math.abs(acc.balance)) : '-'
        }));

        // Add totals row
        data.push({
            'Código': 'TOTALES',
            'Cuenta': '',
            'Debe': formatCurrency(totals.debit),
            'Haber': formatCurrency(totals.credit),
            'Saldo Deudor': formatCurrency(totals.balanceDebit),
            'Saldo Acreedor': formatCurrency(totals.balanceCredit)
        });


        const columns = [
            { header: 'Código', field: 'Código' },
            { header: 'Cuenta', field: 'Cuenta' },
            { header: 'Debe', field: 'Debe' },
            { header: 'Haber', field: 'Haber' },
            { header: 'Saldo Deudor', field: 'Saldo Deudor' },
            { header: 'Saldo Acreedor', field: 'Saldo Acreedor' }
        ];

        // Fiscal period logic
        let subText = `al ${format(new Date(), 'dd/MM/yyyy')}`;
        if (selectedCompany?.current_year && selectedCompany?.activity_type) {
            const fiscal = getFiscalYearDetails(selectedCompany.activity_type, selectedCompany.current_year, selectedCompany.operation_start_date);
            const fStart = new Date(fiscal.startDate + 'T00:00:00');
            const fEnd = new Date(fiscal.endDate + 'T00:00:00');
            const formatSpanish = (d) => format(d, "d 'de' MMMM 'de' yyyy", { locale: es }); // Import needed if not present (es is imported)
            subText = `del ${formatSpanish(fStart)} al ${formatSpanish(fEnd)}`;
        }

        return {
            data,
            columns,
            title: `Balance de Comprobación - ${selectedCompany?.name}`,
            subtitle: `Expresado en Bolivianos (Bs), ${subText}`
        };
    }, [accounts, totals, selectedCompany]);


    // Generate preview
    useEffect(() => {
        if (!showExportModal) {
            setPreviewUrl(null);
            return;
        }

        const { data, columns, title, subtitle } = getExportData();

        if (exportConfig.format === 'pdf') {
            try {
                const doc = generatePDFDoc(data, columns, title, {
                    ...exportConfig,
                    subtitle,
                    hideDefaultDate: !!(selectedCompany?.current_year),
                    cellStyleCallback: (data) => {
                        // Bold the totals row
                        if (data.row.raw['Código'] === 'TOTALES') {
                            data.cell.styles.fontStyle = 'bold';
                        }
                    }
                });
                const blobUrl = doc.output('bloburl');
                setPreviewUrl(blobUrl);
            } catch (e) {
                console.error("Error generating PDF preview", e);
            }
        }
    }, [showExportModal, exportConfig, getExportData]);

    const executeExport = () => {
        const { data, columns, title, subtitle } = getExportData();
        const fileName = exportConfig.fileName || 'Reporte';

        // For Excel, we might want unformatted numbers
        const excelData = accounts.map(acc => ({
            'Código': acc.code,
            'Cuenta': acc.name,
            'Debe': acc.total_debit || 0,
            'Haber': acc.total_credit || 0,
            'Saldo Deudor': acc.balance > 0 ? acc.balance : 0,
            'Saldo Acreedor': acc.balance < 0 ? Math.abs(acc.balance) : 0
        }));
        excelData.push({
            'Código': 'TOTALES',
            'Cuenta': '',
            'Debe': totals.debit,
            'Haber': totals.credit,
            'Saldo Deudor': totals.balanceDebit,
            'Saldo Acreedor': totals.balanceCredit
        });


        if (exportConfig.format === 'excel') {
            exportToExcel(excelData, 'Balance Comprobación', fileName);
        } else {
            exportToPDF(data, columns, title, {
                fileName,
                orientation: exportConfig.orientation,
                subtitle,
                hideDefaultDate: !!(selectedCompany?.current_year),
                cellStyleCallback: (data) => {
                    if (data.row.raw['Código'] === 'TOTALES') {
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
            });
        }
        setShowExportModal(false);
    };


    return (
        <div className="container-fluid">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2 className="mb-1">
                        <i className="bi bi-file-spreadsheet me-2 text-success"></i>
                        Balance de Comprobación
                    </h2>
                    <p className="text-muted mb-0">Comprobante de sumas y saldos para verificar la partida doble.</p>
                </div>
                <div className="d-flex gap-2 align-items-center">
                    {mahoragaActive && <MahoragaWheel size="small" />}
                    <button className="btn btn-success btn-sm" onClick={() => handleOpenExport('excel')}>
                        <i className="bi bi-file-earmark-excel me-1"></i> Exportar Excel
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleOpenExport('pdf')}>
                        <i className="bi bi-file-earmark-pdf me-1"></i> Exportar PDF
                    </button>
                </div>
            </div>


            <div className="card shadow-sm border-0">
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-hover mb-0 align-middle">
                            <thead className="table-light">
                                <tr>
                                    <th style={{ width: '15%' }}>Código</th>
                                    <th>Cuenta</th>
                                    <th className="text-end" style={{ width: '15%' }}>Debe</th>
                                    <th className="text-end" style={{ width: '15%' }}>Haber</th>
                                    <th className="text-end" style={{ width: '15%' }}>Saldo Deudor</th>
                                    <th className="text-end" style={{ width: '15%' }}>Saldo Acreedor</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan="6" className="text-center py-5">
                                            <div className="spinner-border text-primary" role="status"></div>
                                            <p className="mt-3 text-muted mb-0">Cargando balance...</p>
                                        </td>
                                    </tr>
                                ) : accounts.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="text-center py-5 text-muted">
                                            <i className="bi bi-inbox fs-2 d-block mb-2"></i>
                                            No hay cuentas con movimientos para mostrar.
                                        </td>
                                    </tr>
                                ) : (
                                    accounts.map((acc) => (
                                        <tr key={acc.id}>
                                            <td><span className="badge bg-light text-dark border">{acc.code}</span></td>
                                            <td>{acc.name}</td>
                                            <td className="text-end">{formatCurrency(acc.total_debit)}</td>
                                            <td className="text-end">{formatCurrency(acc.total_credit)}</td>
                                            <td className="text-end text-primary fw-medium">{acc.balance > 0 ? formatCurrency(acc.balance) : '-'}</td>
                                            <td className="text-end text-info fw-medium">{acc.balance < 0 ? formatCurrency(Math.abs(acc.balance)) : '-'}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                            {!loading && accounts.length > 0 && (
                                <tfoot className="table-dark">
                                    <tr className="fw-bold">
                                        <td colSpan="2" className="text-end">TOTALES</td>
                                        <td className="text-end">{formatCurrency(totals.debit)}</td>
                                        <td className="text-end">{formatCurrency(totals.credit)}</td>
                                        <td className="text-end">{formatCurrency(totals.balanceDebit)}</td>
                                        <td className="text-end">{formatCurrency(totals.balanceCredit)}</td>
                                    </tr>
                                    {totals.balanceDebit !== totals.balanceCredit && (
                                        <tr className="fw-bold bg-warning text-dark">
                                            <td colSpan="4" className="text-end">Diferencia</td>
                                            <td colSpan="2" className="text-center">{formatCurrency(Math.abs(totals.balanceDebit - totals.balanceCredit))}</td>
                                        </tr>
                                    )}

                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            </div>

            {/* Export Modal */}
            {showExportModal && (
                <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
                    <div className="modal-dialog modal-dialog-centered modal-xl">
                        <div className="modal-content shadow" style={{ maxHeight: '90vh' }}>
                            <div className="modal-header">
                                <h5 className="modal-title">
                                    <i className={`bi bi-file-earmark-${exportConfig.format === 'excel' ? 'excel text-success' : 'pdf text-danger'} me-2`}></i>
                                    Exportar a {exportConfig.format === 'excel' ? 'Excel' : 'PDF'}
                                </h5>
                                <button type="button" className="btn-close" onClick={() => setShowExportModal(false)}></button>
                            </div>
                            <div className="modal-body p-0">
                                <div className="row h-100 g-0">
                                    <div className="col-md-3 border-end p-3 bg-light">
                                        <form onSubmit={(e) => e.preventDefault()}>
                                            <div className="mb-3">
                                                <label className="form-label fw-bold">Configuración</label>
                                                <div className="mb-3">
                                                    <label className="form-label small">Nombre del archivo</label>
                                                    <input
                                                        type="text"
                                                        className="form-control"
                                                        value={exportConfig.fileName}
                                                        onChange={(e) => setExportConfig({ ...exportConfig, fileName: e.target.value })}
                                                    />
                                                </div>
                                                {exportConfig.format === 'pdf' && (
                                                    <div className="mb-3">
                                                        <label className="form-label small d-block">Orientación</label>
                                                        <div className="btn-group w-100" role="group">
                                                            <input
                                                                type="radio"
                                                                className="btn-check"
                                                                name="orientation"
                                                                id="portrait"
                                                                checked={exportConfig.orientation === 'portrait'}
                                                                onChange={() => setExportConfig({ ...exportConfig, orientation: 'portrait' })}
                                                            />
                                                            <label className="btn btn-outline-secondary btn-sm" htmlFor="portrait">
                                                                <i className="bi bi-file-earmark me-1"></i>Vertical
                                                            </label>
                                                            <input
                                                                type="radio"
                                                                className="btn-check"
                                                                name="orientation"
                                                                id="landscape"
                                                                checked={exportConfig.orientation === 'landscape'}
                                                                onChange={() => setExportConfig({ ...exportConfig, orientation: 'landscape' })}
                                                            />
                                                            <label className="btn btn-outline-secondary btn-sm" htmlFor="landscape">
                                                                <i className="bi bi-file-earmark-landscape me-1"></i>Horiz.
                                                            </label>
                                                        </div>
                                                    </div>
                                                )}
                                                <div className="alert alert-info py-2 small mb-0">
                                                    <i className="bi bi-info-circle me-2"></i>
                                                    {accounts.length} cuentas listas para exportar.
                                                </div>
                                            </div>
                                        </form>
                                    </div>
                                    <div className="col-md-9 p-3 bg-secondary bg-opacity-10 d-flex flex-column">
                                        <h6 className="text-muted mb-2 small text-uppercase fw-bold">Vista Previa</h6>
                                        <div className="flex-grow-1 bg-white shadow-sm border rounded overflow-hidden position-relative" style={{ minHeight: '400px', maxHeight: '60vh', overflowY: 'auto' }}>
                                            {exportConfig.format === 'pdf' ? (
                                                previewUrl ? (
                                                    <iframe src={previewUrl} title="PDF Preview" style={{ width: '100%', height: '100%', minHeight: '500px', border: 'none' }} />
                                                ) : (
                                                    <div className="d-flex align-items-center justify-content-center h-100 p-5">
                                                        <div className="spinner-border text-secondary" role="status"></div>
                                                        <span className="ms-2 text-muted">Generando vista previa...</span>
                                                    </div>
                                                )
                                            ) : (
                                                <div className="table-responsive">
                                                    {(() => {
                                                        const { data, columns } = getExportData();
                                                        return (
                                                            <>
                                                                <table className="table table-striped table-bordered table-sm small mb-0">
                                                                    <thead className="table-light sticky-top">
                                                                        <tr>
                                                                            {columns.map((col, i) => (
                                                                                <th key={i} className="text-nowrap px-2 py-1">{col.header}</th>
                                                                            ))}
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {data.slice(0, 100).map((row, i) => (
                                                                            <tr key={i} className={row['Código'] === 'TOTALES' ? 'fw-bold table-active' : ''}>
                                                                                {columns.map((col, j) => (
                                                                                    <td key={j} className="text-nowrap px-2 py-1">{row[col.field]}</td>
                                                                                ))}
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                                {data.length > 100 && (
                                                                    <div className="text-center p-2 text-muted small bg-light border-top">
                                                                        Mostrando primeros 100 registros...
                                                                    </div>
                                                                )}
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="modal-footer bg-light">
                                <button type="button" className="btn btn-outline-secondary" onClick={() => setShowExportModal(false)}>
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    className={`btn btn-${exportConfig.format === 'excel' ? 'success' : 'danger'}`}
                                    onClick={executeExport}
                                >
                                    <i className="bi bi-download me-2"></i>Descargar Archivo
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
