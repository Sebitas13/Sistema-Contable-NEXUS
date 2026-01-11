const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
require('dotenv').config();

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl || !tursoAuthToken) {
    throw new Error('FATAL: Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in environment variables.');
}

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
        // Use batch for non-interactive, multi-statement SQL execution
        await client.batch(schemaSql, 'write');
        console.log('Database schema initialized successfully.');
    } catch (err) {
        console.error('FATAL: Error initializing database schema.', err);
        // Throwing here will prevent the app from starting, which is correct
        // if the database can't be prepared.
        throw err;
    }
}

// Add schema initialization to the queue. All other queries will wait for this.
queryQueue = queryQueue.then(initializeSchema);

// Wrapper to add a task to the serial queue
const enqueue = (task) => {
    return new Promise((resolve, reject) => {
        queryQueue = queryQueue.then(() => task().then(resolve, reject)).catch(() => {});
    });
};

const db = {
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
    }
};

module.exports = db;
