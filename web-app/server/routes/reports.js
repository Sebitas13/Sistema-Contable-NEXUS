const express = require('express');
const router = express.Router();
const db = require('../db');
console.log('*** ARCHIVO reports.js CARGADO ***');
// Corrected: Import server-side utilities, not client-side code.
const { getFiscalYearDetails } = require('../utils/serverFiscalYearUtils.js');
const AccountPlanIntelligence = require('../utils/AccountPlanIntelligence.js');
const { buildFinancialReports, closingProposal } = require('../utils/financialReportsCore.js');



// Helper function to promisify db.all
const dbAll = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

async function getPeriodAccountBalances(companyId, startDate, endDate) {
    return dbAll(`
        SELECT
            a.id, a.company_id, a.code, a.name, a.type, a.level, a.parent_code,
            COALESCE(SUM(CASE WHEN t.id IS NOT NULL
                AND NOT (UPPER(COALESCE(t.type, '')) = 'CIERRE'
                    AND LOWER(COALESCE(t.gloss, '')) LIKE '%cuentas de balance%')
                THEN te.debit ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN t.id IS NOT NULL
                AND NOT (UPPER(COALESCE(t.type, '')) = 'CIERRE'
                    AND LOWER(COALESCE(t.gloss, '')) LIKE '%cuentas de balance%')
                THEN te.credit ELSE 0 END), 0) AS total_credit,
            COALESCE(SUM(CASE WHEN t.id IS NOT NULL
                AND t.date >= ? AND t.date <= ?
                AND UPPER(COALESCE(t.type, '')) <> 'CIERRE'
                THEN te.debit ELSE 0 END), 0) AS period_debit,
            COALESCE(SUM(CASE WHEN t.id IS NOT NULL
                AND t.date >= ? AND t.date <= ?
                AND UPPER(COALESCE(t.type, '')) <> 'CIERRE'
                THEN te.credit ELSE 0 END), 0) AS period_credit,
            COALESCE(SUM(CASE WHEN t.id IS NOT NULL
                AND t.date >= ? AND t.date <= ?
                AND UPPER(COALESCE(t.type, '')) = 'CIERRE'
                THEN te.debit ELSE 0 END), 0) AS closing_debit,
            COALESCE(SUM(CASE WHEN t.id IS NOT NULL
                AND t.date >= ? AND t.date <= ?
                AND UPPER(COALESCE(t.type, '')) = 'CIERRE'
                THEN te.credit ELSE 0 END), 0) AS closing_credit
        FROM accounts a
        LEFT JOIN transaction_entries te ON te.account_id = a.id
        LEFT JOIN transactions t ON t.id = te.transaction_id
            AND t.company_id = ? AND t.date <= ?
        WHERE a.company_id = ?
        GROUP BY a.id
        ORDER BY a.code
    `, [startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate, companyId, endDate, companyId]);
}

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

        // Filtro de empresa para las TRANSACCIONES (t), además del filtro por cuentas (a).
        // Antes este valor se construía pero nunca se interpolaba en el SQL: asientos de
        // otra empresa podían contaminar el Mayor si una partida referenciaba una cuenta ajena.
        companyFilter = 't.company_id = ?';
        params.push(companyId, companyId);

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
            WHERE a.company_id = ? AND (t.id IS NULL OR (${companyFilter} ${dateFilter})) ${typeFilter}
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

// Period-based reports are the source for published statements and closing proposals.
router.get('/financial-statements', async (req, res) => {
    try {
        const { companyId } = req.query;
        if (!companyId) return res.status(400).json({ error: 'companyId is required' });

        const companies = await dbAll(
            'SELECT id, activity_type, current_year, operation_start_date FROM companies WHERE id = ?',
            [companyId]
        );
        if (!companies.length) return res.status(404).json({ error: 'Company not found' });

        const company = companies[0];
        const year = Number(req.query.gestion || company.current_year || new Date().getFullYear());
        if (!Number.isInteger(year) || year < 1900 || year > 2200) {
            return res.status(400).json({ error: 'gestion must be a valid fiscal year' });
        }
        const fiscal = getFiscalYearDetails(company.activity_type, year, company.operation_start_date);
        const startDate = req.query.startDate || fiscal.startDate;
        const endDate = req.query.endDate || fiscal.endDate;
        const validDate = value => {
            if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
            const parsed = new Date(`${value}T00:00:00Z`);
            return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
        };
        if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
            return res.status(400).json({ error: 'Invalid report date range' });
        }

        const [accounts, closingRows, legacyClosingRows] = await Promise.all([
            getPeriodAccountBalances(companyId, startDate, endDate),
            dbAll(`
                SELECT COUNT(DISTINCT t.id) AS closing_count,
                    COUNT(DISTINCT CASE WHEN LOWER(COALESCE(a.name, '')) LIKE '%resultados acumulados%'
                        THEN t.id END) AS retained_earnings_closing_count,
                    COUNT(DISTINCT CASE WHEN LOWER(COALESCE(a.name, '')) LIKE '%perdidas y ganancias%'
                        OR LOWER(COALESCE(a.name, '')) LIKE '%resultado del ejercicio%'
                        OR LOWER(COALESCE(a.name, '')) LIKE '%utilidad del ejercicio%'
                        THEN t.id END) AS profit_clearing_closing_count
                FROM transactions t
                LEFT JOIN transaction_entries te ON te.transaction_id = t.id
                LEFT JOIN accounts a ON a.id = te.account_id AND a.company_id = t.company_id
                WHERE t.company_id = ? AND t.date BETWEEN ? AND ?
                    AND UPPER(COALESCE(t.type, '')) = 'CIERRE'
            `, [companyId, startDate, endDate]),
            dbAll(`
                SELECT COUNT(DISTINCT id) AS legacy_balance_closings
                FROM transactions
                WHERE company_id = ? AND date <= ?
                    AND UPPER(COALESCE(type, '')) = 'CIERRE'
                    AND LOWER(COALESCE(gloss, '')) LIKE '%cuentas de balance%'
            `, [companyId, endDate])
        ]);

        const hasClosingEntries = Number(closingRows[0]?.closing_count || 0) > 0;
        const hasResultClosing = Number(closingRows[0]?.retained_earnings_closing_count || 0) > 0 &&
            Number(closingRows[0]?.profit_clearing_closing_count || 0) > 0;
        const report = buildFinancialReports(accounts, {
            startDate,
            endDate,
            hasResultClosing
        });
        if (hasClosingEntries && !hasResultClosing) {
            const warning = 'Hay asientos de cierre en la gestión, pero no se identifica el traspaso completo de Pérdidas y Ganancias a Resultados Acumulados; se conserva el resultado del período y el mayor requiere revisión.';
            report.metadata.warnings.push({ type: 'incompleteResultClosing', message: warning });
        }
        const legacyBalanceClosings = Number(legacyClosingRows[0]?.legacy_balance_closings || 0);
        if (legacyBalanceClosings > 0) {
            report.metadata.warnings.push({
                type: 'legacyBalanceClosingsIgnored',
                message: `Se excluyeron ${legacyBalanceClosings} antiguo(s) asiento(s) de cierre de cuentas permanentes para reconstruir sus saldos; revisa la contabilidad histórica.`
            });
        }
        let worksheetClosing = { available: false, byAccount: {}, warning: null };
        if (hasClosingEntries) {
            for (const account of accounts) {
                const debit = Number(account.closing_debit) || 0;
                const credit = Number(account.closing_credit) || 0;
                if (debit || credit) worksheetClosing.byAccount[String(account.id)] = { debit, credit };
            }
            worksheetClosing.available = Object.keys(worksheetClosing.byAccount).length > 0;
            worksheetClosing.warning = 'Se muestran los asientos de cierre ya registrados para este período.';
            if (!hasResultClosing) {
                worksheetClosing.warning += ' No se detecta el traspaso completo del resultado a Resultados Acumulados.';
            }
        } else {
            try {
                const preview = closingProposal(accounts, { closingDate: endDate });
                for (const transaction of preview.proposedTransactions) {
                    for (const entry of transaction.entries) {
                        const key = String(entry.accountId);
                        if (!worksheetClosing.byAccount[key]) worksheetClosing.byAccount[key] = { debit: 0, credit: 0 };
                        worksheetClosing.byAccount[key].debit += Number(entry.debit) || 0;
                        worksheetClosing.byAccount[key].credit += Number(entry.credit) || 0;
                    }
                }
                worksheetClosing.available = true;
            } catch (error) {
                worksheetClosing.warning = error.message;
            }
        }
        if (legacyBalanceClosings > 0) {
            const historyWarning = report.metadata.warnings.find(warning => warning.type === 'legacyBalanceClosingsIgnored');
            worksheetClosing.warning = [worksheetClosing.warning, historyWarning?.message].filter(Boolean).join(' ');
        }
        return res.json({
            success: true,
            data: accounts,
            worksheetClosing,
            ...report,
            metadata: {
                ...report.metadata,
                companyId,
                gestion: year,
                hasClosingEntries,
                hasResultClosing,
                legacyBalanceClosingsIgnored: legacyBalanceClosings
            }
        });
    } catch (error) {
        console.error('Error in /financial-statements:', error);
        return res.status(500).json({ error: error.message });
    }
});

router.post('/closing-entries-proposal', async (req, res) => {
    const { companyId, gestion } = req.body;
    if (!companyId || !gestion) {
        return res.status(400).json({ error: 'companyId and gestion are required' });
    }

    try {
        const companies = await dbAll(
            'SELECT id, activity_type, operation_start_date FROM companies WHERE id = ?',
            [companyId]
        );
        if (!companies.length) return res.status(404).json({ error: 'Company not found' });
        const year = Number(gestion);
        if (!Number.isInteger(year) || year < 1900 || year > 2200) {
            return res.status(400).json({ error: 'gestion must be a valid fiscal year' });
        }

        const { startDate, endDate } = getFiscalYearDetails(
            companies[0].activity_type,
            year,
            companies[0].operation_start_date
        );
        const [accounts, closingRows] = await Promise.all([
            getPeriodAccountBalances(companyId, startDate, endDate),
            dbAll(`
                SELECT COUNT(*) AS closing_count
                FROM transactions
                WHERE company_id = ? AND date BETWEEN ? AND ?
                    AND UPPER(COALESCE(type, '')) = 'CIERRE'
            `, [companyId, startDate, endDate])
        ]);

        let proposal;
        try {
            proposal = closingProposal(accounts, {
                closingDate: endDate,
                hasClosingEntries: Number(closingRows[0]?.closing_count || 0) > 0
            });
        } catch (error) {
            return res.status(409).json({ error: error.message });
        }
        return res.json({
            data: {
                ...proposal,
                period: { startDate, endDate },
                notices: [
                    'La propuesta cierra cuentas de resultado y de orden; no lleva cuentas permanentes a cero.',
                    'El resultado es contable. El IUE requiere conciliación tributaria y no se estima aquí.',
                    'La reserva legal depende de la forma societaria, estatutos, pérdidas acumuladas y límites legales; no se estima aquí.'
                ]
            }
        });
    } catch (error) {
        console.error('Error generating closing entries proposal:', error);
        return res.status(500).json({ error: error.message });
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
                { pattern: /Inventari(o|os)|Mercader(i|í)a|Existenc(ia|ias)|Almacen(es)?/i, tags: ["NoMonetario", "ActivoCorriente"], source_nc: "NC3-Rubro-F" },
                { pattern: /Inventario|Mercadería/i, tags: ["NoMonetario", "ActivoCorriente"], source_nc: "NC3-Rubro-F" },
                { pattern: /Activo(s)? Fijo(s)?|Inmueble(s)?|Edific(i|í)o(s)?|Mueble(s)? y Enseres|Veh(i|í)culo(s)?|Maquinar(i|í)a|Equipo(s)? de Computac(i|ió)n|Herramienta(s)?/i, tags: ["NoMonetario", "Depreciable", "ActivoFijo"], source_nc: "NC3-Rubro-F" },
                { pattern: /Intangible(s)?|Cargos Diferidos|Software|Derecho(s)?/i, tags: ["NoMonetario", "Amortizable"], source_nc: "NC3-Rubro-F" },
                { pattern: /Patrimonio|Capital|Reserva(s)?|Ajuste (de|del) Capital/i, tags: ["NoMonetario", "Patrimonio"], source_nc: "NC3-Rubro-F" },
                { pattern: /Préstamos Bancarios M(oneda)? E(xtranjera)?/i, tags: ["NoMonetario", "Pasivo"], source_nc: "NC6" },
                { pattern: /Provisión(es)?|Indemnizac(i|ió)n(es)?/i, tags: ["NoMonetario", "PasivoNoCorriente"], source_nc: "NC6-Provisión" },
            ],
            semantic_concepts: {
                monetary: [
                    {
                        concept: "Liquidez",
                        keywords: ["caja", "banco", "efectivo", "disponibilidad"],
                        tags: ["Monetario", "Liquidez"]
                    },
                    {
                        concept: "Exigible",
                        keywords: ["cobrar", "cliente", "deudor", "prestamo"],
                        tags: ["Monetario", "Exigible"]
                    },
                    {
                        concept: "PasivoCorriente",
                        keywords: ["pagar", "proveedor", "acreedor", "impuesto", "fiscal"],
                        tags: ["Monetario", "Pasivo"]
                    },
                    {
                        concept: "Resultado",
                        keywords: ["ingreso", "gasto", "costo", "venta", "compra", "sueldo", "honorario"],
                        tags: ["Monetario", "Resultado"]
                    }
                ],
                non_monetary: [
                    {
                        concept: "Inventario",
                        keywords: ["inventario", "mercaderia", "almacen", "existencia", "stock"],
                        tags: ["NoMonetario", "ActivoCorriente"]
                    },
                    {
                        concept: "ActivoFijo",
                        keywords: ["edificio", "terreno", "mueble", "mobiliario", "vehiculo", "equipo", "maquinaria", "herramienta", "computacion"],
                        tags: ["NoMonetario", "Depreciable"]
                    },
                    {
                        concept: "Patrimonio",
                        keywords: ["capital", "reserva", "patrimonio", "resultado acumulado"],
                        tags: ["NoMonetario", "Patrimonio"]
                    }
                ]
            },
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

        const deepMergeWithDefaults = (base, override) => {
            if (override === null || override === undefined) return base;
            if (Array.isArray(base) && Array.isArray(override)) {
                if (override.length === 0 && base.length > 0) return base;
                return override;
            }
            if (typeof base !== 'object' || base === null) return override;
            if (typeof override !== 'object' || override === null) return override;

            const result = { ...base };
            for (const key of Object.keys(override)) {
                if (!(key in base)) {
                    result[key] = override[key];
                    continue;
                }
                result[key] = deepMergeWithDefaults(base[key], override[key]);
            }
            return result;
        };

        const params = deepMergeWithDefaults(defaultParams, adjParams || {});

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

        const normalizeText = (value = '') =>
            String(value)
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase();

        const keywordMatchesSearchable = (keyword, searchable, tokens) => {
            const kw = normalizeText(keyword);
            if (!kw) return false;
            if (kw.includes(' ')) {
                const phraseRegex = new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'i');
                return phraseRegex.test(searchable);
            }
            return tokens.has(kw) || Array.from(tokens).some(t =>
                (t.startsWith(kw) || kw.startsWith(t)) &&
                Math.min(t.length, kw.length) >= 4
            );
        };

        const hasMonetarySignal = (account, profile, includeResultado = true) => {
            const searchable = normalizeText(`${account?.code || ''} ${account?.name || ''}`);
            const tokens = new Set(searchable.split(/[^a-z0-9]+/).filter(Boolean));
            const monetaryConcepts = profile?.semantic_concepts?.monetary || [];
            return monetaryConcepts.some(concept => {
                const conceptName = normalizeText(concept?.concept || '');
                const conceptTags = (concept?.tags || []).map(tag => normalizeText(tag));
                const isResultadoConcept =
                    conceptName.includes('resultado') ||
                    conceptTags.some(tag => tag.includes('resultado'));
                if (!includeResultado && isResultadoConcept) {
                    return false;
                }
                return (concept.keywords || []).some(keyword => keywordMatchesSearchable(keyword, searchable, tokens));
            });
        };

        const isResultAccountForAitb = (account) => {
            const code = String(account?.code || '');
            const name = normalizeText(account?.name || '');
            const type = normalizeText(account?.type || '');
            const tokens = new Set(name.split(/[^a-z0-9]+/).filter(Boolean));

            if (/^[4-6]/.test(code)) return true;
            if (['ingreso', 'egreso', 'gasto', 'costo', 'resultado'].some(k => type.includes(k))) {
                return true;
            }

            const resultKeywords = [
                'ingreso', 'ingresos', 'egreso', 'egresos', 'gasto', 'gastos',
                'costo', 'costos', 'venta', 'ventas', 'compra', 'compras',
                'honorario', 'honorarios', 'sueldo', 'sueldos', 'salario', 'salarios',
                'resultado'
            ];
            return resultKeywords.some(keyword =>
                tokens.has(keyword) || Array.from(tokens).some(token => token.startsWith(keyword))
            );
        };

        const isNc3ExcludedFromAitb = (account) => {
            const name = normalizeText(account?.name || '');
            const exclusions = [
                'ajuste por inflacion',
                'diferencia de cambio',
                'mantenimiento de valor',
                'exposicion a la inflacion',
                'perdidas y ganancias'
            ];
            return exclusions.some(exc => name.includes(exc));
        };

        const ensureRegExp = (pattern) => {
            if (pattern instanceof RegExp) return pattern;
            if (pattern && typeof pattern === 'object' && pattern.source) {
                return new RegExp(pattern.source, pattern.flags || 'i');
            }
            if (typeof pattern === 'string') {
                const raw = pattern.trim();
                const jsMatch = raw.match(/^\/(.*)\/([a-zA-Z]*)$/);
                if (jsMatch) {
                    const body = jsMatch[1];
                    const flags = jsMatch[2] || 'i';
                    return new RegExp(body, flags);
                }
                if (raw.startsWith('/') && raw.endsWith('/') && raw.length > 2) {
                    return new RegExp(raw.slice(1, -1), 'i');
                }
                return new RegExp(raw, 'i');
            }
            return null;
        };

        // Nueva función de clasificación usando el esquema semántico V2 + Inteligencia Jerárquica
        const classifyAccountV2 = (accountCode, accountName, profile, depth = 0) => {
            const code = accountCode || '';
            const name = accountName || '';
            const combined = `${code} ${name}`.toLowerCase();

            // 1. Evitar recursión infinita
            if (depth > 5) return { type: 'unknown', tags: [] };

            const classifyBySemanticConcepts = () => {
                const concepts = profile.semantic_concepts || {};
                const monetary = concepts.monetary || [];
                const nonMonetary = concepts.non_monetary || [];
                const searchable = normalizeText(`${code} ${name}`);
                const tokens = new Set(searchable.split(/[^a-z0-9]+/).filter(Boolean));

                const scoreConceptList = (list) => {
                    let bestScore = 0;
                    let bestConcept = null;
                    for (const item of list) {
                        const keywords = item.keywords || [];
                        let score = 0;
                        const matches = [];
                        for (const keyword of keywords) {
                            const kw = normalizeText(keyword);
                            if (!kw) continue;
                            const matched = keywordMatchesSearchable(kw, searchable, tokens);

                            if (matched) {
                                matches.push(kw);
                                score += 1 + Math.min(kw.length, 12) / 20;
                            }
                        }
                        if (score > bestScore) {
                            bestScore = score;
                            bestConcept = { item, matches };
                        }
                    }
                    return { bestScore, bestConcept };
                };

                const m = scoreConceptList(monetary);
                const nm = scoreConceptList(nonMonetary);
                if (m.bestScore <= 0 && nm.bestScore <= 0) return null;
                if (Math.abs(m.bestScore - nm.bestScore) < 0.25) return null;

                if (m.bestScore > nm.bestScore) {
                    return {
                        type: 'monetary',
                        tags: m.bestConcept?.item?.tags || ['Monetario-Semantic'],
                        source_nc: 'SemanticConcepts',
                        matched_pattern: (m.bestConcept?.matches || []).join(','),
                        confidence: Math.min(0.92, 0.65 + m.bestScore * 0.08)
                    };
                }

                return {
                    type: 'non_monetary',
                    tags: nm.bestConcept?.item?.tags || ['NoMonetario-Semantic'],
                    source_nc: 'SemanticConcepts',
                    matched_pattern: (nm.bestConcept?.matches || []).join(','),
                    confidence: Math.min(0.92, 0.65 + nm.bestScore * 0.08)
                };
            };

            // 3. Evaluar reglas no monetarias PRIMERO
            for (const rule of profile.non_monetary_rules) {
                try {
                    const regex = ensureRegExp(rule.pattern);
                    if (!regex) continue;
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
                    if (!regex) continue;
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

            // 5. Clasificación por semantic_concepts del perfil (si no hubo match regex)
            const semanticClassification = classifyBySemanticConcepts();
            if (semanticClassification) {
                return semanticClassification;
            }

            // 6. INTELIGENCIA JERÁRQUICA: Si no hay match semántico directo, preguntar al padre
            const parentCode = AccountPlanIntelligence.getParent(code, planAnalysis);
            if (parentCode) {
                const parentAccount = planAnalysis.accountMap.get(parentCode);
                if (parentAccount) {
                    const parentClassification = classifyAccountV2(parentAccount.code, parentAccount.name, profile, depth + 1);
                    if (parentClassification.type !== 'unknown') {
                        const inheritedTags = (parentClassification.tags || [])
                            .filter(tag => !/depreciable/i.test(String(tag)));
                        return {
                            ...parentClassification,
                            tags: inheritedTags,
                            source_nc: `${parentClassification.source_nc} (Match vía Ancestro: ${parentAccount.name})`,
                            confidence: Math.max(0.7, parentClassification.confidence - 0.05)
                        };
                    }
                }
            }

            // 7. Evaluar reglas basadas en CÓDIGO (Fallback secundario antes del defecto)
            const allCodeRules = [
                ...(profile.code_fallback_rules || []),
            ];

            for (const rule of allCodeRules) {
                try {
                    const regex = ensureRegExp(rule.pattern);
                    if (!regex) continue;
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

            // 8. Clasificación por defecto básica (Último recurso)
            if (code.startsWith('1')) return { type: 'monetary', tags: ['Activo'], source_nc: 'PlanCuentas-PorDefecto' };
            if (code.startsWith('2')) return { type: 'monetary', tags: ['Pasivo'], source_nc: 'PlanCuentas-PorDefecto' };
            if (code.startsWith('3')) return { type: 'non_monetary', tags: ['Patrimonio'], source_nc: 'PlanCuentas-PorDefecto' };

            return { type: 'unknown', tags: ['Desconocido'], source_nc: 'PlanCuentas-PorDefecto' };
        };

        // Matching robusto para determinar si una cuenta es realmente depreciable
        const getDepreciationMatch = (account, profile, classification) => {
            const name = account?.name || '';
            const code = String(account?.code || '');
            const type = normalizeText(account?.type || '');
            const searchable = normalizeText(name);
            const tokens = new Set(searchable.split(/[^a-z0-9]+/).filter(Boolean));
            const depConfigs = profile?.depreciation_settings?.assets_life || [];

            const isContraAccount =
                /(depreciacion acumulada|amortizacion acumulada|agotamiento acumulado|deterioro acumulado|estimacion|provision)/i.test(searchable) ||
                /regul/.test(type);
            if (isContraAccount) {
                return { eligible: false, reason: 'contra_account', score: 0, config: null };
            }

            const isOfficeSupply =
                (searchable.includes('escritorio') || searchable.includes('papeleria') || searchable.includes('utiles')) &&
                ['material', 'suministro', 'insumo', 'consumible'].some(token => searchable.includes(token));

            let bestConfig = null;
            let bestScore = 0;
            const stopWords = new Set([
                'de', 'del', 'la', 'las', 'el', 'los', 'y', 'o', 'por', 'para', 'con',
                'en', 'a', 'al', 'un', 'una', 'unos', 'unas'
            ]);

            for (const config of depConfigs) {
                const assetKeyword = normalizeText(config.asset_type_keyword || '');
                let score = 0;

                if (assetKeyword && searchable === assetKeyword) {
                    score = 100;
                } else if (assetKeyword && searchable.includes(assetKeyword)) {
                    score = 50 + Math.min(assetKeyword.length, 40);
                } else {
                    const assetWords = new Set(
                        assetKeyword
                            .split(/[^a-z0-9]+/)
                            .filter(w => w.length >= 4 && !stopWords.has(w))
                    );
                    const commonWords = Array.from(assetWords).filter(w => tokens.has(w));
                    if (commonWords.length > 0) {
                        score = commonWords.reduce((acc, w) => acc + (w.length * 5), 0);
                    }
                }

                if (config.asset_type_regex) {
                    try {
                        const regex = ensureRegExp(config.asset_type_regex);
                        if (regex && regex.test(searchable)) {
                            score = Math.max(score, 90);
                        }
                    } catch (error) {
                        // Ignorar regex inválido y continuar con score por keywords.
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestConfig = config;
                }
            }

            const strongMatch = bestScore >= 15;
            const isFixedAssetCode = /^1[6-9]/.test(code);
            const likelyFixedAsset =
                isFixedAssetCode &&
                !/(intangible|diferido|amortiz|acumulad)/i.test(searchable) &&
                !isOfficeSupply &&
                !isContraAccount;
            const hasDepreciableTag = Boolean(
                (classification?.tags || []).some(tag => /depreciable/i.test(String(tag)))
            );

            const hasReliableSignal = strongMatch || likelyFixedAsset || hasDepreciableTag;
            if (!hasReliableSignal) {
                return { eligible: false, reason: 'no_reliable_signal', score: bestScore, config: null };
            }

            if (isOfficeSupply && !strongMatch) {
                return { eligible: false, reason: 'office_supply', score: bestScore, config: null };
            }

            if (!bestConfig || bestScore < 15) {
                const fallbackConfig = depConfigs.find(c =>
                    normalizeText(c.asset_type_keyword || '').includes('activos fijos')
                );
                if (!fallbackConfig) {
                    return { eligible: false, reason: 'no_fallback_config', score: bestScore, config: null };
                }
                bestConfig = fallbackConfig;
            }

            return {
                eligible: true,
                score: bestScore,
                config: bestConfig,
                likelyFixedAsset
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
        const diagnostics = {
            engine: 'reports.adjustment-entries-proposal',
            accountsAnalyzed: 0,
            aitbEligible: 0,
            depreciationEligible: 0,
            samples: []
        };

        const aitbAccount = findAITBAccount(accountsWithBalances, params.aitb_settings?.aitb_account_patterns || []);

        // 6. Generar Asientos de AITB (NC3) para rubros No Monetarios
        const aitbEntries = [];
        accountsWithBalance.forEach(acc => {
            const classification = classifyAccountV2(acc.code, acc.name, params);
            const depMatchForAitb = getDepreciationMatch(acc, params, classification);
            const isResultAccount = isResultAccountForAitb(acc);
            const isNc3Excluded = isNc3ExcludedFromAitb(acc);
            const hasStrongMonetarySignal = hasMonetarySignal(acc, params, false);
            const isNonMonetaryForAitb =
                !isNc3Excluded && (
                    classification.type === 'non_monetary' ||
                    depMatchForAitb.likelyFixedAsset === true ||
                    isResultAccount
                );
            diagnostics.accountsAnalyzed += 1;
            if (isNonMonetaryForAitb && !hasStrongMonetarySignal) {
                diagnostics.aitbEligible += 1;
            }
            if (diagnostics.samples.length < 80) {
                diagnostics.samples.push({
                    code: acc.code,
                    name: acc.name,
                    classification: classification.type,
                    tags: classification.tags || [],
                    aitbEligible: isNonMonetaryForAitb && !hasStrongMonetarySignal,
                    hasMonetarySignal: hasStrongMonetarySignal,
                    resultAccount: isResultAccount,
                    nc3Excluded: isNc3Excluded,
                    depCandidate: depMatchForAitb.eligible,
                    depReason: depMatchForAitb.reason || null,
                    depScore: depMatchForAitb.score || 0
                });
            }
            if (isNonMonetaryForAitb && !hasStrongMonetarySignal) {
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
        const fixedAssets = accountsWithBalance
            .map(acc => {
                const classification = classifyAccountV2(acc.code, acc.name, params);
                const depMatch = getDepreciationMatch(acc, params, classification);
                if (!depMatch.eligible) return null;
                return {
                    ...acc,
                    _classification: classification,
                    _depMatch: depMatch
                };
            })
            .filter(Boolean);
        diagnostics.depreciationEligible = fixedAssets.length;

        console.log(`Activos Fijos detectados: ${fixedAssets.length}`);

        if (fixedAssets.length > 0) {
            const depExpenseAccount = findAccountByPatterns(accountsWithBalances, params.depreciation_settings?.dep_expense_patterns || []);
            const depAccumAccount = findAccountByPatterns(accountsWithBalances, params.depreciation_settings?.dep_accum_patterns || []);

            fixedAssets.forEach(asset => {
                const depreciationConfig = asset._depMatch.config;
                const historicalBalance = asset.balance !== undefined ? asset.balance : (asset.total_debit - asset.total_credit);

                // Aplicar AITB al valor del activo para base de depreciación (NC3)
                const hasStrongMonetarySignal = hasMonetarySignal(asset, params);
                const aitbAdjustment = (asset._classification?.type === 'non_monetary' && !hasStrongMonetarySignal) ?
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
                diagnostics,
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
