#!/usr/bin/env node
/**
 * wizard_e2e_u2.mjs — E2E REAL del UniversalImportWizard (pasos 1–2) en navegador.
 *
 * Flujo verificado: File API real → UniversalImportWizard → FormatAdapter →
 * CanonicalDocument → UniversalPlanAnalyzer → ImportSession → diagnóstico UI.
 * Cero red hacia el backend: se intercepta TODO el tráfico y se exige que
 * ninguna request toque /api/* (ni POST, ni GET).
 *
 * Gate manual de U-2 (no forma parte de `npm test`: requiere Edge/Chrome + minutos).
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
    { name: 'U2-PUCT5C', file: 'PUCT/puct.xlsx', publicName: 'u2-puct5c.xlsx', sheet: null, pages: null, expectNodes: 2000, expectRegions: 1 },
    { name: 'U2-DASH(Hoja2)', file: 'PUCT/Planes de cuentas.xlsx', publicName: 'u2-hoja2.xlsx', sheet: 'Hoja2', pages: null, expectNodes: 200, expectRegions: 1 },
    { name: 'U2-MEFP-PDF', file: 'PUCT/PlanDeCuentasPublicacionVer5.pdf', publicName: 'u2-mefp.pdf', sheet: null, pages: '6-16', expectNodes: 200, expectRegions: 2 }
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
        await fetch(`http://127.0.0.1:${debugPort}/json/close/${tab.id}`);
        s.close();
        return { snap, browserReal, apiHits };
    };

    let pass = 0, fail = 0;
    for (const item of CORPUS) {
        const f = path.join(root, item.file);
        if (!fs.existsSync(f)) { log(`⚠️ ${item.name}: archivo no existe`); continue; }
        try {
            const { snap, browserReal, apiHits } = await runCase(item);
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
            const bad = checks.filter(([, ok]) => !ok).map(([name]) => name);
            if (bad.length === 0) {
                pass++;
                log(`✅ ${item.name}: paso=2 regiones=${snap.regionCount} nodos=${snap.nodeCount} blocks=${snap.blocks} · cero red /api/*`);
            } else {
                fail++;
                log(`❌ ${item.name}: falla en [${bad.join(', ')}] snap=${JSON.stringify(snap)} apiHits=${JSON.stringify(apiHits.slice(0, 3))}`);
            }
        } catch (e) {
            fail++;
            log(`❌ ${item.name}: excepción ${e.message}`);
        }
    }

    try { fs.rmSync(corpusDir, { recursive: true, force: true }); } catch { }
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { }
    try { vite.kill(); edge.kill(); } catch { }
    log(`\nWizard E2E U-2: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
