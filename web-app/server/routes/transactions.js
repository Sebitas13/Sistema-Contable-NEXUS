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
        // Start transaction
        await db.run('BEGIN TRANSACTION');

        // Insert transaction header
        const insertTransaction = 'INSERT INTO transactions (date, gloss, type, company_id) VALUES (?, ?, ?, ?)';
        const transactionResult = await db.run(insertTransaction, [date, gloss, type, companyId]);
        const transactionId = transactionResult.lastID;

        // Insert all entries
        const insertEntry = 'INSERT INTO transaction_entries (transaction_id, account_id, debit, credit, gloss) VALUES (?, ?, ?, ?, ?)';
        
        for (const entry of entries) {
            const debit = parseFloat(entry.debit) || 0;
            const credit = parseFloat(entry.credit) || 0;
            await db.run(insertEntry, [transactionId, entry.accountId, debit, credit, entry.gloss || '']);
        }

        // Commit transaction
        await db.run('COMMIT');
        
        res.json({
            message: 'Transaction created',
            id: transactionId,
            data: req.body
        });
    } catch (error) {
        // Rollback on any error
        try {
            await db.run('ROLLBACK');
        } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError.message);
        }
        
        console.error('Error creating transaction:', error.message);
        res.status(400).json({ error: error.message });
    }
});

// POST /batch - Create multiple transactions at once (for closing entries)
router.post('/batch', async (req, res) => {
    const { transactions, companyId } = req.body;

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0 || !companyId) {
        return res.status(400).json({ error: 'Invalid request format: requires a "transactions" array and "companyId".' });
    }

    // Promisify db.run for use with async/await
    const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            // For INSERT, this.lastID is the new row's ID. For other operations, this.changes is useful.
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });

    try {
        await dbRun('BEGIN TRANSACTION');

        const insertTransactionSql = 'INSERT INTO transactions (date, gloss, type, company_id) VALUES (?, ?, ?, ?)';
        const insertEntrySql = 'INSERT INTO transaction_entries (transaction_id, account_id, debit, credit, gloss) VALUES (?, ?, ?, ?, ?)';

        for (const trans of transactions) {
            if (!trans.entries || !Array.isArray(trans.entries)) {
                throw new Error(`Transaction with gloss "${trans.gloss}" has invalid entries.`);
            }

            const { lastID: transactionId } = await dbRun(insertTransactionSql, [trans.date, trans.gloss, trans.type, companyId]);

            for (const entry of trans.entries) {
                if (!entry.accountId) {
                    throw new Error(`Entry in transaction with gloss "${trans.gloss}" is missing an accountId.`);
                }
                await dbRun(insertEntrySql, [
                    transactionId,
                    entry.accountId,
                    parseFloat(entry.debit) || 0,
                    parseFloat(entry.credit) || 0,
                    entry.gloss || ''
                ]);
            }
        }

        await dbRun('COMMIT');
        res.status(201).json({ message: `${transactions.length} closing transactions created successfully.` });

    } catch (error) {
        // Attempt to rollback
        try {
            await dbRun('ROLLBACK');
        } catch (rollbackError) {
            console.error('CRITICAL: Failed to rollback transaction:', rollbackError);
            // The connection might be in a bad state, but we must inform the client.
        }
        console.error('Failed to execute batch transaction insert:', error);
        res.status(500).json({ error: 'Failed to execute batch transaction insert.', details: error.message });
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
        // Start transaction
        await db.run('BEGIN TRANSACTION');

        // Update transaction header
        await db.run('UPDATE transactions SET date = ?, gloss = ?, type = ? WHERE id = ? AND company_id = ?',
            [date, gloss, type, id, companyId]);

        // Delete existing entries
        await db.run('DELETE FROM transaction_entries WHERE transaction_id = ?', [id]);

        // Insert new entries
        const insertEntry = 'INSERT INTO transaction_entries (transaction_id, account_id, debit, credit, gloss) VALUES (?, ?, ?, ?, ?)';
        
        for (const entry of entries) {
            const debit = parseFloat(entry.debit) || 0;
            const credit = parseFloat(entry.credit) || 0;
            await db.run(insertEntry, [id, entry.accountId, debit, credit, entry.gloss || '']);
        }

        // Commit transaction
        await db.run('COMMIT');
        res.json({ message: 'Transaction updated successfully' });
        
    } catch (error) {
        // Rollback on any error
        try {
            await db.run('ROLLBACK');
        } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError.message);
        }
        
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
        // Start transaction
        await db.run('BEGIN TRANSACTION');

        // Delete entries first (foreign key constraint)
        await db.run('DELETE FROM transaction_entries WHERE transaction_id = ?', [id]);

        // Delete the transaction, ensuring it belongs to the company
        const result = await db.run('DELETE FROM transactions WHERE id = ? AND company_id = ?', [id, companyId]);
        
        if (result.changes === 0) {
            await db.run('ROLLBACK');
            return res.status(404).json({ error: 'Transaction not found' });
        }

        // Commit transaction
        await db.run('COMMIT');
        res.json({ message: 'Transaction deleted successfully' });
        
    } catch (error) {
        // Rollback on any error
        try {
            await db.run('ROLLBACK');
        } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError.message);
        }
        
        console.error('Error deleting transaction:', error.message);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
