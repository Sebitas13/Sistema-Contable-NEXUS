/**
 * Mahoraga Skill System V7.0 - Skill Loader & Index
 * Loads the unified skill catalog and exposes simple search helpers.
 */

const fs = require('fs');
const path = require('path');

class SkillLoader {
    constructor() {
        this.skills = [];
        this.skillIndex = new Map();
        this.keywordIndex = new Map();
        this.anchorIndex = new Map();
        this.loaded = false;
        this.skillsPath = null;
        this.lastLoadedAt = null;
    }

    resolveSkillsPath() {
        const candidates = [
            path.join(__dirname, '..', 'skills_output_combined.json'),
            path.join(__dirname, '..', 'skills_output.json')
        ];

        return candidates.find(candidate => fs.existsSync(candidate)) || null;
    }

    loadSkills() {
        try {
            const skillsPath = this.resolveSkillsPath();

            if (!skillsPath) {
                console.warn('Skill catalog file not found.');
                return false;
            }

            const skillsData = fs.readFileSync(skillsPath, 'utf8');
            this.skills = JSON.parse(skillsData);
            this.skillsPath = skillsPath;
            this.lastLoadedAt = new Date().toISOString();

            console.log(`SKILLS: loaded ${this.skills.length} skills from ${path.basename(skillsPath)}`);

            this.buildIndices();
            this.loaded = true;

            return true;
        } catch (error) {
            console.error('Error loading skills:', error.message);
            return false;
        }
    }

    buildIndices() {
        this.skillIndex.clear();
        this.keywordIndex.clear();
        this.anchorIndex.clear();

        this.skills.forEach(skill => {
            this.skillIndex.set(skill.id, skill);

            if (Array.isArray(skill.keywords)) {
                skill.keywords.forEach(keyword => {
                    const normalized = String(keyword || '').toLowerCase().trim();
                    if (!normalized) return;
                    if (!this.keywordIndex.has(normalized)) {
                        this.keywordIndex.set(normalized, new Set());
                    }
                    this.keywordIndex.get(normalized).add(skill.id);
                });
            }

            if (Array.isArray(skill.anchors)) {
                skill.anchors.forEach(anchor => {
                    const normalized = String(anchor || '').trim();
                    if (!normalized) return;
                    if (!this.anchorIndex.has(normalized)) {
                        this.anchorIndex.set(normalized, new Set());
                    }
                    this.anchorIndex.get(normalized).add(skill.id);
                });
            }
        });
    }

    searchByKeywords(phrase) {
        if (!phrase || typeof phrase !== 'string') return [];

        const words = phrase.toLowerCase().split(/\s+/).filter(word => word.length > 2);
        if (words.length === 0) return [];

        const skillScores = new Map();

        words.forEach(word => {
            const skillIds = this.keywordIndex.get(word);
            if (!skillIds) return;

            skillIds.forEach(skillId => {
                const currentScore = skillScores.get(skillId) || 0;
                skillScores.set(skillId, currentScore + 1);
            });
        });

        return Array.from(skillScores.entries())
            .map(([skillId, score]) => ({
                skill: this.skillIndex.get(skillId),
                score,
                relevance: score / words.length
            }))
            .sort((a, b) => b.score - a.score || b.relevance - a.relevance)
            .slice(0, 10);
    }

    getSkillById(skillId) {
        return this.skillIndex.get(skillId) || null;
    }

    searchByAnchor(pattern) {
        if (!pattern || typeof pattern !== 'string') return [];

        let regex = null;
        try {
            regex = new RegExp(pattern, 'i');
        } catch (error) {
            regex = null;
        }

        return this.skills.filter(skill => {
            const searchableText = this.buildSearchableText(skill);
            return regex ? regex.test(searchableText) : searchableText.includes(pattern.toLowerCase());
        });
    }

    buildSearchableText(skill) {
        return [
            skill.id,
            skill.name,
            skill.file,
            skill.type,
            skill.doc || '',
            ...(skill.keywords || [])
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
    }

    searchCatalog(query = '', options = {}) {
        const normalizedQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';
        const limit = Math.max(1, parseInt(options.limit, 10) || 20);
        const offset = Math.max(0, parseInt(options.offset, 10) || 0);

        if (!normalizedQuery) {
            return {
                query: '',
                totalResults: this.skills.length,
                results: this.skills.slice(offset, offset + limit).map(skill => ({
                    skill,
                    score: 1,
                    relevance: 1
                }))
            };
        }

        const ranked = this.skills
            .map(skill => {
                const name = String(skill.name || '').toLowerCase();
                const id = String(skill.id || '').toLowerCase();
                const file = String(skill.file || '').toLowerCase();
                const type = String(skill.type || '').toLowerCase();
                const haystack = this.buildSearchableText(skill);

                let score = 0;
                if (name === normalizedQuery || id === normalizedQuery) score += 6;
                if (name.includes(normalizedQuery) || id.includes(normalizedQuery)) score += 4;
                if (file.includes(normalizedQuery)) score += 3;
                if (type.includes(normalizedQuery)) score += 2;
                if (haystack.includes(normalizedQuery)) score += 1;

                return {
                    skill,
                    score,
                    relevance: score > 0 ? Math.min(1, score / 6) : 0
                };
            })
            .filter(result => result.score > 0)
            .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));

        return {
            query: normalizedQuery,
            totalResults: ranked.length,
            results: ranked.slice(offset, offset + limit)
        };
    }

    getSkillsByType(type) {
        return this.skills.filter(skill => skill.type === type);
    }

    getPureSkills() {
        return this.skills.filter(skill => skill.isPure === true);
    }

    getContextSkills() {
        return this.skills.filter(skill => Array.isArray(skill.contextDeps) && skill.contextDeps.length > 0);
    }

    getStats() {
        const stats = {
            totalSkills: this.skills.length,
            skillsByType: {},
            skillsByLanguage: {},
            pureSkills: 0,
            contextSkills: 0,
            totalKeywords: this.keywordIndex.size,
            totalAnchors: this.anchorIndex.size,
            sourceFile: this.skillsPath ? path.basename(this.skillsPath) : null,
            loadedAt: this.lastLoadedAt
        };

        this.skills.forEach(skill => {
            const type = skill.type || 'unknown';
            stats.skillsByType[type] = (stats.skillsByType[type] || 0) + 1;

            const fileExt = String(skill.file || '').split('.').pop().toLowerCase();
            const language = fileExt === 'py' ? 'python' : 'javascript';
            stats.skillsByLanguage[language] = (stats.skillsByLanguage[language] || 0) + 1;

            if (skill.isPure) stats.pureSkills += 1;
            if (Array.isArray(skill.contextDeps) && skill.contextDeps.length > 0) {
                stats.contextSkills += 1;
            }
        });

        return stats;
    }

    getHealthStats() {
        const stats = this.getStats();

        return {
            loaded: this.isReady(),
            sourceFile: stats.sourceFile,
            last_update: stats.loadedAt,
            total: stats.totalSkills,
            active: stats.totalSkills,
            degraded: 0,
            totalSkills: stats.totalSkills,
            skillsByType: stats.skillsByType,
            skillsByLanguage: stats.skillsByLanguage,
            pureSkills: stats.pureSkills,
            contextSkills: stats.contextSkills,
            totalKeywords: stats.totalKeywords,
            totalAnchors: stats.totalAnchors
        };
    }

    isReady() {
        return this.loaded && this.skills.length > 0;
    }

    reload() {
        console.log('Reloading skill catalog...');
        this.skills = [];
        this.skillIndex.clear();
        this.keywordIndex.clear();
        this.anchorIndex.clear();
        this.loaded = false;
        this.skillsPath = null;
        this.lastLoadedAt = null;

        return this.loadSkills();
    }
}

module.exports = new SkillLoader();
