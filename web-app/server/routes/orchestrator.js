/**
 * API Routes para Cognitive Orchestrator
 * Endpoints: /api/ai/orchestrate, /api/ai/feedback, /api/ai/audit/:id
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { orchestrate, createAudit } = require('../services/cognitiveOrchestrator');

/**
 * POST /api/ai/orchestrate
 * Body: { companyId, accounts: [{code, name, id?}], options }
 */
router.post('/orchestrate', async (req, res) => {
  try {
    const { companyId, accounts, structureConfig, options = {} } = req.body;
    
    // Validar input
    if (!companyId || !Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields: companyId and accounts array',
        code: 'INVALID_INPUT'
      });
    }
    
    // Validar que cada cuenta tenga code y name
    for (const acc of accounts) {
      if (!acc.code || !acc.name) {
        return res.status(400).json({
          error: 'Each account must have code and name',
          code: 'INVALID_ACCOUNT',
          account: acc
        });
      }
    }
    
    console.log(`[API] Orchestration request for company ${companyId}, ${accounts.length} accounts`);
    
    // Llamar al orquestador
    // Pasamos structureConfig dentro de las opciones para que el orquestador lo use
    const result = await orchestrate(accounts, companyId, { ...options, structureConfig });
    
    res.json({
      success: true,
      requestId: result.requestId,
      summary: result.summary,
      results: result.results
    });
    
  } catch (error) {
    console.error('[API] Orchestration error:', error);
    res.status(500).json({
      error: 'Orchestration failed',
      message: error.message,
      code: 'ORCHESTRATION_ERROR'
    });
  }
});

/**
 * POST /api/ai/feedback
 * Body: { auditId, userId, corrections: [{accountCode, field, oldValue, newValue, reason}] }
 */
router.post('/feedback', async (req, res) => {
  try {
    const { auditId, userId, corrections } = req.body;
    
    if (!auditId || !userId || !Array.isArray(corrections)) {
      return res.status(400).json({
        error: 'Missing required fields: auditId, userId, corrections array',
        code: 'INVALID_FEEDBACK'
      });
    }
    
    // Guardar feedback en audit log
    await createAudit({
      model_stage: 'feedback',
      input_payload: { auditId, userId, corrections },
      output_payload: { feedback_processed: true },
      notes: `User feedback for audit ${auditId}`,
      tags: ['feedback', 'active_learning']
    });
    
    // TODO: Enviar a pipeline de active learning
    console.log(`[API] Feedback received for audit ${auditId} by user ${userId}`);
    
    res.json({
      success: true,
      message: 'Feedback recorded for active learning',
      feedbackId: crypto.randomUUID()
    });
    
  } catch (error) {
    console.error('[API] Feedback error:', error);
    res.status(500).json({
      error: 'Failed to record feedback',
      message: error.message,
      code: 'FEEDBACK_ERROR'
    });
  }
});

/**
 * GET /api/ai/audit/:id
 * Query: ?format=json|csv
 */
router.get('/audit/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const format = req.query.format || 'json';
    
    // TODO: Implementar consulta a base de datos
    // Por ahora retorna placeholder
    
    const auditData = {
      id,
      created_at: new Date().toISOString(),
      model_stage: 'orchestrate_complete',
      input_payload: {},
      output_payload: {},
      confidence: 0.85,
      duration_ms: 1500,
      notes: 'Sample audit data'
    };
    
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.send('id,created_at,model_stage,confidence,duration_ms,notes\n');
    } else {
      res.json(auditData);
    }
    
  } catch (error) {
    console.error('[API] Audit query error:', error);
    res.status(500).json({
      error: 'Failed to fetch audit data',
      message: error.message,
      code: 'AUDIT_ERROR'
    });
  }
});

/**
 * GET /api/ai/health
 * Health check para el orquestador
 */
router.get('/health', async (req, res) => {
  try {
    // Verificar conexión a servicios
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        orchestrator: 'ok',
        database: 'ok', // TODO: verificar conexión real
        llm_service: process.env.LLM_ENRICH_ENDPOINT || 'not_configured',
        model_service: process.env.MODEL_PREDICT_ENDPOINT || 'not_configured'
      }
    };
    
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

module.exports = router;
