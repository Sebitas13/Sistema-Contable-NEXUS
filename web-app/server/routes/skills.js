/**
 * Mahoraga Skill System V7.0 - Skills API
 * API REST para consultar el sistema de habilidades
 */

const express = require('express');
const router = express.Router();
const skillLoader = require('../services/skillLoader');

// Middleware para verificar que el loader esté listo
const requireSkillLoader = (req, res, next) => {
    if (!skillLoader.isReady()) {
        return res.status(503).json({
            success: false,
            error: 'Skill system not loaded. Please try again later.'
        });
    }
    next();
};

// GET /api/skills/health - Health check del sistema de skills
router.get('/health', (req, res) => {
    res.json({
        success: true,
        loaded: skillLoader.isReady(),
        stats: skillLoader.getStats()
    });
});

// GET /api/skills/search?q=phrase - Buscar skills por keywords
router.get('/search', requireSkillLoader, (req, res) => {
    try {
        const { q: query } = req.query;

        if (!query || query.trim().length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Query parameter "q" is required (minimum 2 characters)'
            });
        }

        const results = skillLoader.searchByKeywords(query.trim());

        res.json({
            success: true,
            query: query.trim(),
            totalResults: results.length,
            results: results
        });

    } catch (error) {
        console.error('Error in /api/skills/search:', error);
        res.status(500).json({
            success: false,
            error: 'Search failed: ' + error.message
        });
    }
});

// GET /api/skills/:id - Obtener skill específica por ID
router.get('/:id', requireSkillLoader, (req, res) => {
    try {
        const { id } = req.params;
        const skill = skillLoader.getSkillById(id);

        if (!skill) {
            return res.status(404).json({
                success: false,
                error: 'Skill not found'
            });
        }

        res.json({
            success: true,
            skill: skill
        });

    } catch (error) {
        console.error('Error in /api/skills/:id:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve skill: ' + error.message
        });
    }
});

// GET /api/skills - Listar skills con filtros opcionales
router.get('/', requireSkillLoader, (req, res) => {
    try {
        const { type, language, pure, context, limit = 50, offset = 0 } = req.query;

        let skills = skillLoader.skills;

        // Filtros
        if (type) {
            skills = skills.filter(s => s.type === type);
        }

        if (language) {
            const ext = language.toLowerCase() === 'python' ? 'py' : 'js';
            skills = skills.filter(s => s.file.endsWith(`.${ext}`));
        }

        if (pure === 'true') {
            skills = skills.filter(s => s.isPure === true);
        }

        if (context === 'true') {
            skills = skills.filter(s => s.contextDeps && s.contextDeps.length > 0);
        }

        // Paginación
        const total = skills.length;
        const paginatedSkills = skills.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

        res.json({
            success: true,
            total: total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            skills: paginatedSkills
        });

    } catch (error) {
        console.error('Error in /api/skills:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list skills: ' + error.message
        });
    }
});

// GET /api/skills/stats/summary - Estadísticas del sistema
router.get('/stats/summary', requireSkillLoader, (req, res) => {
    try {
        const stats = skillLoader.getStats();

        res.json({
            success: true,
            stats: stats
        });

    } catch (error) {
        console.error('Error in /api/skills/stats/summary:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get stats: ' + error.message
        });
    }
});

// POST /api/skills/reload - Recargar skills desde archivo
router.post('/reload', (req, res) => {
    try {
        const success = skillLoader.reload();

        if (success) {
            res.json({
                success: true,
                message: 'Skills reloaded successfully',
                stats: skillLoader.getStats()
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to reload skills'
            });
        }

    } catch (error) {
        console.error('Error in /api/skills/reload:', error);
        res.status(500).json({
            success: false,
            error: 'Reload failed: ' + error.message
        });
    }
});

// GET /api/skills/types - Lista de tipos de skills disponibles
router.get('/types/list', requireSkillLoader, (req, res) => {
    try {
        const types = [...new Set(skillLoader.skills.map(s => s.type))].filter(Boolean);

        res.json({
            success: true,
            types: types
        });

    } catch (error) {
        console.error('Error in /api/skills/types:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get types: ' + error.message
        });
    }
});

// GET /api/skills/languages/list - Lista de lenguajes disponibles
router.get('/languages/list', requireSkillLoader, (req, res) => {
    try {
        const languages = [...new Set(skillLoader.skills.map(s => {
            const ext = s.file.split('.').pop().toLowerCase();
            return ext === 'py' ? 'python' : 'javascript';
        }))];

        res.json({
            success: true,
            languages: languages
        });

    } catch (error) {
        console.error('Error in /api/skills/languages:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get languages: ' + error.message
        });
    }
});

// GET /api/skills/match/:pattern - Buscar skills por patrón (anchor matching)
router.get('/match/:pattern', requireSkillLoader, (req, res) => {
    try {
        const { pattern } = req.params;
        const results = skillLoader.searchByAnchor(decodeURIComponent(pattern));

        res.json({
            success: true,
            pattern: pattern,
            totalResults: results.length,
            results: results.slice(0, 20) // Limitar resultados
        });

    } catch (error) {
        console.error('Error in /api/skills/match/:pattern:', error);
        res.status(500).json({
            success: false,
            error: 'Pattern matching failed: ' + error.message
        });
    }
});

// POST /api/skills/dispatch - Ejecutar una skill de manera segura
router.post('/dispatch', requireSkillLoader, async (req, res) => {
    try {
        const skillDispatcher = require('../services/skillDispatcher');
        const { skillId, args = [] } = req.body;

        if (!skillId) {
            return res.status(400).json({
                success: false,
                error: 'skillId is required'
            });
        }

        console.log(`🎯 Dispatch request: ${skillId} with args:`, args);

        const result = await skillDispatcher.dispatch(skillId, args);

        res.json({
            success: true,
            skillId: skillId,
            result: result
        });

    } catch (error) {
        console.error('Error in /api/skills/dispatch:', error);
        res.status(500).json({
            success: false,
            error: 'Skill execution failed: ' + error.message
        });
    }
});

// POST /api/skills/batch-dispatch - Ejecutar múltiples skills
router.post('/batch-dispatch', requireSkillLoader, async (req, res) => {
    try {
        const skillDispatcher = require('../services/skillDispatcher');
        const { requests } = req.body;

        if (!requests || !Array.isArray(requests)) {
            return res.status(400).json({
                success: false,
                error: 'requests array is required'
            });
        }

        console.log(`🎯 Batch dispatch request: ${requests.length} skills`);

        const results = await skillDispatcher.batchDispatch(requests);

        res.json({
            success: true,
            totalRequests: requests.length,
            results: results
        });

    } catch (error) {
        console.error('Error in /api/skills/batch-dispatch:', error);
        res.status(500).json({
            success: false,
            error: 'Batch execution failed: ' + error.message
        });
    }
});

// GET /api/skills/dispatcher/health - Health check del dispatcher
router.get('/dispatcher/health', (req, res) => {
    try {
        const skillDispatcher = require('../services/skillDispatcher');

        res.json({
            success: true,
            dispatcherReady: true,
            whitelistCount: Object.keys(skillDispatcher.whitelist).length,
            sandboxTimeout: skillDispatcher.sandboxOptions.timeout,
            memoryLimit: skillDispatcher.sandboxOptions.memoryLimit
        });

    } catch (error) {
        console.error('Error in /api/skills/dispatcher/health:', error);
        res.status(500).json({
            success: false,
            error: 'Dispatcher health check failed: ' + error.message
        });
    }
});

module.exports = router;
