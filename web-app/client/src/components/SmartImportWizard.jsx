import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import API_URL from '../api';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import { useCompany } from '../context/CompanyContext';
import { AccountPlanProfile } from '../utils/AccountPlanProfile';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const ACCOUNT_TYPES = [
    { value: 'Activo', label: 'Activo', icon: 'bi-cash-stack', color: 'success' },
    { value: 'Pasivo', label: 'Pasivo', icon: 'bi-graph-down', color: 'danger' },
    { value: 'Patrimonio', label: 'Patrimonio', icon: 'bi-bank', color: 'primary' },
    { value: 'Reguladora', label: 'Reguladora', icon: 'bi-scales', color: 'secondary' },
    { value: 'Orden', label: 'Orden', icon: 'bi-card-list', color: 'info' },
    { value: 'Contingente', label: 'Contingente', icon: 'bi-question-circle', color: 'secondary' },
    { value: 'Costo', label: 'Costo', icon: 'bi-box-seam', color: 'warning' },
    { value: 'Gasto', label: 'Gasto', icon: 'bi-credit-card', color: 'danger' },
    { value: 'Ingreso', label: 'Ingreso', icon: 'bi-arrow-up-circle', color: 'success' },
    { value: 'Resultado', label: 'Resultado', icon: 'bi-graph-up', color: 'primary' },
    { value: 'Otra cuenta de resultados', label: 'Otra cuenta de resultados', icon: 'bi-bar-chart', color: 'dark' }
];
// Función universal para calcular niveles que funciona para TODOS los formatos
const getUniversalLevel = (code, analysis, config) => {
    // 1) If user explicitly set a custom lengths config and it's valid, use it.
    const isValidCustom = config && config.useCustomLengths === true && Array.isArray(config.levelLengths) && config.levelLengths.length > 0 && config.levelLengths.every(n => Number.isInteger(n) && n > 0);
    if (isValidCustom) {
        return AccountPlanProfile.calculateLevel(code, config);
    }

    // 2) If an `analysis` object is available (from AccountPlanProfile.analyze),
    // normalize it into a config and use that.
    if (analysis && (analysis.segments || analysis.levelInsights)) {
        // If user provided a partial config, merge safely so user overrides
        // separator preferences but lengths come from analysis unless explicitly set.
        const merged = config ? AccountPlanProfile.mergeConfigWithAnalysis(config, analysis) : AccountPlanProfile.toConfigFromAnalysis(analysis);
        return AccountPlanProfile.calculateLevel(code, merged);
    }

    // 3) If a partial config was provided (e.g. hasSeparator but not custom lengths),
    // use it only when it contains usable length info; otherwise fallback.
    if (config && Array.isArray(config.levelLengths) && config.levelLengths.length > 0 && config.levelLengths.every(n => Number.isInteger(n) && n > 0)) {
        return AccountPlanProfile.calculateLevel(code, config);
    }

    // 4) Final fallback: use AccountPlanProfile defaults.
    return AccountPlanProfile.calculateLevel(code, AccountPlanProfile.getDefaultProfile());
};
function SmartImportWizard({ onClose, onSuccess }) {
    const { selectedCompany } = useCompany();
    const [step, setStep] = useState(1);
    const [file, setFile] = useState(null);
    const [workbook, setWorkbook] = useState(null);
    const [error, setError] = useState('');
    const [sheets, setSheets] = useState([]);
    const [selectedSheet, setSelectedSheet] = useState('');
    const [range, setRange] = useState({ startRow: 2, endRow: 1000, startCol: 'A', endCol: 'Z' });
    const [pdfRange, setPdfRange] = useState({ startPage: 2, endPage: null });
    const [fileType, setFileType] = useState('excel');
    const [originalData, setOriginalData] = useState([]);
    const [rawData, setRawData] = useState([]);
    const [columnMapping, setColumnMapping] = useState({ code: 0, name: 1, type: 2 });
    const [multiColumnMode, setMultiColumnMode] = useState(false);
    const [codeColumns, setCodeColumns] = useState([]);
    const [structureConfig, setStructureConfig] = useState(AccountPlanProfile.getDefaultProfile());
    const [groupRules, setGroupRules] = useState([]);
    const [level1Accounts, setLevel1Accounts] = useState([]);
    const [previewData, setPreviewData] = useState([]);
    const [planAnalysis, setPlanAnalysis] = useState(null);
    const [testCode, setTestCode] = useState('');
    const [showRefinePanel, setShowRefinePanel] = useState(false);
    const [selectedIds, setSelectedIds] = useState([]);
    const [importing, setImporting] = useState(false);
    const [importProgress, setImportProgress] = useState(0);
    const [importCancelToken, setImportCancelToken] = useState(null);
    const [newRulePrefix, setNewRulePrefix] = useState('');
    const [newRuleType, setNewRuleType] = useState('Activo');
    const [showAddRule, setShowAddRule] = useState(false);
    const [bulkType, setBulkType] = useState('Activo');
    const [bulkLevel, setBulkLevel] = useState(1);
    const [profileLoaded, setProfileLoaded] = useState(false);
    const [showProfileLibrary, setShowProfileLibrary] = useState(false);
    // Estado para paginación (Elimina el lag de renderizado en planes grandes)
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 100;

    // generateGroupRulesFromLevel1 is implemented later in this file with enhanced logging and handling;
    // the detailed implementation below will be used to avoid redeclaring the same variable.

    const loadSheetData = () => {
        try {
            if (!workbook) throw new Error("El archivo no se ha cargado correctamente en memoria.");
            // Usamos el workbook del estado en lugar de leer 'file' de nuevo incorrectamente
            const worksheet = workbook.Sheets[selectedSheet];

            // More robust row count using sheet metadata
            const sheetRef = worksheet['!ref'];
            if (!sheetRef) {
                return setError('La hoja de Excel está vacía o no tiene un rango definido.');
            }
            const decodedRange = XLSX.utils.decode_range(sheetRef);
            const trueEndRow = decodedRange.e.r + 1; // decode_range is 0-indexed for rows

            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', blankrows: true, range: sheetRef });
            if (jsonData.length === 0) return setError('Hoja vacía');

            const startRowIdx = Math.max(0, range.startRow - 1);
            const endRowIdx = trueEndRow;
            const startColIdx = colToIndex(range.startCol);
            const endColIdx = colToIndex(range.endCol || 'Z');

            const slicedData = [];
            for (let i = startRowIdx; i < endRowIdx; i++) {
                if (i >= jsonData.length) break;
                const row = jsonData[i] || [];
                const rowArray = Array.isArray(row) ? row : [];
                slicedData.push({ excelRow: i + 1, data: rowArray.slice(startColIdx, endColIdx + 1) });
            }

            setOriginalData(slicedData); // Store unmerged data

            const mergedData = detectAndMergeColumns(slicedData);

            // Determine if PUCT format was processed
            let isPUCTProcessed = false;
            if (mergedData.length > 0) {
                // Check if the data looks like PUCT format (first column has 9-digit codes)
                const first9DigitRow = mergedData.find(r => r.data[0] && String(r.data[0]).match(/^\d{9}/));
                // Also check for 1-digit codes that might need PUCT processing
                const first1DigitRow = mergedData.find(r => r.data[0] && String(r.data[0]).match(/^[1-9]$/));

                if (first9DigitRow) {
                    isPUCTProcessed = true;
                    console.log('Detected existing 9-digit PUCT codes');
                } else if (first1DigitRow && mergedData.length > 5) {
                    // If we have 1-digit codes and multiple rows, likely need PUCT processing
                    isPUCTProcessed = true;
                    console.log('Detected 1-digit codes, assuming PUCT format needs processing');
                }
            }

            // Generate group rules from detected level 1 accounts
            if (mergedData && mergedData.length > 0) {
                setRawData(mergedData);
                generateGroupRulesFromLevel1();

                // Find first valid data row to set range
                let firstValidIndex = 0;
                for (let i = 0; i < mergedData.length; i++) {
                    const code = String(mergedData[i].data[columnMapping.code] || '').trim();
                    if (code && code.match(/^\d/)) {
                        firstValidIndex = i;
                        break;
                    }
                }

                // Set both start and end row correctly (only if not already configured by user)
                setRange(prev => {
                    // Don't override if user has already set custom range
                    if (prev.startRow !== 1 || prev.endRow !== 1000) {
                        return prev; // Keep user's custom range
                    }
                    return {
                        ...prev,
                        startRow: firstValidIndex + 1,
                        endRow: mergedData.length // Set to actual data length
                    };
                });
            }

            setRawData(mergedData);
            setStep(3);
        } catch (err) {
            setError('Error: ' + err.message);
        }
    };



    const analyzeStructure = () => {
        if (multiColumnMode && codeColumns.length > 1) {
            // Manual merge logic - ALWAYS use originalData if available to avoid double-merge
            const sourceData = originalData.length > 0 ? originalData : rawData;

            const newRawData = sourceData.map(row => {
                const codeParts = codeColumns.map((colIdx, idx) => {
                    const val = row.data[colIdx];
                    let str = (val !== undefined && val !== null) ? String(val).trim() : '';
                    // Apply padding for PUCT if 5 columns
                    if (codeColumns.length === 5) {
                        if (idx === 0 || idx === 1 || idx === 2) {
                            str = str.padStart(1, '0');
                        } else if (idx === 3 || idx === 4) {
                            str = str.padStart(3, '0');
                        }
                    }
                    return str;
                });
                const code = codeParts.join('');
                const nameVal = row.data[columnMapping.name];
                return { ...row, data: [code, nameVal] };
            });

            setRawData(newRawData);
            setColumnMapping({ code: 0, name: 1 });

            // Better configuration seeding from columns
            const detectedLevels = codeColumns.length;
            setStructureConfig(prev => ({
                ...prev,
                hasSeparator: false,
                separator: '',
                useCustomLengths: true,
                levelCount: detectedLevels, // Use actual column count
                // Generate default lengths based on column index (cumulative)
                levelLengths: Array.from({ length: detectedLevels }, (_, i) => {
                    // Try to guess length from data if possible, otherwise default heuristics
                    if (originalData[0] && originalData[0].data[codeColumns[i]]) {
                        // This is tricky without analyzing all rows, but safe defaults work
                        const val = String(originalData[0].data[codeColumns[i]]).trim();
                        // Logic for cumulative length:
                        // If column 0 is length 1, cumulative is 1.
                        // If col 1 is length 2, cumulative is 3. 
                        // We need a robust guess or just use simple defaults?
                        // For now, let's trust the PUCT 5-col default IF it is exactly 5 cols
                        if (detectedLevels === 5) return [1, 3, 5, 8, 11][i];
                    }
                    return (i + 1) * 2; // Fallback
                })
            }));

            // Special override for known 5-col PUCT pattern
            if (codeColumns.length === 5) {
                setStructureConfig(prev => ({
                    ...prev,
                    levelCount: 5,
                    levelLengths: [1, 2, 3, 6, 9] // 1, +1(2), +1(3), +3(6), +3(9)
                }));
            }
        }
        setStep(3.5);
    };



    const handleFileUpload = async (e) => {
        const uploadedFile = e.target.files[0];
        if (!uploadedFile) return;

        const fileName = uploadedFile.name.toLowerCase();
        const isExcel = fileName.match(/\.(xlsx|xls|xlsm)$/);
        const isPDF = fileName.match(/\.pdf$/);

        if (!isExcel && !isPDF) {
            setError('Por favor, sube un archivo Excel (.xlsx, .xls, .xlsm) o PDF (.pdf)');
            return;
        }

        setFile(uploadedFile);
        setError('');
        setWorkbook(null);

        if (isPDF) {
            setFileType('pdf');
            await parsePDFFile(uploadedFile);
        } else {
            setFileType('excel');
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const wb = XLSX.read(evt.target.result, { type: 'binary' });
                    setWorkbook(wb); // Guardamos el workbook en memoria
                    setSheets(wb.SheetNames);
                    if (wb.SheetNames.length > 0) setSelectedSheet(wb.SheetNames[0]);
                    setStep(2);
                } catch (err) { setError('Error al leer el archivo Excel'); }
            };
            reader.readAsBinaryString(uploadedFile);
        }
    };

    const parsePDFFile = async (file) => {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

            let fullText = '';
            // Extract text from configured page range
            const startPage = pdfRange.startPage || 2;
            const endPage = pdfRange.endPage || pdf.numPages;
            for (let pageNum = startPage; pageNum <= Math.min(endPage, pdf.numPages); pageNum++) {
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();

                // Group text items by horizontal lines (Y coordinate)
                const lineGroups = {};
                textContent.items.forEach(item => {
                    const y = Math.round(item.transform[5]); // Y coordinate
                    if (!lineGroups[y]) {
                        lineGroups[y] = [];
                    }
                    lineGroups[y].push(item);
                });

                // Reconstruct lines by combining items on same horizontal line
                const pageLines = Object.keys(lineGroups)
                    .sort((a, b) => parseFloat(b) - parseFloat(a)) // Top to bottom
                    .map(y => {
                        const lineItems = lineGroups[y].sort((a, b) => a.transform[4] - b.transform[4]); // Left to right
                        return lineItems.map(item => item.str).join('').trim();
                    })
                    .filter(line => line.length > 0);

                fullText += pageLines.join('\n') + '\n';
            }

            // Parse the text to extract account codes and names
            const parsedData = parsePDFText(fullText);

            console.log('PDF parsing result:', {
                totalTextLength: fullText.length,
                parsedAccounts: parsedData.length,
                firstFewAccounts: parsedData.slice(0, 5)
            });

            if (parsedData.length === 0) {
                setError('No se detectaron cuentas en el PDF. Verifica el formato.');
                return;
            }

            // Convert to rawData format (same structure as Excel)
            const rawDataFormatted = parsedData.map((item, idx) => ({
                excelRow: idx + 1,
                data: [item.code, item.name]
            }));

            setRawData(rawDataFormatted);
            setSheets(['PDF Import']);
            setSelectedSheet('PDF Import');
            setColumnMapping({ code: 0, name: 1 });

            // Set range to include all parsed accounts (no 100 limit for PDFs)
            setRange(prev => ({
                ...prev,
                startRow: 1,
                endRow: rawDataFormatted.length
            }));

            // Configure structure for ASFI format if detected
            // Use universal structure proposer (detects digit-only lengths)
            if (parsedData.length > 0 && parsedData.some(acc => acc.code.includes('.') && /^\d{3}\.\d{2}/.test(acc.code))) {
                console.log('Detected ASFI format, proposing structure via AccountPlanProfile');
                const proposedProp = AccountPlanProfile.proposeStructure(parsedData);
                setStructureConfig(proposedProp);
            }

            // Generate group rules for PDFs
            generateGroupRulesFromLevel1();

            setStep(step === 2 ? 3 : 2); // If already in step 2, go to step 3; otherwise go to step 2
        } catch (err) {
            setError('Error al procesar el PDF: ' + err.message);
        }
    };

    const parsePDFText = (text) => {
        console.log('=== PDF TEXT EXTRACTION DEBUG ===');
        console.log('Total text length:', text.length);
        console.log('Sample text (lines 50-70):', text.split('\n').slice(50, 70).join('\n'));

        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        console.log('Total lines after filtering:', lines.length);
        console.log('Sample lines (50-70):', lines.slice(50, 70));

        const accounts = [];

        // ASFI-specific patterns for NNN.NN format (including codes with letters and parentheses)
        // ASFI-specific patterns imported from universal profile
        const patterns = AccountPlanProfile.ASFI_PATTERNS || [];

        // Process lines, focusing on account listings
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Skip obvious non-account lines
            if (line.match(/^(página|page|asfi|banco|central|índice|contenido|plan de cuentas|capítulo|sección|artículo|anexo|título)/i)) continue;
            if (line.match(/^\d+$/) && line.length <= 3) continue; // Skip isolated page numbers
            if (line.length > 300 || line.length < 3) continue; // Skip very long or short lines (increased limit for long names)

            console.log(`Checking line ${i}: '${line}'`);

            // Try each pattern
            let matched = false;
            for (const patternIdx in patterns) {
                const pattern = patterns[patternIdx];
                const match = line.match(pattern);
                if (match) {
                    let code = match[1].trim();
                    let name = match[2] ? match[2].trim() : '';

                    // Clean up name
                    name = name.replace(/\s+/g, ' ').trim();

                    console.log(`✓ Pattern ${patternIdx} matched line: '${line}'`);
                    console.log(`  Code: '${code}', Name: '${name}'`);

                    // Add account if we have both code and name
                    if (code && name && name.length > 2) { // Name should be meaningful
                        accounts.push({ code, name });
                        console.log(`✓ Added account: ${code} -> ${name}`);
                        matched = true;
                        break; // Stop trying other patterns
                    } else {
                        console.log(`⚠ Skipped: code='${code}', name='${name}' (too short)`);
                    }
                }
            }

            if (!matched && line.match(/\d{3}\.\d{2}/)) {
                console.log(`⚠ No pattern matched for potential account line: '${line}'`);
            }
        }

        console.log('Total accounts found:', accounts.length);
        console.log('Sample accounts:', accounts.slice(0, 5));
        console.log('=== END PDF DEBUG ===');

        return accounts;
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



    // Enhanced PUCT-specific processing
    const processPUCTFormat = (data) => {
        console.log('=== processPUCTFormat called with', data.length, 'rows ===');
        if (!data || data.length < 2) return data;

        // Check if we have single-digit codes that need expansion
        const firstRow = data[0];
        const firstCode = String(firstRow.data[0] || '').trim();
        const hasSingleDigitCodes = firstCode.match(/^[1-9]$/);

        console.log('First code:', firstCode, 'hasSingleDigitCodes:', hasSingleDigitCodes);

        // Force correct PUCT configuration
        setStructureConfig({
            hasSeparator: false,
            separator: '',
            smartZeroCheck: false,
            useCustomLengths: false,
            levelCount: 5,
            levelLengths: [1, 2, 3, 6, 9] // PUCT: 5 levels with cumulative lengths 1,2,3,6,9
        });
        setMultiColumnMode(false);
        setColumnMapping({ code: 0, name: 1 }); // Update mapping for merged data

        return data.filter(row => {
            // Skip header rows and empty rows
            const c = String(row.data[0] || '').trim();
            const g = String(row.data[1] || '').trim();
            const name = String(row.data[5] || '').trim();

            // Skip header row (contains letter codes)
            const isHeaderRow = ['C', 'G', 'SG', 'CP', 'CA'].includes(c.toUpperCase()) ||
                ['C', 'G', 'SG', 'CP', 'CA'].includes(g.toUpperCase());

            // Must have at least one numeric segment (check first few columns)
            const hasNumericData = c.match(/^\d+$/) || g.match(/^\d+$/);

            // Keep row if it has numeric data, is not header, and has a name
            return !isHeaderRow && hasNumericData && name.length > 0;
        }).map(row => {
            let c, g, sg, cp, ca, name;

            // Re-extract for mapping
            const firstCode = String(data[0].data[0] || '').trim();
            const hasSingleDigitCodes = firstCode.match(/^[1-9]$/);

            if (hasSingleDigitCodes) {
                // Handle single-digit codes: assume format is [single_digit_code, name]
                c = String(row.data[0] || '').trim();
                g = '0';
                sg = '0';
                cp = '000';
                ca = '000';
                name = String(row.data[1] || '').trim();
            } else {
                // Handle multi-column PUCT format: [C, G, SG, CP, CA, name, ...]
                c = String(row.data[0] || '').trim();
                g = String(row.data[1] || '').trim();
                sg = String(row.data[2] || '').trim();
                cp = String(row.data[3] || '').trim();
                ca = String(row.data[4] || '').trim();
                name = String(row.data[5] || '').trim();
            }

            // Build 9-digit PUCT code with proper padding
            let code = '';
            code += (c || '0').padStart(1, '0'); // C: always 1 digit
            code += (g || '0').padStart(1, '0'); // G: always 1 digit
            code += (sg || '0').padStart(1, '0'); // SG: always 1 digit
            code += (cp || '000').padStart(3, '0'); // CP: always 3 digits
            code += (ca || '000').padStart(3, '0'); // CA: always 3 digits

            // Ensure exactly 9 digits
            code = code.padEnd(9, '0').substring(0, 9);

            // Explicitly get name from column 5 (standard PUCT name column) or col 1 for single digit
            const nameVal = name;

            // Construct new data: [code, name, ...rest]
            let otherData;
            if (hasSingleDigitCodes) {
                otherData = row.data.slice(2);
            } else {
                otherData = row.data.filter((_, idx) => idx !== 5 && idx > 4);
            }
            const newData = [code, nameVal, ...otherData];

            return { ...row, data: newData };
        });
    };

    const processDashFormat = (data) => {
        if (!data || data.length < 2) return data;

        setStructureConfig({
            hasSeparator: true,
            separator: '-',
            smartZeroCheck: false,
            useCustomLengths: false,
            levelCount: 3,
            levelLengths: [3, 5, 7] // Dash format: 3 levels with cumulative DIGIT lengths (excluding separators)
        });
        setMultiColumnMode(false);
        setColumnMapping({ code: 0, name: 1 }); // Code in column 0, name in column 1

        return data.filter(row => {
            // Skip header rows
            const code = String(row.data[0] || '').trim();
            const desc = String(row.data[1] || '').trim();

            // Must have a dash-separated code and description, not header text
            return code && code.match(/^\d{3}-\d{2}-\d{2}$/) &&
                desc && !['CODIGO', 'DESCRIPCION', 'TIPO'].includes(desc.toUpperCase());
        }).map(row => {
            const code = String(row.data[0] || '').trim();
            const name = String(row.data[1] || '').trim();
            const type = String(row.data[2] || '').trim();

            // Keep the code as-is (it's already in the correct format with dashes)
            const newData = [code, name, type];
            return { ...row, data: newData };
        });
    };

    const detectAndMergeColumns = (data) => {
        if (!data || data.length < 2) return data;

        // Check for different accounting formats
        const sampleRows = data.slice(0, Math.min(15, data.length)); // Check first 15 rows
        let isPUCTFormat = false;
        let isDashFormat = false; // New format with dashes like "100-00-00"
        let maxNumericCols = 0;

        for (const row of sampleRows) {
            let numericCols = 0;
            let hasHeaderPattern = false;
            let hasDashCode = false;

            for (let i = 0; i < Math.min(10, row.data.length); i++) {
                const str = String(row.data[i] || '').trim();

                // Check for dash-separated codes like "100-00-00"
                if (str && str.match(/^\d{3}-\d{2}-\d{2}$/)) {
                    hasDashCode = true;
                }

                if (str && str.match(/^\d+N?$/i)) {
                    numericCols++;
                }
                // Check for header pattern (PUCT style)
                if (i < 5 && ['C', 'G', 'SG', 'CP', 'CA'].includes(str.toUpperCase())) {
                    hasHeaderPattern = true;
                }
                // Check for header pattern (dash format)
                if (i < 3 && ['CODIGO', 'DESCRIPCION', 'TIPO'].includes(str.toUpperCase())) {
                    hasHeaderPattern = true;
                }
            }

            // Skip header row for detection
            if (!hasHeaderPattern) {
                maxNumericCols = Math.max(maxNumericCols, numericCols);

                // Detect dash format (e.g., "100-00-00")
                if (hasDashCode) {
                    isDashFormat = true;
                }

                // Specific PUCT pattern: exactly 5 columns with hierarchical structure
                if (numericCols === 5) {
                    const c = String(row.data[0] || '').trim();
                    const g = String(row.data[1] || '').trim();
                    const sg = String(row.data[2] || '').trim();
                    const cp = String(row.data[3] || '').trim();
                    const ca = String(row.data[4] || '').trim();

                    // Validate PUCT structure: CP requires C, G, SG
                    if (cp && c && g && sg) {
                        isPUCTFormat = true;
                        console.log('Detected PUCT format: 5 columns with C, G, SG, CP, CA structure');
                    }
                }

                // Alternative PUCT detection: check for single digit codes in any column
                if (!isPUCTFormat) {
                    for (let i = 0; i < Math.min(5, row.data.length); i++) {
                        const cellValue = String(row.data[i] || '').trim();
                        if (cellValue.match(/^[1-9]$/)) {
                            isPUCTFormat = true;
                            console.log('Detected PUCT format: single digit codes, will expand to 9 digits');
                            break;
                        }
                    }
                }
            }
        }

        // Process PUCT format specifically
        if (isPUCTFormat) {
            console.log('Detectado formato PUCT (9 dígitos continuos)');
            return processPUCTFormat(data);
        }

        // Process dash format (e.g., "100-00-00")
        if (isDashFormat) {
            console.log('Detectado formato con guiones (ej: 100-00-00)');
            return processDashFormat(data);
        }

        // Fallback for other multi-column formats
        if (maxNumericCols >= 2) {
            console.log(`Se detectaron ${maxNumericCols} columnas numéricas. Procesando formato genérico.`);
            setStructureConfig(prev => ({
                ...prev,
                hasSeparator: false,
                levelCount: Math.min(maxNumericCols, 5),
                levelLengths: Array.from({ length: Math.min(maxNumericCols, 5) }, (_, i) => (i + 1) * 2),
            }));
            return data;
        }

        return data;
    };

    const autoDetectColumns = (data) => {
        if (data.length === 0) return;
        const headers = data[0];
        const mapping = { code: '', name: '', type: '' };
        headers.forEach((header, index) => {
            const h = String(header || '').toLowerCase().trim();
            if (h.match(/(código|codigo|code|cta)/)) mapping.code = index;
            else if (h.match(/(nombre|name|descripción)/)) mapping.name = index;
            else if (h.match(/(tipo|type|naturaleza)/)) mapping.type = index;
        });
        if (mapping.code === '' && headers.length > 0) mapping.code = 0;
        if (mapping.name === '' && headers.length > 1) mapping.name = 1;
        setColumnMapping(mapping);
    };



    const calculateLevel = (code) => {
        return AccountPlanProfile.calculateLevel(code, structureConfig);
    };

    const calculateParent = (code) => {
        return AccountPlanProfile.calculateParent(code, structureConfig);
    };



    // Determine type from name only (without using existing group rules)
    const determineTypeFromNameOnly = (name) => {
        const n = String(name).toLowerCase();

        // Priority: specific account group names (most specific first)
        if (n.includes('otra cuenta') || n.includes('otras cuenta') || n.includes('otra resultad') || n.includes('otras resultad')) {
            return 'Otra cuenta de resultados';
        }
        if (n.match(/(resultado del ejercicio|perdidas y ganancias|resultado neto|utilidad del ejercicio|deficit|superavit)/)) {
            return 'Resultado';
        }

        // Regulatory accounts
        if (n.match(/(depreciacion acumulada|amortizacion acumulada|valuacion|provision|deterioro|reguladora|cuentas reguladora)/)) {
            return 'Reguladora';
        }

        // Contingent accounts (higher priority)
        if (n.match(/(contingente|contingentes)/)) {
            return 'Contingente';
        }

        // Order accounts
        if (n.match(/(cuentas de orden|garantias|bienes en custodia|orden)/)) {
            return 'Orden';
        }

        // Cost accounts
        if (n.match(/(cuentas de costo|costo|costos|mercaderia|compras|inventario inicial|inventario final)/)) {
            return 'Costo';
        }

        // Patrimony accounts
        if (n.match(/(capital|aportes|reserva|utilidades retenidas|patrimonio|resultados acumulados)/)) {
            return 'Patrimonio';
        }

        // Income accounts
        if (n.match(/(ingreso|ingresos|venta|ventas|ganancia|productos|recursos|devengado)/)) {
            return 'Ingreso';
        }

        // Expense accounts
        if (n.match(/(gasto|gastos|egreso|egresos|sueldo|alquiler|honorarios|servicios|cargas|impuestos|mantenimiento|operacion)/)) {
            return 'Gasto';
        }

        // Liability accounts
        if (n.match(/(pagar|proveedor|deuda|pasivo|pasivos|obligaciones|retenciones)/)) {
            return 'Pasivo';
        }

        // Asset accounts (lowest priority)
        if (n.match(/(caja|banco|cobrar|activo|activos|disponible|exigible|realizable|inversiones|bienes|propiedad)/)) {
            return 'Activo';
        }

        // If still no match, try partial matches
        if (n.includes('activo')) return 'Activo';
        if (n.includes('pasivo')) return 'Pasivo';
        if (n.includes('patrimonio')) return 'Patrimonio';
        if (n.includes('ingreso')) return 'Ingreso';
        if (n.includes('gasto') || n.includes('egreso')) return 'Gasto';
        if (n.includes('costo')) return 'Costo';
        if (n.includes('reguladora')) return 'Reguladora';
        if (n.includes('orden')) return 'Orden';
        if (n.includes('resultado')) return 'Resultado';

        // Final fallback - should not happen for level 1 accounts
        console.warn(`Could not determine type for account name: "${name}"`);
        return 'Activo';
    };

    const determineType = (code, name) => {
        const c = String(code).trim();
        // First try to match with defined group rules
        const match = groupRules.filter(r => c.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
        if (match) return { type: match.type, confidence: 100 };

        const n = String(name).toLowerCase();

        // Expanded keyword matching
        if (n.match(/(depreciacion acumulada|amortizacion acumulada|valuacion|provision|deterioro|reguladora)/)) return { type: 'Reguladora', confidence: 85 };
        if (n.match(/(resultado del ejercicio|perdidas y ganancias|resultado neto|utilidad del ejercicio|deficit|superavit)/)) return { type: 'Resultado', confidence: 85 };
        if (n.match(/(contingente|contingentes)/)) return { type: 'Contingente', confidence: 80 };
        if (n.match(/(cuentas de orden|garantias|bienes en custodia|orden)/)) return { type: 'Orden', confidence: 80 };
        if (n.match(/(capital|aportes|reserva|utilidades retenidas|patrimonio|resultados acumulados)/)) return { type: 'Patrimonio', confidence: 80 };
        if (n.match(/(ingreso|venta|ganancia|productos|recursos|devengado)/)) return { type: 'Ingreso', confidence: 75 };
        if (n.match(/(costo|mercaderia|compras|inventario inicial|inventario final)/)) return { type: 'Costo', confidence: 75 };
        if (n.match(/(gasto|sueldo|alquiler|honorarios|servicios|cargas|impuestos|mantenimiento)/)) return { type: 'Gasto', confidence: 75 };
        if (n.match(/(pagar|proveedor|deuda|pasivo|obligaciones|retenciones)/)) return { type: 'Pasivo', confidence: 70 };
        if (n.match(/(caja|banco|cobrar|activo|disponible|exigible|realizable|inversiones|bienes|propiedad)/)) return { type: 'Activo', confidence: 70 };

        // Fallback to first digit if name matching fails (works for both formats)
        const firstDigit = c.charAt(0);
        if (firstDigit === '1') return { type: 'Activo', confidence: 60 };
        if (firstDigit === '2') return { type: 'Pasivo', confidence: 60 };
        if (firstDigit === '3') return { type: 'Patrimonio', confidence: 60 };
        // FIX: Mapeo estándar comercial (más común) como fallback
        if (firstDigit === '4') return { type: 'Ingreso', confidence: 50 };
        if (firstDigit === '5') return { type: 'Gasto', confidence: 50 };
        if (firstDigit === '6') return { type: 'Costo', confidence: 50 };
        if (firstDigit === '7') return { type: 'Orden', confidence: 40 };
        if (firstDigit === '8') return { type: 'Orden', confidence: 40 };
        if (firstDigit === '9') return { type: 'Orden', confidence: 40 };

        return { type: 'Activo', confidence: 50 };
    };

    const generateGroupRulesFromLevel1 = () => {
        console.log('=== generateGroupRulesFromLevel1 called ===');
        console.log('rawData length:', rawData.length);
        console.log('columnMapping:', columnMapping);
        console.log('First few rawData entries:', rawData.slice(0, 3).map(r => ({ code: r.data[columnMapping.code], name: r.data[columnMapping.name] })));

        // Store level 1 accounts for display
        const foundLevel1Accounts = [];
        console.log('rawData length:', rawData.length);
        console.log('columnMapping:', columnMapping);
        console.log('Current groupRules:', groupRules.map(r => `${r.prefix} -> ${r.type}`));

        if (rawData.length === 0) {
            console.log('No rawData, returning');
            return;
        }

        // Create a temporary preview to find level 1 accounts
        // For group rules, search through ALL data to find level 1 accounts that define groups
        const tempPreview = [];
        const level1Map = new Map();

        // Search through entire rawData to find all level 1 accounts (group definitions)
        rawData.forEach((row, index) => {
            const code = String(row.data[columnMapping.code] || '').trim();
            const name = String(row.data[columnMapping.name] || '').trim();

            // Check for level 1 patterns (both PUCT and ASFI)
            // FIX: Usar la inteligencia de niveles calculada en lugar de regex rígido
            // Si calculateLevel dice que es 1, confiamos en ello.
            const calculatedLevel = calculateLevel(code);
            const isLevel1 = calculatedLevel === 1;

            if (isLevel1) {
                console.log(`  FOUND level 1: "${code}" = "${name}"`);
                const upperName = name.toUpperCase();
                // Skip obvious placeholders
                const isPlaceholder = ['X', 'XXX', ''].includes(upperName) || upperName.length < 2;

                if (!level1Map.has(code)) {
                    level1Map.set(code, { name, isPlaceholder });
                    foundLevel1Accounts.push({ code, name, isPlaceholder });
                } else {
                    const existing = level1Map.get(code);
                    // Replace if current is placeholder and new is not, or if both are non-placeholder but new is longer
                    if ((!existing.isPlaceholder && isPlaceholder) ||
                        (existing.isPlaceholder && !isPlaceholder) ||
                        (!existing.isPlaceholder && !isPlaceholder && name.length > existing.name.length)) {
                        level1Map.set(code, { name, isPlaceholder });
                        // Update in foundLevel1Accounts too
                        const existingIndex = foundLevel1Accounts.findIndex(acc => acc.code === code);
                        if (existingIndex >= 0) {
                            foundLevel1Accounts[existingIndex] = { code, name, isPlaceholder };
                        }
                    }
                }
            }
        });

        // Convert map to array
        level1Map.forEach((data, code) => {
            console.log(`Found level 1 account: ${code} -> "${data.name}" (pattern: ${/^\d00000000$/.test(code) ? 'VALID' : 'INVALID'})`);
            tempPreview.push({ code, name: data.name, level: 1 });
        });

        console.log(`Total level 1 accounts found: ${tempPreview.length}`);

        if (tempPreview.length > 0) {
            // Create updated group rules based on level 1 accounts
            const updatedGroupRules = [...groupRules]; // Start with existing rules

            console.log('Updating rules with level 1 accounts...');
            tempPreview.forEach(account => {
                const firstDigit = account.code.charAt(0);
                console.log(`Processing ${account.code} (${firstDigit}): "${account.name.trim()}"`);

                // Find existing rule or create new one
                const existingRuleIndex = updatedGroupRules.findIndex(rule => rule.prefix === firstDigit);
                // Determinar el tipo correcto basado en el nombre de la cuenta raíz (ej: "GASTOS" -> "Gasto")
                const detectedType = determineTypeFromNameOnly(account.name.trim());

                if (existingRuleIndex >= 0) {
                    console.log(`Updating rule ${firstDigit}: "${updatedGroupRules[existingRuleIndex].type}" -> "${detectedType}"`);
                    // Update existing rule with the actual group name from this plan
                    updatedGroupRules[existingRuleIndex] = {
                        ...updatedGroupRules[existingRuleIndex],
                        type: detectedType
                    };
                } else {
                    console.log(`Adding new rule ${firstDigit}: "${detectedType}"`);
                    // Add new rule if prefix doesn't exist
                    updatedGroupRules.push({
                        prefix: firstDigit,
                        type: detectedType
                    });
                }
            });

            console.log('Final updated rules:', updatedGroupRules.map(r => `${r.prefix} -> ${r.type}`));
            setGroupRules(updatedGroupRules);
        } else {
            console.log('No level 1 accounts found, keeping default rules');
        }

        console.log('Level 1 accounts found:', foundLevel1Accounts.length);
    };

    // Función para análisis con IA (Orquestador Cognitivo)
    const analyzeWithAI = async (accounts) => {
        try {
            // Usamos selectedCompany del scope del componente, no llamamos al hook aquí
            const response = await axios.post(`${API_URL}/api/ai/orchestrator/orchestrate`, {
                companyId: selectedCompany?.id || 1,
                accounts: accounts.map(acc => ({
                    code: acc.code,
                    name: acc.name,
                    id: acc.id
                })),
                structureConfig: structureConfig, // ¡CRÍTICO! Enviamos la configuración detectada (PUCT)
                options: {
                    existingTypes: ACCOUNT_TYPES.map(t => t.value)
                }
            });

            if (response.data.success) {
                console.log('[AI] Analysis completed:', response.data.summary);
                return response.data.results;
            }
        } catch (error) {
            console.warn('[AI] Analysis failed, falling back to heuristics:', error.message);
        }
        return null;
    };

    const generatePreview = async () => {
        const preview = [];
        const dups = [];
        const seen = new Set();
        let seq = 1;

        console.log('=== generatePreview called ===');
        console.log('rawData length:', rawData.length);
        console.log('range:', range);

        // Process data filtering by Excel row number
        const filteredData = rawData.filter(row => {
            const rowNum = row.excelRow;
            const start = range.startRow || 0;
            const end = range.endRow || 999999;
            return rowNum >= start && rowNum <= end;
        });

        console.log('filteredData length:', filteredData.length);

        let processedCount = 0;
        let skippedCount = 0;

        // 1. Generación inicial del preview (estructura básica)
        filteredData.forEach(row => {
            const code = String(row.data[columnMapping.code] || '').trim();
            const name = String(row.data[columnMapping.name] || '').trim();

            // Skip empty codes or invalid codes (like headers)
            if (!code || !code.match(/^\d/)) {
                console.log('Skipping row', row.excelRow, '- invalid code:', code, 'name:', name);
                skippedCount++;
                return;
            }

            // Skip rows with empty names (backend requires name)
            if (!name || name.trim().length === 0) {
                console.log('Skipping row', row.excelRow, '- empty name for code:', code);
                skippedCount++;
                return;
            }

            processedCount++;

            if (seen.has(code)) dups.push(code);
            seen.add(code);

            const typeInfo = determineType(code, name);
            const level = calculateLevel(code) || 1; // Ensure level is at least 1
            const parentCode = calculateParent(code);

            preview.push({
                id: seq++,
                code,
                name,
                type: typeInfo.type || 'Activo', // Ensure type is present
                confidence: typeInfo.confidence,
                level: level,
                parent_code: parentCode,
                isDuplicate: dups.includes(code)
            });
        });

        console.log('=== generatePreview summary ===');
        console.log('Total rows in rawData:', rawData.length);
        console.log('Rows in specified range:', filteredData.length);
        console.log('Valid accounts processed:', processedCount);
        console.log('Rows skipped:', skippedCount);
        console.log('Final preview length:', preview.length);
        console.log('Duplicate codes:', dups.length);

        if (dups.length > 0) {
            const duplicateDetails = {};
            // Group by code to find positions
            preview.forEach(item => {
                if (dups.includes(item.code)) {
                    if (!duplicateDetails[item.code]) {
                        duplicateDetails[item.code] = [];
                    }
                    duplicateDetails[item.code].push(item.id);
                }
            });

            let message = `Se detectaron códigos duplicados:\n\n`;
            Object.entries(duplicateDetails).forEach(([code, positions]) => {
                message += `• Código ${code}: posiciones ${positions.join(', ')}\n`;
            });
            message += `\nTotal de códigos con duplicados: ${Object.keys(duplicateDetails).length}`;
            alert(message);
        }

        // 2. Análisis con IA / Backend (La "Nueva Tecnología")
        // Enviamos los datos al orquestador para que use sus heurísticas avanzadas o LLM
        const aiResults = await analyzeWithAI(preview);

        let enrichedPreview = preview;
        if (aiResults) {
            console.log('Aplicando inteligencia del Backend al preview...');
            enrichedPreview = preview.map(row => {
                const aiEnhancement = aiResults.find(ai => ai.code === row.code);
                if (aiEnhancement) {
                    // Priorizamos el tipo detectado por el backend (likely_type)
                    const smartType = aiEnhancement.enriched?.likely_type || aiEnhancement.predicted_type || row.type;
                    return {
                        ...row,
                        type: smartType,
                        ai_confidence: aiEnhancement.confidence,
                        ai_warnings: aiEnhancement.warnings || [],
                        ai_notes: aiEnhancement.notes,
                        predicted_level: aiEnhancement.predicted_level,
                        predicted_parent: aiEnhancement.predicted_parent
                    };
                }
                return row;
            });
        }

        // 3. Extracción de Reglas de Grupo BASADAS EN LA IA
        // Ahora que tenemos los tipos corregidos por el backend, generamos las reglas
        const level1AccountsInPreview = enrichedPreview.filter(row => row.level === 1);
        const level1Rules = {};

        level1AccountsInPreview.forEach(account => {
            const firstDigit = account.code.charAt(0);
            if (!level1Rules[firstDigit]) {
                level1Rules[firstDigit] = {
                    digit: firstDigit,
                    name: account.name,
                    type: account.type // Usamos el tipo inteligente del backend
                };
            }
        });

        const level1AccountsList = Object.values(level1Rules);
        setLevel1Accounts(level1AccountsList);

        const autoGeneratedRules = level1AccountsList.map(rule => ({
            prefix: rule.digit,
            type: rule.type
        }));
        setGroupRules(autoGeneratedRules);

        // 4. Aplicar consistencia final
        // Aseguramos que las cuentas hijas hereden el tipo de la regla de grupo (consistencia contable)
        const finalPreview = enrichedPreview.map(row => {
            const firstDigit = row.code.charAt(0);
            const rule = autoGeneratedRules.find(r => r.prefix === firstDigit);
            if (rule) {
                return { ...row, type: rule.type };
            }
            return row;
        });

        // 5. Análisis de Patrones Profundos (actualizado con datos finales)
        const analysis = AccountPlanProfile.analyze(finalPreview, structureConfig);
        setPlanAnalysis(analysis);

        // SELF-CORRECTION: If the preview data (calculated per row) reveals deeper levels than our config,
        // we MUST update the config to match reality so that Badges/Cards (which use config) are in sync.
        const maxFoundLevel = Math.max(...finalPreview.map(r => r.level || 1), 1);
        if (maxFoundLevel > (structureConfig.levelCount || 1)) {
            console.log(`[SmartImport] Auto-correcting config: Found L${maxFoundLevel} vs Config L${structureConfig.levelCount}`);

            // Preserve existing lengths, extend for new levels
            const newLengths = [...(structureConfig.levelLengths || [])];

            // Try to find missing lengths from the new analysis
            for (let i = 0; i < maxFoundLevel; i++) {
                if (!newLengths[i] || newLengths[i] === 0) {
                    // Try to get insight from analysis
                    const insight = (analysis.levelInsights || []).find(l => l.level === i + 1);
                    if (insight && insight.chars) {
                        newLengths[i] = insight.chars;
                    } else {
                        // Fallback: estimate based on previous
                        const prev = i > 0 ? (newLengths[i - 1] || 0) : 0;
                        newLengths[i] = prev + 2; // Default increment
                    }
                }
            }

            setStructureConfig(prev => ({
                ...prev,
                levelCount: maxFoundLevel,
                levelLengths: newLengths
            }));
        }

        setPreviewData(finalPreview);
        setStep(4);
    };

    // Paginación Helpers
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentPreviewItems = previewData.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(previewData.length / itemsPerPage);

    const updateAccountField = (id, field, value) => {
        setPreviewData(prev => prev.map(item => {
            if (item.id === id) {
                const updated = { ...item, [field]: value };
                if (field === 'code') {
                    updated.parent_code = calculateParent(value);
                    updated.level = calculateLevel(value);
                }
                return updated;
            }
            return item;
        }));
    };

    const deleteAccount = (id) => {
        setPreviewData(prev => prev.filter(item => item.id !== id).map((item, index) => ({
            ...item,
            id: index + 1
        })));
        setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
    };

    // --- Bulk Action Helpers ---
    const toggleSelect = (id) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === previewData.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(previewData.map(item => item.id));
        }
    };

    const applyBulkAction = (actionType) => {
        if (selectedIds.length === 0) return;

        setPreviewData(prev => prev.map(item => {
            if (selectedIds.includes(item.id)) {
                if (actionType === 'type') return { ...item, type: bulkType };
                if (actionType === 'level') return { ...item, level: bulkLevel, parent_code: calculateParent(item.code) };
            }
            return item;
        }));

        // Success notification for bulk action
        console.log(`Bulk ${actionType} applied to ${selectedIds.length} accounts`);
    };

    const cancelImport = () => {
        if (importCancelToken) {
            importCancelToken.cancel('Importación cancelada por el usuario');
        }
        setImporting(false);
        setImportProgress(0);
        setImportCancelToken(null);
    };

    const performImport = async () => {
        setImporting(true);
        setImportProgress(0);

        const cancelTokenSource = axios.CancelToken.source();
        setImportCancelToken(cancelTokenSource);

        let success = 0, fails = 0;

        try {
            // Persist plan structure to company before importing accounts
            // Use structureConfig to respect user's changes (e.g. switching from Sep to Long)
            if (structureConfig) {
                await axios.put(`${API_URL}/api/companies/${selectedCompany.id}`, {
                    code_mask: structureConfig.hasSeparator ?
                        Array.from({ length: structureConfig.levelCount }).map((_, i) => '#'.repeat(structureConfig.levelLengths[i] - (i > 0 ? structureConfig.levelLengths[i - 1] : 0))).join(structureConfig.separator) :
                        '#'.repeat(structureConfig.levelLengths[structureConfig.levelCount - 1]),
                    plan_structure: JSON.stringify({
                        regex: structureConfig.hasSeparator ? `^\\d+(?:\\${structureConfig.separator}\\d+)*$` : '^\\d+$',
                        separator: structureConfig.hasSeparator ? structureConfig.separator : null,
                        levelsCount: structureConfig.levelCount,
                        levelLengths: structureConfig.levelLengths,
                        levelIncrements: structureConfig.levelIncrements,
                        behavior: planAnalysis?.behavior || { strictlyNumerical: true }
                    })
                });
                console.log('Company structure persisted successfully');
            }

            // Pre-calculate all data including hierarchy
            const accountsToImport = previewData.map(row => {
                // Determine type (use rule if available, otherwise auto)
                const typeInfo = getTypeInfo(row.type);

                // Clean code if in Length mode (strip separators)
                let finalCode = row.code;
                if (!structureConfig.hasSeparator) {
                    finalCode = String(row.code).replace(/[.\-\/\s]/g, '');
                }

                // Calculate level using the FINAL code and config

                const level = getUniversalLevel(finalCode, planAnalysis, structureConfig);

                // Calculate hierarchy dynamically using the robust engine
                // This ensures ASFI logic (skipping modifiers) and PUCT logic (padding) are applied correctly
                const parentCode = AccountPlanProfile.calculateParent(finalCode, structureConfig);

                return {
                    code: finalCode,
                    name: row.name,
                    type: typeInfo.value,
                    level: level,
                    parent_code: parentCode,
                    company_id: selectedCompany?.id
                };
            });

            const total = accountsToImport.length;
            const batchSize = 500; // Aumentado de 10 a 500 para Bulk Insert masivo

            for (let i = 0; i < total; i += batchSize) {
                // Check cancellation
                if (cancelTokenSource.token.reason) {
                    throw new Error('Importación cancelada');
                }

                const batch = accountsToImport.slice(i, i + batchSize);

                // Usar el nuevo endpoint BULK
                await axios.post(`${API_URL}/api/accounts/bulk`, {
                    companyId: selectedCompany.id,
                    accounts: batch
                }, {
                    cancelToken: cancelTokenSource.token
                });

                // Asumimos éxito del lote si no lanza error (la transacción es todo o nada)
                success += batch.length;

                setImportProgress(Math.round(((i + batch.length) / total) * 100));

                // Small delay to allow UI updates
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            // Success feedback
            if (fails === 0) {
                // Simple alert or toast could go here
            } else {
                setError(`Importación completada con ${fails} errores.`);
            }

            if (onSuccess) onSuccess();
            onClose();

        } catch (error) {
            if (axios.isCancel(error)) {
                console.log('Import cancelled');
            } else {
                setError('Error en la importación: ' + error.message);
            }
        } finally {
            setImporting(false);
            setImportProgress(0);
            setImportCancelToken(null);
        }
    };

    const updateRule = (prefix, type) => {
        setGroupRules(prev => {
            const updated = prev.map(r => r.prefix === prefix ? { ...r, type } : r);
            // Update both preview types and level 1 accounts display
            setTimeout(() => {
                updatePreviewTypes();
                updateLevel1AccountsDisplay(updated);
            }, 0);
            return updated;
        });
    };

    const addRule = () => {
        if (newRulePrefix.trim()) {
            setGroupRules(prev => {
                const updated = [...prev, { prefix: newRulePrefix.trim(), type: newRuleType }];
                // Update both preview types and level 1 accounts display
                setTimeout(() => {
                    updatePreviewTypes();
                    updateLevel1AccountsDisplay(updated);
                }, 0);
                setNewRulePrefix('');
                setNewRuleType('Activo');
                setShowAddRule(false);
                return updated;
            });
        }
    };

    const deleteRule = (prefix) => {
        setGroupRules(prev => {
            const updated = prev.filter(r => r.prefix !== prefix);
            // Update both preview types and level 1 accounts display
            setTimeout(() => {
                updatePreviewTypes();
                updateLevel1AccountsDisplay(updated);
            }, 0);
            return updated;
        });
    };

    const updateRulePrefix = (oldPrefix, newPrefix) => {
        setGroupRules(prev => {
            const updated = prev.map(r => r.prefix === oldPrefix ? { ...r, prefix: newPrefix } : r);
            // Update both preview types and level 1 accounts display
            setTimeout(() => {
                updatePreviewTypes();
                updateLevel1AccountsDisplay(updated);
            }, 0);
            return updated;
        });
    };

    // Function to update preview data types based on current group rules
    const updatePreviewTypes = () => {
        setPreviewData(prev => prev.map(row => {
            // Find matching rule based on first digit of code
            const firstDigit = row.code.charAt(0);
            const matchingRule = groupRules.find(rule => rule.prefix === firstDigit);

            if (matchingRule) {
                // Use rule type instead of auto-detected type
                return { ...row, type: matchingRule.type };
            } else {
                // Fall back to auto-detected type if no rule matches
                const typeInfo = determineType(row.code, row.name);
                return { ...row, type: typeInfo.type };
            }
        }));
    };

    // Function to update level 1 accounts display with current rule types
    const updateLevel1AccountsDisplay = (currentRules) => {
        setLevel1Accounts(prev => prev.map(account => {
            // Find the corresponding rule for this account's digit
            const matchingRule = currentRules.find(rule => rule.prefix === account.digit);
            if (matchingRule) {
                // Update the account with the current rule type
                return { ...account, type: matchingRule.type };
            }
            // Keep original type if no rule matches
            return account;
        }));
    };

    const getTypeInfo = (type) => ACCOUNT_TYPES.find(t => t.value === type) || ACCOUNT_TYPES[0];

    return (
        <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-xl modal-dialog-scrollable">
                <div className="modal-content">
                    <div className="modal-header bg-primary text-white">
                        <h5 className="modal-title"><i className="bi bi-magic me-2"></i>Asistente de Importación - Paso {step === 3.5 ? 3 : step} de 4</h5>
                        <button className="btn-close btn-close-white" onClick={onClose}></button>
                    </div>
                    <div className="modal-body">
                        {error && <div className="alert alert-danger"><i className="bi bi-exclamation-triangle me-2"></i>{error}</div>}

                        {step === 1 && (
                            <div className="text-center p-5">
                                <i className="bi bi-file-earmark-arrow-up display-1 text-primary mb-4"></i>
                                <h4>Selecciona el Archivo</h4>
                                <p className="text-muted mb-4">Formatos: .xlsx, .xls, .xlsm, .pdf</p>
                                <input type="file" className="form-control w-50 mx-auto" accept=".xlsx,.xls,.xlsm,.pdf" onChange={handleFileUpload} />
                            </div>
                        )}

                        {step === 2 && (
                            <div className="row g-3">
                                {selectedSheet === 'PDF Import' ? (
                                    // PDF page selection
                                    <>
                                        <div className="col-12">
                                            <div className="alert alert-info">
                                                <strong><i className="bi bi-file-earmark-text me-2"></i>Configuración de Páginas PDF</strong>
                                                <p className="mb-0">Selecciona el rango de páginas a procesar. Página 1 usualmente es la portada.</p>
                                            </div>
                                        </div>
                                        <div className="col-md-4">
                                            <label className="form-label">Página Inicio</label>
                                            <input type="number" className="form-control" value={pdfRange.startPage || ''} onChange={e => setPdfRange({ ...pdfRange, startPage: parseInt(e.target.value) || 2 })} />
                                            <small className="text-muted">Por defecto: 2 (salta portada)</small>
                                        </div>
                                        <div className="col-md-4">
                                            <label className="form-label">Página Fin</label>
                                            <input type="number" className="form-control" value={pdfRange.endPage || ''} onChange={e => setPdfRange({ ...pdfRange, endPage: parseInt(e.target.value) || null })} placeholder="Todas" />
                                            <small className="text-muted">Dejar vacío para procesar todas</small>
                                        </div>
                                        <div className="col-md-4 d-flex align-items-end">
                                            <button className="btn btn-primary w-100" onClick={async () => { if (file) { await parsePDFFile(file); generateGroupRulesFromLevel1(); } }}><i className="bi bi-file-earmark-text me-2"></i>Procesar PDF</button>
                                        </div>
                                    </>
                                ) : (
                                    // Excel sheet and row selection
                                    <>
                                        <div className="col-md-6">
                                            <label className="form-label">Hoja del Excel</label>
                                            <select className="form-select" value={selectedSheet} onChange={e => setSelectedSheet(e.target.value)}>
                                                {sheets.map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        </div>
                                        <div className="col-md-3">
                                            <label className="form-label">Fila Inicio</label>
                                            <input type="number" className="form-control" value={range.startRow || ''} onChange={e => setRange({ ...range, startRow: parseInt(e.target.value) || 0 })} />
                                        </div>
                                        <div className="col-md-3">
                                            <label className="form-label">Fila Fin</label>
                                            <input type="number" className="form-control" value={range.endRow || ''} onChange={e => setRange({ ...range, endRow: parseInt(e.target.value) || 0 })} />
                                        </div>
                                        <div className="col-12 text-end">
                                            <button className="btn btn-primary" onClick={loadSheetData}><i className="bi bi-arrow-right me-2"></i>Cargar Datos</button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {step === 3 && (
                            <div className="row g-3">
                                {/* Multi-column toggle */}
                                <div className="col-12">
                                    <div className="alert alert-info">
                                        <strong><i className="bi bi-info-circle me-2"></i>Configuración de Columnas</strong>
                                        <div className="form-check mt-2">
                                            <input className="form-check-input" type="checkbox" id="multiColCheck"
                                                checked={multiColumnMode}
                                                onChange={e => setMultiColumnMode(e.target.checked)} />
                                            <label className="form-check-label" htmlFor="multiColCheck">
                                                El código está dividido en múltiples columnas (ej: PUCT)
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                {!multiColumnMode ? (
                                    <>
                                        <div className="col-md-6">
                                            <label className="form-label">Columna Código</label>
                                            <select className="form-select" value={columnMapping.code} onChange={e => setColumnMapping({ ...columnMapping, code: parseInt(e.target.value) })}>
                                                {rawData[0]?.data.map((_, i) => <option key={i} value={i}>Columna {String.fromCharCode(65 + i)}</option>)}
                                            </select>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label">Columna Nombre</label>
                                            <select className="form-select" value={columnMapping.name} onChange={e => setColumnMapping({ ...columnMapping, name: parseInt(e.target.value) })}>
                                                {rawData[0]?.data.map((_, i) => <option key={i} value={i}>Columna {String.fromCharCode(65 + i)}</option>)}
                                            </select>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="col-md-6">
                                            <label className="form-label">Columnas de Código (en orden)</label>
                                            <div className="d-flex gap-2 flex-wrap">
                                                {[...Array(Math.min(10, rawData[0]?.data.length || 0))].map((_, i) => (
                                                    <div key={i} className="form-check">
                                                        <input className="form-check-input" type="checkbox"
                                                            id={`col${i}`}
                                                            checked={codeColumns.includes(i)}
                                                            onChange={e => {
                                                                if (e.target.checked) {
                                                                    setCodeColumns([...codeColumns, i].sort((a, b) => a - b));
                                                                } else {
                                                                    setCodeColumns(codeColumns.filter(c => c !== i));
                                                                }
                                                            }} />
                                                        <label className="form-check-label" htmlFor={`col${i}`}>
                                                            {String.fromCharCode(65 + i)}
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                            <small className="text-muted">Seleccionadas: {codeColumns.map(c => String.fromCharCode(65 + c)).join(', ')}</small>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label">Columna Nombre</label>
                                            <select className="form-select" value={columnMapping.name} onChange={e => setColumnMapping({ ...columnMapping, name: parseInt(e.target.value) })}>
                                                {rawData[0]?.data.map((_, i) => <option key={i} value={i}>Columna {String.fromCharCode(65 + i)}</option>)}
                                            </select>
                                        </div>
                                    </>
                                )}

                                <div className="col-12">
                                    <div className="d-flex justify-content-between">
                                        <button className="btn btn-secondary" onClick={() => setStep(2)}><i className="bi bi-arrow-left me-2"></i>Atrás</button>
                                        <button className="btn btn-primary" onClick={analyzeStructure}><i className="bi bi-cpu me-2"></i>Analizar Estructura</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {step === 3.5 && (
                            <div className="row g-4">
                                {/* Left Column: Configuration */}
                                <div className="col-lg-6 border-end">
                                    <div className="d-flex align-items-center justify-content-between mb-3">
                                        <h5 className="mb-0 text-primary">
                                            <i className="bi bi-sliders me-2"></i>Configuración de Estructura
                                        </h5>
                                        {profileLoaded && (
                                            <span className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25">
                                                <i className="bi bi-check-circle-fill me-1"></i> Perfil Entrenado
                                            </span>
                                        )}
                                    </div>

                                    <div className="card bg-light mb-4 border-0">
                                        <div className="card-body">
                                            <div className="d-flex align-items-center justify-content-between mb-3">
                                                <label className="fw-bold">Método de Detección</label>
                                                <div className="btn-group btn-group-sm">
                                                    <button className={`btn ${structureConfig.hasSeparator ? 'btn-primary' : 'btn-outline-primary'}`}
                                                        onClick={() => setStructureConfig({ ...structureConfig, hasSeparator: true })}>
                                                        Por Separador
                                                    </button>
                                                    <button className={`btn ${!structureConfig.hasSeparator ? 'btn-primary' : 'btn-outline-primary'}`}
                                                        onClick={() => setStructureConfig({ ...structureConfig, hasSeparator: false })}>
                                                        Por Longitud
                                                    </button>
                                                </div>
                                            </div>

                                            {structureConfig.hasSeparator ? (
                                                <div className="animate__animated animate__fadeIn">
                                                    <div className="mb-3">
                                                        <label className="form-label small text-muted">Carácter Separador</label>
                                                        <div className="input-group">
                                                            <select className="form-select"
                                                                value={['.', '-', '/'].includes(structureConfig.separator) ? structureConfig.separator : 'other'}
                                                                onChange={e => {
                                                                    const val = e.target.value;
                                                                    setStructureConfig({ ...structureConfig, separator: val === 'other' ? '' : val });
                                                                }}>
                                                                <option value=".">Punto (.)</option>
                                                                <option value="-">Guión (-)</option>
                                                                <option value="/">Barra (/)</option>
                                                                <option value="other">Otro...</option>
                                                            </select>
                                                            {(!['.', '-', '/'].includes(structureConfig.separator)) && (
                                                                <input type="text" className="form-control" placeholder="Ej: *" maxLength="1" style={{ maxWidth: '60px' }}
                                                                    value={structureConfig.separator}
                                                                    onChange={e => setStructureConfig({ ...structureConfig, separator: e.target.value })} />
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="form-check mb-2">
                                                        <input className="form-check-input" type="checkbox" id="smartZero"
                                                            checked={structureConfig.smartZeroCheck}
                                                            disabled={structureConfig.useCustomLengths}
                                                            onChange={e => setStructureConfig({ ...structureConfig, smartZeroCheck: e.target.checked })} />
                                                        <label className="form-check-label small" htmlFor="smartZero">
                                                            Ignorar segmentos cero (Smart Level)
                                                        </label>
                                                    </div>

                                                    <div className="form-check mb-3">
                                                        <input className="form-check-input" type="checkbox" id="useCustomLen"
                                                            checked={structureConfig.useCustomLengths}
                                                            onChange={e => setStructureConfig({ ...structureConfig, useCustomLengths: e.target.checked })} />
                                                        <label className="form-check-label small fw-bold text-primary" htmlFor="useCustomLen">
                                                            Definir niveles por longitud (Híbrido)
                                                            <span className="d-block text-muted fw-normal" style={{ fontSize: '0.7rem' }}>Útil para: 131.03.1.01 (6 niveles)</span>
                                                        </label>
                                                    </div>

                                                    {structureConfig.useCustomLengths && (
                                                        <div className="p-2 bg-white border rounded animate__animated animate__fadeIn">
                                                            <div className="d-flex justify-content-between align-items-center mb-2">
                                                                <label className="form-label small text-muted mb-0">Longitud Acumulada</label>
                                                                <div>
                                                                    <button className="btn btn-xs btn-outline-secondary me-1" title="Quitar Nivel"
                                                                        onClick={() => setStructureConfig(prev => ({ ...prev, levelCount: Math.max(1, prev.levelCount - 1) }))}>
                                                                        <i className="bi bi-dash"></i>
                                                                    </button>
                                                                    <button className="btn btn-xs btn-outline-secondary" title="Agregar Nivel"
                                                                        onClick={() => setStructureConfig(prev => ({ ...prev, levelCount: Math.min(20, prev.levelCount + 1) }))}>
                                                                        <i className="bi bi-plus"></i>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div className="d-flex gap-1 flex-wrap justify-content-center">
                                                                {structureConfig.levelLengths.slice(0, structureConfig.levelCount).map((len, idx) => (
                                                                    <div key={idx} className="text-center">
                                                                        <label className="d-block text-muted" style={{ fontSize: '0.6rem' }}>N{idx + 1}</label>
                                                                        <input type="number" className="form-control form-control-sm p-0 text-center border-primary"
                                                                            style={{ width: '35px', fontSize: '0.8rem', height: '25px' }}
                                                                            value={len}
                                                                            onChange={e => {
                                                                                const newLens = [...structureConfig.levelLengths];
                                                                                newLens[idx] = parseInt(e.target.value) || 0;
                                                                                setStructureConfig({ ...structureConfig, levelLengths: newLens });
                                                                            }}
                                                                        />
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="animate__animated animate__fadeIn">
                                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                                        <label className="form-label small text-muted mb-0">Longitud Acumulada por Nivel</label>
                                                        <div>
                                                            <button className="btn btn-xs btn-outline-secondary me-1" title="Quitar Nivel"
                                                                onClick={() => setStructureConfig(prev => ({ ...prev, levelCount: Math.max(1, prev.levelCount - 1) }))}>
                                                                <i className="bi bi-dash"></i>
                                                            </button>
                                                            <button className="btn btn-xs btn-outline-secondary" title="Agregar Nivel"
                                                                onClick={() => setStructureConfig(prev => ({ ...prev, levelCount: Math.min(20, prev.levelCount + 1) }))}>
                                                                <i className="bi bi-plus"></i>
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="d-flex gap-2 flex-wrap bg-white p-2 rounded border">
                                                        {structureConfig.levelLengths.slice(0, structureConfig.levelCount).map((len, idx) => (
                                                            <div key={idx} className="text-center">
                                                                <label className="d-block text-muted fw-bold" style={{ fontSize: '0.65rem' }}>N{idx + 1}</label>
                                                                <input type="number" className="form-control form-control-sm p-1 text-center border-primary"
                                                                    style={{ width: '45px', fontSize: '0.9rem' }}
                                                                    value={len}
                                                                    onChange={e => {
                                                                        const newLens = [...structureConfig.levelLengths];
                                                                        newLens[idx] = parseInt(e.target.value) || 0;
                                                                        setStructureConfig({ ...structureConfig, levelLengths: newLens });
                                                                    }}
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <div className="alert alert-warning mt-2 py-1 px-2 small mb-0">
                                                        <i className="bi bi-lightbulb me-1"></i>
                                                        Ingresa la longitud <strong>total</strong> del código hasta ese nivel.
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>


                                </div>

                                {/* Right Column: Preview & Playground */}
                                <div className="col-lg-6">
                                    <h5 className="mb-3 text-success"><i className="bi bi-eye me-2"></i>Simulador y Vista Previa</h5>

                                    {/* Playground */}
                                    <div className="card mb-4 border-success">
                                        <div className="card-header bg-success text-white py-1">
                                            <small className="fw-bold">Probar Configuración</small>
                                        </div>
                                        <div className="card-body p-3">
                                            <div className="input-group mb-2">
                                                <span className="input-group-text bg-white"><i className="bi bi-keyboard"></i></span>
                                                <input type="text" className="form-control" placeholder="Escribe un código para probar (ej: 1.1.0)"
                                                    value={testCode} onChange={e => setTestCode(e.target.value)} />
                                            </div>
                                            {testCode && (
                                                <div className="d-flex gap-3 justify-content-center mt-2 p-2 bg-light rounded">
                                                    <div className="text-center">
                                                        <small className="text-muted d-block">Nivel Detectado</small>
                                                        <span className="badge bg-primary fs-6">{calculateLevel(testCode)}</span>
                                                    </div>
                                                    <div className="text-center">
                                                        <small className="text-muted d-block">Código Padre</small>
                                                        <span className="badge bg-secondary fs-6">{calculateParent(testCode) || '-'}</span>
                                                    </div>
                                                    <div className="text-center">
                                                        <small className="text-muted d-block">Tipo Sugerido</small>
                                                        <span className="badge bg-info text-dark fs-6">{determineType(testCode, '').type}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Live File Preview */}
                                    <div className="card">
                                        <div className="card-header bg-light py-2">
                                            <small className="fw-bold text-muted">Muestra del Archivo (Primeros 5)</small>
                                        </div>
                                        <div className="card-body p-0">
                                            <div className="table-responsive">
                                                <table className="table table-sm table-striped mb-0" style={{ fontSize: '0.85rem' }}>
                                                    <thead>
                                                        <tr>
                                                            <th>Código</th>
                                                            <th>Nivel</th>
                                                            <th>Padre</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(() => {
                                                            const startIndex = Math.max(0, range.startRow - 1);
                                                            return rawData.slice(startIndex, startIndex + 5).map((r, i) => {
                                                                const code = String(r.data[columnMapping.code] || '').trim();
                                                                if (!code || !code.match(/^\d/)) return null;
                                                                return (
                                                                    <tr key={i}>
                                                                        <td className="font-monospace">{code}</td>
                                                                        <td><span className="badge bg-light text-dark border">{calculateLevel(code)}</span></td>
                                                                        <td className="text-muted small">{calculateParent(code) || '-'}</td>
                                                                    </tr>
                                                                );
                                                            });
                                                        })()}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="col-12 text-end border-top pt-3 mt-2">
                                    <button className="btn btn-secondary me-2" onClick={() => {
                                        // Restore original data when going back
                                        if (originalData.length > 0) {
                                            setRawData(originalData);
                                            setMultiColumnMode(false); // Reset mode to avoid confusion
                                        }
                                        setStep(3);
                                    }}>Atrás</button>
                                    <button className="btn btn-success btn-lg" onClick={generatePreview}>
                                        Continuar a Validación <i className="bi bi-arrow-right ms-2"></i>
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 4 && (
                            <div>
                                <div className="alert alert-info mb-3 d-flex align-items-center justify-content-between">
                                    <div>
                                        <i className="bi bi-info-circle me-2"></i>
                                        <strong>{previewData.length} cuentas</strong> detectadas. Puedes editar los campos antes de importar.
                                    </div>
                                    {planAnalysis && (
                                        <div className="d-flex gap-2">
                                            <span className="badge bg-dark border font-monospace px-2 py-1" title="Máscara Visual Detectada">
                                                <i className="bi bi-mask me-1"></i> {planAnalysis.mask}
                                            </span>
                                            <span className="badge bg-secondary border px-2 py-1" title="Niveles Detectados">
                                                <i className="bi bi-layers me-1"></i> {structureConfig.levelCount || planAnalysis.levelsCount || 1} Niveles
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Deep Pattern Analysis Visualization */}
                                {planAnalysis && (
                                    <div className="card border-info shadow-sm mb-4 animate__animated animate__fadeIn">
                                        <div className="card-header bg-info bg-opacity-10 py-2 d-flex justify-content-between align-items-center">
                                            <h6 className="mb-0 small fw-bold text-info-emphasis">
                                                <i className="bi bi-cpu me-2"></i>Análisis Inteligente de Estructura (V5.1)
                                            </h6>
                                            <div className="d-flex align-items-center gap-2">
                                                <span className="badge rounded-pill bg-info text-dark" style={{ fontSize: '0.7rem' }}>Inteligencia de Niveles</span>
                                                {previewData.some(acc => acc.ai_confidence) && (
                                                    <span className="badge rounded-pill bg-success text-white" style={{ fontSize: '0.7rem' }}>
                                                        <i className="bi bi-robot me-1"></i>IA Activa
                                                    </span>
                                                )}
                                                <button className="btn btn-xs btn-outline-info" onClick={() => setShowRefinePanel(!showRefinePanel)}>
                                                    <i className={`bi ${showRefinePanel ? 'bi-chevron-up' : 'bi-pencil-square'} me-1`}></i>
                                                    {showRefinePanel ? 'Cerrar Editor' : 'Entrenar Estructura'}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="card-body p-3">
                                            <div className="row g-3">
                                                <div className="col-md-5 border-end">
                                                    <label className="form-label small text-muted mb-1">Perfil Global Detectado</label>
                                                    <div className="p-2 bg-light rounded border font-monospace mb-2 d-flex justify-content-between align-items-center">
                                                        <span className="text-primary fw-bold" style={{ fontSize: '1.2rem' }}>{planAnalysis.mask}</span>
                                                        <i className="bi bi-robot text-primary fs-5" title="Detección Automática"></i>
                                                    </div>
                                                    <div className="d-flex flex-wrap gap-1 mt-2">
                                                        {planAnalysis.behavior.strictlyNumerical && (
                                                            <span className="badge bg-light text-dark border-info"># Numérico</span>
                                                        )}
                                                        {planAnalysis.separator && (
                                                            <span className="badge bg-light text-dark border-info">Sep: "{planAnalysis.separator}"</span>
                                                        )}
                                                        <span className="badge bg-light text-dark border-info">{structureConfig.levelCount || planAnalysis.levelsCount || 1} Niveles</span>
                                                    </div>
                                                </div>
                                                <div className="col-md-7">
                                                    <label className="form-label small text-muted mb-1">Comportamiento por Nivel</label>
                                                    <div className="row g-2">
                                                        {Array.from({ length: structureConfig.levelCount || 1 }).map((_, lidx) => {
                                                            // Try to find insight or use config-based fallback
                                                            const existingInsight = (planAnalysis.levelInsights || []).find(l => l.level === lidx + 1);

                                                            // Calculate digits from config
                                                            const currentLen = structureConfig.levelLengths[lidx] || 0;
                                                            const prevLen = lidx > 0 ? (structureConfig.levelLengths[lidx - 1] || 0) : 0;
                                                            const charsCount = Math.max(1, currentLen - prevLen);

                                                            const level = existingInsight || {
                                                                level: lidx + 1,
                                                                chars: charsCount,
                                                                behavior: 'Nivel detectado por conf.',
                                                                type: 'Numérico'
                                                            };
                                                            // Contar cuentas reales en este nivel
                                                            const accountsInLevel = previewData.filter(item => {
                                                                const calculatedLevel = getUniversalLevel(item.code, planAnalysis, structureConfig);
                                                                return calculatedLevel === level.level;
                                                            }).length;

                                                            return (
                                                                <div key={lidx} className="col-6">
                                                                    <div className="p-2 border rounded bg-light bg-opacity-50 h-100">
                                                                        <div className="d-flex justify-content-between align-items-start mb-1">
                                                                            <span className="badge bg-secondary" style={{ fontSize: '0.6rem' }}>L{level.level}</span>
                                                                            <small className="fw-bold">{level.chars} {level.chars === 1 ? 'dígito' : 'dígitos'}</small>
                                                                        </div>
                                                                        <div className="d-flex justify-content-between align-items-center mb-1">
                                                                            <span className="badge bg-info text-dark small" title="Cuentas en este nivel">
                                                                                {accountsInLevel} cuentas
                                                                            </span>
                                                                        </div>
                                                                        <div className="small text-truncate" title={level.behavior || 'Patrón secuencial'}>
                                                                            <i className="bi bi-activity text-info me-1"></i>
                                                                            {level.behavior || 'Detectando flujo...'}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        }).filter(Boolean)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Live Refinement Panel (Step 4 Editor) */}
                                            {showRefinePanel && (
                                                <div className="mt-3 p-3 border-top border-info border-dashed animate__animated animate__fadeInUp">
                                                    <div className="alert alert-warning py-2 small mb-3">
                                                        <i className="bi bi-exclamation-triangle-fill me-2"></i>
                                                        <strong>Modo Entrenamiento:</strong> Los cambios aquí recalculan la previsualización inmediatamente.
                                                    </div>
                                                    <div className="row g-3">
                                                        <div className="col-md-4">
                                                            <label className="form-label small fw-bold">Detección</label>
                                                            <div className="btn-group btn-group-sm w-100">
                                                                <button className={`btn ${structureConfig.hasSeparator ? 'btn-primary' : 'btn-outline-primary'}`}
                                                                    onClick={() => setStructureConfig({ ...structureConfig, hasSeparator: true })}>Sep.</button>
                                                                <button className={`btn ${!structureConfig.hasSeparator ? 'btn-primary' : 'btn-outline-primary'}`}
                                                                    onClick={() => setStructureConfig({ ...structureConfig, hasSeparator: false })}>Long.</button>
                                                            </div>
                                                        </div>
                                                        <div className="col-md-3">
                                                            <label className="form-label small fw-bold">Niveles</label>
                                                            <div className="input-group input-group-sm">
                                                                <button className="btn btn-outline-secondary" type="button"
                                                                    onClick={() => setStructureConfig(p => ({ ...p, levelCount: Math.max(1, p.levelCount - 1) }))}>
                                                                    <i className="bi bi-dash"></i>
                                                                </button>
                                                                <input type="text" className="form-control text-center bg-white" value={structureConfig.levelCount} readOnly />
                                                                <button className="btn btn-outline-secondary" type="button"
                                                                    onClick={() => {
                                                                        const currentCount = structureConfig.levelCount;
                                                                        if (currentCount >= 10) return;
                                                                        const newLens = [...structureConfig.levelLengths];
                                                                        if (!newLens[currentCount] || newLens[currentCount] === 0) {
                                                                            newLens[currentCount] = (newLens[currentCount - 1] || 0) + 2;
                                                                        }
                                                                        setStructureConfig({ ...structureConfig, levelCount: currentCount + 1, levelLengths: newLens });
                                                                    }}>
                                                                    <i className="bi bi-plus"></i>
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div className="col-md-3">
                                                            <label className="form-label small fw-bold">Separador</label>
                                                            <input type="text" className="form-control form-control-sm text-center"
                                                                value={structureConfig.separator} maxLength="1"
                                                                onChange={e => setStructureConfig({ ...structureConfig, separator: e.target.value })} />
                                                        </div>
                                                        <div className="col-md-6 border-end">
                                                            <label className="form-label small fw-bold text-primary">Longitudes (Segmentos)</label>
                                                            <div className="d-flex gap-1 overflow-auto pb-1">
                                                                {structureConfig.levelLengths.slice(0, structureConfig.levelCount).map((l, i) => (
                                                                    <div key={i} className="text-center">
                                                                        <small className="d-block text-muted" style={{ fontSize: '0.6rem' }}>N{i + 1}</small>
                                                                        <input type="number" className="form-control form-control-sm p-0 text-center border-primary"
                                                                            style={{ width: '40px' }} value={l} title={`Longitud Nivel ${i + 1}`}
                                                                            onChange={e => {
                                                                                const nl = [...structureConfig.levelLengths];
                                                                                nl[i] = parseInt(e.target.value) || 0;
                                                                                setStructureConfig({ ...structureConfig, levelLengths: nl });
                                                                            }} />
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className="col-md-6">
                                                            <label className="form-label small fw-bold text-success">Incremento (+1, +10, +100)</label>
                                                            <div className="d-flex gap-1 overflow-auto pb-1">
                                                                {Array.from({ length: structureConfig.levelCount }).map((_, i) => (
                                                                    <div key={i} className="text-center">
                                                                        <small className="d-block text-muted" style={{ fontSize: '0.6rem' }}>INC{i + 1}</small>
                                                                        <input type="number" className="form-control form-control-sm p-0 text-center border-success"
                                                                            style={{ width: '40px' }} value={structureConfig.levelIncrements?.[i] || 1}
                                                                            onChange={e => {
                                                                                const ni = [...(structureConfig.levelIncrements || [])];
                                                                                ni[i] = parseInt(e.target.value) || 1;
                                                                                setStructureConfig({ ...structureConfig, levelIncrements: ni });
                                                                            }} />
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* Live Split Preview */}
                                                        <div className="col-12 mt-2" key={`preview-${structureConfig.levelCount}-${structureConfig.levelLengths.slice(0, structureConfig.levelCount).join('-')}-${structureConfig.hasSeparator}-${structureConfig.separator}`}>
                                                            <div className="p-2 bg-dark rounded text-white shadow-inner">
                                                                <div className="d-flex justify-content-between align-items-center mb-2 px-1">
                                                                    <div className="d-flex align-items-center gap-2">
                                                                        <small className="text-info fw-bold"><i className="bi bi-eye-fill me-1"></i>Previsualización en Vivo</small>
                                                                        <span className="badge bg-info bg-opacity-25 text-info border border-info border-opacity-25" style={{ fontSize: '0.7rem' }}>Splitting Algorithm Active</span>
                                                                    </div>
                                                                    <small className="font-monospace text-warning d-none d-sm-inline" style={{ fontSize: '0.8rem' }}>Base: {testCode || previewData[0]?.code || '1.1.01.001'}</small>
                                                                </div>
                                                                <div className="row g-1">
                                                                    {(() => {
                                                                        const sampleCode = testCode || previewData[0]?.code || '1.1.01.001';
                                                                        const levels = [];
                                                                        const detectedLevelForSample = calculateLevel(sampleCode);

                                                                        // Calculate live stats from previewData using current structureConfig
                                                                        const systemStats = { counts: {}, examples: {} };
                                                                        previewData.forEach(item => {
                                                                            // When in Long mode, strip separators from code before calculating level
                                                                            let codeForCalc = item.code;
                                                                            if (!structureConfig.hasSeparator) {
                                                                                codeForCalc = String(item.code).replace(/[.\-\/\s]/g, '');
                                                                            }
                                                                            const lvl = AccountPlanProfile.calculateLevel(codeForCalc, structureConfig);
                                                                            systemStats.counts[lvl] = (systemStats.counts[lvl] || 0) + 1;
                                                                            if (!systemStats.examples[lvl]) systemStats.examples[lvl] = [];
                                                                            if (systemStats.examples[lvl].length < 3) systemStats.examples[lvl].push(item.code);
                                                                        });

                                                                        for (let i = 1; i <= structureConfig.levelCount; i++) {
                                                                            let part = '';
                                                                            if (structureConfig.hasSeparator) {
                                                                                // Separator mode: split by separator
                                                                                const segs = sampleCode.split(structureConfig.separator);
                                                                                const paddedSegs = [];

                                                                                // Check if levelLengths seem to match this separator-based structure
                                                                                // by comparing first segment's expected vs actual length
                                                                                const firstExpected = structureConfig.levelLengths[0] || 0;
                                                                                const firstActual = segs[0]?.length || 0;
                                                                                const lengthsConfigured = Math.abs(firstExpected - firstActual) <= 1;

                                                                                for (let j = 0; j < i; j++) {
                                                                                    const actualSeg = segs[j] || '';

                                                                                    if (lengthsConfigured) {
                                                                                        // User has configured lengths - apply padding/trimming
                                                                                        const curLen = structureConfig.levelLengths[j] || 0;
                                                                                        const prevLen = j > 0 ? (structureConfig.levelLengths[j - 1] || 0) : 0;
                                                                                        const expectedLen = curLen - prevLen;

                                                                                        if (expectedLen <= 0) {
                                                                                            paddedSegs.push(actualSeg || '?');
                                                                                        } else if (actualSeg.length < expectedLen) {
                                                                                            paddedSegs.push(actualSeg + '?'.repeat(expectedLen - actualSeg.length));
                                                                                        } else if (actualSeg.length > expectedLen) {
                                                                                            paddedSegs.push(actualSeg.substring(0, expectedLen));
                                                                                        } else {
                                                                                            paddedSegs.push(actualSeg);
                                                                                        }
                                                                                    } else {
                                                                                        // levelLengths don't match - show actual segments without modification
                                                                                        paddedSegs.push(actualSeg || '?');
                                                                                    }
                                                                                }
                                                                                part = paddedSegs.join(structureConfig.separator);
                                                                            } else {
                                                                                // Length mode: strip ALL separators first, then use configured lengths
                                                                                const cleanCode = sampleCode.replace(/[.\-\/\s]/g, '');
                                                                                const len = structureConfig.levelLengths[i - 1] || 0;
                                                                                if (cleanCode.length < len) {
                                                                                    part = cleanCode + '?'.repeat(len - cleanCode.length);
                                                                                } else {
                                                                                    part = cleanCode.substring(0, len);
                                                                                }
                                                                            }

                                                                            // Calculate configured digits for this level
                                                                            // In separator mode: sum of actual segment lengths up to this level
                                                                            // In length mode: use configured cumulative length
                                                                            let configuredDigits;
                                                                            if (structureConfig.hasSeparator) {
                                                                                // Sum actual segment lengths from the split (excluding separators)
                                                                                const segs = sampleCode.split(structureConfig.separator);
                                                                                configuredDigits = segs.slice(0, i).reduce((sum, seg) => sum + seg.length, 0);
                                                                            } else {
                                                                                // Use configured cumulative length directly
                                                                                configuredDigits = structureConfig.levelLengths[i - 1] || 0;
                                                                            }

                                                                            levels.push({
                                                                                level: i,
                                                                                part,
                                                                                count: systemStats.counts[i] || 0,
                                                                                examples: systemStats.examples[i] || [],
                                                                                isMatch: detectedLevelForSample === i,
                                                                                configuredDigits
                                                                            });
                                                                        }

                                                                        const colors = [
                                                                            'border-primary text-info shadow-primary',
                                                                            'border-success text-success shadow-success',
                                                                            'border-warning text-warning shadow-warning',
                                                                            'border-danger text-danger shadow-danger',
                                                                            'border-info text-info shadow-info',
                                                                            'border-light text-white shadow-light'
                                                                        ];

                                                                        return levels.map((lvl, idx) => (
                                                                            <div key={idx} className="col-4 col-md-3 col-lg-2">
                                                                                <div className={`bg-white bg-opacity-10 p-2 rounded border ${colors[idx % colors.length]} text-center h-100 shadow-sm position-relative`} style={{ minHeight: '80px', transition: 'all 0.3s ease' }}>
                                                                                    {lvl.isMatch && (
                                                                                        <span className="position-absolute top-0 start-50 translate-middle badge rounded-pill bg-warning text-dark border border-dark border-opacity-25 shadow-sm" style={{ fontSize: '0.65rem', zIndex: 2 }}>
                                                                                            <i className="bi bi-cpu-fill"></i> DETECTADO
                                                                                        </span>
                                                                                    )}
                                                                                    <div className="opacity-75 mb-1 d-flex justify-content-between align-items-center" style={{ fontSize: '0.7rem', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                                                                                        <span>NIVEL {lvl.level}</span>
                                                                                        <span className="badge bg-info bg-opacity-50 text-white" style={{ fontSize: '0.6rem' }}>{lvl.configuredDigits} díg.</span>
                                                                                    </div>
                                                                                    <div className="font-monospace text-truncate fw-bold mb-1" style={{ fontSize: '1rem' }} title={lvl.part}>
                                                                                        {lvl.part || '-'}
                                                                                    </div>
                                                                                    <div className="border-top border-white border-opacity-10 pt-1 mt-1">
                                                                                        <div style={{ fontSize: '0.75rem' }} className="fw-bold text-white">
                                                                                            {lvl.count} cuentas
                                                                                        </div>
                                                                                        {lvl.examples.length > 0 && (
                                                                                            <div className="text-light opacity-75 text-truncate mt-1" style={{ fontSize: '0.65rem', fontStyle: 'italic' }}>
                                                                                                {lvl.examples.join(', ')}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        ));
                                                                    })()}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="col-12 text-center mt-3">
                                                            <button className="btn btn-info btn-sm px-4 shadow-sm" onClick={generatePreview}>
                                                                <i className="bi bi-arrow-repeat me-1"></i> Recalcular Vista Previa Completa
                                                            </button>
                                                            <button className="btn btn-outline-success btn-sm ms-2" onClick={() => {
                                                                // Get all existing profiles to determine next ID
                                                                const profiles = [];
                                                                for (let i = 0; i < localStorage.length; i++) {
                                                                    const k = localStorage.key(i);
                                                                    if (k.startsWith('struct_profile_')) {
                                                                        try { profiles.push(JSON.parse(localStorage.getItem(k))); } catch (e) { }
                                                                    }
                                                                }
                                                                const nextId = profiles.length > 0 ? Math.max(...profiles.map(p => p.id)) + 1 : 1;
                                                                const profileName = prompt(`Nombre para este perfil de entrenamiento (ID #${nextId}):`, `Perfil ${selectedCompany?.name || ''}`);

                                                                if (profileName) {
                                                                    const profileData = {
                                                                        id: nextId,
                                                                        name: profileName,
                                                                        companyId: selectedCompany?.id,
                                                                        config: structureConfig
                                                                    };
                                                                    localStorage.setItem(`struct_profile_${nextId}`, JSON.stringify(profileData));
                                                                    alert(`¡Perfil #${nextId} guardado exitosamente!`);
                                                                }
                                                            }}>
                                                                <i className="bi bi-save me-1"></i> Guardar Perfil
                                                            </button>
                                                            <button className="btn btn-outline-info btn-sm ms-2" onClick={() => setShowProfileLibrary(true)}>
                                                                <i className="bi bi-journal-bookmark-fill me-1"></i> Biblioteca de Perfiles
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Profile Library Modal */}
                                {showProfileLibrary && (
                                    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
                                        <div className="modal-dialog modal-lg modal-dialog-centered">
                                            <div className="modal-content shadow-lg border-info">
                                                <div className="modal-header bg-info text-white py-2">
                                                    <h6 className="modal-title"><i className="bi bi-journal-bookmark-fill me-2"></i>Cargar Perfil Guardado</h6>
                                                    <button type="button" className="btn-close btn-close-white" onClick={() => setShowProfileLibrary(false)}></button>
                                                </div>
                                                <div className="modal-body p-0">
                                                    <div className="table-responsive" style={{ maxHeight: '350px' }}>
                                                        <table className="table table-hover table-sm align-middle mb-0">
                                                            <thead className="table-light">
                                                                <tr>
                                                                    <th>Empresa</th>
                                                                    <th>Configuración</th>
                                                                    <th className="text-center">Acción</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(() => {
                                                                    const profiles = [];
                                                                    for (let i = 0; i < localStorage.length; i++) {
                                                                        const key = localStorage.key(i);
                                                                        if (key.startsWith('struct_profile_')) {
                                                                            try {
                                                                                const data = JSON.parse(localStorage.getItem(key));
                                                                                const company = companies.find(c => String(c.id) === String(data.companyId));
                                                                                profiles.push({
                                                                                    key,
                                                                                    ...data,
                                                                                    companyName: company?.name || (data.companyId === 'global' ? '🌍 Plantilla Global' : `ID: ${data.companyId}`)
                                                                                });
                                                                            } catch (e) { console.error("Error parsing profile", key); }
                                                                        }
                                                                    }

                                                                    // Sort for consistency
                                                                    profiles.sort((a, b) => b.id - a.id); // Newest first for quick loading

                                                                    if (profiles.length === 0) {
                                                                        return <tr><td colSpan="3" className="text-center py-4 text-muted">No hay perfiles guardados. Ve a Configuración para crear uno.</td></tr>;
                                                                    }

                                                                    return profiles.map(p => (
                                                                        <tr key={p.key} className={String(p.companyId) === String(selectedCompany?.id) ? 'table-primary-subtle' : ''}>
                                                                            <td className="ps-3">
                                                                                <div className="d-flex align-items-center gap-2">
                                                                                    <span className="badge bg-dark text-info border border-info" style={{ fontSize: '0.6rem' }}>#{p.id}</span>
                                                                                    <div className="fw-bold" style={{ fontSize: '0.85rem' }}>{p.name}</div>
                                                                                </div>
                                                                                <div className="text-muted" style={{ fontSize: '0.65rem' }}>{p.companyName}</div>
                                                                                {String(p.companyId) === String(selectedCompany?.id) && <span className="badge bg-primary mt-1" style={{ fontSize: '0.6rem' }}>Sugerido</span>}
                                                                            </td>
                                                                            <td>
                                                                                <div style={{ fontSize: '0.75rem' }}>
                                                                                    {p.config.levelCount} Niv. | {p.config.hasSeparator ? 'Sep' : 'Fijo'}
                                                                                </div>
                                                                            </td>
                                                                            <td className="text-center">
                                                                                <button className="btn btn-primary btn-sm py-0 px-2" style={{ fontSize: '0.75rem' }} onClick={() => {
                                                                                    setStructureConfig(p.config);
                                                                                    setProfileLoaded(true);
                                                                                    setShowProfileLibrary(false);
                                                                                }}>
                                                                                    <i className="bi bi-box-arrow-in-down"></i> Cargar
                                                                                </button>
                                                                            </td>
                                                                        </tr>
                                                                    ));
                                                                })()}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                                <div className="modal-footer bg-light py-1">
                                                    <small className="text-muted me-auto px-2">Gestiona tus perfiles en la página de Configuración.</small>
                                                    <button className="btn btn-secondary btn-sm" onClick={() => setShowProfileLibrary(false)}>Cerrar</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}


                                {/* Unified Level 1 Accounts & Group Rules Section */}
                                <div className="mb-3">
                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                        <small className="text-muted fw-bold">
                                            <i className="bi bi-star-fill text-warning me-1"></i>
                                            Cuentas Nivel 1 & Reglas de Grupo ({level1Accounts.length})
                                        </small>
                                        <button className="btn btn-sm btn-outline-primary" onClick={() => setShowAddRule(!showAddRule)}>
                                            <i className="bi bi-gear me-1"></i>Configurar
                                        </button>
                                    </div>

                                    {/* Level 1 Accounts & Group Rules (Unified Badges) */}
                                    <div className="d-flex flex-wrap gap-2 mb-2">
                                        {level1Accounts.map((account, idx) => (
                                            <small key={idx} className="badge bg-success text-white px-2 py-1" title={`Regla de grupo: ${account.digit} → ${account.type}`}>
                                                <strong>{account.digit}</strong> → {account.name} <i className="bi bi-arrow-right-short mx-1"></i> {account.type}
                                            </small>
                                        ))}
                                    </div>
                                    <small className="text-muted d-block mb-2">
                                        <i className="bi bi-lightbulb me-1"></i>
                                        Los badges verdes muestran las reglas de grupo activas (Nombre → Tipo).
                                    </small>

                                    {/* Expanded Rules Editor */}
                                    {showAddRule && (
                                        <div className="card border shadow-sm">
                                            <div className="card-header py-2">
                                                <h6 className="mb-0 small"><i className="bi bi-tags me-2"></i>Editor de Reglas de Grupo</h6>
                                            </div>
                                            <div className="card-body p-3">
                                                <div className="alert alert-info small mb-3">
                                                    <strong>Nota:</strong> Puedes modificar los tipos de las reglas mostradas arriba.
                                                    Los cambios se aplican automáticamente a toda la tabla.
                                                </div>
                                                {/* Add new rule */}
                                                <div className="row g-2 align-items-end mb-3">
                                                    <div className="col-md-3">
                                                        <label className="form-label small">Dígito</label>
                                                        <input type="text" className="form-control form-control-sm" placeholder="1-9"
                                                            value={newRulePrefix} onChange={e => setNewRulePrefix(e.target.value)} maxLength="1" />
                                                    </div>
                                                    <div className="col-md-4">
                                                        <label className="form-label small">Tipo</label>
                                                        <select className="form-select form-select-sm" value={newRuleType} onChange={e => setNewRuleType(e.target.value)}>
                                                            {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                                        </select>
                                                    </div>
                                                    <div className="col-md-3">
                                                        <button className="btn btn-success btn-sm w-100" onClick={addRule}>
                                                            <i className="bi bi-plus"></i> Agregar
                                                        </button>
                                                    </div>
                                                    <div className="col-md-2">
                                                        <button className="btn btn-secondary btn-sm w-100" onClick={() => setShowAddRule(false)}>
                                                            <i className="bi bi-x"></i>
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Rules table */}
                                                <div className="table-responsive" style={{ maxHeight: '200px' }}>
                                                    <table className="table table-sm table-hover mb-0">
                                                        <thead className="table-light">
                                                            <tr>
                                                                <th style={{ width: '80px' }}>Dígito</th>
                                                                <th>Tipo</th>
                                                                <th style={{ width: '70px' }}>Cuenta</th>
                                                                <th style={{ width: '50px' }}></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {groupRules.map((rule, idx) => {
                                                                const affectedCount = previewData.filter(row => row.code.charAt(0) === rule.prefix).length;
                                                                return (
                                                                    <tr key={idx}>
                                                                        <td>
                                                                            <input type="text" className="form-control form-control-sm text-center"
                                                                                value={rule.prefix} onChange={e => updateRulePrefix(rule.prefix, e.target.value)}
                                                                                maxLength="1" style={{ width: '40px' }} />
                                                                        </td>
                                                                        <td>
                                                                            <select className="form-select form-select-sm" value={rule.type}
                                                                                onChange={e => updateRule(rule.prefix, e.target.value)}>
                                                                                {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                                                            </select>
                                                                        </td>
                                                                        <td className="text-center">
                                                                            <span className="badge bg-info text-dark small">{affectedCount}</span>
                                                                        </td>
                                                                        <td>
                                                                            <button className="btn btn-sm btn-outline-danger p-0 px-1" onClick={() => deleteRule(rule.prefix)}>
                                                                                <i className="bi bi-trash"></i>
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Controles de Paginación (Vital para rendimiento UI) */}
                                {previewData.length > itemsPerPage && (
                                    <div className="d-flex justify-content-between align-items-center mb-2 bg-light p-2 rounded">
                                        <small className="text-muted">Mostrando {indexOfFirstItem + 1} - {Math.min(indexOfLastItem, previewData.length)} de {previewData.length}</small>
                                        <div className="btn-group btn-group-sm">
                                            <button className="btn btn-outline-secondary" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                                                <i className="bi bi-chevron-left"></i>
                                            </button>
                                            <span className="btn btn-outline-secondary disabled text-dark fw-bold" style={{ minWidth: '80px' }}>
                                                Pág {currentPage} / {totalPages}
                                            </span>
                                            <button className="btn btn-outline-secondary" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                                                <i className="bi bi-chevron-right"></i>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="table-responsive" style={{ maxHeight: '500px' }}>
                                    {/* Bulk Actions Bar */}
                                    {selectedIds.length > 0 && (
                                        <div className="card bg-light border-primary mb-3 sticky-top shadow-sm animate__animated animate__fadeInDown" style={{ zIndex: 1021, top: '0' }}>
                                            <div className="card-body py-2 d-flex align-items-center justify-content-between">
                                                <div className="d-flex align-items-center">
                                                    <span className="badge bg-primary me-3 fs-6">
                                                        <i className="bi bi-check2-all me-1"></i> {selectedIds.length} seleccionados
                                                    </span>

                                                    <div className="input-group input-group-sm me-2" style={{ maxWidth: '250px' }}>
                                                        <select className="form-select" value={bulkType} onChange={e => setBulkType(e.target.value)}>
                                                            {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                                        </select>
                                                        <button className="btn btn-primary" onClick={() => applyBulkAction('type')}>
                                                            Asignar Tipo
                                                        </button>
                                                    </div>

                                                    <div className="input-group input-group-sm me-2" style={{ maxWidth: '200px' }}>
                                                        <input type="number" className="form-control" value={bulkLevel} onChange={e => setBulkLevel(parseInt(e.target.value) || 1)} min="1" max="10" />
                                                        <button className="btn btn-outline-primary" onClick={() => applyBulkAction('level')}>
                                                            Asignar Nivel
                                                        </button>
                                                    </div>
                                                </div>
                                                <button className="btn btn-sm btn-link text-muted" onClick={() => setSelectedIds([])}>
                                                    Desmarcar todos
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <table className="table table-sm table-hover table-striped">
                                        <thead className="table-light sticky-top" style={{ zIndex: 1020, top: selectedIds.length > 0 ? '54px' : '0' }}>
                                            <tr>
                                                <th style={{ width: '40px' }} className="text-center">
                                                    <input type="checkbox" className="form-check-input"
                                                        checked={selectedIds.length === previewData.length && previewData.length > 0}
                                                        onChange={toggleSelectAll} />
                                                </th>
                                                <th style={{ width: '40px' }}>#</th>
                                                <th style={{ width: '120px' }}>Código</th>
                                                <th>Nombre</th>
                                                <th style={{ width: '140px' }}>Tipo</th>
                                                <th style={{ width: '80px' }}>Nivel</th>
                                                <th style={{ width: '50px' }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentPreviewItems.map(row => {
                                                const typeInfo = getTypeInfo(row.type);
                                                const isSelected = selectedIds.includes(row.id);
                                                return (
                                                    <tr key={row.id} className={`${row.isDuplicate ? 'table-danger' : ''} ${isSelected ? 'table-primary-subtle' : ''}`}>
                                                        <td className="text-center">
                                                            <input type="checkbox" className="form-check-input"
                                                                checked={isSelected}
                                                                onChange={() => toggleSelect(row.id)} />
                                                        </td>
                                                        <td className="text-muted small">{row.id}</td>
                                                        <td><input type="text" className="form-control form-control-sm font-monospace" value={row.code} onChange={e => updateAccountField(row.id, 'code', e.target.value)} /></td>
                                                        <td><input type="text" className="form-control form-control-sm" value={row.name} onChange={e => updateAccountField(row.id, 'name', e.target.value)} /></td>
                                                        <td>
                                                            <select className="form-select form-select-sm" value={row.type} onChange={e => updateAccountField(row.id, 'type', e.target.value)}>
                                                                {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                                            </select>
                                                        </td>
                                                        <td><input type="number" className="form-control form-control-sm" style={{ width: '60px' }} value={row.level} onChange={e => updateAccountField(row.id, 'level', parseInt(e.target.value))} /></td>
                                                        <td className="text-center">
                                                            <i className="bi bi-trash text-danger" onClick={() => deleteAccount(row.id)} style={{ cursor: 'pointer' }}></i>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="mt-3">
                                    {importing ? (
                                        <div className="text-center">
                                            <div className="mb-3">
                                                <h5>Importando cuentas...</h5>
                                                <div className="progress mb-2" style={{ height: '25px' }}>
                                                    <div
                                                        className="progress-bar progress-bar-striped progress-bar-animated bg-success"
                                                        role="progressbar"
                                                        style={{ width: `${importProgress}%` }}
                                                        aria-valuenow={importProgress}
                                                        aria-valuemin="0"
                                                        aria-valuemax="100"
                                                    >
                                                        {importProgress}%
                                                    </div>
                                                </div>
                                                <small className="text-muted">
                                                    {Math.round((importProgress / 100) * previewData.length)} de {previewData.length} cuentas procesadas
                                                </small>
                                            </div>
                                            <button className="btn btn-danger" onClick={cancelImport}>
                                                <i className="bi bi-x-circle me-2"></i>Cancelar Importación
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="text-end">
                                            <button className="btn btn-secondary me-2" onClick={() => setStep(3.5)}>Atrás</button>
                                            <button className="btn btn-success" onClick={performImport}>
                                                <i className="bi bi-cloud-upload me-2"></i>Confirmar e Importar
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div >
    );
}

export default SmartImportWizard;
