import React, { useState, useEffect, useRef } from 'react';
import { PatternDetector } from '../logic/PatternDetector';
import * as XLSX from 'xlsx';

const Canvas = ({ data }) => {
    const [transformations, setTransformations] = useState([]);
    const [previewData, setPreviewData] = useState([]);
    const [originalData, setOriginalData] = useState([]);
    const [currentSheetIndex, setCurrentSheetIndex] = useState(0);
    const [selectedColumn, setSelectedColumn] = useState(null);
    const [appliedTransformations, setAppliedTransformations] = useState([]);
    const [showExportModal, setShowExportModal] = useState(false);
    const [selectedTransformation, setSelectedTransformation] = useState(null);
    const [previewTransformation, setPreviewTransformation] = useState(null);
    const [previewDataTemp, setPreviewDataTemp] = useState(null);
    const [activeCategory, setActiveCategory] = useState('basic');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [showTransformationModal, setShowTransformationModal] = useState(false);
    const [selectedRows, setSelectedRows] = useState([]);
    const [selectedCells, setSelectedCells] = useState([]);
    
    const canvasRef = useRef(null);
    const [editingCell, setEditingCell] = useState(null); // { rowIndex, columnName }
    const [editValue, setEditValue] = useState('');
    const [selectedRowIndex, setSelectedRowIndex] = useState(null);

    // Transformation types - expanded with advanced features
    const transformationTypes = [
        // Basic transformations
        { id: 'filter', name: 'Filtrar', icon: 'bi-filter', color: 'primary', category: 'basic' },
        { id: 'sort', name: 'Ordenar', icon: 'bi-sort-alpha-down', color: 'success', category: 'basic' },
        { id: 'formula', name: 'Fórmula', icon: 'bi-calculator', color: 'dark', category: 'basic' },

        // Column operations
        { id: 'split_column', name: 'Dividir Columna', icon: 'bi-arrows-expand', color: 'info', category: 'columns' },
        { id: 'merge_columns', name: 'Unir Columnas', icon: 'bi-link', color: 'warning', category: 'columns' },
        { id: 'rename_column', name: 'Renombrar Columna', icon: 'bi-pencil-square', color: 'secondary', category: 'columns' },
        { id: 'duplicate_column', name: 'Duplicar Columna', icon: 'bi-copy', color: 'primary', category: 'columns' },
        { id: 'delete_column', name: 'Eliminar Columna', icon: 'bi-trash', color: 'danger', category: 'columns' },

        // Row operations
        { id: 'filter_rows', name: 'Filtrar Filas', icon: 'bi-filter-circle', color: 'primary', category: 'rows' },
        { id: 'split_rows', name: 'Dividir Filas', icon: 'bi-arrows-split', color: 'info', category: 'rows' },
        { id: 'merge_rows', name: 'Combinar Filas', icon: 'bi-chevron-contract', color: 'warning', category: 'rows' },
        { id: 'duplicate_rows', name: 'Duplicar Filas', icon: 'bi-files', color: 'secondary', category: 'rows' },

        // Cell operations
        { id: 'find_replace', name: 'Buscar/Reemplazar', icon: 'bi-search', color: 'info', category: 'cells' },
        { id: 'trim_whitespace', name: 'Limpiar Espacios', icon: 'bi-brush', color: 'success', category: 'cells' },
        { id: 'change_case', name: 'Cambiar Mayúsculas', icon: 'bi-type', color: 'warning', category: 'cells' },
        { id: 'extract_text', name: 'Extraer Texto', icon: 'bi-scissors', color: 'secondary', category: 'cells' },

        // Advanced transformations
        { id: 'pivot', name: 'Pivotear', icon: 'bi-table', color: 'secondary', category: 'advanced' },
        { id: 'group', name: 'Agrupar', icon: 'bi-collection', color: 'info', category: 'advanced' },
        { id: 'hierarchy', name: 'Jerarquía', icon: 'bi-diagram-3', color: 'danger', category: 'advanced' }
    ];

    // Initialize with source data
    useEffect(() => {
        if (data) {
            // Reset state
            setTransformations([]);
            setAppliedTransformations([]);
            setCurrentSheetIndex(0);

            if (data.allSheets && data.allSheets.length > 0) {
                // Handle multi-sheet data (from ASFI processing)
                const allSheetData = data.allSheets.map(sheet => ({
                    name: sheet.name,
                    headers: sheet.headers || [],
                    data: sheet.data || [],
                    rowCount: sheet.rowCount || 0
                }));
                setOriginalData(allSheetData);

                // Initialize with first sheet immediately
                changeSheet(0);
            } else if (data.raw && data.headers) {
                // Handle single sheet data
            const headers = data.headers;
                const rows = data.raw.slice(1); // Skip header row

                // Convert to object format for display
            const normalized = rows.map(row => {
                const obj = {};
                headers.forEach((h, i) => {
                        obj[h] = row[i] || '';
                });
                return obj;
            });

                setOriginalData([{
                    name: data.currentSheet || 'Hoja 1',
                    headers: headers,
                    data: data.raw,
                    rowCount: data.rowCount || rows.length
                }]);
                console.log("Setting preview data:", normalized);

            setPreviewData(normalized);
            } else {
                // Fallback for other data formats
                console.warn('Unsupported data format received:', data);
                setOriginalData([]);
                setPreviewData([]);
            }
        }
    }, [data]);

    const changeSheet = (sheetIndex) => {
        if (!originalData[sheetIndex]) return;

        setCurrentSheetIndex(sheetIndex);

        // Get sheet configuration from ASFI settings if available
        let startRow = 1; // Default to row 1 (skip header)
        let startCol = 0; // Default to column A

        if (data && data.asfiSettings && data.asfiSettings.sheetConfigs && data.asfiSettings.sheetConfigs[sheetIndex]) {
            const config = data.asfiSettings.sheetConfigs[sheetIndex];
            startRow = config.startRow;
            startCol = config.startCol;
        }

        // Apply row/column filtering like in Workshop
        const sheet = originalData[sheetIndex];

        let processedRows = sheet.data
            .slice(startRow > 0 ? startRow - 1 : 0) // Convert 1-indexed Excel rows to 0-indexed array indices
            .map(row => {
                if (Array.isArray(row)) {
                    // Take columns from startCol onwards
                    return row.slice(startCol);
                }
                return row;
            });

        // Create headers based on the filtered data
        const numColumns = processedRows[0]?.length || 0;
        const headers = Array.from({ length: numColumns }, (_, idx) =>
            `Columna ${startCol + idx + 1}`
        );

        // Convert to object format
        const normalized = processedRows.map(row => {
                const obj = {};
                headers.forEach((h, i) => {
                obj[h] = row[i] || '';
                });
                return obj;
            });

        // Reapply current transformations
        let transformedData = normalized;
        appliedTransformations.forEach(transform => {
            transformedData = applyTransformation(transformedData, transform);
        });

        console.log(`[Canvas] Final preview data rows:`, transformedData.length);
        setPreviewData(transformedData);
    };

    
    const handleCellClick = (rowIndex, columnName, currentValue) => {
        setEditingCell({ rowIndex, columnName });
        setEditValue(String(currentValue || ''));
        setSelectedRowIndex(rowIndex);
    };

    const handleCellSave = () => {
        if (editingCell) {
            const { rowIndex, columnName } = editingCell;
            const updatedData = [...previewData];
            updatedData[rowIndex] = {
                ...updatedData[rowIndex],
                [columnName]: editValue
            };
            setPreviewData(updatedData);
            setEditingCell(null);
            setEditValue('');
        }
    };

    const handleCellCancel = () => {
        setEditingCell(null);
        setEditValue('');
    };

    const addRow = (direction = 'below') => {
        const newRow = {};
        currentColumns.forEach(col => newRow[col] = '');
        
        const newData = [...previewData];
        const insertIndex = selectedRowIndex !== null 
            ? (direction === 'below' ? selectedRowIndex + 1 : selectedRowIndex)
            : newData.length;
            
        newData.splice(insertIndex, 0, newRow);
        setPreviewData(newData);
    };

    const deleteRow = () => {
        if (selectedRowIndex !== null) {
            const newData = previewData.filter((_, index) => index !== selectedRowIndex);
            setPreviewData(newData);
            setSelectedRowIndex(null);
        }
    };

    const updateTransformation = (id, updates) => {
        setTransformations(transformations.map(t =>
            t.id === id ? { ...t, ...updates } : t
        ));
    };

    const addTransformation = (type) => {
        const newTransform = {
            id: Date.now(),
            type: type,
            name: `${transformationTypes.find(t => t.id === type)?.name} ${appliedTransformations.length + transformations.length + 1}`,
            config: {},
            position: { x: 100 + (transformations.length * 150), y: 100 },
            inputs: [],
            outputs: []
        };

        // Set default config based on type and available columns
        const availableColumns = Object.keys(previewData[0] || []);
        switch (type) {
            case 'filter':
                newTransform.config = {
                    column: availableColumns[0] || '',
                    operator: 'equals',
                    value: ''
                };
                break;
            case 'sort':
                newTransform.config = {
                    column: availableColumns[0] || '',
                    direction: 'asc'
                };
                break;
            case 'formula':
                newTransform.config = {
                    formula: '',
                    newColumn: `NuevaColumna${appliedTransformations.length + transformations.length + 1}`
                };
                break;
            case 'split_column':
                newTransform.config = {
                    column: availableColumns[0] || '',
                    separator: '-',
                    newColumns: [`${availableColumns[0]}_1`, `${availableColumns[0]}_2`]
                };
                break;
            case 'merge_columns':
                newTransform.config = {
                    columns: availableColumns.slice(0, 2),
                    separator: ' ',
                    newColumn: 'Columna_Unida'
                };
                break;
            case 'rename_column':
                newTransform.config = {
                    oldName: availableColumns[0] || '',
                    newName: `${availableColumns[0]}_renombrado`
                };
                break;
            case 'duplicate_column':
                newTransform.config = {
                    column: availableColumns[0] || '',
                    newName: `${availableColumns[0]}_copia`
                };
                break;
            case 'delete_column':
                newTransform.config = {
                    column: availableColumns[0] || ''
                };
                break;
            case 'filter_rows':
                newTransform.config = {
                    column: availableColumns[0] || '',
                    operator: 'contains',
                    value: '',
                    caseSensitive: false
                };
                break;
            case 'find_replace':
                newTransform.config = {
                    column: availableColumns[0] || '',
                    find: '',
                    replace: '',
                    caseSensitive: false,
                    regex: false
                };
                break;
            case 'trim_whitespace':
                newTransform.config = {
                    columns: availableColumns,
                    trimType: 'both' // left, right, both
                };
                break;
            case 'change_case':
                newTransform.config = {
                    columns: availableColumns,
                    caseType: 'uppercase' // uppercase, lowercase, titlecase
                };
                break;
            case 'extract_text':
                newTransform.config = {
                    column: availableColumns[0] || '',
                    startPosition: 0,
                    length: 10,
                    newColumn: 'Texto_Extraido'
                };
                break;
            case 'split_rows':
                newTransform.config = {
                    column: availableColumns[0] || ''
                };
                break;
            case 'group':
                newTransform.config = { groupBy: [], aggregations: [] };
                break;
            default:
                break;
        }

        setTransformations([...transformations, newTransform]);
        setSelectedTransformation(newTransform.id); // Auto-select for configuration
        setShowTransformationModal(true); // Open modal
        setSelectedColumn(null); // Reset column selection
    };

    const showPreview = (transform) => {
        // Show preview of transformation without applying it
        const result = applyTransformation(previewData, transform);
        setPreviewDataTemp(result);
        setPreviewTransformation(transform);
    };

    const applyPreviewedTransformation = () => {
        if (previewTransformation && previewDataTemp) {
            setAppliedTransformations([...appliedTransformations, previewTransformation]);
            setPreviewData(previewDataTemp);
            setPreviewTransformation(null);
            setPreviewDataTemp(null);
            setTransformations([]); // Clear pending transformations
        }
    };

    const cancelPreview = () => {
        setPreviewTransformation(null);
        setPreviewDataTemp(null);
    };

    const applySingleTransformation = (transform) => {
        // Apply a single transformation immediately and show results
        const result = applyTransformation(previewData, transform);
        setAppliedTransformations([...appliedTransformations, transform]);
            setPreviewData(result);
        setTransformations([]); // Clear pending transformations
        setShowTransformationModal(false);
        setSelectedTransformation(null);
        cancelPreview();

        // Auto-scroll to show the changes
        setTimeout(() => {
            const tableElement = document.querySelector('.table-responsive');
            if (tableElement) {
                tableElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    };

    const applyAndCloseModal = () => {
        if (previewTransformation) {
            applyPreviewedTransformation();
            setShowTransformationModal(false);
            setSelectedTransformation(null);
        }
    };

    const applyTransformation = (inputData, transform) => {
        switch (transform.type) {
            case 'filter':
                return inputData.filter(row => {
                    const value = row[transform.config.column];
                    const filterValue = transform.config.value;

                    switch (transform.config.operator) {
                        case 'equals': return value == filterValue;
                        case 'contains': return String(value).includes(filterValue);
                        case 'startsWith': return String(value).startsWith(filterValue);
                        case 'greaterThan': return parseFloat(value) > parseFloat(filterValue);
                        case 'lessThan': return parseFloat(value) < parseFloat(filterValue);
                        default: return true;
                    }
                });

            case 'sort':
                return [...inputData].sort((a, b) => {
                    const aVal = a[transform.config.column];
                    const bVal = b[transform.config.column];

                    if (transform.config.direction === 'asc') {
                        return aVal > bVal ? 1 : -1;
                    } else {
                        return aVal < bVal ? 1 : -1;
                    }
                });

            case 'formula':
                return inputData.map(row => ({
                    ...row,
                    [transform.config.newColumn]: evaluateFormula(transform.config.formula, row)
                }));

            case 'split_column':
                return inputData.map(row => {
                    const value = String(row[transform.config.column] || '');
                    const parts = value.split(transform.config.separator);
                    const newRow = { ...row };

                    // Remove original column
                    delete newRow[transform.config.column];

                    // Add split columns
                    transform.config.newColumns.forEach((colName, index) => {
                        newRow[colName] = parts[index] || '';
                    });

                    return newRow;
                });

            case 'merge_columns':
                return inputData.map(row => ({
                    ...row,
                    [transform.config.newColumn]: transform.config.columns
                        .map(col => String(row[col] || ''))
                        .join(transform.config.separator)
                }));

            case 'rename_column':
                return inputData.map(row => {
                    const newRow = { ...row };
                    newRow[transform.config.newName] = newRow[transform.config.oldName];
                    delete newRow[transform.config.oldName];
                    return newRow;
                });

            case 'duplicate_column':
                return inputData.map(row => ({
                    ...row,
                    [transform.config.newName]: row[transform.config.column]
                }));

            case 'delete_column':
                return inputData.map(row => {
                    const newRow = { ...row };
                    delete newRow[transform.config.column];
                    return newRow;
                });

            case 'filter_rows':
                return inputData.filter(row => {
                    const value = String(row[transform.config.column] || '');
                    const filterValue = String(transform.config.value || '');
                    const comparison = transform.config.caseSensitive ?
                        value : value.toLowerCase();
                    const filter = transform.config.caseSensitive ?
                        filterValue : filterValue.toLowerCase();

                    switch (transform.config.operator) {
                        case 'equals': return comparison === filter;
                        case 'contains': return comparison.includes(filter);
                        case 'startsWith': return comparison.startsWith(filter);
                        case 'endsWith': return comparison.endsWith(filter);
                        default: return true;
                    }
                });

            case 'find_replace':
                return inputData.map(row => ({
                    ...row,
                    [transform.config.column]: transform.config.regex ?
                        String(row[transform.config.column] || '').replace(
                            new RegExp(transform.config.find, transform.config.caseSensitive ? 'g' : 'gi'),
                            transform.config.replace
                        ) :
                        String(row[transform.config.column] || '').replace(
                            new RegExp(transform.config.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                                transform.config.caseSensitive ? 'g' : 'gi'),
                            transform.config.replace
                        )
                }));

            case 'trim_whitespace':
                return inputData.map(row => {
                    const newRow = { ...row };
                    transform.config.columns.forEach(col => {
                        if (newRow[col]) {
                            switch (transform.config.trimType) {
                                case 'left':
                                    newRow[col] = String(newRow[col]).trimStart();
                                    break;
                                case 'right':
                                    newRow[col] = String(newRow[col]).trimEnd();
                                    break;
                                case 'both':
                                default:
                                    newRow[col] = String(newRow[col]).trim();
                                    break;
                            }
                        }
                    });
                    return newRow;
                });

            case 'change_case':
                return inputData.map(row => {
                    const newRow = { ...row };
                    transform.config.columns.forEach(col => {
                        if (newRow[col]) {
                            switch (transform.config.caseType) {
                                case 'uppercase':
                                    newRow[col] = String(newRow[col]).toUpperCase();
                                    break;
                                case 'lowercase':
                                    newRow[col] = String(newRow[col]).toLowerCase();
                                    break;
                                case 'titlecase':
                                    newRow[col] = String(newRow[col]).replace(/\w\S*/g,
                                        (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
                                    break;
                                default:
                                    break;
                            }
                        }
                    });
                    return newRow;
                });

            case 'extract_text':
                return inputData.map(row => ({
                    ...row,
                    [transform.config.newColumn]: String(row[transform.config.column] || '')
                        .substring(transform.config.startPosition,
                            transform.config.startPosition + transform.config.length)
                }));

            case 'split_rows':
                // Split rows based on newlines in a specific column
                const expandedRows = [];
                inputData.forEach(row => {
                    const cellValue = String(row[transform.config.column] || '');
                    // Split by newline characters (\n, \r\n, or \r)
                    const lines = cellValue.split(/\r?\n/);

                    if (lines.length > 1) {
                        // Create a new row for each line
                        lines.forEach(line => {
                            if (line.trim()) { // Only add non-empty lines
                                expandedRows.push({
                                    ...row,
                                    [transform.config.column]: line.trim()
                                });
                            }
                        });
                    } else {
                        // No newlines, keep the row as is
                        expandedRows.push(row);
                    }
                });
                return expandedRows;

            case 'group':
                // Basic grouping implementation
                const groups = {};
                inputData.forEach(row => {
                    const key = transform.config.groupBy.map(col => row[col]).join('_');
                    if (!groups[key]) {
                        groups[key] = [];
                    }
                    groups[key].push(row);
                });

                return Object.values(groups).map(group => {
                    const result = {};
                    transform.config.groupBy.forEach(col => {
                        result[col] = group[0][col];
                    });
                    result['count'] = group.length;
                    return result;
                });

            default:
                return inputData;
        }
    };

    const evaluateFormula = (formula, row) => {
        // Simple formula evaluation - in a real implementation this would be more sophisticated
        try {
            // Replace column references with actual values
            let processedFormula = formula;
            Object.keys(row).forEach(col => {
                const regex = new RegExp(`\\b${col}\\b`, 'g');
                processedFormula = processedFormula.replace(regex, row[col] || 0);
            });

            // Simple eval for basic math - in production use a proper expression parser
            return eval(processedFormula);
        } catch (error) {
            console.error('Formula evaluation error:', error);
            return 'ERROR';
        }
    };

    const exportToExcel = () => {
        const wb = XLSX.utils.book_new();

        // Export all sheets if multi-sheet, otherwise just current sheet
        if (originalData.length > 1) {
            originalData.forEach((sheet, index) => {
                // Get transformed data for each sheet if it has transformations
                let sheetData = getSheetData(sheet, index);
                const ws = XLSX.utils.json_to_sheet(sheetData);
                XLSX.utils.book_append_sheet(wb, ws, sheet.name);
            });
        } else {
            const ws = XLSX.utils.json_to_sheet(previewData);
            XLSX.utils.book_append_sheet(wb, ws, originalData[0]?.name || "Transformed Data");
        }

        XLSX.writeFile(wb, `dataforge_transformed_${Date.now()}.xlsx`);
        setShowExportModal(false);
    };

    const exportToPDF = async () => {
        // For PDF export, we'll create a simple HTML table and use browser print
        const tableHTML = generateHTMLTable(previewData);

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>DataForge Export - ${originalData[currentSheetIndex]?.name}</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; }
                        table { border-collapse: collapse; width: 100%; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f2f2f2; font-weight: bold; }
                        tr:nth-child(even) { background-color: #f9f9f9; }
                    </style>
                </head>
                <body>
                    <h2>DataForge Export - ${originalData[currentSheetIndex]?.name}</h2>
                    <p>Generado el: ${new Date().toLocaleString()}</p>
                    ${tableHTML}
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
        setShowExportModal(false);
    };

    const exportToWord = () => {
        // For Word export, create HTML that Word can understand
        const tableHTML = generateHTMLTable(previewData);

        const wordContent = `
            <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
                <head>
                    <meta charset="utf-8">
                    <title>DataForge Export</title>
                    <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>90</w:Zoom></w:WordDocument></xml><![endif]-->
                    <style>
                        body { font-family: Arial, sans-serif; }
                        table { border-collapse: collapse; width: 100%; }
                        th, td { border: 1px solid #000; padding: 8px; }
                        th { background-color: #f0f0f0; font-weight: bold; }
                    </style>
                </head>
                <body>
                    <h1>DataForge Export - ${originalData[currentSheetIndex]?.name}</h1>
                    <p>Generado el: ${new Date().toLocaleString()}</p>
                    ${tableHTML}
                </body>
            </html>
        `;

        const blob = new Blob([wordContent], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dataforge_export_${Date.now()}.doc`;
        a.click();
        URL.revokeObjectURL(url);
        setShowExportModal(false);
    };

    const generateHTMLTable = (data) => {
        if (!data || data.length === 0) return '<p>No data available</p>';

        const headers = Object.keys(data[0]);
        let html = '<table><thead><tr>';

        headers.forEach(header => {
            html += `<th>${header}</th>`;
        });

        html += '</tr></thead><tbody>';

        data.forEach(row => {
            html += '<tr>';
            headers.forEach(header => {
                html += `<td>${row[header] || ''}</td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        return html;
    };

    const getSheetData = (sheet, sheetIndex) => {
        // Get original sheet data with transformations applied
        let startRow = 1;
        let startCol = 0;

        if (data && data.asfiSettings && data.asfiSettings.sheetConfigs && data.asfiSettings.sheetConfigs[sheetIndex]) {
            const config = data.asfiSettings.sheetConfigs[sheetIndex];
            startRow = config.startRow;
            startCol = config.startCol;
        }

        let processedRows = sheet.data
            .slice(startRow)
            .map(row => {
                if (Array.isArray(row)) {
                    return row.slice(startCol);
                }
                return row;
            })
            .filter(row =>
                Array.isArray(row) && row.some(cell =>
                    cell !== null && cell !== undefined && cell !== ''
                )
            );

        // Create headers
        const numColumns = processedRows[0]?.length || 0;
        const headers = Array.from({ length: numColumns }, (_, idx) =>
            `Columna ${startCol + idx + 1}`
        );

        // Convert to object format
        let sheetData = processedRows.map(row => {
            const obj = {};
            headers.forEach((h, i) => {
                obj[h] = row[i] || '';
            });
            return obj;
        });

        // Apply transformations if this sheet has been worked on
        if (appliedTransformations.length > 0) {
            appliedTransformations.forEach(transform => {
                sheetData = applyTransformation(sheetData, transform);
            });
        }

        return sheetData;
    };

    if (!data) {
    return (
            <div className="p-5 text-center text-muted">
                <i className="bi bi-table display-1 mb-3"></i>
                <h3>Canvas de Datos</h3>
                <p>Carga datos desde el Explorador para comenzar a visualizar y transformar.</p>
            </div>
        );
    }

    if (!Array.isArray(previewData)) {
        return (
            <div className="p-5 text-center text-muted">
                <i className="bi bi-hourglass display-1 mb-3"></i>
                <h3>Cargando datos...</h3>
                <p>Procesando la información cargada.</p>
            </div>
        );
    }

    const currentColumns = Object.keys(previewData[0] || {});

    const APP_SIDEBAR_WIDTH = 60;
    const TOOLS_SIDEBAR_WIDTH = 320;
    const COLLAPSED_STRIP_WIDTH = 0;

    const mainMarginLeft = `${APP_SIDEBAR_WIDTH}px`;
    const mainContentStyle = {
        marginLeft: mainMarginLeft,
        transition: 'margin-left 0.3s ease',
    };


    return (
        <div className="d-flex h-100 position-relative">
            {/* Sidebar Toggle Button */}


            {/* Sidebar */}
            <div
                className="bg-white border-start shadow-lg h-100 order-2"
                style={{
                    width: sidebarCollapsed ? '0px' : `${TOOLS_SIDEBAR_WIDTH}px`,
                    transition: 'width 0.3s ease-in-out',
                    overflow: 'hidden',
                    flexShrink: 0,
                    zIndex: 1040
                }}
            >
                <div className="p-3">
                    <div className="d-flex align-items-center justify-content-between mb-3">
                        <h5 className="fw-bold mb-0">
                    <i className="bi bi-tools me-2"></i>Herramientas
                </h5>
                        <small className="text-muted">Transformación</small>
                    </div>

                    {/* Transformation Categories */}
                <div className="mb-3">
                        <h6 className="small fw-bold text-muted mb-2">CATEGORÍAS</h6>
                        <div className="d-grid gap-1">
                            {['basic', 'columns', 'rows', 'cells', 'advanced'].map(category => (
                        <button
                                    key={category}
                                    className={`btn btn-sm ${activeCategory === category ? 'btn-primary' : 'btn-outline-primary'}`}
                                    onClick={() => setActiveCategory(category)}
                                >
                                    {category === 'basic' && '🟢 Básico'}
                                    {category === 'columns' && '🔵 Columnas'}
                                    {category === 'rows' && '🟡 Filas'}
                                    {category === 'cells' && '🟠 Celdas'}
                                    {category === 'advanced' && '🔴 Avanzado'}
                        </button>
                            ))}
                        </div>
                    </div>

                    {/* Transformation Buttons by Category */}
                    <div className="mb-3">
                        <h6 className="small fw-bold text-muted mb-2">
                            TRANSFORMACIONES - {activeCategory.toUpperCase()}
                        </h6>
                        <div className="d-grid gap-1">
                            {transformationTypes
                                .filter(type => type.category === activeCategory)
                                .map(type => (
                        <button
                                        key={type.id}
                                        className={`btn btn-outline-${type.color} btn-sm text-start`}
                                        onClick={() => addTransformation(type.id)}
                                        title={`Agregar transformación: ${type.name}`}
                                    >
                                        <i className={`bi ${type.icon} me-2`}></i>
                                        {type.name}
                        </button>
                                ))}
                        </div>
                    </div>

                    {/* Data Info */}
                    <div className="mb-3 p-2 bg-light rounded small">
                        <div className="fw-bold mb-1">Información de Datos</div>
                        <div className="row text-center">
                            <div className="col-4">
                                <div className="fw-bold text-primary">{originalData.length}</div>
                                <div className="small text-muted">Hojas</div>
                            </div>
                            <div className="col-4">
                                <div className="fw-bold text-success">{originalData[currentSheetIndex]?.rowCount - 1 || 0}</div>
                                <div className="small text-muted">Filas Originales</div>
                            </div>
                            <div className="col-4">
                                <div className="fw-bold text-info">{previewData.length}</div>
                                <div className="small text-muted">Filas Actuales</div>
                            </div>
                        </div>
                    </div>

                    {/* Applied Transformations History */}
                    <div className="flex-grow-1">
                        <h6 className="small fw-bold text-muted mb-2">
                            <i className="bi bi-clock-history me-1"></i>
                            Historial de Transformaciones
                        </h6>

                        <div className="list-group list-group-flush small">
                            {appliedTransformations.length > 0 ? (
                                appliedTransformations.map((transform, index) => (
                                    <div key={`applied-${index}`} className="list-group-item px-2 py-1">
                                        <div className="d-flex justify-content-between align-items-center">
                                            <div>
                                                <span className="badge bg-success me-2">#{index + 1}</span>
                                                <small className="fw-medium">{transform.name}</small>
                                                <br />
                                                <small className="text-muted">
                                                    {transform.type === 'filter' && `Filtro: ${transform.config.column} ${transform.config.operator} "${transform.config.value}"`}
                                                    {transform.type === 'sort' && `Orden: ${transform.config.column} ${transform.config.direction === 'asc' ? '↑' : '↓'}`}
                                                    {transform.type === 'formula' && `Fórmula: ${transform.config.newColumn} = ${transform.config.formula}`}
                                                    {transform.type === 'group' && `Agrupar por: ${transform.config.groupBy.join(', ')}`}
                                                    {transform.type === 'join' && `Unir con: ${transform.config.table}`}
                                                    {transform.type === 'pivot' && `Pivot: ${transform.config.pivotColumn}`}
                                                    {transform.type === 'hierarchy' && `Jerarquía: ${transform.config.parentColumn} → ${transform.config.childColumn}`}
                                                </small>
                                            </div>
                                            <small className="text-success">
                                                <i className="bi bi-check-circle-fill"></i>
                                            </small>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-muted small fst-italic p-2 text-center">
                                    <i className="bi bi-info-circle me-1"></i>
                                    No hay transformaciones aplicadas
                                    <br />
                                    <small>Usa los botones arriba para transformar tus datos</small>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="mt-3">
                        <div className="d-grid gap-2">
                        <button
                                className="btn btn-primary btn-sm"
                                onClick={() => setShowExportModal(true)}
                                disabled={previewData.length === 0}
                            >
                                <i className="bi bi-download me-1"></i>Exportar Datos
                            </button>
                            <button
                                className="btn btn-outline-secondary btn-sm"
                                onClick={() => {
                                    setAppliedTransformations([]);
                                    changeSheet(currentSheetIndex); // Reapply sheet configuration
                                }}
                            >
                                <i className="bi bi-arrow-counterclockwise me-1"></i>Reset Datos
                        </button>
                        </div>
                    </div>
                    </div>
                </div>

            {/* Main Content Area - Full Width */}
            <div
                className="flex-grow-1 d-flex flex-column position-relative order-1"
                style={mainContentStyle}
            >
                {/* Top Bar with Quick Controls */}
                <div className="bg-white border-bottom p-3 d-flex justify-content-between align-items-center">
                    <div className="d-flex align-items-center gap-3">
                        <h5 className="mb-0 fw-bold">
                            <i className="bi bi-table me-2 text-primary"></i>
                            Canvas de Datos
                        </h5>


                    </div>

                    {/* Quick Stats & Actions */}
                    <div className="d-flex align-items-center gap-3">
                        <div className="d-flex gap-2">
                            <span className="badge bg-light text-dark border">
                                <i className="bi bi-grid-3x3-gap me-1"></i>
                                {currentColumns.length} columnas
                            </span>
                            <span className="badge bg-light text-dark border">
                                <i className="bi bi-list-ul me-1"></i>
                                {previewData.length} filas de datos
                            </span>
                            {appliedTransformations.length > 0 && (
                                <span className="badge bg-success">
                                    <i className="bi bi-check-circle-fill me-1"></i>
                                    {appliedTransformations.length} cambios
                                </span>
                            )}
                        </div>

                        <div className="d-flex gap-1">
                            <div className="btn-group me-2">
                                <button className="btn btn-outline-secondary btn-sm" onClick={() => addRow('above')} title="Insertar fila arriba">
                                    <i className="bi bi-arrow-bar-up"></i>
                                </button>
                                <button className="btn btn-outline-secondary btn-sm" onClick={() => addRow('below')} title="Insertar fila abajo">
                                    <i className="bi bi-arrow-bar-down"></i>
                                </button>
                                <button className="btn btn-outline-danger btn-sm" onClick={deleteRow} disabled={selectedRowIndex === null} title="Eliminar fila">
                                    <i className="bi bi-trash"></i>
                                </button>
                            </div>

                        <button
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                                title={sidebarCollapsed ? 'Mostrar herramientas' : 'Ocultar herramientas'}
                            >
                                <i className={`bi ${sidebarCollapsed ? 'bi-chevron-right' : 'bi-chevron-left'}`}></i>
                            </button>
                            <button
                                className="btn btn-success btn-sm"
                                onClick={() => setShowExportModal(true)}
                                disabled={previewData.length === 0}
                                title="Exportar datos"
                            >
                                <i className="bi bi-download me-1"></i>Exportar
                        </button>
                    </div>
                </div>
                </div>
                <div className="p-4 h-100 d-flex flex-column">
                    <div className="d-flex justify-content-between align-items-center mb-3">
                        <div className="d-flex align-items-center gap-3">
                            <h5 className="mb-0">
                                <i className="bi bi-table me-2"></i>
                                Vista de Datos: {originalData[currentSheetIndex]?.name || 'Hoja'}
                            </h5>

                            {/* Sheet Navigation */}
                            {originalData.length > 1 && (
                                <div className="d-flex align-items-center gap-2">
                                    <small className="text-muted">Cambiar hoja:</small>
                                    <select
                                        className="form-select form-select-sm"
                                        value={currentSheetIndex}
                                        onChange={(e) => changeSheet(parseInt(e.target.value))}
                                        style={{ width: '180px' }}
                                    >
                                        {originalData.map((sheet, index) => (
                                            <option key={index} value={index}>
                                                {sheet.name} ({sheet.rowCount - 1} filas)
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                </div>
            </div>

                    {/* Statistics Bar */}
                    <div className="d-flex justify-content-between align-items-center mb-2 px-2">
                        <div className="d-flex gap-3">
                            <span className="badge bg-primary">
                                <i className="bi bi-table me-1"></i>
                            {previewData.length} filas
                        </span>
                            <span className="badge bg-info">
                                <i className="bi bi-layout-three-columns me-1"></i>
                                {currentColumns.length} columnas
                            </span>
                            {data && data.asfiSettings && data.asfiSettings.sheetConfigs && data.asfiSettings.sheetConfigs[currentSheetIndex] && (
                                <span className="badge bg-warning text-dark">
                                    <i className="bi bi-gear me-1"></i>
                                    Fila {data.asfiSettings.sheetConfigs[currentSheetIndex].startRow}, Col {String.fromCharCode(65 + data.asfiSettings.sheetConfigs[currentSheetIndex].startCol)}
                                </span>
                            )}
                            {appliedTransformations.length > 0 && (
                                <span className="badge bg-success">
                                    <i className="bi bi-check-circle me-1"></i>
                                    {appliedTransformations.length} transformación{appliedTransformations.length !== 1 ? 'es' : ''} aplicada{appliedTransformations.length !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Data Table - Full Screen */}
                    <div className="flex-grow-1 bg-white position-relative">
                        <div className="table-responsive">
                            <table className={`table table-hover table-bordered mb-0 table-sm ${previewTransformation ? 'table-warning' : ''}`}>
                                <thead className="table-light sticky-top shadow-sm">
                                    <tr>
                                        {currentColumns.map(header => (
                                            <th
                                                key={header}
                                                className={`px-3 py-3 fw-medium ${selectedColumn === header ? 'bg-primary text-white' : ''}`}
                                                onClick={() => setSelectedColumn(header)}
                                                style={{
                                                    cursor: 'pointer',
                                                    minWidth: '120px',
                                                    position: 'relative'
                                                }}
                                            >
                                                <div className="d-flex align-items-center justify-content-between">
                                                    <span className="text-truncate" title={header}>
                                                        {header}
                                                    </span>
                                                    {selectedColumn === header && (
                                                        <i className="bi bi-check-circle-fill ms-2 flex-shrink-0"></i>
                                                    )}
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(previewDataTemp || previewData).map((row, index) => (
                                        <tr key={index} className={previewTransformation ? 'table-warning' : ''}>
                                            {currentColumns.map(header => (
                                                <td
                                                    key={header}
                                                    className="px-3 py-2"
                                                    style={{
                                                        maxWidth: '200px',
                                                        borderLeft: selectedColumn === header ? '3px solid #0d6efd' : '1px solid #dee2e6',
                                                        cursor: 'text',
                                                        backgroundColor: selectedRowIndex === index ? '#f8f9fa' : 'inherit'
                                                    }}
                                                    onDoubleClick={() => handleCellClick(index, header, row[header])}
                                                    onClick={() => setSelectedRowIndex(index)}
                                                >
                                                    {editingCell?.rowIndex === index && editingCell?.columnName === header ? (
                                                        <input
                                                            type="text"
                                                            className="form-control form-control-sm border-primary p-1"
                                                            value={editValue}
                                                            onChange={(e) => setEditValue(e.target.value)}
                                                            onBlur={handleCellSave}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') handleCellSave();
                                                                if (e.key === 'Escape') handleCellCancel();
                                                            }}
                                                            autoFocus
                                                            style={{ width: '100%', minHeight: '24px' }}
                                                        />
                                                    ) : (
                                                        <div className="text-truncate" title={String(row[header] || '')}>
                                                            {String(row[header] || '')}
                                                        </div>
                                                    )}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {(previewDataTemp || previewData).length === 0 && (
                                <div className="d-flex align-items-center justify-content-center h-100 text-muted">
                                    <div className="text-center">
                                        <i className="bi bi-table display-4 mb-3 opacity-25"></i>
                                        <h5>No hay datos para mostrar</h5>
                                        <p className="mb-0">Carga datos desde el Explorador para comenzar</p>
                                    </div>
                                </div>
                            )}

                            {(previewDataTemp || previewData).length > 0 && (
                                <div className="position-fixed bottom-0 end-0 p-3" style={{ zIndex: 1000 }}>
                                    <div className="bg-light border rounded shadow-sm p-2 small">
                                        <div className="d-flex align-items-center gap-2">
                                            <span className="fw-medium">
                                                {(previewDataTemp || previewData).length} filas × {currentColumns.length} columnas
                                            </span>
                                            {previewTransformation && (
                                                <span className="badge bg-warning text-dark ms-2">
                                                    <i className="bi bi-eye me-1"></i>PREVIEW
                                                </span>
                                            )}
                                            {appliedTransformations.length > 0 && (
                                                <span className="badge bg-success ms-2">
                                                    <i className="bi bi-check-circle me-1"></i>
                                                    {appliedTransformations.length} cambios
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                </div>
            </div>
            {/* Transformation Configuration Modal */}
            {showTransformationModal && selectedTransformation && (
                <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-lg">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">
                                    <i className="bi bi-gear me-2"></i>
                                    Configurar: {transformations.find(t => t.id === selectedTransformation)?.name}
                                </h5>
                                <button type="button" className="btn-close" onClick={() => {
                                    setShowTransformationModal(false);
                                    setSelectedTransformation(null);
                                    cancelPreview();
                                }}></button>
                            </div>
                            <div className="modal-body">
                                <TransformationConfig
                                    transformation={transformations.find(t => t.id === selectedTransformation)}
                                    columns={currentColumns}
                                    onUpdate={(updates) => {
                                        updateTransformation(selectedTransformation, updates);
                                        // Auto-preview when config changes
                                        const transform = transformations.find(t => t.id === selectedTransformation);
                                        if (transform) {
                                            const updatedTransform = { ...transform, ...updates };
                                            showPreview(updatedTransform);
                                        }
                                    }}
                                />

                                {/* Preview Info */}
                                {previewTransformation && (
                                    <div className="mt-3 alert alert-info py-2">
                                        <div className="d-flex align-items-center">
                                            <i className="bi bi-eye me-2"></i>
                                            <small className="fw-medium">
                                                Vista previa activa - Los cambios se muestran en la tabla principal
                                            </small>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <div className="d-flex justify-content-between w-100">
                                    <div>
                                        {previewTransformation && (
                                            <small className="text-muted">
                                                <i className="bi bi-info-circle me-1"></i>
                                                {appliedTransformations.length + 1} transformación pendiente
                                            </small>
                                        )}
                                    </div>
                                    <div className="d-flex gap-2">
                            <button
                                            type="button"
                                            className="btn btn-outline-secondary"
                                            onClick={() => {
                                                setShowTransformationModal(false);
                                                setSelectedTransformation(null);
                                                cancelPreview();
                                            }}
                                        >
                                            <i className="bi bi-x me-1"></i>Cancelar
                            </button>
                                        {previewTransformation && (
                            <button
                                                type="button"
                                                className="btn btn-success"
                                                onClick={() => {
                                                    applyPreviewedTransformation();
                                                    setShowTransformationModal(false);
                                                    setSelectedTransformation(null);
                                                }}
                                            >
                                                <i className="bi bi-check me-1"></i>Aplicar Cambios
                            </button>
                                        )}
                                        {!previewTransformation && (
                                            <button
                                                type="button"
                                                className="btn btn-primary"
                                                onClick={() => {
                                                    const transform = transformations.find(t => t.id === selectedTransformation);
                                                    if (transform) {
                                                        showPreview(transform);
                                                    }
                                                }}
                                            >
                                                <i className="bi bi-eye me-1"></i>Ver Preview
                                            </button>
                                        )}
                        </div>
                    </div>
                </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Export Modal */}
            {showExportModal && (
                <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-xl">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">
                                    <i className="bi bi-download me-2"></i>
                                    Exportar Datos - {originalData[currentSheetIndex]?.name}
                                </h5>
                                <button type="button" className="btn-close" onClick={() => setShowExportModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <div className="row">
                                    <div className="col-md-8">
                                        <h6>Vista Previa de Datos</h6>
                                        <div className="border rounded p-2" style={{ maxHeight: '300px', overflow: 'auto' }}>
                                            <table className="table table-sm table-bordered mb-0">
                                                <thead className="table-light">
                                                    <tr>
                                                        {currentColumns.map(header => (
                                                            <th key={header} className="small">{header}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                                    {previewData.slice(0, 5).map((row, index) => (
                                                        <tr key={index}>
                                                            {currentColumns.map(header => (
                                                                <td key={header} className="small">
                                                                    {String(row[header] || '').substring(0, 20)}
                                                                    {String(row[header] || '').length > 20 && '...'}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                                        <div className="mt-2 small text-muted">
                                            Mostrando 5 de {previewData.length} filas • {currentColumns.length} columnas
                </div>
                </div>
                                    <div className="col-md-4">
                                        <h6>Opciones de Exportación</h6>
                                        <div className="d-grid gap-2">
                                            <button
                                                className="btn btn-success"
                                                onClick={exportToExcel}
                                            >
                                                <i className="bi bi-file-earmark-excel me-2"></i>
                                                Exportar a Excel
                                                <br />
                                                <small className="text-muted">
                                                    {originalData.length > 1 ? `${originalData.length} hojas` : 'Una hoja'}
                                                </small>
                                            </button>

                                            <button
                                                className="btn btn-danger"
                                                onClick={exportToPDF}
                                            >
                                                <i className="bi bi-file-earmark-pdf me-2"></i>
                                                Exportar a PDF
                                                <br />
                                                <small className="text-muted">Vista imprimible</small>
                                            </button>

                                            <button
                                                className="btn btn-primary"
                                                onClick={exportToWord}
                                            >
                                                <i className="bi bi-file-earmark-word me-2"></i>
                                                Exportar a Word
                                                <br />
                                                <small className="text-muted">Editable</small>
                                            </button>
            </div>

                                        <div className="mt-3 p-2 bg-light rounded small">
                                            <strong>Información:</strong><br />
                                            • Excel: Mantiene todas las hojas<br />
                                            • PDF: Optimizado para impresión<br />
                                            • Word: Documento editable
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setShowExportModal(false)}
                                >
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Configuration component for individual transformations
const TransformationConfig = ({ transformation, columns, onUpdate }) => {
    const [config, setConfig] = useState(transformation.config);

    const handleConfigChange = (field, value) => {
        const newConfig = { ...config, [field]: value };
        setConfig(newConfig);
        onUpdate({ config: newConfig });
    };

    const handleArrayChange = (field, values) => {
        handleConfigChange(field, values);
    };

    switch (transformation.type) {
        case 'filter':
            return (
                <div className="row g-2">
                    <div className="col-4">
                        <select
                            className="form-select form-select-sm"
                            value={config.column}
                            onChange={(e) => handleConfigChange('column', e.target.value)}
                        >
                            <option value="">Columna</option>
                            {columns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-4">
                        <select
                            className="form-select form-select-sm"
                            value={config.operator}
                            onChange={(e) => handleConfigChange('operator', e.target.value)}
                        >
                            <option value="equals">Igual a</option>
                            <option value="contains">Contiene</option>
                            <option value="startsWith">Empieza con</option>
                            <option value="greaterThan">Mayor que</option>
                            <option value="lessThan">Menor que</option>
                        </select>
                    </div>
                    <div className="col-4">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Valor"
                            value={config.value}
                            onChange={(e) => handleConfigChange('value', e.target.value)}
                        />
                    </div>
                </div>
            );

        case 'sort':
            return (
                <div className="row g-2">
                    <div className="col-8">
                        <select
                            className="form-select form-select-sm"
                            value={config.column}
                            onChange={(e) => handleConfigChange('column', e.target.value)}
                        >
                            <option value="">Columna</option>
                            {columns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-4">
                        <select
                            className="form-select form-select-sm"
                            value={config.direction}
                            onChange={(e) => handleConfigChange('direction', e.target.value)}
                        >
                            <option value="asc">Ascendente</option>
                            <option value="desc">Descendente</option>
                        </select>
                    </div>
                </div>
            );

        case 'formula':
            return (
                <div className="row g-2">
                    <div className="col-6">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Nueva columna"
                            value={config.newColumn}
                            onChange={(e) => handleConfigChange('newColumn', e.target.value)}
                        />
                    </div>
                    <div className="col-6">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Fórmula (ej: columna1 * 2)"
                            value={config.formula}
                            onChange={(e) => handleConfigChange('formula', e.target.value)}
                        />
                    </div>
                    <div className="col-12">
                        <small className="text-muted">
                            Usa nombres de columnas en la fórmula. Ej: precio * 1.21 + 10
                        </small>
                    </div>
                </div>
            );

        case 'split_column':
            return (
                <div className="row g-2">
                    <div className="col-4">
                        <select
                            className="form-select form-select-sm"
                            value={config.column}
                            onChange={(e) => handleConfigChange('column', e.target.value)}
                        >
                            <option value="">Columna</option>
                            {columns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-4">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Separador"
                            value={config.separator}
                            onChange={(e) => handleConfigChange('separator', e.target.value)}
                        />
                    </div>
                    <div className="col-4">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Nueva columna 1"
                            value={config.newColumns[0] || ''}
                            onChange={(e) => {
                                const newCols = [...config.newColumns];
                                newCols[0] = e.target.value;
                                handleConfigChange('newColumns', newCols);
                            }}
                        />
                    </div>
                    <div className="col-4">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Nueva columna 2"
                            value={config.newColumns[1] || ''}
                            onChange={(e) => {
                                const newCols = [...config.newColumns];
                                newCols[1] = e.target.value;
                                handleConfigChange('newColumns', newCols);
                            }}
                        />
                    </div>
                </div>
            );

        case 'merge_columns':
            return (
                <div className="row g-2">
                    <div className="col-6">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Nueva columna"
                            value={config.newColumn}
                            onChange={(e) => handleConfigChange('newColumn', e.target.value)}
                        />
                    </div>
                    <div className="col-6">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Separador"
                            value={config.separator}
                            onChange={(e) => handleConfigChange('separator', e.target.value)}
                        />
                    </div>
                    <div className="col-12">
                        <small className="text-muted">Columnas a unir:</small>
                        <div className="mt-1">
                            {columns.map(col => (
                                <div key={col} className="form-check form-check-inline">
                                    <input
                                        className="form-check-input"
                                        type="checkbox"
                                        id={`merge-${col}`}
                                        checked={config.columns.includes(col)}
                                        onChange={(e) => {
                                            const newCols = e.target.checked
                                                ? [...config.columns, col]
                                                : config.columns.filter(c => c !== col);
                                            handleConfigChange('columns', newCols);
                                        }}
                                    />
                                    <label className="form-check-label small" htmlFor={`merge-${col}`}>
                                        {col}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            );

        case 'rename_column':
            return (
                <div className="row g-2">
                    <div className="col-6">
                        <select
                            className="form-select form-select-sm"
                            value={config.oldName}
                            onChange={(e) => handleConfigChange('oldName', e.target.value)}
                        >
                            <option value="">Columna actual</option>
                            {columns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-6">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Nuevo nombre"
                            value={config.newName}
                            onChange={(e) => handleConfigChange('newName', e.target.value)}
                        />
                    </div>
                </div>
            );

        case 'duplicate_column':
            return (
                <div className="row g-2">
                    <div className="col-6">
                        <select
                            className="form-select form-select-sm"
                            value={config.column}
                            onChange={(e) => handleConfigChange('column', e.target.value)}
                        >
                            <option value="">Columna</option>
                            {columns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-6">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Nombre de copia"
                            value={config.newName}
                            onChange={(e) => handleConfigChange('newName', e.target.value)}
                        />
                    </div>
                </div>
            );

        case 'delete_column':
            return (
                <div className="row g-2">
                    <div className="col-12">
                        <select
                            className="form-select form-select-sm"
                            value={config.column}
                            onChange={(e) => handleConfigChange('column', e.target.value)}
                        >
                            <option value="">Seleccionar columna a eliminar</option>
                            {columns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-12">
                        <div className="alert alert-warning py-2 small">
                            <i className="bi bi-exclamation-triangle me-1"></i>
                            Esta acción no se puede deshacer. La columna será eliminada permanentemente.
                        </div>
                    </div>
                </div>
            );

        case 'filter_rows':
            return (
                <div className="row g-2">
                    <div className="col-4">
                        <select
                            className="form-select form-select-sm"
                            value={config.column}
                            onChange={(e) => handleConfigChange('column', e.target.value)}
                        >
                            <option value="">Columna</option>
                            {columns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-4">
                        <select
                            className="form-select form-select-sm"
                            value={config.operator}
                            onChange={(e) => handleConfigChange('operator', e.target.value)}
                        >
                            <option value="contains">Contiene</option>
                            <option value="equals">Igual a</option>
                            <option value="startsWith">Empieza con</option>
                            <option value="endsWith">Termina con</option>
                        </select>
                    </div>
                    <div className="col-4">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Valor"
                            value={config.value}
                            onChange={(e) => handleConfigChange('value', e.target.value)}
                        />
                    </div>
                    <div className="col-12">
                        <div className="form-check">
                            <input
                                className="form-check-input"
                                type="checkbox"
                                id="case-sensitive-filter"
                                checked={config.caseSensitive}
                                onChange={(e) => handleConfigChange('caseSensitive', e.target.checked)}
                            />
                            <label className="form-check-label small" htmlFor="case-sensitive-filter">
                                Distinguir mayúsculas/minúsculas
                            </label>
                        </div>
                    </div>
                </div>
            );

        case 'find_replace':
            return (
                <div className="row g-2">
                    <div className="col-4">
                        <select
                            className="form-select form-select-sm"
                            value={config.column}
                            onChange={(e) => handleConfigChange('column', e.target.value)}
                        >
                            <option value="">Columna</option>
                            {columns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-4">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Buscar"
                            value={config.find}
                            onChange={(e) => handleConfigChange('find', e.target.value)}
                        />
                    </div>
                    <div className="col-4">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Reemplazar"
                            value={config.replace}
                            onChange={(e) => handleConfigChange('replace', e.target.value)}
                        />
                    </div>
                    <div className="col-12">
                        <div className="d-flex gap-2">
                            <div className="form-check">
                                <input
                                    className="form-check-input"
                                    type="checkbox"
                                    id="case-sensitive-replace"
                                    checked={config.caseSensitive}
                                    onChange={(e) => handleConfigChange('caseSensitive', e.target.checked)}
                                />
                                <label className="form-check-label small" htmlFor="case-sensitive-replace">
                                    Distinguir mayúsculas
                                </label>
                            </div>
                            <div className="form-check">
                                <input
                                    className="form-check-input"
                                    type="checkbox"
                                    id="regex-replace"
                                    checked={config.regex}
                                    onChange={(e) => handleConfigChange('regex', e.target.checked)}
                                />
                                <label className="form-check-label small" htmlFor="regex-replace">
                                    Usar expresiones regulares
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            );

        case 'trim_whitespace':
            return (
                <div className="row g-2">
                    <div className="col-4">
                        <select
                            className="form-select form-select-sm"
                            value={config.trimType}
                            onChange={(e) => handleConfigChange('trimType', e.target.value)}
                        >
                            <option value="both">Ambos lados</option>
                            <option value="left">Izquierda</option>
                            <option value="right">Derecha</option>
                        </select>
                    </div>
                    <div className="col-12">
                        <small className="text-muted">Columnas a limpiar:</small>
                        <div className="mt-1">
                            {columns.map(col => (
                                <div key={col} className="form-check form-check-inline">
                                    <input
                                        className="form-check-input"
                                        type="checkbox"
                                        id={`trim-${col}`}
                                        checked={config.columns.includes(col)}
                                        onChange={(e) => {
                                            const newCols = e.target.checked
                                                ? [...config.columns, col]
                                                : config.columns.filter(c => c !== col);
                                            handleConfigChange('columns', newCols);
                                        }}
                                    />
                                    <label className="form-check-label small" htmlFor={`trim-${col}`}>
                                        {col}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            );

        case 'change_case':
            return (
                <div className="row g-2">
                    <div className="col-4">
                        <select
                            className="form-select form-select-sm"
                            value={config.caseType}
                            onChange={(e) => handleConfigChange('caseType', e.target.value)}
                        >
                            <option value="uppercase">MAYÚSCULAS</option>
                            <option value="lowercase">minúsculas</option>
                            <option value="titlecase">Título</option>
                        </select>
                    </div>
                    <div className="col-12">
                        <small className="text-muted">Columnas a cambiar:</small>
                        <div className="mt-1">
                            {columns.map(col => (
                                <div key={col} className="form-check form-check-inline">
                                    <input
                                        className="form-check-input"
                                        type="checkbox"
                                        id={`case-${col}`}
                                        checked={config.columns.includes(col)}
                                        onChange={(e) => {
                                            const newCols = e.target.checked
                                                ? [...config.columns, col]
                                                : config.columns.filter(c => c !== col);
                                            handleConfigChange('columns', newCols);
                                        }}
                                    />
                                    <label className="form-check-label small" htmlFor={`case-${col}`}>
                                        {col}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            );

        case 'extract_text':
            return (
                <div className="row g-2">
                    <div className="col-4">
                        <select
                            className="form-select form-select-sm"
                            value={config.column}
                            onChange={(e) => handleConfigChange('column', e.target.value)}
                        >
                            <option value="">Columna origen</option>
                            {columns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-4">
                        <input
                            type="number"
                            className="form-control form-control-sm"
                            placeholder="Posición inicial"
                            value={config.startPosition}
                            onChange={(e) => handleConfigChange('startPosition', parseInt(e.target.value) || 0)}
                        />
                    </div>
                    <div className="col-4">
                        <input
                            type="number"
                            className="form-control form-control-sm"
                            placeholder="Longitud"
                            value={config.length}
                            onChange={(e) => handleConfigChange('length', parseInt(e.target.value) || 10)}
                        />
                    </div>
                    <div className="col-12">
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="Nombre nueva columna"
                            value={config.newColumn}
                            onChange={(e) => handleConfigChange('newColumn', e.target.value)}
                        />
                    </div>
                </div>
            );

        case 'split_rows':
            return (
                <div className="row g-2">
                    <div className="col-12">
                        <label className="form-label small">Columna a dividir:</label>
                        <select
                            className="form-select form-select-sm"
                            value={config.column}
                            onChange={(e) => handleConfigChange('column', e.target.value)}
                        >
                            <option value="">Seleccione columna</option>
                            {columns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>
                    <div className="col-12">
                        <div className="alert alert-info small mb-0 mt-2">
                            <i className="bi bi-info-circle me-1"></i>
                            Esta transformación dividirá cada línea dentro de la celda en una fila separada.
                            Las líneas vacías serán omitidas.
                        </div>
                    </div>
                </div>
            );


        default:
            return (
                <div className="text-muted small">
                    Configuración no disponible para este tipo de transformación.
                </div>
            );
    }
};

export default Canvas;