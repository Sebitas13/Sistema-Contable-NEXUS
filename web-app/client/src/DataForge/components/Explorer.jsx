import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { PatternDetector } from '../logic/PatternDetector';

const Explorer = ({ onDataLoaded }) => {
    const [dragActive, setDragActive] = useState(false);
    const [error, setError] = useState(null);
    const [showASFISettings, setShowASFISettings] = useState(false);
    const [asfiSettings, setASFISettings] = useState({
        sheetConfigs: [], // Array of {sheetIndex, startRow, startCol, selected}
        selectedSheets: [],
        bulkStartRow: 2,
        bulkStartCol: 0,
        rangeStart: 1,
        rangeEnd: 10
    });
    const [pendingASFIFile, setPendingASFIFile] = useState(null);

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const processASFIWithSettings = () => {
        if (!pendingASFIFile) return;

        const { allSheets, filename } = pendingASFIFile;
        const { sheetConfigs } = asfiSettings;

        try {
            console.log('Processing ASFI sheets with per-sheet settings:', sheetConfigs);
            let sheetData = [];
            let totalRowCount = 0;
            let maxColumns = 0;

            // First pass: process sheets and find max columns
            sheetConfigs.forEach((config) => {
                if (!config.selected) return;

                const sheet = allSheets[config.sheetIndex];
                if (!sheet) return;

                const dataRows = sheet.data.slice(config.startRow - 1);

                const processedRows = dataRows
                    .map(row => Array.isArray(row) ? row.slice(config.startCol) : [])
                    .filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== ''));

                if (processedRows.length > 0) {
                    const currentMaxColumns = Math.max(...processedRows.map(row => row.length));
                    if (currentMaxColumns > maxColumns) {
                        maxColumns = currentMaxColumns;
                    }
                    sheetData.push({ originalRows: processedRows, rowCount: processedRows.length });
                    totalRowCount += processedRows.length;
                }
            });

            if (sheetData.length === 0) {
                setError('No se encontraron datos válidos con las configuraciones seleccionadas.');
                return;
            }

            // Second pass: build combinedData with uniform column count
            let combinedData = [];
            sheetData.forEach(({ originalRows }) => {
                originalRows.forEach(row => {
                    const paddedRow = [...row];
                    while (paddedRow.length < maxColumns) {
                        paddedRow.push('');
                    }
                    combinedData.push(paddedRow);
                });
            });

            const processedSheetsCount = sheetConfigs.filter(config => config.selected).length;
            console.log(`Total combined data: ${combinedData.length} rows from ${processedSheetsCount} sheets with ${maxColumns} columns.`);


            if (combinedData.length === 0) {
                setError('No se encontraron datos válidos con las configuraciones seleccionadas');
                return;
            }

            // Create generic headers based on the number of columns in the first row
            const firstRow = combinedData[0] || [];
            const numColumns = firstRow.length;

            // Try to use the first row as headers if they look like headers, otherwise create generic ones
            let headers = [];
            let rows = combinedData;

            if (firstRow.some(cell => typeof cell === 'string' && String(cell).trim().length > 0)) {
                // First row has text, likely headers
                headers = firstRow.map((cell, idx) => String(cell || '').trim() || `Columna ${idx + 1}`);
                rows = combinedData.slice(1);
            } else {
                // First row doesn't look like headers, create generic headers
                headers = Array.from({length: numColumns}, (_, idx) => `Columna ${idx + 1}`);
                rows = combinedData;
            }

            // Ensure all data is properly formatted for PatternDetector
            const cleanRows = rows.map(row =>
                Array.isArray(row) ? row.map(cell => String(cell || '').trim()) : []
            ).filter(row => row.length > 0);

            const cleanHeaders = headers.map(header => String(header || '').trim());

            // Advanced analysis using PatternDetector
            const analysis = PatternDetector.analyze(cleanRows, cleanHeaders);

            const selectedCount = sheetConfigs.filter(config => config.selected).length;

                        const structure = {
                            fileName: filename,
                            type: 'excel-asfi-combined',
                            rowCount: totalRowCount,
                            headers: cleanHeaders,
                            raw: [cleanHeaders, ...cleanRows], // Include headers as first row
                            analysis: analysis,
                            allSheets: allSheets,
                            currentSheet: `ASFI Combinado (${selectedCount} hojas)`,
                            isASFICombined: true,
                            asfiSettings: asfiSettings
                        };

            onDataLoaded(structure);
            setShowASFISettings(false);
            setPendingASFIFile(null);

        } catch (error) {
            console.error('Error processing ASFI with settings:', error);
            setError('Error al procesar el archivo ASFI: ' + error.message);
        }
    };

    const processASFISheets = (allSheets, filename) => {
        try {
            console.log('Processing ASFI sheets...');
            let combinedData = [];
            let totalRowCount = 0;

            // Process each sheet and combine data
            allSheets.forEach((sheet, index) => {
                console.log(`Processing sheet ${index + 1}/${allSheets.length}: ${sheet.name}`);

                // Filter out completely empty rows but keep structure
                const validRows = sheet.data.filter(row =>
                    Array.isArray(row) && row.some(cell => cell !== null && cell !== undefined && cell !== '')
                );

                if (validRows.length > 0) {
                    console.log(`Sheet ${sheet.name}: ${validRows.length} rows with data`);
                    combinedData = combinedData.concat(validRows);
                    totalRowCount += validRows.length;
                } else {
                    console.log(`Sheet ${sheet.name}: no valid data found`);
                }
            });

            console.log(`Total combined data: ${combinedData.length} rows from ${allSheets.length} sheets`);

            if (combinedData.length === 0) {
                throw new Error('No se encontraron datos válidos en las hojas del archivo ASFI');
            }

            // Determine headers from first non-empty row
            const headers = combinedData[0] || [];
            const rows = combinedData.slice(1);

            // Advanced analysis using PatternDetector
            const analysis = PatternDetector.analyze(rows, headers);

            return {
                fileName: filename,
                type: 'excel-asfi-combined',
                rowCount: totalRowCount,
                headers: headers,
                raw: combinedData,
                analysis: analysis,
                allSheets: allSheets, // Include all sheets for reference
                currentSheet: 'ASFI (Todas las Hojas Combinadas)',
                isASFICombined: true
            };

        } catch (error) {
            console.error('Error processing ASFI sheets:', error);
            throw new Error('Error al procesar las hojas del archivo ASFI: ' + error.message);
        }
    };

    const handleFile = (file) => {
        setError(null);
        const reader = new FileReader();

        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            reader.onload = (evt) => {
                try {
                    const bstr = evt.target.result;
                    const wb = XLSX.read(bstr, { type: 'binary' });

                    // Load ALL sheets
                    const allSheets = wb.SheetNames.map(sheetName => {
                        const ws = wb.Sheets[sheetName];
                        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
                        return {
                            name: sheetName,
                            data: data,
                            headers: data[0] || [],
                            rowCount: data.length
                        };
                    });

                    if (!allSheets || allSheets.length === 0) {
                        throw new Error("El archivo no tiene hojas válidas");
                    }

                    // Detect if this is an ASFI file by filename
                    const isASFIFile = file.name.toLowerCase().includes('asfi') ||
                                      file.name.toLowerCase().includes('plan de cuentas');

                    let structure;

                    if (isASFIFile && allSheets.length > 1) {
                        // For ASFI files with multiple sheets, show configuration dialog
                        console.log('Detected ASFI file with', allSheets.length, 'sheets. Showing configuration...');
                        setPendingASFIFile({ allSheets, filename: file.name });
                        // Initialize sheet configurations for each sheet
                        const sheetConfigs = allSheets.map((sheet, idx) => ({
                            sheetIndex: idx,
                            startRow: 2, // Default to row 2 to skip headers
                            startCol: 0, // Column A (index 0)
                            selected: true // Select all sheets by default
                        }));

                        setASFISettings({
                            sheetConfigs: sheetConfigs,
                            selectedSheets: sheetConfigs.filter(config => config.selected).map(config => config.sheetIndex),
                            bulkStartRow: 2,
                            bulkStartCol: 0,
                            rangeStart: 1,
                            rangeEnd: Math.min(10, allSheets.length)
                        });
                        setShowASFISettings(true);
                        return; // Don't continue processing yet
                    } else {
                        // Regular Excel processing - use first sheet for initial analysis, but keep all sheets
                        const firstSheet = allSheets[0];
                        const headers = firstSheet.headers;
                        const rows = firstSheet.data.slice(1);

                        // Advanced analysis using PatternDetector
                        const analysis = PatternDetector.analyze(rows, headers);

                        const structure = {
                            fileName: file.name,
                            type: 'excel',
                            rowCount: firstSheet.rowCount,
                            headers: headers,
                            raw: firstSheet.data,
                            analysis: analysis,
                            allSheets: allSheets, // Include all sheets
                            currentSheet: firstSheet.name
                        };

                        onDataLoaded(structure);
                    }
                } catch (err) {
                    console.error(err);
                    setError('Error al leer el archivo Excel: ' + err.message);
                }
            };
            reader.readAsBinaryString(file);
        } else if (file.name.endsWith('.pdf')) {
            // PDF handling will be added later
            setError('Soporte para PDF en construcción. Por favor use Excel por ahora.');
        } else {
            setError('Formato no soportado. Use .xlsx o .xls');
        }
    };

    // ASFI Configuration Modal
    if (showASFISettings && pendingASFIFile) {
        return (
            <div className="p-5">
                <div className="text-center mb-5">
                    <h2 className="fw-bold mb-3">
                        <i className="bi bi-layers-fill text-warning me-3"></i>
                        Configuración ASFI Detectado
                    </h2>
                    <p className="text-muted">Archivo "{pendingASFIFile.filename}" contiene {pendingASFIFile.allSheets.length} hojas. Configure cómo procesar los datos.</p>
                </div>

                <div className="card shadow-sm border-warning">
                    <div className="card-body">
                        <h5 className="card-title mb-4">
                            <i className="bi bi-gear-fill me-2"></i>
                            Configuración por Hoja - {pendingASFIFile.filename}
                        </h5>
                        <div className="alert alert-info small mb-3">
                            <i className="bi bi-lightbulb me-2"></i>
                            <strong>Detección automática:</strong> Las columnas con datos se detectan automáticamente desde la columna inicial seleccionada. Solo se incluyen columnas que contienen información relevante.
                        </div>

                        <div className="mb-3">
                            <div className="d-flex gap-2 mb-3">
                                <button
                                    className="btn btn-sm btn-outline-primary"
                                    onClick={() => {
                                        const updatedConfigs = asfiSettings.sheetConfigs.map(config => ({
                                            ...config,
                                            selected: true
                                        }));
                                        setASFISettings({
                                            ...asfiSettings,
                                            sheetConfigs: updatedConfigs,
                                            selectedSheets: updatedConfigs.filter(c => c.selected).map(c => c.sheetIndex)
                                        });
                                    }}
                                >
                                    <i className="bi bi-check-square me-1"></i>Seleccionar Todas
                                </button>
                                <button
                                    className="btn btn-sm btn-outline-secondary"
                                    onClick={() => {
                                        const updatedConfigs = asfiSettings.sheetConfigs.map(config => ({
                                            ...config,
                                            selected: false
                                        }));
                                        setASFISettings({
                                            ...asfiSettings,
                                            sheetConfigs: updatedConfigs,
                                            selectedSheets: []
                                        });
                                    }}
                                >
                                    <i className="bi bi-square me-1"></i>Deseleccionar Todas
                                </button>
                                <button
                                    className="btn btn-sm btn-outline-info"
                                    onClick={() => {
                                        const updatedConfigs = asfiSettings.sheetConfigs.map(config => ({
                                            ...config,
                                            startRow: 2,
                                            startCol: 0
                                        }));
                                        setASFISettings({
                                            ...asfiSettings,
                                            sheetConfigs: updatedConfigs
                                        });
                                    }}
                                >
                                    <i className="bi bi-arrow-counterclockwise me-1"></i>Reset Configs
                                </button>
                            </div>

                            {/* Range Selection Controls */}
                            <div className="card bg-light mb-3">
                                <div className="card-body py-2">
                                    <div className="row align-items-center">
                                        <div className="col-auto">
                                            <small className="fw-bold text-muted">SELECCIÓN POR RANGO</small>
                                        </div>
                                        <div className="col-auto">
                                            <label className="form-label small mb-1">Desde hoja</label>
                                            <input
                                                type="number"
                                                className="form-control form-control-sm"
                                                value={asfiSettings.rangeStart}
                                                onChange={(e) => setASFISettings({
                                                    ...asfiSettings,
                                                    rangeStart: parseInt(e.target.value) || 1
                                                })}
                                                min="1"
                                                max={pendingASFIFile.allSheets.length}
                                                style={{width: '70px'}}
                                            />
                                        </div>
                                        <div className="col-auto">
                                            <label className="form-label small mb-1">Hasta hoja</label>
                                            <input
                                                type="number"
                                                className="form-control form-control-sm"
                                                value={asfiSettings.rangeEnd}
                                                onChange={(e) => setASFISettings({
                                                    ...asfiSettings,
                                                    rangeEnd: parseInt(e.target.value) || 1
                                                })}
                                                min="1"
                                                max={pendingASFIFile.allSheets.length}
                                                style={{width: '70px'}}
                                            />
                                        </div>
                                        <div className="col-auto">
                                            <button
                                                className="btn btn-sm btn-outline-primary"
                                                onClick={() => {
                                                    const start = asfiSettings.rangeStart - 1; // Convert to 0-indexed
                                                    const end = asfiSettings.rangeEnd; // End is exclusive in slice, but we want inclusive
                                                    const rangeSheets = Array.from({length: end - start}, (_, i) => start + i);

                                                    const updatedConfigs = asfiSettings.sheetConfigs.map(config => ({
                                                        ...config,
                                                        selected: rangeSheets.includes(config.sheetIndex)
                                                    }));

                                                    setASFISettings({
                                                        ...asfiSettings,
                                                        sheetConfigs: updatedConfigs,
                                                        selectedSheets: rangeSheets
                                                    });
                                                }}
                                            >
                                                <i className="bi bi-check-square me-1"></i>Seleccionar Rango
                                            </button>
                                        </div>
                                        <div className="col-auto">
                                            <button
                                                className="btn btn-sm btn-outline-secondary"
                                                onClick={() => {
                                                    const start = asfiSettings.rangeStart - 1;
                                                    const end = asfiSettings.rangeEnd;
                                                    const rangeSheets = Array.from({length: end - start}, (_, i) => start + i);

                                                    const updatedConfigs = asfiSettings.sheetConfigs.map(config => ({
                                                        ...config,
                                                        selected: config.selected || rangeSheets.includes(config.sheetIndex)
                                                    }));

                                                    setASFISettings({
                                                        ...asfiSettings,
                                                        sheetConfigs: updatedConfigs,
                                                        selectedSheets: updatedConfigs.filter(c => c.selected).map(c => c.sheetIndex)
                                                    });
                                                }}
                                            >
                                                <i className="bi bi-plus-square me-1"></i>Agregar Rango
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Bulk Configuration Controls */}
                            <div className="card bg-light mb-3">
                                <div className="card-body py-2">
                                    <div className="row align-items-center">
                                        <div className="col-auto">
                                            <small className="fw-bold text-muted">CONFIGURACIÓN MASIVA</small>
                                        </div>
                                        <div className="col-auto">
                                            <label className="form-label small mb-1">Fila inicial</label>
                                            <input
                                                type="number"
                                                className="form-control form-control-sm"
                                                value={asfiSettings.bulkStartRow}
                                                onChange={(e) => setASFISettings({
                                                    ...asfiSettings,
                                                    bulkStartRow: parseInt(e.target.value) || 1
                                                })}
                                                min="1"
                                                style={{width: '70px'}}
                                            />
                                        </div>
                                        <div className="col-auto">
                                            <label className="form-label small mb-1">Columna inicial</label>
                                            <select
                                                className="form-select form-select-sm"
                                                value={asfiSettings.bulkStartCol}
                                                onChange={(e) => setASFISettings({
                                                    ...asfiSettings,
                                                    bulkStartCol: parseInt(e.target.value)
                                                })}
                                                style={{width: '80px'}}
                                            >
                                                {Array.from({length: 10}, (_, i) => (
                                                    <option key={i} value={i}>
                                                        {String.fromCharCode(65 + i)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="col-auto">
                                            <button
                                                className="btn btn-sm btn-outline-success"
                                                onClick={() => {
                                                    const updatedConfigs = asfiSettings.sheetConfigs.map(config => ({
                                                        ...config,
                                                        startRow: asfiSettings.bulkStartRow,
                                                        startCol: asfiSettings.bulkStartCol
                                                    }));
                                                    setASFISettings({
                                                        ...asfiSettings,
                                                        sheetConfigs: updatedConfigs
                                                    });
                                                }}
                                            >
                                                <i className="bi bi-check-all me-1"></i>Aplicar a Todas
                                            </button>
                                        </div>
                                        <div className="col-auto">
                                            <button
                                                className="btn btn-sm btn-outline-warning"
                                                onClick={() => {
                                                    const updatedConfigs = asfiSettings.sheetConfigs.map(config =>
                                                        config.selected ? {
                                                            ...config,
                                                            startRow: asfiSettings.bulkStartRow,
                                                            startCol: asfiSettings.bulkStartCol
                                                        } : config
                                                    );
                                                    setASFISettings({
                                                        ...asfiSettings,
                                                        sheetConfigs: updatedConfigs
                                                    });
                                                }}
                                                disabled={asfiSettings.selectedSheets.length === 0}
                                            >
                                                <i className="bi bi-check-circle me-1"></i>Aplicar a Seleccionadas ({asfiSettings.selectedSheets.length})
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="border rounded p-3" style={{maxHeight: '400px', overflowY: 'auto'}}>
                            <div className="row mb-2 fw-bold text-muted small">
                                <div className="col-1">Sel.</div>
                                <div className="col-3">Hoja</div>
                                <div className="col-2">Fila Inicial</div>
                                <div className="col-2">Columna Inicial</div>
                                <div className="col-2">Filas Disp.</div>
                                <div className="col-2">Vista Previa</div>
                            </div>
                            <hr className="my-2" />

                            {pendingASFIFile.allSheets.map((sheet, index) => {
                                const config = asfiSettings.sheetConfigs[index] || {
                                    startRow: 2,
                                    startCol: 0,
                                    selected: true
                                };

                                // Get preview of first few cells from configured start position
                                const previewData = sheet.data.slice(config.startRow - 1, config.startRow + 2)
                                    .map(row => row ? row.slice(config.startCol, config.startCol + 3) : [])
                                    .flat()
                                    .slice(0, 3)
                                    .join(', ');

                                return (
                                    <div key={index} className="row mb-2 align-items-center">
                                        <div className="col-1">
                                            <input
                                                className="form-check-input"
                                                type="checkbox"
                                                checked={config.selected}
                                                onChange={(e) => {
                                                    const updatedConfigs = [...asfiSettings.sheetConfigs];
                                                    updatedConfigs[index] = {
                                                        ...updatedConfigs[index],
                                                        selected: e.target.checked
                                                    };
                                                    const selectedSheets = updatedConfigs
                                                        .filter(c => c.selected)
                                                        .map(c => c.sheetIndex);

                                                    setASFISettings({
                                                        ...asfiSettings,
                                                        sheetConfigs: updatedConfigs,
                                                        selectedSheets: selectedSheets
                                                    });
                                                }}
                                            />
                                        </div>
                                        <div className="col-3">
                                            <span className="fw-medium">{sheet.name}</span>
                                            <br />
                                            <small className="text-muted">{sheet.rowCount} filas</small>
                                        </div>
                                        <div className="col-2">
                                            <input
                                                type="number"
                                                className="form-control form-control-sm"
                                                value={config.startRow}
                                                onChange={(e) => {
                                                    const updatedConfigs = [...asfiSettings.sheetConfigs];
                                                    updatedConfigs[index] = {
                                                        ...updatedConfigs[index],
                                                        startRow: parseInt(e.target.value) || 1
                                                    };
                                                    setASFISettings({
                                                        ...asfiSettings,
                                                        sheetConfigs: updatedConfigs
                                                    });
                                                }}
                                                min="1"
                                                max={sheet.rowCount}
                                            />
                                        </div>
                                        <div className="col-2">
                                            <select
                                                className="form-select form-select-sm"
                                                value={config.startCol}
                                                onChange={(e) => {
                                                    const updatedConfigs = [...asfiSettings.sheetConfigs];
                                                    updatedConfigs[index] = {
                                                        ...updatedConfigs[index],
                                                        startCol: parseInt(e.target.value)
                                                    };
                                                    setASFISettings({
                                                        ...asfiSettings,
                                                        sheetConfigs: updatedConfigs
                                                    });
                                                }}
                                            >
                                                {Array.from({length: 10}, (_, i) => (
                                                    <option key={i} value={i}>
                                                        {String.fromCharCode(65 + i)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="col-2">
                                            <span className="badge bg-light text-dark">
                                                {Math.max(0, sheet.rowCount - config.startRow + 1)}
                                            </span>
                                        </div>
                                        <div className="col-2">
                                            <small className="text-truncate d-block" style={{maxWidth: '100px'}} title={previewData}>
                                                <span className="badge bg-secondary me-1">Auto</span>
                                                {previewData || 'Sin datos'}
                                            </small>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="d-flex gap-2 mt-4">
                            <button
                                className="btn btn-success"
                                onClick={processASFIWithSettings}
                                disabled={asfiSettings.selectedSheets.length === 0}
                            >
                                <i className="bi bi-play-fill me-2"></i>
                                Procesar Datos ({asfiSettings.selectedSheets.length} hojas)
                            </button>
                            <button
                                className="btn btn-secondary"
                                onClick={() => {
                                    setShowASFISettings(false);
                                    setPendingASFIFile(null);
                                }}
                            >
                                <i className="bi bi-x-circle me-2"></i>
                                Cancelar
                            </button>
                            <div className="ms-auto text-muted small">
                                Hojas seleccionadas: <strong>{asfiSettings.selectedSheets.length}</strong> de {pendingASFIFile.allSheets.length}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-5">
            <div className="text-center mb-5">
                <h2 className="fw-bold mb-3">Explorador de Datos</h2>
                <p className="text-muted">Cargue sus archivos para comenzar la transformación</p>
            </div>

            <div
                className={`card border-2 border-dashed p-5 text-center ${dragActive ? 'border-primary bg-light' : 'border-secondary'}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                style={{ minHeight: '300px', cursor: 'pointer' }}
            >
                <div className="card-body d-flex flex-column justify-content-center align-items-center">
                    <i className="bi bi-cloud-upload display-1 text-primary mb-3"></i>
                    <h4 className="fw-bold">Arrastre su archivo aquí</h4>
                    <p className="text-muted mb-4">o haga clic para seleccionar</p>

                    <input
                        type="file"
                        className="d-none"
                        id="file-upload"
                        accept=".xlsx, .xls, .pdf"
                        onChange={handleChange}
                    />
                    <label htmlFor="file-upload" className="btn btn-primary btn-lg px-5">
                        Seleccionar Archivo
                    </label>

                    {error && (
                        <div className="alert alert-danger mt-4 w-100">
                            <i className="bi bi-exclamation-triangle me-2"></i>{error}
                        </div>
                    )}
                </div>
            </div>

            <div className="row mt-5">
                <div className="col-md-4">
                    <div className="card h-100 border-0 shadow-sm">
                        <div className="card-body text-center">
                            <i className="bi bi-file-earmark-spreadsheet fs-1 text-success mb-3"></i>
                            <h5>Excel / CSV</h5>
                            <p className="text-muted small">Múltiples hojas soportadas</p>
                        </div>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="card h-100 border-0 shadow-sm">
                        <div className="card-body text-center">
                            <i className="bi bi-file-earmark-pdf fs-1 text-danger mb-3"></i>
                            <h5>PDF</h5>
                            <p className="text-muted small">Próximamente</p>
                        </div>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="card h-100 border-0 shadow-sm">
                        <div className="card-body text-center">
                            <i className="bi bi-database fs-1 text-info mb-3"></i>
                            <h5>Base de Datos</h5>
                            <p className="text-muted small">Próximamente</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Explorer;
