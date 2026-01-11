/**
 * AccountPlanIntelligence.js
 * Server-side port of AccountPlanProfile for deep structural analysis.
 * Mirrors the logic from web-app/client/src/utils/AccountPlanProfile.js
 */

class AccountPlanIntelligence {
    /**
     * Comprehensive analysis of a set of account codes.
     */
    static analyze(accounts) {
        if (!accounts || accounts.length === 0) return this.getDefaultProfile();
        const allCodes = accounts.map(a => String(a.code)).filter(c => c.trim() !== '');

        // Use a sample for analysis to keep it fast
        const sample = allCodes.length > 500 ? allCodes.slice(0, 500) : allCodes;

        const separator = this.detectSeparator(sample);
        const segments = this.analyzeSegments(sample, separator);

        const behavior = {
            strictlyNumerical: allCodes.every(c => /^[0-9.\- ]+$/.test(c))
        };

        const analysis = {
            separator,
            segments,
            hasSeparator: !!separator,
            behavior,
            samples: sample,
            accountMap: new Map(accounts.map(a => [String(a.code), a]))
        };

        // Generate the final config profile used for calculations
        const config = this.toConfigFromAnalysis(analysis);

        return {
            ...analysis,
            ...config,
            // Re-bind helpers for convenience (mirrors frontend)
            calculateLevel: (code) => this.calculateLevel(code, config),
            getParent: (code) => this.calculateParent(code, config),
            guessType: (code) => this.heuristicTypeGuess(code)
        };
    }

    static detectSeparator(sample) {
        const counts = { '.': 0, '-': 0, ' ': 0, '/': 0 };
        sample.forEach(code => {
            for (const char in counts) {
                if (code.includes(char)) counts[char]++;
            }
        });

        let bestSep = null;
        let maxCount = 0;
        for (const sep in counts) {
            if (counts[sep] > maxCount && counts[sep] > sample.length * 0.3) {
                maxCount = counts[sep];
                bestSep = sep;
            }
        }
        return bestSep;
    }

    static analyzeSegments(sample, separator) {
        const segmentsByLevel = [];
        sample.forEach(code => {
            let parts = separator ? code.split(separator) : [code];
            parts.forEach((part, index) => {
                if (!segmentsByLevel[index]) segmentsByLevel[index] = { lengths: [], isNumeric: true };
                segmentsByLevel[index].lengths.push(part.length);
                if (!/^\d+$/.test(part)) segmentsByLevel[index].isNumeric = false;
            });
        });

        return segmentsByLevel.map(s => {
            const lenCounts = {};
            s.lengths.forEach(l => lenCounts[l] = (lenCounts[l] || 0) + 1);
            let modeLen = 0, maxCount = 0;
            Object.entries(lenCounts).forEach(([l, c]) => {
                if (c > maxCount) { maxCount = c; modeLen = Number(l); }
            });

            return {
                avgLength: modeLen || 0,
                isNumeric: s.isNumeric
            };
        });
    }

    /**
     * Internal depth logic (e.g., "100" -> 1, "110" -> 2, "111" -> 3)
     */
    static _getSegmentDepth(seg) {
        if (!seg || !/^\d+$/.test(seg)) return 1;
        const len = seg.length;
        if (len < 3) return 1;
        let zeros = 0;
        for (let i = len - 1; i >= 0; i--) {
            if (seg[i] === '0') zeros++;
            else break;
        }
        return Math.max(1, len - zeros);
    }

    static hasContent(val) {
        if (!val) return false;
        const s = String(val).trim();
        return s !== '' && !/^[0.\-\s]+$/.test(s);
    }

    /**
     * Core Hierarchical Engine: Determines the level of a code.
     */
    static calculateLevel(code, config = {}) {
        if (!code) return 1;
        const c = String(code).trim();

        if (config.smartPUCT && /^\d+$/.test(c)) {
            let depth = 0;
            for (let i = 0; i < c.length; i++) {
                if (c[i] !== '0') depth++; else break;
            }
            return Math.max(1, depth);
        }

        const sep = config.separator || '.';
        const hasSep = c.includes(sep);

        if (config.hasSeparator && hasSep) {
            const parts = c.split(sep);
            let baseLevel = this._getSegmentDepth(parts[0]);
            const isDeepPlan = (parts[0] || '').length >= 3;

            let extraLevels = 0;
            for (let i = 1; i < parts.length; i++) {
                const p = parts[i];
                if (this.hasContent(p)) {
                    if (isDeepPlan && p.length === 1) continue;
                    extraLevels++;
                }
            }
            return Math.max(1, baseLevel + extraLevels);
        }

        const len = c.length;
        const levels = config.levelLengths || [];
        if (levels.length === 0) return 1;

        if (len <= levels[0]) return this._getSegmentDepth(c);

        const firstBlockLen = levels[0];
        const firstBlock = c.substring(0, firstBlockLen);
        const baseInternalDepth = this._getSegmentDepth(firstBlock);

        let extraBlocks = 0;
        for (let i = 1; i < levels.length; i++) {
            if (len > levels[i - 1]) extraBlocks++;
        }
        return Math.max(1, baseInternalDepth + extraBlocks);
    }

    /**
     * Determines the parent code.
     */
    static calculateParent(code, config = {}) {
        if (!code) return null;
        const level = this.calculateLevel(code, config);
        if (level <= 1) return null;

        const c = String(code).trim();
        const sep = config.separator || '.';
        const hasSep = c.includes(sep);

        if (config.hasSeparator && hasSep) {
            const parts = c.split(sep);
            const isDeepPlan = (parts[0] || '').length >= 3;

            const activeIndices = [];
            parts.forEach((p, i) => {
                if (this.hasContent(p)) {
                    if (!(isDeepPlan && p.length === 1 && i > 0)) activeIndices.push(i);
                }
            });

            if (activeIndices.length > 1) {
                const parentLastActiveIndex = activeIndices[activeIndices.length - 2];
                return parts.slice(0, parentLastActiveIndex + 1).join(sep);
            }

            if (activeIndices.length <= 1) {
                const firstPart = parts[0];
                const depth = this._getSegmentDepth(firstPart);
                if (depth > 1) {
                    const parentPrefix = firstPart.substring(0, depth - 1);
                    return parentPrefix.padEnd(firstPart.length, '0') + (parts.length > 1 ? sep + parts.slice(1).map(p => '0'.repeat(p.length)).join(sep) : '');
                }
            }
            return null;
        }

        const levels = config.levelLengths || [];
        if (levels.length >= level - 1 && level > 1) {
            const parentLen = levels[level - 2];
            let parentCode = c.substring(0, parentLen);
            const maxLen = levels[levels.length - 1];
            if (!config.hasSeparator && c.length === maxLen) parentCode = parentCode.padEnd(maxLen, '0');
            return parentCode;
        }

        return null;
    }

    static heuristicTypeGuess(code) {
        const mapping = { '1': 'Activo', '2': 'Pasivo', '3': 'Patrimonio', '4': 'Ingreso', '5': 'Gasto', '6': 'Costo' };
        return mapping[code[0]] || 'Activo';
    }

    static toConfigFromAnalysis(analysis) {
        const segments = analysis.segments || [];
        const levelLengths = [];
        let accum = 0;
        const isDeepPlan = segments[0] && segments[0].avgLength >= 3;

        segments.forEach((s, idx) => {
            if (idx === 0 && isDeepPlan) {
                for (let i = 0; i < s.avgLength; i++) levelLengths.push(s.avgLength);
                accum = s.avgLength;
            } else if (!(isDeepPlan && s.avgLength === 1)) {
                accum += s.avgLength;
                levelLengths.push(accum);
            } else {
                accum += s.avgLength;
            }
        });

        const cfg = {
            hasSeparator: !!analysis.separator,
            separator: analysis.separator || '.',
            levelCount: levelLengths.length,
            levelLengths,
            smartPUCT: segments[0] && segments[0].avgLength >= 8 && analysis.behavior.strictlyNumerical
        };
        return cfg;
    }

    static getDefaultProfile() {
        return {
            separator: '.',
            hasSeparator: true,
            levelCount: 4,
            levelLengths: [1, 2, 4, 7]
        };
    }

    // Helper to keep the existing getParent call signature working
    static getParent(code, profile) {
        return this.calculateParent(code, profile);
    }
}

module.exports = AccountPlanIntelligence;
