import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import DatePicker from 'react-datepicker';
import { es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import { exportToPDF, exportToExcel, importFromExcel } from '../utils/exportUtils';
import { useCompany } from '../context/CompanyContext';
import { getFiscalYearDetails } from '../utils/fiscalYearUtils';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import MahoragaWheel from '../components/MahoragaWheel';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export default function ExchangeRate() {
    const { selectedCompany } = useCompany();
    const [rates, setRates] = useState([]);
    const [loading, setLoading] = useState(true);
    const fileInputRef = useRef(null);
    const [gestion, setGestion] = useState(new Date().getFullYear());
    const [view, setView] = useState('sell_rate'); // 'buy_rate' or 'sell_rate'

    // Import Modal State
    const [showImportModal, setShowImportModal] = useState(false);
    const [importFile, setImportFile] = useState(null);
    const [importFileType, setImportFileType] = useState(null);
    const [importWorkbook, setImportWorkbook] = useState(null);
    const [importSheets, setImportSheets] = useState([]);
    const [importConfig, setImportConfig] = useState({
        sheet: '', // Excel
        startRow: 2, // Excel
        endRow: null, // Excel
        dayCol: 'A', // Excel Matrix
        startMonthCol: 'B', // Excel Matrix
    });
    const [isImporting, setIsImporting] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [previewData, setPreviewData] = useState([]);
    const [previewType, setPreviewType] = useState(''); // 'excel' or 'pdf'

    const fiscalYearDetails = useMemo(() => {
        if (!selectedCompany) return null;
        return getFiscalYearDetails(selectedCompany.activity_type, gestion);
    }, [selectedCompany, gestion]);

    const dataMap = useMemo(() => {
        const map = new Map();
        rates.forEach(rate => {
            // Assuming USD for now, can be extended for multi-currency
            if (rate.currency === 'USD') {
                map.set(rate.date, rate);
            }
        });
        return map;
    }, [rates]);

    const [mahoragaActive, setMahoragaActive] = useState(false);

    useEffect(() => {
        if (selectedCompany) {
            fetchRates();
            checkMahoragaStatus();
        } else {
            setRates([]);
            setLoading(false);
        }
    }, [selectedCompany, gestion]);

    const checkMahoragaStatus = async () => {
        try {
            const response = await axios.get(`/api/ai/mahoraga/config/${selectedCompany.id}`);
            if (response.data.success) {
                setMahoragaActive(response.data.active_pages.includes('ExchangeRate'));
            }
        } catch (error) { console.error("Error checking Mahoraga status:", error); }
    };

    const fetchRates = useCallback(async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const { startDate, endDate } = getFiscalYearDetails(selectedCompany.activity_type, gestion);
            const response = await axios.get(`http://localhost:3001/api/exchange-rates`, {
                params: { companyId: selectedCompany.id, startDate, endDate, currency: 'USD' }
            });
            setRates(response.data.data || []);
        } catch (error) {
            console.error('Error fetching exchange rates:', error);
        } finally {
            setLoading(false);
        }
    }, [selectedCompany, gestion]);

    const handleDelete = async (id) => {
        if (window.confirm('¿Está seguro de eliminar este tipo de cambio?')) {
            try {
                await axios.delete(`http://localhost:3001/api/exchange-rates/${id}?companyId=${selectedCompany.id}`);
                fetchRates();
            } catch (error) {
                console.error('Error deleting exchange rate:', error);
                alert('Error al eliminar el tipo de cambio.');
            }
        }
    };

    const handleExportPDF = () => {
        const columns = [
            { header: 'Fecha', field: 'date' },
            { header: 'Moneda', field: 'currency' },
            { header: 'T/C Compra', field: 'buy_rate' },
            { header: 'T/C Venta', field: 'sell_rate' }
        ];

        // Prepare preview data
        const exportData = rates.map(rate => ({
            'Fecha': rate.date,
            'Moneda': rate.currency,
            'T/C Compra': parseFloat(rate.buy_rate).toFixed(4),
            'T/C Venta': parseFloat(rate.sell_rate).toFixed(4),
            'Diferencial': (parseFloat(rate.sell_rate) - parseFloat(rate.buy_rate)).toFixed(4)
        }));

        setPreviewData(exportData);
        setPreviewType('pdf');
        setShowPreviewModal(true);
    };

    const handleExportExcel = () => {
        const exportData = rates.map(rate => ({
            'Fecha': rate.date,
            'Moneda': rate.currency,
            'T/C Compra': parseFloat(rate.buy_rate).toFixed(4),
            'T/C Venta': parseFloat(rate.sell_rate).toFixed(4),
            'Diferencial': (parseFloat(rate.sell_rate) - parseFloat(rate.buy_rate)).toFixed(4)
        }));

        setPreviewData(exportData);
        setPreviewType('excel');
        setShowPreviewModal(true);
    };

    const handleConfirmExport = () => {
        if (previewType === 'excel') {
            exportToExcel(previewData, 'Tipo de Cambio', 'tipo_cambio');
        } else if (previewType === 'pdf') {
            const columns = [
                { header: 'Fecha', field: 'date' },
                { header: 'Moneda', field: 'currency' },
                { header: 'T/C Compra', field: 'buy_rate' },
                { header: 'T/C Venta', field: 'sell_rate' }
            ];
            const pdfData = previewData.map(item => ({
                date: item['Fecha'],
                currency: item['Moneda'],
                buy_rate: parseFloat(item['T/C Compra']),
                sell_rate: parseFloat(item['T/C Venta'])
            }));
            exportToPDF(pdfData, columns, 'Tipos de Cambio');
        }
        setShowPreviewModal(false);
        setPreviewData([]);
        setPreviewType('');
    };

    const handleDeleteAll = async () => {
        if (!confirm(`¿Estás seguro de que quieres borrar TODOS los datos de tipo de cambio del año ${fiscalYearDetails?.year || currentYear}? Esta acción no se puede deshacer.`)) {
            return;
        }

        try {
            setLoading(true);
            const year = fiscalYearDetails?.year || gestion;
            const response = await axios.delete(`http://localhost:3001/api/exchange-rates/year/${year}?companyId=${selectedCompany.id}`);
            alert(`Se eliminaron ${response.data.deletedCount} registros de tipo de cambio del año ${year}.`);
            await fetchRates();
        } catch (error) {
            console.error('Error deleting exchange rate data:', error);
            alert('Error al eliminar los datos de tipo de cambio. Revisa la consola.');
        } finally {
            setLoading(false);
        }
    };

    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setImportFile(file);
        const fileName = file.name.toLowerCase();

        if (fileName.match(/\.(xlsx|xls|xlsm)$/)) {
            setImportFileType('excel');
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const wb = XLSX.read(evt.target.result, { type: 'binary' });
                    setImportWorkbook(wb);
                    setImportSheets(wb.SheetNames);
                    setImportConfig(prev => ({ ...prev, sheet: wb.SheetNames[0] }));
                    setShowImportModal(true);
                } catch (err) { alert('Error al leer el archivo Excel.'); }
            };
            reader.readAsBinaryString(file);
        } else {
            alert('Formato de archivo no soportado. Use Excel.');
        }
        e.target.value = null;
    };

    const colToIndex = (col) => {
        const c = (col || '').toUpperCase().replace(/[^A-Z]/g, '');
        if (!c) return -1;
        let sum = 0;
        for (let i = 0; i < c.length; i++) {
            sum *= 26;
            sum += (c.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
        }
        return sum - 1;
    };

    const excelDateToJSDate = (serial) => {
        if (typeof serial === 'string') {
            const parsed = new Date(serial);
            if (!isNaN(parsed)) return parsed.toISOString().split('T')[0];
        }
        if (typeof serial !== 'number' || isNaN(serial)) return null;
        const utc_days = Math.floor(serial - 25569);
        const utc_value = utc_days * 86400;
        const date_info = new Date(utc_value * 1000);
        return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate() + 1).toISOString().split('T')[0];
    };

    const parseNumericValue = (val) => {
        if (val === null || val === undefined || String(val).trim() === '') {
            return NaN;
        }
        let str = String(val).trim().replace(/[^\d,.]/g, '');
        const lastComma = str.lastIndexOf(',');
        const lastDot = str.lastIndexOf('.');
        if (lastComma > lastDot) {
            // Format is likely "1.234,56". Treat dot as thousand separator and comma as decimal.
            str = str.replace(/\./g, '').replace(',', '.');
        } else if (lastDot > lastComma) {
            // Format is likely "1,234.56". Treat comma as thousand separator.
            str = str.replace(/,/g, '');
        } else if (lastComma !== -1) {
            // Only commas are present, e.g., "1,23". Treat as decimal.
            str = str.replace(',', '.');
        }
        const result = parseFloat(str);
        if (isNaN(result) || result < 0) {
            return NaN;
        }
        return result;
    };

    const executeImport = async () => {
        if (!importFile || !selectedCompany) return;
        setIsImporting(true);
        const clientSideErrors = []; // For Batch Validation

        try {
            let ratesToImport = [];
            if (importFileType === 'excel') {
                if (!importConfig.sheet) throw new Error("No se ha seleccionado una hoja de Excel.");

                const worksheet = importWorkbook.Sheets[importConfig.sheet];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

                const startRow = (importConfig.startRow || 1) - 1;
                const endRow = (importConfig.endRow || jsonData.length) - 1;
                const dayColIdx = colToIndex(importConfig.dayCol);
                const startMonthColIdx = colToIndex(importConfig.startMonthCol);
                const endMonthColIdx = colToIndex(importConfig.endMonthCol || String.fromCharCode(65 + startMonthColIdx + 11));

                if (dayColIdx < 0 || startMonthColIdx < 0 || endMonthColIdx < 0) {
                    throw new Error('Una o más columnas configuradas son inválidas.');
                }

                const fiscalMonths = fiscalYearDetails.months;

                for (let i = startRow; i <= endRow && i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (!row || row.every(cell => cell === null || cell === undefined || String(cell).trim() === '')) continue;

                    const day = parseInt(String(row[dayColIdx] || '').trim());
                    if (isNaN(day) || day < 1 || day > 31) continue;

                    for (let j = startMonthColIdx; j <= endMonthColIdx; j++) {
                        const monthIndexInFiscalYear = j - startMonthColIdx;
                        if (monthIndexInFiscalYear >= fiscalMonths.length) continue;

                        const monthInfo = fiscalMonths[monthIndexInFiscalYear];
                        const dateStr = `${monthInfo.year}-${String(monthInfo.index).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const d = new Date(dateStr);
                        if (d.getFullYear() !== monthInfo.year || d.getMonth() + 1 !== monthInfo.index || d.getDate() !== day) continue;

                        const value = parseNumericValue(row[j]);
                        console.log(`Processing ExchangeRate - Row ${i + 1}, Col ${String.fromCharCode(65 + j)}, Day: ${day}, Month: ${monthInfo.index}, Raw: ${row[j]}, Parsed: ${value}`);
                        if (!isNaN(value)) {
                            // More flexible range validation - allow reasonable exchange rates
                            if (value < 0.1 || value > 50) {
                                clientSideErrors.push({ row: i + 1, col: String.fromCharCode(65 + j), value: row[j], reason: 'Valor fuera de rango razonable (0.1 - 50)' });
                                continue;
                            }
                            const existingRate = dataMap.get(dateStr) || { buy_rate: 0, sell_rate: 0 };
                            const newRate = { ...existingRate, date: dateStr, currency: 'USD', [view]: value };
                            ratesToImport.push(newRate);
                        } else if (String(row[j] || '').trim() !== '') {
                            clientSideErrors.push({ row: i + 1, col: String.fromCharCode(65 + j), value: row[j], reason: 'Formato de número inválido' });
                        }
                    }
                }
            }

            if (clientSideErrors.length > 0) {
                console.warn('[Validación en Cliente Falló]', clientSideErrors);
                alert(`Se encontraron ${clientSideErrors.length} errores de formato o rango. No se enviaron datos. Revisa la consola (F12).`);
                setIsImporting(false);
                return;
            }

            if (ratesToImport.length === 0) {
                alert('No se encontraron registros válidos para importar.');
                setIsImporting(false);
                return;
            }

            const batchSize = 1000;
            let totalSuccess = 0;
            let totalErrors = 0;
            const allServerErrors = [];

            for (let i = 0; i < ratesToImport.length; i += batchSize) {
                const batch = ratesToImport.slice(i, i + batchSize);
                const response = await axios.post('http://localhost:3001/api/exchange-rates/bulk', { companyId: selectedCompany.id, data: batch });
                totalSuccess += response.data.successCount || 0;
                totalErrors += response.data.errorCount || 0;
                if (response.data.errors) {
                    allServerErrors.push(...response.data.errors);
                }
            }

            let alertMessage = `Se procesaron ${totalSuccess} tipos de cambio exitosamente.`;
            if (totalErrors > 0) {
                alertMessage += `\nSe encontraron ${totalErrors} errores en el servidor. Revisa la consola para más detalles.`;
                console.warn('Errores de importación (Servidor):', allServerErrors);
            }

            alert(alertMessage);
            fetchRates();
            setShowImportModal(false);
        } catch (error) {
            console.error('Error durante la importación:', error);
            alert('Ocurrió un error durante la importación: ' + error.message);
        } finally {
            setIsImporting(false);
        }
    };

    const handleGestionChange = (newGestion) => {
        const y = parseInt(newGestion);
        if (!isNaN(y) && y > 1990 && y < 2100) {
            setGestion(y);
        }
    };

    const EditableCell = ({ day, month, year, rateType }) => {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const rate = dataMap.get(date);
        const initialValue = rate ? rate[rateType] : '';
        const [currentValue, setCurrentValue] = useState(initialValue);

        useEffect(() => {
            const rate = dataMap.get(date);
            setCurrentValue(rate ? rate[rateType] : '');
        }, [dataMap, date, rateType]);

        const handleSave = async () => {
            const numValue = parseFloat(currentValue);
            const initialNum = parseFloat(initialValue);

            if (currentValue !== '' && !isNaN(numValue) && numValue !== initialNum) { // Check if value is valid and changed
                try {
                    const existingRate = dataMap.get(date) || { buy_rate: 0, sell_rate: 0 };
                    const payload = {
                        ...existingRate,
                        [rateType]: numValue,
                        date,
                        currency: 'USD',
                        companyId: selectedCompany.id,
                    };
                    await axios.post('http://localhost:3001/api/exchange-rates', payload);
                    fetchRates(); // Refetch to update map and view
                } catch (error) {
                    console.error('Error saving exchange rate:', error);
                    alert('Error al guardar el valor.');
                    setCurrentValue(initialValue); // Revert on error
                }
            } else if (currentValue === '' && initialValue !== '') {
                try {
                    // When clearing a cell, we send null for BOTH to trigger deletion on backend
                    // Or we could send null for just the rateType, but usually we want to clear the entry if user clears the cell in this matrix view
                    await axios.post('http://localhost:3001/api/exchange-rates', {
                        date,
                        currency: 'USD',
                        companyId: selectedCompany.id,
                        buy_rate: null,
                        sell_rate: null
                    });
                    fetchRates();
                } catch (error) {
                    console.error('Error clearing exchange rate:', error);
                    setCurrentValue(initialValue);
                }
            }
        };

        return (
            <td className="p-0">
                <input
                    type="text"
                    className="form-control form-control-sm border-0 text-end bg-transparent matrix-cell"
                    value={currentValue}
                    onChange={e => setCurrentValue(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                    placeholder="-"
                />
            </td>
        );
    };

    return (
        <div>
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2 className="mb-2"><i className="bi bi-currency-exchange me-2"></i>Tipos de Cambio</h2>
                    <p className="text-muted mb-0">Gestión de tipos de cambio por moneda</p>
                </div>
                <div className="d-flex gap-2 align-items-center">
                    {mahoragaActive && <MahoragaWheel size="small" />}
                    <button className="btn btn-warning btn-sm" onClick={handleDeleteAll} disabled={loading}>
                        <i className="bi bi-trash3 me-1"></i> Borrar Datos
                    </button>
                    <button className="btn btn-success btn-sm" onClick={handleExportExcel}>
                        <i className="bi bi-file-earmark-excel me-1"></i> Exportar Excel
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={handleExportPDF}>
                        <i className="bi bi-file-earmark-pdf me-1"></i> Exportar PDF
                    </button>
                    <button className="btn btn-info btn-sm" onClick={() => fileInputRef.current.click()} title="Importar desde Excel">
                        <i className="bi bi-upload me-1"></i> Importar Excel
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".xlsx,.xls,.xlsm" style={{ display: 'none' }} />
                </div>
            </div>

            <div className="card shadow-sm border-0">
                <div className="card-header bg-white border-bottom d-flex justify-content-between align-items-center">
                    <div className="nav nav-tabs card-header-tabs">
                        <div className="nav-item">
                            <button className={`nav-link ${view === 'sell_rate' ? 'active' : ''}`} onClick={() => setView('sell_rate')}>T/C Venta</button>
                        </div>
                        <div className="nav-item">
                            <button className={`nav-link ${view === 'buy_rate' ? 'active' : ''}`} onClick={() => setView('buy_rate')}>T/C Compra</button>
                        </div>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                        <label className="form-label mb-0 small">Gestión:</label>
                        <DatePicker
                            selected={new Date(gestion, 0, 1)}
                            onChange={(date) => setGestion(date.getFullYear())}
                            showYearPicker
                            dateFormat="yyyy"
                            className="form-control form-control-sm text-center"
                            locale={es}
                            popperProps={{ strategy: 'fixed' }}
                        />
                    </div>
                </div>
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-bordered table-sm mb-0 text-center matrix-table">
                            <thead className="table-light">
                                <tr>
                                    <th className="matrix-header-day">Día</th>
                                    {fiscalYearDetails?.months.map(m => <th key={m.index}>{m.name}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan="6" className="text-center py-4"><div className="spinner-border spinner-border-sm"></div></td></tr>
                                ) : !selectedCompany || !fiscalYearDetails ? (
                                    <tr>
                                        <td colSpan="6" className="text-center py-4 text-muted">
                                            <i className="bi bi-info-circle me-2"></i>Seleccione una empresa para ver los tipos de cambio.
                                        </td>
                                    </tr>
                                ) : (
                                    Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                        <tr key={day}>
                                            <td className="fw-bold bg-light matrix-header-day">{day}</td>
                                            {fiscalYearDetails.months.map(month => (
                                                <EditableCell key={`${day}-${month.index}`} day={day} month={month.index} year={month.year} rateType={view} />
                                            ))}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Import Config Modal */}
            {showImportModal && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-lg modal-dialog-centered">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title"><i className="bi bi-gear-wide-connected me-2"></i>Configurar Importación de T/C</h5>
                                <button type="button" className="btn-close" onClick={() => setShowImportModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <div className="alert alert-info small">
                                    <i className="bi bi-info-circle me-2"></i>
                                    Ajusta los parámetros para que el sistema lea tu archivo Excel correctamente.
                                </div>
                                <div className="row g-3">
                                    <div className="col-md-12">
                                        <label className="form-label">Hoja de Excel</label>
                                        <select className="form-select" value={importConfig.sheet} onChange={e => setImportConfig({ ...importConfig, sheet: e.target.value })}>
                                            {importSheets.map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                    </div>
                                    <div className="col-md-6">
                                        <label className="form-label">Fila de Inicio</label>
                                        <input type="number" className="form-control" value={importConfig.startRow} onChange={e => { const v = parseInt(e.target.value); setImportConfig({ ...importConfig, startRow: isNaN(v) ? 1 : v }); }} />
                                    </div>
                                    <div className="col-md-6">
                                        <label className="form-label">Fila de Fin (opcional)</label>
                                        <input type="number" className="form-control" placeholder="Automático" value={importConfig.endRow || ''} onChange={e => { const v = parseInt(e.target.value); setImportConfig({ ...importConfig, endRow: isNaN(v) ? null : v }); }} />
                                    </div>
                                    <div className="col-md-4">
                                        <label className="form-label">Columna de Días</label>
                                        <input type="text" className="form-control" placeholder="Ej: A" value={importConfig.dayCol} onChange={e => setImportConfig({ ...importConfig, dayCol: e.target.value.toUpperCase() })} />
                                    </div>
                                    <div className="col-md-4">
                                        <label className="form-label">Columna Mes de Inicio</label>
                                        <input type="text" className="form-control" placeholder="Ej: B" value={importConfig.startMonthCol} onChange={e => setImportConfig({ ...importConfig, startMonthCol: e.target.value.toUpperCase() })} />
                                    </div>
                                    <div className="col-md-4">
                                        <label className="form-label">Columna Mes de Fin</label>
                                        <input type="text" className="form-control" placeholder="Ej: M" value={importConfig.endMonthCol || ''} onChange={e => setImportConfig({ ...importConfig, endMonthCol: e.target.value.toUpperCase() })} />
                                    </div>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowImportModal(false)}>Cancelar</button>
                                <button type="button" className="btn btn-primary" onClick={executeImport} disabled={isImporting}>
                                    {isImporting ? 'Procesando...' : 'Confirmar e Importar'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Preview Modal */}
            {showPreviewModal && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-xl modal-dialog-centered">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">
                                    <i className="bi bi-eye me-2"></i>
                                    Previsualización de Exportación - {previewType === 'excel' ? 'Excel' : 'PDF'}
                                </h5>
                                <button type="button" className="btn-close" onClick={() => setShowPreviewModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <div className="alert alert-info">
                                    <i className="bi bi-info-circle me-2"></i>
                                    Se encontraron <strong>{previewData.length}</strong> registros para exportar del año <strong>{fiscalYearDetails?.year || currentYear}</strong>
                                </div>

                                {previewData.length > 0 ? (
                                    <div className="table-responsive">
                                        <table className="table table-sm table-bordered">
                                            <thead className="table-light">
                                                <tr>
                                                    <th>Fecha</th>
                                                    <th>Moneda</th>
                                                    <th>T/C Compra</th>
                                                    <th>T/C Venta</th>
                                                    <th>Diferencial</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {previewData.slice(0, 10).map((item, index) => (
                                                    <tr key={index}>
                                                        <td>{item['Fecha']}</td>
                                                        <td>{item['Moneda']}</td>
                                                        <td className="text-end">{item['T/C Compra']}</td>
                                                        <td className="text-end">{item['T/C Venta']}</td>
                                                        <td className="text-end">{item['Diferencial']}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {previewData.length > 10 && (
                                            <div className="text-muted small mt-2">
                                                <i className="bi bi-three-dots me-1"></i>
                                                Mostrando primeros 10 registros de {previewData.length} totales
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="alert alert-warning">
                                        <i className="bi bi-exclamation-triangle me-2"></i>
                                        No hay datos para exportar
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowPreviewModal(false)}>
                                    <i className="bi bi-x-circle me-1"></i> Cancelar
                                </button>
                                {previewData.length > 0 && (
                                    <button type="button" className="btn btn-primary" onClick={handleConfirmExport}>
                                        <i className="bi bi-download me-1"></i> Descargar {previewType === 'excel' ? 'Excel' : 'PDF'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .matrix-table { font-size: 0.8rem; }
                .matrix-table th, .matrix-table td { vertical-align: middle; }
                .matrix-header-day { min-width: 50px; }
                .matrix-cell { width: 100%; height: 100%; padding: 0.25rem; font-size: 0.8rem; }
                .matrix-cell:focus { box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.25); background-color: #e9f3ff !important; }
            `}</style>
        </div>
    );
}
