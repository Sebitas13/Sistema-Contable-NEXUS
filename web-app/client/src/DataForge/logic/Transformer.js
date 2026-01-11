
/**
 * Transformer.js
 * Engine for applying transformations to data.
 */

export class Transformer {
    /**
     * Apply a list of transformations to the dataset
     * @param {Array} data - Original data rows
     * @param {Array} transformations - List of transformation objects
     * @returns {Array} Transformed data
     */
    static apply(data, transformations) {
        if (!transformations || transformations.length === 0) return data;

        let result = [...data];

        transformations.forEach(transform => {
            switch (transform.type) {
                case 'SPLIT':
                    result = this.split(result, transform.params);
                    break;
                case 'JOIN':
                    result = this.join(result, transform.params);
                    break;
                case 'RENAME':
                    result = this.rename(result, transform.params);
                    break;
                case 'FILTER':
                    result = this.filter(result, transform.params);
                    break;
                case 'EXPAND_ROWS':
                    result = this.expandRows(result, transform.params);
                    break;
                case 'SPLIT_ROWS':
                    result = this.splitRows(result, transform.params);
                    break;
                case 'MERGE_ROWS':
                    result = this.mergeRows(result, transform.params);
                    break;
                case 'REMOVE_DUPLICATES':
                    result = this.removeDuplicates(result, transform.params);
                    break;
                case 'SORT':
                    result = this.sort(result, transform.params);
                    break;
                default:
                    console.warn(`Unknown transformation type: ${transform.type}`);
            }
        });

        return result;
    }

    /**
     * Split a column into multiple columns based on a delimiter
     * params: { column: string, separator: string, newNames: string[] }
     */
    static split(data, params) {
        const { column, separator, newNames } = params;

        return data.map(row => {
            const val = String(row[column] || '');
            const parts = val.split(separator);

            const newRow = { ...row };

            newNames.forEach((name, index) => {
                newRow[name] = parts[index] || '';
            });

            return newRow;
        });
    }

    /**
     * Join multiple columns into one
     * params: { columns: string[], separator: string, newName: string }
     */
    static join(data, params) {
        const { columns, separator, newName } = params;

        return data.map(row => {
            const values = columns.map(col => row[col] || '');
            const joined = values.join(separator);

            return {
                ...row,
                [newName]: joined
            };
        });
    }

    /**
     * Rename a column
     * params: { oldName: string, newName: string }
     */
    static rename(data, params) {
        const { oldName, newName } = params;

        return data.map(row => {
            const val = row[oldName];
            const newRow = { ...row };
            delete newRow[oldName];
            newRow[newName] = val;
            return newRow;
        });
    }

    /**
     * Filter rows based on a condition
     * params: { column: string, operator: 'equals'|'contains'|'starts_with', value: any }
     */
    static filter(data, params) {
        const { column, operator, value } = params;

        return data.filter(row => {
            const val = String(row[column] || '').toLowerCase();
            const target = String(value).toLowerCase();

            switch (operator) {
                case 'equals': return val === target;
                case 'contains': return val.includes(target);
                case 'starts_with': return val.startsWith(target);
                default: return true;
            }
        });
    }

    /**
     * Expand rows: Split cell content with multiple values into multiple rows
     * params: { column: string, separator: string }
     * Example: "A, B, C" -> 3 rows with "A", "B", "C"
     */
    static expandRows(data, params) {
        const { column, separator = ',' } = params;
        const result = [];

        data.forEach(row => {
            const val = String(row[column] || '');
            const parts = val.split(separator).map(p => p.trim()).filter(p => p);

            if (parts.length > 1) {
                parts.forEach(part => {
                    result.push({
                        ...row,
                        [column]: part
                    });
                });
            } else {
                result.push(row);
            }
        });

        return result;
    }

    /**
     * Split rows: Filter out rows matching a split value
     * params: { column: string, splitValue: string }
     */
    static splitRows(data, params) {
        const { column, splitValue } = params;
        return data.filter(row => {
            const val = String(row[column] || '');
            return val !== splitValue;
        });
    }

    /**
     * Merge rows: Combine rows with the same key
     * params: { keyColumn: string, mergeColumn: string, separator: string }
     */
    static mergeRows(data, params) {
        const { keyColumn, mergeColumn, separator = ', ' } = params;
        const merged = [];
        const lookup = new Map();

        data.forEach(row => {
            const key = row[keyColumn];

            if (lookup.has(key)) {
                const existing = lookup.get(key);
                existing[mergeColumn] = existing[mergeColumn] + separator + row[mergeColumn];
            } else {
                const newRow = { ...row };
                lookup.set(key, newRow);
                merged.push(newRow);
            }
        });

        return merged;
    }

    /**
     * Remove duplicate rows based on specified columns
     * params: { columns: string[] }
     */
    static removeDuplicates(data, params) {
        const { columns } = params;
        const seen = new Set();

        return data.filter(row => {
            const key = columns.map(col => row[col]).join('|');
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    /**
     * Sort rows by column
     * params: { column: string, direction: 'asc'|'desc' }
     */
    static sort(data, params) {
        const { column, direction = 'asc' } = params;

        return [...data].sort((a, b) => {
            const valA = a[column];
            const valB = b[column];

            const numA = Number(valA);
            const numB = Number(valB);
            if (!isNaN(numA) && !isNaN(numB)) {
                return direction === 'asc' ? numA - numB : numB - numA;
            }

            const strA = String(valA).toLowerCase();
            const strB = String(valB).toLowerCase();
            if (direction === 'asc') {
                return strA < strB ? -1 : strA > strB ? 1 : 0;
            } else {
                return strA > strB ? -1 : strA < strB ? 1 : 0;
            }
        });
    }

    /**
     * Merge multiple sheets into single dataset
     * params: { sheets: Array<{data: Array, name: string}> }
     */
    static mergeSheets(sheets, params) {
        if (!sheets || sheets.length === 0) return [];

        const merged = [];

        sheets.forEach(sheet => {
            const headers = sheet.data[0] || [];
            const rows = sheet.data.slice(1);

            rows.forEach(row => {
                const obj = {};
                headers.forEach((h, i) => {
                    obj[h] = row[i];
                });
                obj['_sheet'] = sheet.name;
                merged.push(obj);
            });
        });

        return merged;
    }
}
