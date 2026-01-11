import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import API_URL from '../api';
import { useCompany } from '../context/CompanyContext';
import { format } from 'date-fns';
import FinancialStatementEngine from '../utils/FinancialStatementEngine'; // For Balance Sheet
import { generarEstadoResultadosDesdeWorksheet } from '../utils/IncomeStatementEngine'; // For Income Statement V5
import { exportToPDF, exportToExcel, generatePDFDoc } from '../utils/exportUtils';
import MahoragaWheel from '../components/MahoragaWheel';
import { getFiscalYearDetails } from '../utils/fiscalYearUtils';
import { es } from 'date-fns/locale';
import './FinancialStatements.css';

// --- Shared Helpers (Exported for Reuse in Worksheet.jsx) ---

export const formatearMonto = (monto) => {
    const val = monto || 0;
    const absVal = Math.abs(val);
    const str = absVal.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return val < 0 ? `(${str})` : str;
};

// Componente Recursivo para Filas (Balance) - Exported per requirement
export const TreeRow = ({ node, level = 0 }) => {
    const isHeader = level === 0;
    const paddingLeft = `${level * 1.5}rem`;
    const isReguladora = node.esReguladora;
    let rowClass = "";
    if (isHeader) rowClass += " table-light fw-bold";
    if (isReguladora) rowClass += " text-danger fst-italic";

    return (
        <>
            <tr className={rowClass} style={{ fontSize: isHeader ? '1rem' : '0.9rem' }}>
                <td style={{ paddingLeft }}>
                    <div className="d-flex align-items-center">
                        <span>{node.name}</span>
                    </div>
                    {level > 0 && <div className="text-muted small fst-normal ms-1" style={{ fontSize: '0.7em' }}>{node.code}</div>}
                </td>
                <td className="text-end fw-bold-if-header">
                    {formatearMonto(node.total)}
                </td>
            </tr>
            {node.hijos && node.hijos.map(child => (
                <TreeRow key={child.id} node={child} level={level + 1} />
            ))}
        </>
    );
};

// Componente Interno para Filas de Estado de Resultados V5 (Exported if needed)
export const ERRow = ({ label, value, bold = false, color = '', isTotal = false, level = 0 }) => (
    <tr className={`${bold ? 'fw-bold' : ''} ${color} ${isTotal ? 'border-top border-dark' : ''}`}>
        <td className={`ps-${4 + level * 2}`}>{label}</td>
        <td className="text-end pe-3">{formatearMonto(value)}</td>
    </tr>
);

export const RenderList = ({ list, title }) => {
    if (!list || list.length === 0) return null;
    return (
        <>
            {title && <tr className="fw-bold bg-light"><td colSpan="2" className="ps-4 text-uppercase pt-3" style={{ fontSize: '0.8rem' }}>{title}</td></tr>}
            {list.map(node => (
                <ERRow key={node.id} label={node.name} value={node.displayValue} level={1} />
            ))}
        </>
    );
};

// --- Main Component ---

export default function FinancialStatements() {
    const { selectedCompany } = useCompany();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(null);
    const [balanceGeneral, setBalanceGeneral] = useState(null);
    const [estadoResultados, setEstadoResultados] = useState(null);
    const [activeTab, setActiveTab] = useState('balance');
    const [error, setError] = useState(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

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
            fetchData();
            checkMahoragaStatus();
        }
    }, [selectedCompany, refreshTrigger]);

    const checkMahoragaStatus = async () => {
        try {
            const response = await axios.get(`/api/ai/mahoraga/config/${selectedCompany.id}`);
            if (response.data.success) {
                setMahoragaActive(response.data.active_pages.includes('FinancialStatements'));
            }
        } catch (error) { console.error("Error checking Mahoraga status:", error); }
    };

    useEffect(() => {
        const processData = async () => {
            if (data) {
                try {
                    // Cargar opciones desde localStorage
                    let options = {};
                    try {
                        const key = `worksheet_custom_section_${selectedCompany.id}`;
                        const raw = localStorage.getItem(key);
                        if (raw) {
                            const obj = JSON.parse(raw);
                            options = {
                                porcentajeReservaLegal: obj.reservaLegalPct !== undefined ? obj.reservaLegalPct : 5,
                                overrideReservaLegal: obj.overrideReservaLegal || false
                            };
                        }
                    } catch (e) {
                        console.warn("No se pudo cargar config de Worksheet para Estados Financieros", e);
                    }

                    // 1. Estado de Resultados PRIMERO (DESDE WORKSHEET - COLUMNAS ER)
                    const reporteV5 = await generarEstadoResultadosDesdeWorksheet(selectedCompany.id, options);
                    setEstadoResultados(reporteV5);
                    // 2. Balance General DESPUÉS (usa la utilidad líquida del ER)
                    const engineBG = new FinancialStatementEngine(data);
                    engineBG.utilidadLiquidaExterna = reporteV5.totales.utilidadLiquida;
                    engineBG.iuePorPagar = reporteV5.totales.iue;
                    engineBG.reservaLegalMonto = reporteV5.totales.reservaLegal;
                    setBalanceGeneral(engineBG.generarBalanceGeneral());
                } catch (err) {
                    console.error("Error procesando datos en motor:", err);
                    setError("Ocurrió un error al procesar la jerarquía de cuentas.");
                }
            }
        };

        processData();
    }, [data, selectedCompany.id]);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            // Para Balance General - mantener lógica actual
            const [accountsRes, bcRes, adjRes] = await Promise.all([
                axios.get(`${API_URL}/api/accounts?companyId=${selectedCompany.id}`),
                axios.get(`${API_URL}/api/reports/ledger`, {
                    params: { companyId: selectedCompany.id, excludeAdjustments: true, excludeClosing: true }
                }),
                axios.get(`${API_URL}/api/reports/ledger`, {
                    params: { companyId: selectedCompany.id, adjustmentsOnly: true, excludeClosing: true }
                })
            ]);
            const allAccounts = accountsRes.data.data || [];
            const bcData = bcRes.data.data || [];
            const adjData = adjRes.data.data || [];
            const bcMap = {};
            bcData.forEach(item => bcMap[item.id] = item);
            const adjMap = {};
            adjData.forEach(item => adjMap[item.id] = item);
            const mergedData = allAccounts.map(acc => {
                const bcInfo = bcMap[acc.id] || { total_debit: 0, total_credit: 0 };
                const adjInfo = adjMap[acc.id] || { total_debit: 0, total_credit: 0 };
                const finalDebit = (bcInfo.total_debit || 0) + (adjInfo.total_debit || 0);
                const finalCredit = (bcInfo.total_credit || 0) + (adjInfo.total_credit || 0);
                return {
                    ...acc,
                    total_debit: finalDebit,
                    total_credit: finalCredit,
                    type: acc.type,
                    parent_code: acc.parent_code
                };
            });
            setData(mergedData);
        } catch (err) {
            console.error(err);
            setError("Error cargando datos del Balance General.");
        } finally {
            setLoading(false);
        }
    };

    const handleOpenExport = (format) => {
        const reportName = activeTab === 'balance' ? 'Estado_Situacion_Financiera' : 'Estado_Resultados';
        const defaultName = `${reportName}_${selectedCompany?.name.replace(/\s/g, '_') || 'Empresa'}`;

        setExportConfig({
            format,
            fileName: defaultName,
            orientation: 'portrait'
        });
        setShowExportModal(true);
    };

    const getExportData = useCallback(() => {
        const title = activeTab === 'balance' ? 'Estado de Situación Financiera' : 'Estado de Resultados';

        // Fiscal period logic
        let subText = `al ${format(new Date(), 'dd/MM/yyyy')}`;
        if (selectedCompany?.current_year && selectedCompany?.activity_type) {
            const fiscal = getFiscalYearDetails(selectedCompany.activity_type, selectedCompany.current_year, selectedCompany.operation_start_date);
            const fStart = new Date(fiscal.startDate + 'T00:00:00');
            const fEnd = new Date(fiscal.endDate + 'T00:00:00');
            const formatSpanish = (d) => format(d, "d 'de' MMMM 'de' yyyy", { locale: es });
            subText = `del ${formatSpanish(fStart)} al ${formatSpanish(fEnd)}`;
        }

        const subtitle = `Expresado en Bolivianos (Bs), ${subText}`;

        let columns = [];
        let data = [];
        let excelData = [];

        const flattenTree = (nodes, level = 0, isExcel = false) => {
            let rows = [];
            nodes.forEach(node => {
                rows.push({
                    'Cuenta': ' '.repeat(level * 2) + node.name,
                    'Monto': isExcel ? node.total : formatearMonto(node.total)
                });
                if (node.hijos) {
                    rows = rows.concat(flattenTree(node.hijos, level + 1, isExcel));
                }
            });
            return rows;
        };

        if (activeTab === 'balance' && balanceGeneral) {
            columns = [{ header: 'Cuenta', field: 'Cuenta' }, { header: 'Monto', field: 'Monto' }];

            // Data for PDF/Display
            let pdfRows = [];
            pdfRows.push({ 'Cuenta': 'ACTIVO', 'Monto': '' });
            pdfRows = pdfRows.concat(flattenTree(balanceGeneral.activos));
            pdfRows.push({ 'Cuenta': 'Total Activo', 'Monto': formatearMonto(balanceGeneral.totales.activo) });
            pdfRows.push({ 'Cuenta': '', 'Monto': '' }); // Spacer
            pdfRows.push({ 'Cuenta': 'PASIVO', 'Monto': '' });
            pdfRows = pdfRows.concat(flattenTree(balanceGeneral.pasivos));
            pdfRows.push({ 'Cuenta': 'PATRIMONIO', 'Monto': '' });
            pdfRows = pdfRows.concat(flattenTree(balanceGeneral.patrimonio));
            pdfRows.push({ 'Cuenta': 'Total Pasivo y Patrimonio', 'Monto': formatearMonto(balanceGeneral.totales.pasivo + balanceGeneral.totales.patrimonio) });
            data = pdfRows;

            // Data for Excel (raw numbers)
            let excelRows = [];
            excelRows.push({ 'Cuenta': 'ACTIVO', 'Monto': '' });
            excelRows = excelRows.concat(flattenTree(balanceGeneral.activos, 0, true));
            excelRows.push({ 'Cuenta': 'Total Activo', 'Monto': balanceGeneral.totales.activo });
            excelRows.push({ 'Cuenta': '', 'Monto': '' }); // Spacer
            excelRows.push({ 'Cuenta': 'PASIVO', 'Monto': '' });
            excelRows = excelRows.concat(flattenTree(balanceGeneral.pasivos, 0, true));
            excelRows.push({ 'Cuenta': 'PATRIMONIO', 'Monto': '' });
            excelRows = excelRows.concat(flattenTree(balanceGeneral.patrimonio, 0, true));
            excelRows.push({ 'Cuenta': 'Total Pasivo y Patrimonio', 'Monto': balanceGeneral.totales.pasivo + balanceGeneral.totales.patrimonio });
            excelData = excelRows;

        } else if (activeTab === 'resultados' && estadoResultados) {
            columns = [{ header: 'Descripción', field: 'Descripción' }, { header: 'Monto', field: 'Monto' }];

            const pushRow = (label, value, isExcel = false) => ({
                'Descripción': label,
                'Monto': isExcel ? value : formatearMonto(value)
            });

            const buildRows = (isExcel = false) => {
                const { secciones, totales } = estadoResultados;
                let rows = [];

                rows.push(pushRow('INGRESOS OPERATIVOS', null, isExcel));
                secciones.ingresos.forEach(item => rows.push(pushRow('  ' + item.name, item.displayValue, isExcel)));
                rows.push(pushRow('MENOS: DESCUENTOS Y BONIFICACIONES', null, isExcel));
                secciones.descuentos.forEach(item => rows.push(pushRow('  ' + item.name, item.displayValue, isExcel)));
                rows.push(pushRow('VENTAS NETAS', totales.ventasNetas, isExcel));
                rows.push(pushRow('', null, isExcel));
                rows.push(pushRow('MENOS: COSTO DE VENTAS', null, isExcel));
                secciones.costos.forEach(item => rows.push(pushRow('  ' + item.name, item.displayValue, isExcel)));
                rows.push(pushRow('UTILIDAD BRUTA EN VENTAS', totales.utilidadBruta, isExcel));
                rows.push(pushRow('', null, isExcel));
                rows.push(pushRow('MENOS: GASTOS OPERATIVOS', null, isExcel));
                secciones.gastosAdmin.forEach(item => rows.push(pushRow('  ' + item.name, item.displayValue, isExcel)));
                secciones.gastosVenta.forEach(item => rows.push(pushRow('  ' + item.name, item.displayValue, isExcel)));
                secciones.gastosFinancieros.forEach(item => rows.push(pushRow('  ' + item.name, item.displayValue, isExcel)));
                rows.push(pushRow('Utilidad Neta en Ventas', totales.utilidadEnVentas, isExcel));
                rows.push(pushRow('', null, isExcel));
                rows.push(pushRow('MÁS: OTROS INGRESOS', null, isExcel));
                secciones.otrosIngresos.forEach(item => rows.push(pushRow('  ' + item.name, item.displayValue, isExcel)));
                rows.push(pushRow('UTILIDAD OPERATIVA', totales.utilidadOperativa, isExcel));
                rows.push(pushRow('MENOS: OTROS GASTOS', null, isExcel));
                secciones.otrosEgresos.forEach(item => rows.push(pushRow('  ' + item.name, item.displayValue, isExcel)));
                rows.push(pushRow('UTILIDAD BRUTA DEL EJERCICIO', totales.utilidadBrutaEjercicio, isExcel));
                if (totales.compensacion > 0) rows.push(pushRow('(-) Compensación Pérdidas Acum.', totales.compensacion, isExcel));
                if (totales.iue > 0) rows.push(pushRow('(-) IUE (25%)', totales.iue, isExcel));
                if (secciones.noImponibles.length > 0) {
                    rows.push(pushRow('MÁS: INGRESOS NO IMPONIBLES', null, isExcel));
                    secciones.noImponibles.forEach(item => rows.push(pushRow('  ' + item.name, item.displayValue, isExcel)));
                }
                rows.push(pushRow('UTILIDAD NETA DEL EJERCICIO', totales.utilidadNeta, isExcel));
                if (totales.reservaLegal > 0) {
                    const labelReserva = `(-) Reserva Legal (${estadoResultados.porcentajeReservaLegal || 5}%)`;
                    rows.push(pushRow(labelReserva, totales.reservaLegal, isExcel));
                }
                rows.push(pushRow(totales.utilidadLiquida >= 0 ? "UTILIDAD LÍQUIDA DEL EJERCICIO" : "PÉRDIDA DEL EJERCICIO", totales.utilidadLiquida, isExcel));
                return rows;
            };

            data = buildRows(false);
            excelData = buildRows(true);
        }

        return {
            data,
            excelData,
            columns,
            title: `${title} - ${selectedCompany?.name}`,
            subtitle
        };
    }, [activeTab, balanceGeneral, estadoResultados, selectedCompany]);

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
                    hideDefaultDate: !!(selectedCompany?.current_year)
                });
                const blobUrl = doc.output('bloburl');
                setPreviewUrl(blobUrl);
            } catch (e) {
                console.error("Error generating PDF preview", e);
            }
        }
    }, [showExportModal, exportConfig, getExportData]);

    const executeExport = () => {
        const { data, excelData, columns, title, subtitle } = getExportData();
        const fileName = exportConfig.fileName || 'Reporte';

        if (exportConfig.format === 'excel') {
            exportToExcel(excelData.length > 0 ? excelData : data, title, fileName);
        } else {
            exportToPDF(data, columns, title, {
                fileName,
                orientation: exportConfig.orientation,
                subtitle,
                hideDefaultDate: !!(selectedCompany?.current_year)
            });
        }
        setShowExportModal(false);
    };

    if (loading && !data) return <div className="p-5 text-center"><div className="spinner-border text-primary"></div><p className="mt-2">Cargando Estados Financieros...</p></div>;

    return (
        <div className="container-fluid py-4 animate__animated animate__fadeIn">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2 className="mb-1"><i className="bi bi-bank me-2"></i>Estados Financieros</h2>
                    <p className="text-muted mb-0">{selectedCompany?.name} (Consolidado V5)</p>
                </div>
                <div>
                    <button className="btn btn-outline-primary btn-sm me-2" onClick={() => setRefreshTrigger(t => t + 1)}>
                        <i className="bi bi-arrow-clockwise me-1"></i> Actualizar
                    </button>
                    {mahoragaActive && <MahoragaWheel size="small" />}
                    <div className="d-flex gap-2">
                        <button className="btn btn-success btn-sm" onClick={() => handleOpenExport('excel')}>
                            <i className="bi bi-file-earmark-excel me-1"></i> Exportar Excel
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleOpenExport('pdf')}>
                            <i className="bi bi-file-earmark-pdf me-1"></i> Exportar PDF
                        </button>
                    </div>
                </div>
            </div>

            {error && <div className="alert alert-danger mb-4 shadow-sm">{error}</div>}

            <ul className="nav nav-tabs mb-4">
                <li className="nav-item">
                    <button className={`nav-link ${activeTab === 'balance' ? 'active fw-bold' : ''}`} onClick={() => setActiveTab('balance')}>
                        Estado de Situación Financiera
                    </button>
                </li>
                <li className="nav-item">
                    <button className={`nav-link ${activeTab === 'resultados' ? 'active fw-bold' : ''}`} onClick={() => setActiveTab('resultados')}>
                        Estado de Resultados
                    </button>
                </li>
            </ul>

            <div className="tab-content">
                {/* BALANCE GENERAL */}
                {activeTab === 'balance' && balanceGeneral && (
                    <div className="row g-4">
                        <div className="col-lg-6">
                            <div className="card shadow h-100 border-top-primary">
                                <div className="card-header bg-white py-3">
                                    <h5 className="text-primary mb-0 fw-bold">ACTIVO</h5>
                                </div>
                                <div className="table-responsive" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                                    <table className="table table-hover table-sm mb-0 align-middle">
                                        <tbody>
                                            {balanceGeneral.activos.length > 0 ? (
                                                balanceGeneral.activos.map(node => <TreeRow key={node.id} node={node} />)
                                            ) : (
                                                <tr><td className="text-center text-muted py-4">Sin datos de Activo</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="card-footer bg-light mt-auto py-3">
                                    <div className="d-flex justify-content-between fw-bold fs-5">
                                        <span>Total Activo</span>
                                        <span className="text-primary">{formatearMonto(balanceGeneral.totales.activo)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="col-lg-6">
                            <div className="card shadow h-100 border-top-danger">
                                <div className="card-header bg-white py-3">
                                    <h5 className="text-danger mb-0 fw-bold">PASIVO Y PATRIMONIO</h5>
                                </div>
                                <div className="table-responsive" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                                    <table className="table table-hover table-sm mb-0 align-middle">
                                        <tbody>
                                            <tr className="bg-light fw-bold text-secondary"><td colSpan="2" className="py-2 ps-3">PASIVO</td></tr>
                                            {balanceGeneral.pasivos.map(node => <TreeRow key={node.id} node={node} />)}
                                            <tr className="bg-light fw-bold text-secondary"><td colSpan="2" className="py-2 ps-3 mt-2">PATRIMONIO</td></tr>
                                            {balanceGeneral.patrimonio.map(node => <TreeRow key={node.id} node={node} />)}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="card-footer bg-light mt-auto py-3">
                                    <div className="d-flex justify-content-between fw-bold fs-5 mb-2">
                                        <span>Total Pasivo + Patrimonio</span>
                                        <span className="text-danger">{formatearMonto(balanceGeneral.totales.pasivo + balanceGeneral.totales.patrimonio)}</span>
                                    </div>
                                    <div className={`alert ${balanceGeneral.ecuacionCuadra ? 'alert-success' : 'alert-danger'} mb-0 d-flex align-items-center py-2 px-3`}>
                                        {balanceGeneral.ecuacionCuadra
                                            ? <><i className="bi bi-check-circle-fill me-2 fs-5"></i> La ecuación contable cuadra.</>
                                            : <><i className="bi bi-exclamation-triangle-fill me-2 fs-5"></i> <strong>Descuadre:</strong>&nbsp;{formatearMonto(balanceGeneral.diferencia)}</>
                                        }
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ESTADO DE RESULTADOS (MOTOR V5) */}
                {activeTab === 'resultados' && estadoResultados && (
                    <div className="row justify-content-center">
                        <div className="col-lg-10">
                            <div className="card shadow border-top-info">
                                <div className="card-header bg-white py-3">
                                    <h5 className="text-info mb-0 fw-bold">Estado de Resultados</h5>
                                    <small className="text-muted">Generado por Motor V5 (Armonizado)</small>
                                </div>
                                <div className="card-body p-0">
                                    <div className="table-responsive">
                                        <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.9rem' }}>
                                            <tbody>
                                                {/* 1. INGRESOS */}
                                                <RenderList list={estadoResultados.secciones.ingresos} title="INGRESOS OPERATIVOS" />
                                                <RenderList list={estadoResultados.secciones.descuentos} title="MENOS: DESCUENTOS Y BONIFICACIONES" />
                                                <ERRow label="VENTAS NETAS" value={estadoResultados.totales.ventasNetas} bold isTotal />

                                                {/* 2. COSTOS */}
                                                <RenderList list={estadoResultados.secciones.costos} title="MENOS: COSTO DE VENTAS" />
                                                <ERRow label="UTILIDAD BRUTA EN VENTAS" value={estadoResultados.totales.utilidadBruta} bold color="table-primary" />

                                                {/* 3. GASTOS OPS */}
                                                <tr className="fw-bold text-muted"><td colSpan="2" className="pt-3 ps-4 text-uppercase" style={{ fontSize: '0.8rem' }}>MENOS: GASTOS OPERATIVOS</td></tr>
                                                <RenderList list={estadoResultados.secciones.gastosAdmin} title="Administración" />
                                                <RenderList list={estadoResultados.secciones.gastosVenta} title="Venta y Comercialización" />
                                                <RenderList list={estadoResultados.secciones.gastosFinancieros} title="Financieros" />
                                                <ERRow label="Utilidad Neta en Ventas" value={estadoResultados.totales.utilidadEnVentas} bold color="table-light ps-4" />

                                                {/* 4. OTROS */}
                                                <RenderList list={estadoResultados.secciones.otrosIngresos} title="MÁS: OTROS INGRESOS" />
                                                <ERRow label="UTILIDAD OPERATIVA" value={estadoResultados.totales.utilidadOperativa} bold />
                                                <RenderList list={estadoResultados.secciones.otrosEgresos} title="MENOS: OTROS GASTOS" />
                                                <ERRow label="UTILIDAD BRUTA DEL EJERCICIO" value={estadoResultados.totales.utilidadBrutaEjercicio} bold color="table-info" />

                                                {/* TRIBUTARIO */}
                                                {estadoResultados.totales.compensacion > 0 && (
                                                    <tr className="text-danger fw-bold">
                                                        <td className="ps-4">(-) Compensación Pérdidas Acum.</td>
                                                        <td className="text-end pe-3">{formatearMonto(estadoResultados.totales.compensacion)}</td>
                                                    </tr>
                                                )}
                                                {estadoResultados.totales.iue > 0 && (
                                                    <tr className="text-danger">
                                                        <td className="ps-4">(-) IUE (25%)</td>
                                                        <td className="text-end pe-3">{formatearMonto(estadoResultados.totales.iue)}</td>
                                                    </tr>
                                                )}

                                                {/* NO IMPONIBLES (POST-TAX) */}
                                                {estadoResultados.secciones.noImponibles.length > 0 && (
                                                    <>
                                                        <RenderList list={estadoResultados.secciones.noImponibles} title="MÁS: INGRESOS NO IMPONIBLES" />
                                                    </>
                                                )}

                                                <ERRow label="UTILIDAD NETA DEL EJERCICIO" value={estadoResultados.totales.utilidadNeta} bold color="text-primary" isTotal />

                                                {estadoResultados.totales.reservaLegal > 0 && (
                                                    <tr className="text-warning">
                                                        <td className="ps-4">(-) Reserva Legal ({estadoResultados.porcentajeReservaLegal || 5}%)</td>
                                                        <td className="text-end pe-3">{formatearMonto(estadoResultados.totales.reservaLegal)}</td>
                                                    </tr>
                                                )}

                                                <ERRow label={estadoResultados.totales.utilidadLiquida >= 0 ? "UTILIDAD LÍQUIDA DEL EJERCICIO" : "PÉRDIDA DEL EJERCICIO"}
                                                    value={estadoResultados.totales.utilidadLiquida} bold color="bg-success text-white" />

                                            </tbody>
                                        </table>

                                        {estadoResultados.audit.length > 0 && (
                                            <div className="bg-light p-3 small border-top text-muted">
                                                <strong><i className="bi bi-info-circle me-1"></i> Log del Motor:</strong>
                                                <ul className="mb-0 ps-3">
                                                    {estadoResultados.audit.map((log, i) => <li key={i}>{log}</li>)}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {(!data || (!balanceGeneral && !estadoResultados)) && !loading && (
                    <div className="text-center py-5 text-muted">
                        <i className="bi bi-inbox fs-1 mb-3 d-block"></i>
                        <p>No se encontraron datos para generar los reportes.</p>
                        <p className="small">Verifique que existan comprobantes registrados en el sistema.</p>
                    </div>
                )}
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
                                                    Datos listos para exportar.
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
                                                                            <tr key={i}>
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
