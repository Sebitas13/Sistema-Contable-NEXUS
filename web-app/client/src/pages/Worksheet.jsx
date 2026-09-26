import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { exportToPDF, exportToExcel } from '../utils/exportUtils';
import { TreeRow } from './FinancialStatements';
import { useCompany } from '../context/CompanyContext';

// Importar API_URL explícitamente para evitar errores en producción
import API_URL from '../api';
import AIAdjustmentPanel from '../components/AIAdjustmentPanel';
import MahoragaWheel from '../components/MahoragaWheel';
import { getFiscalYearDetails } from '../utils/fiscalYearUtils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// Rule of rounding to the nearest even (Banker's Rounding)
// Avoids cumulative bias in financial systems.
const bankersRound = (num, decimalPlaces = 2) => {
    const m = Math.pow(10, decimalPlaces);
    const n = +(num * m).toFixed(8); // fix binary floating point precision
    const i = Math.floor(n);
    const f = n - i;
    const e = 1e-8; // epsilon
    let r;
    if (f > 0.5 - e && f < 0.5 + e) {
        r = (i % 2 === 0) ? i : i + 1;
    } else {
        r = Math.round(n);
    }
    return r / m;
};

export default function Worksheet() {
    const { selectedCompany } = useCompany();
    const [bcAccounts, setBcAccounts] = useState([]); // Balance de Comprobación (excluding adjustments)
    const [adjustmentData, setAdjustmentData] = useState([]); // Adjustments only
    const [accounts, setAccounts] = useState([]); // Merged data for display
    const [loading, setLoading] = useState(true);
    const [aiAdjustments, setAiAdjustments] = useState(null); // AI-generated adjustments
    const [showAIPanel, setShowAIPanel] = useState(false);
    const [mahoragaActive, setMahoragaActive] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [hasResultClosing, setHasResultClosing] = useState(false);
    const [worksheetClosingWarning, setWorksheetClosingWarning] = useState('');

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth <= 575.98);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    useEffect(() => {
        if (selectedCompany?.id) {
            fetchWorksheetData();
            checkMahoragaStatus();
        }
    }, [selectedCompany?.id]);

    const checkMahoragaStatus = async () => {
        try {
            const response = await axios.get(`${API_URL}/api/ai/mahoraga/config/${selectedCompany.id}`);
            if (response.data.success && Array.isArray(response.data.active_pages)) {
                setMahoragaActive(response.data.active_pages.includes('Worksheet'));
            } else {
                setMahoragaActive(false);
            }
        } catch (error) {
            console.error('Error checking Mahoraga status:', error);
            setMahoragaActive(false);
        }
    };

    const fetchWorksheetData = async () => {
        if (!selectedCompany?.id) return;
        setLoading(true);
        try {
            const companyId = selectedCompany.id;
            const fiscal = getFiscalYearDetails(
                selectedCompany.activity_type,
                selectedCompany.current_year || new Date().getFullYear(),
                selectedCompany.operation_start_date
            );
            const [reportResponse, bcResponse, adjResponse] = await Promise.all([
                axios.get(`${API_URL}/api/reports/financial-statements`, {
                    params: { companyId, startDate: fiscal.startDate, endDate: fiscal.endDate }
                }),
                axios.get(`${API_URL}/api/reports/ledger`, {
                    params: { companyId, startDate: fiscal.startDate, endDate: fiscal.endDate, excludeAdjustments: true, excludeClosing: true }
                }),
                axios.get(`${API_URL}/api/reports/ledger`, {
                    params: { companyId, startDate: fiscal.startDate, endDate: fiscal.endDate, adjustmentsOnly: true, excludeClosing: true }
                })
            ]);
            const bcData = bcResponse.data.data || [];
            setBcAccounts(bcData);
            const adjData = adjResponse.data.data || [];
            setAdjustmentData(adjData);
            const report = reportResponse.data;
            setHasResultClosing(!!report.metadata?.hasResultClosing);
            setWorksheetClosingWarning(report.worksheetClosing?.warning || '');
            const bcById = new Map(bcData.map(account => [String(account.id), account]));
            const adjById = new Map(adjData.map(account => [String(account.id), account]));
            const bucketById = new Map(Object.entries(report.metadata?.classificationByAccountId || {}));
            const collectBucket = (nodes, bucket) => {
                for (const node of nodes || []) {
                    if (!node.esVirtual) bucketById.set(String(node.id), bucket);
                    collectBucket(node.hijos, bucket);
                }
            };
            collectBucket(report.balanceGeneral?.activos, 'ASSET');
            collectBucket(report.balanceGeneral?.pasivos, 'LIABILITY');
            collectBucket(report.balanceGeneral?.patrimonio, 'EQUITY');
            const collectItems = (items, bucket) => (items || []).forEach(item => bucketById.set(String(item.id), bucket));
            collectItems(report.estadoResultados?.secciones?.ingresos, 'REVENUE');
            collectItems(report.estadoResultados?.secciones?.costos, 'COST');
            collectItems(report.estadoResultados?.secciones?.gastosAdmin, 'EXPENSE');

            const closeById = report.worksheetClosing?.byAccount || {};
            const merged = (report.data || []).map(account => {
                const bc = bcById.get(String(account.id)) || {};
                const adjustment = adjById.get(String(account.id)) || {};
                const close = closeById[String(account.id)] || {};
                const total_debit = Number(bc.total_debit) || 0;
                const total_credit = Number(bc.total_credit) || 0;
                return {
                    ...account,
                    _financialBucket: bucketById.get(String(account.id)) || null,
                    total_debit,
                    total_credit,
                    balance: total_debit - total_credit,
                    adj_debit: Number(adjustment.total_debit) || 0,
                    adj_credit: Number(adjustment.total_credit) || 0,
                    ending_debit: Number(account.total_debit) || 0,
                    ending_credit: Number(account.total_credit) || 0,
                    closing_debit: Number(close.debit) || 0,
                    closing_credit: Number(close.credit) || 0
                };
            });

            // Sort by code
            merged.sort((a, b) => (a.code || '').localeCompare(b.code || ''));

            setAccounts(merged);
            setLoading(false);
        } catch (error) {
            console.error('Error fetching worksheet:', error);
            setLoading(false);
        }
    };

    const handleAIAdjustmentsGenerated = (adjustments) => {
        setAiAdjustments(adjustments);
        // Aquí podríamos actualizar los datos del worksheet con los nuevos ajustes
        console.log('AI Adjustments generated:', adjustments);
    };

    const applyAIAdjustments = async () => {
        if (!aiAdjustments?.proposedTransactions || !selectedCompany?.id) return;

        try {
            // Convertir transacciones AI al formato del sistema
            const transactions = aiAdjustments.proposedTransactions.map(tx => ({
                company_id: selectedCompany.id,
                date: new Date().toISOString().split('T')[0],
                gloss: tx.gloss,
                entries: tx.entries.map(entry => ({
                    account_id: entry.accountId,
                    account_name: entry.accountName,
                    debit: entry.debit,
                    credit: entry.credit,
                    gloss: entry.gloss
                }))
            }));

            // Enviar transacciones al backend
            for (const transaction of transactions) {
                await axios.post(`${API_URL}/api/transactions`, transaction);
            }

            // Refrescar datos del worksheet
            await fetchWorksheetData();

            // Limpiar ajustes AI
            setAiAdjustments(null);
            setShowAIPanel(false);

            alert('Ajustes AI aplicados exitosamente');
        } catch (error) {
            console.error('Error applying AI adjustments:', error);
            alert('Error al aplicar ajustes AI');
        }
    };

    // Clasificar cuentas por tipo (más flexible): usar campos del plan, tipo o prefijo de código
    const classifyAccount = (acc) => {
        const rawType = (acc.type || '').toString();
        const type = rawType.trim();
        const group = (acc.group || acc.group_name || acc.category || acc.account_group || '').toString().trim();
        const code = (acc.code || '').toString().trim();
        const reportBucket = acc._financialBucket;
        // Use adjusted balance for classification
        const adjDeudor = (acc.total_debit || 0) + (acc.adj_debit || 0);
        const adjAcreedor = (acc.total_credit || 0) + (acc.adj_credit || 0);
        const adjustedBalance = adjDeudor - adjAcreedor;

        const t = (type || group).toLowerCase();
        const name = (acc.name || '').toString();
        const lowerName = name.toLowerCase();

        // Classification Priority: Default Code Prefix -> Keyword Match -> Metadata Fallback
        const isActivoType = reportBucket ? reportBucket === 'ASSET' : (/^1/.test(code) || /activo/i.test(t) || type.toLowerCase() === 'activo');
        const isPasivoType = reportBucket ? reportBucket === 'LIABILITY' : (/^2/.test(code) || /pasivo/i.test(t) || type.toLowerCase() === 'pasivo');
        const isPatrimonioType = reportBucket ? reportBucket === 'EQUITY' : (/^3/.test(code) || /patrimonio/i.test(t) || type.toLowerCase() === 'patrimonio');
        const isIngresoType = reportBucket ? reportBucket === 'REVENUE' : (/^4/.test(code) || /ingreso/i.test(t) || type.toLowerCase() === 'ingreso');
        const isEgresoType = reportBucket ? reportBucket === 'COST' : (/^5/.test(code) || /costo/i.test(t) || type.toLowerCase() === 'costo');
        const isGastoType = reportBucket ? reportBucket === 'EXPENSE' : (/^6/.test(code) || /gasto|egreso/i.test(t) || type.toLowerCase() === 'gasto' || type.toLowerCase() === 'egreso');

        const isReguladora = /regul/i.test(t);
        const isOrden = reportBucket ? reportBucket === 'ORDER' : /orden/i.test(t);
        const isResultado = /resulta/i.test(t);
        const isResultadosAcumulados = /resultad.*acumul/i.test(lowerName);
        const isProfitClearing = reportBucket === 'CLEARING' ||
            /p[eé]rdidas y ganancias|resultado del ejercicio|utilidad del ejercicio/i.test(lowerName);

        // Check if this is a variable-nature account (determined by balance, not type)
        const variablePatterns = [
            'diferencia de cambio', 'diferencias de cambio', 'tipo de cambio',
            'exposicion a la inflacion', 'exposición a la inflación',
            'ajuste por inflacion', 'ajuste por inflación', 'ajuste por inflacion y tenencia de bienes',
            'tenencia de bienes', 'reme', 'resultado monetario', 'resultados por exposicion a la inflacion',
            'mantenimiento de valor', 'mantenimiento del valor',
            'perdidas y ganancias', 'pérdidas y ganancias',
            'resultados de la gestion', 'resultados de la gestión',
            'resultado del ejercicio', 'resultado neto',
            'utilidad o perdida', 'utilidad o pérdida',
            'ganancia o perdida', 'ganancia o pérdida',
            'resultado extraordinario', 'resultados extraordinarios',
            'otros resultados', 'resultado integral'
        ];
        const isVariable = variablePatterns.some(p => lowerName.includes(p));

        // For variable accounts: classify as Gasto if debit balance (>=0), Ingreso if credit balance (<0)
        // For fixed-type accounts: use their type classification
        let finalGasto = false;
        let finalIngreso = false;

        if (isVariable) {
            // Variable nature: classification based on adjusted balance sign
            if (adjustedBalance >= 0) {
                finalGasto = true;  // Debit balance = Gasto
            } else {
                finalIngreso = true;  // Credit balance = Ingreso
            }
        } else {
            // Fixed nature: use type-based classification
            const resultadoAsGasto = isResultado && adjustedBalance >= 0;
            const resultadoAsIngreso = isResultado && adjustedBalance < 0;
            finalGasto = isGastoType || resultadoAsGasto || isEgresoType;
            finalIngreso = isIngresoType || resultadoAsIngreso;
        }

        if (reportBucket && !isProfitClearing) {
            finalGasto = reportBucket === 'EXPENSE' || reportBucket === 'COST';
            finalIngreso = reportBucket === 'REVENUE';
        }
        if (isProfitClearing) {
            finalGasto = false;
            finalIngreso = false;
        }

        // Reguladoras no deben ir a ER
        if (isReguladora) {
            finalGasto = false;
            finalIngreso = false;
        }

        return {
            isReguladora,
            isOrden,
            isResultado,
            isGasto: finalGasto,
            isIngreso: finalIngreso,
            isActivo: isActivoType,
            isPasivo: isPasivoType,
            isPatrimonio: isPatrimonioType,
            isResultadosAcumulados,
            isVariable
        };
    };

    const activos = accounts.filter(acc => classifyAccount(acc).isActivo);
    const pasivos = accounts.filter(acc => classifyAccount(acc).isPasivo);
    const patrimonio = accounts.filter(acc => {
        const c = classifyAccount(acc);
        // Excluir Resultados Acumulados y evitar solapamiento con Pasivo
        return c.isPatrimonio && !c.isResultadosAcumulados && !c.isPasivo;
    });
    const ingresos = accounts.filter(acc => classifyAccount(acc).isIngreso);
    const egresos = accounts.filter(acc => classifyAccount(acc).isGasto);

    // Nota: pasivos incluye cuentas tipo Pasivo y también cuentas Reguladoras (se muestran en P+P)
    const pasivosFinal = accounts.filter(acc => classifyAccount(acc).isPasivo);
    // Reassign pasivos variable used later
    const _pasivos = pasivosFinal;





    // Calcular totales - Balance de Comprobación (sin ajustes)
    const totalDebe = accounts.reduce((sum, acc) => sum + (acc.total_debit || 0), 0);
    const totalHaber = accounts.reduce((sum, acc) => sum + (acc.total_credit || 0), 0);

    // Calcular totales - Ajustes
    const totalAdjDebe = accounts.reduce((sum, acc) => sum + (acc.adj_debit || 0), 0);
    const totalAdjHaber = accounts.reduce((sum, acc) => sum + (acc.adj_credit || 0), 0);

    // Calcular saldos ajustados por cuenta
    // Calcular saldos ajustados por cuenta
    const getAdjustedBalance = (acc) => {
        const adjDeudor = (acc.total_debit || 0) + (acc.adj_debit || 0);
        const adjAcreedor = (acc.total_credit || 0) + (acc.adj_credit || 0);
        return bankersRound(adjDeudor - adjAcreedor, 2);
    };
    const getEndingBalance = (acc) => bankersRound(
        (Number(acc.ending_debit) || 0) - (Number(acc.ending_credit) || 0),
        2
    );

    // Totales usando saldos AJUSTADOS (Directed sums with strict rounding per step)
    const totalIngresos = bankersRound(ingresos.reduce((sum, acc) => bankersRound(sum - getAdjustedBalance(acc), 2), 0), 2);
    const totalEgresos = bankersRound(egresos.reduce((sum, acc) => bankersRound(sum + getAdjustedBalance(acc), 2), 0), 2);
    const totalActivos = bankersRound(activos.reduce((sum, acc) => bankersRound(sum + getEndingBalance(acc), 2), 0), 2);
    const totalPasivos = bankersRound(_pasivos.reduce((sum, acc) => bankersRound(sum - getEndingBalance(acc), 2), 0), 2);
    const totalPatrimonio = bankersRound(patrimonio.reduce((sum, acc) => bankersRound(sum - getEndingBalance(acc), 2), 0), 2);

    const utilidadNeta = bankersRound(totalIngresos - totalEgresos, 2);

    const handleExportExcel = () => {
        const exportData = accounts.map((acc, index) => {
            const balance = Number(acc.balance) || 0;
            const ajustado = getAdjustedBalance(acc);
            const final = getEndingBalance(acc);
            const deudor = Math.max(balance, 0);
            const acreedor = Math.max(-balance, 0);
            const cls = classifyAccount(acc);

            return {
                'Nº': index + 1,
                'Tipo': acc.type,
                'Código': acc.code,
                'Cuentas': acc.name,
                'BC Debe': (acc.total_debit || 0).toFixed(2),
                'BC Haber': (acc.total_credit || 0).toFixed(2),
                'BC Deudor': deudor.toFixed(2),
                'BC Acreedor': acreedor.toFixed(2),
                'Ajuste Debe': (Number(acc.adj_debit) || 0).toFixed(2),
                'Ajuste Haber': (Number(acc.adj_credit) || 0).toFixed(2),
                'BA Deudor': Math.max(ajustado, 0).toFixed(2),
                'BA Acreedor': Math.max(-ajustado, 0).toFixed(2),
                // usar clasificación flexible para ER y BG
                ...(() => {
                    return {
                        'ER Costo/Gasto': cls.isGasto ? ajustado.toFixed(2) : '0.00',
                        'ER Ingreso': cls.isIngreso ? (-ajustado).toFixed(2) : '0.00',
                        'BG Activo': cls.isActivo ? final.toFixed(2) : '0.00',
                        'BG Pasivo/Patrimonio': ((cls.isPasivo || cls.isPatrimonio) && !cls.isResultadosAcumulados) ? (-final).toFixed(2) : '0.00'
                    };
                })(),
                'Cierre Debe': (Number(acc.closing_debit) || 0).toFixed(2),
                'Cierre Haber': (Number(acc.closing_credit) || 0).toFixed(2),
                'Orden Deudoras': cls.isOrden ? Math.max(ajustado, 0).toFixed(2) : '0.00',
                'Orden Acreedoras': cls.isOrden ? Math.max(-ajustado, 0).toFixed(2) : '0.00'
            };
        });
        exportToExcel(exportData, 'Hoja de Trabajo', 'hoja_trabajo_completa');
    };

    const handleExportPDF = () => {
        const columns = [
            { header: 'Cuenta', field: 'name' },
            { header: 'BC Debe', field: 'total_debit' },
            { header: 'BC Haber', field: 'total_credit' },
            { header: 'ER Ingreso', field: 'er_ingreso' },
            { header: 'ER Costo', field: 'er_costo' },
            { header: 'BG Activo', field: 'bg_activo' },
            { header: 'BG P+P', field: 'bg_pasivo' }
        ];

        // Fiscal period logic
        let subText = `al ${format(new Date(), 'dd/MM/yyyy')}`;
        if (selectedCompany?.current_year && selectedCompany?.activity_type) {
            const fiscal = getFiscalYearDetails(selectedCompany.activity_type, selectedCompany.current_year, selectedCompany.operation_start_date);
            const fStart = new Date(fiscal.startDate + 'T00:00:00');
            const fEnd = new Date(fiscal.endDate + 'T00:00:00');
            const formatSpanish = (d) => format(d, "d 'de' MMMM 'de' yyyy", { locale: es });
            subText = `del ${formatSpanish(fStart)} al ${formatSpanish(fEnd)}`;
        }

        exportToPDF(accounts, columns, 'Hoja de Trabajo', {
            subtitle: `Empresa: ${selectedCompany?.name} - Periodo: ${subText}`,
            orientation: 'landscape',
            hideDefaultDate: !!(selectedCompany?.current_year)
        });
    };

    // Validación de saldos
    const validarSaldo = (acc) => {
        const bcBalance = Number(acc.balance) || 0;
        const deudor = Math.max(bcBalance, 0);
        const acreedor = Math.max(-bcBalance, 0);
        const saldoBC = deudor - acreedor;
        const calculado = (acc.total_debit || 0) - (acc.total_credit || 0);
        return Math.abs(saldoBC - calculado) < 0.01; // Tolerancia de 1 centavo
    };

    // --- Editable rows (desde UTILIDAD BRUTA para abajo) ---
    const [adjustments, setAdjustments] = useState([]); // {id,label,input}
    const [editingAdjId, setEditingAdjId] = useState(null);

    const findResultadosAcumuladosAccount = () => {
        return accounts.find(a => /(resultad.*acumul)/i.test(a.name || '') && (a.type || '').toString().toLowerCase() === 'patrimonio') || null;
    };

    const resultadosAcumAccount = findResultadosAcumuladosAccount();
    const rawBalance = Number(resultadosAcumAccount ? getEndingBalance(resultadosAcumAccount) : 0);
    // RA_raw keeps signed value for formulas/context; RA_initial is the positive magnitude
    const RA_raw = rawBalance;

    const evaluateExpression = (raw, ctx) => {
        if (raw === null || raw === undefined) return 0;
        const s = raw.toString().trim();
        if (s === '') return 0;
        // If it's a plain number
        if (!isNaN(Number(s))) return Number(s);
        // If starts with '=' remove it
        const expr = s.startsWith('=') ? s.slice(1) : s;
        // Replace ranges like I1:I3 with SUM of those cells (editable area cell refs)
        let replaced = expr.replace(/\b(I\d+):(I\d+)\b/g, (m, a, b) => {
            try {
                const ai = parseInt(a.slice(1), 10);
                const bi = parseInt(b.slice(1), 10);
                const start = Math.min(ai, bi);
                const end = Math.max(ai, bi);
                const parts = [];
                for (let k = start; k <= end; k++) {
                    const v = getEditableCellValue(`I${k}`);
                    parts.push(`(${Number(v) || 0})`);
                }
                return parts.join('+');
            } catch (e) {
                return '0';
            }
        });

        // Replace identifiers with values from ctx or editable cells
        replaced = replaced.replace(/\b[A-Za-z_]\w*\b/g, (m) => {
            if (ctx && ctx.hasOwnProperty(m)) return `(${Number(ctx[m]) || 0})`;
            // editable cell refs like I1, TAX, UB, RA, UN, UL
            const v = getEditableCellValue(m);
            if (v !== null) return `(${Number(v) || 0})`;
            return m;
        });
        // Allow only numbers and operators
        if (/[^0-9+\-*/().\s]/.test(replaced)) return 0;
        try {
            // eslint-disable-next-line no-new-func
            return Function(`"use strict"; return (${replaced});`)();
        } catch (e) {
            return 0;
        }
    };

    // Editable cells helpers
    const getEditableKeys = () => {
        // Order: TAX (I1), adjustments I2..In, UL final as last
        const keys = [];
        keys.push('TAX');
        adjustments.forEach((a, idx) => keys.push(`I${idx + 2}`));
        keys.push('UL');
        return keys;
    };

    const getEditableCellValue = (ref, visited = new Set()) => {
        if (!ref) return null;
        // Known aliases
        if (ref === 'TAX' || /^I\d+$/.test(ref) || ref === 'UL') {
            // prevent recursion loops
            if (visited.has(ref)) return 0;
            visited.add(ref);

            if (ref === 'TAX') return 0;
            if (ref === 'UL') return utilidadNeta;
            // I# mapping: I2.. map to adjustments[0] onwards (I2 -> adjustments[0])
            const idx = parseInt(ref.slice(1), 10);
            if (idx >= 2) {
                const adjIndex = idx - 2;
                const adj = adjustments[adjIndex];
                if (!adj) return 0;
                return evaluateExpression(adj.input || '0', { ...ctxBase, TAX: computedTax, UN: utilidadNetaAfterTax, UL: utilidadLiquida });
            }
        }
        // fallback: attempt ctxBase
        if (ctxBase && ctxBase.hasOwnProperty(ref)) return ctxBase[ref];
        return null;
    };

    // Helpers para ajustes editables
    const addAdjustment = (position = 'end', refId = null) => {
        const newAdj = { id: Date.now(), label: 'Ajuste', input: '0' };
        if (position === 'start') {
            const arr = [newAdj, ...adjustments];
            setAdjustments(arr);
            setSelectedAdjId(newAdj.id);
            return;
        }
        if (position === 'after' && refId) {
            const idx = adjustments.findIndex(a => a.id === refId);
            if (idx === -1) {
                const arr = [...adjustments, newAdj];
                setAdjustments(arr);
                setSelectedAdjId(newAdj.id);
                return;
            }
            const arr = [...adjustments]; arr.splice(idx + 1, 0, newAdj);
            setAdjustments(arr);
            setSelectedAdjId(newAdj.id);
            return;
        }
        const arr = [...adjustments, newAdj];
        setAdjustments(arr);
        setSelectedAdjId(newAdj.id);
    };
    const updateAdjustment = (id, field, value) => setAdjustments(adjustments.map(a => a.id === id ? { ...a, [field]: value } : a));
    const removeAdjustment = (id) => setAdjustments(adjustments.filter(a => a.id !== id));
    const moveAdjustment = (id, dir) => {
        const idx = adjustments.findIndex(a => a.id === id);
        if (idx === -1) return;
        const arr = [...adjustments];
        const [item] = arr.splice(idx, 1);
        const newIndex = Math.max(0, Math.min(arr.length, dir === 'up' ? idx - 1 : idx + 1));
        arr.splice(newIndex, 0, item);
        setAdjustments(arr);
    };

    const [selectedAdjId, setSelectedAdjId] = useState(null);
    const [blockOverrides, setBlockOverrides] = useState({});

    const formatEditableNumber = (value) => {
        if (value === null || value === undefined || value === '') return '';
        const num = Number(value);
        return Number.isFinite(num) ? num.toFixed(2) : value;
    };

    const getBlockValue = (rowKey, colKey, fallback) => {
        const key = `${rowKey}:${colKey}`;
        const val = blockOverrides[key];
        // Treat undefined, null, or empty string as "no override"
        if (val !== undefined && val !== null && val !== '') return val;
        return formatEditableNumber(fallback);
    };

    const getNumericBlock = (rowKey, colKey, fallback = 0) => {
        const raw = getBlockValue(rowKey, colKey, fallback);
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    };

    // Columnas secundarias que se ocultan en mobile (clases definidas en index.css).
    // Nº/TIPO desaparecen en <=991px; los saldos DEUDOR/ACREEDOR del BC en <=575px.
    const MOBILE_COL_HIDE = {
        N: 'col-hide-md',
        TIPO: 'col-hide-md',
        BC_DEUDOR: 'col-hide-sm',
        BC_ACREEDOR: 'col-hide-sm'
    };

    const renderEditableCell = (rowKey, colKey, fallback = '', options = {}) => {
        const { align, placeholder, minWidth, onChange, skipDefaultUpdate } = options;
        const value = getBlockValue(rowKey, colKey, fallback);
        const alignClass = align === 'left' ? '' : 'text-end';
        const hideClass = MOBILE_COL_HIDE[colKey] || '';
        return (
            <td className={`${alignClass} ${hideClass}`.trim()}>
                <input
                    type="text"
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => {
                        const v = e.target.value;
                        if (onChange) onChange(v);
                        if (!skipDefaultUpdate) {
                            setBlockOverrides(prev => ({ ...prev, [`${rowKey}:${colKey}`]: v }));
                        }
                    }}
                    className={`form-control form-control-sm border-0 bg-transparent p-0 ${alignClass}`}
                    style={{ minWidth: minWidth || '5rem', fontFamily: 'inherit', fontSize: '0.7rem', lineHeight: '1.2' }}
                />
            </td>
        );
    };

    const renderAccountCell = (rowKey, defaultLabel, badgeLabel) => {
        const listId = `list-${rowKey}`;
        return (
            <td className="align-middle sticky-col">
                <div className="d-flex align-items-center">
                    <input
                        type="text"
                        list={listId}
                        value={getBlockValue(rowKey, 'CTA', defaultLabel)}
                        onChange={(e) => handleAccountNameChange(rowKey, e.target.value)}
                        className="form-control form-control-sm border-0 bg-transparent p-0"
                        style={{ minWidth: '14rem', fontFamily: 'inherit', fontSize: '0.7rem', lineHeight: '1.2' }}
                    />
                    {badgeLabel && <span className="badge bg-secondary ms-2">{badgeLabel}</span>}
                </div>
                <datalist id={listId}>
                    {accounts.map(acc => (
                        <option key={`${listId}-${acc.id || acc.code || acc.name}`} value={acc.name || ''}>
                            {(acc.code || '') + ' ' + (acc.type || '')}
                        </option>
                    ))}
                </datalist>
            </td>
        );
    };

    const findAccountByName = (name = '') => {
        const term = name.toString().trim().toLowerCase();
        if (!term) return null;
        return accounts.find(a => (a.name || '').toString().trim().toLowerCase() === term) || null;
    };

    const handleAccountNameChange = (rowKey, value) => {
        setBlockOverrides(prev => {
            const next = { ...prev, [`${rowKey}:CTA`]: value };
            const acc = findAccountByName(value);
            if (acc) {
                next[`${rowKey}:TIPO`] = acc.type || '';
                next[`${rowKey}:COD`] = acc.code || '';
            }
            return next;
        });
    };

    // Persistencia local
    const saveEditableSection = () => {
        if (!selectedCompany?.id) return;
        const payload = {
            adjustments,
            blockOverrides
        };
        const key = `worksheet_custom_section_${selectedCompany.id}`;
        localStorage.setItem(key, JSON.stringify(payload));
        alert('Guardado localmente para esta empresa');
    };

    const loadEditableSection = () => {
        if (!selectedCompany?.id) return;
        try {
            const key = `worksheet_custom_section_${selectedCompany.id}`;
            const raw = localStorage.getItem(key);
            if (!raw) {
                // Reset to defaults if no saved state
                setAdjustments([]);
                setBlockOverrides({});
                return;
            }
            const obj = JSON.parse(raw);
            if (Array.isArray(obj.adjustments)) setAdjustments(obj.adjustments);
            if (obj.blockOverrides && typeof obj.blockOverrides === 'object') setBlockOverrides(obj.blockOverrides);
        } catch (e) {
            // ignore
        }
    };

    useEffect(() => {
        if (selectedCompany?.id) {
            loadEditableSection();
        }
    }, [selectedCompany?.id]);

    // Context variables available in formulas
    const UB = utilidadNeta; // reutilizamos utilidadNeta actual como "utilidad bruta"
    const ctxBase = { UB, RA: RA_raw };

    const computedTax = 0;
    const utilidadNetaAfterTax = UB;
    const utilidadLiquida = utilidadNeta;

    // Valores editables del bloque (suman en totales en vivo)

    const editableRows = ['UB', 'UN', 'UL', 'RA_ROW'];
    const sumEditable = (col) => bankersRound(editableRows.reduce((s, rk) => bankersRound(s + getNumericBlock(rk, col, 0), 2), 0), 2);

    const adjustmentRefs = adjustments.map((_, idx) => `I${idx + 2}`);
    const sumAdjustments = (col) => bankersRound(adjustmentRefs.reduce((s, ref) => bankersRound(s + getNumericBlock(ref, col, 0), 2), 0), 2);
    const adjIngresoExtra = bankersRound(adjustmentRefs.reduce((s, ref) => {
        const formulaValue = Number(getEditableCellValue(ref)) || 0;
        const v = getNumericBlock(ref, 'ER_INGRESO', formulaValue >= 0 ? formulaValue : 0);
        return v >= 0 ? bankersRound(s + v, 2) : s;
    }, 0), 2);
    const adjCostoExtra = bankersRound(adjustmentRefs.reduce((s, ref) => {
        const formulaValue = Number(getEditableCellValue(ref)) || 0;
        const v = getNumericBlock(ref, 'ER_COSTO', formulaValue < 0 ? Math.abs(formulaValue) : 0);
        return v < 0 ? bankersRound(s + Math.abs(v), 2) : bankersRound(s + Math.max(v, 0), 2);
    }, 0), 2);

    const erIncomeBeforeResult = bankersRound(totalIngresos + adjIngresoExtra, 2);
    const erExpenseBeforeResult = bankersRound(totalEgresos + adjCostoExtra, 2);
    const erResult = bankersRound(erIncomeBeforeResult - erExpenseBeforeResult, 2);
    const totalIngresosDyn = bankersRound(erIncomeBeforeResult + Math.max(-erResult, 0), 2);
    const totalEgresosDyn = bankersRound(erExpenseBeforeResult + Math.max(erResult, 0), 2);
    const utilidadLiquidaDyn = erResult;

    // RA (aggregated) split into cierre debe/haber as sum of magnitudes (no net subtraction)
    const raAggregate = accounts.reduce((s, a) => {
        const cls = classifyAccount(a);
        if (!cls.isResultadosAcumulados) return s;
        const bal = getEndingBalance(a);
        if (bal >= 0) s.debe = bankersRound(s.debe + Math.abs(bal), 2);
        else s.haber = bankersRound(s.haber + Math.abs(bal), 2);
        return s;
    }, { debe: 0, haber: 0 });

    // net effect of RA on patrimonio: credits (haber) increase P+P, debits decrease
    const raNet = bankersRound(raAggregate.haber - raAggregate.debe, 2);

    // BG por columna (dinámico con bloque editable + ajustes + lógica automática)
    const sumBGCol = (col, rowKey, autoVal) => {
        const override = getNumericBlock(rowKey, col, 0);
        const value = getNumericBlock(rowKey, col, autoVal);
        return { override, value };
    };

    // BG Activos: Usually none of the final rows have assets, but to stay consistent:
    const ubActivo = sumBGCol('BG_ACTIVO', 'UB', 0);
    const unActivo = sumBGCol('BG_ACTIVO', 'UN', 0);
    const impActivo = { override: 0, value: 0 };
    const rlActivo = { override: 0, value: 0 };
    const niInactive = { override: 0, value: 0 };
    const ulActivo = sumBGCol('BG_ACTIVO', 'UL', 0);
    const raActivo = sumBGCol('BG_ACTIVO', 'RA_ROW', 0);

    const bgActivoBlock = bankersRound((sumEditable('BG_ACTIVO') - ubActivo.override - niInactive.override - unActivo.override - impActivo.override - rlActivo.override - ulActivo.override - raActivo.override)
        + ubActivo.value + niInactive.value + unActivo.value + impActivo.value + rlActivo.value + ulActivo.value + raActivo.value, 2);

    // BG Pasivo + Patrimonio
    const ubPP = sumBGCol('BG_PP', 'UB', 0);
    const niPP = { override: 0, value: 0 };
    const unPP = sumBGCol('BG_PP', 'UN', 0);
    const impPP = { override: 0, value: 0 };
    const rlPP = { override: 0, value: 0 };
    const ulPP = sumBGCol('BG_PP', 'UL', 0);
    const unpostedResult = hasResultClosing ? 0 : utilidadLiquidaDyn;
    const raPP = sumBGCol('BG_PP', 'RA_ROW', bankersRound(raNet + unpostedResult, 2));

    const bgPPExtra = bankersRound((sumEditable('BG_PP') - ubPP.override - niPP.override - unPP.override - impPP.override - rlPP.override - ulPP.override - raPP.override)
        + sumAdjustments('BG_PP')
        + ubPP.value + niPP.value + unPP.value + impPP.value + rlPP.value + ulPP.value + raPP.value, 2);

    const totalActivosDyn = bankersRound(totalActivos + bgActivoBlock, 2);
    const totalPasivosPatrimonioDyn = bankersRound(totalPasivos + totalPatrimonio + bgPPExtra, 2);

    const totalCierreDebe = bankersRound(accounts.reduce((sum, acc) => sum + (Number(acc.closing_debit) || 0), 0), 2);
    const totalCierreHaber = bankersRound(accounts.reduce((sum, acc) => sum + (Number(acc.closing_credit) || 0), 0), 2);
    const totalOrdenDeudoras = bankersRound(accounts.reduce((sum, acc) => {
        const balance = classifyAccount(acc).isOrden ? getAdjustedBalance(acc) : 0;
        return sum + Math.max(balance, 0);
    }, 0), 2);
    const totalOrdenAcreedoras = bankersRound(accounts.reduce((sum, acc) => {
        const balance = classifyAccount(acc).isOrden ? getAdjustedBalance(acc) : 0;
        return sum + Math.max(-balance, 0);
    }, 0), 2);

    // (removed visible debug panel)

    // (removed duplicate totalCierre calculations - totals computed above as totalCierreDebe/totalCierreHaber)
    const tolerance = 0.01;
    const diffBalance = Number(Math.abs(totalActivosDyn - totalPasivosPatrimonioDyn).toFixed(2));
    const isBalanced = diffBalance <= tolerance;

    return (
        <div>
            <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3 mb-4">
                <div>
                    <h2 className="mb-1"><i className="bi bi-file-earmark-spreadsheet me-2"></i>Hoja de Trabajo</h2>
                    <p className="text-light opacity-75 mb-0">Borrador auxiliar; no interviene en la generación de estados financieros ni del cierre.</p>
                </div>
                <div className="d-flex flex-wrap gap-2 align-items-center">
                    {mahoragaActive && <MahoragaWheel size="small" />}
                    <button className="btn btn-outline-primary btn-sm" onClick={fetchWorksheetData} disabled={loading}>
                        <i className="bi bi-arrow-clockwise me-1"></i> Recargar
                    </button>

                    <div className="vr d-none d-md-block"></div>
                    <button className="btn btn-outline-success btn-sm" onClick={handleExportExcel} disabled={loading}>
                        <i className="bi bi-file-earmark-excel me-1"></i> Excel
                    </button>
                </div>
            </div>

            {/* Debug panel removed */}

            {/* Summary Cards */}
            <div className="row g-3 mb-4">
                <div className="col-md-3">
                    <div className="card glass-panel border-primary text-white h-100">
                        <div className="card-body">
                            <small className="text-info opacity-75 d-flex align-items-center mb-1"><i className="bi bi-wallet2 me-2"></i>Total Activos</small>
                            <h4 className="mb-0 fw-bold">Bs {totalActivosDyn.toFixed(2)}</h4>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card glass-panel border-danger text-white h-100">
                        <div className="card-body">
                            <small className="text-danger opacity-75 d-flex align-items-center mb-1"><i className="bi bi-bank me-2"></i>Pasivos + Patrimonio</small>
                            <h4 className="mb-0 fw-bold">Bs {totalPasivosPatrimonioDyn.toFixed(2)}</h4>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card glass-panel border-warning text-white h-100">
                        <div className="card-body">
                            <small className="text-warning opacity-75 d-block mb-1"><i className="bi bi-shield-exclamation me-2"></i>IUE / reserva legal</small>
                            <h4 className="mb-0 fw-bold">No calculados</h4>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className={`card glass-panel border-${utilidadLiquidaDyn >= 0 ? 'info' : 'warning'} text-white h-100`}>
                        <div className="card-body">
                            <small className={`text-${utilidadLiquidaDyn >= 0 ? 'info' : 'warning'} opacity-75 d-flex align-items-center mb-1`}>
                                <i className={`bi bi-${utilidadLiquidaDyn >= 0 ? 'graph-up-arrow' : 'graph-down-arrow'} me-2`}></i>
                                {utilidadLiquidaDyn >= 0 ? 'Resultado contable' : 'Pérdida contable'}
                            </small>
                            <h4 className="mb-0 fw-bold">Bs {utilidadLiquidaDyn.toFixed(2)}</h4>
                        </div>
                    </div>
                </div>
            </div>

            {/* Hoja de Trabajo completa */}
            <div className="card glass-panel border-secondary shadow-sm mb-4">
                <div className="card-header border-secondary border-bottom">
                    <h5 className="mb-0 text-white"><i className="bi bi-table me-2"></i>Hoja de Trabajo - 20 columnas</h5>
                </div>
                <div className="px-3 pb-2 small text-white-50">
                    Borrador auxiliar del período fiscal; los estados financieros y el cierre se calculan de forma independiente.
                </div>
                {worksheetClosingWarning && (
                    <div className="mx-3 mb-2 alert alert-secondary py-2 small" role="status">Cierre auxiliar: {worksheetClosingWarning}</div>
                )}
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-sm table-dark table-bordered mb-0 border-secondary" style={{ fontSize: '0.7rem', backgroundColor: 'transparent' }}>
                            <thead className="sticky-top" style={{ backgroundColor: 'rgb(11, 14, 20)' }}>
                                <tr>
                                    <th rowSpan="2" className="align-middle text-center col-hide-md" style={{ minWidth: '40px' }}>Nº</th>
                                    <th rowSpan="2" className="align-middle text-center col-hide-md" style={{ minWidth: '70px' }}>TIPO</th>
                                    <th rowSpan="2" className="align-middle text-center" style={{ minWidth: '70px' }}>CÓDIGO</th>
                                    <th rowSpan="2" className="align-middle sticky-col" style={{ minWidth: '180px' }}>CUENTAS</th>
                                    <th colSpan={isMobile ? 2 : 4} className="text-center bg-primary text-white">BALANCE DE COMPROBACIÓN</th>
                                    <th colSpan="2" className="text-center bg-warning">AJUSTES</th>
                                    <th colSpan="2" className="text-center bg-success text-white">BALANCE AJUSTADO</th>
                                    <th colSpan="2" className="text-center bg-info text-white">ESTADO DE RESULTADOS</th>
                                    <th colSpan="2" className="text-center bg-danger text-white">BALANCE GENERAL</th>
                                    <th colSpan="2" className="text-center bg-secondary text-white">CIERRE</th>
                                    <th colSpan="2" className="text-center bg-dark text-white">CUENTAS DE ORDEN</th>
                                </tr>
                                <tr>
                                    {/* Balance de Comprobación */}
                                    <th className="text-center bg-primary bg-opacity-10" style={{ minWidth: '75px' }}>DEBE</th>
                                    <th className="text-center bg-primary bg-opacity-10" style={{ minWidth: '75px' }}>HABER</th>
                                    <th className="text-center bg-primary bg-opacity-10 col-hide-sm" style={{ minWidth: '75px' }}>DEUDOR</th>
                                    <th className="text-center bg-primary bg-opacity-10 col-hide-sm" style={{ minWidth: '75px' }}>ACREEDOR</th>
                                    {/* Ajustes */}
                                    <th className="text-center bg-warning bg-opacity-25" style={{ minWidth: '75px' }}>DEBE</th>
                                    <th className="text-center bg-warning bg-opacity-25" style={{ minWidth: '75px' }}>HABER</th>
                                    {/* Balance Ajustado */}
                                    <th className="text-center bg-success bg-opacity-10" style={{ minWidth: '75px' }}>DEUDOR</th>
                                    <th className="text-center bg-success bg-opacity-10" style={{ minWidth: '75px' }}>ACREEDOR</th>
                                    {/* Estado de Resultados */}
                                    <th className="text-center bg-info bg-opacity-10" style={{ minWidth: '85px' }}>COSTO/GASTO</th>
                                    <th className="text-center bg-info bg-opacity-10" style={{ minWidth: '75px' }}>INGRESO</th>
                                    {/* Balance General */}
                                    <th className="text-center bg-danger bg-opacity-10" style={{ minWidth: '75px' }}>ACTIVO</th>
                                    <th className="text-center bg-danger bg-opacity-10" style={{ minWidth: '100px' }}>PASIVO/PATRIMONIO</th>
                                    {/* Cierre */}
                                    <th className="text-center bg-secondary bg-opacity-25" style={{ minWidth: '75px' }}>DEBE</th>
                                    <th className="text-center bg-secondary bg-opacity-25" style={{ minWidth: '75px' }}>HABER</th>
                                    {/* Cuentas de Orden */}
                                    <th className="text-center bg-dark bg-opacity-50" style={{ minWidth: '75px' }}>DEUDORAS</th>
                                    <th className="text-center bg-dark bg-opacity-50" style={{ minWidth: '85px' }}>ACREEDORAS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan="20" className="text-center py-4">
                                            <div className="spinner-border text-primary" role="status">
                                                <span className="visually-hidden">Cargando...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : accounts.length === 0 ? (
                                    <tr>
                                        <td colSpan="20" className="text-center py-4 text-muted">
                                            <i className="bi bi-inbox me-2"></i>No hay datos disponibles
                                        </td>
                                    </tr>
                                ) : (
                                    <>
                                        {accounts.map((acc, index) => {
                                            const cls = classifyAccount(acc);
                                            const isReguladora = cls.isReguladora;
                                            // Reguladoras no van al ER
                                            const bcBalance = Number(acc.balance) || 0;
                                            const deudor = Math.max(bcBalance, 0);
                                            const acreedor = Math.max(-bcBalance, 0);
                                            const isValid = validarSaldo(acc);

                                            return (
                                                <tr key={acc.id} className={!isValid ? 'table-warning' : ''}>
                                                    <td className="text-center col-hide-md"><small>{index + 1}</small></td>
                                                    <td className="text-center col-hide-md"><span className={`badge bg-${acc.type === 'Activo' ? 'primary' : acc.type === 'Pasivo' ? 'danger' : acc.type === 'Patrimonio' ? 'info' : acc.type === 'Ingreso' ? 'success' : 'warning'} badge-sm`}>{acc.type}</span></td>
                                                    <td className="text-center"><small><code>{acc.code}</code></small></td>
                                                    <td className="sticky-col"><small>{acc.name}</small></td>
                                                    {/* Balance de Comprobación */}
                                                    <td className="text-end">{(acc.total_debit || 0).toFixed(2)}</td>
                                                    <td className="text-end">{(acc.total_credit || 0).toFixed(2)}</td>
                                                    <td className="text-end col-hide-sm">{deudor > 0 ? deudor.toFixed(2) : ''}</td>
                                                    <td className="text-end col-hide-sm">{acreedor > 0 ? acreedor.toFixed(2) : ''}</td>
                                                    {/* Ajustes - show actual adjustment amounts */}
                                                    <td className="text-end">{(acc.adj_debit || 0) > 0 ? (acc.adj_debit).toFixed(2) : ''}</td>
                                                    <td className="text-end">{(acc.adj_credit || 0) > 0 ? (acc.adj_credit).toFixed(2) : ''}</td>
                                                    {/* Balance Ajustado = BC + Ajustes */}
                                                    {(() => {
                                                        // Calculate adjusted balance
                                                        const adjDeudor = (acc.total_debit || 0) + (acc.adj_debit || 0);
                                                        const adjAcreedor = (acc.total_credit || 0) + (acc.adj_credit || 0);
                                                        const adjBalance = adjDeudor - adjAcreedor;
                                                        const adjDeudorFinal = adjBalance >= 0 ? Math.abs(adjBalance) : 0;
                                                        const adjAcreedorFinal = adjBalance < 0 ? Math.abs(adjBalance) : 0;
                                                        return (
                                                            <>
                                                                <td className="text-end">{adjDeudorFinal > 0 ? adjDeudorFinal.toFixed(2) : ''}</td>
                                                                <td className="text-end">{adjAcreedorFinal > 0 ? adjAcreedorFinal.toFixed(2) : ''}</td>
                                                            </>
                                                        );
                                                    })()}
                                                    {/* Estado de Resultados - use adjusted balance */}
                                                    {(() => {
                                                        const adjDeudor = (acc.total_debit || 0) + (acc.adj_debit || 0);
                                                        const adjAcreedor = (acc.total_credit || 0) + (acc.adj_credit || 0);
                                                        const adjBal = adjDeudor - adjAcreedor;
                                                        return (
                                                            <>
                                                                <td className="text-end">{(cls.isGasto && !isReguladora) ? adjBal.toFixed(2) : ''}</td>
                                                                <td className="text-end">{(cls.isIngreso && !isReguladora) ? (-adjBal).toFixed(2) : ''}</td>
                                                            </>
                                                        );
                                                    })()}
                                                    {/* Balance General - use adjusted balance */}
                                                    {(() => {
                                                        return (
                                                            <>
                                                                {/* Los saldos de BG son acumulados a fecha de cierre, no solo movimientos del período. */}
                                                                <td className="text-end">{cls.isActivo ? getEndingBalance(acc).toFixed(2) : ''}</td>
                                                                <td className="text-end">{((cls.isPasivo || cls.isPatrimonio) && !cls.isResultadosAcumulados) ? (-getEndingBalance(acc)).toFixed(2) : ''}</td>
                                                            </>
                                                        );
                                                    })()}
                                                    <td className="text-end">{acc.closing_debit > 0 ? Number(acc.closing_debit).toFixed(2) : ''}</td>
                                                    <td className="text-end">{acc.closing_credit > 0 ? Number(acc.closing_credit).toFixed(2) : ''}</td>
                                                    <td className="text-end">{cls.isOrden && getAdjustedBalance(acc) > 0 ? getAdjustedBalance(acc).toFixed(2) : ''}</td>
                                                    <td className="text-end">{cls.isOrden && getAdjustedBalance(acc) < 0 ? Math.abs(getAdjustedBalance(acc)).toFixed(2) : ''}</td>
                                                </tr>
                                            );
                                        })}

                                        {/* Fila de Utilidad/Pérdida */}
                                        {/* --- UTILIDAD BRUTA y sección editable --- */}
                                        <tr className={`fw-bold ${utilidadLiquidaDyn >= 0 ? 'table-success' : 'table-danger'}`}>
                                            {renderEditableCell('UB', 'N', '')}
                                            {renderEditableCell('UB', 'TIPO', '', { align: 'left', minWidth: '4rem' })}
                                            {renderEditableCell('UB', 'COD', '', { align: 'left', minWidth: '4rem' })}
                                            {renderAccountCell('UB', 'RESULTADO CONTABLE (cuadre del ER)', 'R')}
                                            {renderEditableCell('UB', 'BC_DEBE', '')}
                                            {renderEditableCell('UB', 'BC_HABER', '')}
                                            {renderEditableCell('UB', 'BC_DEUDOR', '')}
                                            {renderEditableCell('UB', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('UB', 'AJ_DEBE', '')}
                                            {renderEditableCell('UB', 'AJ_HABER', '')}
                                            {renderEditableCell('UB', 'BA_DEUDOR', '')}
                                            {renderEditableCell('UB', 'BA_ACREEDOR', '')}
                                            <td className="text-end">{utilidadLiquidaDyn > 0 ? utilidadLiquidaDyn.toFixed(2) : ''}</td>
                                            <td className="text-end">{utilidadLiquidaDyn < 0 ? Math.abs(utilidadLiquidaDyn).toFixed(2) : ''}</td>
                                            {renderEditableCell('UB', 'BG_ACTIVO', '')}
                                            {renderEditableCell('UB', 'BG_PP', '')}
                                            {renderEditableCell('UB', 'CI_DEBE', '')}
                                            {renderEditableCell('UB', 'CI_HABER', '')}
                                            {renderEditableCell('UB', 'OR_DEUDOR', '')}
                                            {renderEditableCell('UB', 'OR_ACREEDOR', '')}
                                        </tr>

                                        {/* Impuesto sobre las utilidades (editable) */}
                                        <tr>
                                            {renderEditableCell('IMP', 'N', '')}
                                            {renderEditableCell('IMP', 'TIPO', '', { align: 'left', minWidth: '4rem' })}
                                            {renderEditableCell('IMP', 'COD', '', { align: 'left', minWidth: '4rem' })}
                                            {renderAccountCell('IMP', 'IUE (requiere conciliación tributaria)', 'IUE')}
                                            {renderEditableCell('IMP', 'BC_DEBE', '')}
                                            {renderEditableCell('IMP', 'BC_HABER', '')}
                                            {renderEditableCell('IMP', 'BC_DEUDOR', '')}
                                            {renderEditableCell('IMP', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('IMP', 'AJ_DEBE', '')}
                                            {renderEditableCell('IMP', 'AJ_HABER', '')}
                                            {renderEditableCell('IMP', 'BA_DEUDOR', '')}
                                            {renderEditableCell('IMP', 'BA_ACREEDOR', '')}
                                            {renderEditableCell('IMP', 'ER_COSTO', '')}
                                            <td className="text-end text-white-50">No calculado</td>
                                            {renderEditableCell('IMP', 'BG_ACTIVO', '')}
                                            {renderEditableCell('IMP', 'BG_PP', '')}
                                            {renderEditableCell('IMP', 'CI_DEBE', '')}
                                            {renderEditableCell('IMP', 'CI_HABER', '')}
                                            {renderEditableCell('IMP', 'OR_DEUDOR', '')}
                                            {renderEditableCell('IMP', 'OR_ACREEDOR', '')}
                                        </tr>

                                        {/* Conciliación tributaria (referencia, no modifica el ER contable) */}
                                        <tr className="table-success">
                                            {renderEditableCell('NI', 'N', '')}
                                            {renderEditableCell('NI', 'TIPO', '', { align: 'left', minWidth: '4rem' })}
                                            {renderEditableCell('NI', 'COD', '', { align: 'left', minWidth: '4rem' })}
                                            {renderAccountCell('NI', 'AJUSTES DE CONCILIACIÓN TRIBUTARIA', 'CT')}
                                            {renderEditableCell('NI', 'BC_DEBE', '')}
                                            {renderEditableCell('NI', 'BC_HABER', '')}
                                            {renderEditableCell('NI', 'BC_DEUDOR', '')}
                                            {renderEditableCell('NI', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('NI', 'AJ_DEBE', '')}
                                            {renderEditableCell('NI', 'AJ_HABER', '')}
                                            {renderEditableCell('NI', 'BA_DEUDOR', '')}
                                            {renderEditableCell('NI', 'BA_ACREEDOR', '')}
                                            {renderEditableCell('NI', 'ER_COSTO', '')}
                                            <td className="text-end"></td>
                                            {renderEditableCell('NI', 'BG_ACTIVO', '')}
                                            {renderEditableCell('NI', 'BG_PP', '')}
                                            {renderEditableCell('NI', 'CI_DEBE', '')}
                                            {renderEditableCell('NI', 'CI_HABER', '')}
                                            {renderEditableCell('NI', 'OR_DEUDOR', '')}
                                            {renderEditableCell('NI', 'OR_ACREEDOR', '')}
                                        </tr>


                                        {/* Resultado contable (sin estimación de impuesto) */}
                                        <tr className="fw-bold">
                                            {renderEditableCell('UN', 'N', '')}
                                            {renderEditableCell('UN', 'TIPO', '', { align: 'left', minWidth: '4rem' })}
                                            {renderEditableCell('UN', 'COD', '', { align: 'left', minWidth: '4rem' })}
                                            {renderAccountCell('UN', `${utilidadLiquidaDyn >= 0 ? 'RESULTADO CONTABLE DEL PERÍODO' : 'PÉRDIDA CONTABLE DEL PERÍODO'}`, null)}
                                            {renderEditableCell('UN', 'BC_DEBE', '')}
                                            {renderEditableCell('UN', 'BC_HABER', '')}
                                            {renderEditableCell('UN', 'BC_DEUDOR', '')}
                                            {renderEditableCell('UN', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('UN', 'AJ_DEBE', '')}
                                            {renderEditableCell('UN', 'AJ_HABER', '')}
                                            {renderEditableCell('UN', 'BA_DEUDOR', '')}
                                            {renderEditableCell('UN', 'BA_ACREEDOR', '')}
                                            <td className="text-end"></td>
                                            <td className="text-end"></td>
                                            {renderEditableCell('UN', 'BG_ACTIVO', '')}
                                            {renderEditableCell('UN', 'BG_PP', '')}
                                            {renderEditableCell('UN', 'CI_DEBE', '')}
                                            {renderEditableCell('UN', 'CI_HABER', '')}
                                            {renderEditableCell('UN', 'OR_DEUDOR', '')}
                                            {renderEditableCell('UN', 'OR_ACREEDOR', '')}
                                        </tr>

                                        {/* Reserva legal: no se automatiza sin comprobar forma societaria y condiciones legales. */}
                                        <tr className="table-warning">
                                            {renderEditableCell('RL', 'N', '')}
                                            {renderEditableCell('RL', 'TIPO', '', { align: 'left', minWidth: '4rem' })}
                                            {renderEditableCell('RL', 'COD', '', { align: 'left', minWidth: '4rem' })}
                                            {renderAccountCell('RL', 'RESERVA LEGAL (asiento manual)', 'RL')}
                                            {renderEditableCell('RL', 'BC_DEBE', '')}
                                            {renderEditableCell('RL', 'BC_HABER', '')}
                                            {renderEditableCell('RL', 'BC_DEUDOR', '')}
                                            {renderEditableCell('RL', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('RL', 'AJ_DEBE', '')}
                                            {renderEditableCell('RL', 'AJ_HABER', '')}
                                            {renderEditableCell('RL', 'BA_DEUDOR', '')}
                                            {renderEditableCell('RL', 'BA_ACREEDOR', '')}
                                            {renderEditableCell('RL', 'ER_COSTO', '')}
                                            <td className="text-end text-white-50">No calculada</td>
                                            {renderEditableCell('RL', 'BG_ACTIVO', '')}
                                            {renderEditableCell('RL', 'BG_PP', '')}
                                            {renderEditableCell('RL', 'CI_DEBE', '')}
                                            {renderEditableCell('RL', 'CI_HABER', '')}
                                            {renderEditableCell('RL', 'OR_DEUDOR', '')}
                                            {renderEditableCell('RL', 'OR_ACREEDOR', '')}
                                        </tr>

                                        {/* Ajustes definidos por el usuario (se listan aquí) */}
                                        {adjustments.map((adj, adjIdx) => {
                                            const ref = `I${adjIdx + 2}`; // I2, I3, ...
                                            const val = getEditableCellValue(ref) || 0;
                                            return (
                                                <tr key={adj.id} onClick={() => setSelectedAdjId(adj.id)} className={selectedAdjId === adj.id ? 'table-primary' : ''} style={{ cursor: 'pointer' }}>
                                                    {renderEditableCell(ref, 'N', '')}
                                                    {renderEditableCell(ref, 'TIPO', '', { align: 'left', minWidth: '4rem' })}
                                                    {renderEditableCell(ref, 'COD', '', { align: 'left', minWidth: '4rem' })}
                                                    <td>
                                                        <div className="d-flex align-items-center">
                                                            <input type="text" value={adj.label} onChange={e => updateAdjustment(adj.id, 'label', e.target.value)} className="form-control form-control-sm border-0 bg-transparent p-0" style={{ width: '11rem' }} />
                                                            <small className="ms-2 badge bg-light text-dark">{ref}</small>
                                                            <div className="ms-2 text-muted small">(clic para seleccionar)</div>
                                                        </div>
                                                    </td>
                                                    {renderEditableCell(ref, 'BC_DEBE', '')}
                                                    {renderEditableCell(ref, 'BC_HABER', '')}
                                                    {renderEditableCell(ref, 'BC_DEUDOR', '')}
                                                    {renderEditableCell(ref, 'BC_ACREEDOR', '')}
                                                    {renderEditableCell(ref, 'AJ_DEBE', '')}
                                                    {renderEditableCell(ref, 'AJ_HABER', '')}
                                                    {renderEditableCell(ref, 'BA_DEUDOR', '')}
                                                    {renderEditableCell(ref, 'BA_ACREEDOR', '')}
                                                    {/* ER Costo/Gasto display if negative */}
                                                    {renderEditableCell(ref, 'ER_COSTO', val < 0 ? Math.abs(val).toFixed(2) : '')}
                                                    {/* ER Ingreso: editable, mantiene lápiz para fórmula */}
                                                    <td className="text-end">
                                                        {editingAdjId !== adj.id ? (
                                                            <div className="d-flex justify-content-end align-items-center">
                                                                <span>{val >= 0 ? Number(val).toFixed(2) : ''}</span>
                                                                <button className="btn btn-sm btn-link ms-2 p-0" onClick={(e) => { e.stopPropagation(); setEditingAdjId(adj.id); }} title="Editar fórmula"><i className="bi bi-pencil"></i></button>
                                                            </div>
                                                        ) : (
                                                            <input autoFocus type="text" value={adj.input} onChange={e => updateAdjustment(adj.id, 'input', e.target.value)} onBlur={() => setEditingAdjId(null)} onKeyDown={e => { if (e.key === 'Enter') setEditingAdjId(null); }} className="form-control form-control-sm border-0 bg-transparent text-end p-0" style={{ width: '6rem' }} />
                                                        )}
                                                    </td>
                                                    {renderEditableCell(ref, 'BG_ACTIVO', '')}
                                                    {renderEditableCell(ref, 'BG_PP', '')}
                                                    {/* Cierre Debe / Haber */}
                                                    {renderEditableCell(ref, 'CI_DEBE', '')}
                                                    {renderEditableCell(ref, 'CI_HABER', '')}
                                                    {renderEditableCell(ref, 'OR_DEUDOR', '')}
                                                    <td className="text-end">
                                                        <div className="d-flex justify-content-end align-items-center">
                                                            <input
                                                                type="text"
                                                                value={getBlockValue(ref, 'OR_ACREEDOR', '')}
                                                                onChange={(e) => setBlockOverrides(prev => ({ ...prev, [`${ref}:OR_ACREEDOR`]: e.target.value }))}
                                                                className="form-control form-control-sm border-0 bg-transparent text-end p-0"
                                                                style={{ width: '5rem', fontFamily: 'inherit', fontSize: '0.7rem', lineHeight: '1.2' }}
                                                            />
                                                            <button className="btn btn-sm btn-outline-danger ms-2" onClick={() => removeAdjustment(adj.id)}>Eliminar</button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}

                                        {/* toolbar moved below table to avoid altering cell sizes */}

                                        {/* Utilidad Liquida (editable) - columnas alineadas explícitamente */}
                                        <tr className="fw-bold">
                                            {renderEditableCell('UL', 'N', '')}
                                            {renderEditableCell('UL', 'TIPO', '', { align: 'left', minWidth: '4rem' })}
                                            {renderEditableCell('UL', 'COD', '', { align: 'left', minWidth: '4rem' })}
                                            {renderAccountCell('UL', 'RESULTADO DESPUÉS DE AJUSTES MANUALES', 'UL')}
                                            {renderEditableCell('UL', 'BC_DEBE', '')}
                                            {renderEditableCell('UL', 'BC_HABER', '')}
                                            {renderEditableCell('UL', 'BC_DEUDOR', '')}
                                            {renderEditableCell('UL', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('UL', 'AJ_DEBE', '')}
                                            {renderEditableCell('UL', 'AJ_HABER', '')}
                                            {renderEditableCell('UL', 'BA_DEUDOR', '')}
                                            {renderEditableCell('UL', 'BA_ACREEDOR', '')}
                                            <td className="text-end"></td>
                                            <td className="text-end"></td>
                                            {renderEditableCell('UL', 'BG_ACTIVO', '')}
                                            {renderEditableCell('UL', 'BG_PP', '')}
                                            {renderEditableCell('UL', 'CI_DEBE', '')}
                                            {renderEditableCell('UL', 'CI_HABER', '')}
                                            {renderEditableCell('UL', 'OR_DEUDOR', '')}
                                            {renderEditableCell('UL', 'OR_ACREEDOR', '')}
                                        </tr>

                                        {/* Resultados Acumulados (a la fecha) */}
                                        <tr className="fw-bold">
                                            {renderEditableCell('RA_ROW', 'N', '')}
                                            {renderEditableCell('RA_ROW', 'TIPO', '', { align: 'left', minWidth: '4rem' })}
                                            {renderEditableCell('RA_ROW', 'COD', '', { align: 'left', minWidth: '4rem' })}
                                            {renderAccountCell('RA_ROW', 'RESULTADOS ACUMULADOS (A LA FECHA)', 'RA')}
                                            {renderEditableCell('RA_ROW', 'BC_DEBE', '')}
                                            {renderEditableCell('RA_ROW', 'BC_HABER', '')}
                                            {renderEditableCell('RA_ROW', 'BC_DEUDOR', '')}
                                            {renderEditableCell('RA_ROW', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('RA_ROW', 'AJ_DEBE', '')}
                                            {renderEditableCell('RA_ROW', 'AJ_HABER', '')}
                                            {renderEditableCell('RA_ROW', 'BA_DEUDOR', '')}
                                            {renderEditableCell('RA_ROW', 'BA_ACREEDOR', '')}
                                            {renderEditableCell('RA_ROW', 'ER_COSTO', '')}
                                            {renderEditableCell('RA_ROW', 'ER_INGRESO', '')}
                                            {renderEditableCell('RA_ROW', 'BG_ACTIVO', '')}
                                            {renderEditableCell('RA_ROW', 'BG_PP', raPP.value.toFixed(2))}
                                            {renderEditableCell('RA_ROW', 'CI_DEBE', '')}
                                            {renderEditableCell('RA_ROW', 'CI_HABER', '')}
                                            {renderEditableCell('RA_ROW', 'OR_DEUDOR', '')}
                                            {renderEditableCell('RA_ROW', 'OR_ACREEDOR', '')}
                                        </tr>

                                        {/* Totales */}
                                        <tr className="fw-bold table-dark">
                                            <td colSpan="4" className="text-center">TOTALES</td>
                                            {/* Balance de Comprobación */}
                                            <td className="text-end">{totalDebe.toFixed(2)}</td>
                                            <td className="text-end">{totalHaber.toFixed(2)}</td>
                                            <td className="text-end">{accounts.filter(a => a.balance >= 0).reduce((s, a) => s + a.balance, 0).toFixed(2)}</td>
                                            <td className="text-end">{accounts.filter(a => a.balance < 0).reduce((s, a) => s + Math.abs(a.balance), 0).toFixed(2)}</td>
                                            {/* Ajustes - show actual totals */}
                                            <td className="text-end">{totalAdjDebe.toFixed(2)}</td>
                                            <td className="text-end">{totalAdjHaber.toFixed(2)}</td>
                                            {/* Balance Ajustado - suma simple de columnas anteriores */}
                                            {(() => {
                                                const baDeudorTotal = bankersRound(accounts.reduce((sum, account) =>
                                                    sum + Math.max(getAdjustedBalance(account), 0), 0), 2);
                                                const baAcreedorTotal = bankersRound(accounts.reduce((sum, account) =>
                                                    sum + Math.max(-getAdjustedBalance(account), 0), 0), 2);

                                                return (
                                                    <>
                                                        <td className="text-end">{baDeudorTotal.toFixed(2)}</td>
                                                        <td className="text-end">{baAcreedorTotal.toFixed(2)}</td>
                                                    </>
                                                );
                                            })()}
                                            {/* Estado de Resultados */}
                                            <td className="text-end">{totalEgresosDyn.toFixed(2)}</td>
                                            <td className="text-end">{totalIngresosDyn.toFixed(2)}</td>
                                            {/* Balance General */}
                                            <td className="text-end">{totalActivosDyn.toFixed(2)}</td>
                                            <td className="text-end">{totalPasivosPatrimonioDyn.toFixed(2)}</td>
                                            {/* Cierre - usa los totales ya calculados que consideran todas las filas */}
                                            <td className="text-end">{totalCierreDebe.toFixed(2)}</td>
                                            <td className="text-end">{totalCierreHaber.toFixed(2)}</td>
                                            {/* Cuentas de Orden */}
                                            <td className="text-end">{totalOrdenDeudoras.toFixed(2)}</td>
                                            <td className="text-end">{totalOrdenAcreedoras.toFixed(2)}</td>
                                        </tr>
                                    </>
                                )}
                            </tbody>
                        </table>
                        {/* Toolbar for adjustments (outside table to avoid resizing cells) */}
                        <div className="d-flex gap-2 p-2 align-items-center border-top">
                            <button className="btn btn-sm btn-outline-primary" onClick={() => addAdjustment('end')}>Agregar Ajuste</button>
                            <button className="btn btn-sm btn-outline-success" onClick={saveEditableSection}>Guardar</button>
                            <div className="vr mx-1"></div>
                            <button className="btn btn-sm btn-outline-secondary" onClick={() => { if (selectedAdjId) moveAdjustment(selectedAdjId, 'up'); }} disabled={!selectedAdjId}>Mover arriba</button>
                            <button className="btn btn-sm btn-outline-secondary" onClick={() => { if (selectedAdjId) moveAdjustment(selectedAdjId, 'down'); }} disabled={!selectedAdjId}>Mover abajo</button>
                            <button className="btn btn-sm btn-outline-danger ms-auto" onClick={() => { if (selectedAdjId) { removeAdjustment(selectedAdjId); setSelectedAdjId(null); } }} disabled={!selectedAdjId}>Eliminar ajuste seleccionado</button>
                        </div>

                    </div>
                </div>
            </div>

            {/* Validation Alert */}


            <div className={`alert ${isBalanced ? 'alert-success bg-success bg-opacity-10 border-success text-success' : 'alert-danger bg-danger bg-opacity-10 border-danger text-danger'} mt-4`}>
                <h6 className="mb-2">
                    <i className={`bi ${isBalanced ? 'bi-check-circle' : 'bi-x-circle'} me-2`}></i>
                    Validación del Balance
                </h6>
                <div className="row g-3">
                    <div className="col-md-3">
                        <div className="p-2 border border-secondary rounded bg-dark" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                            <small className="text-white-50 d-block">Total Activos</small>
                            <span className="fw-bold text-white">Bs {totalActivosDyn.toFixed(2)}</span>
                        </div>
                    </div>
                    <div className="col-md-3">
                        <div className="p-2 border border-secondary rounded bg-dark" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                            <small className="text-white-50 d-block">Total Pasivos</small>
                            <span className="fw-bold text-danger">Bs {totalPasivos.toFixed(2)}</span>
                        </div>
                    </div>
                    <div className="col-md-3">
                        <div className="p-2 border border-secondary rounded bg-dark" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                            <small className="text-white-50 d-block">Patrimonio + Resultados</small>
                            <span className="fw-bold text-success">Bs {(totalPasivosPatrimonioDyn - totalPasivos).toFixed(2)}</span>
                            <div className="small mt-1 text-white-50" style={{ fontSize: '0.65rem' }}>
                                Incluye patrimonio registrado y resultado pendiente de cierre.
                            </div>
                        </div>
                    </div>
                    <div className="col-md-3">
                        <div className="p-2 border rounded border-primary bg-primary text-white text-center">
                            <small className="opacity-75 d-block">TOTAL P + P + R</small>
                            <span className="fw-bold">Bs {totalPasivosPatrimonioDyn.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
                {!isBalanced && (
                    <div className="mt-3 border-top pt-2">
                        <strong className="text-danger"><i className="bi bi-exclamation-triangle-fill me-2"></i>Diferencia de Balance:</strong>
                        <span className="text-danger fs-5 fw-bold ms-2">Bs {(totalActivosDyn - totalPasivosPatrimonioDyn).toFixed(2)}</span>
                    </div>
                )}
            </div>

            {/* Legend */}
            <div className="card glass-panel border-secondary shadow-sm mb-4">
                <div className="card-body">
                    <h6 className="mb-3 text-white"><i className="bi bi-info-circle me-2"></i>Leyenda de Secciones</h6>
                    <div className="row g-2 small text-white">
                        <div className="col-md-2">
                            <span className="badge bg-primary">Balance Comprobación</span>
                            <small className="d-block text-white-50 mt-1">Sumas y Saldos</small>
                        </div>
                        <div className="col-md-2">
                            <span className="badge bg-warning text-dark">Ajustes</span>
                            <small className="d-block text-white-50 mt-1">Asientos de Ajuste</small>
                        </div>
                        <div className="col-md-2">
                            <span className="badge bg-success">Balance Ajustado</span>
                            <small className="d-block text-white-50 mt-1">BC + Ajustes</small>
                        </div>
                        <div className="col-md-2">
                            <span className="badge bg-info">Estado Resultados</span>
                            <small className="d-block text-white-50 mt-1">Ingresos y Costos</small>
                        </div>
                        <div className="col-md-2">
                            <span className="badge bg-danger">Balance General</span>
                            <small className="d-block text-white-50 mt-1">A = P + P</small>
                        </div>
                        <div className="col-md-1">
                            <span className="badge bg-secondary">Cierre</span>
                            <small className="d-block text-white-50 mt-1">Asientos</small>
                        </div>
                        <div className="col-md-1">
                            <span className="badge bg-dark border border-secondary">Orden</span>
                            <small className="d-block text-white-50 mt-1">Cuentas</small>
                        </div>
                    </div>
                </div>
            </div>



        </div>
    );
}
