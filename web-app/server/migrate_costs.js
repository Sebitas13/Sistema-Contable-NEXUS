/**
 * Migration Script: Cost & Analytic Accounting
 * Applies schema changes to the existing Turso/libsql database.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./db');

const migrate = async () => {
    console.log('🚀 Starting Cost Management migration...');

    const statements = [
        // 1. Update existing tables (using try/catch style via batch)
        "ALTER TABLE transaction_entries ADD COLUMN dimensions TEXT DEFAULT '{}'",
        "ALTER TABLE inventory_items ADD COLUMN item_type TEXT DEFAULT 'PT'",
        "ALTER TABLE inventory_items ADD COLUMN valuation_method TEXT DEFAULT 'CPP'",
        "ALTER TABLE inventory_items ADD COLUMN ias2_compliant INTEGER DEFAULT 1",
        "ALTER TABLE inventory_movements ADD COLUMN cost_center_id INTEGER",
        "ALTER TABLE inventory_movements ADD COLUMN production_order_id INTEGER",
        "ALTER TABLE inventory_movements ADD COLUMN gloss TEXT",

        // 2. Create new tables
        `CREATE TABLE IF NOT EXISTS cost_centers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            parent_id INTEGER,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT DEFAULT 'Analytic',
            is_active INTEGER DEFAULT 1,
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES cost_centers(id),
            UNIQUE(company_id, code)
        )`,
        `CREATE TABLE IF NOT EXISTS cost_distribution_models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            is_active INTEGER DEFAULT 1,
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS cost_distribution_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model_id INTEGER NOT NULL,
            cost_center_id INTEGER NOT NULL,
            percentage REAL NOT NULL,
            FOREIGN KEY (model_id) REFERENCES cost_distribution_models(id) ON DELETE CASCADE,
            FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id)
        )`,
        `CREATE TABLE IF NOT EXISTS production_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            product_id INTEGER NOT NULL,
            status TEXT DEFAULT 'OPEN',
            start_date TEXT,
            end_date TEXT,
            planned_quantity REAL,
            actual_quantity REAL,
            total_cost REAL DEFAULT 0,
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES inventory_items(id)
        )`,
        "CREATE INDEX IF NOT EXISTS idx_cost_centers_company ON cost_centers(company_id)",
        "CREATE INDEX IF NOT EXISTS idx_production_orders_company ON production_orders(company_id)"
    ];

    for (const sql of statements) {
        try {
            await new Promise((resolve, reject) => {
                db.run(sql, (err) => {
                    if (err) {
                        // Ignore errors like "duplicate column name" which are common in migrations
                        if (err.message.includes('duplicate column name') || err.message.includes('already exists')) {
                            console.log(`ℹ️ Skipping: ${sql.substring(0, 50)}... (Already applied)`);
                            resolve();
                        } else {
                            reject(err);
                        }
                    } else {
                        console.log(`✅ Success: ${sql.substring(0, 50)}...`);
                        resolve();
                    }
                });
            });
        } catch (error) {
            console.error(`❌ Error executing: ${sql}`);
            console.error(error.message);
        }
    }

    console.log('🏁 Migration finished.');
    process.exit(0);
};

migrate();
