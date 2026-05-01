const express = require('express');
const router = express.Router();
const db = require('../db');
const valuationService = require('../services/valuationService');

// GET /api/inventory/items
router.get('/items', async (req, res) => {
    try {
        const { companyId } = req.query;
        const items = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM inventory_items WHERE company_id = ?", [companyId], (err, rows) => {
                if (err) reject(err);
                resolve(rows);
            });
        });

        // Enriquecer con saldos calculados
        const enrichedItems = await Promise.all(items.map(async (item) => {
            const balance = await valuationService.calculateBalance(item.id, item.valuation_method, companyId);
            return { ...item, ...balance };
        }));

        res.json({ success: true, data: enrichedItems });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/inventory/movements
router.post('/movements', async (req, res) => {
    try {
        const { 
            item_id, 
            type, 
            quantity, 
            unit_cost, 
            date, 
            cost_center_id, 
            production_order_id,
            gloss 
        } = req.body;

        const total_cost = quantity * unit_cost;

        db.run(
            `INSERT INTO inventory_movements 
            (item_id, date, type, quantity, unit_cost, total_cost, cost_center_id, production_order_id, gloss) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [item_id, date, type, quantity, unit_cost, total_cost, cost_center_id, production_order_id, gloss],
            function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, id: this.lastID });
            }
        );
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/inventory/cost-centers
router.get('/cost-centers', async (req, res) => {
    try {
        const { companyId } = req.query;
        db.all("SELECT * FROM cost_centers WHERE company_id = ? AND is_active = 1", [companyId], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: rows });
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
