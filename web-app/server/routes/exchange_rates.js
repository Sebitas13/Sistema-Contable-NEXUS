const express = require('express');
const router = express.Router();
const db = require('../db');

// Migration helper - Robust Multi-Tenancy Strategy
const createTable = () => {
    db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='exchange_rates'", (err, row) => {
        if (err) return;

        if (!row) {
            // Table doesn't exist, create it with correct schema
            db.run(`
                CREATE TABLE IF NOT EXISTS exchange_rates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    currency TEXT NOT NULL,
                    buy_rate REAL NOT NULL,
                    sell_rate REAL NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
                    UNIQUE(company_id, date, currency)
                )
            `, (err) => {
                if (err) console.error("Error creating exchange_rates table:", err.message);
            });
            return;
        }

        const schema = row.sql;
        // Check if missing 'UNIQUE(company_id, date, currency)' OR has old UNIQUE(date, currency)
        if (!schema.includes('UNIQUE(company_id, date, currency)') || schema.includes('UNIQUE(date, currency)')) {
            console.log("⚠️ DETECTED OLD EXCHANGE_RATES SCHEMA. Migrating to Company-Isolated Schema...");

            db.serialize(() => {
                db.run("BEGIN TRANSACTION");

                // 1. Clear any leftover temp table
                db.run("DROP TABLE IF EXISTS exchange_rates_old");

                // 2. Rename existing table away
                db.run("ALTER TABLE exchange_rates RENAME TO exchange_rates_old", (err) => {
                    if (err) {
                        console.error("Failed to rename old exchange_rates table:", err.message);
                    }
                });

                // 3. Create the new table with correct schema
                db.run(`
                    CREATE TABLE exchange_rates (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        company_id INTEGER NOT NULL,
                        date TEXT NOT NULL,
                        currency TEXT NOT NULL,
                        buy_rate REAL NOT NULL,
                        sell_rate REAL NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
                        UNIQUE(company_id, date, currency)
                    )
                `);

                // 4. Copy data, mapping old schema to new multi-tenancy schema
                db.run(`
                    INSERT INTO exchange_rates (id, company_id, date, currency, buy_rate, sell_rate, created_at)
                    SELECT id, 
                           (SELECT id FROM companies ORDER BY id ASC LIMIT 1),
                           date,
                           'USD',
                           usd_buy,
                           usd_sell,
                           created_at
                    FROM exchange_rates_old
                `, (err) => {
                    if (err) console.error("Data migration copy failed for exchange_rates:", err.message);
                });

                // 5. Cleanup
                db.run("DROP TABLE exchange_rates_old");

                db.run("COMMIT", (err) => {
                    if (err) {
                        console.error("Exchange rates migration COMMIT failed:", err.message);
                        db.run("ROLLBACK");
                    } else {
                        console.log("✅ Exchange Rates Table Migration Successful (Multi-tenancy enabled)");
                    }
                });
            });
        } else {
            console.log("✅ Exchange rates table verified with correct multi-tenancy schema.");
        }
    });
};
createTable();

// GET all rates for a company
router.get('/', (req, res) => {
    const { companyId, startDate, endDate, currency } = req.query;
    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    let sql = 'SELECT * FROM exchange_rates WHERE company_id = ?';
    const params = [companyId];

    if (startDate && endDate) {
        sql += ' AND date BETWEEN ? AND ?';
        params.push(startDate, endDate);
    } else if (startDate) {
        sql += ' AND date >= ?';
        params.push(startDate);
    }

    if (currency) {
        sql += ' AND currency = ?';
        params.push(currency);
    }

    sql += ' ORDER BY date ASC';

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Database Error in GET /exchange-rates:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json({ data: rows });
    });
});

// POST a new rate (Upsert) - LIBSQL PROMISES VERSION
router.post('/', async (req, res) => {
    const { companyId, date, currency, buy_rate, sell_rate } = req.body;

    if (!companyId || !date || !currency) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // If both rates are null or empty, treat as a deletion request
        if (buy_rate === null && sell_rate === null) {
            const deleteSql = 'DELETE FROM exchange_rates WHERE company_id = ? AND date = ? AND currency = ?';
            await db.run(deleteSql, [companyId, date, currency]);
            return res.json({ message: 'Exchange rate cleared (deleted)' });
        }

        // Standard Upsert
        const sql = 'INSERT OR REPLACE INTO exchange_rates (company_id, date, currency, buy_rate, sell_rate) VALUES (?, ?, ?, ?, ?)';
        await db.run(sql, [companyId, date, currency, buy_rate || 0, sell_rate || 0]);
        res.json({ message: 'Exchange rate saved successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST bulk import - LIBSQL PROMISES VERSION
router.post('/bulk', async (req, res) => {
    const { companyId, data } = req.body;
    if (!companyId || !data || !Array.isArray(data)) {
        return res.status(400).json({ error: 'Invalid data format' });
    }

    const validRates = [];
    const invalidRates = [];

    data.forEach((item, index) => {
        const { date, currency, buy_rate, sell_rate } = item;
        const rowNum = index + 1;

        if (!date || !currency || buy_rate === undefined || sell_rate === undefined) {
            invalidRates.push({ row: rowNum, item, reason: 'Campos requeridos faltantes.' });
            return;
        }

        const buy = parseFloat(buy_rate);
        const sell = parseFloat(sell_rate);
        if (isNaN(buy) || isNaN(sell)) {
            invalidRates.push({ row: rowNum, item, reason: `Valores numéricos inválidos.` });
            return;
        }

        validRates.push({ date, currency, buy_rate: buy, sell_rate: sell });
    });

    if (validRates.length === 0) {
        return res.json({
            message: 'No se encontraron registros válidos.',
            successCount: 0,
            errorCount: invalidRates.length,
            errors: invalidRates
        });
    }

    try {
        // Start transaction
        await db.run('BEGIN TRANSACTION');

        const sql = 'INSERT OR REPLACE INTO exchange_rates (company_id, date, currency, buy_rate, sell_rate) VALUES (?, ?, ?, ?, ?)';
        
        // Process all rates sequentially
        for (const item of validRates) {
            await db.run(sql, [companyId, item.date, item.currency, item.buy_rate, item.sell_rate]);
        }

        // Commit transaction
        await db.run('COMMIT');
        res.json({
            message: `Importación completada: ${validRates.length} éxitos.`,
            successCount: validRates.length,
            errorCount: invalidRates.length,
            errors: invalidRates
        });
        
    } catch (error) {
        // Rollback on any error
        try {
            await db.run('ROLLBACK');
        } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError.message);
        }
        
        console.error('Error in bulk exchange rates import:', error.message);
        res.status(500).json({ error: 'Failed to execute bulk import' });
    }
});

// DELETE all exchange rates for a specific year - LIBSQL PROMISES VERSION
router.delete('/year/:year', async (req, res) => {
    const { year } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    try {
        const sql = 'DELETE FROM exchange_rates WHERE strftime("%Y", date) = ? AND company_id = ?';
        const result = await db.run(sql, [year, companyId]);
        res.json({
            message: `All exchange rate records for year ${year} deleted for company ${companyId}`,
            deletedCount: result.changes
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE a rate by ID - LIBSQL PROMISES VERSION
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const { companyId } = req.query;

    if (!companyId) return res.status(400).json({ error: 'companyId is required' });

    try {
        const sql = 'DELETE FROM exchange_rates WHERE id = ? AND company_id = ?';
        const result = await db.run(sql, [id, companyId]);
        if (result.changes === 0) return res.status(404).json({ error: 'Rate not found or access denied' });
        res.json({ message: 'Exchange rate deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
