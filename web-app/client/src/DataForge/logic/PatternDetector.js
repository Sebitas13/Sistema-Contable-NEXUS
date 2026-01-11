
/**
 * PatternDetector.js
 * Core logic for analyzing data structures in DataForge.
 */

export class PatternDetector {
    /**
     * Main analysis method
     * @param {Array} data - Array of objects or arrays representing the dataset
     * @param {Array} headers - Array of strings representing column headers
     */
    static analyze(data, headers) {
        console.log('PatternDetector analyzing...', data.length, 'rows');

        const analysis = {
            rowCount: data.length,
            columnCount: headers.length,
            columns: [],
            hierarchy: null,
            suggestions: []
        };

        // 1. Analyze each column
        headers.forEach((header, index) => {
            const colData = data.map(row => Array.isArray(row) ? row[index] : row[header]);
            const typeInfo = this.inferType(colData);

            analysis.columns.push({
                name: header,
                index: index,
                ...typeInfo
            });
        });

        // 2. Detect Hierarchy
        const hierarchyResult = this.detectHierarchy(data, analysis.columns);
        if (hierarchyResult) {
            analysis.hierarchy = hierarchyResult;
            analysis.suggestions.push({
                type: 'HIERARCHY_DETECTED',
                message: `Se detectó una jerarquía basada en la columna "${hierarchyResult.column}"`,
                details: hierarchyResult
            });
        }

        return analysis;
    }

    /**
     * Infers the data type of a column
     */
    static inferType(values) {
        let nonNullValues = values.filter(v => v !== null && v !== undefined && v !== '');
        if (nonNullValues.length === 0) return { type: 'empty', confidence: 1 };

        const sampleSize = Math.min(nonNullValues.length, 100);
        const sample = nonNullValues.slice(0, sampleSize);

        // Check for numeric
        const numericCount = sample.filter(v => !isNaN(Number(v))).length;
        if (numericCount / sampleSize > 0.9) {
            return { type: 'number', confidence: numericCount / sampleSize };
        }

        // Check for hierarchical code (e.g., 1.01.01 or 100-00)
        const codePattern = sample.filter(v => String(v).match(/^[\d\.\-]+$/)).length;
        if (codePattern / sampleSize > 0.9) {
            return { type: 'code', confidence: codePattern / sampleSize };
        }

        return { type: 'text', confidence: 1 };
    }

    /**
     * Attempts to find a hierarchical structure in the data
     */
    static detectHierarchy(data, columns) {
        // Look for "code" type columns
        const codeColumns = columns.filter(c => c.type === 'code' || c.name.toLowerCase().includes('cod'));

        for (const col of codeColumns) {
            // Check if this column looks like a tree (parent-child relationship)
            // Simple heuristic: check if some values are prefixes of others
            const values = data.map(row => String(Array.isArray(row) ? row[col.index] : row[col.name] || '').trim()).filter(v => v);
            const uniqueValues = [...new Set(values)].sort();

            let parentChildMatches = 0;
            const sampleSize = Math.min(uniqueValues.length, 50);

            for (let i = 0; i < sampleSize; i++) {
                const val = uniqueValues[i];
                // Check if this value is a parent of any other value
                if (uniqueValues.some(other => other !== val && other.startsWith(val))) {
                    parentChildMatches++;
                }
            }

            if (parentChildMatches > 0) {
                return {
                    column: col.name,
                    type: 'prefix-based', // 1, 1.1, 1.1.1
                    confidence: 0.8
                };
            }
        }

        return null;
    }
}
