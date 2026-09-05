#!/usr/bin/env node
/**
 * wizard_import_e2e.mjs — E2E de IMPORTACIÓN REAL del UniversalImportWizard.
 *
 * App completa en navegador (Edge headless vía CDP) contra backend Node LOCAL
 * con base de datos SQLite LOCAL en archivo temporal (TURSO_DATABASE_URL=file:…).
 * CERO contacto con producción: se sobrescriben TURSO_* por entorno (dotenv no
 * pisa variables ya definidas) y AI_ENGINE_URL apunta a un puerto muerto para
 * que el keep-alive no despierte el motor de Render.
 *
 * Flujo: crear empresa desechable → abrir /app/accounts?engine=universal →
 * importar CSV limpio (pasos 1→6, resolviendo gates en la UI) → Confirmar →
 * verificar cuentas vía API + code_mask persistido. Limpieza total al final.
 *
 * Exit: 0 PASS; 1 FAIL; 2 sin navegador.
 */
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const clientDir = path.join(root, 'web-app/client');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browserPath = fs.existsSync(EDGE) ? EDGE : (fs.existsSync(CHROME) ? CHROME : null);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function freePort() {
    return new Promise((resolve) => {
        const srv = http.createServer();
        srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    });
}
async function waitForHttp(url, timeoutMs = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.status < 500) return true;
        } catch { }
        await sleep(500);
    }
    throw new Error('timeout esperando ' + url);
}

function cdpSession(tab) {
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    let mid = 0;
    const pend = new Map();
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
        const id = ++mid;
        const timer = setTimeout(() => { pend.delete(id); rej(new Error('cdp timeout ' + method)); }, 30000);
        pend.set(id, (m) => { clearTimeout(timer); res(m); });
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evl = async (expr) => {
        const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (m.error) throw new Error(m.error.message);
        if (m.result && m.result.exceptionDetails) throw new Error('evalexc ' + JSON.stringify(m.result.exceptionDetails).slice(0, 300));
        return m.result && m.result.result ? m.result.result.value : undefined;
    };
    return { ready, send, evl, close: () => ws.close() };
}

async function main() {
    if (!browserPath) { log('Import E2E: UNVERIFIED (no hay Edge/Chrome)'); process.exit(2); }
    const tmp = path.join(os.tmpdir(), `u5-import-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    const dbPath = path.join(tmp, 'e2e.db');
    const csvPath = path.join(tmp, 'plan.csv');
    // Fixture con jerarquía TOTALMENTE declarada por el engine (método SEGMENT):
    // el E2E verifica persistencia fiel del contrato, no inferencia nueva.
    fs.writeFileSync(csvPath, 'CODIGO,NOMBRE\n1,ACTIVO\n1.1,CAJA\n1.1.01,CAJA MN\n', 'utf8');
    // PUCT real del repo para el camino del guard (se sube directo, sin copiar).
    const puctPath = path.join(root, 'PUCT/puct.xlsx');
    const procs = [];
    const cleanup = () => {
        for (const p of procs) { try { p.kill(); } catch { } }
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
    };
    process.on('exit', cleanup);

    try {
        // 1) Backend local con DB local
        log('① Backend local (DB file: temporal)…');
        const backend = spawn(process.execPath, [path.join(root, 'web-app/server/index.js')], {
            cwd: root,
            stdio: 'ignore',
            env: {
                ...process.env,
                TURSO_DATABASE_URL: 'file:' + dbPath,
                TURSO_AUTH_TOKEN: 'u5-local-e2e',
                AI_ENGINE_URL: 'http://127.0.0.1:9',
                PORT: '3001'
            }
        });
        procs.push(backend);
        await waitForHttp('http://127.0.0.1:3001/api/companies');
        log('✅ Backend :3001 con DB local');

        // 2) Empresa desechable
        await fetch('http://127.0.0.1:3001/api/companies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'E2E Desechable U5', legal_name: 'E2E Desechable U5 S.A.',
                nit: '999999901', address: 'Calle Falsa 123', city: 'La Paz',
                phone: '70000000', email: 'e2e@desechable.bo',
                societal_type: 'Unipersonal', activity_type: 'Comercial',
                currency: 'BOB', current_year: new Date().getFullYear()
            })
        }).then(r => r.json());
        // El POST devuelve data:{} (lastID BigInt no serializado): resolver por NIT.
        const list = await fetch('http://127.0.0.1:3001/api/companies').then(r => r.json());
        const mine0 = (list.data || list).find(c => String(c.nit) === '999999901');
        const companyId = mine0 && mine0.id;
        if (!companyId) throw new Error('no se pudo crear la empresa desechable');
        log(`✅ Empresa desechable id=${companyId}`);

        // 3) Frontend dev (proxy /api → :3001)
        const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '51971', '--strictPort', '--host', '127.0.0.1'], { cwd: clientDir, stdio: 'ignore' });
        procs.push(vite);
        await waitForHttp('http://127.0.0.1:51971/');
        log('✅ Vite :51971');

        // 4) Navegador + app real
        const debugPort = await freePort();
        const profileDir = path.join(tmp, 'profile');
        const edge = spawn(browserPath, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${debugPort}`, '--user-data-dir=' + profileDir, 'about:blank'], { stdio: 'ignore' });
        procs.push(edge);
        await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);
        const tab = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
        const s = cdpSession(tab);
        await s.ready;
        await s.send('Page.enable');
        await s.send('Runtime.enable');
        await s.send('DOM.enable');

        await s.send('Page.navigate', { url: 'http://127.0.0.1:51971/app/accounts?engine=universal' });
        await sleep(6000);
        // Sin empresa seleccionada la app redirige al selector: elegir la
        // desechable como un usuario (clic en su tarjeta). A partir de aquí
        // TODO es navegación SPA (sin recargas: el provider perdería el estado).
        const picked = await s.evl(`(async () => {
            for (let i = 0; i < 20; i++) {
                const cards = [...document.querySelectorAll('.company-card')];
                const card = cards.find(c => c.textContent.includes('E2E Desechable U5'));
                const btn = card && card.querySelector('.btn-enter');
                if (btn) { btn.click(); return 'clicked'; }
                await new Promise(r => setTimeout(r, 1000));
            }
            return 'not-found';
        })()`);
        if (picked !== 'clicked') throw new Error('no se encontró la tarjeta de la empresa desechable en el selector');
        await sleep(3000);
        const selId = await s.evl(`localStorage.getItem('selectedCompanyId')`);
        if (!selId) throw new Error('la empresa no quedó seleccionada tras el clic');
        await s.evl(`history.pushState({}, '', '/app/accounts?engine=universal'); window.dispatchEvent(new PopStateEvent('popstate'))`);
        await sleep(6000);
        const hasImportBtn = await s.evl(`(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Importar')))()`);
        if (!hasImportBtn) {
            const dbgUrl = await s.evl(`location.href`);
            const dbgBody = await s.evl(`document.body.innerText.slice(0, 400)`);
            const dbgBtns = await s.evl(`JSON.stringify([...document.querySelectorAll('button')].map(b => b.textContent.trim().slice(0, 30)).slice(0, 12))`);
            throw new Error(`sin botón Importar. url=${dbgUrl} body=${dbgBody} btns=${dbgBtns}`);
        }
        log('✅ App real con empresa seleccionada');

        // U-6: default legacy idéntico — sin ?engine= debe abrir el clásico.
        // (match exacto: ahora hay dos botones que contienen "Importar").
        const clickLegacyImport = `(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Importar').click())()`;
        await s.evl(`history.pushState({}, '', '/app/accounts'); window.dispatchEvent(new PopStateEvent('popstate'))`);
        await sleep(3000);
        await s.evl(clickLegacyImport);
        await sleep(2500);
        const legacyOpen = await s.evl(`(() => {
            const hasU2 = !!document.querySelector('[data-testid="u2-wizard"]');
            const hasLegacy = document.body.innerText.includes('Selecciona el Archivo');
            return { hasU2, hasLegacy };
        })()`);
        if (legacyOpen.hasU2 || !legacyOpen.hasLegacy) throw new Error('default sin flag no abrió el clásico: ' + JSON.stringify(legacyOpen));
        await s.evl(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await sleep(1500);
        const legacyClosed = await s.evl(`!document.body.innerText.includes('Selecciona el Archivo')`);
        if (!legacyClosed) throw new Error('el clásico no se cerró con Escape');
        log('✅ Default legacy idéntico (abre clásico, sin rastro universal)');
        // U-9 opt-in: botón dedicado abre el universal SIN flag en URL ni storage.
        await s.evl(`history.pushState({}, '', '/app/accounts'); window.dispatchEvent(new PopStateEvent('popstate'))`);
        await sleep(3000);
        await s.evl(`(() => [...document.querySelectorAll('button')].find(b => b.getAttribute('data-testid') === 'open-universal-wizard').click())()`);
        await sleep(2500);
        const optInOpen = await s.evl(`!!document.querySelector('[data-testid="u2-wizard"]')`);
        if (!optInOpen) throw new Error('el botón opt-in no abrió el universal sin flag');
        await s.evl(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await sleep(1500);
        const optInClosed = await s.evl(`!document.querySelector('[data-testid="u2-wizard"]')`);
        if (!optInClosed) throw new Error('el universal opt-in no se cerró con Escape');
        log('✅ Opt-in U-9 (abre universal sin flag, sin tocar default)');
        // U-9 guard en app real: PUCT5C se excluye antes de analizar y redirige.
        await s.evl(`(() => [...document.querySelectorAll('button')].find(b => b.getAttribute('data-testid') === 'open-universal-wizard').click())()`);
        await sleep(2500);
        const docG = await s.send('DOM.getDocument', {});
        const qG = async (sel) => (await s.send('DOM.querySelector', { nodeId: docG.result.root.nodeId, selector: sel })).result.nodeId;
        const inputG = await qG('input[data-testid="u2-file-input"]');
        if (!inputG) throw new Error('input de archivo no encontrado (guard)');
        await s.send('DOM.setFileInputFiles', { nodeId: inputG, files: [puctPath] });
        let guardOk = false;
        for (let i = 0; i < 60; i++) {
            await sleep(1000);
            guardOk = await s.evl(`!!document.querySelector('[data-testid="u2-puct-guard"]')`);
            if (guardOk) break;
        }
        if (!guardOk) throw new Error('PUCT5C no mostró el panel guard en la app real');
        const analyzeHidden = await s.evl(`!document.querySelector('[data-testid="u2-analyze-btn"]')`);
        if (!analyzeHidden) throw new Error('el botón Analizar sigue visible con PUCT excluido');
        await s.evl(`document.querySelector('[data-testid="u2-puct-goto-classic"]').click()`);
        await sleep(2000);
        const storedLegacy = await s.evl(`localStorage.getItem('importEngine')`);
        if (storedLegacy !== 'legacy') throw new Error('goto-classic no persistió legacy');
        await s.evl(`history.pushState({}, '', '/app/accounts'); window.dispatchEvent(new PopStateEvent('popstate'))`);
        await sleep(3000);
        await s.evl(clickLegacyImport);
        await sleep(2500);
        const backToLegacy = await s.evl(`!document.querySelector('[data-testid="u2-wizard"]') && document.body.innerText.includes('Selecciona el Archivo')`);
        if (!backToLegacy) throw new Error('tras el guard no se volvió al clásico');
        await s.evl(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await sleep(1500);
        // El flag quedó en legacy: limpiar para el flujo ?engine=universal posterior.
        await s.evl(`localStorage.removeItem('importEngine')`);
        log('✅ Guard PUCT en app real (excluye + redirige al clásico)');
        await s.evl(`history.pushState({}, '', '/app/accounts?engine=universal'); window.dispatchEvent(new PopStateEvent('popstate'))`);
        await sleep(3000);

        // 5) Abrir wizard + subir CSV
        await s.evl(`(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Importar')).click())()`);
        await sleep(2500);
        const wizardOpen = await s.evl(`!!document.querySelector('[data-testid="u2-wizard"]')`);
        if (!wizardOpen) throw new Error('el wizard universal no se abrió (¿flag engine no activo?)');
        const doc = await s.send('DOM.getDocument', {});
        const q = async (sel) => (await s.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: sel })).result.nodeId;
        const inputId = await q('input[data-testid="u2-file-input"]');
        if (!inputId) throw new Error('input de archivo no encontrado');
        await s.send('DOM.setFileInputFiles', { nodeId: inputId, files: [csvPath] });
        await sleep(3000);
        log('✅ Archivo subido al wizard real');

        // 6) Caminar pasos 1→4
        const waitSel = async (sel, secs, what) => {
            for (let i = 0; i < secs; i++) {
                await sleep(1000);
                const present = await s.evl(`!!document.querySelector(${JSON.stringify(sel)})`);
                if (present) return true;
            }
            throw new Error('timeout esperando ' + what);
        };
        const clickTestid = async (tid) => s.evl(`document.querySelector('[data-testid="${tid}"]').click()`);
        await clickTestid('u2-analyze-btn');
        await waitSel('[data-testid="u2-diag"]', 60, 'diagnóstico');
        await clickTestid('u2-next-btn');
        await waitSel('[data-testid="u2-validation"]', 30, 'validación');
        await clickTestid('u2-next-btn');
        await waitSel('[data-testid="u2-review"]', 30, 'revisión');
        log('✅ Pasos 1→4 en la app real');

        // 7) Resolver gates en la UI (fila por fila)
        for (let round = 0; round < 8; round++) {
            const ids = await s.evl(`(() => [...document.querySelectorAll('[data-testid^="u2-evidence-"]')].map(b => b.getAttribute('data-testid')))()`);
            if (!ids || ids.length === 0) break;
            for (const id of ids) {
                await s.evl(`document.querySelector('[data-testid="${id}"]').click()`);
                await sleep(400);
                await s.evl(`(() => { document.querySelectorAll('[data-testid^="u2-confirm-nature-"]').forEach(b => b.click()); document.querySelectorAll('[data-testid^="u2-resolve-node-"]').forEach(b => b.click()); return 1; })()`);
                await sleep(400);
            }
            await s.evl(`(() => { document.querySelectorAll('[data-testid^="u2-resolve-warn-"]').forEach(b => b.click()); return 1; })()`);
            await sleep(500);
            const enabled = await s.evl(`(() => { const b = document.querySelector('[data-testid="u2-next-btn"]'); return b ? b.disabled === false : null; })()`);
            if (enabled) break;
        }
        const canProceed = await s.evl(`(() => { const b = document.querySelector('[data-testid="u2-next-btn"]'); return b ? b.disabled === false : null; })()`);
        if (!canProceed) throw new Error('gates no se pusieron en verde tras resolver en la UI');
        await clickTestid('u2-next-btn');
        await waitSel('[data-testid="u2-summary"]', 30, 'resumen');
        log('✅ Paso 5 resumen con gates en verde');
        await clickTestid('u2-next-btn');
        await waitSel('[data-testid="u2-confirm"]', 30, 'confirmación');

        // 8) CONFIRMAR IMPORT REAL
        const confirmEnabled = await s.evl(`(() => { const b = document.querySelector('[data-testid="u2-confirm-btn"]'); return b ? b.disabled === false : null; })()`);
        if (!confirmEnabled) throw new Error('botón Confirmar deshabilitado con empresa activa y gates verdes');
        await clickTestid('u2-confirm-btn');
        let receipt = null;
        for (let i = 0; i < 90; i++) {
            await sleep(1000);
            receipt = await s.evl(`(() => { const el = document.querySelector('[data-testid="u2-import-result"]'); return el ? el.innerText : null; })()`);
            if (receipt) break;
        }
        if (!receipt) throw new Error('sin recibo de importación (¿falló el POST?)');
        log('✅ Recibo: ' + receipt.replace(/\n/g, ' ').slice(0, 140));
        if (!/3 cuentas importadas/.test(receipt)) throw new Error('recibo inesperado: ' + receipt.slice(0, 200));
        // El contrato punteado no declara longitudes: la máscara NO debe inventarse.
        if (!/no determinada por el análisis — no actualizada/.test(receipt)) {
            throw new Error('el recibo debía declarar estructura no actualizada (sin longitudes declaradas)');
        }

        // 9) Verificar en la DB local vía API
        const accounts = await fetch(`http://127.0.0.1:3001/api/accounts?companyId=${companyId}`).then(r => r.json());
        const rows = accounts.data || accounts;
        const codes = rows.map(a => a.code).sort();
        if (JSON.stringify(codes) !== JSON.stringify(['1', '1.1', '1.1.01'])) {
            throw new Error('cuentas en DB no coinciden: ' + JSON.stringify(codes));
        }
        const byCode = Object.fromEntries(rows.map(a => [a.code, a]));
        const problems = [];
        if (byCode['1']?.level !== 1) problems.push(`1.level=${JSON.stringify(byCode['1']?.level)}`);
        if (byCode['1.1']?.parent_code !== '1') problems.push(`1.1.parent=${JSON.stringify(byCode['1.1']?.parent_code)}`);
        if (byCode['1.1.01']?.parent_code !== '1.1') problems.push(`1.1.01.parent=${JSON.stringify(byCode['1.1.01']?.parent_code)}`);
        if (String(byCode['1.1.01']?.name || '').trim() !== 'CAJA MN') problems.push(`1.1.01.name=${JSON.stringify(byCode['1.1.01']?.name)}`);
        if (byCode['1']?.type !== 'Activo' || byCode['1.1']?.type !== 'Activo' || byCode['1.1.01']?.type !== 'Activo') problems.push('types=' + JSON.stringify(rows.map(a => a.type)));
        if (problems.length > 0) {
            throw new Error('jerarquía/nombres/tipos incorrectos [' + problems.join(' | ') + '] rows=' + JSON.stringify(rows).slice(0, 600));
        }
        const companies = await fetch('http://127.0.0.1:3001/api/companies').then(r => r.json());
        const mine = (companies.data || companies).find(c => String(c.id) === String(companyId));
        if (!mine) throw new Error('la empresa desechable desapareció de la DB local');
        if (mine.code_mask) throw new Error('code_mask debía seguir vacío (sin longitudes declaradas no se inventa máscara): ' + mine.code_mask);
        log(`✅ DB local verificada: 3 cuentas (1/1.1/1.1.01) + máscara correctamente NO escrita`);

        s.close();
        log('\nImport E2E U-5: PASS (import real en empresa desechable, DB local)');
        process.exit(0);
    } catch (e) {
        console.error('❌ Import E2E U-5: FAIL —', e.message);
        process.exit(1);
    } finally {
        cleanup();
    }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
