const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'db', 'accounting.db');

console.log('🔄 Starting database migration for multi-company support...\n');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
        process.exit(1);
    }
    console.log('✅ Connected to database\n');
});

// Migration steps
const migrations = [
    {
        name: 'Create companies table',
        sql: `
            CREATE TABLE IF NOT EXISTS companies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                nit TEXT UNIQUE,
                legal_name TEXT,
                address TEXT,
                city TEXT,
                country TEXT DEFAULT 'Bolivia',
                phone TEXT,
                email TEXT,
                website TEXT,
                logo_url TEXT,
                fiscal_year_start TEXT DEFAULT '01-01',
                operation_start_date TEXT,
                currency TEXT DEFAULT 'BOB',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `
    },
    {
        name: 'Insert default company',
        sql: `
            INSERT OR IGNORE INTO companies (id, name, nit, legal_name, address, city, country)
            VALUES (1, 'Mi Empresa', '000000000', 'Mi Empresa S.A.', 'Dirección Principal', 'La Paz', 'Bolivia');
        `
    },
    {
        name: 'Check if accounts table needs migration',
        check: true,
        sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts';`,
        migrate: (result) => {
            if (result && !result.sql.includes('company_id')) {
                console.log('   → Accounts table needs migration');
                return true;
            }
            console.log('   → Accounts table already migrated');
            return false;
        }
    },
    {
        name: 'Backup and recreate accounts table with company_id',
        conditional: true,
        steps: [
            `ALTER TABLE accounts RENAME TO accounts_old;`,
            `CREATE TABLE accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER NOT NULL DEFAULT 1,
                code TEXT NOT NULL,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                level INTEGER NOT NULL,
                parent_code TEXT,
                FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
                UNIQUE(company_id, code)
            );`,
            `INSERT INTO accounts (id, company_id, code, name, type, level, parent_code)
             SELECT id, 1, code, name, type, level, parent_code FROM accounts_old;`,
            `DROP TABLE accounts_old;`
        ]
    },
    {
        name: 'Check if transactions table needs migration',
        check: true,
        sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions';`,
        migrate: (result) => {
            if (result && !result.sql.includes('company_id')) {
                console.log('   → Transactions table needs migration');
                return true;
            }
            console.log('   → Transactions table already migrated');
            return false;
        }
    },
    {
        name: 'Backup and recreate transactions table with company_id',
        conditional: true,
        steps: [
            `ALTER TABLE transactions RENAME TO transactions_old;`,
            `CREATE TABLE transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER NOT NULL DEFAULT 1,
                date TEXT NOT NULL,
                gloss TEXT NOT NULL,
                type TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
            );`,
            `INSERT INTO transactions (id, company_id, date, gloss, type, created_at)
             SELECT id, 1, date, gloss, type, created_at FROM transactions_old;`,
            `DROP TABLE transactions_old;`
        ]
    },
    {
        name: 'Check if inventory_items table needs migration',
        check: true,
        sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name='inventory_items';`,
        migrate: (result) => {
            if (result && !result.sql.includes('company_id')) {
                console.log('   → Inventory items table needs migration');
                return true;
            }
            console.log('   → Inventory items table already migrated');
            return false;
        }
    },
    {
        name: 'Backup and recreate inventory_items table with company_id',
        conditional: true,
        steps: [
            `ALTER TABLE inventory_items RENAME TO inventory_items_old;`,
            `CREATE TABLE inventory_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER NOT NULL DEFAULT 1,
                code TEXT NOT NULL,
                name TEXT NOT NULL,
                unit TEXT NOT NULL,
                balance_quantity REAL DEFAULT 0,
                balance_cost REAL DEFAULT 0,
                FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
                UNIQUE(company_id, code)
            );`,
            `INSERT INTO inventory_items (id, company_id, code, name, unit, balance_quantity, balance_cost)
             SELECT id, 1, code, name, unit, balance_quantity, balance_cost FROM inventory_items_old;`,
            `DROP TABLE inventory_items_old;`
        ]
    },
    {
        name: 'Create indexes for better performance',
        sql: `
            CREATE INDEX IF NOT EXISTS idx_accounts_company ON accounts(company_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_company ON transactions(company_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
            CREATE INDEX IF NOT EXISTS idx_inventory_company ON inventory_items(company_id);
        `
    },
    {
        name: 'Create mahoraga_adaptation_events table',
        sql: `
            CREATE TABLE IF NOT EXISTS mahoraga_adaptation_events (
                id TEXT PRIMARY KEY,
                company_id INTEGER NOT NULL,
                user TEXT,
                origin_trans TEXT,
                account_code TEXT,
                account_name TEXT,
                action TEXT,
                event_data TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                reverted INTEGER DEFAULT 0,
                FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
            );
        `
    },
    {
        name: 'Create company_adjustment_profiles table',
        sql: `
            CREATE TABLE IF NOT EXISTS company_adjustment_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER UNIQUE NOT NULL,
                profile_json TEXT NOT NULL,
                version INTEGER DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
            );
        `
    }
];

let shouldMigrate = {};

async function runMigration() {
    for (const migration of migrations) {
        if (migration.check) {
            // Check if migration is needed
            await new Promise((resolve, reject) => {
                db.get(migration.sql, [], (err, row) => {
                    if (err) {
                        console.error(`❌ Error checking ${migration.name}:`, err);
                        reject(err);
                        return;
                    }
                    if (migration.migrate) {
                        shouldMigrate[migration.name] = migration.migrate(row);
                    }
                    resolve();
                });
            });
        } else if (migration.conditional) {
            // Skip if previous check said not needed
            const checkKey = migrations[migrations.indexOf(migration) - 1].name;
            if (!shouldMigrate[checkKey]) {
                console.log(`⏭️  Skipping: ${migration.name}`);
                continue;
            }

            console.log(`🔧 Running: ${migration.name}`);
            for (const step of migration.steps) {
                await new Promise((resolve, reject) => {
                    db.run(step, [], (err) => {
                        if (err) {
                            console.error(`   ❌ Error:`, err);
                            reject(err);
                            return;
                        }
                        resolve();
                    });
                });
            }
            console.log(`   ✅ Complete`);
        } else {
            // Regular migration
            console.log(`🔧 Running: ${migration.name}`);
            await new Promise((resolve, reject) => {
                db.run(migration.sql, [], (err) => {
                    if (err && !err.message.includes('already exists')) {
                        console.error(`   ❌ Error:`, err);
                        reject(err);
                        return;
                    }
                    console.log(`   ✅ Complete`);
                    resolve();
                });
            });
        }
    }

    // Verify migration
    console.log('\n📊 Verifying migration...');
    db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, tables) => {
        if (err) {
            console.error('❌ Error verifying tables:', err);
            process.exit(1);
        }

        console.log('\n✅ Database tables:');
        tables.forEach(table => {
            console.log(`   - ${table.name}`);
        });

        db.get('SELECT COUNT(*) as count FROM companies', [], (err, row) => {
            if (err) {
                console.error('❌ Error counting companies:', err);
            } else {
                console.log(`\n💼 Companies in database: ${row.count}`);
            }

            console.log('\n✨ Migration completed successfully!');
            console.log('🚀 Please restart your server to apply changes.\n');
            db.close();
        });
    });
}

runMigration().catch(err => {
    console.error('\n❌ Migration failed:', err);
    db.close();
    process.exit(1);
});
