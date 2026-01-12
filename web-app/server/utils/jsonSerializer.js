/**
 * JSON Serialization Utilities for Backend Node ↔ Python Communication
 * Ensures consistent data formatting and prevents serialization errors
 */

class JSONSerializer {
    /**
     * Standardize date format for Python compatibility
     * @param {Date|string} date - Date to format
     * @returns {string} - ISO formatted date
     */
    static formatDate(date) {
        if (!date) return null;
        
        if (date instanceof Date) {
            // Use ISO format: YYYY-MM-DDTHH:mm:ss.sssZ
            return date.toISOString();
        }
        
        if (typeof date === 'string') {
            // Try to parse and reformat to ensure consistency
            const parsed = new Date(date);
            if (!isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }
        
        return date; // Return as-is if can't parse
    }

    /**
     * Sanitize numeric values for Python
     * @param {any} value - Value to sanitize
     * @returns {number|null} - Sanitized number
     */
    static sanitizeNumber(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        
        const num = Number(value);
        if (isNaN(num)) {
            return null;
        }
        
        return num;
    }

    /**
     * Sanitize monetary values (2 decimal places)
     * @param {any} value - Value to sanitize
     * @returns {number|null} - Sanitized monetary value
     */
    static sanitizeMonetary(value) {
        const num = this.sanitizeNumber(value);
        if (num === null) return null;
        
        // Round to 2 decimal places for accounting precision
        return Math.round(num * 100) / 100;
    }

    /**
     * Sanitize UFV values (inflation indices)
     * @param {any} value - UFV value to sanitize
     * @returns {number|null} - Sanitized UFV value
     */
    static sanitizeUFV(value) {
        const num = this.sanitizeNumber(value);
        if (num === null) return null;
        
        // UFV values typically have 4-6 decimal places
        return Math.round(num * 100000) / 100000;
    }

    /**
     * Prepare data for Python consumption
     * @param {Object} data - Data to prepare
     * @returns {Object} - Prepared data
     */
    static prepareForPython(data) {
        if (!data || typeof data !== 'object') {
            return data;
        }

        const prepared = {};
        
        for (const [key, value] of Object.entries(data)) {
            // Handle dates
            if (key.toLowerCase().includes('date') && value) {
                prepared[key] = this.formatDate(value);
            }
            // Handle monetary values
            else if (['amount', 'debit', 'credit', 'balance', 'rate'].includes(key.toLowerCase())) {
                prepared[key] = this.sanitizeMonetary(value);
            }
            // Handle UFV values
            else if (key.toLowerCase().includes('ufv')) {
                prepared[key] = this.sanitizeUFV(value);
            }
            // Handle regular numbers
            else if (typeof value === 'number' || (typeof value === 'string' && !isNaN(value))) {
                prepared[key] = this.sanitizeNumber(value);
            }
            // Handle arrays
            else if (Array.isArray(value)) {
                prepared[key] = value.map(item => 
                    typeof item === 'object' ? this.prepareForPython(item) : item
                );
            }
            // Handle nested objects
            else if (typeof value === 'object' && value !== null) {
                prepared[key] = this.prepareForPython(value);
            }
            else {
                prepared[key] = value;
            }
        }

        return prepared;
    }

    /**
     * Create standardized API response
     * @param {boolean} success - Operation success
     * @param {any} data - Response data
     * @param {string} message - Response message
     * @param {Object} error - Error details
     * @returns {Object} - Standardized response
     */
    static createResponse(success, data = null, message = '', error = null) {
        const response = {
            success,
            timestamp: new Date().toISOString(),
            message
        };

        if (data !== null) {
            response.data = this.prepareForPython(data);
        }

        if (error) {
            response.error = {
                code: error.code || 'UNKNOWN_ERROR',
                message: error.message || 'An unknown error occurred',
                details: error.details || null,
                timestamp: new Date().toISOString()
            };
        }

        return response;
    }

    /**
     * Safe JSON stringify with error handling
     * @param {any} obj - Object to stringify
     * @param {number} indent - Indentation spaces
     * @returns {string} - JSON string
     */
    static safeStringify(obj, indent = 2) {
        try {
            return JSON.stringify(obj, this.jsonReplacer, indent);
        } catch (error) {
            console.error('❌ JSON serialization error:', error.message);
            return JSON.stringify({
                error: 'JSON_SERIALIZATION_ERROR',
                message: 'Failed to serialize response data',
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * JSON replacer for handling special values
     */
    static jsonReplacer(key, value) {
        // Handle BigInt values
        if (typeof value === 'bigint') {
            return Number(value);
        }
        
        // Handle undefined values
        if (value === undefined) {
            return null;
        }
        
        // Handle functions
        if (typeof value === 'function') {
            return undefined;
        }
        
        return value;
    }
}

module.exports = JSONSerializer;
