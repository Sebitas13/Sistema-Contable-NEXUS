const express = require('express');
const router = express.Router();
const { inferWithModel } = require('../services/modelServiceAdapter');
const groqMonitor = require('../services/groqMonitor');
const mahoragaController = require('../services/mahoragaController');
const systemRecognition = require('../services/systemRecognition');
const skillLoader = require('../services/skillLoader');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getFiscalYearDetails } = require('../utils/serverFiscalYearUtils');
const {
  buildAiEngineUrlCandidates,
  normalizeServiceBaseUrl
} = require('../utils/aiEngineResolver');

const isDev = process.env.NODE_ENV !== 'production';
const AI_ENGINE_URL = normalizeServiceBaseUrl(
  process.env.AI_ENGINE_INTERNAL_URL ||
  process.env.AI_ENGINE_INTERNAL_URL_ALT ||
  process.env.AI_ENGINE_URL ||
  process.env.AI_ENGINE_URL_ALT ||
  (isDev ? 'http://localhost:8003' : 'http://localhost:8003')
);
const db = require('../db');
const { getExpectedToken } = require('../utils/auth');

// Cabeceras para llamadas internas (self-calls al propio backend Node y callback del motor Python).
// Cuando la auth está activa, incluyen el token interno (= sha256(APP_PASSWORD)) para pasar el gate.
const internalAuthHeaders = (extra = {}) => {
  const token = getExpectedToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
};

const MAHORAGA_PAGE_IDS = [
  'Accounts',
  'Journal',
  'Ledger',
  'TrialBalance',
  'UFV',
  'ExchangeRate',
  'Worksheet',
  'FinancialStatements'
];
const DEFAULT_MAHORAGA_PAGES = ['Journal', 'Ledger', 'FinancialStatements'];

// Helper function to promisify db.all - PROPER CALLBACK WRAPPER
const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('dbAll error:', err.message);
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const aiHealthCache = {
  payload: null,
  expiresAt: 0
};

// Circuit breaker simple (en memoria) por baseUrl para evitar golpear un upstream caído
// y amortiguar cold-starts (por ejemplo Render).
const aiEngineBreaker = new Map();
const BREAKER_FAILURE_THRESHOLD = Number(process.env.AI_ENGINE_BREAKER_FAILURE_THRESHOLD || 2);
const BREAKER_COOLDOWN_MS = Number(process.env.AI_ENGINE_BREAKER_COOLDOWN_MS || 20000);

const getBreakerState = (baseUrl) => {
  const state = aiEngineBreaker.get(baseUrl);
  if (!state) return { failures: 0, cooldownUntil: 0 };
  if (state.cooldownUntil && state.cooldownUntil <= Date.now()) {
    const refreshed = { failures: 0, cooldownUntil: 0 };
    aiEngineBreaker.set(baseUrl, refreshed);
    return refreshed;
  }
  return state;
};

const markBreakerSuccess = (baseUrl) => {
  if (!baseUrl) return;
  aiEngineBreaker.set(baseUrl, { failures: 0, cooldownUntil: 0 });
};

const markBreakerFailure = (baseUrl) => {
  if (!baseUrl) return;
  const state = getBreakerState(baseUrl);
  const failures = (state.failures || 0) + 1;
  const cooled = failures >= BREAKER_FAILURE_THRESHOLD
    ? Date.now() + BREAKER_COOLDOWN_MS
    : (state.cooldownUntil || 0);
  aiEngineBreaker.set(baseUrl, { failures, cooldownUntil: cooled });
};

const normalizeBaseUrl = normalizeServiceBaseUrl;

const resolveRequestBaseUrl = (req) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const protocol = (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0] : req.protocol) || 'http';
  const host = (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0] : req.get('host')) || '';
  return normalizeBaseUrl(host ? `${protocol}://${host}` : '');
};

const resolveRuntimeBaseUrl = (req) => {
  const runtimeBaseUrl = process.env.API_BASE_URL || resolveRequestBaseUrl(req);
  return normalizeBaseUrl(runtimeBaseUrl);
};

const buildApiBaseUrlCandidates = (req, runtimeBaseUrl, explicitBaseUrl = '') => {
  const requestBaseUrl = resolveRequestBaseUrl(req);
  const currentPort = process.env.PORT || 3001;
  const localCandidates = [
    `http://localhost:${currentPort}`,
    `http://127.0.0.1:${currentPort}`,
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://host.docker.internal:3001',
    'http://host.docker.internal:3000'
  ];

  const rawCandidates = isDev ? [
    ...localCandidates,
    explicitBaseUrl,
    runtimeBaseUrl,
    process.env.API_BASE_URL || '',
    requestBaseUrl
  ] : [
    explicitBaseUrl,
    ...localCandidates,
    runtimeBaseUrl,
    process.env.API_BASE_URL || '',
    requestBaseUrl
  ];

  const unique = [];
  const seen = new Set();
  for (const candidate of rawCandidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
};

const RETRYABLE_AI_STATUSES = new Set([429, 502, 503, 504]);
const RETRYABLE_AI_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ETIMEDOUT'
]);

const resolveAiEngineTargets = (req) => {
  return buildAiEngineUrlCandidates({
    isDevelopment: isDev,
    explicitUrls: [
      process.env.AI_ENGINE_INTERNAL_URL || '',
      process.env.AI_ENGINE_INTERNAL_URL_ALT || '',
      process.env.AI_ENGINE_URL || '',
      process.env.AI_ENGINE_URL_ALT || ''
    ],
    requestBaseUrl: resolveRequestBaseUrl(req),
    runtimeBaseUrl: resolveRuntimeBaseUrl(req)
  });
};

const callAiEngine = async (req, method, endpointPath, {
  data,
  timeout = 30000,
  maxRetriesPerCandidate = 0,
  headers = {},
  skipBreaker = false
} = {}) => {
  const { candidates, diagnostics } = resolveAiEngineTargets(req);
  const attempts = [];
  let lastError = null;

  if (!candidates.length) {
    const configError = new Error('No hay endpoints válidos configurados para el motor AI.');
    configError.aiEngineDiagnostics = diagnostics;
    throw configError;
  }

  for (const baseUrl of candidates) {
    if (!skipBreaker) {
      const breaker = getBreakerState(baseUrl);
      if (breaker.cooldownUntil && breaker.cooldownUntil > Date.now()) {
        attempts.push({
          base_url: baseUrl,
          attempt: 0,
          status: null,
          code: 'BREAKER_OPEN',
          message: `Circuit breaker activo hasta ${new Date(breaker.cooldownUntil).toISOString()}`
        });
        continue;
      }
    }

    for (let attempt = 0; attempt <= maxRetriesPerCandidate; attempt += 1) {
      try {
        const response = await axios({
          method,
          url: `${baseUrl}${endpointPath}`,
          data,
          timeout,
          headers
        });

        if (!skipBreaker) {
          markBreakerSuccess(baseUrl);
        }
        
        return {
          response,
          baseUrl,
          attempts,
          diagnostics
        };
      } catch (error) {
        lastError = error;
        const status = error.response?.status || null;
        attempts.push({
          base_url: baseUrl,
          attempt: attempt + 1,
          status,
          code: error.code || null,
          message: error.message
        });

        if (!skipBreaker) {
          markBreakerFailure(baseUrl);
        }

        const shouldRetry =
          (RETRYABLE_AI_STATUSES.has(status) || RETRYABLE_AI_ERROR_CODES.has(error.code)) &&
          attempt < maxRetriesPerCandidate;

        if (shouldRetry) {
          const retryAfterHeader = Number(error.response?.headers?.['retry-after']);
          // Backoff exponencial (1.2s, 2.4s, 4.8s, ... tope 8s) para cubrir cold-start de Render.
          const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
            ? retryAfterHeader * 1000
            : Math.min(1200 * Math.pow(2, attempt), 8000);
          await sleep(waitMs);
          continue;
        }

        break;
      }
    }
  }

  if (lastError) {
    lastError.aiEngineDiagnostics = diagnostics;
    lastError.aiEngineAttempts = attempts;
    lastError.aiEngineCandidates = candidates;
  }

  throw lastError || new Error('No se pudo completar la llamada al motor AI.');
};

// Warmup: útil para motores remotos con cold-start. No bloquea el flujo si falla,
// pero deja trazas en ai_engine_attempts para diagnóstico.
const warmupAiEngine = async (req) => {
  try {
    // Cold-start de Render: varios intentos cortos con backoff hasta que /health responda 200,
    // en vez de un único timeout largo. skipBreaker: true para no "envenenar" el circuit breaker.
    await callAiEngine(req, 'get', '/api/ai/health', {
      timeout: 30000,
      maxRetriesPerCandidate: 3,
      skipBreaker: true
    });
  } catch (error) {
    // Silencioso: la ruta principal manejará fallback. Guardamos para diagnóstico si alguien lo usa.
    return {
      success: false,
      error: error.message,
      ai_engine_attempts: error.aiEngineAttempts || [],
      ai_engine_diagnostics: error.aiEngineDiagnostics || null,
      ai_engine_candidates: error.aiEngineCandidates || []
    };
  }
  return { success: true };
};

const postToInternalApiCandidates = async (baseCandidates, endpointPath, payload, timeout = 45000) => {
  const attempts = [];
  let lastError = null;

  for (const baseUrl of baseCandidates) {
    try {
      const response = await axios.post(
        `${baseUrl}${endpointPath}`,
        payload,
        {
          timeout,
          headers: internalAuthHeaders({ 'Content-Type': 'application/json' })
        }
      );
      attempts.push({ base_url: baseUrl, status: response.status });
      return { response, baseUrl, attempts };
    } catch (error) {
      lastError = error;
      attempts.push({
        base_url: baseUrl,
        status: error.response?.status || null,
        code: error.code || null,
        message: error.message
      });
    }
  }

  if (lastError) {
    lastError.internalAttempts = attempts;
  }

  throw lastError || new Error(`No se pudo llamar al endpoint interno ${endpointPath}`);
};

const buildReportsFallbackPayload = (requestBody, companyId) => {
  const parameters = requestBody?.parameters || {};
  const defaultGestion = String(new Date().getFullYear());

  return {
    companyId: String(companyId),
    gestion: String(parameters.gestion || requestBody?.gestion || defaultGestion),
    adjParams: requestBody?.profile_schema || {},
    exchangeRate_initial: Number(parameters.ufv_initial || 0),
    exchangeRate_final: Number(parameters.ufv_final || 0)
  };
};

const parseAmount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const determineFiscalRange = async (companyId, parameters = {}) => {
  const explicitStart = parameters.fiscal_start_date || parameters.start_date || null;
  const explicitEnd = parameters.fiscal_end_date || parameters.end_date || null;
  if (explicitStart && explicitEnd) {
    return { startDate: String(explicitStart), endDate: String(explicitEnd), source: 'request' };
  }

  const gestion = String(parameters.gestion || new Date().getFullYear());
  try {
    const companyRows = await dbAll(
      'SELECT activity_type, operation_start_date FROM companies WHERE id = ? LIMIT 1',
      [companyId]
    );
    const company = companyRows?.[0] || {};
    const activityType = company.activity_type || 'Comercial';
    const operationStartDate = company.operation_start_date || null;
    const period = getFiscalYearDetails(activityType, gestion, operationStartDate);
    return {
      startDate: period.startDate,
      endDate: period.endDate,
      source: 'company'
    };
  } catch (error) {
    const fallbackStart = `${gestion}-01-01`;
    const fallbackEnd = explicitEnd || `${gestion}-12-31`;
    return {
      startDate: fallbackStart,
      endDate: fallbackEnd,
      source: 'fallback'
    };
  }
};

const normalizeReportsFallbackResponse = (fallbackData, reasonLabel, aiMeta = null) => {
  const payload = fallbackData?.data || {};
  const warning = payload.warning || `Modo contingencia activado: ${reasonLabel}`;
  return {
    success: true,
    proposedTransactions: payload.proposedTransactions || [],
    aggregate_confidence: 0.7,
    confidence: 0.7,
    reasoning: warning,
    warnings: [warning],
    processing_stats: {
      fallback_mode: true,
      source: 'reports.adjustment-entries-proposal',
      diagnostics_available: Boolean(payload.diagnostics)
    },
    adjustmentDate: payload.adjustmentDate,
    batchId: payload.batchId,
    ccFactor: payload.ccFactor,
    summary: payload.summary,
    diagnostics: payload.diagnostics,
    ai_engine_attempts: aiMeta?.ai_engine_attempts || payload.ai_engine_attempts,
    ai_engine_candidates: aiMeta?.ai_engine_candidates || payload.ai_engine_candidates,
    ai_engine_diagnostics: aiMeta?.ai_engine_diagnostics || payload.ai_engine_diagnostics,
    cycleStatus: payload.cycleStatus || 'OPEN'
  };
};

// Diagnostic Route
router.get('/test-route', (req, res) => {
  res.json({ success: true, message: "AI router is working correctly." });
});

// POST /api/ai/reload-profiles - Refresh AI Engine cache (Manual or after Restore)
router.post('/reload-profiles', async (req, res) => {
  try {
    const { companyId } = req.body;
    console.log(`🧠 AI Reload Signal: Refreshing cache for ${companyId || 'ALL companies'}`);

    // Ping the Python AI engine to let it know data changed
    const pythonResponse = await callAiEngine(req, 'post', '/api/ai/reload', {
      data: { company_id: companyId },
      timeout: 5000
    }).catch((e) => ({
      response: {
        data: {
          success: false,
          error: e.message,
          ai_engine_attempts: e.aiEngineAttempts || [],
          ai_engine_diagnostics: e.aiEngineDiagnostics || null
        }
      }
    }));

    res.json({
      success: true,
      message: 'AI reload signal processed',
      python_engine: pythonResponse.response.data
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/profile/:companyId - Get company-specific AI profile
router.get('/profile/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const profile = await getProfile(companyId);
    if (profile) {
      res.json({ success: true, profile_json: profile });
    } else {
      // If no profile, it's not an error, just return success:false. Frontend will use default.
      res.json({ success: false, message: 'No profile found for this company. Using default.' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/profile/:companyId - Save company-specific AI profile
router.post('/profile/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { profile_json } = req.body;

    if (!profile_json) {
      return res.status(400).json({ success: false, error: 'profile_json is required' });
    }

    await saveProfile(companyId, profile_json);
    res.json({ success: true, message: 'Profile saved successfully' });
  } catch (error) {
    console.error('Error saving profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper to get company profile from DB - USING PROPER PROMISE WRAPPER
const getProfile = async (companyId) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT profile_json FROM company_adjustment_profiles WHERE company_id = ?', [companyId], (err, row) => {
      if (err) {
        // Si la tabla no existe o hay otro error, retornar null en lugar de crashear,
        // pero dejar evidencia con contexto (antes se tragaba el error silenciosamente).
        console.warn(`[WARN] getProfile(companyId=${companyId}): fallo de DB, devolviendo null (${err.message})`);
        resolve(null);
      } else {
        try {
          resolve(row ? JSON.parse(row.profile_json) : null);
        } catch (parseError) {
          console.error('Error parsing profile JSON:', parseError.message);
          resolve(null);
        }
      }
    });
  });
};

// V6.0: Helper para deduplicar reglas por pattern (mantiene la primera = más reciente)
const deduplicateRules = (rules) => {
  if (!Array.isArray(rules)) return [];
  const seen = new Set();
  return rules.filter(rule => {
    const pattern = rule?.pattern;
    if (!pattern || seen.has(pattern)) return false;
    seen.add(pattern);
    return true;
  });
};

// Helper to save company profile to DB (con deduplicación automática V6.0 + ATOMICIDAD)
const saveProfile = (companyId, profileJson) => {
  // DEDUPLICAR antes de guardar
  if (profileJson.monetary_rules) {
    profileJson.monetary_rules = deduplicateRules(profileJson.monetary_rules);
  }
  if (profileJson.non_monetary_rules) {
    profileJson.non_monetary_rules = deduplicateRules(profileJson.non_monetary_rules);
  }
  if (profileJson.adaptation_events) {
    const seenEvents = new Set();
    profileJson.adaptation_events = profileJson.adaptation_events.filter(e => {
      if (!e?.id || seenEvents.has(e.id)) return false;
      seenEvents.add(e.id);
      return true;
    });
  }

  const jsonStr = JSON.stringify(profileJson);
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO company_adjustment_profiles (company_id, profile_json, version, updated_at) 
       VALUES (?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(company_id) DO UPDATE SET 
       profile_json = excluded.profile_json,
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP`,
      [companyId, jsonStr],
      (err) => {
        if (err) {
          console.error('❌ Error guardando perfil:', err.message);
          reject(err);
        } else {
          console.log(`✅ Perfil guardado para empresa ${companyId}`);
          resolve(profileJson);
        }
      }
    );
  });
};

const normalizeMahoragaPages = (rawPages) => {
  let parsedPages = rawPages;

  if (typeof parsedPages === 'string') {
    try {
      parsedPages = JSON.parse(parsedPages);
    } catch (error) {
      parsedPages = [];
    }
  }

  if (!Array.isArray(parsedPages)) {
    return [...DEFAULT_MAHORAGA_PAGES];
  }

  const normalized = Array.from(
    new Set(
      parsedPages
        .map(pageId => String(pageId || '').trim())
        .filter(pageId => MAHORAGA_PAGE_IDS.includes(pageId))
    )
  );

  return normalized.length > 0 ? normalized : [...DEFAULT_MAHORAGA_PAGES];
};

const getMahoragaPageConfig = async (companyId) => {
  const profile = await getProfile(companyId);
  return normalizeMahoragaPages(profile?.mahoraga_settings?.active_pages);
};

const buildMahoragaLearningProgress = async (companyId) => {
  if (!companyId) {
    return {
      learning_progress: {
        percentage: 0,
        current_phase: 'Genesis',
        next_milestone: 'Crear Plan de Cuentas',
        details: 'Selecciona una empresa para evaluar la madurez de gobernanza.',
        stats: {
          accounts: 0,
          operations: 0,
          adaptations: 0,
          hasClosing: false
        }
      },
      readiness: {
        learning_complete: false,
        security_configured: mahoragaController.currentMode !== mahoragaController.modes.DISABLED,
        company_context: false,
        ready: false
      }
    };
  }

  const [accountsResult, operationsResult, adaptationResult, adjustmentResult, closingResult] = await Promise.all([
    dbAll('SELECT COUNT(*) as count FROM accounts WHERE company_id = ?', [companyId]),
    dbAll('SELECT COUNT(*) as count FROM transactions WHERE company_id = ? AND (type IS NULL OR type != "Ajuste")', [companyId]),
    dbAll('SELECT COUNT(*) as count FROM mahoraga_adaptation_events WHERE company_id = ?', [companyId]),
    dbAll('SELECT COUNT(*) as count FROM transactions WHERE company_id = ? AND type = "Ajuste"', [companyId]),
    dbAll('SELECT COUNT(*) as count FROM transactions WHERE company_id = ? AND (UPPER(type) = "CIERRE" OR gloss LIKE "%Cierre de Gestión%")', [companyId])
  ]);

  const accounts = Number(accountsResult?.[0]?.count || 0);
  const operations = Number(operationsResult?.[0]?.count || 0);
  const adaptations = Number(adaptationResult?.[0]?.count || 0);
  const adjustments = Number(adjustmentResult?.[0]?.count || 0);
  const hasClosing = Number(closingResult?.[0]?.count || 0) > 0;

  const hasAccounts = accounts > 0;
  const isOperating = operations >= 5;
  const hasRitual = adaptations > 0 || adjustments > 0;
  const hasRevelation = hasClosing;

  let percentage = 0;
  let currentPhase = 'Genesis';
  let nextMilestone = 'Crear Plan de Cuentas';
  let details = 'Mahoraga esta observando el nacimiento contable de la empresa.';

  if (hasAccounts) {
    percentage += 25;
    currentPhase = 'Genesis (Configurado)';
    nextMilestone = 'Registrar Operaciones (min 5)';
    details = 'La estructura de cuentas ya existe y la gobernanza puede inspeccionar su base.';
  }

  if (isOperating) {
    percentage += 25;
    currentPhase = 'Operacion Activa';
    nextMilestone = 'Ejecutar Ritual de Ajustes';
    details = 'Ya hay movimiento real. Mahoraga puede observar patrones y consistencia operativa.';
  }

  if (hasRitual) {
    percentage += 25;
    currentPhase = 'Ritual de Acondicionamiento';
    nextMilestone = 'Generar Juicio Final (Cierre)';
    details = 'La empresa ya entrena reglas mediante ajustes y eventos de adaptacion.';
  }

  if (hasRevelation) {
    percentage += 25;
    currentPhase = 'Revelacion Completa';
    nextMilestone = 'Mantenimiento de Gobernanza';
    details = 'El ciclo contable ya llego a cierre y Mahoraga opera como observador de gobernanza.';
  }

  const readiness = {
    learning_complete: percentage >= 75,
    security_configured: mahoragaController.currentMode !== mahoragaController.modes.DISABLED,
    company_context: true,
    ready: percentage >= 75 && mahoragaController.currentMode !== mahoragaController.modes.DISABLED
  };

  return {
    learning_progress: {
      percentage,
      current_phase: currentPhase,
      next_milestone: nextMilestone,
      details,
      stats: {
        accounts,
        operations,
        adaptations,
        hasClosing
      }
    },
    readiness
  };
};

// V6.0: Helper para fusionar perfiles correctamente (arrays se concatenan, objetos se fusionan)
const mergeProfiles = (dbProfile, requestProfile) => {
  if (!dbProfile) return requestProfile || {};
  if (!requestProfile) return dbProfile;

  const merged = { ...dbProfile };

  // Fusionar arrays de reglas (las del DB tienen prioridad al inicio)
  const arrayKeys = ['monetary_rules', 'non_monetary_rules', 'suppression_rules', 'adaptation_events'];

  for (const key of arrayKeys) {
    const dbArray = dbProfile[key] || [];
    const reqArray = requestProfile[key] || [];
    // Las reglas de DB van primero
    const patterns = new Set(dbArray.map(r => r.pattern).filter(Boolean));
    const uniqueReqArray = reqArray.filter(r => !patterns.has(r.pattern));
    merged[key] = [...dbArray, ...uniqueReqArray];
  }

  // Fusionar configuraciones anidadas
  const objectKeys = ['reasoning_config', 'aitb_settings', 'depreciation_settings', 'semantic_concepts'];
  for (const key of objectKeys) {
    if (requestProfile[key]) {
      merged[key] = { ...dbProfile[key], ...requestProfile[key] };
    }
  }

  return merged;
};

// Helper to log adaptation event - V6.0 Enriched Log
const logEvent = (companyId, feedback, eventId) => {
  const actionText = `Set nature to ${feedback.correct_type} | Reason: ${feedback.error_tag || 'USER_OVERRIDE'} | Comm: ${feedback.user_comment || 'N/A'}`;

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO mahoraga_adaptation_events 
       (id, company_id, user, origin_trans, account_code, account_name, action, event_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        companyId,
        feedback.user || 'Anonymous',
        feedback.origin_trans,
        feedback.account_code,
        feedback.account_name,
        actionText,
        JSON.stringify({
          ...feedback,
          error_reason_tag: feedback.error_tag,
          user_comment: feedback.user_comment
        })
      ],
      (err) => {
        if (err) {
          console.error(`❌ Error registrando evento Mahoraga: ${err.message}`);
          reject(err);
        } else {
          console.log(`✅ Evento Mahoraga ${eventId} registrado exitosamente`);
          resolve();
        }
      }
    );
  });
};

// POST /api/ai/analyze
// body: { accounts: [{code,name,...}], context: { companyId, structureConfig } }
router.post('/analyze', async (req, res) => {
  try {
    const input = req.body;
    const result = await inferWithModel(input);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('AI analyze error', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/ai/adjustments/generate - Proxy to FastAPI AI Engine
router.post('/adjustments/generate', async (req, res) => {
  try {
    // V6.0: Inyectar perfil persistente fusionando correctamente arrays de reglas
    const companyId = req.body.parameters?.companyId || req.body.companyId;

    // Si NO se proveen cuentas, las cargamos del Ledger automáticamente (Modo Autónomo/Wizard)
    if (!req.body.accounts || req.body.accounts.length === 0) {
      if (!companyId) return res.status(400).json({ success: false, error: 'companyId is required to fetch ledger' });

      console.log(`🔍 Mahoraga: Cargando ledger automático para empresa ${companyId}...`);
      const sql = `
            SELECT 
                a.id, a.code, a.name, a.type,
                (COALESCE(SUM(te.debit), 0) - COALESCE(SUM(te.credit), 0)) as balance
            FROM accounts a
            LEFT JOIN transaction_entries te ON a.id = te.account_id
            LEFT JOIN transactions t ON te.transaction_id = t.id
            WHERE a.company_id = ?
            GROUP BY a.id
            HAVING (SUM(te.debit) > 0 OR SUM(te.credit) > 0)
        `;
      const rows = await dbAll(sql, [companyId]);
      req.body.accounts = rows.map(r => ({
        code: r.code,
        name: r.name,
        balance: Math.abs(r.balance),
        type: r.type
      }));
      console.log(`✅ Ledger cargado: ${req.body.accounts.length} cuentas encontradas.`);
    }

    if (companyId) {
      const dbProfile = await getProfile(companyId);
      // Usar mergeProfiles para no sobrescribir reglas aprendidas
      req.body.profile_schema = mergeProfiles(dbProfile, req.body.profile_schema);
      console.log(`🔄 Perfil fusionado para empresa ${companyId}: ${(req.body.profile_schema?.monetary_rules?.length || 0)} reglas M, ${(req.body.profile_schema?.non_monetary_rules?.length || 0)} reglas NM`);
    }

    await warmupAiEngine(req);

    const { response } = await callAiEngine(req, 'post', '/api/ai/adjustments/generate', {
      data: req.body,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // V6.0: If result is empty, log reasoning for debugging
    if (response.data.success === false) {
      console.warn(`⚠️ Mahoraga returned success:false. Reasoning: ${response.data.reasoning}`);
    }

    res.json(response.data);
  } catch (error) {
    console.error('AI adjustments generate error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: 'Motor AI no disponible. Usando lógica tradicional.',
        proposedTransactions: [],
        confidence: 0,
        reasoning: 'AI Engine offline',
        warnings: ['Servicio AI no disponible']
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.response?.data?.detail || error.message
      });
    }
  }
});

// GET /api/ai/health - Health check for AI Engine
router.get('/health', async (req, res) => {
  const now = Date.now();
  if (aiHealthCache.payload && aiHealthCache.expiresAt > now) {
    return res.json(aiHealthCache.payload);
  }

  try {
    const { response, baseUrl, attempts, diagnostics } = await callAiEngine(req, 'get', '/api/ai/health', {
      timeout: 65000, // Aumentado para soportar cold-start en salud
      maxRetriesPerCandidate: 1
    });
    const payload = {
      ...response.data,
      healthy: response.data?.status === 'healthy' || response.data?.healthy === true,
      ai_engine_available: true,
      ai_engine_base_url: baseUrl,
      ai_engine_attempts: attempts,
      ai_engine_diagnostics: diagnostics
    };
    aiHealthCache.payload = payload;
    aiHealthCache.expiresAt = now + 10000;
    return res.json(payload);
  } catch (error) {
    const degradedPayload = {
      status: 'degraded',
      healthy: false,
      ai_engine_available: false,
      error: 'AI Engine unavailable',
      upstream_status: error.response?.status || null,
      code: error.code || null,
      checked_at: new Date().toISOString(),
      ai_engine_attempts: error.aiEngineAttempts || [],
      ai_engine_diagnostics: error.aiEngineDiagnostics || null
    };
    aiHealthCache.payload = degradedPayload;
    aiHealthCache.expiresAt = now + 5000;
    res.json(degradedPayload);
  }
});

// POST /api/ai/adjustments/batch-validate - Proxy to FastAPI
router.post('/adjustments/batch-validate', async (req, res) => {
  try {
    const { response } = await callAiEngine(req, 'post', '/api/ai/adjustments/batch-validate', {
      data: req.body,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('AI batch validate error:', error.message);
    res.status(500).json({ error: error.response?.data?.detail || error.message });
  }
});

// POST /api/ai/adjustments/explain - Proxy to FastAPI
router.post('/adjustments/explain', async (req, res) => {
  try {
    const { response } = await callAiEngine(req, 'post', '/api/ai/adjustments/explain', {
      data: req.body,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('AI explain error:', error.message);
    res.status(500).json({ error: error.response?.data?.detail || error.message });
  }
});

// GET /api/ai/adjustments/config - Get AI Engine configuration
router.get('/adjustments/config', async (req, res) => {
  try {
    const { response } = await callAiEngine(req, 'get', '/api/ai/adjustments/config', {
      timeout: 10000
    });
    res.json(response.data);
  } catch (error) {
    console.error('AI config error:', error.message);
    res.status(500).json({ error: error.response?.data?.detail || error.message });
  }
});

// POST /api/ai/adjustments/generate-from-ledger - Proxy to FastAPI
router.post('/adjustments/generate-from-ledger', async (req, res) => {
  console.log("\n" + "=".repeat(80));
  console.log(`🚀 [LOG] Endpoint /api/ai/adjustments/generate-from-ledger HIT`);
  console.log(`⏰ [LOG] Timestamp: ${new Date().toISOString()}`);

  let companyId = req.body.company_id || req.body.parameters?.companyId || req.body.companyId;
  const runtimeBaseUrl = resolveRuntimeBaseUrl(req);

  try {
    console.log(`📄 [LOG] Body keys: ${Object.keys(req.body || {}).join(', ') || '(empty)'}`);
    console.log(`🏢 [LOG] Company ID extracted: ${companyId}`);

    if (!companyId) {
      console.error(`❌ [ERROR] 400 - No companyId provided in request.`);
      return res.status(400).json({ success: false, error: 'companyId is required' });
    }

    req.body.company_id = String(companyId);
    req.body.parameters = req.body.parameters || {};
    req.body.parameters.company_id = String(companyId);

    // Resolver URL del middleware con prioridad a la explícita del request.
    const explicitApiBaseUrl = normalizeBaseUrl(req.body.parameters.api_base_url || '');
    const apiBaseUrlCandidates = buildApiBaseUrlCandidates(req, runtimeBaseUrl, explicitApiBaseUrl);

    if (!explicitApiBaseUrl && apiBaseUrlCandidates.length > 0) {
      req.body.parameters.api_base_url = apiBaseUrlCandidates[0];
    } else if (explicitApiBaseUrl) {
      req.body.parameters.api_base_url = explicitApiBaseUrl;
    }
    req.body.parameters.api_base_url_candidates = apiBaseUrlCandidates;
    // Token interno para que el motor Python autentique su callback a /api/reports/ledger.
    const internalToken = getExpectedToken();
    if (internalToken) {
      req.body.parameters.internal_token = internalToken;
    }
    console.log(`   🌐 [LOG] Middleware base URL candidates: ${JSON.stringify(apiBaseUrlCandidates)}`);

    // V6.0: Inyectar perfil persistente fusionando correctamente arrays de reglas
    console.log(`   👤 [LOG] Fetching profile for company ${companyId}...`);
    const dbProfile = await getProfile(companyId);
    req.body.profile_schema = mergeProfiles(dbProfile, req.body.profile_schema);
    if (dbProfile) {
      console.log(`   ✅ [LOG] Profile loaded. Merged profile has ${req.body.profile_schema?.monetary_rules?.length || 0} monetary rules and ${req.body.profile_schema?.non_monetary_rules?.length || 0} non-monetary rules.`);
    } else {
      console.log(`   ⚠️ [LOG] No existing profile found for company. Using default/request profile.`);
    }

    // V8.0 AoT: Enrich with ledger trajectories if trajectory mode is requested
    const useTrajectoryMode = req.body.parameters?.use_trajectory_mode === true;
    console.log(`   🎯 [LOG] Trajectory Mode requested: ${useTrajectoryMode}`);

    if (useTrajectoryMode) {
      console.log('   [LOG] Fetching full ledger for trajectory analysis...');
      // V8.3 FIX: Use robust base URL selection for internal calls (avoid frontend host or empty runtimeBaseUrl).
      const PORT = process.env.PORT || 3001;
      const trajectoryBaseCandidates = [];
      const trajectorySeen = new Set();
      const pushTrajectoryCandidate = (candidate) => {
        const normalized = normalizeBaseUrl(candidate);
        if (!normalized || trajectorySeen.has(normalized)) return;
        trajectorySeen.add(normalized);
        trajectoryBaseCandidates.push(normalized);
      };

      pushTrajectoryCandidate(`http://localhost:${PORT}`);
      pushTrajectoryCandidate(`http://127.0.0.1:${PORT}`);
      for (const candidate of apiBaseUrlCandidates) {
        pushTrajectoryCandidate(candidate);
      }
      console.log(`   [LOG] Trajectory base URL candidates: ${JSON.stringify(trajectoryBaseCandidates)}`);
      try {
        const fiscalRange = await determineFiscalRange(companyId, req.body.parameters);
        console.log(`   [LOG] Trajectory fiscal range (${fiscalRange.source}): ${fiscalRange.startDate} -> ${fiscalRange.endDate}`);
        const ledgerDetailsParams = {
          companyId: String(companyId),
          startDate: fiscalRange.startDate,
          endDate: fiscalRange.endDate,
          excludeAdjustments: true,
          excludeClosing: true
        };

        let ledgerDetailsResponse = null;
        let trajectoryBaseUrl = '';
        const ledgerAttempts = [];

        for (const baseUrl of trajectoryBaseCandidates) {
          try {
            const candidateResponse = await axios.get(`${baseUrl}/api/reports/ledger-details`, {
              params: ledgerDetailsParams,
              timeout: 45000,
              headers: internalAuthHeaders()
            });
            ledgerAttempts.push({ base_url: baseUrl, status: candidateResponse.status });
            if (candidateResponse.status === 200) {
              ledgerDetailsResponse = candidateResponse;
              trajectoryBaseUrl = baseUrl;
              break;
            }
          } catch (candidateError) {
            ledgerAttempts.push({ base_url: baseUrl, error: candidateError.message });
          }
        }

        if (!ledgerDetailsResponse) {
          throw new Error(`ledger-details failed. Attempts: ${JSON.stringify(ledgerAttempts)}`);
        }

        if (trajectoryBaseUrl) {
          req.body.parameters.api_base_url = trajectoryBaseUrl;
        }

        console.log(`   [LOG] ledger-details base selected: ${trajectoryBaseUrl}`);
        console.log(`   [LOG] ledger-details attempts: ${JSON.stringify(ledgerAttempts)}`);

        const ledgerDetails = ledgerDetailsResponse.data?.data || [];
        console.log(`   [LOG] Received ${ledgerDetails.length} detail rows from ledger-details`);
        const uniqueDates = [...new Set(
          ledgerDetails
            .map((row) => String(row.date || '').slice(0, 10))
            .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        )];

        // V8.2 FIX: Also include the fiscal end date in the UFV batch to ensure ufv_final is cached
        const fiscalEndDate = fiscalRange.endDate;
        if (fiscalEndDate && !uniqueDates.includes(fiscalEndDate)) {
          uniqueDates.push(fiscalEndDate);
        }

        let ufvCache = {};
        if (uniqueDates.length > 0) {
          try {
            const ufvBaseUrl = trajectoryBaseUrl || trajectoryBaseCandidates[0];
            const ufvBatchResponse = await axios.post(
              `${ufvBaseUrl}/api/ufv/batch`,
              { companyId: String(companyId), dates: uniqueDates },
              {
                timeout: 30000,
                headers: internalAuthHeaders({ 'Content-Type': 'application/json' })
              }
            );
            ufvCache = ufvBatchResponse.data?.data || {};
            console.log(`   [LOG] UFV batch loaded: ${Object.keys(ufvCache).length} entries for ${uniqueDates.length} dates`);
          } catch (ufvError) {
            console.warn(`   [WARN] UFV batch lookup failed: ${ufvError.message}`);
          }
        }

        const trajectories = {};
        for (const row of ledgerDetails) {
          const accountCode = String(row.account_code || '').trim();
          const movementDate = String(row.date || '').slice(0, 10);
          if (!accountCode || !movementDate) continue;

          if (!trajectories[accountCode]) trajectories[accountCode] = [];
          trajectories[accountCode].push({
            date: movementDate,
            debit: parseAmount(row.debit),
            credit: parseAmount(row.credit),
            ufv_at_date: ufvCache[movementDate] !== undefined ? parseAmount(ufvCache[movementDate]) : null,
            gloss: row.entry_glosa || row.glosa || ''
          });
        }

        req.body.parameters.ledger_trajectories = trajectories;
        req.body.parameters.ufv_cache = ufvCache;
        req.body.parameters.trajectory_start_date = fiscalRange.startDate;
        req.body.parameters.trajectory_end_date = fiscalRange.endDate;

        const trajectoryKeys = Object.keys(trajectories);
        const sampleKeys = trajectoryKeys.slice(0, 10);
        console.log(
          `   ✅ [LOG] Trajectories ready: ${trajectoryKeys.length} cuentas, ${ledgerDetails.length} movimientos, ${Object.keys(ufvCache).length} UFV`
        );
        console.log(`   🔍 [LOG] Trajectory sample keys: ${JSON.stringify(sampleKeys)}`);
      } catch (trajectoryError) {
        console.error(`   ❌ [ERROR] Trajectory enrichment failed: ${trajectoryError.message}`);
        console.error(`   ❌ [ERROR] Stack: ${trajectoryError.stack}`);
        console.warn(`   [WARN] Fallback to balance mode (PoT). Trajectory data will be empty.`);
      }
    }

    await warmupAiEngine(req);

    console.log(`   📡 [LOG] Preparing to send request to AI Engine at: ${AI_ENGINE_URL}/api/ai/adjustments/generate-from-ledger`);
    console.log(`   📦 [LOG] Payload listo: parameters keys=[${Object.keys((req.body && req.body.parameters) || {}).join(', ')}]`);

    const aiEngineTargets = resolveAiEngineTargets(req);
    console.log(`   [LOG] AI Engine candidates: ${JSON.stringify(aiEngineTargets.candidates)}`);
    const { response, baseUrl: aiEngineBaseUrl, attempts: aiEngineAttempts } = await callAiEngine(
      req,
      'post',
      '/api/ai/adjustments/generate-from-ledger',
      {
        data: req.body,
        timeout: 120000, // Aumentado a 120s para soportar cold-start + procesamiento
        maxRetriesPerCandidate: 1,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    console.log(`   [LOG] AI Engine responded with HTTP Status: ${response.status}`);
    console.log(`   [LOG] AI Engine base selected: ${aiEngineBaseUrl}`);
    console.log(`   [LOG] AI Engine attempts: ${JSON.stringify(aiEngineAttempts)}`);
    console.log(`   [LOG] AI Engine Response Body:`, JSON.stringify(response.data, null, 2));
    console.log("=".repeat(80) + "\n");
    return res.json(response.data);

  } catch (error) {
    console.error("\n" + "=".repeat(80));
    console.error(`❌ CRITICAL [ERROR] in /generate-from-ledger endpoint`);
    console.error(`⏰ [ERROR] Timestamp: ${new Date().toISOString()}`);
    console.error(`   Message: ${error.message}`);

    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error(`   Python Response Status: ${error.response.status}`);
      console.error(`   Python Response Headers:`, JSON.stringify(error.response.headers, null, 2));
      console.error(`   Python Response Data:`, JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      // The request was made but no response was received
      console.error(`   No response received from AI Engine. Is it running at ${AI_ENGINE_URL}?`);
      console.error(`   Request details:`, error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('   Error details:', error.message);
    }
    console.error('   Stack Trace:', error.stack);
    console.error("=".repeat(80) + "\n");

    const upstreamStatus = error.response?.status || null;
    const isTransientOutage =
      RETRYABLE_AI_ERROR_CODES.has(error.code) || [429, 502, 503, 504].includes(upstreamStatus);

    if (isTransientOutage && runtimeBaseUrl && companyId) {
      try {
        const fallbackPayload = buildReportsFallbackPayload(req.body, companyId);
        console.warn(`⚠️ [LOG] AI unavailable/rate-limited. Activating fallback to /api/reports/adjustment-entries-proposal for company ${companyId}.`);
        const fallbackResponse = await axios.post(
          `${runtimeBaseUrl}/api/reports/adjustment-entries-proposal`,
          fallbackPayload,
          {
            timeout: 45000,
            headers: internalAuthHeaders({ 'Content-Type': 'application/json' })
          }
        );

        return res.json(
          normalizeReportsFallbackResponse(
            fallbackResponse.data,
            `AI no disponible o con límite de tasa (${upstreamStatus || error.code})`,
            {
              ai_engine_attempts: error.aiEngineAttempts || [],
              ai_engine_candidates: error.aiEngineCandidates || [],
              ai_engine_diagnostics: error.aiEngineDiagnostics || null
            }
          )
        );
      } catch (fallbackError) {
        console.error('❌ [ERROR] Fallback /adjustment-entries-proposal failed:', fallbackError.message);
      }
    }

    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: 'Motor AI no disponible. Verifique que el servidor Python esté corriendo.',
        proposedTransactions: [],
        confidence: 0,
      });
    } else if (error.response) {
      res.status(error.response.status || 500).json({
        success: false,
        error: error.response?.data?.detail || error.response?.data?.error || error.message,
        details: error.response?.data || 'Check server logs for detailed stack trace.'
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message,
        details: 'Check server logs for detailed stack trace.'
      });
    }
  }
});

// POST /api/ai/adjustments/feedback - Ritual of Summoning (Mahoraga Adaptation V6.0)
router.post('/adjustments/feedback', async (req, res) => {
  try {
    const companyId = req.body.company_id;
    console.log(`\n🔮 ===== MAHORAGA FEEDBACK RECIBIDO =====`);
    console.log(`   Company ID: ${companyId}`);
    console.log(`   Account: ${req.body.account_name} (${req.body.account_code})`);
    console.log(`   Correct Type: ${req.body.correct_type}`);

    // 1. Detect Conflict (Voto de Sabios)
    const recentConflicts = await new Promise((resolve) => {
      db.all(
        `SELECT user FROM mahoraga_adaptation_events 
         WHERE company_id = ? AND account_code = ? 
         AND timestamp > datetime('now', '-1 day') 
         AND user != ? AND reverted = 0`,
        [companyId, req.body.account_code, req.body.user || 'Anonymous'],
        (err, rows) => resolve(rows || [])
      );
    });

    if (recentConflicts.length > 0) {
      req.body.status = 'PENDING_REVIEW'; // Marcar para escalación
    }

    // V6.0 FIX: Obtener perfil existente y enviarlo a Python para fusión correcta
    const existingProfile = await getProfile(companyId);
    console.log(`   📦 Perfil existente en DB: ${existingProfile ? `${existingProfile.monetary_rules?.length || 0}M, ${existingProfile.non_monetary_rules?.length || 0}NM` : 'NINGUNO (nuevo)'}`);

    // Enviar el perfil existente a Python para que lo use como base
    req.body.existing_profile = existingProfile || {};

    console.log(`   📡 Enviando a Python AI Engine...`);
    const { response } = await callAiEngine(req, 'post', '/api/ai/adjustments/feedback', {
      data: req.body,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });

    const result = response.data;
    console.log(`   ✅ Respuesta de Python: success=${result.success}`);
    console.log(`   📋 Reglas en updated_profile_schema:`);
    console.log(`      - monetary_rules: ${result.updated_profile_schema?.monetary_rules?.length || 0}`);
    console.log(`      - non_monetary_rules: ${result.updated_profile_schema?.non_monetary_rules?.length || 0}`);
    console.log(`   💡 new_rule_generated: ${result.new_rule_generated || 'N/A'}`);

    if (result.success && result.updated_profile_schema) {
      // 2. Persistir Perfil en DB
      console.log(`   💾 Guardando perfil en DB para empresa ${companyId}...`);
      const savedProfile = await saveProfile(companyId, result.updated_profile_schema);
      console.log(`   ✅ Perfil guardado! Verificando reglas guardadas:`);
      console.log(`      - monetary_rules: ${savedProfile?.monetary_rules?.length || 0}`);
      console.log(`      - non_monetary_rules: ${savedProfile?.non_monetary_rules?.length || 0}`);

      // 3. Log Evento (usando el perfil ya guardado para consistencia)
      const lastEvent = savedProfile.adaptation_events && savedProfile.adaptation_events.length > 0
        ? savedProfile.adaptation_events[savedProfile.adaptation_events.length - 1]
        : null;
      const eventId = lastEvent?.id || `EVT-${Date.now()}`;
      await logEvent(companyId, req.body, eventId);

      if (recentConflicts.length > 0) {
        result.warnings.push(`CONFLICTO: Otro usuario adaptó esta cuenta recientemente. La regla queda en REVISIÓN ADMIN.`);
      }

      // Devolver el perfil guardado para asegurar que el frontend tiene la versión correcta.
      // Esto es crucial para la Fase 1: Corrección de la Persistencia.
      res.json({ ...result, updated_profile_schema: savedProfile });

    } else {
      res.json(result);
    }
  } catch (error) {
    console.error('AI feedback error:', error.message);
    res.status(500).json({ error: error.response?.data?.detail || error.message });
  }
});

// GET /api/ai/adjustments/chronology/:companyId
router.get('/adjustments/chronology/:companyId', async (req, res) => {
  try {
    // Retornar eventos ÚNICOS por account_name (el más reciente de cada cuenta)
    const events = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM mahoraga_adaptation_events 
         WHERE company_id = ? 
         AND id IN (
           SELECT MAX(id) FROM mahoraga_adaptation_events 
           WHERE company_id = ? 
           GROUP BY account_name
         )
         ORDER BY timestamp DESC LIMIT 50`,
        [req.params.companyId, req.params.companyId],
        (err, rows) => {
          if (err) reject(err);
          resolve(rows);
        }
      );
    });
    res.json({ success: true, events });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/ai/adjustments/chronology/:companyId/cleanup - Limpiar duplicados - LIBSQL PROMISES VERSION
router.delete('/adjustments/chronology/:companyId/cleanup', async (req, res) => {
  try {
    // Eliminar duplicados, mantener solo el más reciente por account_name
    const result = await db.run(
      `DELETE FROM mahoraga_adaptation_events
       WHERE company_id = ?
       AND id NOT IN (
         SELECT MAX(id) FROM mahoraga_adaptation_events
         WHERE company_id = ?
         GROUP BY account_name
       )`,
      [req.params.companyId, req.params.companyId]
    );

    console.log(`🧹 Limpiados ${result.changes} eventos duplicados de cronología`);
    res.json({ success: true, message: 'Duplicados eliminados', cleaned: result.changes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/adjustments/confirm - Persist confirmed adjustments
router.post('/adjustments/confirm', async (req, res) => {
  const { companyId, transactions, endDate } = req.body;

  if (!companyId || !transactions || !Array.isArray(transactions) || !endDate) {
    return res.status(400).json({ success: false, error: 'Missing required fields: companyId, transactions, endDate.' });
  }

  try {
    const batchPayload = {
      companyId,
      transactions: transactions.map(t => ({
        ...t,
        date: endDate,
        type: t.type || 'AJUSTE', // Default to AJUSTE
        entries: t.entries.map(e => ({
          ...e,
          accountId: e.accountId || e.account_code || e.accountCode, // Ensure accountId is present
        }))
      }))
    };

    // Make an internal call to the batch transaction endpoint
    const response = await axios.post(`${process.env.API_BASE_URL || 'http://localhost:3001'}/api/transactions/batch`, batchPayload, {
      headers: internalAuthHeaders({ 'Content-Type': 'application/json' })
    });

    res.status(201).json({ success: true, message: 'Ajustes guardados exitosamente.', data: response.data });

  } catch (error) {
    console.error('Error confirming adjustments and saving transactions:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: 'Failed to save adjustments.', details: error.response?.data || error.message });
  }
});

// 🔔 DASHBOARD DE MONITOREO GROQ - NUEVOS ENDPOINTS

// GET /api/ai/monitor/dashboard - Dashboard completo de uso
router.get('/monitor/dashboard', async (req, res) => {
  try {
    const report = groqMonitor.generateReport();
    res.json({
      success: true,
      dashboard: report,
      mahoraga_status: {
        skills_loaded: skillLoader.getHealthStats().totalSkills,
        adaptation_events_today: 0, // TODO: Implementar contador
        companies_with_profiles: 0 // TODO: Implementar contador
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/monitor/stats - Estadísticas rápidas
router.get('/monitor/stats', async (req, res) => {
  try {
    const stats = groqMonitor.getUsageStats();
    res.json({
      success: true,
      current_model: stats.current_model,
      daily_cost: stats.daily.cost,
      daily_usage_percent: stats.daily.usage_percent,
      session_requests: stats.session.requests,
      status: stats.daily.status
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/monitor/models - Lista de modelos disponibles
router.get('/monitor/models', async (req, res) => {
  try {
    const stats = groqMonitor.getUsageStats();
    res.json({
      success: true,
      models: stats.available_models,
      recommendations: groqMonitor.getModelRecommendations()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/monitor/switch-model - Cambiar modelo activo
router.post('/monitor/switch-model', async (req, res) => {
  try {
    const { modelId } = req.body;
    const success = groqMonitor.switchModel(modelId);
    if (success) {
      res.json({
        success: true,
        message: `Modelo cambiado a ${modelId}`,
        new_model: groqMonitor.getUsageStats().current_model
      });
    } else {
      res.status(400).json({
        success: false,
        error: `Modelo ${modelId} no disponible`
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/monitor/alerts - Alertas activas
router.get('/monitor/alerts', async (req, res) => {
  try {
    const report = groqMonitor.generateReport();
    res.json({
      success: true,
      alerts: report.alerts,
      recommendations: report.recommendations
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🧠 MAHORAGA CONTROL ENDPOINTS - Sistema de Seguridad

// GET /api/ai/mahoraga/status - Estado actual de Mahoraga
router.get('/mahoraga/status', async (req, res) => {
  try {
    const status = mahoragaController.getStatus();
    res.json({
      success: true,
      mahoraga: status,
      security_active: true
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/mahoraga/activate - Activar Mahoraga para una operación
router.post('/mahoraga/activate', async (req, res) => {
  try {
    const { operation, userId, context } = req.body;

    if (!operation || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Se requieren operation y userId'
      });
    }

    const activation = mahoragaController.activate(operation, userId, context || {});
    res.json({
      success: true,
      activation,
      message: activation.status === 'PENDING_USER_CONFIRMATION'
        ? 'Activación pendiente de confirmación del usuario'
        : 'Mahoraga activado exitosamente'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/mahoraga/confirm - Confirmar activación pendiente
router.post('/mahoraga/confirm', async (req, res) => {
  try {
    const { activationId, userId } = req.body;

    if (!activationId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Se requieren activationId y userId'
      });
    }

    const activation = mahoragaController.confirmActivation(activationId, userId);
    res.json({
      success: true,
      activation,
      message: 'Activación confirmada exitosamente'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/mahoraga/reject - Rechazar activación
router.post('/mahoraga/reject', async (req, res) => {
  try {
    const { activationId, userId, reason } = req.body;

    if (!activationId || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Se requieren activationId y userId'
      });
    }

    const activation = mahoragaController.rejectActivation(activationId, userId, reason);
    res.json({
      success: true,
      activation,
      message: 'Activación rechazada'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/mahoraga/change-mode - Cambiar modo de operación
router.post('/mahoraga/change-mode', async (req, res) => {
  try {
    const { newMode, userId, reason } = req.body;

    if (!newMode || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Se requieren newMode y userId'
      });
    }

    const result = mahoragaController.changeMode(newMode, userId, reason);
    res.json({
      success: true,
      mode_change: result,
      message: `Modo cambiado de ${result.oldMode} a ${result.newMode}`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/mahoraga/emergency-stop - Parada de emergencia
router.post('/mahoraga/emergency-stop', async (req, res) => {
  try {
    const { userId, reason } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere userId'
      });
    }

    const result = mahoragaController.emergencyStop(userId, reason);
    res.json({
      success: true,
      emergency_stop: result,
      message: '🛑 MODO DE EMERGENCIA ACTIVADO - Todas las operaciones de Mahoraga detenidas'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/mahoraga/history - Historial de activaciones
router.get('/mahoraga/history', async (req, res) => {
  try {
    const { limit, userId } = req.query;
    const history = mahoragaController.getActivationHistory(
      limit ? parseInt(limit) : 50,
      userId || null
    );

    res.json({
      success: true,
      history,
      total: history.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/mahoraga/can-activate - Verificar si se puede activar una operación
router.get('/mahoraga/can-activate', async (req, res) => {
  try {
    const { operation, userId, accounts } = req.query;

    if (!operation) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere el parámetro operation'
      });
    }

    const permission = mahoragaController.canActivate(operation, {
      accounts: accounts ? parseInt(accounts) : undefined,
      userId: userId || 'system'
    });

    res.json({
      success: true,
      can_activate: permission.allowed,
      permission,
      message: permission.message
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🧠 SISTEMA DE RECONOCIMIENTO Y APRENDIZAJE

// GET /api/ai/recognition/status - Estado de aprendizaje de Mahoraga
router.get('/recognition/status', async (req, res) => {
  try {
    const { companyId } = req.query;
    const learningState = await buildMahoragaLearningProgress(companyId);

    res.json({
      success: true,
      learning_progress: learningState.learning_progress,
      readiness: learningState.readiness,
      current_phase: learningState.learning_progress.current_phase
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/mahoraga/maturity/:companyId - Madurez viva (4 fases con % real + cognicion)
// Fuente unica para la tarjeta de Gobernanza de Settings: reutiliza el calculo real de
// buildMahoragaLearningProgress y agrega el conteo de reglas aprendidas (Cognicion).
router.get('/mahoraga/maturity/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const state = await buildMahoragaLearningProgress(companyId);
    const lp = state.learning_progress;

    let monetaryRules = 0;
    let nonMonetaryRules = 0;
    try {
      const profile = await getProfile(companyId);
      monetaryRules = Array.isArray(profile?.monetary_rules) ? profile.monetary_rules.length : 0;
      nonMonetaryRules = Array.isArray(profile?.non_monetary_rules) ? profile.non_monetary_rules.length : 0;
    } catch (profileErr) {
      console.warn(`[WARN] maturity(companyId=${companyId}): perfil no disponible (${profileErr.message})`);
    }

    const phases = [
      { id: 'GENESIS', label: 'GENESIS', sub: 'Cimientos', threshold: 25 },
      { id: 'OPERACION', label: 'OPERACION', sub: 'Hechos Reales', threshold: 50 },
      { id: 'RITUAL', label: 'RITUAL', sub: 'Ajustes/SCL', threshold: 75 },
      { id: 'REVELACION', label: 'REVELACION', sub: 'Juicio Final', threshold: 100 }
    ].map(phase => ({ ...phase, completed: lp.percentage >= phase.threshold }));

    res.json({
      success: true,
      companyId: Number(companyId) || companyId,
      percentage: lp.percentage,
      current_phase: lp.current_phase,
      next_milestone: lp.next_milestone,
      details: lp.details,
      phases,
      stats: lp.stats,
      readiness: state.readiness,
      cognition: {
        monetary_rules: monetaryRules,
        non_monetary_rules: nonMonetaryRules,
        total: monetaryRules + nonMonetaryRules
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/recognition/teach/:phase - Enseñar una fase específica
router.get('/recognition/teach/:phase', async (req, res) => {
  try {
    const { phase } = req.params;
    const { companyId } = req.query;

    const lesson = systemRecognition.teachPhase(phase, companyId);

    if (lesson.error) {
      return res.status(400).json({ success: false, error: lesson.error });
    }

    res.json({
      success: true,
      lesson
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/recognition/advance - Avanzar a la siguiente fase
router.post('/recognition/advance', async (req, res) => {
  try {
    const { companyId } = req.body;

    const result = systemRecognition.advancePhase(companyId);

    res.json({
      success: true,
      advancement: result
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/recognition/preview - Preview de búsquedas antes de ejecutar
router.get('/recognition/preview', async (req, res) => {
  try {
    const { operation, accounts, complexity, data_size } = req.query;

    if (!operation) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere el parámetro operation'
      });
    }

    const context = {
      accounts: accounts ? parseInt(accounts) : 0,
      complexity: complexity || 'medium',
      data_size: data_size || 'small'
    };

    const preview = systemRecognition.getSearchPreview(operation, context);

    res.json({
      success: true,
      preview,
      warnings: preview.resource_usage.api_calls_estimated > 10 ?
        ['Alto número de llamadas API - considerar procesamiento por lotes'] : []
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/recognition/knowledge/:aspect - Obtener conocimiento específico del sistema
router.get('/recognition/knowledge/:aspect', async (req, res) => {
  try {
    const { aspect } = req.params;
    const knowledge = systemRecognition.systemKnowledge;

    if (!knowledge[aspect]) {
      return res.status(404).json({
        success: false,
        error: `Aspecto de conocimiento no encontrado: ${aspect}`
      });
    }

    res.json({
      success: true,
      aspect,
      knowledge: knowledge[aspect]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/mahoraga/insights - Live Insights from Mahoraga
router.get('/mahoraga/insights', async (req, res) => {
  try {
    const companyId = req.query.companyId;
    const insights = [];

    // Rule 1: Check for unmatched trial balance
    const tb = await new Promise((resolve) => {
      db.get(`
        SELECT SUM(debit) as total_debit, SUM(credit) as total_credit 
        FROM transaction_entries te
        JOIN transactions t ON te.transaction_id = t.id
        WHERE t.company_id = ?`, [companyId], (err, row) => resolve(row));
    });

    if (tb && Math.abs(tb.total_debit - tb.total_credit) > 0.01) {
      insights.push({
        type: 'warning',
        title: 'Asimetría en Partida Doble',
        message: `Se detectó una diferencia de Bs ${(tb.total_debit - tb.total_credit).toFixed(2)} en el balance global. Mahoraga sugiere revisar el asiento inicial.`,
        skill: 'AuditBalance'
      });
    }

    // Rule 2: Check for missing AITB profiles
    const profile = await getProfile(companyId);
    if (!profile || !profile.monetary_rules || profile.monetary_rules.length < 3) {
      insights.push({
        type: 'info',
        title: 'Aprendizaje Pendiente',
        message: 'Mahoraga aún no ha aprendido suficientes patrones de cuentas para esta empresa. Realiza ajustes manuales para entrenar la rueda.',
        skill: 'SystemRecognition'
      });
    }

    res.json({ success: true, insights });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/skills/health', async (req, res) => {
  try {
    res.json({
      success: true,
      stats: skillLoader.getHealthStats()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/skills/search', async (req, res) => {
  try {
    const {
      q = '',
      limit = 20,
      offset = 0
    } = req.query;
    const catalog = skillLoader.searchCatalog(q, { limit, offset });

    res.json({
      success: true,
      query: typeof q === 'string' ? q.trim() : '',
      totalResults: catalog.totalResults,
      limit: Math.max(1, parseInt(limit, 10) || 20),
      offset: Math.max(0, parseInt(offset, 10) || 0),
      results: catalog.results
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/mahoraga/config/:companyId - Get specific activation config
router.get('/mahoraga/config/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const activePages = await getMahoragaPageConfig(companyId);
    res.json({
      success: true,
      active_pages: activePages,
      valid_page_ids: MAHORAGA_PAGE_IDS
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/mahoraga/config/:companyId - Update activation config
router.post('/mahoraga/config/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const normalizedPages = normalizeMahoragaPages(req.body?.active_pages);

    const dbProfile = await getProfile(companyId) || {};
    dbProfile.mahoraga_settings = {
      ...(dbProfile.mahoraga_settings || {}),
      active_pages: normalizedPages
    };

    await saveProfile(companyId, dbProfile);
    res.json({
      success: true,
      active_pages: normalizedPages,
      valid_page_ids: MAHORAGA_PAGE_IDS
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
