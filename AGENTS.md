# AGENTS.md — Sistema Contable NEXUS

Guía para agentes y desarrolladores que trabajen en este repositorio.
**La app está en producción con usuarios reales.** Tratar cada cambio como
código vivo: verificar build/smoke antes de terminar.

> Docs de referencia (mantener sincronizadas con cualquier cambio):
> - `ARCHITECTURE.md` — arquitectura completa, stack, endpoints, flujos, modelo de datos.
> - `MAHORAGA.md` — diagnóstico y roadmap del asistente IA (experimental).
> - `DIAGNOSTICO.md` — auditoría histórica; muchos ítems ya resueltos.
> - `UNIVERSAL_IMPORT_ENGINE_BASELINE.md` — baseline congelada del motor de import (tests, invariantes, limitaciones).
> - `IMPORT_WIZARD_MIGRATION_DESIGN.md` — diseño definitivo (Fase 6) de la migración del SmartImportWizard al engine: auditoría completa con línea exacta, ImportSession (decisión: SÍ), matriz legacy→universal, plan de 10 commits. **Solo diseño; no implementar sin aprobación.** Primer commit propuesto: `importSession/` puro sin React.

---

## Arquitectura en 20 segundos

App contable boliviana multi-empresa (PUCT/ASFI). Tres piezas desplegadas:

```
Navegador ──> Vercel (React + Vite, SPA estática)
                 │ rewrite /api/*
                 ▼
            Render free — Backend Node/Express ──> Turso (libSQL, DB real)
                 │
                 ▼
            Render free — Motor IA (Python/FastAPI, ai_adjustment_engine.py)
                 └── callback HTTP autenticado de vuelta a Node (mayor/cuentas)
```

- La base de datos real es **Turso (libSQL)** — NO SQLite local. `@libsql/client`.
- Auth: contraseña única compartida (`APP_PASSWORD`) → token `sha256`. Gate en `index.js`.
- Plan free de Render: **750 h/mes compartidas** entre Node + Python. El cron
  `.github/workflows/keep-warm.yml` solo pinge 12 h/día (720 h/mes). **Nunca
  agregar pingers 24/7 ni un tercer servicio free.**

---

## Comandos

```bash
# Backend Node (desde la raíz; carga web-app/server/.env + .env raíz automáticamente)
npm run start:server          # puerto 3001

# Frontend
npm run start:client          # Vite dev, puerto 5173
cd web-app/client && npm run build   # build de producción (verificación obligatoria)

# Motor IA Python (desde la raíz)
uvicorn ai_adjustment_engine:app --reload --port 8000

# Tests manuales (no hay framework formal)
node web-app/server/test_backup_core.js
node web-app/server/test_ai_engine_resolver.js
npm test          # runner formal del motor de import (4 suites + Browser E2E real)
```

**Verificación mínima antes de dar por terminada una tarea:**
1. `npm run build` dentro de `web-app/client` (si se tocó el frontend).
2. `node -e "require('./web-app/server/routes/<router>.js')"` (si se tocó el backend).

---

## Estructura real

```
Sistema Contable/
├── ai_adjustment_engine.py    ← Motor IA real (FastAPI). ⛔ INTOCABLE.
├── requirements.txt
├── PUCT/                      ← Plan Único de Cuentas (xlsx, PDF)
├── scripts/                   ← extractores de skills (Mahoraga)
├── vercel.json                ← rewrite /api/* → backend Render
├── .env                       ← GROQ_API_KEY, LLM_*, MAHORAGA_MODE
├── web-app/
│   ├── client/
│   │   ├── src/
│   │   │   ├── App.jsx            ← Router + sidebar + gates (auth/empresa)
│   │   │   ├── auth.js            ← token + monkey-patch fetch/axios
│   │   │   ├── context/           ← AuthContext, CompanyContext (multi-empresa)
│   │   │   ├── pages/             ← Vutas ruteadas (Journal, Reports, Settings, ...)
│   │   │   ├── components/        ← Submódulos (Inventory/Kardex, MahoragaWheel, ...)
│   │   │   ├── services/          ← aiAdjustmentService, inventoryService (axios)
│   │   │   ├── utils/             ← Motores puros: IncomeStatement, FinancialStatement
│   │   │   ├── three/             ← Fondos 3D (lazy)
│   │   │   └── DataForge/         ← Editor visual experimental
│   │   └── .env               ← VITE_API_URL
│   └── server/
│       ├── index.js           ← Entry: CORS, gate auth, monta routers, keep-alive
│       ├── db.js              ← Cliente libSQL + cola serial + transaction
│       ├── db/schema.sql      ← DDL completo + datos semilla
│       ├── routes/            ← accounts, transactions, reports, inventory, backup,
│       │                         companies, ufv, exchange_rates, auth, ai, skills, orchestrator
│       ├── services/          ← valuationService (kardex), mahoragaController, skillLoader...
│       ├── utils/             ← auth, backupCore, keepAlive, aiEngineResolver,
│       │                         serverFiscalYearUtils, serverIncomeStatement, corsConfig
│       └── .env               ← TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, AI_ENGINE_URL
```

Nota: la ruta `/app/cost-centers` ("Costos y Almacén") aloja el **Kardex Físico
Valorado** (componente `components/Inventory.jsx`) + centros de costo + modelos
de distribución. No es una página independiente.

---

## ⛔ INTOCABLE — motor de ajustes contables (lo que SÍ funciona)

- `ai_adjustment_engine.py` (motor Python completo).
- En `routes/ai.js`: endpoints `/adjustments/*` y `/profile/:companyId`.
- `utils/aiEngineResolver.js`, `utils/serverFiscalYearUtils.js`, `services/valuationService.js`.
- Frontend: `Worksheet.jsx`, `AIAdjustmentPanel.jsx`, `AdjustmentWizard.jsx`,
  `ClosingWizard.jsx`.
- La pestaña Depreciación de `Settings.jsx` y la tabla `company_adjustment_profiles`
  **alimentan el motor real**, aunque el endpoint diga `/api/ai/`.

## 🔮 Mahoraga (asistente IA — experimental/decorativo)

Ver `MAHORAGA.md` para el mapa completo y el roadmap de activación. Reglas:
- `MahoragaWheel.jsx` (y `MahoragaWheel3D.jsx`) se conservan por valor estético.
- El estado del controlador ya **se hidrata desde la DB** al arrancar.
- `routes/orchestrator.js` + `services/cognitiveOrchestrator.js` están rotos
  (dependencia `pg` inexistente); se cargan en try/catch y nunca se registran.
- Cualquier activación real sigue el roadmap por etapas de `MAHORAGA.md`.

---

## Convenciones de código

### Backend (Node, CommonJS)
```javascript
const express = require('express');        // CommonJS, no ESM
const db = require('../db');               // conexión compartida (cola serial)
// Queries SIEMPRE con placeholders ? — nunca concatenar SQL
const res = await db.execute({ sql: 'SELECT ... WHERE company_id = ?', args: [companyId] });
// Escrituras múltiples dentro de db.transaction(cb)
```
- 4 espacios de indentación, ~100 caracteres por línea, punto y coma.
- `camelCase` (variables/funciones), `PascalCase` (clases), `SCREAMING_SNAKE_CASE` (constantes).
- Nombres de dominio en español aceptados: `montoTotal`, `saldoCuenta`.
- Async SIEMPRE en try/catch con `console.error` descriptivo y re-throw si corresponde.
- Mensajes de consola y UI en español.

### Frontend (React 18 + Vite, JSX)
- Componentes función + hooks; Bootstrap 5 por CDN + utilidades propias en `index.css`.
- Multi-empresa: toda petición lleva `companyId` de `useCompany()`; la empresa
  activa vive en `localStorage` (`selectedCompanyId`).
- Submódulos de página viven en `components/`, no en `pages/`.

### Multi-tenancy
Prácticamente todas las tablas core tienen `company_id` y todas las consultas
filtran por él. Nunca introducir consultas sin filtro de empresa.

### Backups
El import es **aditivo** (crea empresa "(Restaurado <fecha>)"): probar restore
en producción es seguro, no pisa datos.

---

## Variables de entorno (3 archivos)

| Archivo | Claves |
|---|---|
| `.env` (raíz) | `GROQ_API_KEY`, `LLM_ENDPOINT`, `LLM_MODEL`, `AI_BACKEND`, `MAHORAGA_MODE` |
| `web-app/server/.env` | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `AI_ENGINE_URL` (+ `APP_PASSWORD`, `FRONTEND_ORIGIN` en Render) |
| `web-app/client/.env` | `VITE_API_URL` |

`db.js` encadena ambos `.env` (server primero, raíz después; dotenv no
sobrescribe variables ya definidas).

---

## Estado de la deuda técnica (post-limpieza 2026-09, actualizado)

Resuelto (ver git log para detalle):
- **Nivel 0**: validación contable server-side (`utils/transactionValidator.js`),
  cerrojos multi-tenant en todos los CRUD, rate-limit en login, schema.sql
  sincronizado + índices de `transaction_entries`, atomicidad en escrituras.
- **Nivel 1**: UX de cold start (banner "servidor despertando", auto-retry con
  backoff, fin de los Bs 0.00 falsos, AuthContext con reintentos).
- **Nivel 2**: ToastProvider (~60 alerts fuera), ConfirmProvider (14 confirms
  fuera), NexusModal (21 modales con Escape/focus-trap/portal).
- **Nivel 3**: code splitting (main chunk 2.5MB→578KB, lazy routes, jspdf/xlsx/
  pdfjs on-demand), favicon 348KB→10KB, fondo 3D solo en desktop, Tailwind
  fantasma y componentes muertos eliminados.
- Mojibake reparado en Settings.jsx y ai.js (reparador con validación UTF-8).

Pendiente conocido:
- **A3**: tablas anchas en mobile (Worksheet ~21 columnas es la peor); los
  modales NexusModal ya son scrollables.
- **Fase 6 (decisión pendiente)**: migración del SmartImportWizard al Universal
  Import Engine. Diseño DEFINITIVO listo en `IMPORT_WIZARD_MIGRATION_DESIGN.md`
  (PHASE 6 VERDICT: ARCHITECTURE READY · MIGRATION PLAN READY · IMPLEMENTATION
  NOT STARTED). La implementación NO se inicia sin aprobación explícita.
  Reglas si se aprueba: feature-flag `importEngine` (default legacy), fallback
  intacto, shadow por defecto, paridad differential demostrada antes de cambiar
  el default, ImportSession como contenedor puro (sin lógica de análisis).
- Engine: PGC (columna única "N. Nombre.") es PARTIAL en el flujo canónico
  automático (parser especial probado en Node, no auto-seleccionado).
- AdjustmentWizard/ClosingWizard (zona intocable) aún usan alert()/modales
  artesanales; migrar solo si se decide tocar esa zona.
- Multer: `okExt || okMime` permite zip con cualquier MIME (backstop: unzipper).
- Import de backup carga cada JSON en RAM (hay guard anti zip-bomb de 200MB).
- Logs de `ai.js` vuelcan el response completo del motor Python.
- CORS abierto en modo dev (regex `^(.*)$`); handler OPTIONS duplicado muerto.
- ESLint: el script `lint` existe pero NO hay archivo de configuración.
- `/api/skills/dispatch` responde 500 (depende de `vm2`, no declarada) —
  resolver al decidir el destino de Mahoraga.
- Decisión pendiente: activar Mahoraga por etapas (roadmap) o podarlo dejando
  solo la rueda. El estado del controlador ya persiste en DB.
