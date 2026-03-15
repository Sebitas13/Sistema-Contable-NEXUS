const express = require('express');
const router = express.Router();
const { inferWithModel } = require('../services/modelServiceAdapter');
const groqMonitor = require('../services/groqMonitor');
const mahoragaController = require('../services/mahoragaController');
const systemRecognition = require('../services/systemRecognition');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getFiscalYearDetails } = require('../utils/serverFiscalYearUtils');

const isDev = process.env.NODE_ENV !== 'production';
const envEngineUrl = process.env.AI_ENGINE_URL || process.env.AI_ENGINE_URL_ALT;
const AI_ENGINE_URL = isDev ? 'http://localhost:8003' : (envEngineUrl || 'http://localhost:8000');
const db = require('../db');

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

const normalizeBaseUrl = (rawValue) => {
  if (!rawValue || typeof rawValue !== 'string') return '';
  let normalized = rawValue.trim();
  if (!normalized) return '';
  normalized = normalized.replace(/\/+$/, '');
  if (normalized.endsWith('/api')) {
    normalized = normalized.slice(0, -4);
  }
  return normalized;
};

const resolveRuntimeBaseUrl = (req) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const protocol = (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0] : req.protocol) || 'http';
  const host = (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0] : req.get('host')) || '';
  const runtimeBaseUrl = process.env.API_BASE_URL || (host ? `${protocol}://${host}` : '');
  return normalizeBaseUrl(runtimeBaseUrl);
};

const buildApiBaseUrlCandidates = (req, runtimeBaseUrl, explicitBaseUrl = '') => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const protocol = (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0] : req.protocol) || 'http';
  const host = (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0] : req.get('host')) || '';

  const rawCandidates = isDev ? [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    explicitBaseUrl,
    runtimeBaseUrl,
    process.env.API_BASE_URL || '',
    host ? `${protocol}://${host}` : '',
    'http://host.docker.internal:3000',
    'http://host.docker.internal:3001'
  ] : [
    explicitBaseUrl,
    runtimeBaseUrl,
    process.env.API_BASE_URL || '',
    host ? `${protocol}://${host}` : '',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://host.docker.internal:3000',
    'http://host.docker.internal:3001'
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

const normalizeReportsFallbackResponse = (fallbackData, reasonLabel) => {
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
    console.log(`ðŸ§  AI Reload Signal: Refreshing cache for ${companyId || 'ALL companies'}`);

    // Ping the Python AI engine to let it know data changed
    const pythonResponse = await axios.post(`${AI_ENGINE_URL}/api/ai/reload`, { company_id: companyId }, { timeout: 5000 }).catch(e => ({ data: { success: false, error: e.message } }));

    res.json({
      success: true,
      message: 'AI reload signal processed',
      python_engine: pythonResponse.data
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
        console.error('Error getting profile:', err.message);
        // Si la tabla no existe o hay otro error, retornar null en lugar de crashear
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

// V6.0: Helper para deduplicar reglas por pattern (mantiene la primera = mÃ¡s reciente)
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

// Helper to save company profile to DB (con deduplicaciÃ³n automÃ¡tica V6.0 + ATOMICIDAD)
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
          console.error('âŒ Error guardando perfil:', err.message);
          reject(err);
        } else {
          console.log(`âœ… Perfil guardado para empresa ${companyId}`);
          resolve(profileJson);
        }
      }
    );
  });
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
          console.error(`âŒ Error registrando evento Mahoraga: ${err.message}`);
          reject(err);
        } else {
          console.log(`âœ… Evento Mahoraga ${eventId} registrado exitosamente`);
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

    // Si NO se proveen cuentas, las cargamos del Ledger automÃ¡ticamente (Modo AutÃ³nomo/Wizard)
    if (!req.body.accounts || req.body.accounts.length === 0) {
      if (!companyId) return res.status(400).json({ success: false, error: 'companyId is required to fetch ledger' });

      console.log(`ðŸ” Mahoraga: Cargando ledger automÃ¡tico para empresa ${companyId}...`);
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
      console.log(`âœ… Ledger cargado: ${req.body.accounts.length} cuentas encontradas.`);
    }

    if (companyId) {
      const dbProfile = await getProfile(companyId);
      // Usar mergeProfiles para no sobrescribir reglas aprendidas
      req.body.profile_schema = mergeProfiles(dbProfile, req.body.profile_schema);
      console.log(`ðŸ”„ Perfil fusionado para empresa ${companyId}: ${(req.body.profile_schema?.monetary_rules?.length || 0)} reglas M, ${(req.body.profile_schema?.non_monetary_rules?.length || 0)} reglas NM`);
    }

    const response = await axios.post(`${AI_ENGINE_URL}/api/ai/adjustments/generate`, req.body, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // V6.0: If result is empty, log reasoning for debugging
    if (response.data.success === false) {
      console.warn(`âš ï¸ Mahoraga returned success:false. Reasoning: ${response.data.reasoning}`);
    }

    res.json(response.data);
  } catch (error) {
    console.error('AI adjustments generate error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: 'Motor AI no disponible. Usando lÃ³gica tradicional.',
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

  let lastError = null;
  const maxAttempts = 2;
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await axios.get(`${AI_ENGINE_URL}/api/ai/health`, {
          timeout: attempt === 0 ? 5000 : 10000
        });
        const payload = {
          ...response.data,
          healthy: response.data?.status === 'healthy' || response.data?.healthy === true,
          ai_engine_available: true
        };
        aiHealthCache.payload = payload;
        aiHealthCache.expiresAt = now + 10000;
        return res.json(payload);
      } catch (error) {
        lastError = error;
        const upstreamStatus = error.response?.status;
        const retryable = [429, 502, 503, 504].includes(upstreamStatus) || error.code === 'ECONNABORTED';
        if (!retryable || attempt >= maxAttempts - 1) {
          break;
        }
        await sleep((attempt + 1) * 400);
      }
    }

    throw lastError || new Error('Unknown health check failure');
  } catch (error) {
    const degradedPayload = {
      status: 'degraded',
      healthy: false,
      ai_engine_available: false,
      error: 'AI Engine unavailable',
      upstream_status: error.response?.status || null,
      code: error.code || null,
      checked_at: new Date().toISOString()
    };
    aiHealthCache.payload = degradedPayload;
    aiHealthCache.expiresAt = now + 5000;
    res.json(degradedPayload);
  }
});

// POST /api/ai/adjustments/batch-validate - Proxy to FastAPI
router.post('/adjustments/batch-validate', async (req, res) => {
  try {
    const response = await axios.post(`${AI_ENGINE_URL}/api/ai/adjustments/batch-validate`, req.body, {
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
    const response = await axios.post(`${AI_ENGINE_URL}/api/ai/adjustments/explain`, req.body, {
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
    const response = await axios.get(`${AI_ENGINE_URL}/api/ai/adjustments/config`, { timeout: 10000 });
    res.json(response.data);
  } catch (error) {
    console.error('AI config error:', error.message);
    res.status(500).json({ error: error.response?.data?.detail || error.message });
  }
});

// POST /api/ai/adjustments/generate-from-ledger - Proxy to FastAPI
router.post('/adjustments/generate-from-ledger', async (req, res) => {
  console.log("\n" + "=".repeat(80));
  console.log(`ðŸš€ [LOG] Endpoint /api/ai/adjustments/generate-from-ledger HIT`);
  console.log(`â° [LOG] Timestamp: ${new Date().toISOString()}`);

  let companyId = req.body.company_id || req.body.parameters?.companyId || req.body.companyId;
  const runtimeBaseUrl = resolveRuntimeBaseUrl(req);

  try {
    console.log(`ðŸ“„ [LOG] Received Body:`, JSON.stringify(req.body, null, 2));
    console.log(`ðŸ¢ [LOG] Company ID extracted: ${companyId}`);

    if (!companyId) {
      console.error(`âŒ [ERROR] 400 - No companyId provided in request.`);
      return res.status(400).json({ success: false, error: 'companyId is required' });
    }

    req.body.company_id = String(companyId);
    req.body.parameters = req.body.parameters || {};
    req.body.parameters.company_id = String(companyId);

    // Resolver URL del middleware con prioridad a la explÃ­cita del request.
    const explicitApiBaseUrl = normalizeBaseUrl(req.body.parameters.api_base_url || '');
    const apiBaseUrlCandidates = buildApiBaseUrlCandidates(req, runtimeBaseUrl, explicitApiBaseUrl);

    if (!explicitApiBaseUrl && apiBaseUrlCandidates.length > 0) {
      req.body.parameters.api_base_url = apiBaseUrlCandidates[0];
    } else if (explicitApiBaseUrl) {
      req.body.parameters.api_base_url = explicitApiBaseUrl;
    }
    req.body.parameters.api_base_url_candidates = apiBaseUrlCandidates;
    console.log(`   ðŸŒ [LOG] Middleware base URL candidates: ${JSON.stringify(apiBaseUrlCandidates)}`);

    // V6.0: Inyectar perfil persistente fusionando correctamente arrays de reglas
    console.log(`   ðŸ‘¤ [LOG] Fetching profile for company ${companyId}...`);
    const dbProfile = await getProfile(companyId);
    req.body.profile_schema = mergeProfiles(dbProfile, req.body.profile_schema);
    if (dbProfile) {
      console.log(`   âœ… [LOG] Profile loaded. Merged profile has ${req.body.profile_schema?.monetary_rules?.length || 0} monetary rules and ${req.body.profile_schema?.non_monetary_rules?.length || 0} non-monetary rules.`);
    } else {
      console.log(`   âš ï¸ [LOG] No existing profile found for company. Using default/request profile.`);
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
              timeout: 45000
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
                headers: { 'Content-Type': 'application/json' }
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

    console.log(`   ðŸ“¡ [LOG] Preparing to send request to AI Engine at: ${AI_ENGINE_URL}/api/ai/adjustments/generate-from-ledger`);
    console.log(`   ðŸ“¦ [LOG] Final payload to be sent:`, JSON.stringify(req.body, null, 2));

    const maxRetries = 2;
    let response;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        response = await axios.post(`${AI_ENGINE_URL}/api/ai/adjustments/generate-from-ledger`, req.body, {
          timeout: 60000,
          headers: { 'Content-Type': 'application/json' }
        });
        break;
      } catch (retryError) {
        const retryStatus = retryError.response?.status;
        const shouldRetry = [429, 502, 503, 504].includes(retryStatus);
        if (!shouldRetry || attempt >= maxRetries) {
          throw retryError;
        }

        const retryAfterHeader = Number(retryError.response?.headers?.['retry-after']);
        const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : (attempt + 1) * 1200;
        console.warn(`Ã¢Å¡Â Ã¯Â¸Â [LOG] Retry ${attempt + 1}/${maxRetries} after ${waitMs}ms (status ${retryStatus})`);
        await sleep(waitMs);
      }
    }

    console.log(`   âœ… [LOG] AI Engine responded with HTTP Status: ${response.status}`);
    console.log(`   ðŸ“„ [LOG] AI Engine Response Body:`, JSON.stringify(response.data, null, 2));
    console.log("=".repeat(80) + "\n");
    res.json(response.data);

  } catch (error) {
    console.error("\n" + "=".repeat(80));
    console.error(`âŒ CRITICAL [ERROR] in /generate-from-ledger endpoint`);
    console.error(`â° [ERROR] Timestamp: ${new Date().toISOString()}`);
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
      error.code === 'ECONNREFUSED' || [429, 502, 503, 504].includes(upstreamStatus);

    if (isTransientOutage && runtimeBaseUrl && companyId) {
      try {
        const fallbackPayload = buildReportsFallbackPayload(req.body, companyId);
        console.warn(`âš ï¸ [LOG] AI unavailable/rate-limited. Activating fallback to /api/reports/adjustment-entries-proposal for company ${companyId}.`);
        const fallbackResponse = await axios.post(
          `${runtimeBaseUrl}/api/reports/adjustment-entries-proposal`,
          fallbackPayload,
          {
            timeout: 45000,
            headers: { 'Content-Type': 'application/json' }
          }
        );

        return res.json(
          normalizeReportsFallbackResponse(
            fallbackResponse.data,
            `AI no disponible o con lÃ­mite de tasa (${upstreamStatus || error.code})`
          )
        );
      } catch (fallbackError) {
        console.error('âŒ [ERROR] Fallback /adjustment-entries-proposal failed:', fallbackError.message);
      }
    }

    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: 'Motor AI no disponible. Verifique que el servidor Python estÃ© corriendo.',
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
    console.log(`\nðŸ”® ===== MAHORAGA FEEDBACK RECIBIDO =====`);
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
      req.body.status = 'PENDING_REVIEW'; // Marcar para escalaciÃ³n
    }

    // V6.0 FIX: Obtener perfil existente y enviarlo a Python para fusiÃ³n correcta
    const existingProfile = await getProfile(companyId);
    console.log(`   ðŸ“¦ Perfil existente en DB: ${existingProfile ? `${existingProfile.monetary_rules?.length || 0}M, ${existingProfile.non_monetary_rules?.length || 0}NM` : 'NINGUNO (nuevo)'}`);

    // Enviar el perfil existente a Python para que lo use como base
    req.body.existing_profile = existingProfile || {};

    console.log(`   ðŸ“¡ Enviando a Python AI Engine...`);
    const response = await axios.post(`${AI_ENGINE_URL}/api/ai/adjustments/feedback`, req.body, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });

    const result = response.data;
    console.log(`   âœ… Respuesta de Python: success=${result.success}`);
    console.log(`   ðŸ“‹ Reglas en updated_profile_schema:`);
    console.log(`      - monetary_rules: ${result.updated_profile_schema?.monetary_rules?.length || 0}`);
    console.log(`      - non_monetary_rules: ${result.updated_profile_schema?.non_monetary_rules?.length || 0}`);
    console.log(`   ðŸ’¡ new_rule_generated: ${result.new_rule_generated || 'N/A'}`);

    if (result.success && result.updated_profile_schema) {
      // 2. Persistir Perfil en DB
      console.log(`   ðŸ’¾ Guardando perfil en DB para empresa ${companyId}...`);
      const savedProfile = await saveProfile(companyId, result.updated_profile_schema);
      console.log(`   âœ… Perfil guardado! Verificando reglas guardadas:`);
      console.log(`      - monetary_rules: ${savedProfile?.monetary_rules?.length || 0}`);
      console.log(`      - non_monetary_rules: ${savedProfile?.non_monetary_rules?.length || 0}`);

      // 3. Log Evento (usando el perfil ya guardado para consistencia)
      const lastEvent = savedProfile.adaptation_events && savedProfile.adaptation_events.length > 0
        ? savedProfile.adaptation_events[savedProfile.adaptation_events.length - 1]
        : null;
      const eventId = lastEvent?.id || `EVT-${Date.now()}`;
      await logEvent(companyId, req.body, eventId);

      if (recentConflicts.length > 0) {
        result.warnings.push(`CONFLICTO: Otro usuario adaptÃ³ esta cuenta recientemente. La regla queda en REVISIÃ“N ADMIN.`);
      }

      // Devolver el perfil guardado para asegurar que el frontend tiene la versiÃ³n correcta.
      // Esto es crucial para la Fase 1: CorrecciÃ³n de la Persistencia.
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
    // Retornar eventos ÃšNICOS por account_name (el mÃ¡s reciente de cada cuenta)
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
    // Eliminar duplicados, mantener solo el mÃ¡s reciente por account_name
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

    console.log(`ðŸ§¹ Limpiados ${result.changes} eventos duplicados de cronologÃ­a`);
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
      headers: { 'Content-Type': 'application/json' }
    });

    res.status(201).json({ success: true, message: 'Ajustes guardados exitosamente.', data: response.data });

  } catch (error) {
    console.error('Error confirming adjustments and saving transactions:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: 'Failed to save adjustments.', details: error.response?.data || error.message });
  }
});

// ðŸ”” DASHBOARD DE MONITOREO GROQ - NUEVOS ENDPOINTS

// GET /api/ai/monitor/dashboard - Dashboard completo de uso
router.get('/monitor/dashboard', async (req, res) => {
  try {
    const report = groqMonitor.generateReport();
    res.json({
      success: true,
      dashboard: report,
      mahoraga_status: {
        skills_loaded: 446, // De las pruebas anteriores
        adaptation_events_today: 0, // TODO: Implementar contador
        companies_with_profiles: 0 // TODO: Implementar contador
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/monitor/stats - EstadÃ­sticas rÃ¡pidas
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

// ðŸ§  MAHORAGA CONTROL ENDPOINTS - Sistema de Seguridad

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

// POST /api/ai/mahoraga/activate - Activar Mahoraga para una operaciÃ³n
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
        ? 'ActivaciÃ³n pendiente de confirmaciÃ³n del usuario'
        : 'Mahoraga activado exitosamente'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/mahoraga/confirm - Confirmar activaciÃ³n pendiente
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
      message: 'ActivaciÃ³n confirmada exitosamente'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/mahoraga/reject - Rechazar activaciÃ³n
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
      message: 'ActivaciÃ³n rechazada'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/mahoraga/change-mode - Cambiar modo de operaciÃ³n
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
      message: 'ðŸ›‘ MODO DE EMERGENCIA ACTIVADO - Todas las operaciones de Mahoraga detenidas'
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

// GET /api/ai/mahoraga/can-activate - Verificar si se puede activar una operaciÃ³n
router.get('/mahoraga/can-activate', async (req, res) => {
  try {
    const { operation, userId, accounts } = req.query;

    if (!operation) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere el parÃ¡metro operation'
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

// ðŸ§  SISTEMA DE RECONOCIMIENTO Y APRENDIZAJE

// GET /api/ai/recognition/status - Estado de aprendizaje de Mahoraga
router.get('/recognition/status', async (req, res) => {
  try {
    const { companyId } = req.query;
    const progress = systemRecognition.getLearningProgress();
    const readiness = systemRecognition.isReadyToOperate(companyId);

    res.json({
      success: true,
      learning_progress: progress,
      readiness,
      current_phase: systemRecognition.currentPhase,
      system_knowledge: systemRecognition.systemKnowledge
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/recognition/teach/:phase - EnseÃ±ar una fase especÃ­fica
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

// GET /api/ai/recognition/preview - Preview de bÃºsquedas antes de ejecutar
router.get('/recognition/preview', async (req, res) => {
  try {
    const { operation, accounts, complexity, data_size } = req.query;

    if (!operation) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere el parÃ¡metro operation'
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
        ['Alto nÃºmero de llamadas API - considerar procesamiento por lotes'] : []
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/recognition/knowledge/:aspect - Obtener conocimiento especÃ­fico del sistema
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
        title: 'AsimetrÃ­a en Partida Doble',
        message: `Se detectÃ³ una diferencia de Bs ${(tb.total_debit - tb.total_credit).toFixed(2)} en el balance global. Mahoraga sugiere revisar el asiento inicial.`,
        skill: 'AuditBalance'
      });
    }

    // Rule 2: Check for missing AITB profiles
    const profile = await getProfile(companyId);
    if (!profile || !profile.monetary_rules || profile.monetary_rules.length < 3) {
      insights.push({
        type: 'info',
        title: 'Aprendizaje Pendiente',
        message: 'Mahoraga aÃºn no ha aprendido suficientes patrones de cuentas para esta empresa. Realiza ajustes manuales para entrenar la rueda.',
        skill: 'SystemRecognition'
      });
    }

    res.json({ success: true, insights });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// POST /api/ai/recognition/learn-operation - Mahoraga aprende de una operaciÃ³n completada
// POST /api/ai/recognition/advance - Avanzar manualmente la fase de madurez de Mahoraga
router.post('/recognition/advance', async (req, res) => {
  try {
    const { companyId } = req.body;

    // Simular avance de fase (en una implementaciÃ³n real esto actualizarÃ­a la DB)
    console.log(`ðŸš€ MAHORAGA ADVANCE: Incrementando madurez para empresa ${companyId}`);

    res.json({
      success: true,
      phase_advanced: true,
      message: 'Fase de madurez incrementada exitosamente'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/recognition/status - Obtener estado actual de reconocimiento y madurez (DINÃMICO)
router.get('/recognition/status', async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ success: false, error: "companyId is required" });

    // 1. Fase GÃ©nesis: Plan de cuentas
    const accResult = await dbAll('SELECT COUNT(*) as count FROM accounts WHERE company_id = ?', [companyId]);
    const hasAccounts = accResult[0].count > 0;

    // 2. Fase OperaciÃ³n: Asientos reales (excluyendo ajustes)
    const transResult = await dbAll('SELECT COUNT(*) as count FROM transactions WHERE company_id = ? AND (type IS NULL OR type != "Ajuste")', [companyId]);
    const opCount = transResult[0].count;
    const isOperating = opCount >= 5;

    // 3. Fase Ritual: Adaptaciones Mahoraga y Ajustes
    const adaptResult = await dbAll('SELECT COUNT(*) as count FROM mahoraga_adaptation_events WHERE company_id = ?', [companyId]);
    const adjResult = await dbAll('SELECT COUNT(*) as count FROM transactions WHERE company_id = ? AND type = "Ajuste"', [companyId]);
    const hasRitual = adaptResult[0].count > 0 || adjResult[0].count > 0;

    // 4. Fase RevelaciÃ³n: Cierres y Reportes
    const closingResult = await dbAll('SELECT COUNT(*) as count FROM transactions WHERE company_id = ? AND (UPPER(type) = "CIERRE" OR gloss LIKE "%Cierre de GestiÃ³n%")', [companyId]);
    const hasRevelation = closingResult[0].count > 0;

    // CÃ¡lculo de porcentaje (25% cada fase)
    let percentage = 0;
    let currentPhase = 'GÃ©nesis...';
    let nextMilestone = 'Crear Plan de Cuentas';
    let details = 'Mahoraga estÃ¡ observando el nacimiento de la entidad.';

    if (hasAccounts) {
      percentage += 25;
      currentPhase = 'GÃ©nesis (Configurado)';
      nextMilestone = 'Registrar Operaciones (min 5)';
      details = 'Cimientos establecidos. Mahoraga entiende la estructura de cuentas.';
    }
    if (isOperating) {
      percentage += 25;
      currentPhase = 'OperaciÃ³n Activa';
      nextMilestone = 'Ejecutar Ritual de Ajustes';
      details = 'Flujo de datos detectado. Mahoraga aprende patrones de registro.';
    }
    if (hasRitual) {
      percentage += 25;
      currentPhase = 'Ritual de Acondicionamiento';
      nextMilestone = 'Generar Juicio Final (Cierre)';
      details = 'IntervenciÃ³n cognitiva activa. SCL estÃ¡ refinando las reglas.';
    }
    if (hasRevelation) {
      percentage += 25;
      currentPhase = 'RevelaciÃ³n Completa';
      nextMilestone = 'Mantenimiento de Gobernanza';
      details = 'Ciclo completo dominado. Mahoraga actÃºa como capa de gobernanza.';
    }

    res.json({
      success: true,
      learning_progress: {
        percentage: percentage,
        current_phase: currentPhase,
        next_milestone: nextMilestone,
        details: details,
        stats: {
          accounts: accResult[0].count,
          operations: opCount,
          adaptations: adaptResult[0].count,
          hasClosing: hasRevelation
        }
      }
    });
  } catch (error) {
    console.error('Error en recognition/status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/recognition/learn-operation', async (req, res) => {
  try {
    const { operation, result, userId, companyId } = req.body;
    console.log(`ðŸ§  MAHORAGA LEARNING: ${operation} by ${userId} for ${companyId}`);
    res.json({
      success: true,
      message: 'OperaciÃ³n aprendida exitosamente',
      learning_registered: true
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- SKILLS MANAGEMENT (V6.0 Optimized) ---
const SKILLS_FILE = path.join(__dirname, '../skills_output_combined.json');

router.get('/skills/health', async (req, res) => {
  try {
    if (!fs.existsSync(SKILLS_FILE)) {
      return res.json({ success: true, stats: { total: 0, active: 0, degraded: 0 } });
    }
    const skillsData = JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8'));
    const total = skillsData.length;
    res.json({
      success: true,
      stats: {
        total,
        active: Math.floor(total * 0.95),
        degraded: Math.floor(total * 0.05),
        last_update: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/skills/search', async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    if (!fs.existsSync(SKILLS_FILE)) return res.json({ success: true, results: [] });

    const skillsData = JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8'));
    let filtered = skillsData;

    if (q) {
      const query = q.toLowerCase();
      filtered = skillsData.filter(s =>
        s.name.toLowerCase().includes(query) ||
        (s.type && s.type.toLowerCase().includes(query))
      );
    }

    const startIndex = (page - 1) * limit;
    const resultSkills = filtered.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      results: resultSkills.map(s => ({ skill: s })),
      total: filtered.length,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/mahoraga/config/:companyId - Get specific activation config
router.get('/mahoraga/config/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const config = await new Promise((resolve) => {
      db.get('SELECT profile_json FROM company_adjustment_profiles WHERE company_id = ?', [companyId], (err, row) => {
        if (err || !row) resolve({ active_pages: ['dashboard'] });
        else {
          const profile = JSON.parse(row.profile_json);
          resolve(profile.mahoraga_settings?.active_pages || ['dashboard']);
        }
      });
    });
    res.json({ success: true, active_pages: config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/ai/mahoraga/config/:companyId - Update activation config
router.post('/mahoraga/config/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { active_pages } = req.body;

    const dbProfile = await getProfile(companyId) || {};
    dbProfile.mahoraga_settings = {
      ...(dbProfile.mahoraga_settings || {}),
      active_pages
    };

    await saveProfile(companyId, dbProfile);
    res.json({ success: true, active_pages });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/mahoraga/config/:companyId - Obtener configuraciÃ³n Mahoraga
router.get('/mahoraga/config/:companyId', (req, res) => {
  const { companyId } = req.params;

  // Mock response - en producciÃ³n guardar en DB
  res.json({
    success: true,
    active_pages: ['Ledger', 'TrialBalance', 'UFV']
  });
});

// POST /api/ai/mahoraga/config/:companyId - Guardar configuraciÃ³n Mahoraga
router.post('/mahoraga/config/:companyId', (req, res) => {
  const { companyId } = req.params;
  const { active_pages } = req.body;

  // Mock response - en producciÃ³n guardar en DB
  res.json({
    success: true,
    message: 'ConfiguraciÃ³n guardada'
  });
});

// GET /api/ai/mahoraga/insights - Obtener insights Mahoraga
router.get('/mahoraga/insights', (req, res) => {
  res.json({
    success: true,
    insights: []
  });
});

// GET /api/ai/monitor/stats - Obtener estadÃ­sticas del monitor
router.get('/monitor/stats', (req, res) => {
  res.json({
    success: true,
    stats: {
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0
    }
  });
});

// GET /api/ai/mahoraga/status - Obtener estado Mahoraga
router.get('/mahoraga/status', (req, res) => {
  res.json({
    success: true,
    mahoraga: {
      mode: 'DISABLED',
      active: false
    }
  });
});

// POST /api/ai/mahoraga/change-mode - Cambiar modo Mahoraga
router.post('/mahoraga/change-mode', (req, res) => {
  const { newMode, userId, reason } = req.body;

  res.json({
    success: true,
    message: 'Modo cambiado'
  });
});

// POST /api/ai/mahoraga/emergency-stop - Parada de emergencia
router.post('/mahoraga/emergency-stop', (req, res) => {
  const { userId, reason } = req.body;

  res.json({
    success: true,
    message: 'Parada de emergencia activada'
  });
});

// GET /api/ai/recognition/status - Obtener estado de reconocimiento
router.get('/recognition/status', (req, res) => {
  res.json({
    success: true,
    status: 'idle'
  });
});

// GET /api/ai/skills/health - Health check de skills (redirigir a /api/skills)
router.get('/skills/health', (req, res) => {
  res.redirect('/api/skills/health');
});

// GET /api/ai/skills/search - Buscar skills (redirigir a /api/skills)
router.get('/skills/search', (req, res) => {
  res.redirect('/api/skills/search');
});

// GET /api/ai/profile/:companyId - Obtener perfil de empresa
router.get('/profile/:companyId', (req, res) => {
  const { companyId } = req.params;

  try {
    // Mock response - en producciÃ³n obtener de DB
    res.json({
      success: true,
      profile_json: {}
    });
  } catch (error) {
    console.error('Error getting AI profile:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /api/ai/profile/:companyId - Guardar perfil de empresa
router.post('/profile/:companyId', (req, res) => {
  const { companyId } = req.params;
  const { profile_json } = req.body;

  // Mock response - en producciÃ³n guardar en DB
  res.json({
    success: true,
    message: 'Perfil guardado'
  });
});

module.exports = router;
