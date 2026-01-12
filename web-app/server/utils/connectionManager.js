/**
 * Connection Manager for LibSQL/Turso
 * Integrates with existing db.js to avoid conflicts
 * Uses the existing client instead of creating new connections
 */

// Import existing database client from db.js
const existingDb = require('../db');

class ConnectionManager {
    constructor() {
        this.client = null;
        this.isInitialized = false;
        this.connectionPool = [];
        this.maxPoolSize = 10;
        this.activeConnections = 0;
    }

    /**
     * Initialize database connection (uses existing db.js client)
     */
    async initialize() {
        if (this.isInitialized) {
            return this.client;
        }

        try {
            // Use existing client from db.js instead of creating new one
            this.client = existingDb;
            this.isInitialized = true;
            
            console.log('✅ Connection Manager initialized using existing db.js client');
            return this.client;
            
        } catch (error) {
            console.error('❌ Failed to initialize Connection Manager:', error.message);
            throw error;
        }
    }

    /**
     * Get database client (returns existing db.js client)
     */
    async getClient() {
        if (!this.isInitialized) {
            await this.initialize();
        }
        return this.client;
    }

    /**
     * Execute batch operations efficiently
     * @param {Array} operations - Array of SQL operations
     * @returns {Promise<Array>} - Results
     */
    async executeBatch(operations) {
        const client = await this.getClient();
        const results = [];
        
        try {
            // Start transaction using existing client
            await new Promise((resolve, reject) => {
                client.run('BEGIN TRANSACTION', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            // Execute all operations using existing client
            for (const operation of operations) {
                const { sql, params = [] } = operation;
                
                const result = await new Promise((resolve, reject) => {
                    client.run(sql, params, function(err) {
                        if (err) reject(err);
                        else resolve({ lastID: this.lastID, changes: this.changes });
                    });
                });
                
                results.push(result);
            }
            
            // Commit transaction using existing client
            await new Promise((resolve, reject) => {
                client.run('COMMIT', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            console.log(`✅ Batch executed: ${operations.length} operations`);
            return results;
            
        } catch (error) {
            // Rollback on error using existing client
            try {
                await new Promise((resolve, reject) => {
                    client.run('ROLLBACK', (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                console.error('❌ Batch failed, rolled back:', error.message);
            } catch (rollbackError) {
                console.error('❌ Rollback failed:', rollbackError.message);
            }
            
            throw error;
        }
    }

    /**
     * Execute multiple queries in parallel (when possible)
     * @param {Array} queries - Array of query objects
     * @returns {Promise<Array>} - Results
     */
    async executeParallel(queries) {
        const client = await this.getClient();
        
        try {
            // Execute queries in parallel using existing client
            const promises = queries.map(async (query) => {
                const { sql, params = [] } = query;
                
                return await new Promise((resolve, reject) => {
                    client.all(sql, params, (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });
            });
            
            const results = await Promise.all(promises);
            
            console.log(`✅ Parallel execution: ${queries.length} queries`);
            return results;
            
        } catch (error) {
            console.error('❌ Parallel execution failed:', error.message);
            throw error;
        }
    }

    /**
     * Monitor connection health
     */
    async healthCheck() {
        try {
            const client = await this.getClient();
            
            await new Promise((resolve, reject) => {
                client.get('SELECT 1', [1], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            return { status: 'healthy', timestamp: new Date().toISOString() };
        } catch (error) {
            return { 
                status: 'unhealthy', 
                error: error.message, 
                timestamp: new Date().toISOString() 
            };
        }
    }

    /**
     * Get connection statistics
     */
    getStats() {
        return {
            isInitialized: this.isInitialized,
            activeConnections: this.activeConnections,
            maxPoolSize: this.maxPoolSize,
            timestamp: new Date().toISOString(),
            note: 'Using existing db.js client'
        };
    }

    /**
     * Close all connections (no-op for existing client)
     */
    async close() {
        this.isInitialized = false;
        console.log('✅ Connection Manager closed (existing client managed by db.js)');
    }
}

// Singleton instance
const connectionManager = new ConnectionManager();

// Auto-initialize
connectionManager.initialize().catch(error => {
    console.error('❌ Failed to auto-initialize connection manager:', error);
});

module.exports = connectionManager;
