# Arquitectura — Sistema Contable NEXUS

Documento de referencia para entender y explicar la app de punta a punta:
stack, deploy, estructura de archivos, modelo de datos y flujos principales.

> Última revisión: 2026-07-18.

---

## 1. Vista de 30 segundos

App contable boliviana multi-empresa (normativa ASFI/PUCT) que automatiza
**ajustes contables y cierre fiscal** con un motor de IA propio. Está en producción
con usuarios reales.

Tres servicios + una base de datos:

```
                    ┌─────────────────────────┐
                    │  Navegador (usuarios)   │
                    └────────────┬────────────┘
                                 │  https
                                 ▼
                ┌──────────────────────────────────┐
                │     Frontend (React + Vite)      │   Vercel
                │  sistema-contable-nexus.vercel   │
                └────────────────┬─────────────────┘
                                 │  /api/* (rewrite Vercel)
                                 ▼
                ┌──────────────────────────────────┐
                │    Backend (Node + Express 5)    │   Render free
                │  sistema-contable-nexus.onrender │
                └────────┬─────────────┬───────────┘
                         │             │
            ┌────────────┘             └───────────────┐
            ▼                                          ▼
  ┌───────────────────┐                ┌──────────────────────────┐
  │ Turso (libSQL DB) │                │  Motor IA (FastAPI / Py) │   Render free
  └───────────────────┘                │  motor-ai-nexus.onrender │
                                       └────────────┬─────────────┘
                                                    │
                                                    │  callback HTTP autenticado
                                                    ▼
                                       (vuelve al backend Node para
                                        leer libro mayor / cuentas)
```

Las dos flechas a la derecha son **bidireccionales**: el navegador llama al
backend Node, Node llama al motor Python, y Python vuelve a llamar a Node para
obtener el libro mayor y el plan de cuentas. Por eso un cold-start de Render
puede tener que despertar dos servicios.

---

## 2. Stack

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | React 18 + Vite 5, Bootstrap 5 por CDN, Tailwind utilitario, axios, react-router-dom 6 | SPA estática deployada en Vercel |
| Backend | Node 22, Express 5, `@libsql/client`, multer, archiver/unzipper, axios | Render free |
| Motor IA | Python, FastAPI, uvicorn, httpx, pandas, numpy | Render free, ~145 KB en un archivo |
| Base de datos | Turso (libSQL, SQLite compatible) | Cliente: `@libsql/client` |
| Auth | Contraseña única compartida (`APP_PASSWORD`) → token = `sha256(APP_PASSWORD)` | Sin JWT, sin tabla de usuarios |
| CI/keep-warm | GitHub Actions (`.github/workflows/keep-warm.yml`) | Ping a Render durante horas activas |

---

## 3. Deploy

| Servicio | URL pública | Plataforma |
|---|---|---|
| Frontend | `https://sistema-contable-nexus.vercel.app` | Vercel (rewrite `/api/*` → backend) |
| Backend Node | `https://sistema-contable-nexus.onrender.com` | Render free |
| Motor Python | `https://motor-ai-nexus.onrender.com` | Render free |
| Base de datos | `libsql://nexus-db-sebitas13.aws-us-west-2.turso.io` | Turso |

**Variables de entorno por servicio** — ver `.env.example` en raíz, `web-app/server`
y `web-app/client`. Críticas:

- **Backend Node**: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `AI_ENGINE_URL`,
  `APP_PASSWORD` (activa el gate), `FRONTEND_ORIGIN` (CORS).
- **Motor Python**: `APP_PASSWORD` (mismo valor; respaldo para autenticar callbacks),
  `GROQ_API_KEY` (si se usa LLM), `LLM_ENDPOINT`, `LLM_MODEL`.
- **Frontend (Vite)**: `VITE_API_URL` (URL del backend).

**Plan free de Render — cuota 750 h/mes COMPARTIDAS** entre todos los servicios
del workspace. Por eso `keep-warm.yml` pinguea solo 12 h/día (12 × 30 × 2 = 720 h,
deja margen). Fuera de esa ventana los servicios se duermen.

---

## 4. Estructura de archivos

```
Sistema Contable/
├── ai_adjustment_engine.py        ← Motor IA (FastAPI). Calcula ajustes y cierre.
├── requirements.txt               ← Dependencias Python del motor
├── PUCT/                          ← Plan Único de Cuentas (xlsx, manual PDF)
├── DataForgeDocs/                 ← Documentación de datos contables
├── scripts/                       ← Scripts auxiliares de extracción de "skills"
│
├── web-app/
│   ├── client/                    ← Frontend React (Vite + Bootstrap)
│   │   ├── src/
│   │   │   ├── App.jsx            ← Router + sidebar + AuthProvider/CompanyProvider
│   │   │   ├── main.jsx           ← Entry; instala interceptores de auth
│   │   │   ├── auth.js            ← Helpers de token + monkey-patch de fetch/axios
│   │   │   ├── api.js             ← Lee VITE_API_URL
│   │   │   ├── context/
│   │   │   │   ├── AuthContext.jsx       ← authRequired, ready
│   │   │   │   └── CompanyContext.jsx    ← empresa seleccionada (localStorage)
│   │   │   ├── pages/                    ← Vistas (rutas)
│   │   │   ├── components/               ← Componentes reutilizables
│   │   │   ├── services/                 ← Clientes de servicios (axios)
│   │   │   ├── utils/                    ← Motores puros (Income/Balance, UFV, fiscal)
│   │   │   ├── DataForge/                ← Editor visual de datos (experimental)
│   │   │   └── index.css                 ← Estilos globales
│   │   ├── public/, dist/, index.html       ← Bootstrap se carga por CDN
│   │   ├── vite.config.js, vercel.json
│   │   └── package.json
│   │
│   └── server/                    ← Backend Node (Express)
│       ├── index.js               ← Entry: CORS, gate de auth, monta routers
│       ├── db.js                  ← Cliente Turso (libSQL) + cola serial + transaction
│       ├── db/schema.sql          ← DDL completo (tablas, índices, datos semilla)
│       ├── routes/                ← Routers REST por dominio
│       ├── services/              ← Lógica (Mahoraga + motor + valuación)
│       ├── utils/                 ← Auth, CORS, backup core, fiscal year, resolver IA
│       ├── sql/                   ← Snippets SQL puntuales
│       └── package.json
│
├── .github/workflows/keep-warm.yml  ← Cron que mantiene calientes los Render
├── vercel.json                       ← Rewrite /api/* y headers
├── DIAGNOSTICO.md                    ← Auditoría general (este proyecto)
├── ARCHITECTURE.md                   ← Este documento
├── MAHORAGA.md                       ← Diagnóstico y roadmap del asistente IA
└── README.md                         ← Resumen comercial
```

---

## 5. Rutas del frontend (`web-app/client/src/App.jsx`)

| Ruta | Componente | Para qué |
|---|---|---|
| `/login` | `pages/Login.jsx` | Pantalla de contraseña (si la auth está activa) |
| `/` | `pages/CompanySelector.jsx` | Elegir o crear una empresa |
| `/app` | `pages/Dashboard.jsx` | Inicio: resumen y atajos |
| `/app/accounts` | `pages/Accounts.jsx` | Plan de cuentas (CRUD, importar Excel) |
| `/app/journal` | `pages/Journal.jsx` | Libro Diario: crear / editar asientos |
| `/app/ledger` | `pages/Ledger.jsx` | Libro Mayor: saldos y movimientos por cuenta |
| `/app/trial-balance` | `pages/TrialBalance.jsx` | Balance de Comprobación |
| `/app/worksheet` | `pages/Worksheet.jsx` | Hoja de Trabajo (BC + Ajustes + Ajustada) |
| `/app/cost-centers` | `pages/CostCenters.jsx` | Centros de costo + modelos de distribución |
| `/app/fixed-assets` | `pages/FixedAssets.jsx` | Activos fijos |
| `/app/ufv` | `pages/UFV.jsx` | Tipo UFV |
| `/app/exchange-rate` | `pages/ExchangeRate.jsx` | Tipo de cambio |
| `/app/reports` | `pages/Reports.jsx` | Menú de reportes |
| `/app/financial-statements` | `pages/FinancialStatements.jsx` | EERR + Balance General |
| `/app/data-forge` | `DataForge/DataForge.jsx` | Editor visual experimental |
| `/app/settings` | `pages/Settings.jsx` | Mantenimiento, perfiles, Mahoraga |

Hay un layout (`AppLayout`) con sidebar (hamburguesa en mobile) y un header con
empresa activa, botón "Cambiar empresa" y, si la auth está activa, botón "Salir".

---

## 6. Endpoints del backend (`web-app/server/routes/*`)

Todos protegidos por el gate de auth (excepto `GET /api/status` y `GET /api/ai/health`,
que son públicos para el keep-warm). El gate y el montaje viven en `index.js`.

### Auth — `routes/auth.js`
| Método | Path | Para qué |
|---|---|---|
| GET | `/api/auth/config` | Le dice al frontend si la auth está activa (público) |
| POST | `/api/auth/login` | Compara contraseña, devuelve token (público) |

### Empresas — `routes/companies.js`
| Método | Path | Para qué |
|---|---|---|
| GET | `/api/companies` | Listar todas las empresas |
| GET | `/api/companies/:id` | Detalle de una empresa |
| GET | `/api/companies/:id/stats` | Métricas resumidas |
| POST | `/api/companies` | Crear empresa |
| PUT | `/api/companies/:id` | Editar |
| DELETE | `/api/companies/:id` | Borrar (cascada) |

### Plan de cuentas — `routes/accounts.js`
| Método | Path | Para qué |
|---|---|---|
| GET | `/api/accounts?companyId=X` | Listar cuentas |
| POST | `/api/accounts` | Crear cuenta |
| PUT/DELETE | `/api/accounts/:id` | Editar / borrar |
| POST | `/api/accounts/bulk` | Carga masiva (importar Excel) |
| PATCH | `/api/accounts/batch-parents` | Reparar jerarquía padre-hijo |
| DELETE | `/api/accounts/all?companyId=X` | Borrar todo el plan de cuentas (peligroso) |

### Libro Diario — `routes/transactions.js`
| Método | Path | Para qué |
|---|---|---|
| GET | `/api/transactions?companyId=X` | Listar asientos |
| GET | `/api/transactions/:id` | Detalle (cabecera + partidas) |
| POST | `/api/transactions` | Crear asiento (cabecera + entries) |
| POST | `/api/transactions/batch` | Crear muchos (cierre, confirmación de ajustes) |
| PUT | `/api/transactions/:id` | Editar |
| DELETE | `/api/transactions/:id` | Borrar |

### Reportes — `routes/reports.js`
| Método | Path | Para qué |
|---|---|---|
| GET | `/api/reports/ledger?companyId=X` | Libro Mayor agregado por cuenta |
| GET | `/api/reports/ledger-details?companyId=X` | Movimientos detalle (para AoT del motor) |
| GET | `/api/reports/ledger/account/:accountId` | Mayor de una cuenta |
| GET | `/api/reports/closing-check` | ¿Hay cierre para esta gestión? |
| POST | `/api/reports/adjustment-entries-proposal` | Fallback heurístico de ajustes |

### Inventario — `routes/inventory.js`
| Método | Path | Para qué |
|---|---|---|
| GET | `/api/inventory/items?companyId=X` | Listar items |
| POST | `/api/inventory/items` | Crear item |
| POST | `/api/inventory/movements` | Registrar movimiento (Compra/Venta/...) |

### Otras
- `routes/ufv.js`: `GET/POST /api/ufv`, `POST /api/ufv/batch` (lookup en lote).
- `routes/exchange_rates.js`: `GET/POST /api/exchange-rates`.
- `routes/backup.js`: `GET /api/backup/export/:companyId`, `POST /api/backup/dry-run`,
  `POST /api/backup/import`.
- `routes/ai.js` (mezcla): el proxy real al motor Python en `/api/ai/adjustments/*` y
  `/api/ai/profile/:companyId` (motor de ajustes contables, **intocable**) + las rutas
  decorativas de Mahoraga (`/api/ai/mahoraga/*`, `/recognition/*`, `/skills/*`,
  `/monitor/*`). Para Mahoraga ver `MAHORAGA.md`.
- `GET /api/status` (en `index.js`): healthcheck público.

---

## 7. Modelo de datos (`web-app/server/db/schema.sql`)

Agrupado por dominio. Las FK con `ON DELETE CASCADE` se indican explícitamente.

### Empresa
- **`companies`**(id, name, nit, legal_name, address, city, country, fiscal_year_start,
  currency, plan_structure, current_year, created_at)

### Plan de cuentas
- **`accounts`**(id, company_id→companies CASCADE, code, name, type
  {Activo|Pasivo|Patrimonio|Ingreso|Egreso}, level, parent_code)
  — La jerarquía padre-hijo se resuelve por **`parent_code` (string)**, no por FK numérica.

### Libro Diario
- **`transactions`**(id, company_id→companies CASCADE, date, gloss, type
  {Ingreso|Egreso|Traspaso|Ajuste|Cierre}, created_at)
- **`transaction_entries`**(id, transaction_id→transactions CASCADE,
  account_id→accounts, debit, credit, gloss)
  — Cada partida pertenece a un asiento y referencia una cuenta.

### UFV / Tipo de cambio
- **`ufv_rates`**(id, date UNIQUE, value, created_at)
- **`exchange_rates`**(id, date UNIQUE, usd_buy, usd_sell, created_at)
  — Son catálogos globales por fecha en el esquema actual.

### Inventario (Kardex)
- **`inventory_items`**(id, company_id→companies CASCADE, code, name, unit,
  item_type {MP|WIP|PT|SU}, valuation_method {CPP|PEPS|...}, ias2_compliant,
  balance_quantity, balance_cost)
- **`inventory_movements`**(id, item_id→inventory_items CASCADE, date, type, quantity,
  unit_cost, total_cost)

### Activos fijos
- **`fixed_assets`**(id, company_id→companies CASCADE, code, name, acquisition_date,
  acquisition_cost, useful_life, residual_value, depreciation_method,
  accumulated_depreciation)

### Motor de ajustes (lo que SÍ aprende)
- **`company_adjustment_profiles`**(id, company_id→companies, profile_json, version,
  created_at, updated_at) — perfil de reglas monetarias/no monetarias por empresa.
- **`mahoraga_adaptation_events`**(id TEXT PK, company_id, user, origin_trans,
  account_code, account_name, action, error_reason_tag, user_comment, event_data JSON,
  reverted, timestamp) — historial de eventos de adaptación (feedback).

### Centros de costo y producción
- **`cost_centers`**(id, company_id→companies CASCADE, parent_id→cost_centers, code,
  name, type {Analytic|Group}, is_active, UNIQUE(company_id, code))
- **`cost_distribution_models`**(id, company_id→companies CASCADE, name, description,
  is_active)
- **`cost_distribution_entries`**(id, model_id→cost_distribution_models CASCADE,
  cost_center_id→cost_centers, percentage)
- **`production_orders`**(id, company_id→companies CASCADE, code, product_id→inventory_items,
  status {OPEN|WIP|CLOSED|CANCELLED}, start_date, end_date, planned_quantity,
  actual_quantity, total_cost)

### Visión rápida de las FK
```
companies ─┬─< accounts
           ├─< transactions ─< transaction_entries >─ accounts
           ├─< inventory_items ─< inventory_movements
           ├─< fixed_assets
           ├─< company_adjustment_profiles  (1 por empresa)
           ├─< mahoraga_adaptation_events
           ├─< cost_centers ─⤴ (auto: parent_id)
           ├─< cost_distribution_models ─< cost_distribution_entries >─ cost_centers
           └─< production_orders >─ inventory_items
```

---

## 8. Flujos clave

### A) Crear un asiento contable (Libro Diario)
1. Usuario en `/app/journal` arma cabecera + partidas debe/haber.
2. Frontend valida que **debe = haber**.
3. `POST /api/transactions` con `{ companyId, date, gloss, type, entries }`.
4. `routes/transactions.js` inserta la cabecera, obtiene `lastID`, y luego inserta
   las partidas. Para creaciones masivas (cierre, confirmación de ajustes IA) se
   usa `POST /batch` con sentencias parametrizadas en `client.batch()` (corregido
   contra inyección SQL).

### B) Generar ajustes con IA (`Worksheet` / `AdjustmentWizard`)
```
Frontend (AdjustmentWizard) ── POST /api/ai/adjustments/generate-from-ledger ──┐
                                                                                 ▼
                                                          routes/ai.js: callAiEngine
                                                                                 │
                                                                                 ▼
                                                          Motor Python (FastAPI)
                                                                                 │
                                  ┌──────────────────────────────────────────────┘
                                  │
   GET /api/reports/ledger        │ (callback, autenticado con internal_token)
   GET /api/accounts              │
   GET /api/reports/ledger-details (modo "trajectory")
   POST /api/ufv/batch
   GET /api/reports/closing-check (en feedback)
                                  │
                                  ▼
                       Motor calcula ajustes y devuelve propuesta
                                  │
                                  ▼
                       Frontend muestra → usuario confirma →
                       POST /api/ai/adjustments/confirm → POST /api/transactions/batch
```
Si el motor está dormido (cold-start de Render), `warmupAiEngine` reintenta con
backoff exponencial. Si después de todo falla, cae al **fallback heurístico**
(`/api/reports/adjustment-entries-proposal`) con confianza fija 0.7 y bandera
`fallback_mode: true`. Esto es lo que da los "modos de contingencia".

### C) Cierre de gestión (`ClosingWizard`)
Backend arma una **propuesta determinista** (ingresos→PyG, egresos→PyG, transferir
resultado a Patrimonio + reserva legal opcional, asientos de reapertura), el
usuario revisa y confirma con `POST /api/transactions/batch` (asientos de tipo
`Cierre`).

### D) Backup ("Escudo del General")
- **Export** (`GET /api/backup/export/:companyId`): consulta las 15 tablas soportadas
  filtrando por `company_id`, normaliza, calcula checksum SHA-256 y arma un ZIP en
  streaming (`archiver`) con `metadata.json` + `data/<tabla>.json`.
- **Dry-run** (`POST /api/backup/dry-run`): valida sin escribir.
- **Import** (`POST /api/backup/import`): dentro de una transacción interactiva libSQL,
  crea una **empresa nueva** con sufijo "(Restaurado <fecha>)" y reinserta todo
  remapeando IDs viejos→nuevos (cuentas, transacciones, items, centros de costo
  con `parent_id` en dos pasadas, etc.). Es **aditivo**: nunca pisa la empresa
  existente. Por eso se puede probar en producción sin riesgo.

### E) Importar plan de cuentas (`SmartImportWizard` → Universal Import Engine)
1. **Producción (hoy)**: `SmartImportWizard.jsx` (Accounts.jsx:376) parsea Excel/PDF
   con heurísticas propias, genera preview editable y hace `POST /api/accounts/bulk`
   (lotes de 500, leyendo `successCount/errorCount` reales) + `PUT /api/companies/:id`
   con `code_mask`/`plan_structure` tras el import.
2. **Engine (shadow, Fase 5 cerrada con GO)**: pipeline puro en
   `client/src/utils/` — `FormatAdapter` (Excel/PDF/CSV, worker pdfjs local) →
   `CanonicalDocument` → `UniversalPlanAnalyzer.analyzeCanonicalDocument`
   (multi-región) → `ImportContract` → `ImportContractValidator` →
   `CompatibilityAdapter.toBulkPayload`. Cero escrituras; `silentCorruption=0`,
   `unaccountedRows=0` garantizados por las suites (`npm test`: adversarial 42,
   shadow 68, contract audit 42, production gate 51 + Browser E2E real 6/6).
3. **Migración (Fase 6, solo diseñada)**: feature-flag `importEngine` (default
   legacy), `UniversalImportWizard` nuevo con 6 pasos, fallback intacto y
   paridad differential antes de cambiar el default. Detalle y reglas en
   `IMPORT_WIZARD_MIGRATION_DESIGN.md`; invariantes y resultados en
   `UNIVERSAL_IMPORT_ENGINE_BASELINE.md`. **No implementar sin aprobación.**

### F) Login (graceful)
1. Al cargar la app, `AuthContext` consulta `GET /api/auth/config`.
2. Si `authRequired: true` y no hay token → redirige a `/login`.
3. `POST /api/auth/login {password}` → si OK, devuelve `token = sha256(APP_PASSWORD)`.
4. El interceptor en `auth.js` (monkey-patch de `window.fetch` + interceptor axios
   global + interceptor en la instancia de `aiAdjustmentService`) adjunta
   `Authorization: Bearer <token>` a todas las requests a la API.
5. Si el backend no tiene `APP_PASSWORD` (rollout graceful), `authRequired` viene
   `false` y la app funciona sin login.

---

## 9. Servicios y utilidades a destacar

### Frontend (`web-app/client/src`)
- **`utils/IncomeStatementEngine.js`** y **`utils/FinancialStatementEngine.js`**:
  motores puros para Estado de Resultados y Balance General. Son los "cálculos
  contables" en el cliente; no llaman al backend.
- **`utils/adjustmentProfilesV3.js`**: perfiles de ajustes (estructura y defaults).
- **`services/aiAdjustmentService.js`**: cliente axios al backend para los flujos
  de ajustes; tiene timeouts altos (120 s) y caches de health.
- **`services/inventoryService.js`**: cliente para operaciones de kardex.

### Backend (`web-app/server`)
- **`db.js`**: cliente único de libSQL. Todas las queries pasan por una **cola serial**
  (`queryQueue`) sobre una sola conexión. `db.transaction(cb)` ahora usa
  `client.transaction('write')` correctamente con commit/rollback.
- **`utils/auth.js`**: `getExpectedToken()`, `verifyToken()`, `requireAuth` middleware
  con whitelist.
- **`utils/backupCore.js`**: `IMPORT_ORDER`, normalización, validación y checksum.
- **`utils/keepAlive.js`**: pinguea al motor Python cada 14 min mientras Node está
  despierto.
- **`utils/aiEngineResolver.js`**: arma la lista de URLs candidatas del motor según
  entorno (localhost en dev, Render en prod).
- **`utils/serverFiscalYearUtils.js`**: lógica de año fiscal usada por el motor.

### Motor Python (`ai_adjustment_engine.py`)
- FastAPI con endpoints `/api/ai/health`, `/api/ai/adjustments/generate`,
  `/api/ai/adjustments/generate-from-ledger`, `/api/ai/adjustments/batch-validate`,
  `/api/ai/adjustments/explain`, `/api/ai/adjustments/config`,
  `/api/ai/adjustments/feedback`, `/api/ai/adjustments/rollback`.
- El **cálculo** (depreciación con prorrateo mensual, AITB / revaluación UFV por
  trayectoria, provisiones, monetarios) está en una clase `ARSDSPyEngine`.
- El motor **llama de vuelta al backend Node** (con el `internal_token`) para
  obtener el mayor y el plan de cuentas — es esa cadena bidireccional la que
  encarece el cold-start.

---

## 10. Convenciones útiles para mantenimiento

- **Distinción crítica**: hay un "motor de ajustes" que SÍ funciona (intocable) y un
  "asistente Mahoraga" que es UI sin backend real. Detalles y rutas en
  `MAHORAGA.md`. Para no romper el motor: nunca tocar `ai_adjustment_engine.py`,
  los endpoints `/api/ai/adjustments/*` y `/api/ai/profile/:companyId`, ni
  `AIAdjustmentPanel`, `AdjustmentWizard`, `ClosingWizard`, `Worksheet`.
- **Multi-empresa**: prácticamente todas las consultas filtran por `companyId` y
  todas las tablas core tienen `company_id`. El frontend mantiene la empresa
  activa en `localStorage` (`selectedCompanyId`).
- **`MahoragaWheel`** se conserva por valor estético; no desmontar sin pedido
  explícito.
- **Cold-start de Render**: el `keep-warm.yml` actual cubre 12 h/día. Si se cambia
  el horario, recalcular la cuota (750 h/mes compartidas en el plan free).
- **Backups son aditivos**: probar el restore en producción es seguro (crea una
  empresa nueva "(Restaurado ...)"), no pisa nada.
- **DB vigente**: el backend usa `@libsql/client`; los restos legacy basados en
  `sqlite3` y `migrate.js` ya no forman parte del flujo actual.
