const { inferWithModel, logAudit } = require('./services/modelServiceAdapter');

/**
 * Minimal orchestrator wrapper used by the AI router.
 * Keeps behavior defensive: uses local heuristics via modelServiceAdapter fallback.
 */
async function orchestratePayload(payload) {
  // payload: { accounts: [{code,name,...}], context: { companyId, structureConfig } }
  const input = payload || {};
  const start = Date.now();
  try {
    const result = await inferWithModel(input);
    // optional audit already done inside inferWithModel; return minimal envelope
    return { ok: true, result, elapsed_ms: Date.now() - start };
  } catch (err) {
    // log error audit
    try { await logAudit({ model_stage: 'orchestrator_error', input_payload: input, output_payload: { error: err.message }, duration_ms: Date.now() - start, source: 'orchestrator' }); } catch (e) {}
    return { ok: false, error: err.message };
  }
}

module.exports = { orchestratePayload };
