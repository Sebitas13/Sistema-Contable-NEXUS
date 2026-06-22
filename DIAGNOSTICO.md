# 🩺 Diagnóstico general — Sistema Contable NEXUS

> Auditoría de solo lectura realizada el 2026-06-21. No se modificó ningún archivo de la app.
> Severidades: 🔴 Crítico · 🟠 Alto · 🟡 Medio · 🔵 Bajo / cosmético

## Arquitectura real

```
Navegador ──> Vercel (frontend React/Vite)
                │  proxy /api/* (vercel.json)
                ▼
          Backend Node/Express  ── Render free (sistema-contable-nexus.onrender.com)
                │  ▲                    │
                │  │ callback           │ @libsql/client
                ▼  │                    ▼
          Motor Python/FastAPI       Turso (libSQL)  ← DB real de producción
          Render free (motor-ai-nexus.onrender.com)
```

- **`sqlite3` y `accounting.db` NO se usan en producción** — la DB real es Turso. `sqlite3` es dependencia huérfana; `accounting.db` es artefacto local versionado por error.
- La cadena es **bidireccional**: el navegador despierta a Node, Node despierta a Python, y Python vuelve a llamar a Node para traer el mayor contable. Por eso un cold start puede tener que despertar **dos** servicios.

---

## 🔴 CRÍTICO — atender primero

### C1. El restore de backup probablemente NO persiste nada
`web-app/server/db.js:245-249` + `web-app/server/routes/backup.js:162-171`.
`db.transaction()` reenvía a `client.transaction(callback)`, pero en `@libsql/client@0.17.0` `transaction()` espera un **string de modo**, no un callback, y exige `tx.commit()` explícito (que nunca se llama). Resultado: el import "termina con éxito" pero no escribe, o falla en silencio. Esto explica directamente que el backup "no funcione bien".
**Fix más seguro:** usar la rama manual `BEGIN IMMEDIATE / COMMIT / ROLLBACK` que ya existe en `backup.js:173-186` (hoy es código muerto), o reescribir `withTransaction` con el patrón correcto de libsql. Probar import real punta a punta contra Turso.

### C2. Inyección SQL en `POST /api/transactions/batch`
`web-app/server/routes/transactions.js:194-228`. Arma SQL por concatenación con un `escape()` casero que solo cubre comillas simples. Lo invoca también `/api/ai/adjustments/confirm` (`ai.js:1347`). El resto de rutas sí usan placeholders `?` correctamente.
**Fix:** parametrizar con `?` dentro de `db.transaction()`, eliminar el `escape()` casero.

### C3. Sin autenticación ni autorización en NINGUNA ruta
Cualquiera con la URL puede leer/crear/borrar datos. El aislamiento entre empresas depende de un `companyId` que el cliente envía libremente → **IDOR** (cualquiera opera sobre datos de otra empresa). Endpoints peligrosos abiertos: `DELETE /api/accounts/all`, `POST /api/backup/import`, `DELETE /api/companies/:id`.
**Fix:** middleware de auth + validar pertenencia de `companyId` al usuario.

### C4. Pérdida silenciosa de datos en el backup
`backup.js:23-35` respalda 11 tablas pero **omite** `cost_centers`, `cost_distribution_*` y `production_orders` (existen en `schema.sql` con datos reales). Restaurar una empresa = perder centros de costo y órdenes de producción. Tampoco respalda el "conocimiento IA" (skills en archivos JSON).
**Fix:** agregar esas tablas a `SUPPORTED_TABLES`/`IMPORT_ORDER` con remapeo de IDs, o documentar explícitamente la limitación.

---

## 🟠 ALTO

### A1. Cold start — el keep-alive existe pero NUNCA se activa
`web-app/server/utils/keepAlive.js` define un servicio completo (health-check cada 14 min, backoff exponencial) pero `index.js` **jamás llama a `.start()`**. Es código huérfano.
**Solución real (P0):** un cron externo (cron-job.org / UptimeRobot / GitHub Actions) que cada ~10 min haga GET a:
- `https://sistema-contable-nexus.onrender.com/api/status` (Node)
- `https://motor-ai-nexus.onrender.com/api/ai/health` (Python)

Es lo único que mantiene calientes ambos servicios free desde fuera. Activar también el keepAlive interno ayuda, pero no reemplaza al pinger externo. La causa raíz es estructural: 2 servicios free encadenados = 2 puntos de dormido (considerar subir el motor Python a plan pago).

### A2. Por qué los cálculos "se quedan en modo contingencia"
Cuando Python devuelve 503/timeout (cold start), el backend (`ai.js:1141-1168`) y el frontend (`aiAdjustmentService.js:307-328`) caen a un **fallback heurístico estático** (`/api/reports/adjustment-entries-proposal`, `confidence: 0.7`) que NO usa el motor de razonamiento real → ajustes degradados/genéricos. El circuit breaker (cooldown 20s) puede abrirse justo durante el arranque. El backoff es lineal, no exponencial.
**Fix:** warmup que reintente hasta `/health` 200 antes del payload pesado; no envenenar el breaker con timeouts de warmup; backoff exponencial.

### A3. UI/UX mobile — tablas contables anchas
El viewport y el sidebar (hamburguesa) están **bien**. El problema son tablas con `minWidth` fijos en px:
- 🥇 `Worksheet.jsx:1008-1043` — 21 columnas, >1.600px de ancho mínimo. El peor.
- `Journal.jsx:979-984` — modal de asiento no cabe en pantalla chica.
- `Ledger.jsx`, `TrialBalance.jsx`, `FinancialStatements.jsx` (sangría `level*1.5rem` aplasta nombres a nivel 5).
No hay reglas CSS que oculten columnas o reduzcan anchos en mobile (`index.css`).

### A4. Manejo de error de `archiver` puede tumbar Node
`backup.js:786-789` hace `throw` dentro de un callback async → excepción no capturada. Además no hay error handler global ni `process.on('unhandledRejection')`.

### A5. `accounting.db` versionado en git
`*.db` está en `.gitignore` pero el archivo se agregó antes de la regla. Genera ruido y conflictos. `git rm --cached web-app/server/accounting.db`.

### A6. Token Turso (rw a producción) en `.env` local
Ningún `.env` fue commiteado nunca (verificado en el historial) — el riesgo es exposición local del archivo. Aun así conviene **rotar el token** y crear un `.env.example` con placeholders.

---

## 🟡 MEDIO

- **Transacciones no atómicas bajo concurrencia:** `transactions.js` usa `BEGIN/COMMIT` como statements sueltos sobre una cola global compartida (`db.js`) → dos requests concurrentes pueden intercalar operaciones. Migrar a `db.transaction()` (una vez arreglado C1).
- **CORS abierto** a todo origen fuera de producción (`index.js:17-28`).
- **Multer sin validar tipo MIME** (`backup.js:50-53`) ni manejar `LIMIT_FILE_SIZE`. Riesgo zip-bomb.
- **Import de backup carga todo en RAM** (`backup.js:361-401`) — el export sí es streaming, el import no.
- **`getProfile` traga errores** (`ai.js:470-487`): devuelve `null` ante cualquier fallo de DB, enmascarando problemas.
- **Logs vuelcan el body completo** del request (`ai.js:925,1095`) — posible fuga de datos sensibles.
- **N+1 queries** en `inventory.js` GET `/items` (`:24-31`).

---

## 🔵 LIMPIEZA / orden (seguro, satisfactorio)

### Archivos basura seguros de eliminar (raíz)
`analyze_*.js` (3), `check_puct.js`, `debug_api.py`, `read_pdf_text.js/.mjs`, `mahoraga_demo.js`, `test_ai_request.json`, `test_*.js/.py` manuales, `test_puct_final.js` (duplicado), `kill-port.js` (duplicado de `.cjs`), `tmp_*.log` (4), `out.txt`, `test_out.txt`.

### En `web-app/client` (ya están en `.gitignore` pero fueron commiteados antes)
~15 archivos `analyze_*`, `inspect_*`, `read_*`, `debug-*`, `test_*.cjs/.js`, `estructura_content.txt`, `puct_manual_pages.txt`. Hacer `git rm --cached`.

### Otros
- `bootstrap-5.3.8-dist/` (8.4 MB) — **nunca usado**. Eliminar.
- `web-app/server/skills_output.json.bak` — backup viejo, eliminable.
- `sqlite3` en `package.json` — dependencia huérfana, desinstalable.

### Asistente IA "Mahoraga" muerto (decorativo, sin efecto contable)
- **Eliminable:** `MahoragaWheel.jsx`, `MahoragaInsightsBanner.jsx`, `MahoragaActivationButton.jsx`, `MahoragaDashboard.jsx`, la pestaña `mahoraga` de `Settings.jsx` (`:718-946`), servicios `skillLoader/skillDispatcher/mahoragaController/systemRecognition/groqMonitor/knowledgeBrain/knowledgeExtractor/cognitiveOrchestrator`, rutas `knowledge.js/aiKnowledge.js/skills.js/orchestrator.js`, `skills_output*.json`, `combine_skills.js`, `AI_README.md`.
- **Requiere podar referencias primero:** los imports de `MahoragaWheel` en Journal/Ledger/etc.; en `ai.js` solo se podan las rutas `/mahoraga`, `/recognition`, `/skills`, `/monitor` (NO borrar `ai.js`).

### ⛔ INTOCABLE — el motor de ajustes contables que SÍ funciona
- `ai_adjustment_engine.py` (el motor real).
- En `ai.js`: endpoints `/adjustments/*` y `/profile/:companyId`.
- `utils/aiEngineResolver.js`, `serverFiscalYearUtils.js`, `services/valuationService.js`.
- Cliente: `Worksheet.jsx`, `AIAdjustmentPanel.jsx`, `AdjustmentWizard.jsx`, `ClosingWizard.jsx`.
- La sección de Depreciación de `Settings.jsx` (pestaña `data`) y la tabla `company_adjustment_profiles` → **alimentan el motor**, aunque su endpoint diga `/api/ai/`.

---

## Orden recomendado de trabajo

1. **C3 + C2** (auth + SQLi) — la app está abierta a internet sin protección. Lo más urgente.
2. **A1 + A2** (cold start) — el dolor crónico; el cron externo da alivio inmediato.
3. **C1 + C4** (backup) — son datos contables; arreglar la transacción y las tablas faltantes.
4. **A3** (mobile) — tablas responsive.
5. **Limpieza** (basura + Mahoraga muerto) — seguro y ordena el proyecto.
