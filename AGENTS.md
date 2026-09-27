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
> - `docs/normativa/NORMATIVA_Y_APLICABILIDAD.md` — fuentes, alcance y límites del uso de normativa contable/tributaria en la app.

Documentación nueva de detalle va bajo `docs/` (por área); mantener la raíz solo
con `README.md`, `ARCHITECTURE.md`, `DIAGNOSTICO.md`, `AGENTS.md`, `MAHORAGA.md`
y documentos críticos ya existentes. No crear nuevos `.md` en la raíz.

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
- Plan free de Render: **750 h/mes compartidas por workspace** entre Node +
  Python y cualquier otro servicio free. El cron `.github/workflows/keep-warm.yml`
  puede consumir ~725 h en 30 días y ~749 h en 31 días, sin contar tráfico fuera
  de la franja. El margen es mínimo en meses largos. **Nunca agregar pingers 24/7
  ni otro servicio free sin recalcular el consumo.**

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

# Tests y verificaciones
node web-app/server/test_backup_core.js
node web-app/server/test_ai_engine_resolver.js
npm test          # runner de import, readiness, E2E browser y estados/cierre contable
```

**Verificación mínima antes de dar por terminada una tarea:**
1. `npm run build` dentro de `web-app/client` (si se tocó el frontend).
2. `node --check web-app/server/routes/<router>.js` para sintaxis. No cargar
   routers con `require()` como smoke test usando el `.env` local: importar una
   ruta carga `db.js`, que inicializa schema y migraciones en el Turso configurado.
   Cualquier smoke/integración que importe `db.js` requiere credenciales de una
   base desechable o de staging, nunca las de producción.

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
├── docs/normativa/              ← alcance y fuentes contables/tributarias revisadas
```

Nota: la ruta `/app/cost-centers` ("Costos y Almacén") aloja el **Kardex Físico
Valorado** (componente `components/Inventory.jsx`) + centros de costo + modelos
de distribución. No es una página independiente.

---

## ⛔ INTOCABLE — motor de ajustes contables (lo que SÍ funciona)

- `ai_adjustment_engine.py` (motor Python completo).
- En `routes/ai.js`: endpoints `/adjustments/*` y `/profile/:companyId`.
- `utils/aiEngineResolver.js`, `utils/serverFiscalYearUtils.js`, `services/valuationService.js`.
- Frontend: `AIAdjustmentPanel.jsx`, `AdjustmentWizard.jsx`.
- `Worksheet.jsx` y `ClosingWizard.jsx` solo se modifican en el alcance ya autorizado
  de reportes/cierre contable: la hoja queda auxiliar y los reportes/cierres se
  calculan fuera de ella. No alterar la generación/confirmación de ajustes IA.
- La pestaña Depreciación de `Settings.jsx` y la tabla `company_adjustment_profiles`
  **alimentan el motor real**, aunque el endpoint diga `/api/ai/`.

## Reportes y cierre contable

- `GET /api/reports/financial-statements` es la fuente de Dashboard, Estados
  Financieros y datos oficiales del borrador Worksheet. Balance acumulado y
  resultado del ejercicio tienen ventanas de fecha distintas; conservarlas.
- El Balance General consume la jerarquía importada y persistida (`parent_code`,
  `level` y orden de importación). No inferir padres/niveles desde el código ni
  crear grupos virtuales o filas "Grupo ...". Si un padre implícito no existe
  como cuenta, resolverlo solo con nivel y orden importados; si no es inequívoco,
  dejar la cuenta sin padre y emitir una advertencia. Excluir cuentas sin saldo
  propio y ramas vacías de saldo cero; conservar una cuenta con saldo propio no
  nulo aunque su subtotal consolidado se compense con sus descendientes. Mantener
  las cuentas reguladoras en su rubro con signo de contra-cuenta. Todo cambio a
  esta lógica debe actualizar `test_financial_reports_core.js` y pasar `npm test`.
- `POST /api/reports/closing-entries-proposal` no debe cerrar activos, pasivos ni
  patrimonio permanente, calcular IUE desde utilidad contable ni estimar reserva
  legal sin datos y fundamento aplicables. Todo asiento propuesto debe cuadrar al
  centavo y las cuentas de orden deben cuadrar como conjunto.
- La Hoja de Trabajo es auxiliar: sus fórmulas y overrides locales no pueden
  alimentar estados, dashboard ni asientos de cierre.
- Los avisos de clasificación y jerarquía del plan se resuelven en el importador;
  no mostrar un panel genérico de "Revisión del reporte" en Estados Financieros.
  Un padre ausente o no inferible debe requerir revisión antes de confirmar la
  importación. Saltos de numeración entre cuentas hermanas (p. ej. `151.01` a
  `151.03`) con hasta cinco posiciones omitidas son `WARNING` informativos y por
  sí solos no bloquean ni reducen la confianza del contrato. No avisar por
  terminales `.99` ni por huecos amplios, que son convenciones frecuentes.
- En PDF, seleccionar la sección del catálogo por encabezados y evidencia
  jerárquica; excluir índices, decimales en prosa y secciones descriptivas. Los
  códigos con puntos/guiones requieren evidencia espacial de columna código/
  nombre o continuación alineada. Un guion decorativo anterior al código solo
  se descarta cuando después hay celdas separadas de código y nombre; títulos
  numerados evidentes como `1. Introducción` no son cuentas aunque estén en
  columnas. Mantener un solo contrato cuando el catálogo se extrae como una
  secuencia coherente. La cobertura está fijada por `scripts/test_pdf_import_quality.mjs`.
- Antes de cambios contables/tributarios, revisar primero los documentos de
  `C:\Users\user\Desktop\UMSA-CONTA\CONTA\MARCO - INTERNACIONAL_Y_NACIONAL` y
  comprobar la versión vigente en fuentes oficiales. Documentar alcance, artículo,
  aplicabilidad y limitaciones en `docs/normativa/NORMATIVA_Y_APLICABILIDAD.md`;
  el MCEF solo se aplica a entidades supervisadas por ASFI.

## 🔮 Mahoraga (asistente IA — experimental, no integral)

Ver `MAHORAGA.md` para el mapa actual y el roadmap de implementación segura. Reglas:
- `MahoragaWheel.jsx` (y `MahoragaWheel3D.jsx`) se conservan por valor estético.
- El modo global y el historial se persisten/hidratan parcialmente desde Turso;
  las escrituras son best-effort. `active_pages` vive en el perfil de empresa y
  solo controla la presentación de la rueda, no permisos.
- Los modos `assisted`/`autonomous` no aplican cambios contables; no activarlos
  creyendo que existe un asistente integral. Confirmar activación tampoco ejecuta
  la inferencia pendiente.
- `/api/skills/dispatch` falla porque `vm2` no está declarado/instalado. No
  resolver añadiendo ejecución arbitraria; seguir el diseño tipado/read-only de
  `MAHORAGA.md`.
- `/api/ai/orchestrator` se intenta montar, pero su servicio no es confiable:
  llamada a `inferWithModel` incompatible, auditoría placeholder y `pg` opcional
  no declarado. No usar en producción.

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
El import es **aditivo** (crea empresa "(Restaurado <fecha>)"): no sobrescribe la
empresa fuente, pero consume espacio y deja una empresa nueva; verificar el
destino y limpiar explícitamente tras la prueba.

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
- **A3**: tablas anchas en mobile (Worksheet conserva scroll horizontal). La
  lógica contable se actualizó, pero su rediseño responsive sigue pendiente. El
  alcance auxiliar/reportes sí está autorizado; proteger únicamente el flujo de
  ajustes IA descrito arriba. Los modales NexusModal ya son scrollables.
- **Fase 6 (decisión pendiente)**: migración del SmartImportWizard al Universal
  Import Engine. Diseño DEFINITIVO listo en `IMPORT_WIZARD_MIGRATION_DESIGN.md`
  (PHASE 6 VERDICT: ARCHITECTURE READY · MIGRATION PLAN READY · IMPLEMENTATION
  NOT STARTED). La implementación NO se inicia sin aprobación explícita.
  Reglas si se aprueba: feature-flag `importEngine` (default legacy), fallback
  intacto, shadow por defecto, paridad differential demostrada antes de cambiar
  el default, ImportSession como contenedor puro (sin lógica de análisis).
- **Fase 7 U-9 Etapa 1 (rollout controlado, en curso)**: opt-in por botón
  "Importar (nuevo)" (default legacy intacto), PUCT-guard duro con redirección
  al clásico, log local sin identificador de empresa (`universalImportLog` y
  `universalImportTrails`), rollback por niveles. H1 (fingerprint largo) se
  compacta como firma `u9fp1`; H2 registra overrides textuales al salir del campo
  o Enter. Repetir ASFI para obtener el `result` que falta en su bitácora histórica.
  Diseño: `U9_CONTROLLED_ROLLOUT_DESIGN.md`. U-10 (retiro legacy) NO aprobado.
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
- Decisión pendiente: implementar el Mahoraga read-only descrito en `MAHORAGA.md`
  o mantener/podar los paneles experimentales. La rueda se conserva y el motor
  contable no se toca.
- Reportes/cierre contable: núcleo de servidor en `utils/financialReportsCore.js`;
  pruebas puras en `test_financial_reports_core.js`. Los reportes son parciales y
  no sustituyen el paquete completo de estados, notas ni revisión profesional.
