# 🩺 Diagnóstico general — Sistema Contable NEXUS

> Auditoría inicial: 2026-06-21. Verificación y actualización del estado: 2026-09-26.
> Los hallazgos detallados más abajo son una fotografía histórica; la matriz de
> estado actual de §Estado verificado prevalece. No ejecutar la antigua lista de
> limpieza sin volver a comprobar cada archivo y sus referencias.
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

## Estado verificado (2026-09-26)

Revisado contra `git log`, el árbol actual y las rutas/código relacionados. `main`
está un commit por delante de `origin/main` (`f9f44c7`, informe del piloto U-9);
al iniciar esta revisión no había modificaciones locales. Los cambios de esta
actualización aún no están committeados.

| Hallazgo inicial | Estado actual comprobado |
|---|---|
| C1 — transacción de backup/libSQL incorrecta | **Resuelto en código**: `db.transaction(cb)` abre `client.transaction('write')` y confirma o revierte. El restore usa esa transacción interactiva. |
| C2 — SQL concatenado en el batch de transacciones | **Resuelto en código**: las escrituras usan placeholders y transacciones interactivas; no confundir con toda la superficie SQL de la aplicación, que aún requiere auditorías puntuales. |
| C3 — API sin auth ni autorización | **Parcial**: existe gate API con una contraseña compartida y rate-limit de login. Sin `APP_PASSWORD`, el gate se desactiva; no se puede verificar desde Git si Render tiene la variable. No hay identidad/roles por persona ni autorización de empresa asociada al token; la contraseña compartida no evita que un usuario autenticado elija otro `companyId`. |
| C4 — backup excluía tablas de costos/producción | **Resuelto para las 15 tablas declaradas** en `SUPPORTED_TABLES`/`backupCore`; skills y otros archivos locales siguen fuera del backup. |
| A1 — keep-alive no iniciado | **Resuelto con límite deliberado**: Node inicia el keep-alive interno y `.github/workflows/keep-warm.yml` pinge ambos servicios 12 h/día. No evita que duerman fuera de la ventana ni los retrasos del scheduler. |
| A2 — contingencia al despertar | **Mitigado, no eliminado**: warmup, reintentos/backoff y avisos del cliente existen; el fallback continúa siendo posible si falla el ciclo. |
| A3 — tablas móviles | **Parcial; sigue pendiente**: `index.css` ya oculta metadatos y dos saldos secundarios, comprime celdas y fija la columna de cuenta en la Hoja de Trabajo. Esta todavía conserva muchos bloques numéricos y scroll horizontal; Diario, Mayor y Balance de Comprobación también tienen tablas anchas. En esta actualización se autorizó cambiar la lógica contable auxiliar, no rediseñar la tabla móvil. |
| Reportes y hoja de trabajo | **Corregido en código**: Balance General, Estado de Resultados, Dashboard y datos del borrador Worksheet usan `GET /api/reports/financial-statements`. El balance es acumulado a fecha; el ER abarca solo la gestión y excluye asientos de cierre. Worksheet dejó de ser dependencia de reportes/cierre. |
| Propuesta de cierre | **Reemplazada y probada en el núcleo**: cierra cuentas de resultado contra Pérdidas y Ganancias y lleva el saldo contable a Resultados Acumulados; no cierra cuentas permanentes, no estima IUE ni reserva legal y rechaza cierres ya existentes. Cada asiento y las cuentas de orden se validan al centavo. |
| Jerarquía de cuentas ausente (PUCT/ASFI) | **Mitigado para presentación**: acepta padres no materializados como grupos virtuales, sin persistirlos ni cambiar códigos/cuentas. La selección por tipo, prefijo y jerarquía tiene pruebas de regresión. |
| Cierres históricos de “Cuentas de Balance” | **Compatibilidad con advertencia**: el reporte excluye del saldo acumulado las partidas del antiguo asiento de cierre que llevaba cuentas permanentes a cero. No se reescriben ni borran transacciones; se informa cuántas fueron ignoradas. Si cae dentro de la gestión, el nuevo cierre no se habilita automáticamente y requiere revisión manual. |
| A4 — error de archiver podía escapar | **Resuelto**: el export tiene listeners de error y el servidor incorpora manejadores globales. |
| A5 — `accounting.db` versionado | **Resuelto**: no está en el índice actual de Git. No borrar bases o archivos locales sin revisar su estado. |
| CORS de desarrollo demasiado abierto | **Pendiente, limitado a desarrollo**: el fallback de desarrollo acepta cualquier origen; revisar antes de exponer un backend de desarrollo a una red no confiable. |
| Upload de backup acepta extensión o MIME | **Pendiente**: `okExt || okMime` no valida que ambas señales concuerden. Multer limita a 100 MB comprimidos y el lector valida ZIP/JSON con tope de 200 MB descomprimidos; esto reduce, no elimina, el riesgo. |
| Backup importado en RAM | **Pendiente conocido**: cada entrada JSON se descomprime y parsea en memoria, con el límite anterior. Export sí es streaming. |
| `getProfile` oculta fallo de BD | **Parcial**: ahora emite warning, pero devuelve `null`; el llamador puede confundir una falla con perfil inexistente y seguir con defaults. |
| Logs del motor IA | **Pendiente**: `ai.js` imprime cuerpos completos de respuesta del motor en el flujo generate-from-ledger (incluidos errores); pueden contener información contable. |
| N+1 de inventario | **Resuelto en código**: `GET /items` calcula saldos con una lectura bulk por lote en `valuationService`. |
| Dispatcher `/api/skills/dispatch` | **Fallido por dependencia**: `skillDispatcher.js` requiere `vm2`, ausente de las dependencias instaladas/declaradas en este checkout. El endpoint puede responder 500. No se debe añadir un sandbox dinámico sin revisar la seguridad del diseño. |

### Importador Universal: situación del piloto

- U-9 Etapa 1 sí está implementada: opt-in **Importar (nuevo)**, clásico predeterminado,
  guard PUCT, wizard de seis pasos y bitácoras locales. U-10/retiro legacy no está aprobado.
- El replay de tres bitácoras coincide con sus huellas y gates. Hoja2/DASH registra
  235/235 y Hoja5/VARLEN 576/576; ASFI registra 2859 nodos analizados, pero no tiene
  evento `result`. No afirmar que ASFI se importó correctamente.
- Son tres estructuras de hojas Excel del mismo libro de origen, no evidencia de
  universalidad entre múltiples fuentes y formatos. PUCT multicolumna sigue en el
  flujo clásico; PGC sigue PARTIAL en el flujo canónico automático.
- H1 (huellas enormes) y H2 (eventos por cada tecla) se corrigieron en el código de
  esta revisión. La huella nueva `u9fp1` es una firma determinista de monitoreo, no
  una prueba criptográfica; falta repetir una importación ASFI y descargar su recibo.
- Las ediciones textuales ahora actualizan la sesión mientras se escribe, pero la
  bitácora registra el estado final al salir del campo/Enter. Debe verificarse en
  uso piloto que la experiencia de edición siga siendo natural.
- Ver procedimiento/evidencia: `U9_CONTROLLED_ROLLOUT_DESIGN.md` y
  `ANALISIS_PILOTO_U9.md`. No cambiar default, no desactivar fallback ni ampliar
  PUCT sin una aprobación separada.

### Verificación de esta actualización

- `npm test`: suites del motor de importación, contrato, producción, wizard y
  diferencial completadas con salida 0.
- `web-app/client`: `npm run build` completado. Vite mantiene advertencias de
  chunks grandes y `eval` en `pdfjs-dist`/DataForge; no son fallos de compilación.
- El build no sustituye una prueba visual manual de la Hoja de Trabajo en un móvil
  real; esa comprobación sigue pendiente.
- La verificación funcional del núcleo se amplió con casos de periodo, herencia de
  jerarquía, padre PUCT virtual, balance patrimonial y asientos de cierre/orden al
  centavo. No se ejecutó ningún endpoint ni cierre. Sin embargo, el smoke `require`
  del router de reportes cargó `db.js` usando el `.env` local, cuyo host se confirmó
  como el Turso de producción: `initializeSchema()` ejecutó el batch de DDL
  `IF NOT EXISTS`, el `INSERT OR IGNORE` de la empresa semilla ID 1 y se intentaron
  tres migraciones idempotentes. No se hicieron escrituras de asientos/cuentas; no
  se verificó si la empresa semilla ya existía, por lo que no se afirma que la BD
  haya quedado completamente intacta. En adelante, usar `node --check` o un Turso
  aislado para smoke tests que carguen routers.
- Alcance y fundamento normativo de estos cambios: `docs/normativa/NORMATIVA_Y_APLICABILIDAD.md`.

---

## 🔴 CRÍTICO — atender primero

### C1. El restore de backup probablemente NO persiste nada (hallazgo histórico; resuelto)
`web-app/server/db.js:245-249` + `web-app/server/routes/backup.js:162-171`.
`db.transaction()` reenvía a `client.transaction(callback)`, pero en `@libsql/client@0.17.0` `transaction()` espera un **string de modo**, no un callback, y exige `tx.commit()` explícito (que nunca se llama). Resultado: el import "termina con éxito" pero no escribe, o falla en silencio. Esto explica directamente que el backup "no funcione bien".
**Fix más seguro:** usar la rama manual `BEGIN IMMEDIATE / COMMIT / ROLLBACK` que ya existe en `backup.js:173-186` (hoy es código muerto), o reescribir `withTransaction` con el patrón correcto de libsql. Probar import real punta a punta contra Turso.

### C2. Inyección SQL en `POST /api/transactions/batch` (hallazgo histórico; resuelto)
`web-app/server/routes/transactions.js:194-228`. Arma SQL por concatenación con un `escape()` casero que solo cubre comillas simples. Lo invoca también `/api/ai/adjustments/confirm` (`ai.js:1347`). El resto de rutas sí usan placeholders `?` correctamente.
**Fix:** parametrizar con `?` dentro de `db.transaction()`, eliminar el `escape()` casero.

### C3. Sin autenticación ni autorización en NINGUNA ruta (hallazgo histórico; parcial)
Cualquiera con la URL puede leer/crear/borrar datos. El aislamiento entre empresas depende de un `companyId` que el cliente envía libremente → **IDOR** (cualquiera opera sobre datos de otra empresa). Endpoints peligrosos abiertos: `DELETE /api/accounts/all`, `POST /api/backup/import`, `DELETE /api/companies/:id`.
**Fix:** middleware de auth + validar pertenencia de `companyId` al usuario.

### C4. Pérdida silenciosa de datos en el backup (hallazgo histórico; resuelto para tablas soportadas)
`backup.js:23-35` respalda 11 tablas pero **omite** `cost_centers`, `cost_distribution_*` y `production_orders` (existen en `schema.sql` con datos reales). Restaurar una empresa = perder centros de costo y órdenes de producción. Tampoco respalda el "conocimiento IA" (skills en archivos JSON).
**Fix:** agregar esas tablas a `SUPPORTED_TABLES`/`IMPORT_ORDER` con remapeo de IDs, o documentar explícitamente la limitación.

---

## 🟠 ALTO

### A1. Cold start — diagnóstico original superado; limitación vigente
El texto inicial de este hallazgo ya no describe el código actual: `index.js` inicia el keep-alive interno y el workflow externo de GitHub Actions pinguea ambos servicios durante su franja configurada:
- `https://sistema-contable-nexus.onrender.com/api/status` (Node)
- `https://motor-ai-nexus.onrender.com/api/ai/health` (Python)

La limitación no está eliminada: cada servicio free duerme tras 15 min sin tráfico y cada uno debe despertarse por separado. La cuota de 750 h es compartida por workspace; el horario actual representa ~725 h en 30 días y ~749 h en 31 días para los dos servicios, antes del tráfico adicional. Consultar el uso real en Render; no se puede garantizar que permanezcan despiertos durante todo el mes free.

### A2. Por qué los cálculos "se quedan en modo contingencia" (hallazgo histórico; mitigado, no eliminado)
Cuando Python devuelve 503/timeout (cold start), el backend (`ai.js:1141-1168`) y el frontend (`aiAdjustmentService.js:307-328`) caen a un **fallback heurístico estático** (`/api/reports/adjustment-entries-proposal`, `confidence: 0.7`) que NO usa el motor de razonamiento real → ajustes degradados/genéricos. El circuit breaker (cooldown 20s) puede abrirse justo durante el arranque. El backoff es lineal, no exponencial.
**Fix:** warmup que reintente hasta `/health` 200 antes del payload pesado; no envenenar el breaker con timeouts de warmup; backoff exponencial.

### A3. UI/UX mobile — tablas contables anchas (hallazgo parcialmente vigente)
El viewport y el sidebar (hamburguesa) están **bien**. El problema son tablas con `minWidth` fijos en px:
- 🥇 `Worksheet.jsx:1008-1043` — 21 columnas, >1.600px de ancho mínimo. El peor.
- `Journal.jsx:979-984` — modal de asiento no cabe en pantalla chica.
- `Ledger.jsx`, `TrialBalance.jsx`, `FinancialStatements.jsx` (sangría `level*1.5rem` aplasta nombres a nivel 5).
**Actualización:** sí existen reglas CSS de compresión, ocultamiento de algunas
columnas y fijación de la cuenta. La lógica de sus columnas y saldos se corrigió,
pero mantiene 16 columnas numéricas agrupadas y desplazamiento horizontal; el
rediseño móvil todavía no se aborda.

### A4. Manejo de error de `archiver` puede tumbar Node (hallazgo histórico; resuelto)
`backup.js:786-789` hace `throw` dentro de un callback async → excepción no capturada. Además no hay error handler global ni `process.on('unhandledRejection')`.

### A5. `accounting.db` versionado en git (hallazgo histórico; resuelto)
`*.db` está en `.gitignore` pero el archivo se agregó antes de la regla. Genera ruido y conflictos. `git rm --cached web-app/server/accounting.db`.

### A6. Token Turso (rw a producción) en `.env` local (estado externo no verificable)
Ningún `.env` fue commiteado nunca (verificado en el historial) — el riesgo es exposición local del archivo. Aun así conviene **rotar el token** y crear un `.env.example` con placeholders.

---

## 🟡 MEDIO

- **Transacciones de `transactions.js`: resueltas** con `db.transaction()`; conservar las pruebas de atomicidad.
- **CORS de desarrollo abierto**: el origen regex acepta cualquier origen en el fallback de desarrollo; no usar ese modo en una red no confiable.
- **Multer acepta extensión O MIME** (`backup.js`): limite 100 MB comprimidos; validar firma/contenido y endurecer el filtro sigue pendiente.
- **Import de backup en RAM**: tope actual 200 MB descomprimidos; el export sí es streaming.
- **`getProfile`**: registra el error pero aún devuelve `null`, lo que puede ocultar el fallo aguas arriba.
- **Logs de `ai.js`**: las respuestas completas del motor Python pueden quedar en logs; revisar redacción y retención.
- **N+1 de inventario: resuelto** mediante cálculo bulk en `valuationService`.

---

## 🔵 LIMPIEZA / orden (auditar de nuevo antes de borrar)

Las listas de la auditoría inicial son **candidatos históricos**, no comandos de
limpieza vigentes. Parte de esos archivos ya fue eliminada y `scripts/` ahora
contiene suites formales, E2E y herramientas de análisis del piloto U-9. No borrar
archivos con patrones generales como `test_*` o `analyze_*` sin revisar referencias,
`package.json`, `git log` y el árbol actual. `accounting.db` no está versionado hoy;
`sqlite3` tampoco figura en el `package.json` raíz actual.

Mahoraga no es una pieza de UI totalmente aislada: existen rutas y servicios
parciales, persistencia del controlador y datos que también usa el motor contable.
La rueda se conserva por decisión del usuario. Para separar lo preservable de lo
incompleto, usar el inventario corregido y roadmap de `MAHORAGA.md`; no eliminar
`mahoraga_adaptation_events` ni perfiles del motor de ajustes.

### ⛔ INTOCABLE — el motor de ajustes contables que SÍ funciona
- `ai_adjustment_engine.py` (el motor real).
- En `ai.js`: endpoints `/adjustments/*` y `/profile/:companyId`.
- `utils/aiEngineResolver.js`, `serverFiscalYearUtils.js`, `services/valuationService.js`.
- Cliente: `Worksheet.jsx`, `AIAdjustmentPanel.jsx`, `AdjustmentWizard.jsx`, `ClosingWizard.jsx`.
- La sección de Depreciación de `Settings.jsx` (pestaña `data`) y la tabla `company_adjustment_profiles` → **alimentan el motor**, aunque su endpoint diga `/api/ai/`.

---

## Orden recomendado actualizado

1. **Seguridad de multiempresa**: confirmar `APP_PASSWORD` en producción y diseñar autorización por usuario/empresa; la contraseña compartida solo es un gate global.
2. **Piloto U-9**: repetir ASFI con el build identificado, obtener `result` y revisar el plan restaurado; ampliar pruebas solo a formatos/fuentes concretos, sin afirmar universalidad.
3. **Backup y observabilidad**: revisar filtro ZIP, RAM del import, logs contables y propagación de errores de perfil.
4. **Mobile**: acordar cómo intervenir la Hoja de Trabajo protegida; revisar además Diario, Mayor y Balance de Comprobación en móvil real.
5. **Limpieza y Mahoraga**: decidir el alcance después de una auditoría de referencias actualizada; preservar motor contable y rueda.
