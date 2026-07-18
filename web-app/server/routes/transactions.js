const express = require('express');
const router = express.Router();
const db = require('../db');

// Get transaction by ID with account details (debe ir antes de la ruta general)
router.get('/:id', (req, res) => {
    const { id } = req.params;

    const sql = `
        SELECT 
            t.*,
            te.id as entry_id,
            te.account_id,
            te.debit,
            te.credit,
            te.gloss as entry_gloss,
            a.code as account_code,
            a.name as account_name
        FROM transactions t
        LEFT JOIN transaction_entries te ON t.id = te.transaction_id
        LEFT JOIN accounts a ON te.account_id = a.id
        WHERE t.id = ?
        ORDER BY te.id
    `;

    db.all(sql, [id], (err, rows) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }

        if (rows.length === 0) {
            res.status(404).json({ error: 'Transaction not found' });
            return;
        }

        const transaction = {
            id: rows[0].id,
            date: rows[0].date,
            gloss: rows[0].gloss,
            type: rows[0].type,
            company_id: rows[0].company_id,
            created_at: rows[0].created_at,
            entries: rows
                .filter(row => row.entry_id)
                .map(row => ({
                    id: row.entry_id,
                    account_id: row.account_id,
                    account_code: row.account_code,
                    account_name: row.account_name,
                    debit: parseFloat(row.debit || 0),
                    credit: parseFloat(row.credit || 0),
                    gloss: row.entry_gloss
                }))
        };

        // Calcular totales
        transaction.total_debit = transaction.entries.reduce((sum, e) => sum + e.debit, 0);
        transaction.total_credit = transaction.entries.reduce((sum, e) => sum + e.credit, 0);

        res.json({ data: transaction });
    });
});

// Get all transactions
router.get('/', (req, res) => {
    const { companyId } = req.query;

    let sql = `
        SELECT t.*,
               COALESCE(SUM(te.debit), 0) as total_debit,
               COALESCE(SUM(te.credit), 0) as total_credit,
               json_group_array(json_object(
                   'account_id', te.account_id, 
                   'debit', te.debit, 
                   'credit', te.credit,
                   'account_code', a.code,
                   'account_name', a.name
               )) as entries
        FROM transactions t
        LEFT JOIN transaction_entries te ON t.id = te.transaction_id
        LEFT JOIN accounts a ON te.account_id = a.id
    `;
    const params = [];

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    if (companyId) {
        sql += ` WHERE t.company_id = ?`;
        params.push(companyId);
    }

    sql += ` GROUP BY t.id ORDER BY t.date DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }
        const transactions = rows.map(row => {
            const entries = JSON.parse(row.entries || '[]');

            let totalDebit = Number(row.total_debit) || 0;
            let totalCredit = Number(row.total_credit) || 0;

            if ((totalDebit === 0 && totalCredit === 0) && entries.length > 0) {
                totalDebit = entries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0);
                totalCredit = entries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0);
            }

            return {
                id: row.id,
                company_id: row.company_id,
                date: row.date,
                gloss: row.gloss,
                type: row.type,
                created_at: row.created_at,
                total_debit: totalDebit,
                total_credit: totalCredit,
                entries: entries
            };
        });
        res.json({ data: transactions });
    });
});

// Create a new transaction - LIBSQL PROMISES VERSION
router.post('/', async (req, res) => {
    const { date, gloss, type, entries, companyId } = req.body;

    if (!date || !gloss || !type || !entries || entries.length === 0 || !companyId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Transacción interactiva libSQL: atómica bajo concurrencia y con lastInsertRowid real.
        // (Antes: BEGIN/COMMIT sueltos sobre la cola compartida, que podían intercalar requests.)
        const transactionId = await db.transaction(async (tx) => {
            // Insert transaction header
            const headerRs = await tx.execute({
                sql: 'INSERT INTO transactions (date, gloss, type, company_id) VALUES (?, ?, ?, ?)',
                args: [date, gloss, type, companyId]
            });
            const id = Number(headerRs.lastInsertRowid);

            // Insert all entries
            const insertEntrySql = 'INSERT INTO transaction_entries (transaction_id, account_id, debit, credit, gloss) VALUES (?, ?, ?, ?, ?)';
            for (const entry of entries) {
                const debit = parseFloat(entry.debit) || 0;
                const credit = parseFloat(entry.credit) || 0;
                await tx.execute({
                    sql: insertEntrySql,
                    args: [id, entry.accountId, debit, credit, entry.gloss || '']
                });
            }

            return id;
        });

        res.json({
            message: 'Transaction created',
            id: transactionId,
            data: req.body
        });
    } catch (error) {
        console.error('Error creating transaction:', error.message);
        res.status(400).json({ error: error.message });
    }
});

// POST /batch - Create multiple transactions at once (Bulk SQL V4)
router.post('/batch', async (req, res) => {
    const { transactions, companyId } = req.body;

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0 || !companyId) {
        return res.status(400).json({ error: 'Invalid request format: requires a "transactions" array and "companyId".' });
    }

    try {
        // Strategy V4: Use db.exec() which maps to client.batch() with STRINGS.
        // We construct proper SQL strings. 
        // NOTE: LibSQL batch executes sequentially.
        // We use `last_insert_rowid()` to link entries to headers.

        const batchStmts = [];

        // SEGURIDAD: sentencias parametrizadas con {sql, args}. libSQL client.batch() ejecuta
        // el array secuencialmente en una transacción implícita, así que last_insert_rowid()
        // sigue refiriéndose a la cabecera insertada justo antes. Sin concatenar entrada del usuario.
        const toNull = (v) => (v === undefined ? null : v);

        for (const trans of transactions) {
            // 1. Insert Header (parametrizado)
            batchStmts.push({
                sql: `INSERT INTO transactions (date, gloss, type, company_id) VALUES (?, ?, ?, ?)`,
                args: [toNull(trans.date), toNull(trans.gloss), toNull(trans.type), toNull(companyId)]
            });

            // 2. Insert Entries (Bulk parametrizado)
            if (trans.entries && Array.isArray(trans.entries) && trans.entries.length > 0) {
                const placeholders = [];
                const args = [];
                for (const entry of trans.entries) {
                    if (!entry.accountId) throw new Error(`Entry in transaction "${trans.gloss}" is missing an accountId.`);
                    // last_insert_rowid() refiere a la cabecera insertada justo arriba.
                    placeholders.push(`(last_insert_rowid(), ?, ?, ?, ?)`);
                    args.push(
                        entry.accountId,
                        parseFloat(entry.debit) || 0,
                        parseFloat(entry.credit) || 0,
                        entry.gloss || ''
                    );
                }

                batchStmts.push({
                    sql: `INSERT INTO transaction_entries (transaction_id, account_id, debit, credit, gloss) VALUES ${placeholders.join(', ')}`,
                    args
                });
            }
        }

        if (batchStmts.length === 0) {
            return res.json({ success: true, message: 'No transactions to insert.' });
        }

        // Execute via db.exec (client.batch)
        await new Promise((resolve, reject) => {
            db.exec(batchStmts, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        console.log(`✅ Bulk Batch successful: ${transactions.length} txs.`);

        if (!res.headersSent) {
            res.status(201).json({
                success: true,
                message: `${transactions.length} closing transactions created successfully.`
            });
        }

    } catch (error) {
        console.error('CRITICAL: Failed to execute BULK batch insert:', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Failed to execute bulk batch insert.',
                details: error.message
            });
        }
    }
});

// Update transaction - LIBSQL PROMISES VERSION
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { date, gloss, type, entries, companyId } = req.body;

    if (!date || !gloss || !type || !entries || entries.length === 0 || !companyId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Transacción interactiva libSQL (misma razón que en POST /).
        await db.transaction(async (tx) => {
            // Update transaction header
            await tx.execute({
                sql: 'UPDATE transactions SET date = ?, gloss = ?, type = ? WHERE id = ? AND company_id = ?',
                args: [date, gloss, type, id, companyId]
            });

            // Delete existing entries
            await tx.execute({
                sql: 'DELETE FROM transaction_entries WHERE transaction_id = ?',
                args: [id]
            });

            // Insert new entries
            const insertEntrySql = 'INSERT INTO transaction_entries (transaction_id, account_id, debit, credit, gloss) VALUES (?, ?, ?, ?, ?)';
            for (const entry of entries) {
                const debit = parseFloat(entry.debit) || 0;
                const credit = parseFloat(entry.credit) || 0;
                await tx.execute({
                    sql: insertEntrySql,
                    args: [id, entry.accountId, debit, credit, entry.gloss || '']
                });
            }
        });

        res.json({ message: 'Transaction updated successfully' });

    } catch (error) {
        console.error('Error updating transaction:', error.message);
        res.status(400).json({ error: error.message });
    }
});

// Delete transaction - LIBSQL PROMISES VERSION
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required to delete transactions' });
    }

    try {
        // Transacción interactiva libSQL (misma razón que en POST /).
        const deleted = await db.transaction(async (tx) => {
            // Delete entries first (foreign key constraint)
            await tx.execute({
                sql: 'DELETE FROM transaction_entries WHERE transaction_id = ?',
                args: [id]
            });

            // Delete the transaction, ensuring it belongs to the company
            const rs = await tx.execute({
                sql: 'DELETE FROM transactions WHERE id = ? AND company_id = ?',
                args: [id, companyId]
            });

            return rs.rowsAffected > 0;
        });

        if (!deleted) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        res.json({ message: 'Transaction deleted successfully' });

    } catch (error) {
        console.error('Error deleting transaction:', error.message);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
