/**
 * Valuation Service
 * Manages inventory valuation (CPP, FIFO, IE) and manufacturing costs.
 * Based on REA Model: Resources (Inventory), Events (Movements).
 */

const db = require('../db');

class ValuationService {
    /**
     * Calcula el saldo y costo unitario de un ítem usando el método configurado.
     */
    async calculateBalance(itemId, method = 'CPP', companyId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT * FROM inventory_movements WHERE item_id = ? ORDER BY date ASC, id ASC`,
                [itemId],
                async (err, movements) => {
                    if (err) return reject(err);
                    
                    // Obtener saldo inicial (si lo hubiera en el futuro, por ahora empezamos de 0 o del primer movimiento)
                    // Nota: En un modelo REA puro, el saldo es la suma de eventos.
                    
                    if (movements.length === 0) {
                        return resolve({ quantity: 0, total_cost: 0, unit_cost: 0 });
                    }

                    if (method === 'CPP') {
                        return resolve(this._calculateCPP(movements));
                    } else if (method === 'PEPS') {
                        return resolve(this._calculateFIFO(movements));
                    } else {
                        // Default to CPP if method not supported yet
                        return resolve(this._calculateCPP(movements));
                    }
                }
            );
        });
    }

    _calculateCPP(movements) {
        let totalQty = 0;
        let totalValue = 0;

        movements.forEach(m => {
            if (m.type === 'Compra' || m.type === 'Entrada' || m.type === 'Produccion') {
                totalQty += m.quantity;
                totalValue += m.total_cost;
            } else {
                const avgCost = totalQty > 0 ? totalValue / totalQty : 0;
                totalQty -= m.quantity;
                totalValue -= (m.quantity * avgCost);
            }
        });

        return {
            quantity: totalQty,
            total_cost: totalValue,
            unit_cost: totalQty > 0 ? totalValue / totalQty : 0
        };
    }

    _calculateFIFO(movements) {
        let layers = []; // { qty, cost }
        
        movements.forEach(m => {
            if (m.type === 'Compra' || m.type === 'Entrada' || m.type === 'Produccion') {
                layers.push({ qty: m.quantity, cost: m.unit_cost });
            } else {
                let remainingToExit = m.quantity;
                while (remainingToExit > 0 && layers.length > 0) {
                    if (layers[0].qty <= remainingToExit) {
                        remainingToExit -= layers[0].qty;
                        layers.shift();
                    } else {
                        layers[0].qty -= remainingToExit;
                        remainingToExit = 0;
                    }
                }
            }
        });

        const totalQty = layers.reduce((sum, l) => sum + l.qty, 0);
        const totalValue = layers.reduce((sum, l) => sum + (l.qty * l.cost), 0);

        return {
            quantity: totalQty,
            total_cost: totalValue,
            unit_cost: totalQty > 0 ? totalValue / totalQty : 0
        };
    }

    /**
     * NRV Adjustment (Valor Neto Realizable)
     * Si Costo > Valor Mercado, se debe ajustar a pérdida.
     */
    async checkNRV(itemId, marketUnitPrice) {
        const item = await this.getItem(itemId);
        const balance = await this.calculateBalance(itemId, item.valuation_method, item.company_id);
        
        if (balance.unit_cost > marketUnitPrice) {
            const loss = (balance.unit_cost - marketUnitPrice) * balance.quantity;
            return {
                requires_adjustment: true,
                loss_amount: loss,
                new_unit_cost: marketUnitPrice
            };
        }
        return { requires_adjustment: false };
    }

    /**
     * Calcula el valor actual del WIP para una Orden de Producción.
     * Suma todos los consumos (Give Events) asignados a esa OP.
     */
    async getWIPValue(productionOrderId) {
        return new Promise((resolve, reject) => {
            // En un modelo REA, buscamos eventos de inventario y labor asociados a la OP
            const sql = `
                SELECT SUM(total_cost) as wip_value 
                FROM inventory_movements 
                WHERE production_order_id = ? AND type = 'Consumo'
            `;
            db.get(sql, [productionOrderId], (err, row) => {
                if (err) reject(err);
                resolve(row?.wip_value || 0);
            });
        });
    }

    getItem(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM inventory_items WHERE id = ?", [id], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });
    }
}

module.exports = new ValuationService();
