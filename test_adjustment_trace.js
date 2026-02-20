const fs = require('fs');
const axios = require('axios');

const arg = (name, fallback = null) => {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  if (!found) return fallback;
  return found.slice(prefix.length);
};

const normalizeRows = (rows = []) => {
  return rows.map((row) => ({
    code: row.code || row.accountCode || row.account_code || '',
    name: row.name || row.accountName || row.account_name || '',
    classification: row.classification || row.base_classification || '',
    tags: Array.isArray(row.tags) ? row.tags.join('|') : '',
    aitb: row.aitb?.amount ?? row.aitbAmount ?? '',
    aitb_skip: row.aitb?.skip_reason ?? row.aitbSkip ?? '',
    dep: row.depreciation?.amount ?? row.depAmount ?? '',
    dep_skip: row.depreciation?.skip_reason ?? row.depReason ?? '',
    prov: row.provision?.amount ?? row.provisionAmount ?? '',
    generated: Array.isArray(row.generated_adjustments)
      ? row.generated_adjustments.map((a) => a.type).join('|')
      : ''
  }));
};

async function run() {
  const baseUrl = (arg('baseUrl', process.env.API_BASE_URL) || 'http://localhost:3001').replace(/\/+$/, '');
  const companyId = arg('companyId', process.env.COMPANY_ID || '1');
  const gestion = arg('gestion', process.env.GESTION || String(new Date().getFullYear() - 1));
  const ufvInitial = Number(arg('ufvInitial', process.env.UFV_INITIAL || '2.0'));
  const ufvFinal = Number(arg('ufvFinal', process.env.UFV_FINAL || '2.2'));
  const traceLimit = Number(arg('traceLimit', process.env.TRACE_LIMIT || '200'));
  const sampleLimit = Number(arg('sampleLimit', process.env.SAMPLE_LIMIT || '80'));
  const profilePath = arg('profilePath', process.env.PROFILE_PATH || '');
  const apiBaseUrl = arg('apiBaseUrl', process.env.API_BASE_URL || '');
  const apiBaseCandidatesRaw = arg('apiBaseCandidates', process.env.API_BASE_URL_CANDIDATES || '');
  const apiBaseCandidates = apiBaseCandidatesRaw
    ? apiBaseCandidatesRaw.split(',').map((item) => item.trim()).filter(Boolean)
    : [];

  let profileSchema = null;
  if (profilePath) {
    profileSchema = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  }

  const payload = {
    company_id: String(companyId),
    accounts: [],
    parameters: {
      gestion: String(gestion),
      ufv_initial: ufvInitial,
      ufv_final: ufvFinal,
      method: 'UFV',
      confidence_threshold: 0.95,
      use_trajectory_mode: false,
      debug_trace: true,
      debug_trace_limit: traceLimit
    },
    profile_schema: profileSchema
  };

  if (apiBaseUrl) {
    payload.parameters.api_base_url = apiBaseUrl;
  }
  if (apiBaseCandidates.length > 0) {
    payload.parameters.api_base_url_candidates = apiBaseCandidates;
  }

  console.log('=== Adjustment Trace Test ===');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Company: ${companyId} | Gestion: ${gestion}`);

  try {
    const response = await axios.post(
      `${baseUrl}/api/ai/adjustments/generate-from-ledger`,
      payload,
      { timeout: 120000 }
    );
    const result = response.data || {};
    const stats = result.processing_stats || {};

    console.log('\n=== Top Level ===');
    console.log({
      success: result.success,
      fallback_mode: Boolean(stats.fallback_mode),
      source: stats.source || 'ai_adjustment_engine',
      proposedTransactions: (result.proposedTransactions || []).length
    });

    if (stats.profile_integrity) {
      console.log('\n=== Profile Integrity ===');
      console.log(stats.profile_integrity);
    }

    if (stats.classification_counts) {
      console.log('\n=== Classification Counts ===');
      console.log(stats.classification_counts);
    }

    const debugRows = stats.debug_trace_rows || [];
    const fallbackRows = result.diagnostics?.samples || [];
    const chosenRows = debugRows.length > 0 ? debugRows : fallbackRows;
    const normalized = normalizeRows(chosenRows).slice(0, sampleLimit);

    console.log(`\n=== Account Trace (${normalized.length}) ===`);
    if (normalized.length === 0) {
      console.log('No trace rows available. Check debug_trace or fallback diagnostics.');
    } else {
      console.table(normalized);
    }
  } catch (error) {
    const status = error.response?.status;
    const body = error.response?.data;
    console.error('\n=== Request Failed ===');
    console.error(JSON.stringify({ status, message: error.message, body }, null, 2));
    process.exitCode = 1;
  }
}

run();
