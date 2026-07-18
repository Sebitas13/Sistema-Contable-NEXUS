const express = require('express');
const router = express.Router();
const db = require('../db');
const valuationService = require('../services/valuationService');

// ============================================================================
// INVENTORY ITEMS CRUD
// ============================================================================

// GET /api/inventory/items - Listar items con saldos calculados
router.get('/items', (req, res) => {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ success: false, error: 'companyId requerido' });

    db.all(
        `SELECT * FROM inventory_items WHERE company_id = ? ORDER BY code ASC`,
        [companyId],
        async (err, items) => {
            if (err) return res.status(500).json({ success: false, error: err.message });

            try {
                // Enriquecer con saldos calculados por el motor de valuación.
                // Bulk: 1 query para todos los ítems (antes: 1 query por ítem => N+1).
                const tableFallback = (item) => ({
                    ...item,
                    quantity: item.balance_quantity || 0,
                    total_cost: item.balance_cost || 0,
                    unit_cost: item.balance_quantity > 0
                        ? (item.balance_cost / item.balance_quantity)
                        : 0
                });

                let enriched;
                try {
                    const balances = await valuationService.calculateBalances(items || [], companyId);
                    enriched = (items || []).map(item => {
                        const balance = balances.get(item.id);
                        return balance ? { ...item, ...balance } : tableFallback(item);
                    });
                } catch (calcErr) {
                    console.error('Bulk balance calculation failed, usando saldos de tabla:', calcErr.message);
                    enriched = (items || []).map(tableFallback);
                }
                res.json({ success: true, data: enriched });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        }
    );
});

// POST /api/inventory/items - Crear nuevo item
router.post('/items', (req, res) => {
    const { 
        company_id, code, name, unit, 
        item_type = 'PT', 
        valuation_method = 'CPP',
        initial_quantity = 0,
        initial_cost = 0
    } = req.body;

    if (!company_id || !code || !name || !unit) {
        return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
    }

    // Determinar cumplimiento IAS 2
    const ias2_compliant = valuation_method !== 'UEPS' ? 1 : 0;

    db.run(
        `INSERT INTO inventory_items (company_id, code, name, unit, item_type, valuation_method, ias2_compliant, balance_quantity, balance_cost) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [company_id, code, name, unit, item_type, valuation_method, ias2_compliant, initial_quantity, initial_quantity * initial_cost],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ success: false, error: `Ya existe un artículo con código "${code}"` });
                }
                return res.status(500).json({ success: false, error: err.message });
            }

            // Si hay cantidad inicial, registrar como movimiento de apertura
            if (initial_quantity > 0 && initial_cost > 0) {
                db.run(
                    `INSERT INTO inventory_movements (item_id, date, type, quantity, unit_cost, total_cost, gloss) 
                     VALUES (?, date('now'), 'Entrada', ?, ?, ?, 'Saldo inicial de apertura')`,
                    [this.lastID, initial_quantity, initial_cost, initial_quantity * initial_cost]
                );
            }

            res.json({ success: true, id: this.lastID });
        }
    );
});

// PUT /api/inventory/items/:id - Actualizar item
router.put('/items/:id', (req, res) => {
    const { id } = req.params;
    const { name, unit, item_type, valuation_method } = req.body;
    const ias2_compliant = valuation_method !== 'UEPS' ? 1 : 0;

    db.run(
        `UPDATE inventory_items SET name = ?, unit = ?, item_type = ?, valuation_method = ?, ias2_compliant = ? WHERE id = ?`,
        [name, unit, item_type, valuation_method, ias2_compliant, id],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, changes: this.changes });
        }
    );
});

// DELETE /api/inventory/items/:id
router.delete('/items/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM inventory_items WHERE id = ?`, [id], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, changes: this.changes });
    });
});

// ============================================================================
// INVENTORY MOVEMENTS
// ============================================================================

// GET /api/inventory/movements/:itemId - Historial de movimientos
router.get('/movements/:itemId', (req, res) => {
    const { itemId } = req.params;
    db.all(
        `SELECT im.*, cc.name as cost_center_name 
         FROM inventory_movements im 
         LEFT JOIN cost_centers cc ON im.cost_center_id = cc.id
         WHERE im.item_id = ? 
         ORDER BY im.date ASC, im.id ASC`,
        [itemId],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: rows || [] });
        }
    );
});

// POST /api/inventory/movements - Registrar movimiento
router.post('/movements', (req, res) => {
    const { 
        item_id, type, quantity, unit_cost, date, 
        cost_center_id, production_order_id, gloss 
    } = req.body;

    if (!item_id || !type || !quantity || !date) {
        return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
    }

    const total_cost = parseFloat(quantity) * parseFloat(unit_cost || 0);

    db.run(
        `INSERT INTO inventory_movements 
        (item_id, date, type, quantity, unit_cost, total_cost, cost_center_id, production_order_id, gloss) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item_id, date, type, parseFloat(quantity), parseFloat(unit_cost || 0), total_cost, cost_center_id || null, production_order_id || null, gloss || ''],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

// ============================================================================
// COST CENTERS CRUD
// ============================================================================

// GET /api/inventory/cost-centers
router.get('/cost-centers', (req, res) => {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ success: false, error: 'companyId requerido' });

    db.all(
        `SELECT cc.*, pc.name as parent_name 
         FROM cost_centers cc 
         LEFT JOIN cost_centers pc ON cc.parent_id = pc.id 
         WHERE cc.company_id = ? 
         ORDER BY cc.code ASC`,
        [companyId],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: rows || [] });
        }
    );
});

// POST /api/inventory/cost-centers
router.post('/cost-centers', (req, res) => {
    const { company_id, code, name, parent_id, type = 'Analytic' } = req.body;
    if (!company_id || !code || !name) {
        return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
    }

    db.run(
        `INSERT INTO cost_centers (company_id, code, name, parent_id, type) VALUES (?, ?, ?, ?, ?)`,
        [company_id, code, name, parent_id || null, type],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ success: false, error: `Ya existe un centro de costo con código "${code}"` });
                }
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, id: this.lastID });
        }
    );
});

// PUT /api/inventory/cost-centers/:id
router.put('/cost-centers/:id', (req, res) => {
    const { id } = req.params;
    const { name, code, parent_id, type, is_active } = req.body;

    db.run(
        `UPDATE cost_centers SET name = ?, code = ?, parent_id = ?, type = ?, is_active = ? WHERE id = ?`,
        [name, code, parent_id || null, type || 'Analytic', is_active !== undefined ? is_active : 1, id],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, changes: this.changes });
        }
    );
});

// DELETE /api/inventory/cost-centers/:id
router.delete('/cost-centers/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM cost_centers WHERE id = ?`, [id], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, changes: this.changes });
    });
});

// ============================================================================
// DISTRIBUTION MODELS
// ============================================================================

// GET /api/inventory/distribution-models
router.get('/distribution-models', (req, res) => {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ success: false, error: 'companyId requerido' });

    db.all(
        `SELECT dm.*, 
            (SELECT json_group_array(json_object(
                'id', de.id, 
                'cost_center_id', de.cost_center_id, 
                'percentage', de.percentage,
                'cost_center_name', cc.name
            ))
            FROM cost_distribution_entries de 
            JOIN cost_centers cc ON de.cost_center_id = cc.id
            WHERE de.model_id = dm.id) as entries
         FROM cost_distribution_models dm 
         WHERE dm.company_id = ? AND dm.is_active = 1`,
        [companyId],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            // Parse JSON entries
            const data = (rows || []).map(r => ({
                ...r,
                entries: r.entries ? JSON.parse(r.entries) : []
            }));
            res.json({ success: true, data });
        }
    );
});

// POST /api/inventory/distribution-models
router.post('/distribution-models', (req, res) => {
    const { company_id, name, description, entries } = req.body;
    if (!company_id || !name) {
        return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
    }

    // Validar que los porcentajes sumen 100%
    if (entries && entries.length > 0) {
        const totalPct = entries.reduce((sum, e) => sum + parseFloat(e.percentage || 0), 0);
        if (Math.abs(totalPct - 100) > 0.01) {
            return res.status(400).json({ success: false, error: `Los porcentajes deben sumar 100% (actual: ${totalPct.toFixed(2)}%)` });
        }
    }

    db.run(
        `INSERT INTO cost_distribution_models (company_id, name, description) VALUES (?, ?, ?)`,
        [company_id, name, description || ''],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            const modelId = this.lastID;

            // Insertar entradas del modelo
            if (entries && entries.length > 0) {
                const stmt = db.prepare(
                    `INSERT INTO cost_distribution_entries (model_id, cost_center_id, percentage) VALUES (?, ?, ?)`
                );
                entries.forEach(e => {
                    stmt.run([modelId, e.cost_center_id, parseFloat(e.percentage) / 100]);
                });
                stmt.finalize();
            }

            res.json({ success: true, id: modelId });
        }
    );
});

// DELETE /api/inventory/distribution-models/:id
router.delete('/distribution-models/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM cost_distribution_models WHERE id = ?`, [id], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, changes: this.changes });
    });
});

module.exports = router;
