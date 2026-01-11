import React, { useState, useEffect } from 'react';
import axios from 'axios';
import API_URL from '../api';
import { exportToPDF, exportToExcel } from '../utils/exportUtils';
import { TreeRow } from './FinancialStatements';
import { generarEstadoResultados } from '../utils/IncomeStatementEngine';
import { useCompany } from '../context/CompanyContext';
import AIAdjustmentPanel from '../components/AIAdjustmentPanel';
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

    useEffect(() => {
        if (selectedCompany?.id) {
            fetchWorksheetData();
        }
    }, [selectedCompany?.id]);

    const fetchWorksheetData = async () => {
        if (!selectedCompany?.id) return;
        setLoading(true);
        try {
            const companyId = selectedCompany.id;
            // Fetch Balance de Comprobación data (excluding adjustments)
            const bcResponse = await axios.get(`${API_URL}/api/reports/ledger`, {
                params: { companyId, excludeAdjustments: true, excludeClosing: true }
            });
            const bcData = bcResponse.data.data || [];
            setBcAccounts(bcData);

            // Fetch Adjustments only data
            const adjResponse = await axios.get(`${API_URL}/api/reports/ledger`, {
                params: { companyId, adjustmentsOnly: true, excludeClosing: true }
            });
            const adjData = adjResponse.data.data || [];
            setAdjustmentData(adjData);

            // Create a map of adjustments by account ID
            const adjMap = {};
            adjData.forEach(adj => {
                adjMap[adj.id] = {
                    adj_debit: adj.total_debit || 0,
                    adj_credit: adj.total_credit || 0
                };
            });

            // Merge: BC accounts + any adjustment-only accounts
            const bcIds = new Set(bcData.map(a => a.id));
            const adjOnlyAccounts = adjData.filter(a => !bcIds.has(a.id));

            // Augment BC accounts with adjustment data
            const merged = bcData.map(acc => ({
                ...acc,
                adj_debit: adjMap[acc.id]?.adj_debit || 0,
                adj_credit: adjMap[acc.id]?.adj_credit || 0
            }));

            // Add adjustment-only accounts (with zero BC values)
            adjOnlyAccounts.forEach(adj => {
                merged.push({
                    ...adj,
                    total_debit: 0,
                    total_credit: 0,
                    balance: 0,
                    adj_debit: adj.total_debit || 0,
                    adj_credit: adj.total_credit || 0
                });
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

    // Función para calcular automáticamente impuestos, reservas e ingresos no imponibles
    const calculateAutomaticAdjustments = () => {
        try {
            // Obtener cuentas ER del worksheet
            const ingresos = accounts.filter(acc => classifyAccount(acc).isIngreso);
            const egresos = accounts.filter(acc => classifyAccount(acc).isGasto);
            // También buscar ingresos no imponibles directamente (que podrían estar excluidos por classifyAccount)
            const ingresosNoImponibles = accounts.filter(acc => {
                const name = (acc.name || '').toString().toLowerCase();
                return /divid|compensacion.*tributaria|ingresos.*exterior|ingresos.*no.*imponibles/i.test(name);
            });
            // DEBUG: Ver qué cuentas se encuentran
            console.log('Ingresos no imponibles detectados:', ingresosNoImponibles.map(acc => ({
                code: acc.code,
                name: acc.name,
                balanceER: (acc.total_debit || 0) + (acc.adj_debit || 0) - ((acc.total_credit || 0) + (acc.adj_credit || 0))
            })));
            // Combinar TODAS las cuentas para el motor (incluyendo no imponibles)
            const cuentasER = [...ingresos, ...egresos, ...ingresosNoImponibles].map(acc => {
                const adjDeudor = (acc.total_debit || 0) + (acc.adj_debit || 0);
                const adjAcreedor = (acc.total_credit || 0) + (acc.adj_credit || 0);
                const balanceER = Number((adjDeudor - adjAcreedor).toFixed(2));

                return {
                    ...acc,
                    balanceER
                };
            }).filter(acc => Math.abs(acc.balanceER) > 0.001);

            // DEBUG: Ver cuentas finales que van al motor
            console.log('Cuentas ER finales para motor:', cuentasER.map(acc => ({
                code: acc.code,
                name: acc.name,
                balanceER: acc.balanceER
            })));
            // Determinar si aplica Reserva Legal según el tipo societario de la empresa seleccionada
            const societalType = selectedCompany?.societal_type || '';
            // Regex para detectar S.A., S.R.L., LTDA, S.C.A. (con o sin puntos, mayúsculas/minúsculas)
            const aplicarReservaLegalAuto = /S\.?A|S\.?R\.?L|LTDA|S\.?C\.?A/i.test(societalType);


            // Opciones de cálculo
            const opciones = {
                aplicarReservaLegal: overrideReservaLegal || aplicarReservaLegalAuto,
                porcentajeReservaLegal: reservaLegalPct
            };

            // Usar el motor para calcular
            const resultado = generarEstadoResultados(cuentasER, opciones);

            return {
                impuesto: bankersRound(resultado.totales.iue || 0, 2),
                reservaLegal: bankersRound(resultado.totales.reservaLegal || 0, 2),
                ingresosNoImponibles: bankersRound(resultado.totales.valNoImponibles || 0, 2),
                utilidadNeta: bankersRound(resultado.totales.utilidadNeta || 0, 2),
                utilidadLiquida: bankersRound(resultado.totales.utilidadLiquida || 0, 2)
            };
        } catch (error) {
            console.error('Error en cálculo automático:', error);
            return {
                impuesto: 0,
                reservaLegal: 0,
                ingresosNoImponibles: 0,
                utilidadNeta: 0,
                utilidadLiquida: 0
            };
        }
    };





    // Clasificar cuentas por tipo (más flexible): usar campos del plan, tipo o prefijo de código
    const classifyAccount = (acc) => {
        const rawType = (acc.type || '').toString();
        const type = rawType.trim();
        const group = (acc.group || acc.group_name || acc.category || acc.account_group || '').toString().trim();
        const code = (acc.code || '').toString().trim();
        // Use adjusted balance for classification
        const adjDeudor = (acc.total_debit || 0) + (acc.adj_debit || 0);
        const adjAcreedor = (acc.total_credit || 0) + (acc.adj_credit || 0);
        const adjustedBalance = adjDeudor - adjAcreedor;

        const t = (type || group).toLowerCase();
        const name = (acc.name || '').toString();
        const lowerName = name.toLowerCase();

        // Classification Priority: Default Code Prefix -> Keyword Match -> Metadata Fallback
        const isActivoType = /^1/.test(code) || /activo/i.test(t) || type.toLowerCase() === 'activo';
        const isPasivoType = /^2/.test(code) || /pasivo/i.test(t) || type.toLowerCase() === 'pasivo';
        const isPatrimonioType = /^3/.test(code) || /patrimonio/i.test(t) || type.toLowerCase() === 'patrimonio';
        const isIngresoType = /^4/.test(code) || /ingreso/i.test(t) || type.toLowerCase() === 'ingreso';
        const isEgresoType = /^5/.test(code) || /costo/i.test(t) || type.toLowerCase() === 'costo';
        const isGastoType = /^6/.test(code) || /gasto|egreso/i.test(t) || type.toLowerCase() === 'gasto' || type.toLowerCase() === 'egreso';

        const isReguladora = /regul/i.test(t);
        const isOrden = /orden/i.test(t);
        const isResultado = /resulta/i.test(t);
        const isResultadosAcumulados = /resultad.*acumul/i.test(lowerName);

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

        // Reguladoras no deben ir a ER
        if (isReguladora) {
            finalGasto = false;
            finalIngreso = false;
        }

        // --- NON-TAXABLE INCOME (DIVIDENDOS) ---
        // Excluded from standard ER columns to prevent double-counting 
        // (Engine V5 will pick them up explicitly for Post-Tax addition)
        const isNoImponible = /dividendos.*percibidos|ingreso.*compensacion.*tributaria|ingresos.*exterior/i.test(lowerName);
        if (isNoImponible) {
            finalIngreso = false; // Do not show in 'ER Ingreso' column
            // They will likely remain safely in 'Balance Ajustado' without moving to ER columns
            // Or move to Pasivo/Patrimonio? 
            // If finalIngreso/finalGasto/isActivo/isPasivo are all false, they don't appear in 6-column view?
            // Actually, we want to ensure they don't screw up the 'Utilidad' calc of worksheet.
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
    const pasivosFinal = accounts.filter(acc => {
        const c = classifyAccount(acc);
        return (c.isPasivo || c.isReguladora);
    });
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

    // Totales usando saldos AJUSTADOS (Directed sums with strict rounding per step)
    const totalIngresos = bankersRound(ingresos.reduce((sum, acc) => bankersRound(sum - getAdjustedBalance(acc), 2), 0), 2);
    const totalEgresos = bankersRound(egresos.reduce((sum, acc) => bankersRound(sum + getAdjustedBalance(acc), 2), 0), 2);
    const totalActivos = bankersRound(activos.reduce((sum, acc) => bankersRound(sum + getAdjustedBalance(acc), 2), 0), 2);
    const totalPasivos = bankersRound(_pasivos.reduce((sum, acc) => bankersRound(sum - getAdjustedBalance(acc), 2), 0), 2);
    const totalPatrimonio = bankersRound(patrimonio.reduce((sum, acc) => bankersRound(sum - getAdjustedBalance(acc), 2), 0), 2);

    const utilidadNeta = bankersRound(totalIngresos - totalEgresos, 2);

    const handleExportExcel = () => {
        const exportData = accounts.map((acc, index) => {
            const deudor = acc.balance >= 0 ? acc.balance : 0;
            const acreedor = acc.balance < 0 ? Math.abs(acc.balance) : 0;

            return {
                'Nº': index + 1,
                'Tipo': acc.type,
                'Código': acc.code,
                'Cuentas': acc.name,
                'BC Debe': (acc.total_debit || 0).toFixed(2),
                'BC Haber': (acc.total_credit || 0).toFixed(2),
                'BC Deudor': deudor.toFixed(2),
                'BC Acreedor': acreedor.toFixed(2),
                'Ajuste Debe': '0.00',
                'Ajuste Haber': '0.00',
                'BA Deudor': deudor.toFixed(2),
                'BA Acreedor': acreedor.toFixed(2),
                // usar clasificación flexible para ER y BG
                ...(() => {
                    const cls = classifyAccount(acc);
                    return {
                        'ER Costo/Gasto': cls.isGasto ? Math.abs(acc.balance || 0).toFixed(2) : '0.00',
                        'ER Ingreso': cls.isIngreso ? Math.abs(acc.balance || 0).toFixed(2) : '0.00',
                        'BG Activo': cls.isActivo ? Math.abs(acc.balance || 0).toFixed(2) : '0.00',
                        // Incluir cuentas de Pasivo/Patrimonio (incluye Resultados Acumulados)
                        'BG Pasivo/Patrimonio': (((cls.isPasivo || cls.isPatrimonio || cls.isReguladora) && !cls.isResultadosAcumulados) ? Math.abs(acc.balance || 0).toFixed(2) : '0.00')
                    };
                })(),
                'Cierre Debe': '0.00',
                'Cierre Haber': '0.00',
                'Orden Deudoras': '0.00',
                'Orden Acreedoras': '0.00'
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
        const cls = classifyAccount(acc);
        const isReguladora = cls.isReguladora;
        // Reguladoras no van al ER
        const deudor = cls.isActivo ? Math.abs(acc.balance || 0) : (cls.isGasto && !isReguladora ? Math.abs(acc.balance || 0) : 0);
        const acreedor = (!cls.isActivo && !cls.isGasto) ? Math.abs(acc.balance || 0) : 0;
        const saldoBC = deudor - acreedor;
        const calculado = (acc.total_debit || 0) - (acc.total_credit || 0);
        return Math.abs(saldoBC - calculado) < 0.01; // Tolerancia de 1 centavo
    };

    // --- Editable rows (desde UTILIDAD BRUTA para abajo) ---
    const [taxInput, setTaxInput] = useState('0'); // permite número o fórmula como '=UB*0.25'
    const [utilidadLiquidaInput, setUtilidadLiquidaInput] = useState(''); // si vacío usa UN
    const [reservaLegalPct, setReservaLegalPct] = useState(5);
    const [overrideReservaLegal, setOverrideReservaLegal] = useState(false);
    const [adjustments, setAdjustments] = useState([]); // {id,label,input}
    const [taxEditing, setTaxEditing] = useState(false);
    const [editingAdjId, setEditingAdjId] = useState(null);
    const [utilidadLiquidaEditing, setUtilidadLiquidaEditing] = useState(false);

    const findResultadosAcumuladosAccount = () => {
        return accounts.find(a => /(resultad.*acumul)/i.test(a.name || '') && (a.type || '').toString().toLowerCase() === 'patrimonio') || null;
    };

    const resultadosAcumAccount = findResultadosAcumuladosAccount();
    const rawBalance = Number(resultadosAcumAccount?.balance || 0);
    // RA_raw keeps signed value for formulas/context; RA_initial is the positive magnitude
    const RA_raw = rawBalance;
    const RA_initial = Math.abs(rawBalance);
    // RA account id (used when classifying/displaying rows)
    const raAccountId = resultadosAcumAccount?.id;

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

            if (ref === 'TAX') return evaluateExpression(taxInput, ctxBase);
            if (ref === 'UL') {
                // utilidadLiquidaInput may reference other cells
                if (utilidadLiquidaInput) return evaluateExpression(utilidadLiquidaInput, { ...ctxBase, TAX: computedTax, UN: utilidadNetaAfterTax });
                return utilidadNetaAfterTax;
            }
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

    const renderEditableCell = (rowKey, colKey, fallback = '', options = {}) => {
        const { align, placeholder, minWidth, onChange, skipDefaultUpdate } = options;
        const value = getBlockValue(rowKey, colKey, fallback);
        const alignClass = align === 'left' ? '' : 'text-end';
        return (
            <td className={alignClass}>
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
            <td className="align-middle">
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
            taxInput,
            utilidadLiquidaInput,
            adjustments,
            blockOverrides,
            reservaLegalPct,
            overrideReservaLegal
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
                setTaxInput('0');
                setUtilidadLiquidaInput('');
                setAdjustments([]);
                setBlockOverrides({});
                setReservaLegalPct(5);
                setOverrideReservaLegal(false);
                return;
            }
            const obj = JSON.parse(raw);
            if (obj.taxInput !== undefined) setTaxInput(obj.taxInput);
            if (obj.utilidadLiquidaInput !== undefined) setUtilidadLiquidaInput(obj.utilidadLiquidaInput);
            if (Array.isArray(obj.adjustments)) setAdjustments(obj.adjustments);
            if (obj.blockOverrides && typeof obj.blockOverrides === 'object') setBlockOverrides(obj.blockOverrides);
            if (obj.reservaLegalPct !== undefined) setReservaLegalPct(obj.reservaLegalPct);
            if (obj.overrideReservaLegal !== undefined) setOverrideReservaLegal(obj.overrideReservaLegal);
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

    const computedTax = evaluateExpression(taxInput, ctxBase) || 0;
    const utilidadNetaAfterTax = UB - computedTax;
    const utilidadLiquida = (() => {
        if (!utilidadLiquidaInput) return utilidadNetaAfterTax;
        return evaluateExpression(utilidadLiquidaInput, { ...ctxBase, TAX: computedTax, UN: utilidadNetaAfterTax });
    })();

    // compute adjustments (sum of adjustments values)
    const adjustmentsTotal = adjustments.reduce((s, a) => s + evaluateExpression(a.input || '0', { ...ctxBase, TAX: computedTax, UN: utilidadNetaAfterTax, UL: utilidadLiquida }), 0);

    // La UTILIDAD LÍQUIDA debe ser UTILIDAD NETA después de impuesto menos los ajustes
    const UL = utilidadLiquida - adjustmentsTotal;

    // Valores editables del bloque (suman en totales en vivo)
    const manualUL = getNumericBlock('UL', 'ER_INGRESO', UL >= 0 ? UL : 0) - getNumericBlock('UL', 'ER_COSTO', UL < 0 ? Math.abs(UL) : 0);

    const editableRows = ['UB', 'IMP', 'NI', 'RL', 'UN', 'UL', 'RA_ROW'];
    const sumEditable = (col) => bankersRound(editableRows.reduce((s, rk) => bankersRound(s + getNumericBlock(rk, col, 0), 2), 0), 2);

    const auto = calculateAutomaticAdjustments();

    // ER por columna (dinámico con bloque editable + ajustes + lógica automática)
    const sumERCol = (col, rowKey, autoVal) => {
        const override = getNumericBlock(rowKey, col, 0);
        const value = getNumericBlock(rowKey, col, autoVal);
        return { override, value };
    };

    // Calculate ER Blocks with automatic fallbacks
    const ubCosto = sumERCol('ER_COSTO', 'UB', utilidadNeta < 0 ? Math.abs(utilidadNeta) : 0);
    const ubIngreso = sumERCol('ER_INGRESO', 'UB', utilidadNeta >= 0 ? utilidadNeta : 0);

    // Taxes and Reserves are placed in Ingresos (Credits) by user preference
    const impCosto = sumERCol('ER_COSTO', 'IMP', 0);
    const impIngreso = sumERCol('ER_INGRESO', 'IMP', auto.impuesto);

    const rlCosto = sumERCol('ER_COSTO', 'RL', 0);
    const rlIngreso = sumERCol('ER_INGRESO', 'RL', auto.reservaLegal);

    const unCosto = sumERCol('ER_COSTO', 'UN', auto.utilidadNeta < 0 ? Math.abs(auto.utilidadNeta) : 0);
    const unIngreso = sumERCol('ER_INGRESO', 'UN', auto.utilidadNeta >= 0 ? auto.utilidadNeta : 0);

    const niCosto = sumERCol('ER_COSTO', 'NI', auto.ingresosNoImponibles);
    const niIngreso = sumERCol('ER_INGRESO', 'NI', 0);

    const erCostoBlock = bankersRound((sumEditable('ER_COSTO') - ubCosto.override - unCosto.override - niCosto.override - impCosto.override - rlCosto.override)
        + ubCosto.value + unCosto.value + niCosto.value + impCosto.value + rlCosto.value, 2);
    const erIngresoBlock = bankersRound((sumEditable('ER_INGRESO') - ubIngreso.override - unIngreso.override - niIngreso.override - impIngreso.override - rlIngreso.override)
        + ubIngreso.value + unIngreso.value + niIngreso.value + impIngreso.value + rlIngreso.value, 2);

    const adjustmentRefs = adjustments.map((_, idx) => `I${idx + 2}`);
    const sumAdjustments = (col) => bankersRound(adjustmentRefs.reduce((s, ref) => bankersRound(s + getNumericBlock(ref, col, 0), 2), 0), 2);
    const adjIngresoExtra = bankersRound(adjustmentRefs.reduce((s, ref) => {
        const v = getNumericBlock(ref, 'ER_INGRESO', 0);
        return v >= 0 ? bankersRound(s + v, 2) : s;
    }, 0), 2);
    const adjCostoExtra = bankersRound(adjustmentRefs.reduce((s, ref) => {
        const v = getNumericBlock(ref, 'ER_COSTO', 0);
        return v < 0 ? bankersRound(s + Math.abs(v), 2) : bankersRound(s + Math.max(v, 0), 2);
    }, 0), 2);

    // Totales dinámicos: ajustamos ER y BG con los valores editables de la sección
    const erIngresoExtras = bankersRound(erIngresoBlock + adjIngresoExtra, 2);
    const erCostoExtras = bankersRound(erCostoBlock + adjCostoExtra, 2);

    // RA (aggregated) split into cierre debe/haber as sum of magnitudes (no net subtraction)
    const raAggregate = accounts.reduce((s, a) => {
        const cls = classifyAccount(a);
        if (!cls.isResultadosAcumulados) return s;
        const bal = getAdjustedBalance(a);
        if (bal >= 0) s.debe = bankersRound(s.debe + Math.abs(bal), 2);
        else s.haber = bankersRound(s.haber + Math.abs(bal), 2);
        return s;
    }, { debe: 0, haber: 0 });

    // net effect of RA on patrimonio: credits (haber) increase P+P, debits decrease
    const raNet = bankersRound(raAggregate.haber - raAggregate.debe, 2);

    const totalResult = bankersRound((auto.utilidadLiquida || 0) + (auto.reservaLegal || 0) + (auto.impuesto || 0), 2);
    const totalIngresosDyn = bankersRound(totalIngresos + erIngresoExtras, 2);
    const totalEgresosDyn = bankersRound(totalEgresos + erCostoExtras, 2);
    const utilidadLiquidaDyn = auto.utilidadLiquida;

    // BG por columna (dinámico con bloque editable + ajustes + lógica automática)
    const sumBGCol = (col, rowKey, autoVal) => {
        const override = getNumericBlock(rowKey, col, 0);
        const value = getNumericBlock(rowKey, col, autoVal);
        return { override, value };
    };

    // BG Activos: Usually none of the final rows have assets, but to stay consistent:
    const ubActivo = sumBGCol('BG_ACTIVO', 'UB', 0);
    const niActivo = sumBGCol('BG_ACTIVO', 'NI', 0);
    const unActivo = sumBGCol('BG_ACTIVO', 'UN', 0);
    const impActivo = sumBGCol('BG_ACTIVO', 'IMP', 0);
    const rlActivo = sumBGCol('BG_ACTIVO', 'RL', 0);
    const ulActivo = sumBGCol('BG_ACTIVO', 'UL', 0);
    const raActivo = sumBGCol('BG_ACTIVO', 'RA_ROW', 0);

    const bgActivoBlock = bankersRound((sumEditable('BG_ACTIVO') - ubActivo.override - niActivo.override - unActivo.override - impActivo.override - rlActivo.override - ulActivo.override - raActivo.override)
        + ubActivo.value + niActivo.value + unActivo.value + impActivo.value + rlActivo.value + ulActivo.value + raActivo.value, 2);

    // BG Pasivo + Patrimonio
    const ubPP = sumBGCol('BG_PP', 'UB', 0);
    const niPP = sumBGCol('BG_PP', 'NI', 0);
    const unPP = sumBGCol('BG_PP', 'UN', 0);
    const impPP = sumBGCol('BG_PP', 'IMP', auto.impuesto);
    const rlPP = sumBGCol('BG_PP', 'RL', auto.reservaLegal);
    const ulPP = sumBGCol('BG_PP', 'UL', 0);
    const raPP = sumBGCol('BG_PP', 'RA_ROW', bankersRound(raNet + auto.utilidadLiquida, 2));

    const bgPPExtra = bankersRound((sumEditable('BG_PP') - ubPP.override - niPP.override - unPP.override - impPP.override - rlPP.override - ulPP.override - raPP.override)
        + sumAdjustments('BG_PP')
        + ubPP.value + niPP.value + unPP.value + impPP.value + rlPP.value + ulPP.value + raPP.value, 2);

    const totalActivosDyn = bankersRound(totalActivos + bgActivoBlock, 2);
    const totalPasivosPatrimonioDyn = bankersRound(totalPasivos + totalPatrimonio + bgPPExtra, 2);

    // RA: we'll display in the CIERRE columns according to its saldo.
    // RA_raw contains signed balance; RA_initial is magnitude for display when needed.

    // Totales de Cierre: Suma vertical de los valores mostrados en las columnas de cierre.
    // Esto asegura que el total refleje exactamente lo que el usuario ve en la tabla.

    // 1. Sumar valores de la sección principal de cuentas (que solo muestra RA en Cierre)
    const cierreDebeFromAccounts = accounts.reduce((sum, acc) => {
        const cls = classifyAccount(acc);
        if (cls.isResultadosAcumulados && Number(acc.balance || 0) >= 0) {
            return bankersRound(sum + Math.abs(acc.balance), 2);
        }
        return sum;
    }, 0);

    const cierreHaberFromAccounts = accounts.reduce((sum, acc) => {
        const cls = classifyAccount(acc);
        if (cls.isResultadosAcumulados && Number(acc.balance || 0) < 0) {
            return bankersRound(sum + Math.abs(acc.balance), 2);
        }
        return sum;
    }, 0);

    // 2. Sumar valores de la sección editable (UB, IMP, UL, etc.) usando los valores que se renderizarían
    const editableCierreDebe = getNumericBlock('UL', 'CI_DEBE', auto.utilidadLiquida < 0 ? Math.abs(auto.utilidadLiquida) : 0);
    const editableCierreHaber = getNumericBlock('UL', 'CI_HABER', auto.utilidadLiquida >= 0 ? auto.utilidadLiquida : 0);

    // 3. Calcular el total final
    const totalCierreDebe = bankersRound(cierreDebeFromAccounts + editableCierreDebe, 2);
    const totalCierreHaber = bankersRound(cierreHaberFromAccounts + editableCierreHaber, 2);

    // (removed visible debug panel)

    // (removed duplicate totalCierre calculations - totals computed above as totalCierreDebe/totalCierreHaber)
    const tolerance = 0.01;
    const diffBalance = Number(Math.abs(totalActivosDyn - totalPasivosPatrimonioDyn).toFixed(2));
    const isBalanced = diffBalance < (tolerance + 0.001); // Safe check for exactly 0.01 or less

    return (
        <div>
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2 className="mb-2"><i className="bi bi-file-earmark-spreadsheet me-2"></i>Hoja de Trabajo</h2>
                    <p className="text-muted mb-0">Formato completo - Balance de Comprobación, Ajustes, Balance Ajustado, Estado de Resultados, Balance General, Cierre y Cuentas de Orden</p>
                </div>
                <div className="d-flex gap-2">
                    <button className="btn btn-outline-primary btn-sm" onClick={fetchWorksheetData} disabled={loading}>
                        <i className="bi bi-arrow-clockwise me-1"></i> Recargar
                    </button>

                    <div className="vr"></div>
                    <button className="btn btn-outline-success btn-sm" onClick={handleExportExcel} disabled={loading}>
                        <i className="bi bi-file-earmark-excel me-1"></i> Exportar Excel
                    </button>
                </div>
            </div>

            {/* Debug panel removed */}

            {/* Summary Cards */}
            <div className="row g-3 mb-4">
                <div className="col-md-3">
                    <div className="card shadow-sm border-0" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                        <div className="card-body text-white">
                            <small className="opacity-75">Total Activos</small>
                            <h4 className="mb-0 fw-bold">Bs {totalActivosDyn.toFixed(2)}</h4>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card shadow-sm border-0" style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}>
                        <div className="card-body text-white">
                            <small className="opacity-75">Pasivos + Patrimonio</small>
                            <h4 className="mb-0 fw-bold">Bs {totalPasivosPatrimonioDyn.toFixed(2)}</h4>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card shadow-sm border-0" style={{ background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' }}>
                        <div className="card-body text-white">
                            <div className="d-flex justify-content-between align-items-start">
                                <small className="opacity-75">RESERVA LEGAL ({reservaLegalPct}%)</small>
                                <div className="dropdown">
                                    <button className="btn btn-sm text-white p-0 opacity-75" data-bs-toggle="dropdown" title="Configurar Reserva">
                                        <i className="bi bi-gear-fill"></i>
                                    </button>
                                    <div className="dropdown-menu dropdown-menu-end p-3" style={{ minWidth: '200px' }}>
                                        <div className="mb-2">
                                            <label className="form-label small fw-bold">Porcentaje:</label>
                                            <div className="input-group input-group-sm">
                                                <input
                                                    type="number"
                                                    className="form-control"
                                                    value={reservaLegalPct}
                                                    onChange={e => setReservaLegalPct(Number(e.target.value))}
                                                    min="0" max="100"
                                                />
                                                <span className="input-group-text">%</span>
                                            </div>
                                        </div>
                                        <div className="form-check form-switch small">
                                            <input
                                                className="form-check-input"
                                                type="checkbox"
                                                checked={overrideReservaLegal}
                                                onChange={e => setOverrideReservaLegal(e.target.checked)}
                                            />
                                            <label className="form-check-label">Forzar Reserva</label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <h4 className="mb-0 fw-bold">Bs {auto.reservaLegal.toFixed(2)}</h4>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card shadow-sm border-0" style={{ background: utilidadLiquidaDyn >= 0 ? 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' : 'linear-gradient(135deg, #eb3349 0%, #f45c43 100%)' }}>
                        <div className="card-body text-white">
                            <small className="opacity-75">{utilidadLiquidaDyn >= 0 ? 'Utilidad Líquida' : 'Pérdida Líquida'}</small>
                            <h4 className="mb-0 fw-bold">Bs {utilidadLiquidaDyn.toFixed(2)}</h4>
                        </div>
                    </div>
                </div>
            </div>

            {/* Hoja de Trabajo completa */}
            <div className="card shadow-sm border-0">
                <div className="card-header bg-white border-bottom">
                    <h5 className="mb-0"><i className="bi bi-table me-2"></i>Hoja de Trabajo - 16 Columnas</h5>
                </div>
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.7rem' }}>
                            <thead className="table-light sticky-top">
                                <tr>
                                    <th rowSpan="2" className="align-middle text-center" style={{ minWidth: '40px' }}>Nº</th>
                                    <th rowSpan="2" className="align-middle text-center" style={{ minWidth: '70px' }}>TIPO</th>
                                    <th rowSpan="2" className="align-middle text-center" style={{ minWidth: '70px' }}>CÓDIGO</th>
                                    <th rowSpan="2" className="align-middle" style={{ minWidth: '180px' }}>CUENTAS</th>
                                    <th colSpan="4" className="text-center bg-primary text-white">BALANCE DE COMPROBACIÓN</th>
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
                                    <th className="text-center bg-primary bg-opacity-10" style={{ minWidth: '75px' }}>DEUDOR</th>
                                    <th className="text-center bg-primary bg-opacity-10" style={{ minWidth: '75px' }}>ACREEDOR</th>
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
                                            const deudor = cls.isActivo ? Math.abs(acc.balance || 0) : (cls.isGasto && !isReguladora ? Math.abs(acc.balance || 0) : 0);
                                            const acreedor = (!cls.isActivo && !cls.isGasto) ? Math.abs(acc.balance || 0) : 0;
                                            const isValid = validarSaldo(acc);

                                            return (
                                                <tr key={acc.id} className={!isValid ? 'table-warning' : ''}>
                                                    <td className="text-center"><small>{index + 1}</small></td>
                                                    <td className="text-center"><span className={`badge bg-${acc.type === 'Activo' ? 'primary' : acc.type === 'Pasivo' ? 'danger' : acc.type === 'Patrimonio' ? 'info' : acc.type === 'Ingreso' ? 'success' : 'warning'} badge-sm`}>{acc.type}</span></td>
                                                    <td className="text-center"><small><code>{acc.code}</code></small></td>
                                                    <td><small>{acc.name}</small></td>
                                                    {/* Balance de Comprobación */}
                                                    <td className="text-end">{(acc.total_debit || 0).toFixed(2)}</td>
                                                    <td className="text-end">{(acc.total_credit || 0).toFixed(2)}</td>
                                                    <td className="text-end">{deudor > 0 ? deudor.toFixed(2) : ''}</td>
                                                    <td className="text-end">{acreedor > 0 ? acreedor.toFixed(2) : ''}</td>
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
                                                                <td className="text-end">{(cls.isGasto && !isReguladora) ? Math.abs(adjBal).toFixed(2) : ''}</td>
                                                                <td className="text-end">{(cls.isIngreso && !isReguladora) ? Math.abs(adjBal).toFixed(2) : ''}</td>
                                                            </>
                                                        );
                                                    })()}
                                                    {/* Balance General - use adjusted balance */}
                                                    {(() => {
                                                        const adjDeudor = (acc.total_debit || 0) + (acc.adj_debit || 0);
                                                        const adjAcreedor = (acc.total_credit || 0) + (acc.adj_credit || 0);
                                                        const adjBal = adjDeudor - adjAcreedor;
                                                        return (
                                                            <>
                                                                <td className="text-end">{cls.isActivo ? Math.abs(adjBal).toFixed(2) : ''}</td>
                                                                {/* BG Pasivo/Patrimonio: excluir Resultados Acumulados (se mostrarán en CIERRE); reguladoras sí permanecen en BG */}
                                                                <td className="text-end">{((cls.isPasivo || cls.isPatrimonio || cls.isReguladora) && !cls.isResultadosAcumulados) ? Math.abs(adjBal).toFixed(2) : ''}</td>
                                                            </>
                                                        );
                                                    })()}
                                                    {/* Cierre: no mostramos la cuenta RA aquí (se muestra en BG). Para otras cuentas de cierre (si aplica) mostrar según signo */}
                                                    <td className="text-end">
                                                        {(cls.isResultadosAcumulados && Number(acc.balance || 0) >= 0) ? Math.abs(acc.balance).toFixed(2) : ''}
                                                    </td>
                                                    <td className="text-end">
                                                        {(cls.isResultadosAcumulados && Number(acc.balance || 0) < 0) ? Math.abs(acc.balance).toFixed(2) : ''}
                                                    </td>
                                                    {/* Cuentas de Orden */}
                                                    <td className="text-end text-muted">-</td>
                                                    <td className="text-end text-muted">-</td>
                                                </tr>
                                            );
                                        })}

                                        {/* Fila de Utilidad/Pérdida */}
                                        {/* --- UTILIDAD BRUTA y sección editable --- */}
                                        <tr className={`fw-bold ${utilidadNeta >= 0 ? 'table-success' : 'table-danger'}`}>
                                            {renderEditableCell('UB', 'N', '')}
                                            {renderEditableCell('UB', 'TIPO', '', { align: 'left', minWidth: '4rem' })}
                                            {renderEditableCell('UB', 'COD', '', { align: 'left', minWidth: '4rem' })}
                                            {renderAccountCell('UB', `${utilidadNeta >= 0 ? 'UTILIDAD BRUTA DEL EJERCICIO' : 'PÉRDIDA BRUTA DEL EJERCICIO'} (UB)`, 'UB')}
                                            {renderEditableCell('UB', 'BC_DEBE', '')}
                                            {renderEditableCell('UB', 'BC_HABER', '')}
                                            {renderEditableCell('UB', 'BC_DEUDOR', '')}
                                            {renderEditableCell('UB', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('UB', 'AJ_DEBE', '')}
                                            {renderEditableCell('UB', 'AJ_HABER', '')}
                                            {renderEditableCell('UB', 'BA_DEUDOR', '')}
                                            {renderEditableCell('UB', 'BA_ACREEDOR', '')}
                                            {renderEditableCell('UB', 'ER_COSTO', utilidadNeta < 0 ? Math.abs(utilidadNeta).toFixed(2) : '')}
                                            {renderEditableCell('UB', 'ER_INGRESO', utilidadNeta >= 0 ? utilidadNeta.toFixed(2) : '')}
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
                                            {renderAccountCell('IMP', 'IMPUESTO SOBRE LAS UTILIDADES (I1)', 'I1')}
                                            {renderEditableCell('IMP', 'BC_DEBE', '')}
                                            {renderEditableCell('IMP', 'BC_HABER', '')}
                                            {renderEditableCell('IMP', 'BC_DEUDOR', '')}
                                            {renderEditableCell('IMP', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('IMP', 'AJ_DEBE', '')}
                                            {renderEditableCell('IMP', 'AJ_HABER', '')}
                                            {renderEditableCell('IMP', 'BA_DEUDOR', '')}
                                            {renderEditableCell('IMP', 'BA_ACREEDOR', '')}
                                            {renderEditableCell('IMP', 'ER_COSTO', '')}
                                            <td className="text-end">
                                                <div className="d-flex justify-content-end align-items-center">
                                                    <span className="fw-bold text-danger">{auto.impuesto >= 0 ? auto.impuesto.toFixed(2) : ''}</span>
                                                    <small className="ms-2 text-muted">(auto)</small>
                                                </div>
                                            </td>
                                            {renderEditableCell('IMP', 'BG_ACTIVO', '')}
                                            {renderEditableCell('IMP', 'BG_PP', auto.impuesto > 0 ? auto.impuesto.toFixed(2) : '')}
                                            {renderEditableCell('IMP', 'CI_DEBE', '')}
                                            {renderEditableCell('IMP', 'CI_HABER', '')}
                                            {renderEditableCell('IMP', 'OR_DEUDOR', '')}
                                            {renderEditableCell('IMP', 'OR_ACREEDOR', '')}
                                        </tr>

                                        {/* Ingresos No Imponibles (automático) */}
                                        <tr className="table-success">
                                            {renderEditableCell('NI', 'N', '')}
                                            {renderEditableCell('NI', 'TIPO', '', { align: 'left', minWidth: '4rem' })}
                                            {renderEditableCell('NI', 'COD', '', { align: 'left', minWidth: '4rem' })}
                                            {renderAccountCell('NI', 'INGRESOS NO IMPONIBLES', 'NI')}
                                            {renderEditableCell('NI', 'BC_DEBE', '')}
                                            {renderEditableCell('NI', 'BC_HABER', '')}
                                            {renderEditableCell('NI', 'BC_DEUDOR', '')}
                                            {renderEditableCell('NI', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('NI', 'AJ_DEBE', '')}
                                            {renderEditableCell('NI', 'AJ_HABER', '')}
                                            {renderEditableCell('NI', 'BA_DEUDOR', '')}
                                            {renderEditableCell('NI', 'BA_ACREEDOR', '')}
                                            {renderEditableCell('NI', 'ER_COSTO', '')}
                                            {renderEditableCell('NI', 'ER_INGRESO', auto.ingresosNoImponibles > 0 ? auto.ingresosNoImponibles.toFixed(2) : '')}
                                            {renderEditableCell('NI', 'BG_ACTIVO', '')}
                                            {renderEditableCell('NI', 'BG_PP', '')}
                                            {renderEditableCell('NI', 'CI_DEBE', '')}
                                            {renderEditableCell('NI', 'CI_HABER', '')}
                                            {renderEditableCell('NI', 'OR_DEUDOR', '')}
                                            {renderEditableCell('NI', 'OR_ACREEDOR', '')}
                                        </tr>


                                        {/* Utilidad Neta despues de impuesto (calculada) */}
                                        <tr className="fw-bold">
                                            {renderEditableCell('UN', 'N', '')}
                                            {renderEditableCell('UN', 'TIPO', '', { align: 'left', minWidth: '4rem' })}
                                            {renderEditableCell('UN', 'COD', '', { align: 'left', minWidth: '4rem' })}
                                            {renderAccountCell('UN', `${auto.utilidadNeta >= 0 ? 'UTILIDAD NETA DEL EJERCICIO' : 'PÉRDIDA NETA DEL EJERCICIO'}`, null)}
                                            {renderEditableCell('UN', 'BC_DEBE', '')}
                                            {renderEditableCell('UN', 'BC_HABER', '')}
                                            {renderEditableCell('UN', 'BC_DEUDOR', '')}
                                            {renderEditableCell('UN', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('UN', 'AJ_DEBE', '')}
                                            {renderEditableCell('UN', 'AJ_HABER', '')}
                                            {renderEditableCell('UN', 'BA_DEUDOR', '')}
                                            {renderEditableCell('UN', 'BA_ACREEDOR', '')}
                                            {renderEditableCell('UN', 'ER_COSTO', auto.utilidadNeta < 0 ? Math.abs(auto.utilidadNeta).toFixed(2) : '')}
                                            {renderEditableCell('UN', 'ER_INGRESO', auto.utilidadNeta >= 0 ? auto.utilidadNeta.toFixed(2) : '')}
                                            {renderEditableCell('UN', 'BG_ACTIVO', '')}
                                            {renderEditableCell('UN', 'BG_PP', '')}
                                            {renderEditableCell('UN', 'CI_DEBE', '')}
                                            {renderEditableCell('UN', 'CI_HABER', '')}
                                            {renderEditableCell('UN', 'OR_DEUDOR', '')}
                                            {renderEditableCell('UN', 'OR_ACREEDOR', '')}
                                        </tr>

                                        {/* Reserva Legal (automática) */}
                                        <tr className="table-warning">
                                            {renderEditableCell('RL', 'N', '')}
                                            {renderEditableCell('RL', 'TIPO', '', { align: 'left', minWidth: '4rem' })}
                                            {renderEditableCell('RL', 'COD', '', { align: 'left', minWidth: '4rem' })}
                                            {renderAccountCell('RL', `RESERVA LEGAL (${reservaLegalPct}%)`, 'RL')}
                                            {renderEditableCell('RL', 'BC_DEBE', '')}
                                            {renderEditableCell('RL', 'BC_HABER', '')}
                                            {renderEditableCell('RL', 'BC_DEUDOR', '')}
                                            {renderEditableCell('RL', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('RL', 'AJ_DEBE', '')}
                                            {renderEditableCell('RL', 'AJ_HABER', '')}
                                            {renderEditableCell('RL', 'BA_DEUDOR', '')}
                                            {renderEditableCell('RL', 'BA_ACREEDOR', '')}
                                            {renderEditableCell('RL', 'ER_COSTO', '')}
                                            <td className="text-end">
                                                <div className="d-flex justify-content-end align-items-center">
                                                    <span className="fw-bold text-warning">{auto.reservaLegal >= 0 ? auto.reservaLegal.toFixed(2) : ''}</span>
                                                    <small className="ms-2 text-muted">(auto)</small>
                                                </div>
                                            </td>
                                            {renderEditableCell('RL', 'BG_ACTIVO', '')}
                                            {renderEditableCell('RL', 'BG_PP', auto.reservaLegal > 0 ? auto.reservaLegal.toFixed(2) : '')}
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
                                            {renderAccountCell('UL', 'UTILIDAD LÍQUIDA DEL EJERCICIO (UL)', 'UL')}
                                            {renderEditableCell('UL', 'BC_DEBE', '')}
                                            {renderEditableCell('UL', 'BC_HABER', '')}
                                            {renderEditableCell('UL', 'BC_DEUDOR', '')}
                                            {renderEditableCell('UL', 'BC_ACREEDOR', '')}
                                            {renderEditableCell('UL', 'AJ_DEBE', '')}
                                            {renderEditableCell('UL', 'AJ_HABER', '')}
                                            {renderEditableCell('UL', 'BA_DEUDOR', '')}
                                            {renderEditableCell('UL', 'BA_ACREEDOR', '')}
                                            {renderEditableCell('UL', 'ER_COSTO', auto.utilidadLiquida >= 0 ? auto.utilidadLiquida.toFixed(2) : '')}
                                            {renderEditableCell('UL', 'ER_INGRESO', auto.utilidadLiquida < 0 ? Math.abs(auto.utilidadLiquida).toFixed(2) : '')}
                                            {renderEditableCell('UL', 'BG_ACTIVO', '')}
                                            {renderEditableCell('UL', 'BG_PP', '')}
                                            {renderEditableCell('UL', 'CI_DEBE', auto.utilidadLiquida < 0 ? Math.abs(auto.utilidadLiquida).toFixed(2) : '')}
                                            {renderEditableCell('UL', 'CI_HABER', auto.utilidadLiquida >= 0 ? auto.utilidadLiquida.toFixed(2) : '')}
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
                                                // BC_DEUDOR + AJ_DEBE = BA_DEUDOR (total)
                                                const bcDeudorTotal = accounts.filter(a => a.balance >= 0).reduce((s, a) => s + a.balance, 0);
                                                const baDeudorTotal = bcDeudorTotal + totalAdjDebe;

                                                // BC_ACREEDOR + AJ_HABER = BA_ACREEDOR (total)
                                                const bcAcreedorTotal = accounts.filter(a => a.balance < 0).reduce((s, a) => s + Math.abs(a.balance), 0);
                                                const baAcreedorTotal = bcAcreedorTotal + totalAdjHaber;

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
                                            <td className="text-end">0.00</td>
                                            <td className="text-end">0.00</td>
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


            <div className={`alert ${isBalanced ? 'alert-success' : 'alert-danger'} mt-4`}>
                <h6 className="mb-2">
                    <i className={`bi ${isBalanced ? 'bi-check-circle' : 'bi-x-circle'} me-2`}></i>
                    Validación del Balance
                </h6>
                <div className="row g-3">
                    <div className="col-md-3">
                        <div className="p-2 border rounded bg-light">
                            <small className="text-muted d-block">Total Activos</small>
                            <span className="fw-bold">Bs {totalActivosDyn.toFixed(2)}</span>
                        </div>
                    </div>
                    <div className="col-md-3">
                        <div className="p-2 border rounded bg-light">
                            <small className="text-muted d-block">Total Pasivos</small>
                            <span className="fw-bold text-danger">Bs {totalPasivos.toFixed(2)}</span>
                        </div>
                    </div>
                    <div className="col-md-3">
                        <div className="p-2 border rounded bg-light">
                            <small className="text-muted d-block">Patrimonio + Resultados</small>
                            <span className="fw-bold text-success">Bs {(totalPasivosPatrimonioDyn - totalPasivos).toFixed(2)}</span>
                            <div className="small mt-1 text-muted" style={{ fontSize: '0.65rem' }}>
                                (Patr: Bs {totalPatrimonio.toFixed(2)} + Res: Bs {totalResult.toFixed(2)})
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
            <div className="card shadow-sm border-0 mt-3">
                <div className="card-body">
                    <h6 className="mb-3"><i className="bi bi-info-circle me-2"></i>Leyenda de Secciones</h6>
                    <div className="row g-2 small">
                        <div className="col-md-2">
                            <span className="badge bg-primary">Balance Comprobación</span>
                            <small className="d-block text-muted mt-1">Sumas y Saldos</small>
                        </div>
                        <div className="col-md-2">
                            <span className="badge bg-warning text-dark">Ajustes</span>
                            <small className="d-block text-muted mt-1">Asientos de Ajuste</small>
                        </div>
                        <div className="col-md-2">
                            <span className="badge bg-success">Balance Ajustado</span>
                            <small className="d-block text-muted mt-1">BC + Ajustes</small>
                        </div>
                        <div className="col-md-2">
                            <span className="badge bg-info">Estado Resultados</span>
                            <small className="d-block text-muted mt-1">Ingresos y Costos</small>
                        </div>
                        <div className="col-md-2">
                            <span className="badge bg-danger">Balance General</span>
                            <small className="d-block text-muted mt-1">A = P + P</small>
                        </div>
                        <div className="col-md-1">
                            <span className="badge bg-secondary">Cierre</span>
                            <small className="d-block text-muted mt-1">Asientos</small>
                        </div>
                        <div className="col-md-1">
                            <span className="badge bg-dark">Orden</span>
                            <small className="d-block text-muted mt-1">Cuentas</small>
                        </div>
                    </div>
                </div>
            </div>



        </div>
    );
}
