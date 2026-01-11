/**
 * Cognitive Orchestrator - Middleware para IA Gobernada
 * Basado en arquitectura MEJORA.txt
 * 
 * Responsabilidades:
 * - Orquestar pipeline LLM + GNN + reglas
 * - Mantener audit trail completo
 * - Coordinar fallbacks y validaciones
 */

const crypto = require('crypto');

// Importar AccountPlanProfile del cliente
let AccountPlanProfile;
try {
  // Como es ESM, necesitamos importarlo dinámicamente
  const AccountPlanProfileModule = require('../../client/src/utils/AccountPlanProfile.js');
  AccountPlanProfile = AccountPlanProfileModule.AccountPlanProfile;
} catch (e) {
  console.warn('Could not import AccountPlanProfile from client, using fallback');
  AccountPlanProfile = class {
    static analyze(accounts) { 
      return { 
        levelsCount: 1, 
        segments: [],
        levelInsights: [{ level: 1, chars: 9, behavior: 'fixed' }],
        mask: '#########'
      }; 
    }
    static calculateParent(code) { 
      return code.slice(0, -1); 
    }
    static extractFeatures(acc, analysis) { 
      return { 
        code: acc.code, 
        name: acc.name,
        length: acc.code.length,
        first_digit: acc.code.charAt(0),
        level: 1
      }; 
    }
  };
}

// Helper functions para fallback
const extractFeatures = (acc, analysis) => {
  try {
    if (typeof AccountPlanProfile.extractFeatures === 'function') {
      return AccountPlanProfile.extractFeatures(acc, analysis);
    }
    // Fallback simple
    return { 
      code: acc.code, 
      name: acc.name,
      length: acc.code.length,
      first_digit: acc.code.charAt(0),
      level: 1
    };
  } catch (e) {
    return { 
      code: acc.code, 
      name: acc.name,
      length: acc.code.length,
      first_digit: acc.code.charAt(0),
      level: 1
    };
  }
};

// Configuración de base de datos (opcional)
const POSTGRES_URL = process.env.POSTGRES_URL || null;
let pgPool = null;

// Intentar cargar pg solo si está configurado
if (POSTGRES_URL) {
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: POSTGRES_URL });
    console.log('PostgreSQL pool initialized for AI audit logs');
  } catch (e) {
    console.warn('PostgreSQL not available, audit logs will be console only:', e.message);
  }
}

/**
 * Escribir registro de auditoría
 */
async function createAudit(entry) {
  if (!pgPool) {
    // Fallback: console log si no hay base de datos
    console.log('[AUDIT]', JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry
    }));
    return { id: 'console-' + Date.now(), created_at: new Date().toISOString() };
  }
  
  const q = `INSERT INTO ai_audit_logs (model_stage, input_payload, output_payload, confidence, user_action, notes, duration_ms, source, tags)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at, request_id`;
  
  const vals = [
    entry.model_stage || 'unknown',
    entry.input_payload || {},
    entry.output_payload || {},
    entry.confidence || null,
    entry.user_action || null,
    entry.notes || null,
    entry.duration_ms || null,
    entry.source || 'cognitive-orchestrator',
    entry.tags || []
  ];
  
  try {
    const res = await pgPool.query(q, vals);
    return res.rows[0];
  } catch (e) {
    console.error('AI audit log failed', e.message);
    return null;
  }
}

/**
 * Enriquecimiento semántico con LLM
 */
async function enrichWithLLM(accounts, context = {}, analysis = null) {
  const start = Date.now();
  const requestId = crypto.randomUUID();
  
  // VERIFICACIÓN DE MODO: Si no hay Key Y no hay endpoint local configurado, usar heurística.
  if (!process.env.OPENAI_API_KEY && !process.env.LLM_ENDPOINT && !process.env.LLM_ENRICH_ENDPOINT) {
    console.log('[ORCHESTRATOR] Running in SEMANTIC RETRIEVAL MODE (Contextual & Structural).');
    return accounts.map(acc => {
      const guess = advancedHeuristicAnalysis(acc.code, acc.name, analysis);
      return {
        code: acc.code,
        name: acc.name,
        canonical_name: acc.name, // En modo local, el nombre canónico es el mismo
        entities: [],
        likely_type: guess.type,
        suggested_tags: guess.tags,
        explanation: guess.explanation,
        confidence: guess.confidence
      };
    });
  }

  try {
    // Preparar payload para LLM
    const llmPayload = {
      items: accounts.map(acc => ({
        code: acc.code || '',
        name: acc.name || '',
        context: {
          companyId: context.companyId,
          existingTypes: context.existingTypes || []
        }
      }))
    };

    // Llamar al servicio LLM (usando modelServiceAdapter existente)
    const { inferWithModel } = require('./modelServiceAdapter');
    const llmEndpoint = process.env.LLM_ENRICH_ENDPOINT || 'http://localhost:3001/llm/enrich';
    
    const enriched = await inferWithModel(llmEndpoint, {
      prompt: `Eres un asistente contable experto. Para cada cuenta devuelve JSON con:
      - canonical_name: nombre normalizado
      - entities: ['venta','costo','sueldos','activo','pasivo',...]
      - likely_type: uno de ['Activo','Pasivo','Patrimonio','Ingreso','Gasto','Costo','Orden','Reguladora','Contingente','Otra cuenta de resultados']
      - suggested_tags: etiquetas relevantes
      - explanation: razón de la clasificación (1 línea)
      - confidence: número 0-1
      
      Input: ${JSON.stringify(llmPayload.items)}`,
      items: llmPayload.items,
      model: 'gpt-4o-mini',
      max_tokens: 2000,
      temperature: 0.1
    });

    // Escribir audit log
    await createAudit({
      model_stage: 'enrich',
      input_payload: { accounts, context },
      output_payload: enriched,
      duration_ms: Date.now() - start,
      notes: `Enriched ${accounts.length} accounts with LLM`
    });

    return enriched;
  } catch (error) {
    console.error('LLM enrichment failed:', error.message);
    
    // Fallback a heurísticas si LLM falla
    const fallback = accounts.map(acc => ({
      code: acc.code,
      name: acc.name,
      canonical_name: acc.name,
      entities: [],
      likely_type: heuristicTypeGuess(acc.code),
      suggested_tags: [],
      explanation: 'Fallback - heuristic guess',
      confidence: 0.3
    }));
    
    await createAudit({
      model_stage: 'enrich_fallback',
      input_payload: { accounts, context },
      output_payload: fallback,
      duration_ms: Date.now() - start,
      notes: `LLM failed, used heuristics fallback`
    });
    
    return fallback;
  }
}

/**
 * Predicción con modelo híbrido (Transformer + GNN)
 */
async function predictWithModel(features, enriched, profile) {
  const start = Date.now();
  
  // VERIFICACIÓN DE MODO LOCAL
  if (!process.env.MODEL_PREDICT_ENDPOINT) {
    // Si no hay microservicio de IA configurado, usar cálculo local
    const fallback = features.map((feat) => ({
      account_code: feat.code,
      predicted_level: feat.level || 1,
      predicted_parent: calculateParent(feat.code, profile),
      confidence: 1.0,
      method: 'local_structure_calc'
    }));
    return { predictions: fallback, confidence: 1.0 };
  }

  try {
    const { inferWithModel } = require('./modelServiceAdapter');
    const modelEndpoint = process.env.MODEL_PREDICT_ENDPOINT || 'http://localhost:3002/predict';
    
    const predictions = await inferWithModel(modelEndpoint, {
      features: features,
      enriched: enriched,
      profile: profile,
      model: 'transformer-gnn-v1'
    });

    await createAudit({
      model_stage: 'predict',
      input_payload: { features_count: features.length, enriched_count: enriched.length },
      output_payload: predictions,
      confidence: predictions.confidence || 0.5,
      duration_ms: Date.now() - start,
      notes: `Predicted levels for ${features.length} accounts`
    });

    return predictions;
  } catch (error) {
    console.error('Model prediction failed:', error.message);
    
    // Fallback a cálculo heurístico
    const fallback = features.map((feat, idx) => ({
      account_code: feat.code,
      predicted_level: feat.level || 1,
      predicted_parent: calculateParent(feat.code, profile),
      confidence: 0.4,
      method: 'heuristic_fallback'
    }));
    
    await createAudit({
      model_stage: 'predict_fallback',
      input_payload: { features_count: features.length },
      output_payload: fallback,
      confidence: 0.4,
      duration_ms: Date.now() - start,
      notes: `Model failed, used heuristic fallback`
    });
    
    return { predictions: fallback, confidence: 0.4 };
  }
}

/**
 * Post-procesamiento y aplicación de reglas
 */
function postProcessPredictions(predictions, options = {}) {
  const results = predictions.predictions || predictions;
  
  // Aplicar reglas de negocio
  const processed = results.map(pred => {
    const processed = { ...pred };
    
    // Validar tipo vs nivel (reglas de contabilidad)
    if (processed.predicted_level === 1 && processed.likely_type === 'Gasto') {
      processed.warning = 'Gasto no debería estar en nivel 1';
      processed.confidence = Math.min(processed.confidence, 0.6);
    }
    
    // Validar estructura jerárquica
    if (processed.predicted_parent && processed.predicted_level <= 1) {
      processed.predicted_parent = null;
      processed.note = 'Removed parent from level 1 account';
    }
    
    return processed;
  });
  
  return processed;
}

/**
 * Función principal de orquestación
 */
async function orchestrate(accounts, companyId, options = {}) {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  
  try {
    console.log(`[ORCHESTRATOR] Starting request ${requestId} for ${accounts.length} accounts`);
    
    // 1. Análisis estructural y extracción de features (AHORA ES EL PASO 1 - GOBERNANZA)
    // La estructura define el contexto para la semántica.
    console.log(`[ORCHESTRATOR] Step 1: Structural analysis (Context Layer)...`);
    
    // Si el frontend nos envía una configuración de estructura (ej: PUCT detectado), la usamos.
    // Si no, dejamos que AccountPlanProfile analice los datos.
    const analysis = options.structureConfig || AccountPlanProfile.analyze(accounts);
    
    // 2. Enriquecimiento semántico (AHORA ES EL PASO 2 - RECUPERACIÓN)
    console.log(`[ORCHESTRATOR] Step 2: Semantic Retrieval & Enrichment...`);
    const enriched = await enrichWithLLM(accounts, {
      companyId,
      existingTypes: options.existingTypes || []
    }, analysis);

    const features = accounts.map(acc => extractFeatures(acc, analysis));
    
    // 3. Predicción con modelo híbrido
    console.log(`[ORCHESTRATOR] Step 3: Model prediction...`);
    const predictions = await predictWithModel(features, enriched, analysis);
    
    // 4. Post-procesamiento y reglas
    console.log(`[ORCHESTRATOR] Step 4: Post-processing...`);
    const final = postProcessPredictions(predictions, options);
    
    // 5. Combinar resultados con datos originales
    const results = accounts.map((acc, idx) => {
      const enriched_acc = enriched[idx] || {};
      const prediction = final.find(p => p.account_code === acc.code) || {};
      
      return {
        ...acc,
        enriched: enriched_acc,
        predicted_level: prediction.predicted_level,
        predicted_parent: prediction.predicted_parent,
        confidence: prediction.confidence || 0.5,
        warnings: prediction.warning ? [prediction.warning] : [],
        notes: prediction.note || prediction.explanation
      };
    });
    
    // 6. Audit log final
    await createAudit({
      model_stage: 'orchestrate_complete',
      input_payload: { accounts_count: accounts.length, companyId },
      output_payload: { results_count: results.length, avg_confidence: results.reduce((sum, r) => sum + (r.confidence || 0), 0) / results.length },
      duration_ms: Date.now() - start,
      notes: `Orchestration completed for request ${requestId}`
    });
    
    console.log(`[ORCHESTRATOR] Completed request ${requestId} in ${Date.now() - start}ms`);
    
    return {
      requestId,
      results,
      summary: {
        total_accounts: accounts.length,
        avg_confidence: results.reduce((sum, r) => sum + (r.confidence || 0), 0) / results.length,
        processing_time_ms: Date.now() - start,
        warnings_count: results.reduce((sum, r) => sum + (r.warnings?.length || 0), 0)
      }
    };
    
  } catch (error) {
    console.error(`[ORCHESTRATOR] Request ${requestId} failed:`, error.message);
    
    await createAudit({
      model_stage: 'orchestrate_error',
      input_payload: { accounts_count: accounts.length, companyId },
      output_payload: { error: error.message },
      duration_ms: Date.now() - start,
      notes: `Orchestration failed for request ${requestId}: ${error.message}`
    });
    
    throw error;
  }
}

// Helper functions
function heuristicTypeGuess(code) {
  if (!code || code.length === 0) return 'Activo';
  const firstDigit = code.trim()[0];
  const mapping = { 
    '1': 'Activo', '2': 'Pasivo', '3': 'Patrimonio', 
    '4': 'Ingreso', '5': 'Gasto', '6': 'Costo', 
    '7': 'Costo', '8': 'Orden', '9': 'Orden' 
  };
  return mapping[firstDigit] || 'Activo';
}

// === ONTOLOGÍA CONTABLE (BASE DE CONOCIMIENTO) ===
// Jerarquía de términos con pesos para simular comprensión semántica
const ACCOUNTING_ONTOLOGY = [
  // ACTIVOS
  { type: 'Activo', weight: 0.9, tags: ['disponible'], terms: ['caja', 'efectivo', 'banco', 'tesoro', 'fondo fijo', 'remesa'] },
  { type: 'Activo', weight: 0.8, tags: ['exigible'], terms: ['cobrar', 'cliente', 'deudor', 'prestamo al personal', 'anticipo a', 'credito fiscal', 'iva credito'] },
  { type: 'Activo', weight: 0.8, tags: ['realizable'], terms: ['inventario', 'mercaderia', 'almacen', 'existencia', 'producto terminado', 'en proceso', 'transito'] },
  { type: 'Activo', weight: 0.8, tags: ['fijo'], terms: ['edificio', 'terreno', 'vehiculo', 'mueble', 'equipo', 'computacion', 'maquinaria', 'herramienta', 'obras en curso'] },
  { type: 'Activo', weight: 0.7, tags: ['diferido'], terms: ['pagado por anticipado', 'seguro pagado', 'alquiler pagado'] },
  
  // PASIVOS
  { type: 'Pasivo', weight: 0.9, tags: ['fiscal'], terms: ['debito fiscal', 'iva debito', 'retencion', 'iue por pagar', 'it por pagar', 'impuesto por pagar'] },
  { type: 'Pasivo', weight: 0.8, tags: ['comercial'], terms: ['proveedor', 'pagar', 'acreedor', 'deuda comercial'] },
  { type: 'Pasivo', weight: 0.8, tags: ['financiero'], terms: ['prestamo bancario', 'hipoteca', 'bancaria por pagar', 'interes por pagar'] },
  { type: 'Pasivo', weight: 0.8, tags: ['laboral'], terms: ['sueldo por pagar', 'aguinaldo por pagar', 'finiquito por pagar', 'aporte por pagar', 'afp por pagar'] },
  { type: 'Pasivo', weight: 0.7, tags: ['diferido'], terms: ['cobrado por anticipado', 'ingreso diferido'] },

  // PATRIMONIO
  { type: 'Patrimonio', weight: 0.9, tags: ['capital'], terms: ['capital social', 'capital pagado', 'cuota de capital'] },
  { type: 'Patrimonio', weight: 0.8, tags: ['reservas'], terms: ['reserva legal', 'reserva estatutaria', 'ajuste de capital', 'ajuste de reservas'] },
  { type: 'Patrimonio', weight: 0.8, tags: ['resultados'], terms: ['resultado acumulado', 'utilidad acumulada', 'perdida acumulada', 'resultado del ejercicio', 'utilidad del ejercicio', 'perdida del ejercicio'] },
  // Sincronización con IncomeStatementEngine: Resultados Acumulados para compensación
  { type: 'Patrimonio', weight: 0.95, tags: ['resultados_acumulados'], terms: ['resultados acumulados', 'utilidades retenidas', 'perdidas acumuladas', 'resultados de gestiones anteriores'] },

  // INGRESOS
  { type: 'Ingreso', weight: 0.95, tags: ['generico'], terms: ['ingreso', 'ingresos'] },
  { type: 'Ingreso', weight: 0.9, tags: ['operativo'], terms: ['venta', 'ingreso por servicio', 'honorario ganado', 'comision ganada'] },
  // Sincronización con Worksheet.jsx: Ingresos No Imponibles
  { type: 'Ingreso', weight: 0.95, tags: ['no_imponible', 'exento'], terms: ['dividendos percibidos', 'compensacion tributaria', 'ingresos del exterior', 'ingresos percibidos del exterior'] },
  // CORRECCIÓN LÓGICA: Descuentos en COMPRAS son Ingresos (Ahorro)
  { type: 'Ingreso', weight: 0.9, tags: ['otros_ingresos'], terms: ['descuento en compra', 'rebaja en compra', 'bonificacion en compra', 'devolucion en compra', 'descuentos sobre compra', 'rebajas sobre compra'] },
  { type: 'Ingreso', weight: 0.8, tags: ['no_operativo'], terms: ['interes ganado', 'alquiler ganado', 'otros ingresos'] },
  { type: 'Ingreso', weight: 0.7, tags: ['extraordinario'], terms: ['ganancia en venta', 'recuperacion'] },

  // COSTOS
  // Sincronización con IncomeStatementEngine: Palabras clave estrictas de Costo
  { type: 'Costo', weight: 0.9, tags: ['costo_venta'], terms: ['costo de venta', 'costo de produccion', 'costo de servicio', 'costo producto', 'costo mercaderia'] },
  { type: 'Costo', weight: 0.8, tags: ['compras'], terms: ['compra de mercaderia', 'flete en compra', 'importacion'] },

  // GASTOS
  { type: 'Gasto', weight: 0.95, tags: ['generico'], terms: ['gasto', 'gastos', 'egreso', 'egresos'] },
  { type: 'Gasto', weight: 0.9, tags: ['personal'], terms: ['sueldo', 'salario', 'aguinaldo', 'cargas sociales', 'aporte patronal', 'bono', 'prima', 'finiquito', 'refrigerio'] },
  // Sincronización con IncomeStatementEngine: Gastos de Venta vs Admin vs Financieros
  // CORRECCIÓN LÓGICA: Descuentos en VENTAS son Gastos (Reducción de beneficio)
  { type: 'Gasto', weight: 0.9, tags: ['gasto_venta', 'contra_ingreso'], terms: ['descuento en venta', 'rebaja en venta', 'bonificacion en venta', 'devolucion en venta', 'descuentos sobre venta', 'rebajas sobre venta'] },
  { type: 'Gasto', weight: 0.85, tags: ['venta', 'comercial'], terms: ['publicidad', 'propaganda', 'marketing', 'comercial', 'impuesto a las transacciones', 'it', 'incobrable', 'prevision incobrable', 'transacciones'] },
  { type: 'Gasto', weight: 0.85, tags: ['servicios', 'admin'], terms: ['alquiler', 'luz', 'agua', 'internet', 'telefono', 'gas', 'limpieza', 'mantenimiento', 'reparacion', 'seguridad', 'honorario', 'servicio basico', 'administrativo'] },
  { type: 'Gasto', weight: 0.85, tags: ['impositivo'], terms: ['tributo', 'patente', 'tasas'] },
  { type: 'Gasto', weight: 0.85, tags: ['financiero'], terms: ['interes', 'bancari', 'chequera', 'itf', 'financier', 'comision', 'gasto bancario'] },
  { type: 'Gasto', weight: 0.7, tags: ['depreciacion'], terms: ['depreciacion', 'amortizacion', 'castigo'] },
  
  // Sincronización con Worksheet.jsx: Cuentas de Naturaleza Variable (Ajustes)
  // Lista expandida para coincidir con FinancialStatementEngine.js
  { type: 'Gasto', weight: 0.85, tags: ['ajuste', 'variable'], terms: ['diferencia de cambio', 'mantenimiento de valor', 'ajuste por inflacion', 'exposicion a la inflacion', 'tenencia de bienes', 'resultado monetario', 'reme', 'resultados por exposicion a la inflacion'] },
  // Sincronización con SmartImportWizard: Tipo 'Resultado' explícito
  { type: 'Resultado', weight: 0.9, tags: ['resultado'], terms: ['perdidas y ganancias', 'resultado del ejercicio', 'resultado neto', 'utilidad del ejercicio', 'perdida del ejercicio', 'resultado integral', 'resultados de la gestion', 'resultado extraordinario'] },

  // REGULADORAS
  // Sincronización con Worksheet.jsx: Regex de reguladoras
  { type: 'Reguladora', weight: 0.95, tags: ['activo'], terms: ['depreciacion acumulada', 'amortizacion acumulada', 'prevision cuentas incobrables', 'deterioro', 'prevision para', 'provision para', 'valuacion'] },

  // CUENTAS DE ORDEN (Faltaban en la ontología original)
  // Sincronización con Worksheet.jsx: /orden/i
  { type: 'Orden', weight: 0.95, tags: ['orden'], terms: ['cuentas de orden', 'garantias recibidas', 'garantias emitidas', 'bienes en custodia', 'valores en custodia', 'contingente', 'contingencias'] }
];

// Helper: Similitud Vectorial Dispersa (Jaccard/Cosine ponderado simulado)
function calculateSemanticScore(queryTokens, targetTerms) {
  if (!queryTokens || queryTokens.length === 0) return 0;
  
  let matchScore = 0;
  let matchedCount = 0;

  for (const term of targetTerms) {
    // Búsqueda exacta o parcial fuerte
    const termParts = term.split(' ');
    let termMatches = 0;
    
    for (const part of termParts) {
      if (part.length < 3) continue; // Ignorar conectores cortos
      for (const token of queryTokens) {
        if (token === part) {
          termMatches += 1.0; // Coincidencia exacta
        } else if (token.startsWith(part) || part.startsWith(token)) {
          termMatches += 0.8; // Raíz común
        } else if (token.includes(part) || part.includes(token)) {
          termMatches += 0.6; // Contención
        }
      }
    }
    
    // Normalizar score del término
    if (termParts.length > 0) {
      const currentScore = termMatches / termParts.length;
      if (currentScore > matchScore) matchScore = currentScore;
    }
  }
  
  return matchScore;
}

function advancedHeuristicAnalysis(code, name, analysis = null) {
  // Tokenización simple para vector disperso
  const normalize = (text) => (text || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const tokens = normalize(name).split(/\W+/).filter(t => t.length > 2);
  
  const codeType = heuristicTypeGuess(code);
  
  // 1. RECUPERACIÓN SEMÁNTICA (Semantic Retrieval)
  // Buscamos en la base de conocimiento los conceptos más similares
  let bestMatch = null;
  let maxScore = 0;

  for (const entry of ACCOUNTING_ONTOLOGY) {
    const semanticScore = calculateSemanticScore(tokens, entry.terms);
    
    // Ponderar por la importancia definida en la ontología
    const weightedScore = semanticScore * entry.weight;
    
    if (weightedScore > maxScore) {
      maxScore = weightedScore;
      bestMatch = entry;
    }
  }

  // 2. MAPEO CONTEXTUAL (Contextual Data Mapping)
  // Validamos la recuperación semántica contra la estructura (Instancia)
  
  let finalType = codeType;
  let confidence = 0.5;
  let explanation = 'Basado en estructura de código';
  let tags = ['heuristic_structure'];

  // Umbral de aceptación semántica
  if (bestMatch) {
    // Si la semántica coincide con la estructura (Consenso)
    if (bestMatch.type === codeType && maxScore > 0.3) {
      confidence = Math.min(0.98, maxScore + 0.4); // Boost alto por consenso
      explanation = `Consenso Arquitectónico: Semántica "${bestMatch.type}" validada por estructura código ${codeType}.`;
      tags = ['strong_consensus', ...bestMatch.tags];
      finalType = bestMatch.type;
    } else {
      // Conflicto: Semántica vs Estructura
      
      // Regla de Excepción Estructural: Si el código es claramente Activo (1) y semántica dice Gasto,
      // pero hay tokens de diferimiento ("anticipado"), la estructura gana pero se refina.
      if (codeType === 'Activo' && bestMatch.type === 'Gasto' && tokens.some(t => t.includes('anticip'))) {
        finalType = 'Activo';
        confidence = 0.9;
        explanation = 'Mapeo Contextual: Activo Diferido detectado (Semántica Gasto + Estructura Activo)';
        tags = ['diferido', 'activo_corriente'];
      }
      else if (bestMatch.type === 'Reguladora') {
        finalType = 'Reguladora';
        confidence = 0.9;
        explanation = 'Excepción Ontológica: Cuenta Reguladora identificada por terminología específica';
        tags = ['reguladora', ...bestMatch.tags];
      }
      // Si la semántica es muy fuerte (> 0.7), asumimos error en el código o estructura atípica
      else if (maxScore > 0.7) {
        finalType = bestMatch.type;
        confidence = 0.75;
        explanation = `Prevalencia Semántica: "${bestMatch.type}" (Score: ${maxScore.toFixed(2)}) supera estructura "${codeType}"`;
        tags = ['semantic_override', ...bestMatch.tags];
      } else {
        // Ante la duda débil, la estructura (código) es la autoridad final en contabilidad
        finalType = codeType;
        confidence = 0.6;
        explanation = `Autoridad Estructural: Código "${codeType}" mantenido (Semántica débil: ${maxScore.toFixed(2)})`;
        tags = ['code_priority', ...bestMatch.tags];
      }
    }
  }
  
  return {
    type: finalType,
    tags: tags,
    explanation: explanation,
    confidence: parseFloat(confidence.toFixed(2))
  };
}

function calculateParent(code, profile) {
  return AccountPlanProfile.calculateParent(code, profile);
}

module.exports = {
  orchestrate,
  enrichWithLLM,
  predictWithModel,
  postProcessPredictions,
  createAudit
};
