import React, { useState, useRef, useEffect, useMemo } from 'react';
import axios from 'axios';
import API_URL from '../api';
import { exportToPDF, exportToExcel, importFromExcel } from '../utils/exportUtils';
import { useCompany } from '../context/CompanyContext';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import MahoragaWheel from '../components/MahoragaWheel';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export default function UFV() {
    const { selectedCompany } = useCompany();
    const [ufvData, setUfvData] = useState([]);
    const [loading, setLoading] = useState(true);
    const fileInputRef = useRef(null);
    const [year, setYear] = useState(new Date().getFullYear());

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
        endMonthCol: 'M', // Excel Matrix
        yearFilter: '', // Año específico a importar (opcional)
        startPage: 1, // PDF
        endPage: null,
    });
    const [isImporting, setIsImporting] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [previewData, setPreviewData] = useState([]);
    const [previewType, setPreviewType] = useState(''); // 'excel' or 'pdf'

    const MONTHS = useMemo(() => [
        { name: 'Ene', num: 1 }, { name: 'Feb', num: 2 }, { name: 'Mar', num: 3 },
        { name: 'Abr', num: 4 }, { name: 'May', num: 5 }, { name: 'Jun', num: 6 },
        { name: 'Jul', num: 7 }, { name: 'Ago', num: 8 }, { name: 'Sep', num: 9 },
        { name: 'Oct', num: 10 }, { name: 'Nov', num: 11 }, { name: 'Dic', num: 12 }
    ], []);

    const dataMap = useMemo(() => {
        const map = new Map();
        ufvData.forEach(item => {
            map.set(item.date, item.value);
        });
        return map;
    }, [ufvData]);

    const fetchUFV = async (currentYear) => {
        if (!selectedCompany) {
            console.log('No company selected, skipping UFV fetch');
            setUfvData([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const response = await axios.get(`${API_URL}/api/ufv?year=${currentYear}&companyId=${selectedCompany.id}`);
            setUfvData(response.data.data || []);
        } catch (error) {
            console.error('Error fetching UFV:', error);
        } finally {
            setLoading(false);
        }
    };

    const [mahoragaActive, setMahoragaActive] = useState(false);

    useEffect(() => {
        if (year && selectedCompany) {
            fetchUFV(year);
            checkMahoragaStatus();
        }
    }, [year, selectedCompany]);

    const checkMahoragaStatus = async () => {
        try {
            const response = await axios.get(`/api/ai/mahoraga/config/${selectedCompany.id}`);
            if (response.data.success) {
                let pages = response.data.active_pages;
                if (typeof pages === 'string') {
                    try { pages = JSON.parse(pages); } catch (e) { pages = []; }
                }
                const pagesArray = Array.isArray(pages) ? pages : [];
                setMahoragaActive(pagesArray.includes('UFV'));
            }
        } catch (error) { console.error("Error checking Mahoraga status:", error); }
    };

    const handleExportPDF = () => {
        const columns = [
            { header: 'Fecha', field: 'date' },
            { header: 'Valor UFV', field: 'value' }
        ];

        // Prepare preview data
        const exportData = ufvData.map(item => ({
            'Fecha': item.date,
            'Valor UFV': parseFloat(item.value).toFixed(6)
        }));

        setPreviewData(exportData);
        setPreviewType('pdf');
        setShowPreviewModal(true);
    };

    const handleExportExcel = () => {
        const exportData = ufvData.map(item => ({
            'Fecha': item.date,
            'Valor UFV': parseFloat(item.value).toFixed(6)
        }));

        setPreviewData(exportData);
        setPreviewType('excel');
        setShowPreviewModal(true);
    };

    const handleConfirmExport = () => {
        if (previewType === 'excel') {
            exportToExcel(previewData, 'UFV', 'ufv_historico');
        } else if (previewType === 'pdf') {
            const columns = [
                { header: 'Fecha', field: 'date' },
                { header: 'Valor UFV', field: 'value' }
            ];
            const pdfData = previewData.map(item => ({
                date: item['Fecha'],
                value: parseFloat(item['Valor UFV'])
            }));
            exportToPDF(pdfData, columns, 'UFV - Unidad de Fomento de Vivienda');
        }
        setShowPreviewModal(false);
        setPreviewData([]);
        setPreviewType('');
    };

    const handleDeleteAll = async () => {
        if (!selectedCompany) {
            alert('No hay empresa seleccionada');
            return;
        }

        if (!confirm(`¿Estás seguro de que quieres borrar TODOS los datos UFV del año ${year}? Esta acción no se puede deshacer.`)) {
            return;
        }

        try {
            setLoading(true);
            const response = await axios.delete(`${API_URL}/api/ufv/year/${year}?companyId=${selectedCompany.id}`);
            alert(`Se eliminaron ${response.data.deletedCount} registros UFV del año ${year}.`);
            await fetchUFV(year);
        } catch (error) {
            console.error('Error deleting UFV data:', error);
            alert('Error al eliminar los datos UFV. Revisa la consola.');
        } finally {
            setLoading(false);
        }
    };

    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setImportFile(file);
        const fileName = file.name.toLowerCase();

        if (fileName.match(/\.pdf$/)) {
            setImportFileType('pdf');
            setImportConfig(prev => ({ ...prev, startPage: 1, endPage: null }));
            setShowImportModal(true);
        } else if (fileName.match(/\.(xlsx|xls|xlsm)$/)) {
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
            alert('Formato de archivo no soportado. Use Excel o PDF.');
        }
        e.target.value = null;
    };

    const colToIndex = (col) => {
        const c = (col || 'A').toUpperCase().replace(/[^A-Z]/g, '');
        if (!c) return 0;
        let sum = 0;
        for (let i = 0; i < c.length; i++) {
            sum *= 26;
            sum += (c.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
        }
        return sum - 1;
    };

    const excelDateToJSDate = (serial) => {
        if (typeof serial === 'string') {
            // Try parsing common date formats
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
        // 1. Clean non-essential characters (arrows, symbols, etc.)
        let str = String(val).trim().replace(/[^\d,.]/g, '');

        // Special handling for arrows with space (like "↑ 2,57896")
        if (str === '' && String(val).trim().includes('↑')) {
            // Extract numbers after arrow
            const arrowMatch = String(val).trim().match(/↑\s*([\d.,]+)/);
            if (arrowMatch) {
                str = arrowMatch[1];
            }
        }

        // 2. Intelligent separator handling
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

        // 4. Consistency Check
        if (isNaN(result) || result < 0) {
            return NaN;
        }
        return result;
    };

    const executeImport = async () => {
        if (!importFile) return;
        setIsImporting(true);
        const clientSideErrors = []; // For Batch Validation

        try {
            let ufvRecords = [];
            let dataYear = new Date().getFullYear(); // Declare here to be available in both contexts

            if (importFileType === 'excel') {
                if (!importConfig.sheet) throw new Error('No se ha seleccionado una hoja de Excel.');

                // Robust parsing: load all data and slice in JS
                const worksheet = importWorkbook.Sheets[importConfig.sheet];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

                const startRow = (importConfig.startRow || 1) - 1; // 0-indexed
                const endRow = (importConfig.endRow || jsonData.length) - 1; // 0-indexed, inclusive
                const dayColIdx = colToIndex(importConfig.dayCol);
                const startMonthColIdx = colToIndex(importConfig.startMonthCol);
                const endMonthColIdx = colToIndex(importConfig.endMonthCol);

                if (dayColIdx < 0 || startMonthColIdx < 0 || endMonthColIdx < 0) {
                    throw new Error('Una o más columnas configuradas son inválidas. Verifique las letras de las columnas.');
                }


                console.log('=== UFV Import Debug ===');
                console.log('Config:', { startRow, endRow, dayColIdx, startMonthColIdx, endMonthColIdx, yearFilter: importConfig.yearFilter });
                console.log('Total rows in worksheet:', jsonData.length);
                console.log('Sample data (first 3 rows):', jsonData.slice(0, 3));
                console.log('Sample data (last 3 rows):', jsonData.slice(-3));
                console.log('Sample data (rows around startRow):', jsonData.slice(Math.max(0, startRow - 1), Math.min(jsonData.length, startRow + 2)));
                console.log('Sample data (rows around 2024):', jsonData.slice(Math.max(0, 870), Math.min(jsonData.length, 890)));

                // Try to find year in the data before the startRow
                for (let i = 0; i < startRow && i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (row && row[0]) {
                        const cellText = String(row[0]).trim();
                        const yearMatch = cellText.match(/\b(19|20)\d{2}\b/);
                        if (yearMatch) {
                            dataYear = parseInt(yearMatch[0]);
                            console.log(`Found year in data: ${dataYear} at row ${i + 1}`);
                            break;
                        }
                    }
                }

                // If yearFilter is specified, use it
                if (importConfig.yearFilter && importConfig.yearFilter.trim()) {
                    dataYear = parseInt(importConfig.yearFilter);
                    console.log(`Using year filter: ${dataYear}`);
                }

                console.log(`Processing data for year: ${dataYear}`);

                for (let i = startRow; i <= endRow && i < jsonData.length; i++) {
                    const row = jsonData[i];
                    console.log(`Examining row ${i + 1}:`, row);

                    if (!row || row.every(cell => cell === null || cell === undefined || String(cell).trim() === '')) {
                        console.log(`Skipping empty row ${i + 1}`);
                        continue;
                    }

                    // Check if this row contains day data (first column should be a number 1-31)
                    const dayCell = row[dayColIdx];
                    console.log(`Row ${i + 1} - Day cell (${dayColIdx}):`, dayCell);
                    const day = parseInt(String(dayCell || '').trim());
                    console.log(`Row ${i + 1} - Parsed day:`, day);

                    if (isNaN(day) || day < 1 || day > 31) {
                        console.log(`Skipping row ${i + 1} - invalid day: ${dayCell} (parsed as: ${day})`);
                        continue;
                    }

                    console.log(`Row ${i + 1} - Valid day: ${day}, processing months...`);

                    for (let j = startMonthColIdx; j <= endMonthColIdx; j++) {
                        const month = (j - startMonthColIdx) + 1;
                        const dateStr = `${dataYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                        // Use local date constructor to avoid timezone issues
                        const d = new Date(dataYear, month - 1, day);

                        console.log(`Row ${i + 1}, Col ${String.fromCharCode(65 + j)} (${j}): Month ${month}, DateStr ${dateStr}, Cell value:`, row[j]);

                        if (d.getFullYear() !== dataYear || d.getMonth() + 1 !== month || d.getDate() !== day) {
                            console.log(`Skipping invalid date: ${dateStr} (expected: ${dataYear}-${month}-${day}, got: ${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()})`);
                            continue;
                        }

                        const value = parseNumericValue(row[j]);
                        console.log(`Processing UFV - Row ${i + 1}, Col ${String.fromCharCode(65 + j)}, Day: ${day}, Month: ${month}, Year: ${dataYear}, Raw: ${row[j]}, Parsed: ${value}`);
                        if (!isNaN(value)) {
                            ufvRecords.push({ date: dateStr, value });
                            console.log(`Added UFV record: ${dateStr} = ${value}`);
                        } else {
                            console.log(`Invalid numeric value: ${row[j]} -> ${value}`);
                        }
                    }
                }

                console.log(`=== UFV Processing Summary ===`);
                console.log(`Total rows processed: ${jsonData.length - startRow}`);
                console.log(`Valid UFV records found: ${ufvRecords.length}`);
                console.log('Sample UFV records:', ufvRecords.slice(0, 3));
            } else { // PDF logic
                const arrayBuffer = await importFile.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                const startPage = importConfig.startPage || 1;
                const endPage = importConfig.endPage || pdf.numPages;
                let fullText = '';

                for (let i = startPage; i <= endPage; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    fullText += textContent.items.map(item => item.str).join(' ');
                }

                // Regex to find dates and subsequent numbers (UFV values)
                const regex = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s+([\d.,]+)/g;
                let match;
                while ((match = regex.exec(fullText)) !== null) {
                    ufvRecords.push({
                        date: excelDateToJSDate(match[1]), // Reuse converter for robustness
                        value: parseFloat(match[2].replace(',', '.'))
                    });
                }
            }

            if (ufvRecords.length === 0) {
                alert('No se encontraron registros válidos para importar.');
                setIsImporting(false);
                return;
            }

            const response = await axios.post(`${API_URL}/api/ufv/bulk`, {
                data: ufvRecords,
                companyId: selectedCompany.id
            });
            const { successCount, errorCount, errors } = response.data;
            let alertMessage = `Se procesaron ${successCount} registros UFV exitosamente.`;
            if (errorCount > 0) {
                alertMessage += `\nSe encontraron ${errorCount} errores. Revisa la consola para más detalles.`;
                console.warn('Errores de importación de UFV:', errors);
            }
            alert(alertMessage);

            // Refrescar datos usando el año detectado o el año actual
            const refreshYear = importConfig.yearFilter || dataYear || year;
            console.log(`Refrescando datos UFV para el año: ${refreshYear}`);
            await fetchUFV(refreshYear);

            setShowImportModal(false);
            setImportFile(null);
            setImportWorkbook(null);
        } catch (error) {
            console.error('Error durante la importación:', error);
            alert('Ocurrió un error durante la importación. Revisa la consola.');
        } finally {
            setIsImporting(false);
        }
    };

    const handleYearChange = (newYear) => {
        const y = parseInt(newYear);
        if (!isNaN(y) && y > 1990 && y < 2100) {
            setYear(y);
            fetchUFV(y);
        }
    };

    const EditableCell = ({ day, month, year, fetchUFV, selectedCompany }) => {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const numericValue = dataMap.get(date) || '';
        // Mostrar el valor con hasta 6 decimales para preservar ceros
        const initialValue = numericValue ? parseFloat(numericValue).toFixed(6).replace(/\.?0+$/, '') : '';
        const [currentValue, setCurrentValue] = useState(initialValue);

        useEffect(() => {
            const numericValue = dataMap.get(date) || '';
            const displayValue = numericValue ? parseFloat(numericValue).toFixed(6).replace(/\.?0+$/, '') : '';
            setCurrentValue(displayValue);
        }, [dataMap, date]);

        const handleSave = async () => {
            if (!selectedCompany) {
                alert('No hay empresa seleccionada');
                return;
            }

            // Usar el valor exacto del input, no parseFloat para preservar ceros
            if (currentValue !== '' && currentValue !== initialValue) {
                try {
                    console.log(`Saving UFV - Date: ${date}, Value: "${currentValue}" (was: "${initialValue}")`);
                    await axios.post(`${API_URL}/api/ufv`, {
                        date,
                        value: parseFloat(currentValue), // Enviar como número al servidor
                        companyId: selectedCompany.id
                    });
                    console.log('UFV saved successfully, refreshing data...');
                    // Refrescar datos para asegurar persistencia
                    await fetchUFV(year);
                    console.log('UFV data refreshed');
                } catch (error) {
                    console.error('Error saving UFV value:', error);
                    alert('Error al guardar el valor.');
                    setCurrentValue(initialValue); // Revert on error
                }
            } else if (currentValue === '' && initialValue !== '') {
                // Handle deletion if needed, for now we just clear it
                setCurrentValue('');
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
                    <h2 className="mb-2"><i className="bi bi-graph-up-arrow me-2"></i>UFV - Unidad de Fomento a la Vivienda</h2>
                    <p className="text-muted mb-0">Gestión de valores históricos de UFV</p>
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
                    <button className="btn btn-info btn-sm" onClick={() => fileInputRef.current.click()} title="Importar desde Excel o PDF">
                        <i className="bi bi-upload me-1"></i> Importar Excel
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".xlsx,.xls,.xlsm,.pdf" style={{ display: 'none' }} />
                </div>
            </div>

            <div className="card shadow-sm border-0">
                <div className="card-header bg-white border-bottom d-flex justify-content-between align-items-center">
                    <h5 className="mb-0"><i className="bi bi-calendar-month me-2"></i>Matriz de UFV</h5>
                    <div className="d-flex align-items-center gap-2">
                        <label className="form-label mb-0 small">Gestión:</label>
                        <input
                            type="number"
                            className="form-control form-control-sm"
                            value={year}
                            onChange={e => handleYearChange(e.target.value)}
                            style={{ width: '100px' }}
                        />
                    </div>
                </div>
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-bordered table-sm mb-0 text-center matrix-table">
                            <thead className="table-light">
                                <tr>
                                    <th className="matrix-header-day">Día</th>
                                    {MONTHS.map(m => <th key={m.num}>{m.name}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={13} className="text-center py-5"><div className="spinner-border text-primary"></div></td></tr>
                                ) : (
                                    Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                        <tr key={day}>
                                            <td className="fw-bold bg-light matrix-header-day">{day}</td>
                                            {MONTHS.map(month => (
                                                <EditableCell key={`${day}-${month.num}`} day={day} month={month.num} year={year} fetchUFV={fetchUFV} selectedCompany={selectedCompany} />
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
                                <h5 className="modal-title"><i className="bi bi-gear-wide-connected me-2"></i>Configurar Importación de UFV</h5>
                                <button type="button" className="btn-close" onClick={() => setShowImportModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <div className="alert alert-info small">
                                    <i className="bi bi-info-circle me-2"></i>
                                    Define el rango de la matriz de datos en tu archivo.
                                </div>
                                {importFileType === 'excel' ? (
                                    <div className="row g-3">
                                        <div className="col-md-6">
                                            <label className="form-label">Hoja de Excel</label>
                                            <select className="form-select" value={importConfig.sheet} onChange={e => setImportConfig({ ...importConfig, sheet: e.target.value })}>
                                                {importSheets.map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        </div>
                                        <div className="col-md-3">
                                            <label className="form-label">Fila de Inicio</label>
                                            <input type="number" className="form-control" value={importConfig.startRow} onChange={e => { const v = parseInt(e.target.value); setImportConfig({ ...importConfig, startRow: isNaN(v) ? 1 : v }); }} />
                                        </div>
                                        <div className="col-md-3">
                                            <label className="form-label">Fila de Fin (opcional)</label>
                                            <input type="number" className="form-control" placeholder="Automático" value={importConfig.endRow || ''} onChange={e => { const v = parseInt(e.target.value); setImportConfig({ ...importConfig, endRow: isNaN(v) ? null : v }); }} />
                                        </div>
                                        <div className="col-md-4">
                                            <label className="form-label">Columna de Días</label>
                                            <input type="text" className="form-control" placeholder="Ej: A" value={importConfig.dayCol} onChange={e => setImportConfig({ ...importConfig, dayCol: e.target.value.toUpperCase() })} />
                                        </div>
                                        <div className="col-md-4">
                                            <label className="form-label">Columna Mes Inicio</label>
                                            <input type="text" className="form-control" placeholder="Ej: B" value={importConfig.startMonthCol} onChange={e => setImportConfig({ ...importConfig, startMonthCol: e.target.value.toUpperCase() })} />
                                        </div>
                                        <div className="col-md-4">
                                            <label className="form-label">Columna Mes Fin</label>
                                            <input type="text" className="form-control" placeholder="Ej: M" value={importConfig.endMonthCol} onChange={e => setImportConfig({ ...importConfig, endMonthCol: e.target.value.toUpperCase() })} />
                                        </div>
                                        <div className="col-md-12">
                                            <label className="form-label">Filtrar por Año (opcional)</label>
                                            <input type="text" className="form-control" placeholder="Deje en blanco para importar todos los años, o ingrese un año específico (ej: 2024)" value={importConfig.yearFilter} onChange={e => setImportConfig({ ...importConfig, yearFilter: e.target.value })} />
                                            <small className="text-muted">Si especifica un año, solo se importarán los datos de ese año. Si lo deja en blanco, se importarán todos los años encontrados.</small>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="row g-3">
                                        <div className="col-md-6">
                                            <label className="form-label">Página de Inicio</label>
                                            <input type="number" className="form-control" value={importConfig.startPage} onChange={e => { const v = parseInt(e.target.value); setImportConfig({ ...importConfig, startPage: isNaN(v) ? 1 : v }); }} min="1" />
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label">Página de Fin (opcional)</label>
                                            <input type="number" className="form-control" placeholder="Hasta el final" value={importConfig.endPage || ''} onChange={e => { const v = parseInt(e.target.value); setImportConfig({ ...importConfig, endPage: isNaN(v) ? null : v }); }} min="1" />
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowImportModal(false)}>Cancelar</button>
                                <button type="button" className="btn btn-primary" onClick={executeImport} disabled={isImporting}>
                                    {isImporting ? (
                                        <>
                                            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                            Procesando...
                                        </>
                                    ) : (
                                        <><i className="bi bi-check-circle me-2"></i>Confirmar e Importar</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Preview Modal */}
            {showPreviewModal && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-lg modal-dialog-centered">
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
                                    Se encontraron <strong>{previewData.length}</strong> registros para exportar del año <strong>{year}</strong>
                                </div>

                                {previewData.length > 0 ? (
                                    <div className="table-responsive">
                                        <table className="table table-sm table-bordered">
                                            <thead className="table-light">
                                                <tr>
                                                    <th>Fecha</th>
                                                    <th>Valor UFV</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {previewData.slice(0, 10).map((item, index) => (
                                                    <tr key={index}>
                                                        <td>{item['Fecha']}</td>
                                                        <td className="text-end">{item['Valor UFV']}</td>
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
