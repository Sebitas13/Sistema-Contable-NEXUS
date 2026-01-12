const express = require('express');
const router = express.Router();
const db = require('../db');
console.log('*** ARCHIVO reports.js CARGADO ***');
// Corrected: Import server-side utilities, not client-side code.
const { getFiscalYearDetails } = require('../utils/serverFiscalYearUtils.js');
const { generarEstadoResultados, classifyAccountForER } = require('../utils/serverIncomeStatement.js');
const AccountPlanIntelligence = require('../utils/AccountPlanIntelligence.js');



// Helper function to promisify db.all
const dbAll = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// Get Ledger Summary (Libro Mayor - Resumen por cuenta)
router.get('/ledger', async (req, res) => {
    try {
        const { companyId, startDate, endDate } = req.query;
        const excludeClosing = req.query.excludeClosing === 'true';

        let params = [];
        let dateFilter = '';
        let companyFilter = '';

        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }

        companyFilter = 'AND t.company_id = ?';
        params.push(companyId);

        if (startDate && endDate) {
            dateFilter = 'AND t.date BETWEEN ? AND ?';
            params.push(startDate, endDate);
        } else if (startDate) {
            dateFilter = 'AND t.date >= ?';
            params.push(startDate);
        } else if (endDate) {
            dateFilter = 'AND t.date <= ?';
            params.push(endDate);
        }

        // Optionally exclude transactions marked as 'Ajuste' from the ledger (Balance de Comprobación)
        const excludeAdjustments = req.query.excludeAdjustments === 'true';
        // Optionally include ONLY adjustment transactions
        const adjustmentsOnly = req.query.adjustmentsOnly === 'true';

        let typeFilter = '';
        if (excludeAdjustments) {
            typeFilter += " AND (t.type IS NULL OR t.type != 'Ajuste')";
        } else if (adjustmentsOnly) {
            typeFilter += " AND t.type = 'Ajuste'";
        }

        if (excludeClosing) {
            typeFilter += " AND (t.type IS NULL OR t.type != 'Cierre')";
        }

        const sql = `
            SELECT 
                a.id, a.code, a.name, a.type, a.level, a.parent_code,
                COALESCE(SUM(te.debit), 0) as total_debit,
                COALESCE(SUM(te.credit), 0) as total_credit,
                (COALESCE(SUM(te.debit), 0) - COALESCE(SUM(te.credit), 0)) as balance,
                COUNT(te.id) as movement_count
            FROM accounts a
            LEFT JOIN transaction_entries te ON a.id = te.account_id AND te.id IS NOT NULL
            LEFT JOIN transactions t ON te.transaction_id = t.id
            WHERE a.company_id = ? AND (t.id IS NULL OR (1=1 ${dateFilter})) ${typeFilter}
            GROUP BY a.id
            HAVING total_debit > 0 OR total_credit > 0
            ORDER BY a.code
        `;

        const rows = await dbAll(sql, params);
        res.json({ data: rows });
    } catch (error) {
        console.error('Error in /ledger:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Ledger Details for all accounts (optimized)
router.get('/ledger-details', async (req, res) => {
    try {
        const { companyId, startDate, endDate } = req.query;
        const excludeClosing = req.query.excludeClosing === 'true';

        const excludeAdjustments = req.query.excludeAdjustments === 'true';

        let params = [];
        let dateFilter = '';
        let companyFilter = '';

        if (companyId) {
            companyFilter = 'AND t.company_id = ?';
            params.push(companyId);
        }

        if (startDate && endDate) {
            dateFilter = 'AND t.date BETWEEN ? AND ?';
            params.push(startDate, endDate);
        } else if (startDate) {
            dateFilter = 'AND t.date >= ?';
            params.push(startDate);
        } else if (endDate) {
            dateFilter = 'AND t.date <= ?';
            params.push(endDate);
        }

        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }

        let typeFilter = '';
        if (excludeAdjustments) {
            typeFilter += " AND (t.type IS NULL OR t.type != 'Ajuste')";
        }
        if (excludeClosing) {
            typeFilter += " AND (t.type IS NULL OR t.type != 'Cierre')";
        }
        const sql = `
            WITH TransactionRank AS (
                SELECT id, type,
                ROW_NUMBER() OVER (PARTITION BY company_id, type ORDER BY date ASC, id ASC) as type_number
                FROM transactions
                WHERE company_id = ?
            )
            SELECT 
                a.code as account_code,
                a.name as account_name,
                a.type as account_type,
                te.account_id,
            t.id as transaction_id,
            t.date,
            t.gloss as glosa,
                (t.type || ' #' || IFNULL(tr.type_number, t.id)) as reference,
            t.type as transaction_type,
            tr.type_number,
            te.debit,
            te.credit,
            te.gloss as entry_glosa
            FROM transaction_entries te
            JOIN transactions t ON te.transaction_id = t.id
            JOIN accounts a ON te.account_id = a.id
            LEFT JOIN TransactionRank tr ON t.id = tr.id
            WHERE 1 = 1 ${companyFilter} ${dateFilter} ${typeFilter}
            ORDER BY a.code ASC, t.date ASC, t.id ASC
            `;

        const finalParams = [companyId, ...params];
        const rows = await dbAll(sql, finalParams);
        res.json({ data: rows });
    } catch (error) {
        console.error('Error in /ledger-details:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get movements for a specific account with running balance
router.get('/ledger/account/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { companyId, startDate, endDate } = req.query;
        const excludeClosing = req.query.excludeClosing === 'true';

        const excludeAdjustments = req.query.excludeAdjustments === 'true';

        let params = [accountId];
        let dateFilter = '';
        let companyFilter = '';

        if (companyId) {
            companyFilter = 'AND t.company_id = ?';
            params.push(companyId);
        }

        // First, get opening balance (sum of all movements before startDate)
        let openingBalance = 0;
        if (startDate) {
            const openingParams = [accountId];
            let openingCompanyFilter = '';
            if (companyId) {
                openingCompanyFilter = 'AND t.company_id = ?';
                openingParams.push(companyId);
            }
            openingParams.push(startDate);

            let typeFilter = '';
            if (excludeAdjustments) {
                typeFilter += " AND (t.type IS NULL OR t.type != 'Ajuste')";
            }
            if (excludeClosing) {
                typeFilter += " AND (t.type IS NULL OR t.type != 'Cierre')";
            }
            const openingSql = `
        SELECT
        COALESCE(SUM(te.debit), 0) - COALESCE(SUM(te.credit), 0) as balance
                FROM transaction_entries te
                JOIN transactions t ON te.transaction_id = t.id
                WHERE te.account_id = ? ${openingCompanyFilter} ${typeFilter}
                AND t.date < ?
            `;

            const openingResult = await dbAll(openingSql, openingParams);
            openingBalance = openingResult[0]?.balance || 0;
        }

        // Build date filter for main query
        if (startDate && endDate) {
            dateFilter = 'AND t.date BETWEEN ? AND ?';
            params.push(startDate, endDate);
        } else if (startDate) {
            dateFilter = 'AND t.date >= ?';
            params.push(startDate);
        } else if (endDate) {
            dateFilter = 'AND t.date <= ?';
            params.push(endDate);
        }

        // Get account info
        const accountSql = 'SELECT id, code, name, type FROM accounts WHERE id = ?';
        const accountResult = await dbAll(accountSql, [accountId]);

        if (accountResult.length === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }

        const account = accountResult[0];

        let typeFilter = '';
        if (excludeAdjustments) {
            typeFilter += " AND (t.type IS NULL OR t.type != 'Ajuste')";
        }
        if (excludeClosing) {
            typeFilter += " AND (t.type IS NULL OR t.type != 'Cierre')";
        }

        // Get movements
        /*
        Calculate transaction numbers (e.g. Ingreso #1, #2) to match Journal view.
        Using simple subquery for compatibility if window functions are not enabled,
        but attempting window function first or just standard correlation.
        Actually, let's use a standard correlated subquery or a pre-calculation if checking version is hard.
        Standard Window Function (SQLite 3.25+):
        */
        const movementsSql = `
            WITH TransactionRank AS (
                SELECT id, type,
                ROW_NUMBER() OVER (PARTITION BY company_id, type ORDER BY date ASC, id ASC) as type_number
                FROM transactions
                WHERE company_id = ?
            )
            SELECT
            te.id as entry_id,
            t.id as transaction_id,
            t.date,
            t.gloss as glosa,
            '' as reference,
            t.type as transaction_type,
            tr.type_number,
            te.debit,
            te.credit,
            te.gloss as entry_glosa
            FROM transaction_entries te
            JOIN transactions t ON te.transaction_id = t.id
            LEFT JOIN TransactionRank tr ON t.id = tr.id
            WHERE te.account_id = ? ${companyFilter} ${dateFilter} ${typeFilter}
            ORDER BY t.date ASC, t.id ASC, te.id ASC
            `;

        // We need to pass companyId twice now (once for CTE, once for main query filter if needed, though CTE handles numbering globally for company)
        // Wait, standard params are [accountId, companyId(opt), startDate(opt), endDate(opt)]
        // My constructed params array is: [accountId, val1, val2...]
        // I need to inject companyId at the START for the CTE.
        // But 'params' is built dynamically.

        // Let's rebuild the params list for this query.
        // 1. CTE requires companyId. If not provided in query, we can't strictly number per company correctly 
        // but usually companyId is required or present.
        // If companyId is missing, maybe we number globally? Assuming companyId is passed.

        const queryParams = [companyId || 1, ...params];
        // params already contains accountId at index 0 (line 136).
        // companyId might be in params at index 1 if it was added.
        // This is getting array index tricky.

        /*
         Re-evaluating params construction:
         Line 136: let params = [accountId];
         Line 142: params.push(companyId); -> [accountId, companyId]
         Line 164: params.push(sd, ed); -> [accountId, companyId, sd, ed]
         
         My SQL has placeholders:
         CTE: WHERE company_id = ? (Need companyId)
         Main: WHERE te.account_id = ? (Need accountId)
               AND t.company_id = ? (Need companyId if filter enabled)
               AND dates...
         
         So I need [companyId, accountId, companyId, dates...]
        */

        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }

        const finalParams = [companyId, ...params];

        const movements = await dbAll(movementsSql, finalParams);

        // Calculate running balance
        let runningBalance = openingBalance;
        const movementsWithBalance = movements.map(m => {
            runningBalance += (m.debit || 0) - (m.credit || 0);
            return {
                ...m,
                running_balance: runningBalance
            };
        });

        // Calculate totals
        const totalDebit = movements.reduce((sum, m) => sum + (m.debit || 0), 0);
        const totalCredit = movements.reduce((sum, m) => sum + (m.credit || 0), 0);
        const closingBalance = openingBalance + totalDebit - totalCredit;

        res.json({
            data: {
                account,
                opening_balance: openingBalance,
                movements: movementsWithBalance,
                total_debit: totalDebit,
                total_credit: totalCredit,
                closing_balance: closingBalance
            }
        });
    } catch (error) {
        console.error('Error in /ledger/account/:accountId:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all accounts (for dropdown selector)
router.get('/accounts-list', async (req, res) => {
    try {
        const { companyId } = req.query;

        let sql = `
            SELECT DISTINCT a.id, a.code, a.name, a.type
            FROM accounts a
            INNER JOIN transaction_entries te ON a.id = te.account_id
            INNER JOIN transactions t ON te.transaction_id = t.id
            `;

        let params = [];
        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }
        sql += ' WHERE a.company_id = ?';
        params.push(companyId);

        sql += ' ORDER BY a.code';

        const rows = await dbAll(sql, params);
        res.json({ data: rows });
    } catch (error) {
        console.error('Error in /accounts-list:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Balance Sheet (Balance General) - Placeholder
router.get('/financial-statements', async (req, res) => {
    try {
        const { companyId } = req.query;

        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }

        // 1. Robust Query:
        // - Calculates mathematical balance (Debe-Haber or Haber-Debe)
        // - Guarantees parent_code using SQL fallback (though Phase 0 should fix it)
        const sql = `
            WITH saldos_calculados AS (
                SELECT 
                    a.id, a.code, a.name, a.type, a.level, 
                    
                    -- GARANTIZAR parent_code (usar existente o dejar NULL para fallback en JS)
                    -- La lógica de 'instr' con 3 argumentos no es soportada por todas las versiones de SQLite.
                    -- Simplificamos para evitar error 500: Si es null, lo dejamos null y el JS lo calcula.
                    a.parent_code as parent_code_garantizado,

                    COALESCE(a.parent_code, '') as debug_parent,

                    -- Saldo matemático CON SIGNO CORRECTO
                    COALESCE(
                        SUM(CASE 
                            WHEN a.type IN ('Activo', 'Gasto', 'Costo') THEN te.debit - te.credit
                            WHEN a.type IN ('Pasivo', 'Patrimonio', 'Ingreso') THEN te.credit - te.debit
                            ELSE 0
                        END),
                        0
                    ) as saldo_matematico,

                    -- Flag para identificar Reguladora (por nombre)
                    CASE 
                         WHEN a.name LIKE '%depreciac%' OR a.name LIKE '%amortizac%' OR a.name LIKE '%provisi%' 
                         THEN 1 ELSE 0 
                    END as is_reguladora

                FROM accounts a
                LEFT JOIN transaction_entries te ON a.id = te.account_id
                LEFT JOIN transactions t ON te.transaction_id = t.id
                WHERE a.company_id = ? AND (t.id IS NULL OR t.company_id = ?)
                GROUP BY a.id, a.code, a.name, a.type, a.level
            )
            SELECT * FROM saldos_calculados
            ORDER BY code;
        `;

        const rows = await dbAll(sql, [companyId, companyId]);

        // Post-processing for safety: Ensure parent_code_garantizado logic if SQL was limited
        // Although the user asked for Backend Absolute, JS fallback here IS backend logic (server-side).
        // It's safer/easier to do regex/string manipulation in Node than complex SQLite string functions.

        const refinedRows = rows.map(row => {
            let parentCode = row.parent_code || row.parent_code_garantizado;

            // Backend safeguard for parent_code if still null
            if (!parentCode && row.level > 1 && row.code.length > 1) {
                // Simple heuristic fallback running ON SERVER
                if (row.code.includes('.')) {
                    const parts = row.code.split('.');
                    parts.pop();
                    parentCode = parts.join('.');
                } else if (row.code.includes('-')) {
                    const parts = row.code.split('-');
                    parts.pop();
                    parentCode = parts.join('-');
                } else {
                    // Variable length fallback (e.g. PUCT)
                    // 1105 -> 11 (len 4 -> 2)
                    // 110502 -> 1105 (len 6 -> 4)
                    if (row.code.length === 4) parentCode = row.code.substring(0, 2);
                    else if (row.code.length === 6) parentCode = row.code.substring(0, 4);
                    else if (row.code.length === 8) parentCode = row.code.substring(0, 6);
                }
            }

            return {
                ...row,
                parent_code_garantizado: parentCode
            };
        });

        const cuentasHuerfanas = refinedRows.filter(a =>
            a.parent_code_garantizado &&
            !refinedRows.some(p => p.code === a.parent_code_garantizado)
        );

        res.json({
            success: true,
            data: refinedRows,
            metadata: {
                totalCuentas: refinedRows.length,
                cuentasHuerfanas: cuentasHuerfanas.length,
                requiereCorreccion: cuentasHuerfanas.length > 0
            }
        });

    } catch (error) {
        console.error('Error in /financial-statements:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/closing-entries-proposal', async (req, res) => {
    const { companyId, gestion, reservaLegalPct, overrideReservaLegal } = req.body;

    if (!companyId || !gestion) {
        return res.status(400).json({ error: 'companyId and gestion are required' });
    }

    try {
        // 1. Get company info to determine fiscal year
        const company = await dbAll('SELECT * FROM companies WHERE id = ?', [companyId]);
        if (company.length === 0) return res.status(404).json({ error: 'Company not found' });

        const { startDate, endDate } = getFiscalYearDetails(company[0].activity_type, gestion, company[0].operation_start_date);

        // 2. Get all accounts with their final balances for the period
        const accountsWithBalances = await dbAll(`
            SELECT a.*, COALESCE(SUM(te.debit), 0) as total_debit, COALESCE(SUM(te.credit), 0) as total_credit
            FROM accounts a
            LEFT JOIN transaction_entries te ON a.id = te.account_id
            LEFT JOIN transactions t ON te.transaction_id = t.id AND t.date BETWEEN ? AND ? AND t.type != 'Cierre'
            WHERE a.company_id = ?
            GROUP BY a.id
            ORDER BY a.code
        `, [startDate, endDate, companyId]);

        // 3. Separate accounts by type
        const resultadoDeudor = [];
        const resultadoAcreedor = [];
        const activos = [];
        const pasivos = [];
        const patrimonio = [];
        const reguladoras = [];
        const ordenDeudor = [];
        const ordenAcreedor = [];

        // Patterns for variable-nature accounts, from Worksheet.jsx
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

        accountsWithBalances.forEach(acc => {
            const balance = (acc.total_debit || 0) - (acc.total_credit || 0);
            // DO NOT skip zero balance accounts here. They might be needed for closing entries (e.g. IUE por Pagar starts at 0).
            // The final check is done when building the closing entry itself.

            const type = (acc.type || '').toLowerCase();
            const name = (acc.name || '').toLowerCase();

            const isVariable = variablePatterns.some(p => name.includes(p));

            if (isVariable) {
                if (balance > 0) { // Debit balance -> Expense
                    resultadoDeudor.push({ ...acc, balance });
                } else { // Credit balance -> Income
                    resultadoAcreedor.push({ ...acc, balance });
                }
            } else if (['gasto', 'costo'].includes(type)) {
                resultadoDeudor.push({ ...acc, balance });
            } else if (type === 'ingreso') {
                resultadoAcreedor.push({ ...acc, balance });
            } else if (type === 'activo') {
                activos.push({ ...acc, balance });
            } else if (type === 'pasivo') {
                pasivos.push({ ...acc, balance });
            } else if (type === 'patrimonio') {
                patrimonio.push({ ...acc, balance });
            } else if (type === 'reguladora') {
                reguladoras.push({ ...acc, balance });
            } else if (type === 'orden') {
                if (balance > 0) {
                    ordenDeudor.push({ ...acc, balance });
                } else {
                    ordenAcreedor.push({ ...acc, balance });
                }
            }
        });

        // 4. Find key accounts.
        // First, identify all parent accounts to ensure we only select leaf accounts for transactions.
        const parentCodes = new Set(accountsWithBalances.map(a => a.parent_code).filter(Boolean));

        const findAccount = (namePattern, { onlyLeaf = false } = {}) => {
            const matches = accountsWithBalances.filter(a => {
                const isLeaf = !parentCodes.has(a.code);
                const nameMatch = namePattern.test(a.name.toLowerCase());

                if (onlyLeaf) {
                    return nameMatch && isLeaf;
                }
                return nameMatch;
            });
            
            // Si hay múltiples coincidencias, priorizar la de nivel más alto (último nivel)
            if (matches.length > 1) {
                console.log(`⚠️ Múltiples cuentas encontradas para "${namePattern}":`, matches.map(m => `${m.name} (nivel ${m.level})`));
                return matches.reduce((prev, curr) => (curr.level > prev.level ? curr : prev));
            }
            
            return matches[0];
        };

        const pygAccount = findAccount(/p[eé]rdidas y ganancias|resultado del ejercicio/i, { onlyLeaf: true });
        const raAccount = findAccount(/resultado(s)? acumulado(s)?/i, { onlyLeaf: true });
        // Priorizar nombre específico para IUE
        let iueAccount = accountsWithBalances.filter(a => {
            const isLeaf = !parentCodes.has(a.code);
            const nameMatch = a.name.toLowerCase().includes('impuesto a las utilidades de las empresas por pagar');
            return isLeaf && nameMatch;
        });
        
        if (iueAccount.length > 1) {
            console.log(`⚠️ Múltiples cuentas IUE encontradas:`, iueAccount.map(m => `${m.name} (nivel ${m.level})`));
            iueAccount = iueAccount.reduce((prev, curr) => (curr.level > prev.level ? curr : prev));
        } else if (iueAccount.length === 1) {
            iueAccount = iueAccount[0];
        } else {
            iueAccount = null;
        }
        
        if (!iueAccount) {
            const iueMatches = accountsWithBalances.filter(a => {
                const isLeaf = !parentCodes.has(a.code);
                const nameMatch = /iue por pagar|impuesto a las utilidades por pagar/i.test(a.name.toLowerCase());
                return isLeaf && nameMatch;
            });
            
            if (iueMatches.length > 1) {
                console.log(`⚠️ Múltiples cuentas IUE alternativas encontradas:`, iueMatches.map(m => `${m.name} (nivel ${m.level})`));
                iueAccount = iueMatches.reduce((prev, curr) => (curr.level > prev.level ? curr : prev));
            } else if (iueMatches.length === 1) {
                iueAccount = iueMatches[0];
            }
        }

        const rlAccount = findAccount(/reserva legal/i, { onlyLeaf: true });

        if (!pygAccount || !raAccount || !iueAccount || !rlAccount) {
            const missing = [
                !pygAccount ? '"Pérdidas y Ganancias" o "Resultado del Ejercicio"' : null,
                !raAccount ? '"Resultados Acumulados"' : null,
                !iueAccount ? '"IUE por Pagar"' : null,
                !rlAccount ? '"Reserva Legal"' : null
            ].filter(Boolean).join(', ');
            
            console.error('❌ Cuentas clave no encontradas:', missing);
            console.error('📋 Cuentas disponibles:', accountsWithBalances.map(a => `${a.name} (${a.code}) - Nivel ${a.level} - ${a.type}`));
            
            return res.status(400).json({ 
                error: `Cuentas clave no encontradas: ${missing}. Por favor, créelas para continuar con el cierre.`,
                debug: {
                    missing,
                    availableAccounts: accountsWithBalances.map(a => ({ name: a.name, code: a.code, level: a.level, type: a.type }))
                }
            });
        }

        // 5. Generate Closing Entries
        const proposedTransactions = [];
        const closingDate = endDate;

        // A. Cierre de Gastos
        const activeResultadoDeudor = resultadoDeudor.filter(acc => Math.abs(acc.balance) > 0.001);
        const totalGastos = activeResultadoDeudor.reduce((sum, acc) => sum + acc.balance, 0);
        if (totalGastos > 0) {
            const asientoGastos = {
                gloss: 'Asiento de Cierre: Cuentas de Resultado (Deudoras)',
                entries: [
                    { accountId: pygAccount.id, accountName: pygAccount.name, debit: totalGastos, credit: 0 },
                    ...activeResultadoDeudor.map(acc => ({ accountId: acc.id, accountName: acc.name, debit: 0, credit: acc.balance }))
                ]
            };
            proposedTransactions.push(asientoGastos);
        }

        // B. Cierre de Ingresos
        const activeResultadoAcreedor = resultadoAcreedor.filter(acc => Math.abs(acc.balance) > 0.001);
        const totalIngresos = activeResultadoAcreedor.reduce((sum, acc) => sum + acc.balance, 0);
        if (totalIngresos < 0) {
            const asientoIngresos = {
                gloss: 'Asiento de Cierre: Cuentas de Resultado (Acreedoras)',
                entries: [
                    { accountId: pygAccount.id, accountName: pygAccount.name, debit: 0, credit: Math.abs(totalIngresos) },
                    ...activeResultadoAcreedor.map(acc => ({ accountId: acc.id, accountName: acc.name, debit: Math.abs(acc.balance), credit: 0 }))
                ]
            };
            proposedTransactions.push(asientoIngresos);
        }

        // C. Determinación del Resultado
        // Usar la misma lógica que Worksheet.jsx para obtener los valores correctos
        const { generarEstadoResultadosDesdeWorksheet } = require('../utils/serverIncomeStatement.js');

        let erData = null;
        let utilidadBruta = 0;

        try {
            const options = {
                porcentajeReservaLegal: reservaLegalPct !== undefined ? parseFloat(reservaLegalPct) : 5,
                overrideReservaLegal: overrideReservaLegal === true || overrideReservaLegal === 'true'
            };
            erData = await generarEstadoResultadosDesdeWorksheet(companyId, options);

            utilidadBruta = erData.totales.utilidadBrutaEjercicio;
            const ingresosNoImponibles = erData.totales.valNoImponibles || 0;

            const asientoResultado = { gloss: 'Asiento de Cierre: Determinación del Resultado', entries: [] };

            // 1. Cerrar P&G (Debe si hay utilidad, Haber si hay pérdida)
            // El monto para cerrar P&G es la utilidad bruta (antes de impuestos) + ingresos no imponibles
            const totalParaCerrarPYG = Math.abs(utilidadBruta + ingresosNoImponibles);

            if (utilidadBruta + ingresosNoImponibles > 0) {
                // UTILIDAD
                asientoResultado.entries.push({ accountId: pygAccount.id, accountName: pygAccount.name, debit: totalParaCerrarPYG, credit: 0 });

                if (erData.totales.iue > 0) {
                    asientoResultado.entries.push({ accountId: iueAccount.id, accountName: iueAccount.name, debit: 0, credit: erData.totales.iue });
                    const iueAccInMemory = pasivos.find(a => a.id === iueAccount.id);
                    if (iueAccInMemory) iueAccInMemory.balance -= erData.totales.iue;
                }

                if (erData.totales.reservaLegal > 0) {
                    asientoResultado.entries.push({ accountId: rlAccount.id, accountName: rlAccount.name, debit: 0, credit: erData.totales.reservaLegal });
                    const rlAccInMemory = patrimonio.find(a => a.id === rlAccount.id);
                    if (rlAccInMemory) rlAccInMemory.balance -= erData.totales.reservaLegal;
                }

                // La Utilidad Líquida va a Resultados Acumulados
                // ATENCIÓN: erData.totales.utilidadLiquida YA incluye el ajuste de reserva legal
                const uLiquida = erData.totales.utilidadLiquida;
                if (Math.abs(uLiquida) > 0.001) {
                    asientoResultado.entries.push({ accountId: raAccount.id, accountName: raAccount.name, debit: 0, credit: uLiquida });
                    const mainRaAccountForAdjustment = patrimonio.find(a => a.id === raAccount.id);
                    if (mainRaAccountForAdjustment) mainRaAccountForAdjustment.balance -= uLiquida;
                }
            } else {
                // PÉRDIDA
                // En pérdida totalParaCerrarPYG es el crédito a P&G
                asientoResultado.entries.push({ accountId: raAccount.id, accountName: raAccount.name, debit: totalParaCerrarPYG, credit: 0 });
                asientoResultado.entries.push({ accountId: pygAccount.id, accountName: pygAccount.name, debit: 0, credit: totalParaCerrarPYG });

                const mainRaAccountForAdjustment = patrimonio.find(a => a.id === raAccount.id);
                if (mainRaAccountForAdjustment) mainRaAccountForAdjustment.balance += totalParaCerrarPYG;
            }
            proposedTransactions.push(asientoResultado);
        } catch (error) {
            console.error('Error al generar datos de Estado de Resultados:', error);
            // Si falla, generar asiento con valores por defecto
            const asientoResultado = { gloss: 'Asiento de Cierre: Determinación del Resultado (con errores)', entries: [] };
            proposedTransactions.push(asientoResultado);
        }

        // --- CONSOLIDACIÓN DE OTRAS CUENTAS DE RESULTADO EN PATRIMONIO ---
        // Esta sección ahora solo consolida cuentas como "Utilidad de la Gestión" dentro de "Resultados Acumulados".
        const mainRaAccount = patrimonio.find(a => a.id === raAccount.id);

        if (mainRaAccount) {
            const otherResultAccounts = patrimonio.filter(a =>
                a.id !== raAccount.id && /resultado|utilidad|pérdida/i.test(a.name.toLowerCase())
            );
            // Sumar el saldo de las otras cuentas de resultado a la principal.
            otherResultAccounts.forEach(acc => {
                mainRaAccount.balance += acc.balance;
                // Poner a cero las otras cuentas para evitar duplicidad en el asiento de cierre.
                acc.balance = 0;
            });
        } else {
            // Fallback por si no se encuentra la cuenta principal, aunque el chequeo inicial debería prevenirlo.
            console.warn("No se encontró la cuenta principal 'Resultados Acumulados' para consolidar otras cuentas de resultado del patrimonio.");
        }

        // D. Cierre de Cuentas de Balance
        const asientoBalance = { gloss: 'Asiento de Cierre: Cuentas de Balance', entries: [] };

        // Usar lógica basada en signo para manejar correctamente Reguladoras de Activo (que tienen saldo acreedor)
        const balanceSheetAccounts = [...activos, ...pasivos, ...patrimonio, ...reguladoras];

        balanceSheetAccounts.forEach(acc => {
            const bal = acc.balance;
            if (Math.abs(bal) < 0.001) return;

            if (bal > 0) {
                // Saldo Deudor (Activos) -> Se cierra Acreditando
                asientoBalance.entries.push({ accountId: acc.id, accountName: acc.name, debit: 0, credit: bal });
            } else {
                // Saldo Acreedor (Pasivos, Patrimonio, Reguladoras) -> Se cierra Debitando
                asientoBalance.entries.push({ accountId: acc.id, accountName: acc.name, debit: Math.abs(bal), credit: 0 });
            }
        });
        proposedTransactions.push(asientoBalance);

        // E. Cierre de Cuentas de Orden
        const activeOrdenAcreedor = ordenAcreedor.filter(acc => Math.abs(acc.balance) > 0.001);
        const activeOrdenDeudor = ordenDeudor.filter(acc => Math.abs(acc.balance) > 0.001);

        if (activeOrdenAcreedor.length > 0 || activeOrdenDeudor.length > 0) {
            const asientoOrden = { gloss: 'Asiento de Cierre: Cuentas de Orden', entries: [] };
            activeOrdenAcreedor.forEach(acc => asientoOrden.entries.push({ accountId: acc.id, accountName: acc.name, debit: Math.abs(acc.balance), credit: 0 }));
            activeOrdenDeudor.forEach(acc => asientoOrden.entries.push({ accountId: acc.id, accountName: acc.name, debit: 0, credit: acc.balance }));
            proposedTransactions.push(asientoOrden);
        }

        res.json({ data: { proposedTransactions, closingDate } });
    } catch (error) {
        console.error('Error generating closing entries proposal:', error);
        res.status(500).json({ error: error.message });
    }
});

// Adjustment Entries Proposal Endpoint V2.0
router.post('/adjustment-entries-proposal', async (req, res) => {
    console.log('*** ENDPOINT /adjustment-entries-proposal RECIBIDO ***');

    const { companyId, gestion, adjParams, exchangeRate_initial, exchangeRate_final, accountBalances } = req.body;

    console.log('=== DEBUG BACKEND ADJUSTMENT ===');
    console.log('companyId:', companyId);
    console.log('gestion:', gestion);
    console.log('accountBalances recibido:', accountBalances ? accountBalances.length : 'undefined');
    console.log('adjParams recibido:', !!adjParams);

    if (!companyId || !gestion) {
        return res.status(400).json({ error: 'companyId and gestion are required' });
    }

    try {
        // 1. Get company info and fiscal year
        const company = await dbAll('SELECT * FROM companies WHERE id = ?', [companyId]);
        if (company.length === 0) return res.status(404).json({ error: 'Company not found' });

        const { startDate, endDate } = getFiscalYearDetails(company[0].activity_type, gestion, company[0].operation_start_date);

        // 2. Get account balances (excluding adjustments and closing)
        let accountsWithBalances;
        if (accountBalances && Array.isArray(accountBalances)) {
            accountsWithBalances = accountBalances;
        } else {
            accountsWithBalances = await dbAll(`
                SELECT a.*, COALESCE(SUM(te.debit), 0) as total_debit, COALESCE(SUM(te.credit), 0) as total_credit
                FROM accounts a
                LEFT JOIN transaction_entries te ON a.id = te.account_id
                LEFT JOIN transactions t ON te.transaction_id = t.id AND t.date BETWEEN ? AND ? AND t.type != 'Cierre' AND t.type != 'Ajuste'
                WHERE a.company_id = ?
                GROUP BY a.id
                ORDER BY a.code
            `, [startDate, endDate, companyId]);
        }

        // 2.1 Check if closing entries already exist for this period
        const closingEntriesCheck = await dbAll(`
            SELECT COUNT(*) as closing_count, MAX(date) as last_closing_date
            FROM transactions 
            WHERE company_id = ? 
            AND date BETWEEN ? AND ? 
            AND type = 'Cierre'
        `, [companyId, startDate, endDate]);

        const hasClosingEntries = closingEntriesCheck[0].closing_count > 0;
        const lastClosingDate = closingEntriesCheck[0].last_closing_date;

        // 2.2 Analysis of the Account Plan (Contextual Intelligence)
        const planAnalysis = AccountPlanIntelligence.analyze(accountsWithBalances);
        console.log('Inteligencia de Plan detectada:', {
            separator: planAnalysis.separator,
            levelCount: planAnalysis.levelCount
        });

        // 2.3 Check if there are any balances to adjust
        let accountsWithBalance;
        if (accountBalances && Array.isArray(accountBalances)) {
            // Usar los balances enviados desde el frontend (ledger)
            accountsWithBalance = accountsWithBalances.filter(acc =>
                Math.abs(acc.balance) > 0.01
            );
            console.log('Usando balances del frontend - cuentas con balance:', accountsWithBalance.length);
        } else {
            // Usar cálculo tradicional total_debit - total_credit
            accountsWithBalance = accountsWithBalances.filter(acc =>
                Math.abs(acc.total_debit - acc.total_credit) > 0.01
            );
            console.log('Usando cálculo tradicional - cuentas con balance:', accountsWithBalance.length);
        }

        console.log('Cuentas con balance según total_debit-credit:', accountsWithBalance.length);
        console.log('Primeras 3 cuentas procesadas:', accountsWithBalances.slice(0, 3).map(acc => ({
            code: acc.code,
            name: acc.name,
            total_debit: acc.total_debit,
            total_credit: acc.total_credit,
            balance: acc.balance
        })));

        // 2.3 Return early if no balances exist or closing entries already done
        if (hasClosingEntries) {
            return res.json({
                data: {
                    proposedTransactions: [],
                    adjustmentDate: endDate,
                    batchId: `ADJ_${companyId}_${gestion}_${Date.now()}`,
                    ccFactor: 1.0,
                    summary: {
                        totalTransactions: 0,
                        totalAITBAdjustment: 0,
                        totalDepreciation: 0,
                        totalProvision: 0
                    },
                    warning: `CICLO CONTABLE CERRADO: Ya existen asientos de cierre para la gestión ${gestion} (último cierre: ${lastClosingDate}). 
 No se pueden realizar ajustes porque el ciclo contable ha sido finalizado. 
 Los ajustes deben realizarse ANTES del cierre de gestión.`,
                    cycleStatus: 'CLOSED'
                }
            });
        }

        if (accountsWithBalance.length === 0) {
            return res.json({
                data: {
                    proposedTransactions: [],
                    adjustmentDate: endDate,
                    batchId: `ADJ_${companyId}_${gestion}_${Date.now()}`,
                    ccFactor: 1.0,
                    summary: {
                        totalTransactions: 0,
                        totalAITBAdjustment: 0,
                        totalDepreciation: 0,
                        totalProvision: 0
                    },
                    warning: `SIN SALDOS DISPUESTOS: No existen saldos para ajustar en la gestión ${gestion}. 
 Esto puede ocurrir si: 1) No hay transacciones en el período, 2) Ya se realizaron ajustes previos, 
 o 3) Las cuentas ya fueron saldadas. Verifique el libro mayor para más detalles.`,
                    cycleStatus: 'NO_BALANCES'
                }
            });
        }

        // 3. Load adjustment parameters (use provided defaults if not available)
        const defaultParams = {
            reasoning_config: {
                persona: "Senior Forensic Accountant (Compliance Mode)",
                confidence_threshold: 0.95,
                iue_rate: 0.25,
                rl_rate: 0.05,
                constraints_tax: [
                    "Los ajustes por inflación (NC 3) son obligatorios para rubros no monetarios.",
                    "La depreciación debe aplicarse sobre el valor revaluado (incluye AITB)."
                ]
            },
            monetary_rules: [
                { pattern: /MN/i, tags: ["Monetario", "MonedaNacional"], source_nc: "NC3-Rubro-E" },
                { pattern: /Caja|Banco|Disponibilidad/i, tags: ["Monetario", "Liquidez"], source_nc: "NC3-Rubro-E" },
                { pattern: /Cuentas Por (Cobrar|Pagar) MN/i, tags: ["Monetario", "Exigible"], source_nc: "NC3-Rubro-E" },
                { pattern: /Gasto|Costo|Ingreso|Perdida/i, tags: ["Monetario", "Resultado"], source_nc: "NC3-Excluido-Ajuste" },
                { pattern: /Caja|Banco|Cuentas Por (Cobrar|Pagar) ME/i, tags: ["Monetario", "MonedaExtranjera", "AjusteNC6"], source_nc: "NC6" },
                { pattern: /^1[0-5]/, tags: ["Monetario", "ActivoCorriente"], source_nc: "PlanCuentas-Activo" },
                { pattern: /^2[0-5]/, tags: ["Monetario", "PasivoCorriente"], source_nc: "PlanCuentas-Pasivo" },
                { pattern: /^3[0-5]/, tags: ["Monetario", "Patrimonio"], source_nc: "PlanCuentas-Patrimonio" },
                { pattern: /^[4-6][0-9]/, tags: ["Monetario", "Resultado"], source_nc: "PlanCuentas-Resultado" },
            ],
            non_monetary_rules: [
                { pattern: /Inventario|Mercadería/i, tags: ["NoMonetario", "ActivoCorriente"], source_nc: "NC3-Rubro-F" },
                { pattern: /Activo(s)? Fijo(s)?|Inmueble(s)?|Edific(i|í)o(s)?|Mueble(s)? y Enseres|Veh(i|í)culo(s)?|Maquinar(i|í)a|Equipo(s)? de Computac(i|ió)n|Herramienta(s)?/i, tags: ["NoMonetario", "Depreciable", "ActivoFijo"], source_nc: "NC3-Rubro-F" },
                { pattern: /Intangible(s)?|Cargos Diferidos|Software|Derecho(s)?/i, tags: ["NoMonetario", "Amortizable"], source_nc: "NC3-Rubro-F" },
                { pattern: /Patrimonio|Capital|Reserva(s)?|Ajuste (de|del) Capital/i, tags: ["NoMonetario", "Patrimonio"], source_nc: "NC3-Rubro-F" },
                { pattern: /Préstamos Bancarios M(oneda)? E(xtranjera)?/i, tags: ["NoMonetario", "Pasivo"], source_nc: "NC6" },
                { pattern: /Provisión(es)?|Indemnizac(i|ió)n(es)?/i, tags: ["NoMonetario", "PasivoNoCorriente"], source_nc: "NC6-Provisión" },
            ],
            code_fallback_rules: [
                { pattern: /^1[6-9]/, tags: ["NoMonetario", "ActivoNoCorriente"], source_nc: "PlanCuentas-Activo" },
                { pattern: /^1[2-3]/, tags: ["NoMonetario", "ActivoCorriente"], source_nc: "PlanCuentas-Activo" },
                { pattern: /^2[6-9]/, tags: ["NoMonetario", "PasivoNoCorriente"], source_nc: "PlanCuentas-Pasivo" },
                { pattern: /^1[0-5]/, type: 'monetary', tags: ["Monetario", "ActivoCorriente"], source_nc: "PlanCuentas-Activo" },
                { pattern: /^2[0-5]/, type: 'monetary', tags: ["Monetario", "PasivoCorriente"], source_nc: "PlanCuentas-Pasivo" },
                { pattern: /^3/, type: 'non_monetary', tags: ["NoMonetario", "Patrimonio"], source_nc: "PlanCuentas-Patrimonio" },
                { pattern: /^[4-6]/, type: 'monetary', tags: ["Monetario", "Resultado"], source_nc: "PlanCuentas-Resultado" },
            ],
            aitb_settings: {
                aitb_account_patterns: [
                    "Ajuste por inflacion",
                    "Ajuste por inflación",
                    "Ajuste inflacion",
                    "Ajuste inflación",
                    "Inflacion y tenencia",
                    "Inflación y tenencia",
                    "AITB",
                    "Ajuste integral",
                    "Revalorizacion",
                    "Revalorización"
                ],
                aitb_method: 'UFV',
                calculation_rules: {
                    precision: 6,
                    rounding_method: "bankers",
                    minimum_threshold: 0.01,
                }
            },
            depreciation_settings: {
                dep_expense_patterns: [
                    "gasto depreciacion",
                    "gasto depreciación",
                    "depreciacion del ejercicio",
                    "depreciación del ejercicio",
                    "depreciacion acumulada",
                    "depreciación acumulada",
                    "cargo depreciacion",
                    "cargo depreciación"
                ],
                dep_accum_patterns: [
                    "depreciacion acumulada",
                    "depreciación acumulada",
                    "amortizacion acumulada",
                    "amortización acumulada",
                    "depreciacion y amortizacion",
                    "depreciación y amortización"
                ],
                assets_life: [
                    {
                        asset_type_keyword: "muebles y enseres",
                        useful_life_years: 10,
                        calculation_method: "Linear",
                        annual_rate: 0.10,
                        monthly_rate_formula: "(VALUE * annual_rate) / 12",
                        nc_reference: "DS 24051 - Anexo",
                        confidence_level: 0.90,
                    },
                    {
                        asset_type_keyword: "edificios",
                        useful_life_years: 40,
                        calculation_method: "Linear",
                        annual_rate: 0.025,
                        monthly_rate_formula: "(VALUE * annual_rate) / 12",
                        nc_reference: "DS 24051 - Anexo",
                        confidence_level: 0.95,
                    },
                    {
                        asset_type_keyword: "vehiculos",
                        useful_life_years: 5,
                        calculation_method: "Linear",
                        annual_rate: 0.20,
                        monthly_rate_formula: "(VALUE * annual_rate) / 12",
                        nc_reference: "DS 24051 - Anexo",
                        confidence_level: 0.85,
                    },
                    {
                        asset_type_keyword: "maquinaria y equipo",
                        useful_life_years: 10,
                        calculation_method: "Linear",
                        annual_rate: 0.10,
                        monthly_rate_formula: "(VALUE * annual_rate) / 12",
                        nc_reference: "DS 24051 - Anexo",
                        confidence_level: 0.90,
                    },
                    {
                        asset_type_keyword: "equipos de computación",
                        useful_life_years: 5,
                        calculation_method: "Linear",
                        annual_rate: 0.20,
                        monthly_rate_formula: "(VALUE * annual_rate) / 12",
                        nc_reference: "DS 24051 - Anexo",
                        confidence_level: 0.85,
                    },
                    {
                        asset_type_keyword: "activos intangibles",
                        useful_life_years: 10,
                        calculation_method: "Linear",
                        annual_rate: 0.10,
                        monthly_rate_formula: "(VALUE * annual_rate) / 12",
                        nc_reference: "NC 6 - Art. 38",
                        confidence_level: 0.80,
                    },
                    {
                        asset_type_keyword: "cargos diferidos",
                        useful_life_years: 5,
                        calculation_method: "Linear",
                        annual_rate: 0.20,
                        monthly_rate_formula: "(VALUE * annual_rate) / 12",
                        nc_reference: "NC 6 - Art. 42",
                        confidence_level: 0.75,
                    }
                ]
            },
            consolidation_accounts: {
                provision_expense_patterns: [
                    "gasto provision",
                    "gasto provisión",
                    "provision cuentas incobrables",
                    "provisión cuentas incobrables",
                    "estimacion cuentas incobrables",
                    "estimación cuentas incobrables"
                ],
                provision_accumulated_patterns: [
                    "provision cuentas incobrables",
                    "provisión cuentas incobrables",
                    "estimacion cuentas incobrables",
                    "estimación cuentas incobrables",
                    "deterioro cuentas por cobrar"
                ],
            }
        };

        const params = adjParams || defaultParams;

        // 4. Helper functions
        const findAccount = (pattern, options = {}) => {
            const regex = new RegExp(pattern, 'i');
            return accountsWithBalances.find(a => {
                const match = regex.test(a.name) || regex.test(a.code);
                if (options.type) {
                    const classification = classifyAccountV2(a.code, a.name, params);
                    return match && classification.type === options.type;
                }
                return match;
            });
        };

        // Nueva función de clasificación usando el esquema semántico V2 + Inteligencia Jerárquica
        const classifyAccountV2 = (accountCode, accountName, profile, depth = 0) => {
            const code = accountCode || '';
            const name = accountName || '';
            const combined = `${code} ${name}`.toLowerCase();

            // 1. Evitar recursión infinita
            if (depth > 5) return { type: 'unknown', tags: [] };

            // 2. Helper function para asegurar que pattern sea RegExp
            const ensureRegExp = (pattern) => {
                if (pattern instanceof RegExp) return pattern;
                if (typeof pattern === 'string') return new RegExp(pattern, 'i');
                if (pattern && typeof pattern === 'object' && pattern.source) return new RegExp(pattern.source, 'i');
                return new RegExp('', 'i');
            };

            // 3. Evaluar reglas no monetarias PRIMERO
            for (const rule of profile.non_monetary_rules) {
                try {
                    const regex = ensureRegExp(rule.pattern);
                    if (regex.test(combined)) {
                        return {
                            type: 'non_monetary',
                            tags: rule.tags || [],
                            source_nc: rule.source_nc,
                            matched_pattern: regex.toString(),
                            confidence: 0.9 + (depth * 0.01) // La profundidad añade contexto
                        };
                    }
                } catch (error) { continue; }
            }

            // 4. Evaluar reglas monetarias SEGUNDO
            for (const rule of profile.monetary_rules) {
                try {
                    const regex = ensureRegExp(rule.pattern);
                    if (regex.test(combined)) {
                        return {
                            type: 'monetary',
                            tags: rule.tags || [],
                            source_nc: rule.source_nc,
                            matched_pattern: regex.toString(),
                            confidence: 0.9
                        };
                    }
                } catch (error) { continue; }
            }

            // 5. INTELIGENCIA JERÁRQUICA: Si no hay match semántico directo, preguntar al padre
            const parentCode = AccountPlanIntelligence.getParent(code, planAnalysis);
            if (parentCode) {
                const parentAccount = planAnalysis.accountMap.get(parentCode);
                if (parentAccount) {
                    const parentClassification = classifyAccountV2(parentAccount.code, parentAccount.name, profile, depth + 1);
                    if (parentClassification.type !== 'unknown') {
                        return {
                            ...parentClassification,
                            source_nc: `${parentClassification.source_nc} (Match vía Ancestro: ${parentAccount.name})`,
                            confidence: Math.max(0.7, parentClassification.confidence - 0.05)
                        };
                    }
                }
            }

            // 6. Evaluar reglas basadas en CÓDIGO (Fallback secundario antes del defecto)
            const allCodeRules = [
                ...(profile.code_fallback_rules || []),
            ];

            for (const rule of allCodeRules) {
                try {
                    const regex = ensureRegExp(rule.pattern);
                    if (regex.test(code)) {
                        return {
                            type: rule.type || (rule.tags?.includes('NoMonetario') ? 'non_monetary' : 'monetary'),
                            tags: rule.tags || [],
                            source_nc: rule.source_nc,
                            matched_pattern: regex.toString(),
                            confidence: 0.8
                        };
                    }
                } catch (error) { continue; }
            }

            // 7. Clasificación por defecto básica (Último recurso)
            if (code.startsWith('1')) return { type: 'monetary', tags: ['Activo'], source_nc: 'PlanCuentas-PorDefecto' };
            if (code.startsWith('2')) return { type: 'monetary', tags: ['Pasivo'], source_nc: 'PlanCuentas-PorDefecto' };
            if (code.startsWith('3')) return { type: 'non_monetary', tags: ['Patrimonio'], source_nc: 'PlanCuentas-PorDefecto' };

            return { type: 'unknown', tags: ['Desconocido'], source_nc: 'PlanCuentas-PorDefecto' };
        };

        // Función para verificar si es no monetario usando el nuevo sistema
        const isNonMonetary = (accountCode, accountName) => {
            const classification = classifyAccountV2(accountCode, accountName, params);
            return classification.type === 'non_monetary';
        };

        // Función para obtener configuración de depreciación
        const getDepreciationConfig = (accountName, profile) => {
            const name = accountName.toLowerCase();

            for (const config of profile.depreciation_settings.assets_life) {
                if (name.includes(config.asset_type_keyword)) {
                    return config;
                }
            }

            // Configuración por defecto
            return {
                asset_type_keyword: "desconocido",
                useful_life_years: 10,
                calculation_method: "Linear",
                annual_rate: 0.10,
                monthly_rate_formula: "(VALUE * annual_rate) / 12",
                nc_reference: "Por Defecto",
                confidence_level: 0.50,
            };
        };

        // Función de redondeo financiero (Banker's Rounding)
        const bankersRound = (num, precision = 2) => {
            const factor = Math.pow(10, precision);
            const n = num * factor;
            const rounded = Math.round(n);
            const decimal = n - Math.floor(n);

            if (decimal === 0.5 && rounded % 2 !== 0) {
                return (rounded - 1) / factor;
            }
            return rounded / factor;
        };

        // Función para encontrar cuenta AITB por patrones
        const findAITBAccount = (accounts, patterns) => {
            for (const pattern of patterns) {
                const regex = new RegExp(pattern, 'i');
                const found = accounts.find(acc =>
                    regex.test(acc.name) || regex.test(acc.code)
                );
                if (found) return found;
            }
            return null;
        };

        // Función para encontrar cuenta por patrones
        const findAccountByPatterns = (accounts, patterns) => {
            for (const pattern of patterns) {
                const regex = new RegExp(pattern, 'i');
                const found = accounts.find(acc =>
                    regex.test(acc.name) || regex.test(acc.code)
                );
                if (found) return found;
            }
            return null;
        };

        // 5. Calcular Coeficiente Corrector (CC) y Factores
        const initialRate = parseFloat(exchangeRate_initial) || 1;
        const finalRate = parseFloat(exchangeRate_final) || 1;
        const ccFactor = finalRate / initialRate;

        console.log('--- CÁLCULO DE AJUSTES ---');
        console.log(`Tasas: Inicial=${initialRate}, Final=${finalRate}, CC=${ccFactor}`);

        const proposedTransactions = [];
        let totalAITB = 0;
        let totalDepreciation = 0;

        const aitbAccount = findAITBAccount(accountsWithBalances, params.aitb_settings?.aitb_account_patterns || []);

        // 6. Generar Asientos de AITB (NC3) para rubros No Monetarios
        const aitbEntries = [];
        accountsWithBalance.forEach(acc => {
            if (isNonMonetary(acc.code, acc.name)) {
                const balance = acc.balance !== undefined ? acc.balance : (acc.total_debit - acc.total_credit);
                const adjustment = bankersRound(balance * (ccFactor - 1), 2);

                if (Math.abs(adjustment) > 0.01) {
                    // Entrada para la cuenta principal
                    aitbEntries.push({
                        accountId: acc.id,
                        account_name: acc.name,
                        debit: adjustment > 0 ? adjustment : 0,
                        credit: adjustment < 0 ? Math.abs(adjustment) : 0,
                        gloss: `Ajuste por Inflación (NC3): ${acc.name}`
                    });

                    // Contrapartida AITB
                    aitbEntries.push({
                        accountId: aitbAccount?.id || null,
                        account_name: aitbAccount?.name || 'Ajuste por Inflación y Tenencia de Bienes',
                        debit: adjustment < 0 ? Math.abs(adjustment) : 0,
                        credit: adjustment > 0 ? adjustment : 0,
                        gloss: `Ajuste por Inflación (NC3): ${acc.name}`
                    });

                    totalAITB += Math.abs(adjustment);
                }
            }
        });

        if (aitbEntries.length > 0) {
            proposedTransactions.push({
                gloss: "Ajuste Integral por Inflación y Tenencia de Bienes (NC3)",
                type: "Ajuste",
                date: endDate,
                entries: aitbEntries
            });
        }

        // 7. Depreciación de Activos Fijos
        const fixedAssets = accountsWithBalance.filter(acc => {
            const classification = classifyAccountV2(acc.code, acc.name, params);
            return classification.tags && classification.tags.includes('Depreciable');
        });

        console.log(`Activos Fijos detectados: ${fixedAssets.length}`);

        if (fixedAssets.length > 0) {
            const depExpenseAccount = findAccountByPatterns(accountsWithBalances, params.depreciation_settings?.dep_expense_patterns || []);
            const depAccumAccount = findAccountByPatterns(accountsWithBalances, params.depreciation_settings?.dep_accum_patterns || []);

            fixedAssets.forEach(asset => {
                const depreciationConfig = getDepreciationConfig(asset.name, params);
                const historicalBalance = asset.balance !== undefined ? asset.balance : (asset.total_debit - asset.total_credit);

                // Aplicar AITB al valor del activo para base de depreciación (NC3)
                const aitbAdjustment = isNonMonetary(asset.code, asset.name) ?
                    bankersRound(historicalBalance * (ccFactor - 1), 2) : 0;
                const adjustedValue = historicalBalance + aitbAdjustment;

                // Depreciación mensual: (Valor Ajustado * Tasa Anual) / 12
                const annualDepreciation = bankersRound(adjustedValue * depreciationConfig.annual_rate, 2);
                const monthlyDepreciation = bankersRound(annualDepreciation / 12, 2);

                if (monthlyDepreciation > 0.01) {
                    proposedTransactions.push({
                        gloss: `Depreciación Mensual: ${asset.name} (${depreciationConfig.asset_type_keyword})`,
                        type: "Ajuste",
                        date: endDate,
                        entries: [
                            {
                                accountId: depExpenseAccount?.id || null,
                                account_name: depExpenseAccount?.name || 'Gasto Depreciación (No Configurada)',
                                debit: monthlyDepreciation,
                                credit: 0
                            },
                            {
                                accountId: depAccumAccount?.id || null,
                                account_name: depAccumAccount?.name || 'Depreciación Acumulada (No Configurada)',
                                debit: 0,
                                credit: monthlyDepreciation
                            }
                        ]
                    });
                    totalDepreciation += monthlyDepreciation;
                }
            });
        }

        // 8. Responder con la propuesta
        res.json({
            data: {
                proposedTransactions,
                adjustmentDate: endDate,
                batchId: `ADJ_${companyId}_${gestion}_${Date.now()}`,
                ccFactor,
                summary: {
                    totalTransactions: proposedTransactions.length,
                    totalAITBAdjustment: bankersRound(totalAITB, 2),
                    totalDepreciation: bankersRound(totalDepreciation, 2),
                    totalProvision: 0
                },
                cycleStatus: 'OPEN'
            }
        });
    } catch (error) {
        console.error('*** ERROR EN /adjustment-entries-proposal ***:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ error: error.message });
    }
});

// Closing Check Endpoint - Validate if cycle is closed before adjustments
router.get('/closing-check', async (req, res) => {
    const { companyId, gestion } = req.query;

    if (!companyId || !gestion) {
        return res.status(400).json({ error: 'companyId and gestion are required' });
    }

    try {
        // Get company info to determine fiscal year
        const company = await dbAll('SELECT * FROM companies WHERE id = ?', [companyId]);
        if (company.length === 0) return res.status(404).json({ error: 'Company not found' });

        const { startDate, endDate } = getFiscalYearDetails(company[0].activity_type, gestion, company[0].operation_start_date);

        // Check if closing entries exist for this period
        const closingEntriesCheck = await dbAll(`
            SELECT COUNT(*) as closing_count, MAX(date) as last_closing_date, 
                   GROUP_CONCAT(DISTINCT gloss) as closing_glosses
            FROM transactions 
            WHERE company_id = ? 
            AND date BETWEEN ? AND ? 
            AND type = 'Cierre'
        `, [companyId, startDate, endDate]);

        const hasClosingEntries = closingEntriesCheck[0].closing_count > 0;
        const lastClosingDate = closingEntriesCheck[0].last_closing_date;
        const closingGlosses = closingEntriesCheck[0].closing_glosses;

        // Check if there are any transactions (excluding closing and adjustments)
        const transactionCheck = await dbAll(`
            SELECT COUNT(DISTINCT t.id) as transaction_count
            FROM transactions t
            WHERE t.company_id = ?
            AND t.date BETWEEN ? AND ?
            AND t.type != 'Cierre' AND t.type != 'Ajuste'
        `, [companyId, startDate, endDate]);

        const hasTransactions = transactionCheck[0].transaction_count > 0;

        // Check if there are any balances to adjust
        const balanceCheck = await dbAll(`
            SELECT COUNT(*) as accounts_with_balance
            FROM accounts a
            LEFT JOIN transaction_entries te ON a.id = te.account_id
            LEFT JOIN transactions t ON te.transaction_id = t.id 
                AND t.date BETWEEN ? AND ? 
                AND t.type != 'Cierre' AND t.type != 'Ajuste'
            WHERE a.company_id = ?
            GROUP BY a.id
            HAVING ABS(COALESCE(SUM(te.debit), 0) - COALESCE(SUM(te.credit), 0)) > 0.01
        `, [startDate, endDate, companyId]);

        const hasBalances = balanceCheck.length > 0;

        res.json({
            hasClosingEntries,
            lastClosingDate,
            closingGlosses,
            hasTransactions,
            hasBalances,
            cycleStatus: hasClosingEntries ? 'CLOSED' : (hasBalances ? 'OPEN' : 'NO_BALANCES'),
            periodInfo: {
                gestion,
                startDate,
                endDate,
                activityType: company[0].activity_type
            },
            summary: {
                totalTransactions: transactionCheck[0].transaction_count,
                accountsWithBalance: balanceCheck.length,
                closingEntriesCount: closingEntriesCheck[0].closing_count
            }
        });
    } catch (error) {
        console.error('Error checking closing status:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
