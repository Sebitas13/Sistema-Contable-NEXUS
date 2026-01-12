const express = require('express');
const router = express.Router();
const db = require('../db');

// Migration helper: Ensure new columns exist for Societal and Activity types and Current Year
const ensureColumns = () => {
    db.serialize(() => {
        const columns = ['code_mask', 'plan_structure', 'societal_type', 'activity_type', 'operation_start_date', 'current_year'];
        columns.forEach(col => {
            db.run(`ALTER TABLE companies ADD COLUMN ${col} TEXT`, (err) => {
                // Ignore error if column already exists
            });
        });
        // Backfill legacy data with defaults (Migración para empresas antiguas)
        db.run("UPDATE companies SET societal_type = 'Unipersonal' WHERE societal_type IS NULL");
        db.run("UPDATE companies SET activity_type = 'Comercial' WHERE activity_type IS NULL");
        // Default current_year to system year if null
        const currentYear = new Date().getFullYear();
        db.run(`UPDATE companies SET current_year = '${currentYear}' WHERE current_year IS NULL`);
    });
};
ensureColumns();

// GET all companies
router.get('/', (req, res) => {
    const sql = `
        SELECT 
            c.*,
            COUNT(DISTINCT t.id) as transaction_count,
            COUNT(DISTINCT a.id) as account_count,
            MAX(t.date) as last_activity
        FROM companies c
        LEFT JOIN transactions t ON t.company_id = c.id
        LEFT JOIN accounts a ON a.company_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
    `;

    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching companies:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, data: rows });
    });
});

// GET single company by ID
router.get('/:id', (req, res) => {
    const { id } = req.params;

    const sql = `
        SELECT 
            c.*,
            COUNT(DISTINCT t.id) as transaction_count,
            COUNT(DISTINCT a.id) as account_count,
            COUNT(DISTINCT i.id) as inventory_count,
            MAX(t.date) as last_activity
        FROM companies c
        LEFT JOIN transactions t ON t.company_id = c.id
        LEFT JOIN accounts a ON a.company_id = c.id
        LEFT JOIN inventory_items i ON i.company_id = c.id
        WHERE c.id = ?
        GROUP BY c.id
    `;

    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error('Error fetching company:', err);
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Company not found' });
        }
        res.json({ success: true, data: row });
    });
});

// POST create new company
router.post('/', (req, res) => {
    const {
        name,
        nit,
        legal_name,
        address,
        city,
        country,
        phone,
        email,
        website,
        logo_url,
        fiscal_year_start,
        currency,
        code_mask,
        plan_structure,
        societal_type,
        activity_type,
        operation_start_date,
        current_year
    } = req.body;

    // Validation
    if (!name) {
        return res.status(400).json({ error: 'Company name is required' });
    }

    const sql = `
        INSERT INTO companies (
            name, nit, legal_name, address, city, country,
            phone, email, website, logo_url, fiscal_year_start, currency,
            code_mask, plan_structure, societal_type, activity_type, operation_start_date, current_year
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
        name || null,
        nit || null,
        legal_name || name || null, // Fallback to name if legal_name is empty
        address || null,
        city || null,
        country || 'Bolivia',
        phone || null,
        email || null,
        website || null,
        logo_url || null,
        fiscal_year_start || '01-01',
        currency || 'BOB',
        code_mask || null,
        plan_structure || null,
        societal_type || 'Unipersonal',
        activity_type || 'Comercial',
        operation_start_date && operation_start_date !== '' ? operation_start_date : null,
        current_year || new Date().getFullYear()
    ];

    db.run(sql, params, function (err) {
        if (err) {
            console.error('Error creating company:', err);
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'A company with this NIT already exists' });
            }
            return res.status(500).json({ error: err.message });
        }

        // Return the created company
        db.get('SELECT * FROM companies WHERE id = ?', [this.lastID], (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.status(201).json({ success: true, data: row, id: this.lastID });
        });
    });
});

// PUT update company
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const {
        name,
        nit,
        legal_name,
        address,
        city,
        country,
        phone,
        email,
        website,
        logo_url,
        fiscal_year_start,
        currency,
        code_mask,
        plan_structure,
        societal_type,
        activity_type,
        operation_start_date,
        current_year
    } = req.body;

    const sql = `
        UPDATE companies SET
            name = COALESCE(?, name),
            nit = COALESCE(?, nit),
            legal_name = COALESCE(?, legal_name),
            address = COALESCE(?, address),
            city = COALESCE(?, city),
            country = COALESCE(?, country),
            phone = COALESCE(?, phone),
            email = COALESCE(?, email),
            website = COALESCE(?, website),
            logo_url = COALESCE(?, logo_url),
            fiscal_year_start = COALESCE(?, fiscal_year_start),
            currency = COALESCE(?, currency),
            code_mask = COALESCE(?, code_mask),
            plan_structure = COALESCE(?, plan_structure),
            societal_type = COALESCE(?, societal_type),
            activity_type = COALESCE(?, activity_type),
            operation_start_date = COALESCE(?, operation_start_date),
            current_year = COALESCE(?, current_year),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `;

    const params = [
        name || null, 
        nit || null, 
        legal_name || null, 
        address || null, 
        city || null, 
        country || null,
        phone || null, 
        email || null, 
        website || null, 
        logo_url || null, 
        fiscal_year_start || null, 
        currency || null,
        code_mask || null, 
        plan_structure || null, 
        societal_type || null, 
        activity_type || null, 
        operation_start_date || null, 
        current_year || null, 
        id
    ];

    db.run(sql, params, function (err) {
        if (err) {
            console.error('Error updating company:', err);
            return res.status(500).json({ error: err.message });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Return updated company
        db.get('SELECT * FROM companies WHERE id = ?', [id], (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, data: row });
        });
    });
});

// DELETE company
router.delete('/:id', (req, res) => {
    const { id } = req.params;

    // Prevent deletion of default company
    if (id === '1') {
        return res.status(400).json({
            error: 'Cannot delete the default company',
            message: 'The default company cannot be deleted for data integrity reasons.'
        });
    }

    db.run('DELETE FROM companies WHERE id = ?', [id], function (err) {
        if (err) {
            console.error('Error deleting company:', err);
            return res.status(500).json({ error: err.message });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'Company not found' });
        }

        res.json({
            success: true,
            message: 'Company and all associated data deleted successfully',
            deleted_id: id
        });
    });
});

// GET company statistics
router.get('/:id/stats', (req, res) => {
    const { id } = req.params;

    const sql = `
        SELECT
            (SELECT COUNT(*) FROM accounts WHERE company_id = ?) as total_accounts,
            (SELECT COUNT(*) FROM transactions WHERE company_id = ?) as total_transactions,
            (SELECT COUNT(*) FROM inventory_items WHERE company_id = ?) as total_inventory_items,
            (SELECT COUNT(*) FROM fixed_assets WHERE company_id = ?) as total_fixed_assets,
            (SELECT SUM(debit) FROM transaction_entries te 
             JOIN transactions t ON te.transaction_id = t.id 
             WHERE t.company_id = ?) as total_debits,
            (SELECT SUM(credit) FROM transaction_entries te 
             JOIN transactions t ON te.transaction_id = t.id 
             WHERE t.company_id = ?) as total_credits,
            (SELECT COUNT(*) FROM transactions WHERE company_id = ? AND type = 'Cierre') as closing_count
    `;

    db.get(sql, [id, id, id, id, id, id, id], (err, row) => {
        if (err) {
            console.error('Error fetching company stats:', err);
            return res.status(500).json({ error: err.message });
        }
        // Determinar si está cerrado basado en la existencia de transacciones de tipo 'Cierre'
        if (row) {
            row.is_closed = (row.closing_count > 0);
        }
        res.json({ success: true, data: row });
    });
});

module.exports = router;
