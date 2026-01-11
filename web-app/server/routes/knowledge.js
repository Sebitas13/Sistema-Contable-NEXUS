/**
 * Knowledge Brain API Routes
 * Expone el conocimiento de Mahoraga al frontend y al motor Python
 */

const express = require('express');
const router = express.Router();
const knowledgeBrain = require('../services/knowledgeBrain');

// Inicializar el cerebro al cargar
knowledgeBrain.initialize();

/**
 * GET /api/knowledge/
 * Endpoint base para verificar que el router está activo
 */
router.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Knowledge Brain API active',
        endpoints: [
            'GET /brain/status',
            'GET /brain/full',
            'GET /phase/:phaseId',
            'GET /skills/for/:operation',
            'GET /skills/search',
            'GET /can-operate/:operation',
            'GET /system-map',
            'GET /decision-matrix'
        ]
    });
});

/**
 * GET /api/knowledge/brain/status
 * Estado del cerebro de conocimiento
 */
router.get('/brain/status', (req, res) => {
    try {
        const status = knowledgeBrain.getStatus();
        res.json({
            success: true,
            brain: status,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/knowledge/brain/full
 * Obtiene conocimiento completo del sistema
 */
router.get('/brain/full', (req, res) => {
    try {
        const knowledge = knowledgeBrain.getFullKnowledge();
        res.json({
            success: true,
            knowledge
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/knowledge/phase/:phaseId
 * Obtiene contexto para una fase específica del ciclo contable
 * Fases válidas: setup, transactions, adjustments, closing
 */
router.get('/phase/:phaseId', (req, res) => {
    try {
        const { phaseId } = req.params;
        const context = knowledgeBrain.getPhaseContext(phaseId);

        if (!context) {
            return res.status(404).json({
                success: false,
                error: `Fase no encontrada: ${phaseId}`,
                validPhases: ['setup', 'transactions', 'adjustments', 'closing']
            });
        }

        res.json({
            success: true,
            context
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/knowledge/skills/for/:operation
 * Obtiene las skills recomendadas para una operación específica
 */
router.get('/skills/for/:operation', (req, res) => {
    try {
        const { operation } = req.params;
        const { accounts, companyId } = req.query;

        const skillsContext = knowledgeBrain.getSkillsForOperation(operation, {
            accounts: accounts ? parseInt(accounts) : undefined,
            companyId
        });

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
 * GET /api/knowledge/skills/search
 * Busca skills por contexto/palabras clave
 */
router.get('/skills/search', (req, res) => {
    try {
        const { q, context } = req.query;

        if (!q) {
            return res.status(400).json({
                success: false,
                error: 'Se requiere parámetro q (query)'
            });
        }

        const results = knowledgeBrain.searchSkillsByContext(q, { context });
        res.json({
            success: true,
            query: q,
            ...results
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/knowledge/can-operate/:operation
 * Verifica si Mahoraga puede operar en el contexto dado
 */
router.get('/can-operate/:operation', (req, res) => {
    try {
        const { operation } = req.params;
        const { accounts, companyId } = req.query;

        const permission = knowledgeBrain.canOperate(operation, {
            accounts: accounts ? parseInt(accounts) : undefined,
            companyId
        });

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
 * GET /api/knowledge/system-map
 * Obtiene el mapa del sistema (arquitectura y flujos de datos)
 */
router.get('/system-map', (req, res) => {
    try {
        const systemMap = knowledgeBrain.systemMap;
        res.json({
            success: true,
            systemMap
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/knowledge/decision-matrix
 * Obtiene la matriz de decisiones de Mahoraga
 */
router.get('/decision-matrix', (req, res) => {
    try {
        const decisionMatrix = knowledgeBrain.decisionMatrix;
        res.json({
            success: true,
            decisionMatrix
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
