const express = require('express');
const router = express.Router();
const db = require('../db');
const archiver = require('archiver');
const unzipper = require('unzipper');
const fs = require('fs-extra');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const axios = require('axios');

const VERSION = "1.0.0";
const MAX_SIZE = 100 * 1024 * 1024; // 100MB

// Ensure upload directory exists
fs.ensureDirSync(path.join(__dirname, '../temp/uploads/'));

// Multer setup for temporary file storage during import
const upload = multer({
    dest: path.join(__dirname, '../temp/uploads/'),
    limits: { fileSize: MAX_SIZE }
});

/**
 * UTILS
 */

// Helper to wrap db.all in a promise
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

// Helper to wrap db.get in a promise
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

// Helper to run a command in a promise
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
    });
});

/**
 * EXPORT
 */
router.get('/export/:companyId', async (req, res) => {
    const { companyId } = req.params;

    try {
        // 1. Verify company exists
        const company = await dbGet('SELECT * FROM companies WHERE id = ?', [companyId]);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // 2. Setup ZIP stream
        const archive = archiver('zip', { zlib: { level: 9 } });
        res.attachment(`Backup_${company.name.replace(/\s+/g, '_')}_${formatDate(new Date())}.zip`);
        archive.pipe(res);

        // 3. Fetch all data sets
        const tables = [
            { name: 'companies', sql: 'SELECT * FROM companies WHERE id = ?', params: [companyId] },
            { name: 'accounts', sql: 'SELECT * FROM accounts WHERE company_id = ?', params: [companyId] },
            { name: 'transactions', sql: 'SELECT * FROM transactions WHERE company_id = ?', params: [companyId] },
            {
                name: 'transaction_entries', sql: `
                SELECT te.* FROM transaction_entries te 
                JOIN transactions t ON te.transaction_id = t.id 
                WHERE t.company_id = ?`, params: [companyId]
            },
            { name: 'ufv_rates', sql: 'SELECT * FROM ufv_rates WHERE company_id = ?', params: [companyId] },
            { name: 'exchange_rates', sql: 'SELECT * FROM exchange_rates WHERE company_id = ?', params: [companyId] },
            { name: 'mahoraga_adaptation_events', sql: 'SELECT * FROM mahoraga_adaptation_events WHERE company_id = ?', params: [companyId] },
            { name: 'company_adjustment_profiles', sql: 'SELECT * FROM company_adjustment_profiles WHERE company_id = ?', params: [companyId] }
        ];

        let combinedData = {};
        for (const table of tables) {
            const rows = await dbAll(table.sql, table.params);
            combinedData[table.name] = rows;
            archive.append(JSON.stringify(rows, null, 2), { name: `data/${table.name}.json` });
        }

        // 4. Generate Metadata & Hash
        const dataString = JSON.stringify(combinedData);
        const hash = crypto.createHash('sha256').update(dataString).digest('hex');

        const metadata = {
            version: VERSION,
            timestamp: new Date().toISOString(),
            companyName: company.name,
            nit: company.nit,
            counts: {
                accounts: combinedData.accounts.length,
                transactions: combinedData.transactions.length
            },
            hash: hash
        };

        archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

        // 5. Finalize
        await archive.finalize();

    } catch (err) {
        console.error('Export error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to generate backup: ' + err.message });
        }
    }
});

/**
 * DRY RUN (PREVIEW)
 */
router.post('/dry-run', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        const directory = await unzipper.Open.file(req.file.path);
        const metadataFile = directory.files.find(d => d.path === 'metadata.json');

        if (!metadataFile) {
            await fs.remove(req.file.path);
            return res.status(400).json({ error: 'Invalid backup: metadata.json missing' });
        }

        const metadataContent = await metadataFile.buffer();
        const metadata = JSON.parse(metadataContent.toString());

        // Basic version check
        if (metadata.version !== VERSION) {
            // We could handle migrations here in the future
        }

        await fs.remove(req.file.path);
        res.json({ success: true, metadata });

    } catch (err) {
        if (req.file) await fs.remove(req.file.path);
        res.status(500).json({ error: 'Failed to read backup: ' + err.message });
    }
});

/**
 * IMPORT
 */
router.post('/import', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Helper to run commands within a transaction
    const txRun = async (tx, sql, params = []) => {
        // Helper to convert BigInt to Number for JSON serialization
        function normalizeValue(value) {
            if (typeof value === 'bigint') {
                return Number(value);
            }
            return value;
        }
        const rs = await tx.execute({ sql, args: params });
        return {
            lastID: normalizeValue(rs.lastInsertRowid),
            changes: rs.rowsAffected,
        };
    };

    try {
        const directory = await unzipper.Open.file(req.file.path);

        const loadJson = async (filename) => {
            const file = directory.files.find(d => d.path === filename);
            if (!file) return [];
            const buffer = await file.buffer();
            return JSON.parse(buffer.toString());
        };

        const companies = await loadJson('data/companies.json');
        if (companies.length === 0) throw new Error('No company data found in backup');

        const accounts = await loadJson('data/accounts.json');
        const transactions = await loadJson('data/transactions.json');
        const transaction_entries = await loadJson('data/transaction_entries.json');
        const ufv_rates = await loadJson('data/ufv_rates.json');
        const exchange_rates = await loadJson('data/exchange_rates.json');
        const mahoraga_events = await loadJson('data/mahoraga_adaptation_events.json');
        const profiles = await loadJson('data/company_adjustment_profiles.json');

        let NEW_COMPANY_ID;

        // Use the driver's native transaction handling
        await db.transaction(async (tx) => {
            const sourceCompany = companies[0];

            const insertCompSql = `
                INSERT INTO companies (
                    name, nit, legal_name, address, city, country, phone, email, website, 
                    logo_url, fiscal_year_start, currency
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            const compResult = await txRun(tx, insertCompSql, [
                sourceCompany.name + " (Restaurado)",
                sourceCompany.nit,
                sourceCompany.legal_name,
                sourceCompany.address,
                sourceCompany.city,
                sourceCompany.country,
                sourceCompany.phone,
                sourceCompany.email,
                sourceCompany.website,
                sourceCompany.logo_url,
                sourceCompany.fiscal_year_start,
                sourceCompany.currency
            ]);
            NEW_COMPANY_ID = compResult.lastID;

            const accountIdMap = new Map();
            for (const acc of accounts) {
                const accRes = await txRun(tx,
                    `INSERT INTO accounts (company_id, code, name, type, level, parent_code) VALUES (?, ?, ?, ?, ?, ?)`,
                    [NEW_COMPANY_ID, acc.code, acc.name, acc.type, acc.level, acc.parent_code]
                );
                accountIdMap.set(acc.id, accRes.lastID);
            }

            for (const transaction of transactions) {
                const txRes = await txRun(tx,
                    `INSERT INTO transactions (company_id, date, gloss, type, created_at) VALUES (?, ?, ?, ?, ?)`,
                    [NEW_COMPANY_ID, transaction.date, transaction.gloss, transaction.type, transaction.created_at]
                );
                const NEW_TX_ID = txRes.lastID;

                const entries = transaction_entries.filter(e => e.transaction_id === transaction.id);
                for (const entry of entries) {
                    const newAccId = accountIdMap.get(entry.account_id);
                    if (!newAccId) continue;
                    await txRun(tx,
                        `INSERT INTO transaction_entries (transaction_id, account_id, debit, credit, gloss) VALUES (?, ?, ?, ?, ?)`,
                        [NEW_TX_ID, newAccId, entry.debit, entry.credit, entry.gloss]
                    );
                }
            }

            for (const rate of ufv_rates) {
                await txRun(tx, `INSERT OR IGNORE INTO ufv_rates (date, value) VALUES (?, ?)`,
                    [rate.date, rate.value]);
            }
            for (const rate of exchange_rates) {
                if (rate.currency === 'USD') {
                    await txRun(tx, `INSERT OR IGNORE INTO exchange_rates (date, usd_buy, usd_sell) VALUES (?, ?, ?)`,
                        [rate.date, rate.buy_rate, rate.sell_rate]);
                }
            }

            for (const profile of profiles) {
                await txRun(tx, `INSERT OR IGNORE INTO company_adjustment_profiles (company_id, profile_json, version) VALUES (?, ?, ?)`,
                    [NEW_COMPANY_ID, profile.profile_json, profile.version]);
            }
            for (const event of mahoraga_events) {
                await txRun(tx, `INSERT OR IGNORE INTO mahoraga_adaptation_events (id, company_id, user, origin_trans, account_code, account_name, action, event_data, timestamp, reverted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [event.id, NEW_COMPANY_ID, event.user, event.origin_trans, event.account_code, event.account_name, event.action, event.event_data, event.timestamp, event.reverted]);
            }
        });

        // If transaction was successful, proceed
        try {
            await axios.post('http://localhost:3001/api/ai/reload-profiles', { companyId: NEW_COMPANY_ID }).catch(e => console.log('AI reload signal skip/fail'));
        } catch (aiErr) {
            console.warn('Could not signal AI engine:', aiErr.message);
        }

        await fs.remove(req.file.path);
        res.json({ success: true, message: 'Restore completed successfully', newCompanyId: NEW_COMPANY_ID });

    } catch (err) {
        console.error('Import error:', err);
        if (req.file) await fs.remove(req.file.path);
        res.status(500).json({ error: 'Import failed: ' + err.message });
    }
});

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

module.exports = router;
