/**
 * AccountPlanProfile.js
 * Advanced "Deep Pattern Analysis" engine for Accounting Chart of Accounts.
 * Features: Regex Synthesis, Behavioral Logic Detection, and Structural Masking.
 */

export class AccountPlanProfile {
    /**
     * Comprehensive analysis of a set of account codes.
     * @param {Object} config - Optional structure configuration
     * @returns {Object} Deep analysis profile
     */
    static analyze(accounts, config = {}) {
        if (!accounts || accounts.length === 0) return this.getDefaultProfile();

        const allCodes = accounts.map(a => String(a.code)).filter(c => c.trim() !== '');

        // Advanced Sampling Strategy: Capture structure from across the entire plan
        // This ensures we catch Level 1 accounts even if they are far apart.
        const maxSample = 600;
        let sample = [];

        if (allCodes.length <= maxSample) {
            sample = allCodes;
        } else {
            const head = allCodes.slice(0, 200); // Usually captures structure and early groups
            const tail = allCodes.slice(-100); // Captures last sub-accounts

            // Strategic Middle Sampling (Jump through the data)
            const mid = [];
            const remaining = allCodes.slice(200, -100);
            const step = Math.max(1, Math.floor(remaining.length / 300));
            for (let i = 0; i < remaining.length; i += step) {
                mid.push(remaining[i]);
                if (mid.length >= 300) break;
            }
            sample = [...head, ...mid, ...tail];
        }

        // 1. Structural Analysis
        const separator = this.detectSeparator(sample);
        const segmentStats = this.analyzeSegments(sample, separator);
        // Use DETECTED segments only for mask/regex (no config override here)
        const mask = this.generateMask(segmentStats, { separator });
        const regex = this.synthesizeRegex(segmentStats, { separator });

        // 2. Behavioral Analysis
        const behavior = this.detectBehavior(sample, separator);

        // Pass the FULL dataset for Level Insights if possible (it's just metadata analysis)
        // or at least a very large sample to capture Level 1 pattern across gaps.
        const levelInsights = this.generateLevelInsights(sample, separator, segmentStats, config);

        return {
            separator,
            mask,
            regex,
            behavior,
            levelInsights,
            samples: sample,
            levelsCount: levelInsights.length, // Use LOGICAL level count (expanded), not physical segments
            segments: segmentStats,
            // Helper to get parent based on detected structure
            getParent: (code) => this.calculateParent(code, {
                hasSeparator: !!separator,
                separator: separator || '.',
                segments: segmentStats,
                levelLengths: segmentStats.map((s, i) => segmentStats.slice(0, i + 1).reduce((acc, seg) => acc + (seg.avgLength || 0), 0)),
                levelCount: segmentStats.length
            }),
            // Helper to guess type (AI-Ready Heuristics)
            guessType: (code) => this.heuristicTypeGuess(code, behavior)
        };
    }

    static detectSeparator(sample) {
        const counts = { '.': 0, '-': 0, ' ': 0, '/': 0 };
        sample.forEach(code => {
            for (const char in counts) {
                if (code.includes(char)) counts[char]++;
            }
        });

        // Pick the most frequent separator if it appears in > 30% of sample
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
            let parts = separator ? code.split(separator) : this.splitByLength(code);
            // AUTO-TRIM: Clean parts to avoid " 09 " being seen as alphanumeric
            parts = parts.map(p => p.trim());

            parts.forEach((part, index) => {
                // Use ARRAYS to collect all data points for statistical reduction
                if (!segmentsByLevel[index]) segmentsByLevel[index] = { lengths: [], types: [], rawParts: [] };
                segmentsByLevel[index].lengths.push(part.length);
                segmentsByLevel[index].types.push(this.getCharType(part));
                segmentsByLevel[index].rawParts.push(part);
            });
        });

        // Robust Reduction using Statistics (Mode/Frequency) instead of Max/All
        // This prevents outliers (headers, bad OCR) from polluting the mask (e.g. ###.XXX instead of ###.##)
        return segmentsByLevel.map(s => {
            // 1. Determine Robust Length (Mode)
            const lenCounts = {};
            s.lengths.forEach(l => lenCounts[l] = (lenCounts[l] || 0) + 1);
            let modeLen = 0, maxLenCount = 0;
            Object.entries(lenCounts).forEach(([l, c]) => {
                if (c > maxLenCount) { maxLenCount = c; modeLen = Number(l); }
            });

            // 2. Determine Robust Type (>80% consensus)
            const typeCounts = { numeric: 0, alpha: 0, alphanumeric: 0 };
            s.types.forEach(t => typeCounts[t] = (typeCounts[t] || 0) + 1);
            const total = s.types.length;

            // Default to alphanumeric (mixed) unless strong consensus
            let dominantType = 'alphanumeric';
            if (typeCounts.numeric > total * 0.8) dominantType = 'numeric';
            else if (typeCounts.alpha > total * 0.8) dominantType = 'alpha';

            return {
                avgLength: modeLen || 0, // Use Mode as the "Representative Length" for mask/display
                maxLength: Math.max(...s.lengths), // Keep max for capacity if needed, but display Mode
                isNumeric: dominantType === 'numeric',
                isAlpha: dominantType === 'alpha',
                isAlphanumeric: dominantType === 'alphanumeric',
                rawParts: s.rawParts
            };
        });
    }

    static generateLevelInsights(sample, separator, segments, config = {}) {
        const insights = [];

        // Check for Deep Plan Structure (ASFI)
        // If first segment is physically >= 3 chars, we expand it.
        const firstSeg = segments[0];
        const isDeepPlan = firstSeg && (firstSeg.avgLength || 0) >= 3;

        let logicalLevelIndex = 0;

        // 1. Handle First Segment (Base)
        if (isDeepPlan) {
            const len = firstSeg.avgLength || 0;
            // Disable aggressive expansion for L1 unless explicitly requested or clearly incremental behavior is found?
            // User feedback: "detected 5 levels" is annoying for simple "100.01" plans.
            // If "100" is just a code, don't expand it to 1, 10, 100.
            // FIX: Only expand if we have strong signal or keep it collapsed by default.
            // Let's keep it collapsed (Standard L1) unless config.smartDeepPlan is true?
            // Or better: Expand only if we see intermediate levels in the sample (e.g. 10, 110).

            // For now, to solve the User Issue: Treat "Deep Plan" L1 as a SINGLE level with internal depth 
            // but mapped to ONE logical level index, unless we have a separator that implies otherwise.

            // Actually, the issue is that "100" (len 3) generates 3 levels.
            // If we just return one level here:
            insights.push({
                level: 1,
                name: 'Nivel 1 (Raíz)',
                chars: len,
                type: 'Numérico',
                behavior: 'Grupo Principal',
                isFixed: false
            });
            logicalLevelIndex++;
        } else if (firstSeg) {
        } else if (firstSeg) {
            // Standard Plan L1
            insights.push({
                level: 1,
                name: 'Nivel 1',
                chars: firstSeg.avgLength || 0,
                type: firstSeg.isNumeric ? 'Numérico' : 'Alfanumérico',
                behavior: 'Grupos Raíz',
                isFixed: false
            });
            logicalLevelIndex++;
        }

        // 2. Handle Subsequent Segments
        for (let i = 1; i < segments.length; i++) {
            const s = segments[i];
            const segLen = s.avgLength || 0;

            // Skip modifiers in Deep Plan (length 1) - Visual skipping as well
            if (isDeepPlan && segLen === 1) {
                // For visual feedback, we ignore this "level" card entirely 
                // as it's just a separator/modifier in the user's mental model.
                continue;
            }

            // Normal segment
            // Calculate increment from data or config?
            // For L2+ standard segments, usually +1
            let behaviorText = 'Aumenta secuencialmente (+1)';

            // Try to detect real behavior from sample? (Complexity high, default to +1 matching proposeStructure)

            insights.push({
                level: logicalLevelIndex + 1,
                name: `Nivel ${logicalLevelIndex + 1}`,
                chars: segLen,
                type: s.isNumeric ? 'Numérico' : (s.isAlpha ? 'Alfabético' : 'Alfanumérico'),
                behavior: behaviorText,
                isFixed: false
            });
            logicalLevelIndex++;
        }

        return insights;
    }


    static splitByLength(code) {
        // Fallback for codes without separators (like PUCT/Standard Numeric)
        // Improved Heuristic: 1, 2, 4, 7, 10, 13...
        const c = String(code).trim();
        const len = c.length;
        if (len === 0) return [];
        if (len === 1) return [c];

        const parts = [c.substring(0, 1)]; // Level 1 (Length 1)
        if (len > 1) parts.push(c.substring(1, 2)); // Level 2 (Length 2)
        if (len > 2) parts.push(c.substring(2, 4)); // Level 3 (Length 4)

        let current = 4;
        while (current < len) {
            parts.push(c.substring(current, current + 3)); // Levels 4+ (Length +3 each)
            current += 3;
        }
        return parts;
    }

    static getCharType(str) {
        if (/^\d+$/.test(str)) return 'numeric';
        if (/^[a-zA-Z]+$/.test(str)) return 'alpha';
        return 'alphanumeric';
    }

    static generateMask(segments, config = {}) {
        // If no manual config, use detected segments directly (original behavior)
        if (!config.levelLengths || !config.levelCount) {
            return segments.map(s => {
                const char = s.isNumeric ? '#' : (s.isAlpha ? 'A' : 'X');
                return char.repeat(s.avgLength);
            }).join(config.separator || '.');
        }

        // Manual config: use cumulative lengths
        const count = Math.max(segments.length, config.levelCount || 0);
        const sep = config.hasSeparator ? (config.separator || '.') : '';
        const maskParts = [];

        for (let i = 0; i < count; i++) {
            const s = segments[i];
            const char = s ? (s.isNumeric ? '#' : (s.isAlpha ? 'A' : 'X')) : '#';
            const cur = config.levelLengths[i] || 0;
            const prev = i > 0 ? (config.levelLengths[i - 1] || 0) : 0;
            const len = Math.max(1, cur - prev);
            maskParts.push(char.repeat(len));
        }
        return maskParts.join(sep);
    }

    static synthesizeRegex(segments, config = {}) {
        // If no manual config, use detected segments directly (original behavior)
        if (!config.levelLengths || !config.levelCount) {
            const parts = segments.map(s => {
                const charClass = s.isNumeric ? '\\d' : (s.isAlpha ? '[A-Z]' : '[A-Z0-9]');
                return `${charClass}{${s.avgLength}}`;
            });
            const sepEscaped = config.separator ? `\\${config.separator}` : '\\.';
            return `^${parts.join(sepEscaped)}$`;
        }

        // Manual config: use cumulative lengths
        const count = Math.max(segments.length, config.levelCount || 0);
        const sep = config.hasSeparator ? (config.separator || '.') : '';
        const regexParts = [];

        for (let i = 0; i < count; i++) {
            const s = segments[i];
            const charClass = (s && !s.isNumeric) ? (s.isAlpha ? '[A-Z]' : '[A-Z0-9]') : '\\d';
            const cur = config.levelLengths[i] || 0;
            const prev = i > 0 ? (config.levelLengths[i - 1] || 0) : 0;
            const len = Math.max(1, cur - prev);
            regexParts.push(`${charClass}{${len}}`);
        }
        const sepEscaped = sep ? `\\${sep}` : '';
        return `^${regexParts.join(sepEscaped)}$`;
    }

    static detectBehavior(sample, separator) {
        const behavior = {
            fixedPrefixes: {}, // level -> prefix
            incremental: false,
            strictlyNumerical: sample.every(c => /^[0-9.\- ]+$/.test(c))
        };

        // Detect fixed prefixes for Level 1 (most common)
        const l1Parts = sample.map(c => separator ? c.split(separator)[0] : c[0]);
        const uniqueL1 = new Set(l1Parts);
        if (uniqueL1.size < 10 && sample.length > 20) {
            behavior.fixedPrefixes[0] = Array.from(uniqueL1);
        }

        // Detect Incremental logic (e.g., steps of 1, 10, or 100)
        // Only for numeric segments
        return behavior;
    }

    /**
     * @private
     * Calculates the internal depth of a numeric segment based on trailing zeros.
     * e.g., "100" -> 1, "110" -> 2, "111" -> 3.
     */
    static _getSegmentDepth(seg) {
        if (!seg || !/^\d+$/.test(seg)) return 1; // Non-numeric or empty -> 1 level
        const len = seg.length;

        // Only apply "Deep Internal Hierarchy" logic for segments big enough (>= 3 digits)
        if (len < 3) return 1;

        // Count trailing zeros
        let zeros = 0;
        for (let i = len - 1; i >= 0; i--) {
            if (seg[i] === '0') zeros++;
            else break;
        }
        return Math.max(1, len - zeros);
    }

    /**
     * Helper to check if a string contains meaningful accounting content 
     * (not just zeros, dots, dashes, or spaces)
     */
    static hasContent(val) {
        if (!val) return false;
        const s = String(val).trim();
        if (s === '') return false;
        // A segment is active if it contains digits other than 0 or letters
        return !/^[0.\-\s]+$/.test(s);
    }

    /**
     * Core Hierarchical Engine: Determines the level of a code based on structure and content.
     */
    static calculateLevel(code, config = {}) {
        if (!code) return 1;
        // Defensive normalization: allow callers to pass an `analysis`-like
        // object (with `segments` or `levelInsights`) directly as `config`.
        if (config && (config.segments || config.levelInsights)) {
            config = this.toConfigFromAnalysis(config);
        }

        const c = String(code).trim();
        // Special-case: smartPUCT mode for long numeric plans (leading-non-zero depth)
        if (config && config.smartPUCT && /^\d+$/.test(c)) {
            // Count consecutive non-zero digits from the left until first '0'
            let depth = 0;
            for (let i = 0; i < c.length; i++) {
                if (c[i] !== '0') depth++; else break;
            }
            return Math.max(1, depth);
        }
        // Special-case: smartFlat for short numeric plans -> simple length-based buckets (ceil(len/3))
        if (config && config.smartFlat && /^\d+$/.test(c)) {
            return Math.max(1, Math.ceil(c.length / 3));
        }
        const sep = config.separator || '.';
        const hasSep = c.includes(sep);

        // 1. Separated Hierarchy (Universal Segment Logic)
        if (config.hasSeparator && hasSep) {
            const parts = c.split(sep);

            // Analyze first segment for internal hierarchy (common in plans like ASFI: 100, 110, 111)
            let baseLevel = 0;

            if (parts.length > 0 && this.hasContent(parts[0])) {
                baseLevel = this._getSegmentDepth(parts[0]);
            }

            // Add levels for subsequent segments
            // UNIVERSAL HEURISTIC: In "Deep Plans" (base segment >= 3 digits), single-character segments 
            // often represent modifiers (currency M, status A) rather than hierarchical levels.
            // We skip incrementing the level for them to match user expectation (131.09.M.03 -> Level 5).
            const isDeepPlan = (parts[0] || '').length >= 3;

            let extraLevels = 0;
            for (let i = 1; i < parts.length; i++) {
                const p = parts[i];
                if (this.hasContent(p)) {
                    // If Deep Plan and segment is minimal (1 char), likely a modifier -> Start skipping
                    // Exception: If it's the LAST segment? No, usually leaf.
                    if (isDeepPlan && p.length === 1) {
                        // Do not increment extraLevels
                        continue;
                    }
                    extraLevels++;
                }
            }

            // If we have extra segments, the first segment is implicitly at its MAX depth (e.g. 111)
            // Exception: specific patterns, but usually 100.01 is invalid, 111.01 is valid.
            // If the plan allows 100.01 (Level 2?), then BaseLevel logic holds.
            // But usually sub-accounts hang off the leaf.
            // So if extraLevels > 0, we assume base is full depth? 
            // ASFI: 127.01. base 127 is depth 3. 
            // If code was 100.01 -> 1 + 1 = 2? 
            // Let's stick to additive logic: baseLevel + extraLevels.
            // "127" (depth 3) + "01" (1) = 4. Correct.

            return Math.max(1, baseLevel + extraLevels);
        }

        // 2. Length-based / Hybrid Fallback
        const len = c.length;
        let levels = config.levelLengths || [];

        // FIX: Lógica para PUCT / Códigos de Longitud Fija con Relleno de Ceros
        // Si no hay separador y tenemos una estructura definida, verificamos si el código
        // coincide con la longitud máxima y tiene "cola de ceros".
        if (!hasSep && levels.length > 0) {
            const maxLen = levels[levels.length - 1];
            // Si el código tiene la longitud total (ej: 9 dígitos en PUCT), verificamos el relleno
            if (len === maxLen) {
                for (let i = 0; i < levels.length; i++) {
                    const l = levels[i];
                    const suffix = c.substring(l);
                    // Si el sufijo está vacío o son solo ceros, este es el nivel correcto
                    if (!suffix || /^0+$/.test(suffix)) {
                        return i + 1;
                    }
                }
                return levels.length; // Si no tiene ceros al final, es el último nivel
            }
        }

        // ... (Default generation logic omitted for brevity, assuming levels exist or handled by legacy)
        // Note: For universal fix, we apply similar logic to the FIRST level block

        if (levels.length === 0) return 1;

        let detectedLevel = 1;
        const maxCheck = Math.min(levels.length, config.levelCount || 10);

        // Check if we are inside the first level block
        if (len <= levels[0]) {
            // We are in the first block (e.g. len 3). Apply internal depth logic.
            // We treat the whole code as one segment.
            return this._getSegmentDepth(c);
        }

        // If we are beyond first block, calculate normally but start from First Block Max Depth
        // Assumes First Block Max Depth = levels[0] (e.g. 3).
        // e.g. levels [3, 5]. Code len 5.
        // First block is 3 chars. Max depth 3 (111).
        // Second block adds 1 level? 
        // Or second block logic `i + 1`?
        // Standard logic: `11101` -> Level 2? 
        // Wait, standard length logic maps [3, 5] -> L1, L2.
        // But ASFI maps `11101` (len 5) to L4!

        // This confirms "Length Mode" configuration [3, 5] is INSUFFICIENT to describe ASFI if using standard logic.
        // Standard logic: Level = Index in levelLengths.
        // ASFI logic: Level = InternalDepth(Seg1) + Index(Seg2...).

        // To support "Universal Length Mode", we must check if the first block supports internal depth.
        // We can check: Is levels[0] >= 3? And are we using Digits-Only?
        // If yes, apply InternalDepth to the prefix.

        const firstBlockLen = levels[0];
        const firstBlock = c.substring(0, firstBlockLen);
        const baseInternalDepth = this._getSegmentDepth(firstBlock); // e.g. "127" -> 3

        // Now count how many EXTRA blocks we have covered
        let extraBlocks = 0;
        for (let i = 0; i < maxCheck; i++) {
            if (i === 0) continue; // Skip first block (handled by base)
            if (len > levels[i - 1]) { // Reached into this block
                extraBlocks++;
            }
        }

        return Math.max(1, baseInternalDepth + extraBlocks);
    }

    static calculateParent(code, config = {}) {
        if (!code) return null;
        // Defensive normalization
        if (config && (config.segments || config.levelInsights)) {
            config = this.toConfigFromAnalysis(config);
        }

        const level = this.calculateLevel(code, config);
        if (level <= 1) return null;

        const c = String(code).trim();
        const sep = config.separator || '.';
        const hasSep = c.includes(sep);

        // 1. Segmented Parent Logic (ASFI-style)
        if (config.hasSeparator && hasSep) {
            const parts = c.split(sep);
            const isDeepPlan = (parts[0] || '').length >= 3;

            // Find indices of all "active" segments (not modifiers, not zero-content)
            const activeIndices = [];
            parts.forEach((p, i) => {
                if (this.hasContent(p)) {
                    if (isDeepPlan && p.length === 1 && i > 0) {
                        // It's a modifier, ignore
                    } else {
                        activeIndices.push(i);
                    }
                }
            });

            // If there's more than one active segment, parent is formed by taking all parts up to the second-to-last active segment.
            if (activeIndices.length > 1) {
                const parentLastActiveIndex = activeIndices[activeIndices.length - 2];
                const parentParts = parts.slice(0, parentLastActiveIndex + 1);
                return parentParts.join(sep);
            }

            // If only one active segment, hierarchy is within the first part.
            if (activeIndices.length <= 1) {
                const firstPart = parts[0];
                const depth = this._getSegmentDepth(firstPart);

                if (depth > 1) {
                    const parentPrefix = firstPart.substring(0, depth - 1);
                    const parentOfFirstPart = parentPrefix.padEnd(firstPart.length, '0');
                    const parentParts = [parentOfFirstPart];
                    for (let i = 1; i < parts.length; i++) {
                        parentParts.push('0'.repeat(parts[i].length));
                    }
                    return parentParts.join(sep);
                }
                return null; // Level 1 in a deep plan has no parent
            }
        }

        // 2. Length-based Parent Logic
        const levels = config.levelLengths || [];
        if (levels.length >= level - 1 && level > 1) {
            const parentLen = levels[level - 2];
            let parentCode = c.substring(0, parentLen);

            // FIX: Mantener el relleno de ceros si el código original lo tenía (PUCT)
            const maxLen = levels[levels.length - 1];
            if (!config.hasSeparator && c.length === maxLen) {
                parentCode = parentCode.padEnd(maxLen, '0');
            }
            return parentCode;
        }

        // 3. Legacy Fallback
        const len = c.length;
        if (len <= 1) return null;
        if (len === 2) return c.substring(0, 1);
        if (len === 4) return c.substring(0, 2);
        if (len >= 6) return c.substring(0, c.length - 2);
        return c.substring(0, c.length - 1);
    }

    static heuristicTypeGuess(code, behavior) {
        const firstDigit = code[0];
        // Standard Accounting Mapping (Fallback)
        const mapping = {
            '1': 'Activo',
            '2': 'Pasivo',
            '3': 'Patrimonio',
            '4': 'Ingreso',
            '5': 'Gasto',
            '6': 'Costo',
            '7': 'Costo',
            '8': 'Orden',
            '9': 'Orden'
        };
        return mapping[firstDigit] || 'Activo';
    }

    /**
     * Extrae características para los modelos de IA
     */
    static extractFeatures(account, analysisOrConfig) {
        const code = String(account.code);
        const level = this.calculateLevel(code, analysisOrConfig);
        return {
            code: code,
            name: account.name,
            length: code.length,
            first_digit: code.charAt(0),
            level: level
        };
    }

    static getDefaultProfile() {
        return {
            separator: '.',
            mask: '#.##.##.###',
            regex: '^\\d{1}\\.\\d{2}\\.\\d{2}\\.\\d{3}$',
            behavior: { strictlyNumerical: true },
            levelsCount: 4,
            levelLengths: [1, 2, 4, 7],
            levelIncrements: [1, 1, 1, 1],
            getParent: () => null,
            guessType: () => 'Activo'
        };
    }

    static get ASFI_PATTERNS() {
        return [
            // ASFI format with letters: NNN.NN.M.NN + space + NAME (including parentheses)
            /^(\d{3}\.\d{2}\.[A-Z]\.\d{2})\s+(.+)$/i,      // NNN.NN.M.NN + NAME
            /^(\d{3}\.\d{2}\.\d{2}\.[A-Z]\.\d{2})\s+(.+)$/i, // NNN.NN.NN.M.NN + NAME
            /^(\d{3}\.\d{2}\.[A-Z]\.\d{2}\.\d{2})\s+(.+)$/i, // NNN.NN.M.NN.NN + NAME
            /^(\d{3}\.\d{2}\.\d{2}\.[A-Z]\.\d{2}\.\d{2})\s+(.+)$/i, // NNN.NN.NN.M.NN.NN + NAME
            /^(\d{3}\.\d{2}\.[A-Z]\.\d{2}\.\d{2}\.\d{2})\s+(.+)$/i, // NNN.NN.M.NN.NN.NN + NAME

            // ASFI format with numbers as moneda: NNN.NN.1.NN + space + NAME
            /^(\d{3}\.\d{2}\.\d{1}\.\d{2})\s+(.+)$/i,      // NNN.NN.1.NN + NAME
            /^(\d{3}\.\d{2}\.\d{2}\.\d{1}\.\d{2})\s+(.+)$/i, // NNN.NN.NN.1.NN + NAME
            /^(\d{3}\.\d{2}\.\d{1}\.\d{2}\.\d{2})\s+(.+)$/i, // NNN.NN.1.NN.NN + NAME
            /^(\d{3}\.\d{2}\.\d{2}\.\d{1}\.\d{2}\.\d{2})\s+(.+)$/i, // NNN.NN.NN.1.NN.NN + NAME
            /^(\d{3}\.\d{2}\.\d{1}\.\d{2}\.\d{2}\.\d{2})\s+(.+)$/i, // NNN.NN.1.NN.NN.NN + NAME

            // ASFI format: NNN.NN + space + NAME (including parentheses and mixed case)
            /^(\d{3}\.\d{2})\s+(.+)$/i,              // NNN.NN + NAME
            /^(\d{3}\.\d{2}\.\d{2})\s+(.+)$/i,        // NNN.NN.NN + NAME
            /^(\d{3}\.\d{2}\.\d{2}\.\d{2})\s+(.+)$/i,  // NNN.NN.NN.NN + NAME
            /^(\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d{2})\s+(.+)$/i, // NNN.NN.NN.NN.NN + NAME
            /^(\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2})\s+(.+)$/i, // NNN.NN.NN.NN.NN.NN + NAME

            // Fallback patterns for complex codes
            /^(\d+(?:\.\d+)*\.[A-Z\d{1}](?:\.\d+)*)\s+(.+)$/,     // Codes with letters/numbers in middle
            /^(\d+(?:[.\-\/]\d+)*[A-Z\d{1}]?(?:[.\-\/]\d+[A-Z\d{1}]?)*)\s+(.+)$/, // Complex codes
            /^(\d+(?:[.\-\/]\d+)*)\s+(.+)$/,    // Code followed by text
            /^(\d+(?:[.\-\/]\d+)*)\s*[-–—]\s*(.+)$/,       // Code with dash separator
            /^(\d+(?:[.\-\/]\d+)*)\s{2,}(.+)$/,            // Code with multiple spaces
        ];
    }

    /**
     * Proposes a structure configuration based on deep analysis.
     * Ensures levelLengths are DIGIT-ONLY (stripping separators).
     * @param {Array} accounts List of {code, name}
     */
    static proposeStructure(accounts) {
        const analysis = this.analyze(accounts);
        const levelLengths = [];
        const levelIncrements = [];

        // Use segments from analysis
        const segments = analysis.segments || [];

        if (segments.length > 0) {
            const firstSegLen = segments[0].avgLength || 0;
            const isDeepPlan = firstSegLen >= 3;

            let accum = 0;

            // 1. Handle First Segment (Base)
            if (isDeepPlan) {
                // If Deep Plan (e.g. 3 digits), do NOT expand into multiple levels by default.
                // Just keep it as one block of length `firstSegLen`.
                // This fixes the "5 levels detected" issue for simple 100.01 plans.
                accum = firstSegLen;
                levelLengths.push(accum);
                levelIncrements.push(1);
            } else {
                // Standard Plan
                accum = firstSegLen;
                levelLengths.push(accum);
                levelIncrements.push(1);
            }

            // 2. Handle Subsequent Segments
            for (let i = 1; i < segments.length; i++) {
                const segLen = segments[i].avgLength || 0;

                // SKIPPING LOGIC (Match calculateLevel):
                // If Deep Plan and segment is 1 char, treat as modifier (skip level creation) (e.g. 'M')
                if (isDeepPlan && segLen === 1) {
                    accum += segLen;
                    // Do not push a new level, just merge length into next (or accumulate for final)
                    // If this is the last segment, we MUST push it to ensure total length matches?
                    // User complained about Level 5 classification.
                    // If we skip pushing here, the NEXT segment will effectively claim this length.
                    // Ex: L4 was 5 chars. M(1). 01(2).
                    // Skip M. Accum = 6.
                    // Process 01. Accum = 8. Push 8.
                    // Result: Level 5 has length 8. Correct.
                    if (i === segments.length - 1) {
                        // Edge case: if last segment is modifier, it should be part of previous level?
                        // Or just push? Let's push to be safe.
                        levelLengths.push(accum);
                        levelIncrements.push(1);
                    }
                } else {
                    accum += segLen;
                    levelLengths.push(accum);
                    levelIncrements.push(1);
                }
            }
        }

        // Fallback if no segments
        if (levelLengths.length === 0) {
            levelLengths.push(3);
            levelIncrements.push(1);
        }

        return {
            hasSeparator: !!analysis.separator,
            separator: analysis.separator || '',
            levelCount: levelLengths.length,
            levelLengths: levelLengths,
            levelIncrements: levelIncrements,
            smartZeroCheck: false,
            useCustomLengths: false
        };
    }

    /**
     * Normalize an `analysis` object (as returned by `analyze`) into
     * a `config` object consumable by `calculateLevel`.
     * This is a lightweight, deterministic converter used when callers
     * have analysis data but not an explicit levelLengths config.
     */
    static toConfigFromAnalysis(analysis = {}) {
        if (!analysis || (!analysis.segments || analysis.segments.length === 0)) {
            return this.getDefaultProfile();
        }

        const segments = analysis.segments || [];
        const levelLengths = [];
        const levelIncrements = [];

        const firstSegLen = segments[0].avgLength || 0;
        const isDeepPlan = firstSegLen >= 3;
        let accum = 0;

        if (segments.length > 0) {
            if (isDeepPlan) {
                // Do not expand. 
                accum = firstSegLen;
                levelLengths.push(accum);
                levelIncrements.push(1);
            } else {
                accum = firstSegLen;
                levelLengths.push(accum);
                levelIncrements.push(1);
            }

            for (let i = 1; i < segments.length; i++) {
                const segLen = segments[i].avgLength || 0;
                if (isDeepPlan && segLen === 1) {
                    accum += segLen;
                    if (i === segments.length - 1) {
                        levelLengths.push(accum);
                        levelIncrements.push(1);
                    }
                } else {
                    accum += segLen;
                    levelLengths.push(accum);
                    levelIncrements.push(1);
                }
            }
        }

        if (levelLengths.length === 0) {
            levelLengths.push(3);
            levelIncrements.push(1);
        }

        // Heuristics: detect PUCT-style long numeric plans (e.g. 9-digit codes)
        // or short flat numeric plans and set flags to guide calculateLevel.
        const totalAvgLen = (segments || []).reduce((s, seg) => s + (seg.avgLength || 0), 0);
        const isNumericOnly = (analysis && analysis.behavior && analysis.behavior.strictlyNumerical) || false;

        const cfg = {
            hasSeparator: !!analysis.separator,
            separator: analysis.separator || '',
            levelCount: levelLengths.length,
            levelLengths,
            levelIncrements,
            smartZeroCheck: false,
            useCustomLengths: false
        };

        // If we have raw samples, try to infer a more accurate levelCount when a separator exists.
        if (analysis && analysis.samples && cfg.hasSeparator) {
            const samples = analysis.samples.slice(0, 500).map(s => String(s || '').trim()).filter(Boolean);
            if (samples.length > 0) {
                const sep = cfg.separator || '-';
                const partLengths = [];
                samples.forEach(s => {
                    const parts = s.split(sep).map(p => p.trim()).filter(Boolean);
                    parts.forEach((p, idx) => {
                        partLengths[idx] = partLengths[idx] || [];
                        partLengths[idx].push(p.length);
                    });
                });
                // mode length per part
                const cumLengths = [];
                for (let i = 0; i < partLengths.length; i++) {
                    const arr = partLengths[i] || [];
                    if (arr.length === 0) { cumLengths.push(0); continue; }
                    const counts = {};
                    arr.forEach(v => counts[v] = (counts[v] || 0) + 1);
                    let mode = 0, maxc = 0;
                    Object.entries(counts).forEach(([k, c]) => { if (c > maxc) { maxc = c; mode = Number(k); } });
                    cumLengths.push(mode);
                }
                // If we detected a sensible parts count, replace levelLengths with cumulative sums
                if (cumLengths.length > 1) {
                    const newLevelLengths = [];
                    let acc = 0;
                    for (let i = 0; i < cumLengths.length; i++) {
                        acc += Math.max(1, cumLengths[i] || 0);
                        newLevelLengths.push(acc);
                    }
                    cfg.levelCount = newLevelLengths.length;
                    cfg.levelLengths = newLevelLengths;
                }
            }
        }

        if (!cfg.hasSeparator && isNumericOnly) {
            // PUCT-like: long numeric codes (>=8 avg length) -> use smartPUCT mode
            if (totalAvgLen >= 8) {
                cfg.smartPUCT = true;
                // Keep levelLengths as a single block equal to observed avg total length
                cfg.levelCount = 1;
                cfg.levelLengths = [Math.max(3, Math.round(totalAvgLen))];
            } else if (totalAvgLen <= 5) {
                // Short flat numeric plans: use a compact heuristic (ceil(len/3))
                cfg.smartFlat = true;
                cfg.levelCount = 0; // let smartFlat handle levels
                cfg.levelLengths = [];
            }
        }

        return cfg;
    }

    /**
     * Merge a user `config` (possibly partial) with an `analysis`-derived config.
     * Rules:
     * - If user explicitly enabled `useCustomLengths === true` and provides
     *   valid `levelLengths`, prefer user's lengths entirely.
     * - Otherwise, take lengths from analysis-derived config and allow the
     *   user to override non-length fields (separator, hasSeparator).
     */
    static mergeConfigWithAnalysis(userConfig = {}, analysis = {}) {
        const analysisConfig = this.toConfigFromAnalysis(analysis);

        // If user explicitly wants custom lengths and they look valid, return user config
        if (userConfig && userConfig.useCustomLengths === true && Array.isArray(userConfig.levelLengths) && userConfig.levelLengths.length > 0 && userConfig.levelLengths.every(n => Number.isInteger(n) && n > 0)) {
            return Object.assign({}, analysisConfig, userConfig);
        }

        // Otherwise merge: lengths from analysis, but allow user to override separator flags
        const merged = Object.assign({}, analysisConfig);
        if (userConfig && typeof userConfig.hasSeparator === 'boolean') merged.hasSeparator = userConfig.hasSeparator;
        if (userConfig && typeof userConfig.separator === 'string' && userConfig.separator.length > 0) merged.separator = userConfig.separator;
        if (userConfig && typeof userConfig.smartZeroCheck === 'boolean') merged.smartZeroCheck = userConfig.smartZeroCheck;
        // preserve user preference for useCustomLengths flag
        merged.useCustomLengths = !!userConfig.useCustomLengths;
        return merged;
    }

    /**
     * Legacy support helper
     */
    static calculateHierarchy(accounts) {
        const analysis = this.analyze(accounts);
        const accountMap = new Map();
        accounts.forEach(a => accountMap.set(String(a.code), a.id));

        const updates = [];
        accounts.forEach(acc => {
            const parentCode = analysis.getParent(String(acc.code));
            if (parentCode && accountMap.has(parentCode)) {
                updates.push({
                    id: acc.id,
                    code: acc.code,
                    parent_code: parentCode
                });
            }
        });
        return updates;
    }
}
