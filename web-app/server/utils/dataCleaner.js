/**
 * Data Cleaning Utilities for LibSQL/SQLite Compatibility
 * Ensures type safety and prevents undefined values
 */

/**
 * Clean object values before sending to database
 * @param {Object} obj - Object to clean
 * @returns {Object} - Cleaned object
 */
function cleanObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const cleaned = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            
            // Convert undefined to null
            if (value === undefined) {
                cleaned[key] = null;
            }
            // Ensure numeric values are actually numbers
            else if (typeof value === 'string' && !isNaN(value) && value !== '') {
                cleaned[key] = parseFloat(value);
            }
            // Ensure dates are properly formatted
            else if (key.includes('date') && typeof value === 'string') {
                cleaned[key] = value.trim();
            }
            else {
                cleaned[key] = value;
            }
        }
    }
    return cleaned;
}

/**
 * Clean array of objects for batch operations
 * @param {Array} arr - Array to clean
 * @returns {Array} - Cleaned array
 */
function cleanArray(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr.map(item => cleanObject(item));
}

/**
 * Validate and convert UFV values
 * @param {any} value - Value to validate
 * @returns {number|null} - Validated number or null
 */
function validateUFVValue(value) {
    if (value === null || value === undefined || value === '') return null;
    
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return null;
    
    return num;
}

/**
 * Validate and convert monetary amounts
 * @param {any} value - Value to validate
 * @returns {number|null} - Validated number or null
 */
function validateMonetaryValue(value) {
    if (value === null || value === undefined || value === '') return null;
    
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return null;
    
    // Round to 2 decimal places for monetary values
    return Math.round(num * 100) / 100;
}

/**
 * Ensure proper date format for database
 * @param {string|Date} date - Date to format
 * @returns {string|null} - Formatted date string
 */
function formatDateForDB(date) {
    if (!date) return null;
    
    if (date instanceof Date) {
        return date.toISOString().split('T')[0]; // YYYY-MM-DD
    }
    
    if (typeof date === 'string') {
        // Already formatted, just clean it
        return date.trim();
    }
    
    return null;
}

module.exports = {
    cleanObject,
    cleanArray,
    validateUFVValue,
    validateMonetaryValue,
    formatDateForDB
};
