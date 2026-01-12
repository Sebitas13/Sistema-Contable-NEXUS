const express = require('express');
const router = express.Router();
const db = require('../db');

// Migration helper to create the table if it doesn't exist or fix schema
const createUfvTable = () => {
    db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='ufv_rates'", (err, row) => {
        if (err) return;

        if (!row) {
            // Table doesn't exist, create it with correct schema
            db.run(`
                CREATE TABLE IF NOT EXISTS ufv_rates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    value REAL NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
                    UNIQUE(company_id, date)
                )
            `, (err) => {
                if (err) console.error("Error creating ufv_rates table:", err.message);
            });
            return;
        }

        const schema = row.sql;
        // Check if there's any UNIQUE on 'date' alone OR missing 'UNIQUE(company_id, date)'
        if (schema.includes('date TEXT UNIQUE') || !schema.includes('UNIQUE(company_id, date)')) {
            console.log("⚠️ DETECTED OLD UFV SCHEMA (Global Unique Date). Migrating to Company-Isolated Schema...");

            db.serialize(() => {
                db.run("BEGIN TRANSACTION");

                // 1. Clear any leftover temp table
                db.run("DROP TABLE IF EXISTS ufv_rates_old");

                // 2. Rename existing table away from the target name
                db.run("ALTER TABLE ufv_rates RENAME TO ufv_rates_old", (err) => {
                    if (err) {
                        console.error("Failed to rename old table - it might be locked:", err.message);
                        // We continue or wait? Better to rollback if locked.
                    }
                });

                // 3. Create the new table with correct schema
                db.run(`
                    CREATE TABLE ufv_rates (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        company_id INTEGER NOT NULL,
                        date TEXT NOT NULL,
                        value REAL NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
                        UNIQUE(company_id, date)
                    )
                `);

                // 4. Copy data, assigning a default company_id
                db.run(`
                    INSERT INTO ufv_rates (id, company_id, date, value, created_at)
                    SELECT id, 
                           (SELECT id FROM companies ORDER BY id ASC LIMIT 1), 
                           date, 
                           value, 
                           created_at
                    FROM ufv_rates_old
                `, (err) => {
                    if (err) {
                        console.error("Data migration copy failed:", err.message);
                    }
                });

                // 5. Cleanup
                db.run("DROP TABLE ufv_rates_old");

                db.run("COMMIT", (err) => {
                    if (err) {
                        console.error("Migration COMMIT failed:", err.message);
                        db.run("ROLLBACK");
                    } else {
                        console.log("✅ UFV Table Migration Successful (Multi-tenancy enabled)");
                    }
                });
            });
        }
    });
};
createUfvTable();

// Get all UFV records
router.get('/', (req, res) => {
    const { year, companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    let sql = 'SELECT * FROM ufv_rates WHERE company_id = ?';
    const params = [companyId];

    if (year) {
        sql += ' AND strftime(\'%Y\', date) = ?';
        params.push(String(year));
    }

    sql += ' ORDER BY date ASC';
    db.all(sql, params, (err, rows) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({ data: rows });
    });
});

// V8.0 AoT: Batch UFV lookup for trajectory calculation
router.post('/batch', (req, res) => {
    const { dates, companyId } = req.body;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    if (!dates || !Array.isArray(dates) || dates.length === 0) {
        return res.status(400).json({ error: 'dates array is required' });
    }

    // Build SQL query with placeholders for all dates
    const placeholders = dates.map(() => '?').join(',');
    const sql = `
        SELECT date, value 
        FROM ufv_rates 
        WHERE company_id = ? AND date IN (${placeholders})
        ORDER BY date ASC
    `;

    const params = [companyId, ...dates];

    db.all(sql, params, (err, rows) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        // Convert to cache object {date: value}
        const ufvCache = {};
        (rows || []).forEach(row => {
            ufvCache[row.date] = parseFloat(row.value);
        });

        // For dates not found, try to find closest previous date
        const missingDates = dates.filter(d => !ufvCache[d]);

        if (missingDates.length > 0) {
            // Get all UFV data for the year range to find closest
            const years = [...new Set(missingDates.map(d => d.substring(0, 4)))];
            const yearPlaceholders = years.map(() => "strftime('%Y', date) = ?").join(' OR ');

            const fallbackSql = `
                SELECT date, value 
                FROM ufv_rates 
                WHERE company_id = ? AND (${yearPlaceholders})
                ORDER BY date ASC
            `;

            db.all(fallbackSql, [companyId, ...years], (fallbackErr, fallbackRows) => {
                if (!fallbackErr && fallbackRows) {
                    const allUfvs = fallbackRows.map(r => ({ date: r.date, value: parseFloat(r.value) }));

                    missingDates.forEach(targetDate => {
                        const previousDates = allUfvs.filter(u => u.date <= targetDate);
                        if (previousDates.length > 0) {
                            const closest = previousDates[previousDates.length - 1];
                            ufvCache[targetDate] = closest.value;
                        }
                    });
                }

                res.json({
                    data: ufvCache,
                    found: Object.keys(ufvCache).length,
                    requested: dates.length
                });
            });
        } else {
            res.json({
                data: ufvCache,
                found: Object.keys(ufvCache).length,
                requested: dates.length
            });
        }
    });
});

// Add UFV record - LIBSQL PROMISES VERSION
router.post('/', async (req, res) => {
    const { date, value, companyId } = req.body;

    if (!date || value === undefined || !companyId) {
        return res.status(400).json({ error: 'date, value, and companyId are required' });
    }

    try {
        const sql = 'INSERT OR REPLACE INTO ufv_rates (company_id, date, value) VALUES (?, ?, ?)';
        const result = await db.run(sql, [companyId, date, value]);
        res.json({ message: 'UFV added/updated', id: result.lastID });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Bulk import UFV records - LIBSQL PROMISES VERSION
router.post('/bulk', async (req, res) => {
    const { data, companyId } = req.body;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    if (!data || !Array.isArray(data)) {
        return res.status(400).json({ error: 'Invalid data format' });
    }

    const validUfvs = [];
    const invalidUfvs = [];

    // 1. Batch Validation
    data.forEach((item, index) => {
        const { date, value } = item;
        const rowNum = index + 1;
        if (!date || value === undefined) {
            invalidUfvs.push({ row: rowNum, item, reason: 'Campos requeridos faltantes (date, value).' });
            return;
        }
        if (isNaN(new Date(date))) {
            invalidUfvs.push({ row: rowNum, item, reason: `Formato de fecha inválido: '${date}'.` });
            return;
        }
        const val = parseFloat(value);
        if (isNaN(val) || val < 0) {
            invalidUfvs.push({ row: rowNum, item, reason: `Valor de UFV inválido o negativo.` });
            return;
        }
        validUfvs.push({ date: date, value: val });
    });

    if (validUfvs.length === 0) {
        return res.json({
            message: 'No se encontraron registros UFV válidos para importar.',
            successCount: 0,
            errorCount: invalidUfvs.length,
            errors: invalidUfvs
        });
    }

    console.log(`Starting UFV Bulk Import for company ${companyId}. Records to process: ${validUfvs.length}`);

    // 2. High-Performance Bulk Insert - LIBSQL PROMISES VERSION
    const sql = 'INSERT OR REPLACE INTO ufv_rates (company_id, date, value) VALUES (?, ?, ?)';

    try {
        // Start transaction
        await db.run('BEGIN TRANSACTION');
        
        let errorOccurred = null;
        let completed = 0;
        const total = validUfvs.length;

        // Process all records sequentially
        for (const item of validUfvs) {
            try {
                await db.run(sql, [companyId, item.date, item.value]);
                completed++;
            } catch (runErr) {
                errorOccurred = runErr;
                console.error(`Error inserting UFV record for ${item.date}:`, runErr.message);
                break; // Stop on first error
            }
        }

        // Commit or rollback based on results
        if (errorOccurred) {
            console.error("Transaction failed during inserts. Rolling back.");
            await db.run('ROLLBACK');
            res.status(400).json({
                error: "Transaction failed: " + errorOccurred.message,
                successCount: completed,
                errorCount: invalidUfvs.length + 1,
                errors: [...invalidUfvs, { reason: errorOccurred.message }]
            });
        } else {
            await db.run('COMMIT');
            console.log(`✅ UFV Bulk Import Successful: ${total} records imported for company ${companyId}`);
            res.json({
                message: `Importación procesada con éxito. ${total} registros válidos, ${invalidUfvs.length} errores de validación.`,
                successCount: total,
                errorCount: invalidUfvs.length,
                errors: invalidUfvs
            });
        }
    } catch (transactionErr) {
        console.error("Critical transaction error:", transactionErr.message);
        try {
            await db.run('ROLLBACK');
        } catch (rollbackErr) {
            console.warn("Rollback attempt failed:", rollbackErr.message);
        }
        res.status(500).json({ 
            error: "Database transaction error: " + transactionErr.message,
            successCount: 0,
            errorCount: invalidUfvs.length,
            errors: invalidUfvs
        });
    }
});

// DELETE all UFV records for a specific year - LIBSQL PROMISES VERSION
router.delete('/year/:year', async (req, res) => {
    const { year } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    try {
        // Secure delete using LIKE for date pattern (year-%) AND strict company_id
        const sql = 'DELETE FROM ufv_rates WHERE date LIKE ? AND company_id = ?';
        const yearPattern = `${year}-%`;
        
        const result = await db.run(sql, [yearPattern, companyId]);
        res.json({
            message: `All UFV records for year ${year} deleted for company ${companyId}`,
            deletedCount: result.changes
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE single UFV record - LIBSQL PROMISES VERSION
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const { companyId } = req.query; // Optional but recommended

    let sql = 'DELETE FROM ufv_rates WHERE id = ?';
    let params = [id];

    if (companyId) {
        sql += ' AND company_id = ?';
        params.push(companyId);
    }

    try {
        const result = await db.run(sql, params);
        if (result.changes === 0) {
            res.status(404).json({ error: 'UFV record not found' });
            return;
        }
        res.json({ message: 'UFV record deleted' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
