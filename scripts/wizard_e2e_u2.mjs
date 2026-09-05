#!/usr/bin/env node
/**
 * wizard_e2e_u2.mjs — E2E REAL del UniversalImportWizard (pasos 1–4) en navegador.
 *
 * Flujo verificado: File API real → UniversalImportWizard → FormatAdapter →
 * CanonicalDocument → UniversalPlanAnalyzer → ImportSession → diagnóstico UI →
 * validación (gates) + simulación (payload en memoria) → revisión (edición real
 * de celda + exclusión real de fila con traza en la sesión).
 * Cero red hacia el backend: se intercepta TODO el tráfico y se exige que
 * ninguna request toque /api/* (ni POST, ni GET).
 *
 * Gate manual de U-4 (no forma parte de `npm test`: requiere Edge/Chrome + minutos).
 * Exit: 0 si todo PASS; 1 si algún caso falla; 2 si no hay navegador.
 */
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const clientDir = path.join(root, 'web-app/client');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browserPath = fs.existsSync(EDGE) ? EDGE : (fs.existsSync(CHROME) ? CHROME : null);

const CORPUS = [
    { name: 'U4-PUCT5C', file: 'PUCT/puct.xlsx', publicName: 'u2-puct5c.xlsx', sheet: null, pages: null, expectNodes: 2000, expectRegions: 1, expectBlocks: 5 },
    { name: 'U4-DASH(Hoja2)', file: 'PUCT/Planes de cuentas.xlsx', publicName: 'u2-hoja2.xlsx', sheet: 'Hoja2', pages: null, expectNodes: 200, expectRegions: 1, expectBlocks: 1 },
    { name: 'U4-MEFP-PDF', file: 'PUCT/PlanDeCuentasPublicacionVer5.pdf', publicName: 'u2-mefp.pdf', sheet: null, pages: '6-16', expectNodes: 200, expectRegions: 2, expectBlocks: 0 }
];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function freePort() {
    return new Promise((resolve) => {
        const srv = http.createServer();
        srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    });
}
async function waitForHttp(url, timeoutMs = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.status < 500) return true;
        } catch { }
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('timeout esperando ' + url);
}

function cdpSession(tab) {
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    let mid = 0;
    const pend = new Map();
    const events = [];
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
        else if (m.method) events.push(m);
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
        const id = ++mid;
        const timer = setTimeout(() => { pend.delete(id); rej(new Error('cdp timeout ' + method)); }, 20000);
        pend.set(id, (m) => { clearTimeout(timer); res(m); });
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evl = async (expr) => {
        const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (m.error) throw new Error(m.error.message);
        return m.result?.result?.value;
    };
    const onEvent = (fn) => { events._hook = fn; };
    const origPush = events.push.bind(events);
    events.push = (m) => { origPush(m); if (events._hook) events._hook(m); };
    return { ready, send, evl, events, onEvent, close: () => ws.close() };
}

async function main() {
    if (!browserPath) { log('Wizard E2E: UNVERIFIED (no hay Edge/Chrome)'); process.exit(2); }

    const corpusDir = path.join(clientDir, 'public', 'wizard-corpus');
    fs.mkdirSync(corpusDir, { recursive: true });
    for (const item of CORPUS) {
        const f = path.join(root, item.file);
        if (fs.existsSync(f)) fs.copyFileSync(f, path.join(corpusDir, item.publicName));
    }

    const port = await freePort();
    const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: clientDir, stdio: 'ignore' });
    await waitForHttp(`http://127.0.0.1:${port}/`);
    log('✅ Vite :' + port);

    const debugPort = await freePort();
    const profileDir = path.join(root, `.tmp-wiz-${Date.now()}`);
    const edge = spawn(browserPath, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${debugPort}`, '--user-data-dir=' + profileDir, 'about:blank'], { stdio: 'ignore' });
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);
    log('✅ Navegador listo');

    const runCase = async (item) => {
        const q = `?file=wizard-corpus/${item.publicName}${item.sheet ? '&sheet=' + encodeURIComponent(item.sheet) : ''}${item.pages ? '&pages=' + item.pages : ''}&auto=1`;
        const url = `http://127.0.0.1:${port}/wizard-harness.html${q}`;
        const tab = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
        const s = cdpSession(tab);
        await s.ready;
        await s.send('Page.enable');
        await s.send('Runtime.enable');
        await s.send('Network.enable');
        const apiHits = [];
        s.onEvent((m) => {
            if (m.method === 'Network.requestWillBeSent') {
                const u = m.params?.request?.url || '';
                if (u.includes('/api/')) apiHits.push(`${m.params.request.method} ${u}`);
            }
        });
        await s.send('Page.navigate', { url });

        let snap = null;
        for (let i = 0; i < 90; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const raw = await s.evl('window.__WIZARD_U2__ ? JSON.stringify(window.__WIZARD_U2__) : "null"');
                const parsed = JSON.parse(raw || 'null');
                if (parsed && (parsed.phase === 'diagnosed' || parsed.phase === 'error')) { snap = parsed; break; }
            } catch { /* contexto aún no listo */ }
        }
        let browserReal = false;
        try { browserReal = await s.evl('window.__WIZARD_BROWSER__ === true'); } catch { }
        if (!snap || snap.phase !== 'diagnosed') {
            await fetch(`http://127.0.0.1:${debugPort}/json/close/${tab.id}`);
            s.close();
            return { snap, browserReal, apiHits, step3: null };
        }
        // Paso 3: clic en "Continuar a validación" y esperar uiStep===3
        let step3 = null;
        try {
            await s.evl('document.querySelector(\'[data-testid="u2-next-btn"]\').click()');
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 1000));
                try {
                    const raw = await s.evl('window.__WIZARD_U2__ ? JSON.stringify(window.__WIZARD_U2__) : "null"');
                    const parsed = JSON.parse(raw || 'null');
                    if (parsed && parsed.uiStep === 3) { step3 = parsed; break; }
                } catch { /* contexto aún no listo */ }
            }
        } catch (e) {
            step3 = { error: 'click-next-3: ' + e.message };
        }
        // Paso 4: clic en "Continuar a revisión", editar + excluir de verdad
        let step4 = null, afterEdit = null, afterExclude = null;
        try {
            if (step3 && step3.uiStep === 3) {
                await s.evl('document.querySelector(\'[data-testid="u2-next-btn"]\').click()');
            }
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 1000));
                try {
                    const raw = await s.evl('window.__WIZARD_U2__ ? JSON.stringify(window.__WIZARD_U2__) : "null"');
                    const parsed = JSON.parse(raw || 'null');
                    if (parsed && parsed.uiStep === 4) { step4 = parsed; break; }
                } catch { /* contexto aún no listo */ }
            }
            if (step4) {
                // Edición real de celda (nombre de la primera fila)
                await s.evl(`(() => {
                    const el = document.querySelector('[data-testid^="u2-cell-name-"]');
                    if (!el) return 'no-input';
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(el, 'EDITADA E2E');
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    return 'edited';
                })()`);
                for (let i = 0; i < 15; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    try {
                        const raw = await s.evl('window.__WIZARD_U2__ ? JSON.stringify(window.__WIZARD_U2__) : "null"');
                        const parsed = JSON.parse(raw || 'null');
                        if (parsed && parsed.userActions && parsed.userActions.overrides >= 1) { afterEdit = parsed; break; }
                    } catch { }
                }
                // Exclusión real de fila (primera fila)
                await s.evl(`(() => {
                    const btn = document.querySelector('[data-testid^="u2-del-"]');
                    if (!btn) return 'no-btn';
                    btn.click();
                    return 'excluded';
                })()`);
                for (let i = 0; i < 15; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    try {
                        const raw = await s.evl('window.__WIZARD_U2__ ? JSON.stringify(window.__WIZARD_U2__) : "null"');
                        const parsed = JSON.parse(raw || 'null');
                        if (parsed && parsed.userActions && parsed.userActions.exclusions >= 1) { afterExclude = parsed; break; }
                    } catch { }
                }
            }
        } catch (e) {
            step4 = step4 || { error: 'paso4: ' + e.message };
        }
        await fetch(`http://127.0.0.1:${debugPort}/json/close/${tab.id}`);
        s.close();
        return { snap, browserReal, apiHits, step3, step4, afterEdit, afterExclude };
    };

    let pass = 0, fail = 0;
    for (const item of CORPUS) {
        const f = path.join(root, item.file);
        if (!fs.existsSync(f)) { log(`⚠️ ${item.name}: archivo no existe`); continue; }
        try {
            const { snap, browserReal, apiHits, step3, step4, afterEdit, afterExclude } = await runCase(item);
            if (!snap || !browserReal || snap.phase !== 'diagnosed') {
                fail++;
                log(`❌ ${item.name}: SIN DIAGNÓSTICO (phase=${snap?.phase} browser=${browserReal} err=${snap?.error || '—'})`);
                continue;
            }
            const checks = [
                ['paso=2', snap.uiStep === 2],
                [`regiones≥${item.expectRegions}`, (snap.regionCount || 0) >= item.expectRegions],
                [`nodos≥${item.expectNodes}`, (snap.nodeCount || 0) >= item.expectNodes],
                ['silent=0', snap.silent === 0],
                ['unaccounted=0', snap.unaccounted === 0],
                ['cero /api/*', apiHits.length === 0]
            ];
            // Paso 3: validación + simulación renderizadas con gates reales
            if (!step3 || step3.uiStep !== 3 || !step3.validation || !step3.simulation) {
                checks.push(['paso=3+validación+simulación', false]);
            } else {
                checks.push(
                    ['paso=3', true],
                    [`blocks=${item.expectBlocks}`, step3.blocks === item.expectBlocks],
                    ['validation.can=false (gates activos)', step3.validation.can === false],
                    ['simulation.allowed=false (gate)', step3.simulation.allowed === false],
                    ['fingerprint presente', typeof step3.simulation.fingerprint === 'string' && step3.simulation.fingerprint.length > 0]
                );
            }
            // Paso 4: revisión con edición y exclusión reales
            if (!step4 || step4.uiStep !== 4) {
                checks.push(['paso=4', false]);
            } else {
                checks.push(
                    ['paso=4', true],
                    ['edición registra override', !!(afterEdit && afterEdit.userActions && afterEdit.userActions.overrides >= 1)],
                    ['exclusión registra + reduce effective', !!(afterExclude && afterExclude.userActions && afterExclude.userActions.exclusions >= 1 && afterExclude.effectiveNodes === afterExclude.nodeCount - afterExclude.userActions.exclusions)]
                );
            }
            const bad = checks.filter(([, ok]) => !ok).map(([name]) => name);
            if (bad.length === 0) {
                pass++;
                log(`✅ ${item.name}: paso=2→3→4 regiones=${snap.regionCount} nodos=${snap.nodeCount} blocks=${snap.blocks} · validación can=false · simulación bloqueada · edición+exclusión con traza · cero red /api/*`);
            } else {
                fail++;
                log(`❌ ${item.name}: falla en [${bad.join(', ')}] step4=${JSON.stringify(step4)} afterEdit=${JSON.stringify(afterEdit?.userActions)} afterExclude=${JSON.stringify(afterExclude?.userActions)} apiHits=${JSON.stringify(apiHits.slice(0, 3))}`);
            }
        } catch (e) {
            fail++;
            log(`❌ ${item.name}: excepción ${e.message}`);
        }
    }

    try { fs.rmSync(corpusDir, { recursive: true, force: true }); } catch { }
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { }
    try { vite.kill(); edge.kill(); } catch { }
    log(`\nWizard E2E U-4: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
