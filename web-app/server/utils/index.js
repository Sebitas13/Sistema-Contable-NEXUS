/**
 * Centralized Utilities Integration
 * Exports all utility modules for easy importing
 */

const dataCleaner = require('./dataCleaner');
const keepAlive = require('./keepAlive');
const corsConfig = require('./corsConfig');
const connectionManager = require('./connectionManager');
const jsonSerializer = require('./jsonSerializer');

module.exports = {
    // Data cleaning utilities
    ...dataCleaner,
    
    // Keep-alive service
    keepAlive,
    
    // CORS configuration
    ...corsConfig,
    
    // Connection management
    connectionManager,
    
    // JSON serialization
    ...jsonSerializer
};
