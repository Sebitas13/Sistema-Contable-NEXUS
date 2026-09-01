const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
// Carga .env del propio server (TURSO_*, AI_ENGINE_URL) y luego el de la raíz
// (GROQ_API_KEY, LLM_*, MAHORAGA_MODE). dotenv no sobrescribe variables ya
// definidas, así que encadenar ambos es seguro y permite arrancar el server
// desde cualquier directorio de trabajo.
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config();


const tursoUrl = process.env.TURSO_DATABASE_URL;
let tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl || !tursoAuthToken) {
    throw new Error('FATAL: Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in environment variables.');
}

// The @libsql/client expects the token WITHOUT the "Bearer " prefix.
// Defensively and case-insensitively remove it if it's present, and trim whitespace.
tursoAuthToken = String(tursoAuthToken).replace(/^bearer\s+/i, '').trim();

const client = createClient({
    url: tursoUrl,
    authToken: tursoAuthToken,
});

// Helper to convert BigInt to Number for JSON serialization
function normalizeValue(value) {
    if (typeof value === 'bigint') {
        return Number(value);
    }
    return value;
}

function normalizeRow(row) {
    if (!row || typeof row !== 'object') return row;
    const normalized = {};
    for (const key in row) {
        if (Object.prototype.hasOwnProperty.call(row, key)) {
            normalized[key] = normalizeValue(row[key]);
        }
    }
    return normalized;
}

// --- Promise-based Queue to serialize database operations ---
let queryQueue = Promise.resolve();

async function initializeSchema() {
    // Correctly resolve the path to schema.sql from the current file's directory
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');
    try {
        if (!fs.existsSync(schemaPath)) {
            console.warn(`WARN: Schema file not found at ${schemaPath}. Skipping initialization.`);
            return;
        }
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        // The libsql client's batch() method expects an array of strings.
        // We split the schema file by the semicolon, trim each statement,
        // and filter out any empty statements.
        const statements = schemaSql.split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0);

        if (statements.length === 0) {
            console.log('No statements found in schema.sql. Skipping initialization.');
            return;
        }

        // Use batch for non-interactive, multi-statement SQL execution.
        // We pass the array of statements. The 'write' mode is default and implicit for batch.
        await client.batch(statements);

        console.log('Database schema initialized successfully.');
    } catch (err) {
        console.error('FATAL: Error initializing database schema.', err);
        // Throwing here will prevent the app from starting, which is correct
        // if the database can't be prepared.
        throw err;
    }
}

// Migraciones idempotentes para DBs pre-existentes. Se ejecutan UNA POR UNA
// (nunca dentro del batch del schema: un ALTER fallido por columna duplicada
// haría fallar el batch completo y tumbaría el arranque).
async function runMigrations() {
    const columnMigrations = [
        ["inventory_movements", "gloss", "TEXT DEFAULT ''"],
        ["inventory_movements", "cost_center_id", "INTEGER"],
        ["inventory_movements", "production_order_id", "INTEGER"]
    ];

    for (const [table, column, definition] of columnMigrations) {
        try {
            await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
            console.log(`Migration applied: ${table}.${column}`);
        } catch (err) {
            const msg = String(err.message || '');
            if (!msg.toLowerCase().includes('duplicate column')) {
                console.warn(`Migration skipped (${table}.${column}):`, msg);
            }
        }
    }
}

// Add schema initialization + migrations to the queue. All other queries will wait for this.
queryQueue = queryQueue.then(initializeSchema).then(runMigrations);

// Wrapper to add a task to the serial queue
const enqueue = (task) => {
    return new Promise((resolve, reject) => {
        queryQueue = queryQueue.then(() => task().then(resolve, reject)).catch(() => { });
    });
};

const db = {
    on(event, callback) {
        if (event === 'open' && typeof callback === 'function') {
            // The database is "open" once the schema initialization promise resolves.
            // We chain the callback to the main query queue.
            queryQueue
                .then(() => {
                    process.nextTick(callback);
                })
                .catch(() => {
                    // If initialization fails, the server will likely crash anyway from the thrown error
                    // in initializeSchema, so we don't need to call the 'open' callback.
                });
        }
        // Return `this` for chaining compatibility, e.g., db.on(...).on(...)
        return this;
    },

    // A simple no-op since our queue handles serialization globally
    serialize(callback) {
        if (callback) {
            // The callback contains db calls that will be automatically enqueued
            callback();
        }
    },

    run(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        const task = async () => {
            const rs = await client.execute({ sql, args: params });
            const context = {
                lastID: normalizeValue(rs.lastInsertRowid),
                changes: rs.rowsAffected,
            };
            if (callback) process.nextTick(() => callback.call(context, null));
            return context;
        };

        enqueue(task).catch(err => {
            if (callback) process.nextTick(() => callback.call({ lastID: undefined, changes: 0 }, err));
        });

        return this; // For chaining
    },

    get(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        const task = async () => {
            const rs = await client.execute({ sql, args: params });
            const row = rs.rows.length > 0 ? normalizeRow(rs.rows[0]) : undefined;
            if (callback) process.nextTick(() => callback(null, row));
            return row;
        };

        enqueue(task).catch(err => {
            if (callback) process.nextTick(() => callback(err, null));
        });

        return this;
    },

    all(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        const task = async () => {
            const rs = await client.execute({ sql, args: params });
            const rows = rs.rows.map(normalizeRow);
            if (callback) process.nextTick(() => callback(null, rows));
            return rows;
        };

        enqueue(task).catch(err => {
            if (callback) process.nextTick(() => callback(err, null));
        });

        return this;
    },

    exec(sql, callback) {
        const task = async () => {
            await client.batch(sql, 'write');
            if (callback) process.nextTick(() => callback(null));
        };

        enqueue(task).catch(err => {
            if (callback) process.nextTick(() => callback(err));
        });

        return this;
    },

    prepare(sql, callback) {
        const stmt = {
            run: (...args) => {
                let runCallback;
                let runParams = [];

                if (args.length > 0) {
                    const lastArg = args[args.length - 1];
                    if (typeof lastArg === 'function') {
                        runCallback = lastArg;
                        runParams = args.slice(0, -1);
                    } else {
                        runParams = args;
                    }
                }

                // If params are passed as a single array
                if (runParams.length === 1 && Array.isArray(runParams[0])) {
                    runParams = runParams[0];
                }

                db.run(sql, runParams, runCallback);
                return stmt; // for chaining
            },
            finalize: (finalizeCallback) => {
                // With our model, finalize is a no-op for compatibility,
                // as each run is atomic. We call the callback asynchronously.
                if (finalizeCallback) {
                    process.nextTick(() => finalizeCallback(null));
                }
            }
        };

        if (callback) {
            process.nextTick(() => callback(null));
        }

        return stmt;
    },

    close(callback) {
        const task = async () => {
            client.close();
            if (callback) process.nextTick(() => callback(null));
        };
        enqueue(task).catch(err => {
            if (callback) process.nextTick(() => callback(err));
        });
    },

    // Transacción interactiva atómica del driver libSQL.
    // El callback recibe un objeto `tx` con su propio `.execute()`. Hace COMMIT al terminar
    // o ROLLBACK ante error, y DEVUELVE el valor del callback.
    // IMPORTANTE: client.transaction(mode) espera un MODO ('write'|'read'|'deferred'),
    // NO un callback. Por eso aquí abrimos la transacción y orquestamos commit/rollback a mano.
    async transaction(callback) {
        const tx = await client.transaction('write');
        try {
            const result = await callback(tx);
            await tx.commit();
            return result;
        } catch (error) {
            try {
                await tx.rollback();
            } catch (rollbackError) {
                console.warn('Rollback de transacción falló:', rollbackError.message);
            }
            throw error;
        }
    }
};

module.exports = db;
