/**
 * Mahoraga Skill System V7.0 - Skill Loader & Index
 * Carga automáticamente skills del sistema y crea índice inverso O(1)
 * para búsqueda rápida por keywords y ID
 */

const fs = require('fs');
const path = require('path');

class SkillLoader {
    constructor() {
        this.skills = [];
        this.skillIndex = new Map(); // ID -> skill
        this.keywordIndex = new Map(); // keyword -> [skill IDs]
        this.anchorIndex = new Map(); // anchor pattern -> [skill IDs]
        this.loaded = false;
    }

    /**
     * Carga skills desde archivo JSON
     */
    loadSkills() {
        try {
            const skillsPath = path.join(__dirname, '..', 'skills_output.json');

            if (!fs.existsSync(skillsPath)) {
                console.warn('⚠️ Archivo de skills no encontrado:', skillsPath);
                return false;
            }

            const skillsData = fs.readFileSync(skillsPath, 'utf8');
            this.skills = JSON.parse(skillsData);

            console.log(`🔮 SKILLS: Cargadas ${this.skills.length} skills del sistema`);

            this.buildIndices();
            this.loaded = true;

            return true;
        } catch (error) {
            console.error('❌ Error cargando skills:', error.message);
            return false;
        }
    }

    /**
     * Construye índices para búsqueda O(1)
     */
    buildIndices() {
        console.log('🏗️ Construyendo índices de búsqueda...');

        this.skillIndex.clear();
        this.keywordIndex.clear();
        this.anchorIndex.clear();

        this.skills.forEach(skill => {
            // Índice por ID
            this.skillIndex.set(skill.id, skill);

            // Índice por keywords
            if (skill.keywords && Array.isArray(skill.keywords)) {
                skill.keywords.forEach(keyword => {
                    const kw = keyword.toLowerCase().trim();
                    if (!this.keywordIndex.has(kw)) {
                        this.keywordIndex.set(kw, new Set());
                    }
                    this.keywordIndex.get(kw).add(skill.id);
                });
            }

            // Índice por anchors (patrones regex)
            if (skill.anchors && Array.isArray(skill.anchors)) {
                skill.anchors.forEach(anchor => {
                    if (!this.anchorIndex.has(anchor)) {
                        this.anchorIndex.set(anchor, new Set());
                    }
                    this.anchorIndex.get(anchor).add(skill.id);
                });
            }
        });

        console.log(`✅ Índices construidos:`);
        console.log(`   - Skills por ID: ${this.skillIndex.size}`);
        console.log(`   - Keywords indexadas: ${this.keywordIndex.size}`);
        console.log(`   - Anchors indexados: ${this.anchorIndex.size}`);
    }

    /**
     * Busca skills por frase (keywords)
     * @param {string} phrase - Frase de búsqueda
     * @returns {Array} - Skills relevantes ordenados por relevancia
     */
    searchByKeywords(phrase) {
        if (!phrase || typeof phrase !== 'string') return [];

        const words = phrase.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (words.length === 0) return [];

        // Encontrar skills que match con las palabras
        const skillScores = new Map();

        words.forEach(word => {
            const skillIds = this.keywordIndex.get(word);
            if (skillIds) {
                skillIds.forEach(skillId => {
                    const currentScore = skillScores.get(skillId) || 0;
                    skillScores.set(skillId, currentScore + 1);
                });
            }
        });

        // Convertir a array y ordenar por score
        const results = Array.from(skillScores.entries())
            .map(([skillId, score]) => ({
                skill: this.skillIndex.get(skillId),
                score: score,
                relevance: score / words.length
            }))
            .sort((a, b) => b.score - a.score || b.relevance - a.relevance);

        console.log(`🔍 Búsqueda "${phrase}": ${results.length} skills encontrados`);
        return results.slice(0, 10); // Top 10
    }

    /**
     * Obtiene una skill específica por ID
     * @param {string} skillId - ID de la skill
     * @returns {Object|null} - Skill encontrada o null
     */
    getSkillById(skillId) {
        return this.skillIndex.get(skillId) || null;
    }

    /**
     * Busca skills por anchors (matching avanzado)
     * @param {string} pattern - Patrón regex o string
     * @returns {Array} - Skills que match
     */
    searchByAnchor(pattern) {
        const results = [];
        const regex = new RegExp(pattern, 'i');

        this.skills.forEach(skill => {
            // Verificar si el patrón match con nombre, doc o keywords
            const searchableText = [
                skill.name,
                skill.doc || '',
                ...(skill.keywords || [])
            ].join(' ').toLowerCase();

            if (regex.test(searchableText)) {
                results.push(skill);
            }
        });

        return results;
    }

    /**
     * Obtiene skills por tipo (function, class, etc.)
     * @param {string} type - Tipo de skill
     * @returns {Array} - Skills del tipo especificado
     */
    getSkillsByType(type) {
        return this.skills.filter(skill => skill.type === type);
    }

    /**
     * Obtiene skills puras (sin dependencias de contexto)
     * @returns {Array} - Skills puras
     */
    getPureSkills() {
        return this.skills.filter(skill => skill.isPure === true);
    }

    /**
     * Obtiene skills con dependencias de contexto
     * @returns {Array} - Skills con contexto
     */
    getContextSkills() {
        return this.skills.filter(skill => skill.contextDeps && skill.contextDeps.length > 0);
    }

    /**
     * Obtiene estadísticas del sistema de skills
     * @returns {Object} - Estadísticas
     */
    getStats() {
        const stats = {
            totalSkills: this.skills.length,
            skillsByType: {},
            skillsByLanguage: {},
            pureSkills: 0,
            contextSkills: 0,
            totalKeywords: this.keywordIndex.size,
            totalAnchors: this.anchorIndex.size
        };

        this.skills.forEach(skill => {
            // Por tipo
            const type = skill.type || 'unknown';
            stats.skillsByType[type] = (stats.skillsByType[type] || 0) + 1;

            // Por lenguaje (basado en extensión del archivo)
            const fileExt = skill.file.split('.').pop().toLowerCase();
            const lang = fileExt === 'py' ? 'python' : 'javascript';
            stats.skillsByLanguage[lang] = (stats.skillsByLanguage[lang] || 0) + 1;

            // Puras vs contexto
            if (skill.isPure) stats.pureSkills++;
            if (skill.contextDeps && skill.contextDeps.length > 0) stats.contextSkills++;
        });

        return stats;
    }

    /**
     * Verifica si el loader está listo
     * @returns {boolean} - True si está cargado
     */
    isReady() {
        return this.loaded && this.skills.length > 0;
    }

    /**
     * Recarga skills desde archivo
     */
    reload() {
        console.log('🔄 Recargando skills del sistema...');
        this.skills = [];
        this.skillIndex.clear();
        this.keywordIndex.clear();
        this.anchorIndex.clear();
        this.loaded = false;

        return this.loadSkills();
    }
}

// Exportar instancia singleton
const skillLoader = new SkillLoader();
module.exports = skillLoader;
