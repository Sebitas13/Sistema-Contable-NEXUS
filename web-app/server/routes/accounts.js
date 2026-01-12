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

// PATCH update acquisition dates for multiple accounts - LIBSQL PROMISES VERSION
router.patch('/acquisition-dates', async (req, res) => {
    const { acquisitions } = req.body; // Array of { accountCode, companyId, acquisitionDate }

    if (!acquisitions || !Array.isArray(acquisitions)) {
        return res.status(400).json({ error: 'acquisitions array is required' });
    }

    const sql = `UPDATE accounts SET acquisition_date = ? WHERE code = ? AND company_id = ?`;

    try {
        // Start transaction
        await db.run('BEGIN TRANSACTION');
        
        let errors = 0;

        // Process all acquisitions sequentially
        for (const acq of acquisitions) {
            try {
                await db.run(sql, [acq.acquisitionDate, acq.accountCode, acq.companyId]);
            } catch (err) {
                errors++;
                console.error(`Error updating acquisition date for account ${acq.accountCode}:`, err.message);
            }
        }

        // Commit transaction
        await db.run('COMMIT');
        res.json({ 
            success: true, 
            message: `Updated ${acquisitions.length - errors} acquisition dates`,
            successCount: acquisitions.length - errors,
            errorCount: errors
        });
        
    } catch (error) {
        // Rollback on any error
        try {
            await db.run('ROLLBACK');
        } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError.message);
        }
        
        console.error('Error updating acquisition dates:', error.message);
        res.status(500).json({ error: 'Failed to update acquisition dates' });
    }
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

// POST bulk create accounts - LIBSQL PROMISES VERSION
router.post('/bulk', async (req, res) => {
    const { accounts, companyId } = req.body;

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0 || !companyId) {
        return res.status(400).json({ error: 'Invalid request format or empty data' });
    }

    const sql = 'INSERT INTO accounts (company_id, code, name, type, level, parent_code) VALUES (?, ?, ?, ?, ?, ?)';

    try {
        // Start transaction
        await db.run('BEGIN TRANSACTION');

        let errors = 0;
        let successCount = 0;

        // Process all accounts sequentially
        for (const acc of accounts) {
            // Validación mínima antes de insertar
            if (!acc.code || !acc.name || !acc.type || !acc.level) {
                errors++;
                continue;
            }

            try {
                await db.run(sql, [companyId, acc.code, acc.name, acc.type, acc.level, acc.parent_code || null]);
                successCount++;
            } catch (err) {
                errors++;
                console.error(`Error inserting account ${acc.code}:`, err.message);
            }
        }

        // Commit transaction
        await db.run('COMMIT');
        res.json({
            message: `Bulk import completed. Processed ${accounts.length} accounts.`,
            successCount: successCount,
            errorCount: errors
        });
        
    } catch (error) {
        // Rollback on any error
        try {
            await db.run('ROLLBACK');
        } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError.message);
        }
        
        console.error('Error in bulk account creation:', error.message);
        res.status(500).json({ error: 'Failed to execute bulk insert' });
    }
});

// Update account - LIBSQL PROMISES VERSION
router.put('/:id', async (req, res) => {
    const { code, name, type, level, parent_code, companyId } = req.body;
    const { id } = req.params;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    const sql = 'UPDATE accounts SET company_id = ?, code = ?, name = ?, type = ?, level = ?, parent_code = ? WHERE id = ?';

    try {
        const result = await db.run(sql, [companyId, code, name, type, level, parent_code || null, id]);
        res.json({ message: 'Account updated', changes: result.changes });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Delete account - LIBSQL PROMISES VERSION
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    try {
        // Check if it's a "delete all" request
        if (id === 'all') {
            const sql = 'DELETE FROM accounts WHERE company_id = ?';
            const result = await db.run(sql, [companyId]);
            res.json({ message: 'All accounts deleted for company', changes: result.changes });
            return;
        }

        const sql = 'DELETE FROM accounts WHERE id = ? AND company_id = ?';
        const result = await db.run(sql, [id, companyId]);
        res.json({ message: 'Account deleted', changes: result.changes });
        
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Batch update parent codes - LIBSQL PROMISES VERSION
router.patch('/batch-parents', async (req, res) => {
    const { updates, companyId } = req.body; // updates: [{ id, parent_code }]

    if (!updates || !Array.isArray(updates) || !companyId) {
        return res.status(400).json({ error: 'Invalid request format' });
    }

    const sql = 'UPDATE accounts SET parent_code = ? WHERE id = ? AND company_id = ?';

    try {
        // Start transaction
        await db.run('BEGIN TRANSACTION');

        let hasErrors = false;
        let successCount = 0;

        // Process all updates sequentially
        for (const u of updates) {
            try {
                await db.run(sql, [u.parent_code, u.id, companyId]);
                successCount++;
            } catch (err) {
                hasErrors = true;
                console.error(`Error updating parent code for account ${u.id}:`, err.message);
            }
        }

        // Commit or rollback based on results
        if (hasErrors) {
            await db.run('ROLLBACK');
            res.status(500).json({ error: 'Errors occurred during batch update' });
        } else {
            await db.run('COMMIT');
            res.json({ message: `Successfully updated ${successCount} accounts` });
        }
        
    } catch (error) {
        // Rollback on any error
        try {
            await db.run('ROLLBACK');
        } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError.message);
        }
        
        console.error('Error in batch parent update:', error.message);
        res.status(500).json({ error: 'Failed to execute batch update' });
    }
});

module.exports = router;
