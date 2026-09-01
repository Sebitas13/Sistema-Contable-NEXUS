const express = require('express');
const router = express.Router();
const db = require('../db');
const valuationService = require('../services/valuationService');
const { ValidationError, normalizeDate, parseAmount } = require('../utils/transactionValidator');

const MOVEMENT_TYPES = ['Entrada', 'Salida', 'Consumo', 'Ajuste'];

// Helper: verifica que un ítem pertenece a la empresa (promisificado)
function getOwnedItem(itemId, companyId) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT id, code, name, valuation_method FROM inventory_items WHERE id = ? AND company_id = ?',
            [itemId, companyId],
            (err, rows) => (err ? reject(err) : resolve(rows && rows[0]))
        );
    });
}

// ============================================================================
// INVENTORY ITEMS CRUD (scoped por empresa)
// ============================================================================

// GET /api/inventory/items - Listar items con saldos calculados
router.get('/items', (req, res) => {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ success: false, error: 'companyId requerido' });

    db.all(
        `SELECT * FROM inventory_items WHERE company_id = ? ORDER BY code ASC`,
        [companyId],
        async (err, items) => {
            if (err) {
                console.error('Error listing inventory items:', err.message);
                return res.status(500).json({ success: false, error: 'Error al listar artículos' });
            }

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
                console.error('Error enriching inventory items:', error.message);
                res.status(500).json({ success: false, error: 'Error al calcular valuaciones' });
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

    const qty = parseAmount(initial_quantity);
    const cost = parseAmount(initial_cost);
    if (qty === null || cost === null) {
        return res.status(400).json({ success: false, error: 'Cantidad y costo inicial deben ser números ≥ 0' });
    }

    // Determinar cumplimiento IAS 2
    const ias2_compliant = valuation_method !== 'UEPS' ? 1 : 0;

    db.run(
        `INSERT INTO inventory_items (company_id, code, name, unit, item_type, valuation_method, ias2_compliant, balance_quantity, balance_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [company_id, code, name, unit, item_type, valuation_method, ias2_compliant, qty, qty * cost],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ success: false, error: `Ya existe un artículo con código "${code}"` });
                }
                console.error('Error creating inventory item:', err.message);
                return res.status(500).json({ success: false, error: 'Error al crear el artículo' });
            }

            // Si hay cantidad inicial, registrar como movimiento de apertura
            if (qty > 0 && cost > 0) {
                db.run(
                    `INSERT INTO inventory_movements (item_id, date, type, quantity, unit_cost, total_cost, gloss)
                     VALUES (?, date('now'), 'Entrada', ?, ?, ?, 'Saldo inicial de apertura')`,
                    [this.lastID, qty, cost, qty * cost],
                    (movErr) => {
                        if (movErr) console.error('Error registrando apertura de kardex:', movErr.message);
                    }
                );
            }

            res.json({ success: true, id: this.lastID });
        }
    );
});

// PUT /api/inventory/items/:id - Actualizar item (scoped por empresa)
router.put('/items/:id', (req, res) => {
    const { id } = req.params;
    const { name, unit, item_type, valuation_method, company_id } = req.body;

    if (!company_id) {
        return res.status(400).json({ success: false, error: 'company_id requerido' });
    }
    if (!name || !unit || !valuation_method) {
        return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
    }

    const ias2_compliant = valuation_method !== 'UEPS' ? 1 : 0;

    db.run(
        `UPDATE inventory_items SET name = ?, unit = ?, item_type = ?, valuation_method = ?, ias2_compliant = ?
         WHERE id = ? AND company_id = ?`,
        [name, unit, item_type || 'PT', valuation_method, ias2_compliant, id, company_id],
        function(err) {
            if (err) {
                console.error('Error updating inventory item:', err.message);
                return res.status(500).json({ success: false, error: 'Error al actualizar el artículo' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
            }
            res.json({ success: true, changes: this.changes });
        }
    );
});

// DELETE /api/inventory/items/:id (scoped por empresa)
router.delete('/items/:id', (req, res) => {
    const { id } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ success: false, error: 'companyId requerido' });
    }

    db.run(`DELETE FROM inventory_items WHERE id = ? AND company_id = ?`, [id, companyId], function(err) {
        if (err) {
            console.error('Error deleting inventory item:', err.message);
            return res.status(500).json({ success: false, error: 'Error al eliminar el artículo' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
        }
        res.json({ success: true, changes: this.changes });
    });
});

// ============================================================================
// INVENTORY MOVEMENTS (kardex)
// ============================================================================

// GET /api/inventory/movements/:itemId - Historial de movimientos (scoped)
router.get('/movements/:itemId', (req, res) => {
    const { itemId } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ success: false, error: 'companyId requerido' });
    }

    db.all(
        `SELECT im.*, cc.name as cost_center_name
         FROM inventory_movements im
         LEFT JOIN cost_centers cc ON im.cost_center_id = cc.id
         WHERE im.item_id = ?
           AND EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = im.item_id AND i.company_id = ?)
         ORDER BY im.date ASC, im.id ASC`,
        [itemId, companyId],
        (err, rows) => {
            if (err) {
                console.error('Error fetching movements:', err.message);
                return res.status(500).json({ success: false, error: 'Error al obtener movimientos' });
            }
            res.json({ success: true, data: rows || [] });
        }
    );
});

// POST /api/inventory/movements - Registrar movimiento (validado)
router.post('/movements', async (req, res) => {
    const {
        item_id, type, quantity, unit_cost, date,
        cost_center_id, production_order_id, gloss,
        companyId
    } = req.body;

    if (!item_id || !type || !quantity || !date || !companyId) {
        return res.status(400).json({ success: false, error: 'Faltan campos requeridos (item_id, type, quantity, date, companyId)' });
    }

    try {
        // Tipo dentro del catálogo del kardex
        if (!MOVEMENT_TYPES.includes(type)) {
            throw new ValidationError(`Tipo de movimiento inválido: "${type}". Válidos: ${MOVEMENT_TYPES.join(', ')}.`);
        }

        const qty = parseAmount(quantity);
        if (qty === null || qty <= 0) {
            throw new ValidationError('La cantidad debe ser un número mayor a 0.');
        }

        // En las entradas el costo unitario es obligatorio; en salidas/consumos va en 0
        // (el motor de valuación lo calcula según el método del ítem).
        let cost = 0;
        if (type === 'Entrada') {
            cost = parseAmount(unit_cost);
            if (cost === null || cost < 0) {
                throw new ValidationError('El costo unitario de una entrada debe ser un número ≥ 0.');
            }
        }

        const normDate = normalizeDate(date);
        if (!normDate) {
            throw new ValidationError('La fecha debe tener formato YYYY-MM-DD.');
        }

        // Scoped multi-tenant: el ítem debe existir y pertenecer a la empresa.
        const item = await getOwnedItem(item_id, companyId);
        if (!item) {
            throw new ValidationError('El artículo no existe en esta empresa.');
        }

        // Si se asigna centro de costo, que sea de la misma empresa.
        if (cost_center_id) {
            const center = await new Promise((resolve, reject) => {
                db.all(
                    'SELECT id FROM cost_centers WHERE id = ? AND company_id = ?',
                    [cost_center_id, companyId],
                    (err, rows) => (err ? reject(err) : resolve(rows && rows[0]))
                );
            });
            if (!center) {
                throw new ValidationError('El centro de costo no existe en esta empresa.');
            }
        }

        const total_cost = type === 'Entrada' ? qty * cost : 0;

        db.run(
            `INSERT INTO inventory_movements
            (item_id, date, type, quantity, unit_cost, total_cost, cost_center_id, production_order_id, gloss)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [item_id, normDate, type, qty, type === 'Entrada' ? cost : 0, total_cost, cost_center_id || null, production_order_id || null, gloss || ''],
            function(err) {
                if (err) {
                    console.error('Error registering movement:', err.message);
                    return res.status(500).json({ success: false, error: 'Error al registrar el movimiento' });
                }
                res.json({ success: true, id: this.lastID });
            }
        );
    } catch (error) {
        if (error instanceof ValidationError) {
            return res.status(400).json({ success: false, error: error.message });
        }
        console.error('Error in movement validation:', error.message);
        res.status(500).json({ success: false, error: 'Error al registrar el movimiento' });
    }
});

// ============================================================================
// COST CENTERS CRUD (scoped por empresa)
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
            if (err) {
                console.error('Error fetching cost centers:', err.message);
                return res.status(500).json({ success: false, error: 'Error al obtener centros de costo' });
            }
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
                console.error('Error creating cost center:', err.message);
                return res.status(500).json({ success: false, error: 'Error al crear el centro de costo' });
            }
            res.json({ success: true, id: this.lastID });
        }
    );
});

// PUT /api/inventory/cost-centers/:id (scoped)
router.put('/cost-centers/:id', (req, res) => {
    const { id } = req.params;
    const { name, code, parent_id, type, is_active, company_id } = req.body;

    if (!company_id) {
        return res.status(400).json({ success: false, error: 'company_id requerido' });
    }
    if (!name || !code) {
        return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
    }

    db.run(
        `UPDATE cost_centers SET name = ?, code = ?, parent_id = ?, type = ?, is_active = ? WHERE id = ? AND company_id = ?`,
        [name, code, parent_id || null, type || 'Analytic', is_active !== undefined ? is_active : 1, id, company_id],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ success: false, error: `Ya existe un centro de costo con código "${code}"` });
                }
                console.error('Error updating cost center:', err.message);
                return res.status(500).json({ success: false, error: 'Error al actualizar el centro de costo' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ success: false, error: 'Centro de costo no encontrado' });
            }
            res.json({ success: true, changes: this.changes });
        }
    );
});

// DELETE /api/inventory/cost-centers/:id (scoped)
router.delete('/cost-centers/:id', (req, res) => {
    const { id } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ success: false, error: 'companyId requerido' });
    }

    db.run(`DELETE FROM cost_centers WHERE id = ? AND company_id = ?`, [id, companyId], function(err) {
        if (err) {
            console.error('Error deleting cost center:', err.message);
            return res.status(500).json({ success: false, error: 'Error al eliminar el centro de costo' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Centro de costo no encontrado' });
        }
        res.json({ success: true, changes: this.changes });
    });
});

// ============================================================================
// DISTRIBUTION MODELS (creación atómica, scoped)
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
            if (err) {
                console.error('Error fetching distribution models:', err.message);
                return res.status(500).json({ success: false, error: 'Error al obtener modelos de distribución' });
            }
            // Parse JSON entries
            const data = (rows || []).map(r => ({
                ...r,
                entries: r.entries ? JSON.parse(r.entries) : []
            }));
            res.json({ success: true, data });
        }
    );
});

// POST /api/inventory/distribution-models (atómico: modelo + reglas juntos o nada)
router.post('/distribution-models', async (req, res) => {
    const { company_id, name, description, entries } = req.body;

    if (!company_id || !name) {
        return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
    }
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ success: false, error: 'El modelo necesita al menos una regla de distribución' });
    }

    try {
        // Validar porcentajes: números > 0 que sumen exactamente 100%
        let totalPct = 0;
        for (const e of entries) {
            const pct = parseAmount(e.percentage);
            if (pct === null || pct <= 0) {
                throw new ValidationError('Los porcentajes deben ser números mayores a 0.');
            }
            totalPct += pct;
        }
        if (Math.abs(totalPct - 100) > 0.01) {
            throw new ValidationError(`Los porcentajes deben sumar 100% (actual: ${totalPct.toFixed(2)}%)`);
        }

        // Scoped: todos los centros de costo deben pertenecer a la empresa
        const centerIds = [...new Set(entries.map(e => Number(e.cost_center_id)).filter(Number.isInteger))];
        if (centerIds.length !== entries.length) {
            throw new ValidationError('Toda regla necesita un centro de costo válido.');
        }
        const placeholders = centerIds.map(() => '?').join(',');
        const ownedRows = await new Promise((resolve, reject) => {
            db.all(
                `SELECT id FROM cost_centers WHERE company_id = ? AND id IN (${placeholders})`,
                [company_id, ...centerIds],
                (err, rows) => (err ? reject(err) : resolve(rows || []))
            );
        });
        if (ownedRows.length !== centerIds.length) {
            throw new ValidationError('Algún centro de costo del modelo no existe en esta empresa.');
        }

        const modelId = await db.transaction(async (tx) => {
            const rs = await tx.execute({
                sql: 'INSERT INTO cost_distribution_models (company_id, name, description) VALUES (?, ?, ?)',
                args: [company_id, name, description || '']
            });
            const id = Number(rs.lastInsertRowid);

            for (const e of entries) {
                await tx.execute({
                    sql: 'INSERT INTO cost_distribution_entries (model_id, cost_center_id, percentage) VALUES (?, ?, ?)',
                    args: [id, Number(e.cost_center_id), parseAmount(e.percentage) / 100]
                });
            }
            return id;
        });

        res.json({ success: true, id: modelId });
    } catch (error) {
        if (error instanceof ValidationError) {
            return res.status(400).json({ success: false, error: error.message });
        }
        console.error('Error creating distribution model:', error.message);
        res.status(500).json({ success: false, error: 'Error al crear el modelo de distribución' });
    }
});

// DELETE /api/inventory/distribution-models/:id (scoped)
router.delete('/distribution-models/:id', (req, res) => {
    const { id } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ success: false, error: 'companyId requerido' });
    }

    db.run(`DELETE FROM cost_distribution_models WHERE id = ? AND company_id = ?`, [id, companyId], function(err) {
        if (err) {
            console.error('Error deleting distribution model:', err.message);
            return res.status(500).json({ success: false, error: 'Error al eliminar el modelo de distribución' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Modelo de distribución no encontrado' });
        }
        res.json({ success: true, changes: this.changes });
    });
});

module.exports = router;
