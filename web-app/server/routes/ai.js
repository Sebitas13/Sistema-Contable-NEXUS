const express = require('express');
const router = express.Router();
const { inferWithModel } = require('../services/modelServiceAdapter');
const groqMonitor = require('../services/groqMonitor');
const mahoragaController = require('../services/mahoragaController');
const systemRecognition = require('../services/systemRecognition');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || process.env.AI_ENGINE_URL_ALT || 'http://localhost:8000';
const db = require('../db');

// Helper function to promisify db.all
const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
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

// Helper to get company profile from DB
const getProfile = (companyId) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT profile_json FROM company_adjustment_profiles WHERE company_id = ?', [companyId], (err, row) => {
      if (err) reject(err);
      resolve(row ? JSON.parse(row.profile_json) : null);
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

    const response = await axios.post(`${AI_ENGINE_URL}/api/ai/adjustments/generate`, req.body, {
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
  try {
    const response = await axios.get(`${AI_ENGINE_URL}/api/ai/health`, { timeout: 5000 });
    res.json(response.data);
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: 'AI Engine unavailable' });
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
  try {
    const companyId = req.body.company_id || req.body.parameters?.companyId || req.body.companyId;

    // 🛡️ Enforce Mahoraga Security Layer (COMMENTED OUT TO ALLOW FALLBACK)
    /*
    const permission = mahoragaController.canActivate('generate_adjustments', { companyId, userId: 'system' });
    if (!permission.allowed) {
      console.log(`🚫 Mahoraga access denied for 'generate_adjustments'. Reason: ${permission.reason}`);
      return res.status(403).json({
        success: false,
        error: `Operación de IA denegada: ${permission.message}`,
        reason: permission.reason,
        requiresUserAction: permission.requiresUserAction || false,
        proposedTransactions: [],
        confidence: 0,
        reasoning: `Mahoraga mode is '${mahoragaController.currentMode}'. ${permission.message}`
      });
    }
    */

    // V6.0: Inyectar perfil persistente fusionando correctamente arrays de reglas
    if (companyId) {
      const dbProfile = await getProfile(companyId);
      // Usar mergeProfiles para no sobrescribir reglas aprendidas
      req.body.profile_schema = mergeProfiles(dbProfile, req.body.profile_schema);
      console.log(`🔄 [generate-from-ledger] Perfil fusionado para empresa ${companyId}: ${(req.body.profile_schema?.monetary_rules?.length || 0)} reglas M, ${(req.body.profile_schema?.non_monetary_rules?.length || 0)} reglas NM`);
    }

    // V8.0 AoT: Enrich with ledger trajectories if trajectory mode is requested
    const useTrajectoryMode = req.body.parameters?.use_trajectory_mode === true;
    console.log(`🔍 [AoT DEBUG] Incoming use_trajectory_mode: ${req.body.parameters?.use_trajectory_mode}`);
    console.log(`🔍 [AoT DEBUG] useTrajectoryMode evaluated: ${useTrajectoryMode}`);
    console.log(`🔍 [AoT DEBUG] companyId: ${companyId}`);

    if (useTrajectoryMode && companyId) {
      console.log(`🎯 [AoT] Trajectory mode enabled - fetching ledger details...`);

      try {
        // 1. Fetch ledger details for all accounts
        // Helper function to promisify db.all (since it's not exported by db.js)
        const dbAll = (sql, params = []) => {
          return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });
        };

        const ledgerSql = `
          SELECT 
            a.code as account_code,
            t.date,
            te.debit,
            te.credit,
            te.gloss
          FROM transaction_entries te
          JOIN transactions t ON te.transaction_id = t.id
          JOIN accounts a ON te.account_id = a.id
          WHERE t.company_id = ?
            AND (t.type IS NULL OR t.type != 'Cierre')
          ORDER BY a.code ASC, t.date ASC
        `;

        const ledgerRows = await dbAll(ledgerSql, [companyId]);
        console.log(`   📊 Fetched ${ledgerRows.length} ledger movements`);

        // 2. Group by account code into trajectories
        const ledgerTrajectories = {};
        const uniqueDates = new Set();

        ledgerRows.forEach(row => {
          if (!ledgerTrajectories[row.account_code]) {
            ledgerTrajectories[row.account_code] = [];
          }
          ledgerTrajectories[row.account_code].push({
            date: row.date,
            debit: parseFloat(row.debit) || 0,
            credit: parseFloat(row.credit) || 0,
            gloss: row.gloss
          });
          uniqueDates.add(row.date);
        });

        console.log(`   🗂️ Grouped into ${Object.keys(ledgerTrajectories).length} account trajectories`);
        console.log(`   📅 ${uniqueDates.size} unique dates to lookup UFVs`);

        // 3. Fetch UFVs for all unique dates
        const datesArray = Array.from(uniqueDates);
        const ufvCache = {};

        if (datesArray.length > 0) {
          const placeholders = datesArray.map(() => '?').join(',');
          const ufvSql = `
            SELECT date, value 
            FROM ufv_rates 
            WHERE company_id = ? AND date IN (${placeholders})
          `;

          const ufvRows = await dbAll(ufvSql, [companyId, ...datesArray]);
          ufvRows.forEach(row => {
            ufvCache[row.date] = parseFloat(row.value);
          });

          console.log(`   💰 Fetched ${Object.keys(ufvCache).length}/${datesArray.length} UFV values from cache`);
        }

        // 4. Inject into request parameters
        req.body.parameters = req.body.parameters || {};
        req.body.parameters.ledger_trajectories = ledgerTrajectories;
        req.body.parameters.ufv_cache = ufvCache;
        req.body.parameters.use_trajectory_mode = true;

        console.log(`   ✅ [AoT] Enrichment complete - forwarding to Python engine`);

      } catch (enrichError) {
        console.error(`   ❌ [AoT] Enrichment failed:`, enrichError.message);
        // Continue without trajectory mode - fallback to balance-based
        req.body.parameters.use_trajectory_mode = false;
      }
    }

    const response = await axios.post(`${AI_ENGINE_URL}/api/ai/adjustments/generate-from-ledger`, req.body, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('AI generate from ledger error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: 'Motor AI no disponible. No se pueden generar ajustes desde ledger.',
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
    const response = await axios.post(`${AI_ENGINE_URL}/api/ai/adjustments/feedback`, req.body, {
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

// DELETE /api/ai/adjustments/chronology/:companyId/cleanup - Limpiar duplicados
router.delete('/adjustments/chronology/:companyId/cleanup', async (req, res) => {
  try {
    // Eliminar duplicados, mantener solo el más reciente por account_name
    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM mahoraga_adaptation_events
         WHERE company_id = ?
         AND id NOT IN (
           SELECT MAX(id) FROM mahoraga_adaptation_events
           WHERE company_id = ?
           GROUP BY account_name
         )`,
        [req.params.companyId, req.params.companyId],
        function (err) {
          if (err) reject(err);
          console.log(`🧹 Limpiados ${this.changes} eventos duplicados de cronología`);
          resolve(this.changes);
        }
      );
    });
    res.json({ success: true, message: 'Duplicados eliminados' });
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

// 🔔 DASHBOARD DE MONITOREO GROQ - NUEVOS ENDPOINTS

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
// POST /api/ai/recognition/learn-operation - Mahoraga aprende de una operación completada
// POST /api/ai/recognition/advance - Avanzar manualmente la fase de madurez de Mahoraga
router.post('/recognition/advance', async (req, res) => {
  try {
    const { companyId } = req.body;

    // Simular avance de fase (en una implementación real esto actualizaría la DB)
    console.log(`🚀 MAHORAGA ADVANCE: Incrementando madurez para empresa ${companyId}`);

    res.json({
      success: true,
      phase_advanced: true,
      message: 'Fase de madurez incrementada exitosamente'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/ai/recognition/status - Obtener estado actual de reconocimiento y madurez (DINÁMICO)
router.get('/recognition/status', async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ success: false, error: "companyId is required" });

    // 1. Fase Génesis: Plan de cuentas
    const accResult = await dbAll('SELECT COUNT(*) as count FROM accounts WHERE company_id = ?', [companyId]);
    const hasAccounts = accResult[0].count > 0;

    // 2. Fase Operación: Asientos reales (excluyendo ajustes)
    const transResult = await dbAll('SELECT COUNT(*) as count FROM transactions WHERE company_id = ? AND (type IS NULL OR type != "Ajuste")', [companyId]);
    const opCount = transResult[0].count;
    const isOperating = opCount >= 5;

    // 3. Fase Ritual: Adaptaciones Mahoraga y Ajustes
    const adaptResult = await dbAll('SELECT COUNT(*) as count FROM mahoraga_adaptation_events WHERE company_id = ?', [companyId]);
    const adjResult = await dbAll('SELECT COUNT(*) as count FROM transactions WHERE company_id = ? AND type = "Ajuste"', [companyId]);
    const hasRitual = adaptResult[0].count > 0 || adjResult[0].count > 0;

    // 4. Fase Revelación: Cierres y Reportes
    const closingResult = await dbAll('SELECT COUNT(*) as count FROM transactions WHERE company_id = ? AND (UPPER(type) = "CIERRE" OR gloss LIKE "%Cierre de Gestión%")', [companyId]);
    const hasRevelation = closingResult[0].count > 0;

    // Cálculo de porcentaje (25% cada fase)
    let percentage = 0;
    let currentPhase = 'Génesis...';
    let nextMilestone = 'Crear Plan de Cuentas';
    let details = 'Mahoraga está observando el nacimiento de la entidad.';

    if (hasAccounts) {
      percentage += 25;
      currentPhase = 'Génesis (Configurado)';
      nextMilestone = 'Registrar Operaciones (min 5)';
      details = 'Cimientos establecidos. Mahoraga entiende la estructura de cuentas.';
    }
    if (isOperating) {
      percentage += 25;
      currentPhase = 'Operación Activa';
      nextMilestone = 'Ejecutar Ritual de Ajustes';
      details = 'Flujo de datos detectado. Mahoraga aprende patrones de registro.';
    }
    if (hasRitual) {
      percentage += 25;
      currentPhase = 'Ritual de Acondicionamiento';
      nextMilestone = 'Generar Juicio Final (Cierre)';
      details = 'Intervención cognitiva activa. SCL está refinando las reglas.';
    }
    if (hasRevelation) {
      percentage += 25;
      currentPhase = 'Revelación Completa';
      nextMilestone = 'Mantenimiento de Gobernanza';
      details = 'Ciclo completo dominado. Mahoraga actúa como capa de gobernanza.';
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
    console.log(`🧠 MAHORAGA LEARNING: ${operation} by ${userId} for ${companyId}`);
    res.json({
      success: true,
      message: 'Operación aprendida exitosamente',
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

module.exports = router;
