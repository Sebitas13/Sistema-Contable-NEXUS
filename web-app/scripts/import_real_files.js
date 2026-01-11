(async () => {
  const path = require('path');
  const fs = require('fs');
  const xlsx = require('xlsx');
  const pdfParse = require('pdf-parse');

  const profilePath = path.resolve(__dirname, '..', 'client', 'src', 'utils', 'AccountPlanProfile.js');
  const mod = await import('file://' + profilePath.replace(/\\/g, '/'));
  const AccountPlanProfile = mod.AccountPlanProfile;

  const files = [
    'C:\\Users\\user\\Desktop\\Sistema Contable\\DataForgeDocs\\Plan de Cuentas ASFI (1).xlsx',
    'C:\\Users\\user\\Desktop\\Sistema Contable\\Plan de cuentas demo.xlsx',
    'C:\\Users\\user\\Desktop\\Sistema Contable\\PUCT\\puct.xlsx',
    'C:\\Users\\user\\Desktop\\Sistema Contable\\PUCT\\Estructura.txt'
  ];

  // include official ASFI PDF for extraction
  files.push('C:\\Users\\user\\Desktop\\Sistema Contable\\Plan de Cuentas ASFI.pdf');

  async function extractFromTxt(filePath) {
    const txt = fs.readFileSync(filePath, 'utf8');
    const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const accounts = [];
    // Try to parse lines that look like codes or examples: lines containing sequences like 1 1 1 001 001 or 100-10-01
    const pattern1 = /([0-9](?:[ \-\.\/][0-9A-Za-z]+){0,6})\s+[-–—:\.]?\s*(.+)$/;
    const patternSeq = /^(?:[0-9]+(?:[ \-\.\/]|$)){1,10}/;
    for (const l of lines) {
      // skip header lines that are descriptive
      if (l.length < 3) continue;
      const m = l.match(pattern1);
      if (m) {
        const code = m[1].trim().replace(/\s+/g, '-');
        const name = (m[2] || '').trim();
        if (code) accounts.push({ code, name });
        continue;
      }
      // fallback: if line contains sequences like '1 1 1 001 001'
      if (patternSeq.test(l)) {
        const parts = l.split(/\s+/).slice(0,5);
        const code = parts.join('-');
        const name = l.replace(parts.join(' '), '').trim();
        if (code) accounts.push({ code, name });
      }
    }
    return accounts;
  }

  function guessColumns(sheetData) {
    // sheetData: array of arrays
    if (!sheetData || sheetData.length === 0) return {code:0,name:1};
    const header = sheetData[0].map(h => String(h || '').toLowerCase());
    let code = -1, name = -1;
    header.forEach((h, idx) => {
      if (h.match(/codigo|código|code|cta|account/)) code = idx;
      if (h.match(/nombre|name|descripcion|description/)) name = idx;
    });
    if (code === -1) code = 0;
    if (name === -1) name = 1;
    return { code, name };
  }

  async function extractFromXlsx(filePath) {
    const wb = xlsx.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!data || data.length === 0) return [];
    // Heuristic: detect if the sheet stores levels in separate numeric columns (PUCT style)
    const header = data[0].map(h => String(h || '').toLowerCase());
    // Check first 6 rows for numeric-like columns
    const colCount = header.length;
    const numericCols = new Array(colCount).fill(0);
    const nonEmptyCols = new Array(colCount).fill(0);
    const sampleRows = Math.min(8, Math.max(3, data.length - 1));
    for (let r = 1; r <= sampleRows; r++) {
      const row = data[r] || [];
      for (let c = 0; c < colCount; c++) {
        const v = String(row[c] || '').trim();
        if (v) nonEmptyCols[c]++;
        if (v && v.match(/^\d+$/)) numericCols[c]++;
      }
    }
    const numericColIndexes = [];
    for (let c = 0; c < colCount; c++) {
      // treat as numeric column if at least 50% of non-empty sample rows are numeric
      if (nonEmptyCols[c] > 0 && numericCols[c] / nonEmptyCols[c] >= 0.5) numericColIndexes.push(c);
    }

    const accounts = [];
    if (numericColIndexes.length >= 2) {
      // Combine numeric columns into a compound code
      for (let r = 1; r < data.length; r++) {
        const row = data[r];
        const parts = numericColIndexes.map(i => String(row[i] || '').trim()).filter(Boolean);
        if (parts.length === 0) continue;
        const code = parts.join('-');
        // name: find first non-numeric, non-empty cell
        let name = '';
        for (let c = 0; c < colCount; c++) {
          const v = String(row[c] || '').trim();
          if (v && !/^\d+$/.test(v)) { name = v; break; }
        }
        accounts.push({ code, name });
      }
      return accounts;
    }

    // Fallback: single-column codes (maybe combined with separator)
    const cols = guessColumns(data);
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const code = String(row[cols.code] || '').trim();
      const name = String(row[cols.name] || '').trim();
      if (!code) continue;
      accounts.push({ code, name });
    }
    return accounts;
  }

  async function extractFromPdf(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
      // Try pdf-parse if available
      try {
        const parser = (typeof pdfParse === 'function') ? pdfParse : (pdfParse && typeof pdfParse.default === 'function' ? pdfParse.default : null);
        if (parser) {
          const pdf = await parser(dataBuffer);
          const text = pdf.text || '';
          const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          const accounts = [];
          const codeRegex = /^\s*([0-9]{1,3}(?:[\.\-/][0-9A-Za-z]+)*|[0-9]{3,9})\s+(.+)/;
          for (const l of lines) {
            const m = l.match(codeRegex);
            if (m) {
              const code = m[1].trim();
              const name = m[2].trim();
              accounts.push({ code, name });
            }
          }
          return accounts;
        }
      } catch (e) {
        console.warn('pdf-parse failed, falling back to pdfjs-dist:', e.message);
      }

      // Fallback: try pdfjs-dist (legacy build)
      try {
        const pdfjs = require('pdfjs-dist');
        const uint8 = new Uint8Array(dataBuffer);
        const loadingTask = pdfjs.getDocument({ data: uint8 });
        const pdfDoc = await loadingTask.promise;
        let text = '';
        const ASFI_PATTERNS = AccountPlanProfile.ASFI_PATTERNS || [];
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const page = await pdfDoc.getPage(i);
          const content = await page.getTextContent();

          // Group by Y coordinate to reconstruct lines (left-to-right)
          const lineGroups = {};
          content.items.forEach(item => {
            const y = Math.round(item.transform[5]);
            if (!lineGroups[y]) lineGroups[y] = [];
            lineGroups[y].push(item);
          });

          const pageLines = Object.keys(lineGroups)
            .sort((a, b) => parseFloat(b) - parseFloat(a))
            .map(y => lineGroups[y].sort((a, b) => a.transform[4] - b.transform[4]).map(it => it.str).join(''))
            .map(s => s.trim()).filter(Boolean);

          for (const l of pageLines) {
            // Try ASFI patterns first
            let matched = false;
            for (const p of ASFI_PATTERNS) {
              const m = l.match(p);
              if (m) {
                const code = m[1].trim();
                const name = (m[2] || '').trim().replace(/\s+/g, ' ');
                if (code && name && name.length > 2) {
                  text += code + ' ' + name + '\n';
                  matched = true;
                  break;
                }
              }
            }
            if (!matched) {
              // fallback simple match
              const m2 = l.match(/^\s*([0-9]{1,3}(?:[\.\-/][0-9A-Za-z]+)*|[0-9]{3,9})\s+(.+)/);
              if (m2) {
                text += m2[1].trim() + ' ' + m2[2].trim() + '\n';
              }
            }
          }
        }

        const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const accounts = [];
        for (const l of lines) {
          const m = l.match(/^\s*([0-9A-Za-z.\-\/]+)\s+(.+)$/);
          if (m) accounts.push({ code: m[1].trim(), name: m[2].trim() });
        }
        return accounts;
      } catch (e) {
        throw new Error('PDF extraction failed: ' + e.message);
      }
  }

  function analyzeAccounts(accounts, label) {
    console.log(`\n--- Analysis for ${label} ---`);
    console.log(`Total accounts: ${accounts.length}`);
    if (accounts.length === 0) { console.log('No accounts found'); return; }
    const sample = accounts.slice(0, 10).map(a => `${a.code} - ${a.name}`);
    console.log('Sample:', sample.join(' | '));

    const analysis = AccountPlanProfile.analyze(accounts);
    console.log('Detected separator:', analysis.separator);
    let cfg = AccountPlanProfile.toConfigFromAnalysis ? AccountPlanProfile.toConfigFromAnalysis(analysis) : AccountPlanProfile.getDefaultProfile();
    console.log('Normalized config (initial):', cfg);

    // Suggest level count from sampled codes using separator or simple heuristics
    function suggestLevelCount(accounts, analysis) {
      const samples = accounts.slice(0, 200).map(a => a.code).filter(Boolean);
      if (samples.length === 0) return 0;
      let sep = analysis && analysis.separator;
      if (!sep) {
        // try common separators
        const s = samples.find(s => s.indexOf('-') >= 0 || s.indexOf('.') >= 0 || s.indexOf(' ') >= 0);
        if (s) {
          if (s.indexOf('-') >= 0) sep = '-';
          else if (s.indexOf('.') >= 0) sep = '.';
          else sep = ' ';
        }
      }
      if (!sep) return 0;
      const counts = samples.map(c => c.split(sep).filter(Boolean).length);
      const freq = {};
      counts.forEach(n => freq[n] = (freq[n] || 0) + 1);
      // mode
      let mode = 0, max = 0;
      Object.keys(freq).forEach(k => { if (freq[k] > max) { max = freq[k]; mode = Number(k); } });
      return mode;
    }

    const suggested = suggestLevelCount(accounts, analysis);
    if (suggested > 0 && suggested !== (cfg.levelCount || 0)) {
      console.log('Suggested levelCount from samples:', suggested, '(will be applied to config)');
      // Build cumulative levelLengths from sample parts using detected separator
      const sep = cfg.separator || analysis.separator || '-';
      const samples = (analysis.samples || []).slice(0, 500).map(s => String(s || '').trim()).filter(Boolean);
      if (samples.length > 0 && sep) {
        const partCounts = samples.map(s => s.split(sep).map(p => p.trim()).filter(Boolean).length);
        // Determine common part length distribution
        const commonParts = Math.max(1, partCounts.reduce((a, b) => a > b ? a : b, 0));
        // Recompute levelLengths as cumulative lengths per part mode
        const partLengths = [];
        samples.forEach(s => {
          const parts = s.split(sep).map(p => p.trim()).filter(Boolean);
          parts.forEach((p, idx) => {
            partLengths[idx] = partLengths[idx] || [];
            partLengths[idx].push(p.length);
          });
        });
        const newLevelLengths = [];
        let acc = 0;
        for (let i = 0; i < Math.min(partLengths.length, suggested); i++) {
          const arr = partLengths[i] || [];
          if (arr.length === 0) {
            acc += 1; // fallback increment
            newLevelLengths.push(acc);
            continue;
          }
          const counts = {};
          arr.forEach(v => counts[v] = (counts[v] || 0) + 1);
          let mode = 0, maxc = 0;
          Object.entries(counts).forEach(([k, c]) => { if (c > maxc) { maxc = c; mode = Number(k); } });
          acc += Math.max(1, mode || 1);
          newLevelLengths.push(acc);
        }
        if (newLevelLengths.length > 0) {
          cfg.levelCount = newLevelLengths.length;
          cfg.levelLengths = newLevelLengths;
        }
      } else {
        // fallback: set simple evenly distributed lengths
        const totalLen = cfg.levelLengths && cfg.levelLengths.length ? cfg.levelLengths[cfg.levelLengths.length - 1] || suggested * 3 : suggested * 3;
        const newLens = [];
        for (let i = 1; i <= suggested; i++) newLens.push(Math.round((totalLen / suggested) * i));
        cfg.levelCount = suggested;
        cfg.levelLengths = newLens;
      }
      console.log('Normalized config (applied suggestion):', cfg);
    }

    const levels = {};
    accounts.forEach(a => {
      const lvl = AccountPlanProfile.calculateLevel(a.code, analysis);
      levels[lvl] = (levels[lvl] || 0) + 1;
    });
    console.log('Level distribution:', levels);

    // Generate preview mapping like the import wizard would (using applied cfg)
    const preview = generatePreview(accounts, analysis, cfg);
    const outDir = path.resolve(__dirname);
    const outFile = path.join(outDir, `preview_${label.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
    fs.writeFileSync(outFile, JSON.stringify(preview, null, 2), 'utf8');
    console.log('Wrote preview to', outFile);
  }

  function determineType(code, name) {
    const n = String(name || '').toLowerCase();
    if (n.match(/(depreciacion acumulada|amortizacion acumulada|provision|reguladora|valuacion|deterioro)/)) return { type: 'Reguladora', confidence: 85 };
    if (n.match(/(resultado del ejercicio|perdidas y ganancias|resultado neto|utilidad del ejercicio|deficit|superavit)/)) return { type: 'Resultado', confidence: 85 };
    if (n.match(/(contingente|contingentes)/)) return { type: 'Contingente', confidence: 80 };
    if (n.match(/(orden|cuentas de orden|garantias)/)) return { type: 'Orden', confidence: 80 };
    if (n.match(/(capital|aportes|reserva|patrimonio|utilidades retenidas|resultados acumulados)/)) return { type: 'Patrimonio', confidence: 80 };
    if (n.match(/(ingreso|venta|ventas|ganancia|productos|recursos|devengado)/)) return { type: 'Ingreso', confidence: 75 };
    if (n.match(/(costo|mercaderia|compras|inventario)/)) return { type: 'Costo', confidence: 75 };
    if (n.match(/(gasto|gastos|sueldo|alquiler|honorarios|servicios|impuestos|mantenimiento)/)) return { type: 'Gasto', confidence: 75 };
    if (n.match(/(pagar|proveedor|deuda|pasivo|obligaciones|retenciones)/)) return { type: 'Pasivo', confidence: 70 };
    if (n.match(/(caja|banco|activo|disponible|inversiones|bienes)/)) return { type: 'Activo', confidence: 70 };
    const first = String(code || '').charAt(0);
    const map = { '1':'Activo','2':'Pasivo','3':'Patrimonio','4':'Reguladora','5':'Orden','6':'Costo','7':'Gasto','8':'Ingreso','9':'Otra cuenta de resultados' };
    return { type: map[first] || 'Activo', confidence: 50 };
  }

  function generatePreview(accounts, analysis, cfg) {
    cfg = cfg || (AccountPlanProfile.toConfigFromAnalysis ? AccountPlanProfile.toConfigFromAnalysis(analysis) : AccountPlanProfile.getDefaultProfile());
    const groupRules = {};
    // find level1 accounts: codes that represent top groups
    accounts.forEach(a => {
      const code = String(a.code || '').trim();
      const name = String(a.name || '').trim();
      // PUCT 9-digit top: X00000000
      if (code.match(/^([1-9])0{8}$/) || code.match(/^\d{1,3}-0{2}-0{2}$/) || code.match(/^\d{3}-00-00$/)) {
        const digit = code.replace(/[^0-9]/g,'').charAt(0);
        groupRules[digit] = determineType(code, name).type;
      }
    });

    const preview = accounts.map((a, idx) => {
      const code = String(a.code || '').trim();
      const name = String(a.name || '').trim();
      const level = AccountPlanProfile.calculateLevel(code, cfg) || 1;
      const parent = AccountPlanProfile.calculateParent(code, cfg);
      const dt = determineType(code, name);
      const firstDigit = code.replace(/[^0-9]/g,'').charAt(0) || code.charAt(0);
      const finalType = groupRules[firstDigit] || dt.type;
      return { index: idx+1, code, name, level, parent_code: parent, type: finalType, confidence: dt.confidence };
    });
    return preview;
  }

  for (const f of files) {
    try {
      if (!fs.existsSync(f)) { console.log(`File not found: ${f}`); continue; }
      const ext = path.extname(f).toLowerCase();
      let accounts = [];
      if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') {
        accounts = await extractFromXlsx(f);
      } else if (ext === '.pdf') {
        accounts = await extractFromPdf(f);
      } else if (ext === '.txt') {
        accounts = await extractFromTxt(f);
      } else {
        console.log('Unsupported file type:', f);
        continue;
      }
      analyzeAccounts(accounts, path.basename(f));
    } catch (e) {
      console.error('Error processing', f, e.message);
    }
  }

  console.log('\nImport tests completed.');
})();
