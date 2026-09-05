#!/usr/bin/env node
/**
 * shadow_e2e.mjs — Diferencial shadow legacy vs universal EN NAVEGADOR (U-7).
 *
 * Usa e2e-harness.html en modo dual (&dual=1&kind=...): el navegador ejecuta
 * la réplica legacy + el pipeline canónico sobre el mismo archivo y reporta
 * el veredicto SAME/IMPROVEMENT/INTENTIONAL_CHANGE/REGRESSION/UNKNOWN.
 * Gate: 0 REGRESSION + 0 UNKNOWN en el corpus gated (DASH, ASFI).
 * VARLEN es informational (se reporta, no bloquea).
 *
 * Gate manual de U-7 (no forma parte de `npm test`: requiere Edge/Chrome).
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
    { name: 'SH-DASH(Hoja2)', file: 'PUCT/Planes de cuentas.xlsx', publicName: 'sh-hoja2.xlsx', sheet: 'Hoja2', kind: 'dash', mode: 'gated' },
    { name: 'SH-ASFI', file: 'PUCT/Planes de cuentas.xlsx', publicName: 'sh-asfi.xlsx', sheet: 'Plan de cuentas ASFI', kind: 'generic', mode: 'gated' },
    { name: 'SH-VARLEN(Hoja5)', file: 'PUCT/Planes de cuentas.xlsx', publicName: 'sh-hoja5.xlsx', sheet: 'Hoja5', kind: 'generic', mode: 'informational' }
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
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
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
    return { ready, send, evl, close: () => ws.close() };
}

async function main() {
    if (!browserPath) { log('Shadow E2E: UNVERIFIED (no hay Edge/Chrome)'); process.exit(2); }

    const corpusDir = path.join(clientDir, 'public', 'e2e-corpus');
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
    const profileDir = path.join(root, `.tmp-she2e-${Date.now()}`);
    const edge = spawn(browserPath, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${debugPort}`, '--user-data-dir=' + profileDir, 'about:blank'], { stdio: 'ignore' });
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);
    log('✅ Navegador listo');

    const runCase = async (item) => {
        const url = `http://127.0.0.1:${port}/e2e-harness.html?file=e2e-corpus/${item.publicName}&sheet=${encodeURIComponent(item.sheet)}&dual=1&kind=${item.kind}`;
        const tab = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
        const s = cdpSession(tab);
        await s.ready;
        await s.send('Page.enable');
        await s.send('Runtime.enable');
        await s.send('Page.navigate', { url });
        let diff = null;
        for (let i = 0; i < 90; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const raw = await s.evl('window.__E2E_RESULTS__ ? JSON.stringify(window.__E2E_RESULTS__) : "[]"');
                const parsed = JSON.parse(raw || '[]');
                const hit = parsed.find(d => d.differential === true);
                if (hit) { diff = hit; break; }
            } catch { /* contexto aún no listo */ }
        }
        let browserReal = false;
        try { browserReal = await s.evl('window.__E2E_BROWSER__ === true'); } catch { }
        await fetch(`http://127.0.0.1:${debugPort}/json/close/${tab.id}`);
        s.close();
        return { diff, browserReal };
    };

    let pass = 0, fail = 0;
    for (const item of CORPUS) {
        try {
            const { diff, browserReal } = await runCase(item);
            if (!diff || !browserReal) {
                fail++;
                log(`❌ ${item.name}: SIN DIFERENCIAL (browser=${browserReal} diff=${diff ? 'sí' : 'no'})`);
                continue;
            }
            const c = diff.counts || {};
            if (item.mode === 'gated') {
                if (diff.verdict === 'PASS') {
                    pass++;
                    log(`✅ ${item.name}: veredicto PASS en navegador (SAME=${c.SAME} IMP=${c.IMPROVEMENT} REG=${c.REGRESSION} UNK=${c.UNKNOWN})`);
                } else {
                    fail++;
                    log(`❌ ${item.name}: veredicto ${diff.verdict} — ${JSON.stringify(diff.sample || []).slice(0, 400)}`);
                }
            } else {
                pass++;
                log(`🟡 ${item.name}: informational en navegador — veredicto ${diff.verdict} (SAME=${c.SAME} IMP=${c.IMPROVEMENT} REG=${c.REGRESSION} UNK=${c.UNKNOWN})`);
            }
        } catch (e) {
            fail++;
            log(`❌ ${item.name}: excepción ${e.message}`);
        }
    }

    try { fs.rmSync(corpusDir, { recursive: true, force: true }); } catch { }
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { }
    try { vite.kill(); edge.kill(); } catch { }
    log(`\nShadow E2E U-7: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
