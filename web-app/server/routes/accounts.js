const express = require('express');
const router = express.Router();
const db = require('../db');

// Migration: Add acquisition_date column for fixed assets
db.run(`ALTER TABLE accounts ADD COLUMN acquisition_date TEXT`, (err) => {
    // Ignore error if column already exists
});

// Get all accounts for a company
router.get('/', (req, res) => {
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    const sql = `SELECT * FROM accounts WHERE company_id = ? ORDER BY code`;
    db.all(sql, [companyId], (err, rows) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({ data: rows });
    });
});

// PATCH update acquisition dates for multiple accounts (for depreciation calculation)
router.patch('/acquisition-dates', (req, res) => {
    const { acquisitions } = req.body; // Array of { accountCode, companyId, acquisitionDate }

    if (!acquisitions || !Array.isArray(acquisitions)) {
        return res.status(400).json({ error: 'acquisitions array is required' });
    }

    const sql = `UPDATE accounts SET acquisition_date = ? WHERE code = ? AND company_id = ?`;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        let errors = 0;

        const stmt = db.prepare(sql);
        acquisitions.forEach(acq => {
            stmt.run([acq.acquisitionDate, acq.accountCode, acq.companyId], (err) => {
                if (err) errors++;
            });
        });

        stmt.finalize((err) => {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Failed to update acquisition dates' });
            }
            db.run('COMMIT', (err) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Transaction commit failed' });
                }
                res.json({ success: true, message: `Updated ${acquisitions.length - errors} acquisition dates` });
            });
        });
    });
});

// Create account - LIBSQL PROMISES VERSION
router.post('/', async (req, res) => {
    const { code, name, type, level, parent_code, companyId } = req.body;

    if (!code || !name || !type || !level || !companyId) {
        console.error('❌ [API] Missing required fields for account creation:', { body: req.body });
        res.status(400).json({ error: 'Missing required fields', received: req.body });
    }

    const sql = 'INSERT INTO accounts (company_id, code, name, type, level, parent_code) VALUES (?, ?, ?, ?, ?, ?)';

    try {
        const result = await db.run(sql, [companyId, code, name, type, level, parent_code || null]);
        res.json({
            message: 'Account created',
            id: result.lastID,
            data: { ...req.body, company_id: companyId }
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST bulk create accounts (High Performance Ingestion)
router.post('/bulk', (req, res) => {
    const { accounts, companyId } = req.body;

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0 || !companyId) {
        return res.status(400).json({ error: 'Invalid request format or empty data' });
    }

    const sql = 'INSERT INTO accounts (company_id, code, name, type, level, parent_code) VALUES (?, ?, ?, ?, ?, ?)';

    db.serialize(() => {
        // 1. Iniciar Transacción (Atomicidad y Velocidad)
        db.run('BEGIN TRANSACTION');

        const stmt = db.prepare(sql);
        let errors = 0;

        accounts.forEach(acc => {
            // Validación mínima antes de insertar
            if (acc.code && acc.name && acc.type && acc.level) {
                stmt.run([companyId, acc.code, acc.name, acc.type, acc.level, acc.parent_code || null], (err) => {
                    if (err) errors++;
                });
            } else {
                errors++;
            }
        });

        stmt.finalize((err) => {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Failed to finalize bulk insert' });
            }
            // 2. Commit masivo (Un solo viaje al disco)
            db.run('COMMIT', (err) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Transaction commit failed' });
                }
                res.json({
                    message: `Bulk import completed. Processed ${accounts.length} accounts.`,
                    successCount: accounts.length - errors,
                    errorCount: errors
                });
            });
        });
    });
});

// Update account
router.put('/:id', (req, res) => {
    const { code, name, type, level, parent_code, companyId } = req.body;
    const { id } = req.params;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    const sql = 'UPDATE accounts SET company_id = ?, code = ?, name = ?, type = ?, level = ?, parent_code = ? WHERE id = ?';

    db.run(sql, [companyId, code, name, type, level, parent_code || null, id], function (err) {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({ message: 'Account updated', changes: this.changes });
    });
});

// Delete account
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    // Check if it's a "delete all" request
    if (id === 'all') {
        const sql = 'DELETE FROM accounts WHERE company_id = ?';
        db.run(sql, [companyId], function (err) {
            if (err) {
                res.status(400).json({ error: err.message });
                return;
            }
            res.json({ message: 'All accounts deleted for company', changes: this.changes });
        });
        return;
    }

    const sql = 'DELETE FROM accounts WHERE id = ? AND company_id = ?';

    db.run(sql, [id, companyId], function (err) {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        res.json({ message: 'Account deleted', changes: this.changes });
    });
});

// Batch update parent codes (Data Healing)
router.patch('/batch-parents', (req, res) => {
    const { updates, companyId } = req.body; // updates: [{ id, parent_code }]

    if (!updates || !Array.isArray(updates) || !companyId) {
        return res.status(400).json({ error: 'Invalid request format' });
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        const stmt = db.prepare('UPDATE accounts SET parent_code = ? WHERE id = ? AND company_id = ?');
        let hasErrors = false;

        updates.forEach(u => {
            stmt.run([u.parent_code, u.id, companyId], (err) => {
                if (err) hasErrors = true;
            });
        });

        stmt.finalize((err) => {
            if (err || hasErrors) {
                db.run('ROLLBACK', () => res.status(500).json({ error: 'Errors occurred during batch update' }));
            } else {
                db.run('COMMIT', () => res.json({ message: `Successfully updated ${updates.length} accounts` }));
            }
        });
    });
});

module.exports = router;
