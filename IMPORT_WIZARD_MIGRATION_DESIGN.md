# IMPORT WIZARD MIGRATION DESIGN (Fase 6)

> Diseño de la migración controlada del `SmartImportWizard` al Universal Import
> Engine. **Este documento es DISEÑO, no implementación.** Nada de producción se
> modifica hasta que se apruebe la migración.
>
> Verdict de Fase 5 (commit `10a328e`): `SMARTIMPORTWIZARD MIGRATION: READY TO DESIGN`.

## 1. Estado actual (auditoría Fase 5, con línea exacta)

`web-app/client/src/components/SmartImportWizard.jsx` (2512 líneas), invocado en
`pages/Accounts.jsx:376` con `{ onClose, onSuccess }`.

### 1.1 Estados React (33)
`step` (:56), `file` (:57), `workbook` (:58), `error` (:59), `sheets` (:60),
`selectedSheet` (:61), `range` (:62), `pdfRange` (:63), `fileType` (:64),
`originalData` (:65), `rawData` (:66), `columnMapping` (:67), `multiColumnMode`
(:68), `codeColumns` (:69), `structureConfig` (:70), `groupRules` (:71),
`level1Accounts` (:72), `previewData` (:73), `planAnalysis` (:74), `testCode`
(:75), `showRefinePanel` (:76), `selectedIds` (:77), `importing` (:78),
`importProgress` (:79), `importCancelToken` (:80), `newRulePrefix` (:81),
`newRuleType` (:82), `showAddRule` (:83), `bulkType` (:84), `bulkLevel` (:85),
`profileLoaded` (:86), `showProfileLibrary` (:87), `currentPage` (:89).

### 1.2 Pasos del flujo
1 (selección archivo, :1434) → 2 (hoja/rango, :1451) → 3 (columnas, :1503) →
3.5 (configuración estructura, :1582) → 4 (preview/validación, :1821) →
importación (`performImport`, :1209).

### 1.3 Lógica de detección/parsing (objetivo de REEMPLAZO)
| Función | Líneas | Problema |
|---|---|---|
| `parsePDFFile` / `parsePDFText` | :287 / :371 | parser ad-hoc con regex ASFI + console.log masivo |
| `processPUCTFormat` | :450 | padding hardcodeado `[1,2,3,6,9]`, filtro por columnas fijas |
| `processDashFormat` | :540 | regex rígida `^\d{3}-\d{2}-\d{2}$` (DASH real tiene códigos de 7 niveles) |
| `detectAndMergeColumns` | :573 | heurística de 15 filas; decide PUCT/Dash/genérico |
| `autoDetectColumns` | :673 | **MUERTA** (nunca invocada) |
| `determineType` / `determineTypeFromNameOnly` | :773 / :701 | ~60 regex de keywords; fallback por primer dígito con confianza inventada (50-100) |
| `generateGroupRulesFromLevel1` | :809 | duplica detección de nivel; muta estado dentro de loops |
| `generatePreview` | :946 | mezcla detección + IA + reglas + self-correction de config |
| `analyzeWithAI` | :917 | POST a `/api/ai/orchestrator/orchestrate` (roto, ver AGENTS.md) |

### 1.4 Lógica de persistencia (objetivo de KEEP con supervisión)
- `performImport` (:1209): batching 500 + `/api/accounts/bulk` leyendo
  `successCount/errorCount` reales + cancelación con axios CancelToken +
  PUT `/api/companies/:id` con `code_mask`/`plan_structure` **después** del
  import exitoso (:1292-1311). Comportamiento correcto y con guardas.

### 1.5 UI de valor (objetivo de KEEP/ADAPTAR)
- Paginación 100 items (:2373-2389), bulk actions type/level (:2391-2422),
  tabla editable con delete (:2424-2470), progress bar + cancel (:2472-2495),
  biblioteca de perfiles localStorage (:2189-2263), simulador de códigos (:1739-1766).

## 2. Puntos de integración del engine (API exacta)

```js
import { extractDocument } from '../utils/FormatAdapter';
import { UniversalPlanAnalyzer } from '../utils/UniversalPlanAnalyzer';
import { ImportContractValidator } from '../utils/ImportContractValidator';
import { CompatibilityAdapter } from '../utils/CompatibilityAdapter';

// 1. Extracción (mecánica, sin inferencia)
const doc = await extractDocument(file, { sheetName, pdfPages: { start, end } });
//    → { rows, headers, sheetName, ... } (CanonicalDocument)

// 2. Análisis canónico (multi-región, multi-tabla)
const analysis = UniversalPlanAnalyzer.analyzeCanonicalDocument(doc);
//    → { regions: [{ ...meta, contract: ImportContract }], warnings, ... }

// 3. Validación del contrato por región
const check = ImportContractValidator.validate(region.contract);
//    → { valid, errors: [], warnings: [] }  // BLOCK = invalid

// 4. Simulación (payload en memoria, SIN escrituras)
const payload = CompatibilityAdapter.toBulkPayload(contract, companyId);

// 5. Importación real SOLO tras confirmación explícita
//    POST /api/accounts/bulk (endpoint existente, sin cambios de servidor)
```

## 3. Nuevo wizard propuesto: `UniversalImportWizard` (componente NUEVO)

### 3.1 Pasos (6)
| Paso | Nombre | Contenido |
|---|---|---|
| 1 | Archivo | igual al actual (KEEP :1434-1449) + detección de formato vía `detectFormat` |
| 2 | Diagnóstico | extracción + regiones detectadas + confidence de extracción + ambigüedades |
| 3 | Simulación | contrato: tabla de nodos con estado (VALID/REVIEW/BLOCKED), transformaciones auditables, reconciliación (`dataLoss`), pestañas por región |
| 4 | Revisión | overrides del usuario (tipo/nivel/padre/nombre) — edición del CONTRATO, no del análisis |
| 5 | Resumen | payload final (CompatibilityAdapter), fingerprint del contrato, cuentas por estado, botón simular/exportar |
| 6 | Confirmación | progress + cancel + `/bulk` + PUT estructura (misma lógica que :1209-1335) |

### 3.2 Estados propuestos (reemplazan los 33)
```
file, doc (CanonicalDocument), analysis (ImportAnalysis),
selectedRegion, contract, overrides (Map nodeId→patch),
check (validator), payload, step, importing, importProgress,
importCancelToken, currentPage, selectedIds, bulkType, bulkLevel
```

### 3.3 Reglas de diseño (invariantes heredadas de la baseline)
1. La UI jamás re-analiza: los overrides se aplican al contrato
   (el CompatibilityAdapter es mecánico, probado por mutación).
2. Nodos BLOCKED no se postean jamás; el usuario debe resolverlos
   (editarlos/eliminarlos) o excluirlos explícitamente.
3. Toda transformación se muestra (rawCode → normalizedCode + `transformations`).
4. Naturalezas INFERRED exigen confirmación (`requiresConfirmation`).
5. Multi-región: una pestaña por región; importar = elegir región + confirmar.
6. Shadow por defecto: sin POST hasta el paso 6 confirmado.

## 4. Matriz KEEP / REPLACE / MERGE / REMOVE / NEW

| Elemento | Ref | Acción | Destino |
|---|---|---|---|
| Paso 1 (input file + aceptación .xlsx/.pdf) | :1434-1449 | KEEP | paso 1 |
| Selector hoja Excel / rango filas / rango páginas PDF | :1476-1499 | KEEP | paso 1-2 |
| `performImport` (bulk 500, successCount/errorCount, CancelToken, PUT estructura post-import) | :1209-1335 | KEEP (sin cambios lógicos) | paso 6 |
| `getTypeInfo` + `ACCOUNT_TYPES` | :14-26, :1420 | KEEP | catálogo de tipos (dominio del contrato) |
| Paginación 100 / bulk actions / tabla editable / delete | :2373-2470 | KEEP (adaptada a contrato) | paso 4 |
| Progress bar + cancelar importación | :2472-2495 | KEEP | paso 6 |
| Bibliotecas de perfiles localStorage | :2153-2263 | KEEP (renombrada a perfiles de contrato) | paso 2/4 |
| `handleFileUpload` (lectura binaria + XLSX.read + pdfjs directo) | :251-285 | REPLACE | `extractDocument` (FormatAdapter, worker local `?url`) |
| `parsePDFFile`/`parsePDFText` | :287-434 | REPLACE | `PdfAdapter` + `extractNarrativeAccounts` |
| `processPUCTFormat`/`processDashFormat`/`detectAndMergeColumns` | :450-671 | REPLACE | `detectMultiColumn`/`fuseMultiColumnRow`/`generateImportContract` |
| `determineType`/`determineTypeFromNameOnly` | :701-807 | REPLACE | `suggestRootTypes` + tipo en contrato (con `requiresConfirmation`) |
| `generateGroupRulesFromLevel1` | :809-914 | REPLACE | `suggestRootTypes` (reglas = nodos nivel 1 + su tipo) |
| `generatePreview` (mezcla detección+IA+reglas) | :946-1140 | REPLACE | pipeline sección 2 (análisis → contrato → validación) |
| `analyzeWithAI` (orquestador roto) | :917-944 | REMOVE | (se reactiva solo cuando exista un servicio IA sano; no es requisito del engine) |
| `autoDetectColumns` (muerta) | :673-686 | REMOVE | — |
| `multiColumnMode`/`codeColumns` (merge manual de columnas) | :68-69, :185-247 | REMOVE | `detectMultiColumn` automático + override en diagnóstico |
| `analyzeStructure` (solo maneja multiColumnMode) | :185-247 | REMOVE | — |
| Doble editor de estructura (paso 3.5 duplicado en paso 4) | :1582-1819, :1927-2187 | MERGE | un único editor en paso 2/4 |
| `getUniversalLevel`/`calculateLevel`/`calculateParent` vía AccountPlanProfile | :28-52, :690-696 | MERGE | level/parent vienen del contrato; solo queda el modo "editar manual" |
| `structureConfig` → PUT `code_mask`/`plan_structure` | :1292-1311 | MERGE | derivar de `planAnalysis` del contrato (mask/regex/levels) |
| Panel de confidence/ambiguity de extracción | — | NEW | paso 2 |
| Pestañas BLOCK / REVIEW / VALID con motivos | — | NEW | paso 3 |
| Tabla de transformaciones auditables por nodo | — | NEW | paso 3/4 |
| Reconciliación visible (`dataLoss`: rechazadas/ignoradas/unaccounted) | — | NEW | paso 3/5 |
| Fingerprint del contrato + comparación pre/post overrides | — | NEW | paso 5 |
| Modo shadow explícito ("Simular sin importar") | — | NEW | paso 5 |

## 5. Estrategia de despliegue (feature flag)

1. **Flag**: `localStorage.importEngine = 'universal' | 'legacy'` (default `legacy`).
2. `Accounts.jsx:376` renderiza `UniversalImportWizard` si el flag está activo;
   `SmartImportWizard.jsx` queda **intacto** como fallback (`legacyFallback=true`).
3. **Paridad demostrada** (condición para cambiar el default): differential
   `CompatibilityAdapter.compareLegacyVsUniversal` con 0 diffs level/name/type
   en todo el corpus real (hoy: 0 diffs + 226 mejoras parent en DASH).
4. Etapas: (a) shadow-only para usuarios internos → (b) default universal con
   botón "usar asistente clásico" → (c) legacy retirado SOLO tras 30 días sin
   incidentes y cobertura total del corpus.
5. Cualquier regresión detectada → revertir flag a `legacy` (rollback = 1 línea).

## 6. Criterios de aceptación de la migración

- [ ] Corpus completo (PUCT5C, PUCT9, DASH, VARLEN, PGC, ASFI, Hoja1, MEFP-PDF)
      importable por el nuevo wizard con los mismos resultados que la baseline.
- [ ] `npm test` en verde (suites + browser E2E) con el wizard nuevo conectado.
- [ ] Un test E2E de navegador recorre los 6 pasos en modo shadow (sin POST)
      y verifica `__E2E_RESULTS__` con `silent=0 unacc=0`.
- [ ] Un import real en entorno de prueba (empresa desechable) con el endpoint
      `/bulk` existente: mismo `successCount/errorCount` que el wizard legacy.
- [ ] Overrides del usuario no rompen fingerprint ni validación.
- [ ] Duplicados del corpus → BLOCK visible con motivo, no silencioso.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Pérdida de UX legacy (config manual fina) | El editor de estructura permanece como modo avanzado (MERGE) |
| PGC auto-detección (PARTIAL) | El parser de columna única se integra como detector en diagnóstico (etapa (b)) |
| PDF worker en build | Ya resuelto: `?url` import con guard `typeof document` |
| Doble mantenimiento durante la transición | Ventana acotada por etapas; legacy congelado (solo hotfix de bugs críticos) |
| Confianza del usuario | El modo shadow permite comparar propuesta vs actual antes de importar |
