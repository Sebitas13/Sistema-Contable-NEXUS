/**
 * IncomeStatementEngine.js (MOTOR PURO ARQUITECTURA V5)
 * 
 * Responsabilidad Única: Generar la estructura y cálculos del Estado de Resultados.
 * Independiente de React/UI.
 * 
 * CARACTERÍSTICAS V5:
 * 1. REGLAS FLEXIBLES: Clasificación por keywords configurables.
 * 2. CASCADA 14 PASOS: Lógica estricta de cálculo (Waterfall).
 * 3. INGRESOS NO IMPONIBLES: Dividendos se suman POST-IMPUESTO.
 * 4. COMPENSACIÓN PÉRDIDAS: Automática antes de impuesto.
 */

// --- 1. CONFIGURACIÓN FLEXIBLE (REGLAS DE NEGOCIO) ---
const REGLAS_ER = {
    // Ingresos que SÍ pagan impuestos
    ingresosOp: {
        codigos: ['4'],
        keywords: ['venta', 'ingreso', 'servicio'],
        types: ['Ingreso'],
        exclude: ['descuento', 'rebaja', 'bonificacion', 'devolucion', 'dividendos', 'compensacion tributaria', 'exterior', 'costo']
    },
    contraIngresos: {
        keywords: ['descuento', 'rebaja', 'bonificacion', 'devolucion'],
        exclude: ['compra'] // Excluir descuentos en compras (que son ingresos)
    },
    // Costos
    costos: {
        codigos: ['5'],
        keywords: ['costo de venta', 'costo producto', 'costo mercaderia'],
        types: ['Costo']
    },
    // Gastos Operativos (Sub-grupos)
    gastosVenta: { keywords: ['publicidad', 'propaganda', 'transacciones', 'incobrable', 'marketing', 'comercial', 'impuesto a las transacciones'] },
    gastosFinancieros: { keywords: ['interes', 'bancari', 'chequera', 'itf', 'financier', 'comision'] },
    // El resto de Clase 6 que no calce será "Gastos Admin"
    gastosAdmin: {
        codigos: ['6'],
        keywords: ['sueldo', 'alquiler', 'servicio', 'mantenimiento'],
        types: ['Gasto', 'Egreso']
    },

    // No Operativos
    otrosIngresos: { keywords: ['otros ingresos', 'financiero', 'ajuste', 'diferencia de cambio', 'mantenimiento de valor', 'descuento en compra', 'rebaja en compra', 'bonificacion en compra', 'devolucion en compra'] },
    otrosEgresos: { keywords: ['otros gastos', 'no operativo', 'ajuste por inflacion', 'diferencia de cambio', 'mantenimiento de valor', 'resultado por exp'] },

    // INGRESOS NO IMPONIBLES (Se suman AL FINAL)
    ingresosNoImponibles: {
        keywords: ['dividendos', 'compensacion tributaria', 'ingresos exterior', 'ingresos no imponibles', 'dividendos percibidos', 'ingreso por compensacion tributaria', 'ingresos percibidos del exterior']
    },

    // Resultados Acumulados (Para Compensación)
    resultadosAcumulados: { keywords: ['resultados acumulados'] }
};

/**
 * Función Maestra: Transforma lista de cuentas en Reporte Calculado.
 * @param {Array} accounts - Lista de cuentas.
 * @param {Object} options - Opciones de cálculo:
 *                           { 
 *                             aplicarReservaLegal: boolean, 
 *                             porcentajeReservaLegal: number (e.g. 5 para 5%),
 *                             overrideReservaLegal: boolean (forzar aplicación)
 *                           }
 */
function generarEstadoResultados(accounts, options = {}) {
    const {
        aplicarReservaLegal = true,
        porcentajeReservaLegal = 5,
        overrideReservaLegal = false
    } = options;

    // --- PASO A: NORMALIZACIÓN Y CLASIFICACIÓN (BUCKETS) ---

    const buckets = {
        ingresosOp: [],
        contraIngresos: [],
        costos: [],
        gastosAdmin: [],
        gastosVenta: [],
        gastosFinancieros: [],
        otrosIngresos: [],
        otrosEgresos: [],
        ingresosNoImponibles: [], // Special Bucket
        resultadosAcumulados: []  // For Compensation
    };

    // Helper de filtrado
    const match = (acc, rule) => {
        const name = (acc.name || '').toLowerCase();
        const code = (acc.code || '').toString();
        const type = (acc.type || '').trim();

        // Check exclusions first (Highest priority to avoid misclassification)
        if (rule.exclude && rule.exclude.some(ex => name.includes(ex))) return false;

        // 1. Check codes (Default primary source)
        if (rule.codigos && rule.codigos.some(c => code.startsWith(c))) return true;

        // 2. Check keywords (Default secondary source)
        if (rule.keywords && rule.keywords.some(k => name.includes(k))) return true;

        // 3. Check types (Universal Fallback - from Database metadata)
        if (rule.types && rule.types.some(t => type.toLowerCase() === t.toLowerCase())) return true;

        return false;
    };

    accounts.forEach(acc => {
        // Obtenemos el saldo relevante.
        // Si viene de Worksheet, 'balanceER' ya debería ser el saldo ajustado.
        // Si viene de DB, calculamos (total_debit - total_credit).
        // NOTA: Para ER, necesitamos signo matemático para operaciones.
        // Pero el motor espera clasificar primero.

        let saldo = acc.balanceER !== undefined ? acc.balanceER : (acc.total_debit - acc.total_credit);

        // Si el saldo es casi cero, ignorar (salvo que sea cuenta clave?)
        if (Math.abs(saldo) < 0.001) return;

        // --- STRICT GUARD: NO Balance Sheet Accounts ---
        const type = (acc.type || '').trim(); // Activo, Pasivo, Patrimonio, Ingreso, Egreso
        const isBalanceSheet = /Activo|Pasivo|Patrimonio/i.test(type);

        // Exception: Resultados Acumulados IS Patrimonio but needed for compensation logic
        if (match(acc, REGLAS_ER.resultadosAcumulados)) {
            buckets.resultadosAcumulados.push({ ...acc, saldo });
            return;
        }

        // Exception: Non-Taxable Income (sometimes mapped strangely, check rule first)
        if (match(acc, REGLAS_ER.ingresosNoImponibles)) {
            buckets.ingresosNoImponibles.push({ ...acc, saldo });
            return;
        }

        // If it is strictly Balance Sheet and NOT one of the exceptions above, IGNORE IT.
        if (isBalanceSheet) return;


        // --- CLASIFICACIÓN (Orden de Prioridad) ---

        // 1. Ingresos No Imponibles (CRÍTICO: Sacarlos antes para no tributar)
        if (match(acc, REGLAS_ER.ingresosNoImponibles)) {
            // Normalmente son Acreedores (Negativos en logica contable pura D-H).
            buckets.ingresosNoImponibles.push({ ...acc, saldo });
            return;
        }

        // 2. Contra Ingresos
        if (match(acc, REGLAS_ER.contraIngresos)) {
            buckets.contraIngresos.push({ ...acc, saldo });
            return;
        }

        // 3. Ingresos Operativos
        if (match(acc, REGLAS_ER.ingresosOp)) {
            buckets.ingresosOp.push({ ...acc, saldo });
            return;
        }

        // 4. Costos
        if (match(acc, REGLAS_ER.costos)) {
            buckets.costos.push({ ...acc, saldo });
            return;
        }

        // 5. Otros Resultados (Variables por signo o nombre)
        // Check keywords explicitly first
        const isOtrosIng = match(acc, REGLAS_ER.otrosIngresos);
        const isOtrosEgr = match(acc, REGLAS_ER.otrosEgresos);

        if (isOtrosIng || isOtrosEgr) {
            // Netting Logic: Deudor (Positivo) -> Gasto, Acreedor (Negativo) -> Ingreso
            if (saldo > 0) buckets.otrosEgresos.push({ ...acc, saldo });
            else buckets.otrosIngresos.push({ ...acc, saldo });
            return;
        }

        // 6. Gastos Operativos (El resto de Egresos)
        // Sub-clasificación
        if (match(acc, REGLAS_ER.gastosVenta)) {
            buckets.gastosVenta.push({ ...acc, saldo });
        } else if (match(acc, REGLAS_ER.gastosFinancieros)) {
            buckets.gastosFinancieros.push({ ...acc, saldo });
        } else {
            // Default Admin
            // Check if it's actually an expense look-alike (Class 6 or 5 or named Gasto)
            // Or just dump everything else here? Safer to dump here if user selected it for ER.
            buckets.gastosAdmin.push({ ...acc, saldo });
        }
    });

    // --- PASO B: CÁLCULOS MATEMÁTICOS (14 Pasos Estrictos) ---

    // Helpers de suma (Convención: Ingresos sumar, Gastos restar de la utilidad.
    // Pero en data, Ingresos suelen ser Credito (-), Gastos Debito (+).
    // Estandarizamos a "Valor Absoluto" para visualización y "Valor con Signo" para cálculo algebraico?
    // Mejor modelo: Waterfall.
    // Ingresos (Display +). Math: abs(Crédito).
    // Gastos (Display +). Math: abs(Débito).
    // Utilidad = Ingresos - Gastos.

    const sumAbs = (bucket) => bucket.reduce((s, a) => s + Math.abs(a.saldo), 0);

    // 1. Ingresos
    const valIngresos = sumAbs(buckets.ingresosOp);

    // 2. Descuentos (Son al Debe, restan al Ingreso)
    const valDescuentos = sumAbs(buckets.contraIngresos);

    // 3. Ventas Netas
    const ventasNetas = valIngresos - valDescuentos;

    // 4. Costos
    const valCostos = sumAbs(buckets.costos);

    // 5. Utilidad Bruta
    const utilidadBruta = ventasNetas - valCostos;

    // 6. Gastos Ops
    const valAdmin = sumAbs(buckets.gastosAdmin);
    const valVenta = sumAbs(buckets.gastosVenta);
    const valFinancieros = sumAbs(buckets.gastosFinancieros);
    const totalGastosOp = valAdmin + valVenta + valFinancieros;

    // 7. Utilidad en Ventas
    const utilidadEnVentas = utilidadBruta - totalGastosOp;

    // 8 & 10. Otros
    const valOtrosIngresos = sumAbs(buckets.otrosIngresos);
    const valOtrosEgresos = sumAbs(buckets.otrosEgresos);

    // 9. Operativa 
    const utilidadOperativa = utilidadEnVentas + valOtrosIngresos;

    // 11. Pre-Tax (Bruta Ejercicio)
    const utilidadBrutaEjercicio = utilidadOperativa - valOtrosEgresos;

    // --- PASO C: TRIBUTARIO Y NO IMPONIBLES ---

    let remanenteCompensacion = 0;
    let baseImponible = 0;
    let iue = 0;
    let reservaLegal = 0;
    let utilidadNeta = 0;
    const valNoImponibles = sumAbs(buckets.ingresosNoImponibles); // Dividendos
    let utilidadLiquida = 0;
    let logAudit = [];

    if (utilidadBrutaEjercicio > 0) {
        // Compensación Pérdidas (Resultados Acumulados Saldo Deudor)
        // RA usually: Gain (Credit/-), Loss (Debit/+).
        // We sum algebraic saldos using raw 'saldo'.
        const saldoRA = buckets.resultadosAcumulados.reduce((s, a) => s + a.saldo, 0);
        // If saldoRA > 0 (Debit), it's a Loss.
        const perdidasAcum = saldoRA > 0 ? saldoRA : 0;

        remanenteCompensacion = Math.min(perdidasAcum, utilidadBrutaEjercicio);
        if (remanenteCompensacion > 0) {
            logAudit.push(`Compensación aplicada: ${remanenteCompensacion.toFixed(2)} sobre pérdidas de ${perdidasAcum.toFixed(2)}`);
        }

        baseImponible = utilidadBrutaEjercicio - remanenteCompensacion;

        // IUE (25%)
        if (baseImponible > 0) iue = baseImponible * 0.25;

        // Resultado Post-Impuesto
        const resPostIUE = baseImponible - iue;

        // --- SUMA DE NO IMPONIBLES (DIVIDENDOS) ---
        // Linea 74: "A este resultado sumar los ingresos no imponibles"
        utilidadNeta = resPostIUE + valNoImponibles;

        // RESERVA LEGAL Configurable
        const pctFactores = (porcentajeReservaLegal || 5) / 100;
        const debeAplicar = overrideReservaLegal || aplicarReservaLegal;

        if (utilidadNeta > 0 && debeAplicar) {
            reservaLegal = utilidadNeta * pctFactores;
        }
        utilidadLiquida = utilidadNeta - reservaLegal;

    } else {
        // Pérdida, pero sumamos Dividendos (ayudan a reducir la pérdida contable)
        utilidadNeta = utilidadBrutaEjercicio + valNoImponibles;
        utilidadLiquida = utilidadNeta;
        logAudit.push("Resultado Negativo o Nulo: No se calculan impuestos ni Reservas.");
    }

    // --- PASO D: GENERAR ÁRBOLES VISUALES (Usando un TreeBuilder simplificado) ---
    // Invertimos el signo visual para que todo se vea positivo en la cascada
    // (Ingresos +, Gastos +, etc. el signo ya fue manejado en la matemática arriba)

    const buildTree = (list, sectionTotal) => {
        // Por ahora, estructura plana simple o pequeña jerarquía si tienen parent_code
        // Para V5 puro, retornamos la lista enriquecida. 
        // El frontend puede renderizarla plana o en árbol.
        // Vamos a devolver lista plana con propiedad 'displayValue' positiva.
        return list.map(item => ({
            ...item,
            id: item.id || item.code,
            displayValue: Math.abs(item.saldo)
        })).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    };

    return {
        secciones: {
            ingresos: buildTree(buckets.ingresosOp),
            descuentos: buildTree(buckets.contraIngresos),
            costos: buildTree(buckets.costos),
            gastosAdmin: buildTree(buckets.gastosAdmin),
            gastosVenta: buildTree(buckets.gastosVenta),
            gastosFinancieros: buildTree(buckets.gastosFinancieros),
            otrosIngresos: buildTree(buckets.otrosIngresos),
            otrosEgresos: buildTree(buckets.otrosEgresos),
            noImponibles: buildTree(buckets.ingresosNoImponibles)
        },
        totales: {
            ventasNetas,
            utilidadBruta,
            utilidadEnVentas,
            totalGastosOp,
            utilidadOperativa,
            utilidadBrutaEjercicio,
            compensacion: remanenteCompensacion,
            baseImponible,
            iue,
            valNoImponibles, // Dividendos
            utilidadNeta,
            reservaLegal,
            utilidadLiquida
        },
        porcentajeReservaLegal,
        audit: logAudit
    };
}

// AGREGAR AL FINAL DEL ARCHIVO:
/**
 * Función que obtiene datos del Estado de Resultados desde las columnas de Worksheet
 * @param {string} companyId - ID de la compañía
 * @param {Object} options - Opciones de cálculo (porcentajeReservaLegal, overrideReservaLegal)
 * @returns {Object} - Estructura del Estado de Resultados
 */
async function generarEstadoResultadosDesdeWorksheet(companyId, options = {}) {
    // CORRECCIÓN CRÍTICA: Usar consultas SQL directas en lugar de fetch a localhost
    const db = require('../db');

    // Helper para promisificar db.all
    const dbAll = (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    };

    try {
        // 1. Obtener todas las cuentas
        const allAccounts = await dbAll(
            'SELECT * FROM accounts WHERE company_id = ? ORDER BY code',
            [companyId]
        );

        // 2. Obtener Balance de Comprobación (excluyendo ajustes)
        const bcData = await dbAll(`
            SELECT 
                a.id, a.code, a.name, a.type, a.level, a.parent_code,
                COALESCE(SUM(te.debit), 0) as total_debit,
                COALESCE(SUM(te.credit), 0) as total_credit
            FROM accounts a
            LEFT JOIN transaction_entries te ON a.id = te.account_id
            LEFT JOIN transactions t ON te.transaction_id = t.id
            WHERE a.company_id = ? AND (t.id IS NULL OR (t.company_id = ? AND (t.type IS NULL OR t.type != 'Ajuste')))
            GROUP BY a.id
            HAVING total_debit > 0 OR total_credit > 0
            ORDER BY a.code
        `, [companyId, companyId]);

        // 3. Obtener solo ajustes
        const adjData = await dbAll(`
            SELECT 
                a.id, a.code, a.name, a.type, a.level, a.parent_code,
                COALESCE(SUM(te.debit), 0) as total_debit,
                COALESCE(SUM(te.credit), 0) as total_credit
            FROM accounts a
            LEFT JOIN transaction_entries te ON a.id = te.account_id
            LEFT JOIN transactions t ON te.transaction_id = t.id
            WHERE a.company_id = ? AND t.company_id = ? AND t.type = 'Ajuste'
            GROUP BY a.id
            HAVING total_debit > 0 OR total_credit > 0
            ORDER BY a.code
        `, [companyId, companyId]);

        // 4. Obtener datos de la empresa
        const companyRows = await dbAll('SELECT * FROM companies WHERE id = ?', [companyId]);
        const company = companyRows[0] || {};

        // Mapear ajustes
        const adjMap = {};
        adjData.forEach(adj => {
            adjMap[adj.id] = {
                adj_debit: adj.total_debit || 0,
                adj_credit: adj.total_credit || 0
            };
        });

        // Combinar datos como lo hace Worksheet
        const bcIds = new Set(bcData.map(a => a.id));
        const adjOnlyAccounts = adjData.filter(a => !bcIds.has(a.id));
        const merged = bcData.map(acc => ({
            ...acc,
            adj_debit: adjMap[acc.id]?.adj_debit || 0,
            adj_credit: adjMap[acc.id]?.adj_credit || 0
        }));
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
        merged.sort((a, b) => (a.code || '').localeCompare(b.code || ''));

        // Clasificar cuentas como lo hace Worksheet
        const classifyAccount = (acc) => {
            const rawType = (acc.type || '').toString();
            const type = rawType.trim();
            const code = (acc.code || '').toString().trim();
            const adjDeudor = (acc.total_debit || 0) + (acc.adj_debit || 0);
            const adjAcreedor = (acc.total_credit || 0) + (acc.adj_credit || 0);
            const adjustedBalance = adjDeudor - adjAcreedor;
            const t = (type || '').toLowerCase();
            const name = (acc.name || '').toString();
            const lowerName = name.toLowerCase();
            const isReguladora = /regul/i.test(t);
            const isOrden = /orden/i.test(t);
            const isResultado = /resulta/i.test(t);
            const isGastoType = /^6/.test(code) || /gasto|egreso/i.test(lowerName) || (type.toLowerCase() === 'gasto' || type.toLowerCase() === 'egreso');
            const isIngresoType = /^4/.test(code) || /ingreso|venta/i.test(lowerName) || (type.toLowerCase() === 'ingreso');
            const isEgresoType = /^5/.test(code) || /costo/i.test(lowerName) || (type.toLowerCase() === 'costo');

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

            let finalGasto = false;
            let finalIngreso = false;

            if (isVariable) {
                if (adjustedBalance >= 0) {
                    finalGasto = true;
                } else {
                    finalIngreso = true;
                }
            } else {
                const resultadoAsGasto = isResultado && adjustedBalance >= 0;
                const resultadoAsIngreso = isResultado && adjustedBalance < 0;

                finalGasto = isGastoType || resultadoAsGasto || isEgresoType;
                finalIngreso = isIngresoType || resultadoAsIngreso;
            }
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
                isVariable
            };
        };

        // Filtrar solo cuentas que van a columnas ER
        const cuentasER = merged.filter(acc => {
            const cls = classifyAccount(acc);
            const name = (acc.name || '').toString().toLowerCase();
            const isNoImponible = /dividendos.*percibidos|ingreso.*compensacion.*tributaria|ingresos.*exterior/i.test(name);
            return cls.isGasto || cls.isIngreso || isNoImponible;
        }).map(acc => {
            const adjDeudor = (acc.total_debit || 0) + (acc.adj_debit || 0);
            const adjAcreedor = (acc.total_credit || 0) + (acc.adj_credit || 0);
            const balanceER = adjDeudor - adjAcreedor;

            return {
                ...acc,
                balanceER
            };
        }).filter(acc => Math.abs(acc.balanceER) > 0.001);

        // Determinar si aplica reserva legal según tipo societario
        const societalType = company.societal_type || '';
        const aplicarReservaLegal = /S\.?A|S\.?R\.?L|LTDA|S\.?C\.?A/i.test(societalType);

        const calculationOptions = {
            aplicarReservaLegal,
            ...options
        };

        console.log('📊 generarEstadoResultadosDesdeWorksheet: cuentasER encontradas:', cuentasER.length);
        return generarEstadoResultados(cuentasER, calculationOptions);
    } catch (error) {
        console.error('Error generando Estado de Resultados desde Worksheet:', error);
        return {
            secciones: {
                ingresos: [], descuentos: [], costos: [], gastosAdmin: [],
                gastosVenta: [], gastosFinancieros: [], otrosIngresos: [],
                otrosEgresos: [], noImponibles: []
            },
            totales: {
                ventasNetas: 0, utilidadBruta: 0, utilidadEnVentas: 0,
                totalGastosOp: 0, utilidadOperativa: 0, utilidadBrutaEjercicio: 0,
                compensacion: 0, baseImponible: 0, iue: 0, valNoImponibles: 0,
                utilidadNeta: 0, reservaLegal: 0, utilidadLiquida: 0
            },
            audit: ['Error al cargar datos desde Worksheet: ' + error.message]
        };
    }
}


// --- 3. FUNCIÓN DE CLASIFICACIÓN DE CUENTAS ---
function classifyAccountForER(acc) {
    const rawType = (acc.type || '').toString();
    const type = rawType.trim();
    const code = (acc.code || '').toString().trim();
    const adjDeudor = (acc.total_debit || 0) + (acc.adj_debit || 0);
    const adjAcreedor = (acc.total_credit || 0) + (acc.adj_credit || 0);
    const adjustedBalance = adjDeudor - adjAcreedor;
    const t = (type || '').toLowerCase();
    const name = (acc.name || '').toString();
    const lowerName = name.toLowerCase();
    const isReguladora = /regul/i.test(t);
    const isOrden = /orden/i.test(t);
    const isResultado = /resulta/i.test(t);
    const isGastoType = /^6/.test(code) || /gasto|egreso/i.test(lowerName) || (type.toLowerCase() === 'gasto' || type.toLowerCase() === 'egreso');
    const isCostoType = /^5/.test(code) || /costo/i.test(lowerName) || type.toLowerCase() === 'costo';
    const isIngresoType = /^4/.test(code) || /ingreso|venta/i.test(lowerName) || type.toLowerCase() === 'ingreso';
    const isActivoType = /^1/.test(code) || /activo/i.test(lowerName) || type.toLowerCase() === 'activo';
    const isPasivoType = /^2/.test(code) || /pasivo/i.test(lowerName) || type.toLowerCase() === 'pasivo';
    const isPatrimonioType = /^3/.test(code) || /patrimonio/i.test(lowerName) || type.toLowerCase() === 'patrimonio';

    // Variables para resultado
    let isGasto = false;
    let isIngreso = false;
    let isNoImponible = false;

    // Clasificación para Estado de Resultados
    if (isResultado || isGastoType || isCostoType || isIngresoType) {
        if (isIngresoType) {
            if (lowerName.includes('dividendo') || lowerName.includes('compensacion tributaria') || lowerName.includes('exterior')) {
                isNoImponible = true;
                isIngreso = true;
            } else {
                isIngreso = true;
            }
        }
        if (isGastoType || isCostoType) {
            if (lowerName.includes('iue pagado') || lowerName.includes('impuesto a las utilidades pagado')) {
                isNoImponible = true;
                isGasto = true;
            } else {
                isGasto = true;
            }
        }
    }

    return {
        isGasto,
        isIngreso,
        isNoImponible,
        category: isGasto ? 'gastos_operativos' : (isIngreso ? 'ingresos_operativos' : 'other'),
        subcategory: isCostoType ? 'costos' : (isGastoType ? 'gastos' : (isIngresoType ? 'ventas' : 'no_aplica'))
    };
}

module.exports = {
    REGLAS_ER,
    generarEstadoResultados,
    generarEstadoResultadosDesdeWorksheet,
    classifyAccountForER
};