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
    // Subqueries correlacionadas en vez de LEFT JOIN dobles: el join cartesiano
    // anterior materializaba O(transacciones × cuentas) filas por empresa, siendo
    // este el endpoint que corre en cada arranque de la app.
    const sql = `
        SELECT
            c.*,
            (SELECT COUNT(*) FROM transactions t WHERE t.company_id = c.id) as transaction_count,
            (SELECT COUNT(*) FROM accounts a WHERE a.company_id = c.id) as account_count,
            (SELECT MAX(t.date) FROM transactions t WHERE t.company_id = c.id) as last_activity
        FROM companies c
        ORDER BY c.created_at DESC
    `;

    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching companies:', err);
            return res.status(500).json({ error: 'Error al obtener empresas' });
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
            (SELECT COUNT(*) FROM transactions t WHERE t.company_id = c.id) as transaction_count,
            (SELECT COUNT(*) FROM accounts a WHERE a.company_id = c.id) as account_count,
            (SELECT COUNT(*) FROM inventory_items i WHERE i.company_id = c.id) as inventory_count,
            (SELECT MAX(t.date) FROM transactions t WHERE t.company_id = c.id) as last_activity
        FROM companies c
        WHERE c.id = ?
    `;

    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error('Error fetching company:', err);
            return res.status(500).json({ error: 'Error al obtener la empresa' });
        }
        if (!row) {
            return res.status(404).json({ error: 'Company not found' });
        }
        res.json({ success: true, data: row });
    });
});

// POST create new company
router.post('/', async (req, res) => {
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
    const requiredFields = {
        name: 'Nombre comercial',
        nit: 'NIT',
        legal_name: 'Razón o denominación social',
        address: 'Dirección',
        city: 'Ciudad',
        phone: 'Teléfono',
        email: 'Email',
        societal_type: 'Tipo societario',
        activity_type: 'Actividad económica',
        currency: 'Moneda',
        current_year: 'Año de gestión activa'
    };

    const missingFields = [];
    for (const [key, label] of Object.entries(requiredFields)) {
        if (req.body[key] === undefined || req.body[key] === null || String(req.body[key]).trim() === '') {
            missingFields.push(label);
        }
    }

    if (missingFields.length > 0) {
        return res.status(400).json({ 
            success: false, 
            error: `Los siguientes campos son obligatorios: ${missingFields.join(', ')}` 
        });
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

    try {
        const result = await db.run(sql, params);
        
        // Return the created company
        const row = await db.get('SELECT * FROM companies WHERE id = ?', [result.lastID]);
        res.status(201).json({ success: true, data: row, id: result.lastID });
        
    } catch (err) {
        console.error('Error creating company:', err);
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'A company with this NIT already exists' });
        }
        return res.status(500).json({ error: err.message });
    }
});

// PUT update company - LIBSQL PROMISES VERSION
router.put('/:id', async (req, res) => {
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

    const requiredFields = {
        name: 'Nombre comercial',
        nit: 'NIT',
        legal_name: 'Razón o denominación social',
        address: 'Dirección',
        city: 'Ciudad',
        phone: 'Teléfono',
        email: 'Email',
        societal_type: 'Tipo societario',
        activity_type: 'Actividad económica',
        currency: 'Moneda',
        current_year: 'Año de gestión activa'
    };

    const invalidFields = [];
    for (const key of Object.keys(requiredFields)) {
        if (req.body[key] !== undefined && (req.body[key] === null || String(req.body[key]).trim() === '')) {
            invalidFields.push(requiredFields[key]);
        }
    }

    if (invalidFields.length > 0) {
        return res.status(400).json({ 
            success: false, 
            error: `Los siguientes campos no pueden estar vacíos: ${invalidFields.join(', ')}` 
        });
    }

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

    try {
        const result = await db.run(sql, params);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Return updated company
        const row = await db.get('SELECT * FROM companies WHERE id = ?', [id]);
        res.json({ success: true, data: row });
        
    } catch (err) {
        console.error('Error updating company:', err);
        return res.status(500).json({ error: err.message });
    }
});

// DELETE company - LIBSQL PROMISES VERSION
router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    // Prevent deletion of default company
    if (id === '1') {
        return res.status(400).json({
            error: 'Cannot delete the default company',
            message: 'The default company cannot be deleted for data integrity reasons.'
        });
    }

    try {
        const result = await db.run('DELETE FROM companies WHERE id = ?', [id]);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Company not found' });
        }

        res.json({
            success: true,
            message: 'Company and all associated data deleted successfully',
            deleted_id: id
        });
        
    } catch (err) {
        console.error('Error deleting company:', err);
        return res.status(500).json({ error: err.message });
    }
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
