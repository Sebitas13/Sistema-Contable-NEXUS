/**
 * Python Knowledge Bridge V1.0
 * Permite al motor Python (FastAPI) consultar el Knowledge Brain de Node.js
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const knowledgeBrain = require('../services/knowledgeBrain');

const NODE_API_URL = process.env.NODE_API_URL || 'http://localhost:3001';

/**
 * GET /api/ai/knowledge/brain
 * Proxy para que Python consulte el Knowledge Brain
 * Este endpoint es llamado por el motor Python
 */
router.get('/brain', async (req, res) => {
    try {
        const { phase, operation } = req.query;

        let response;
        if (phase) {
            response = knowledgeBrain.getPhaseContext(phase);
        } else if (operation) {
            response = knowledgeBrain.getSkillsForOperation(operation);
        } else {
            response = knowledgeBrain.getFullKnowledge();
        }

        res.json({
            success: true,
            source: 'node_knowledge_brain',
            requested: { phase, operation },
            data: response,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            source: 'node_knowledge_brain'
        });
    }
});

/**
 * GET /api/ai/knowledge/skills/for/:operation
 * Proxy para que Python obtenga skills para una operación
 */
router.get('/skills/for/:operation', async (req, res) => {
    try {
        const { operation } = req.params;
        const skillsContext = knowledgeBrain.getSkillsForOperation(operation);

        res.json({
            success: true,
            operation,
            ...skillsContext
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/ai/knowledge/can-operate/:operation
 * Proxy para verificar si Mahoraga puede operar
 */
router.get('/can-operate/:operation', async (req, res) => {
    try {
        const { operation } = req.params;
        const permission = knowledgeBrain.canOperate(operation);

        res.json({
            success: true,
            operation,
            ...permission
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/ai/knowledge/query
 * Consulta flexible al Knowledge Brain desde Python
 */
router.post('/query', async (req, res) => {
    try {
        const { queryType, params } = req.body;

        let result;
        switch (queryType) {
            case 'phase_context':
                result = knowledgeBrain.getPhaseContext(params.phase);
                break;
            case 'skills_for_operation':
                result = knowledgeBrain.getSkillsForOperation(params.operation, params.context);
                break;
            case 'search_skills':
                result = knowledgeBrain.searchSkillsByContext(params.query, params.context);
                break;
            case 'can_operate':
                result = knowledgeBrain.canOperate(params.operation, params.context);
                break;
            case 'full_knowledge':
                result = knowledgeBrain.getFullKnowledge();
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: `Tipo de query no reconocido: ${queryType}`,
                    validTypes: ['phase_context', 'skills_for_operation', 'search_skills', 'can_operate', 'full_knowledge']
                });
        }

        res.json({
            success: true,
            queryType,
            result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
