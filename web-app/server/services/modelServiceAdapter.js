/*
 modelServiceAdapter.js
 Adapter to call either local heuristic (AccountPlanProfile) or external LLM/RAG services via Groq API.
 Usage: const { inferWithModel, logAudit } = require('./modelServiceAdapter')

 - If environment variable AI_BACKEND=llm and GROQ_API_KEY is set, it will attempt a Groq API call.
 - If AI_BACKEND=local it will run local heuristics (fast fallback).
 - Audit logging (Postgres) is optional: set POSTGRES_URL to enable saving audit entries.
*/

const fetch = require('node-fetch');
const { AccountPlanProfile } = require('../../client/src/utils/AccountPlanProfile');
const groqMonitor = require('./groqMonitor');
const mahoragaController = require('./mahoragaController');
// const { Pool } = require('pg'); // Moved to be conditional

const POSTGRES_URL = process.env.POSTGRES_URL || null;
const AI_BACKEND = process.env.AI_BACKEND || 'local';
const GROQ_API_KEY = process.env.GROQ_API_KEY || null;
const LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'https://api.groq.com/openai/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'llama-3.1-8b-instant';

let pgPool = null;
if (POSTGRES_URL) {
  // Conditionally require 'pg' only when needed
  const { Pool } = require('pg');
  pgPool = new Pool({ connectionString: POSTGRES_URL });
}

async function logAudit(entry) {
  if (!pgPool) return null;
  const q = `INSERT INTO ai_audit_logs (model_stage, input_payload, output_payload, confidence, user_action, notes, duration_ms, source, tags)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`;
  const vals = [entry.model_stage, entry.input_payload || {}, entry.output_payload || {}, entry.confidence || null, entry.user_action || null, entry.notes || null, entry.duration_ms || null, entry.source || null, entry.tags || null];
  try {
    const res = await pgPool.query(q, vals);
    return res.rows[0];
  } catch (e) {
    console.error('AI audit log failed', e.message);
    return null;
  }
}

async function llmCall(prompt, opts = {}) {
  // Si usamos Groq API, exigimos Key. Si es local (localhost o IP), permitimos sin Key.
  const isLocal = LLM_ENDPOINT.includes('localhost') || LLM_ENDPOINT.includes('127.0.0.1') || LLM_ENDPOINT.includes('::1');

  if (!isLocal && !GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured for remote endpoint');

  const url = LLM_ENDPOINT;
  const model = opts.model || LLM_MODEL;

  const body = {
    model: model,
    messages: [{ role: 'system', content: opts.system || 'You are an accounting assistant.' }, { role: 'user', content: prompt }],
    max_tokens: opts.max_tokens || 512,
    temperature: opts.temperature || 0.1
  };

  const headers = {
    'Content-Type': 'application/json'
  };
  if (GROQ_API_KEY) headers['Authorization'] = `Bearer ${GROQ_API_KEY}`;

  const startTime = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`LLM request failed ${res.status}`);
  const data = await res.json();
  const duration = Date.now() - startTime;

  // 📊 MONITOREO: Registrar uso en Groq Monitor
  if (!isLocal && data.usage) {
    const tokensInput = data.usage.prompt_tokens || Math.ceil(prompt.length / 4); // Estimación si no viene
    const tokensOutput = data.usage.completion_tokens || Math.ceil((data.choices?.[0]?.message?.content?.length || 0) / 4);

    groqMonitor.recordUsage(model, tokensInput, tokensOutput, res.ok);

    console.log(`🤖 Groq API: ${model} | Input: ${tokensInput}t | Output: ${tokensOutput}t | Cost: $${groqMonitor.recordUsage(model, 0, 0).cost?.toFixed(6) || 'N/A'}`);
  }

  return data;
}

/**
 * inferWithModel
 * - input: { accounts: [{code,name,...}], context: {companyId, structureConfig, userId} }
 * - returns: { analysis: {...}, predictions: [{code, predicted_level, predicted_parent, predicted_type, confidence}], metadata }
 */
async function inferWithModel(input) {
  const start = Date.now();
  const result = { analysis: null, predictions: [], metadata: {} };

  try {
    // Step 1: local analysis (fast)
    const accounts = input.accounts || [];
    const analysis = AccountPlanProfile.analyze(accounts, input.context && input.context.structureConfig ? input.context.structureConfig : {});
    result.analysis = analysis;

    // 🛡️ MAHORAGA SECURITY: Verificar permisos antes de usar IA
    const userId = input.context?.userId || 'system';
    const permission = mahoragaController.canActivate('ai_analysis', { accounts: accounts.length, userId });

    if (!permission.allowed) {
      console.log(`🛡️ MAHORAGA BLOCKED: ${permission.message} (User: ${userId})`);
      result.metadata.mahoraga_status = 'blocked';
      result.metadata.mahoraga_message = permission.message;
      result.metadata.requires_activation = permission.requiresUserAction;

      // Usar solo análisis local si Mahoraga está bloqueado
      result.predictions = accounts.map(a => {
        const lvl = AccountPlanProfile.calculateLevel(a.code, analysis);
        const parent = AccountPlanProfile.calculateParent(a.code, analysis);
        const guessed = AccountPlanProfile.heuristicTypeGuess(a.code, analysis?.behavior || {});
        return { code: a.code, predicted_type: guessed, predicted_level: lvl, predicted_parent: parent, confidence: 0.6 };
      });

      return result;
    }

    // Step 2: depending on backend, call LLM for semantic enrichment
    // Activamos si hay backend LLM explícito O si hay un endpoint configurado (local o remoto)
    if (AI_BACKEND === 'llm' || process.env.LLM_ENDPOINT) {
      // 🧠 MAHORAGA ACTIVATION: Registrar activación
      const activation = mahoragaController.activate('ai_analysis', userId, { accounts: accounts.length });
      result.metadata.mahoraga_activation = activation;
      result.metadata.mahoraga_status = activation.status;
      // Build a compact prompt for all accounts (truncate if too long)
      const sample = accounts.slice(0, 30).map(a => `${a.code} :: ${a.name}`).join('\n');
      
      // Permitir prompt personalizado desde el input, o usar default
      const prompt = input.promptOverride || `Given the following account codes and names, return for each line a JSON array entries with keys: code, predicted_type, predicted_level (int), predicted_parent (nullable), confidence (0-1).\n\n${sample}`;
      
      const llmResp = await llmCall(prompt, { max_tokens: 800 });
      // Best-effort parse: try to find JSON blob in response
      const txt = (llmResp?.choices?.[0]?.message?.content) || JSON.stringify(llmResp);
      let parsed = null;
      try {
        parsed = JSON.parse(txt);
      } catch (e) {
        // If not pure JSON, attempt to extract JSON substring
        const m = txt.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (m) {
          try { parsed = JSON.parse(m[0]); } catch (e2) { parsed = null; }
        }
      }
      if (Array.isArray(parsed)) {
        result.predictions = parsed.map(p => ({ code: p.code, predicted_type: p.predicted_type, predicted_level: p.predicted_level, predicted_parent: p.predicted_parent, confidence: p.confidence || 0.5 }));
      }
    }

    // Step 3: if predictions empty, fallback to analysis heuristics
    if (!result.predictions || result.predictions.length === 0) {
      result.predictions = accounts.map(a => {
        const lvl = AccountPlanProfile.calculateLevel(a.code, analysis);
        const parent = AccountPlanProfile.calculateParent(a.code, analysis);
        const guessed = AccountPlanProfile.heuristicTypeGuess(a.code, analysis?.behavior || {});
        return { code: a.code, predicted_type: guessed, predicted_level: lvl, predicted_parent: parent, confidence: 0.6 };
      });
    }

    result.metadata.duration_ms = Date.now() - start;
    // Audit log
    try { await logAudit({ model_stage: AI_BACKEND, input_payload: input, output_payload: result, confidence: null, duration_ms: result.metadata.duration_ms, source: 'orchestrator' }); } catch (e) { /* continue */ }

    return result;
  } catch (err) {
    result.error = err.message;
    result.metadata.duration_ms = Date.now() - start;
    try { await logAudit({ model_stage: 'error', input_payload: input, output_payload: result, confidence: 0, duration_ms: result.metadata.duration_ms, notes: err.message, source: 'orchestrator' }); } catch (e) { /* ignore */ }
    throw err;
  }
}

module.exports = { inferWithModel, logAudit };
