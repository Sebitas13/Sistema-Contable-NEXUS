# IMPORT WIZARD MIGRATION DESIGN — FASE 6 (DEFINITIVO)

> Diseño definitivo de la migración del `SmartImportWizard` (legacy) al
> Universal Import Engine. **Solo diseño y preparación: NO se implementa nada
> de producción.** La auditoría es sobre el estado real del archivo
> `SmartImportWizard.jsx` (2512 líneas), sin modificaciones.
>
> Baseline congelada: `UNIVERSAL_IMPORT_ENGINE_BASELINE.md`. Verdict Fase 5
> (commit `10a328e`): ENGINE GO · BROWSER E2E PASS · SMARTIMPORTWIZARD
> MIGRATION: READY TO DESIGN.

---

## A. ARQUITECTURA ACTUAL (mapa real del wizard)

### A.1 Snapshot de auditoría

Componente: `web-app/client/src/components/SmartImportWizard.jsx` (2512 líneas,
común `function SmartImportWizard({ onClose, onSuccess })` en :53). Único punto
de montaje: `pages/Accounts.jsx:376` (`showImportWizard && <SmartImportWizard
onClose={...} onSuccess={fetchAccounts} />`; abierto por botón "Importar" en
:361). Envoltorio: `NexusModal` (portal, Escape, focus-trap) en :1423-1430.

Dependencias: `React` (:1), `axios` (:2), `API_URL` (:3), `xlsx` (:4),
`pdfjs-dist` (:5, worker por **CDN cdnjs** en :12), `useCompany` (:6),
`AccountPlanProfile` (:7), `useToast` (:8), `NexusModal` (:9).

### A.2 Inventario de estados (33 — todos `useState`, cero `useRef`/`useEffect`)

| Estado | Línea | Uso real | Veredicto |
|---|---|---|---|
| `step` | :56 | flujo 1→2→3→3.5→4 | KEEP (UI) |
| `file` | :57 | picker + re-proceso PDF (:1473) | KEEP |
| `workbook` | :58 | lectura hojas (:99) | REPLACE por CanonicalDocument |
| `error` | :59 | banner alert (:1432) | MERGE a issues |
| `sheets` / `selectedSheet` | :60/:61 | selector hoja (:1481) | KEEP |
| `range` | :62 | filas Excel (:1487-1491), preview (:958) | MERGE (región de filas = opción extracción) |
| `pdfRange` | :63 | páginas PDF (:1464-1469) | KEEP (opción extracción) |
| `fileType` | :64 | **seteado 2× (:269,:272), NUNCA leído** | REMOVE (dead) |
| `originalData` | :65 | reset al volver a paso 3 (:1808) | MERGE |
| `rawData` | :66 | preview/edición | REPLACE por Contract.nodes |
| `columnMapping` | :67 | UI código/nombre (:1524-1564) | REPLACE por diagnóstico (mapping del contrato) |
| `columnMapping.type` | :67 | solo lo escribe la función muerta `autoDetectColumns` | REMOVE (vestigial) |
| `multiColumnMode` | :68 | toggle UI (:1510) + analyzeStructure (:186) | REMOVE (ver §18) |
| `codeColumns` | :69 | merge manual multi-col (:190-204) | REMOVE (ver §18) |
| `structureConfig` | :70 | configuración niveles/separador | MERGE (derivada de Contract + editor avanzado) |
| `groupRules` | :71 | editor reglas dígito→tipo (:2272-2370) | REPLACE por nodos nivel 1 del contrato |
| `level1Accounts` | :72 | badges nivel 1 (:2280) | REPLACE (derivado del contrato) |
| `previewData` | :73 | tabla editable, bulk, import | REPLACE por Contract.nodes |
| `planAnalysis` | :74 | mask/insights UI (:1828-1924) | MERGE (derivado del contrato) |
| `testCode` | :75 | simulador (:1746-1763) | REMOVE (ver §20) |
| `showRefinePanel` | :76 | panel entrenamiento (:1854) | MERGE (editor avanzado) |
| `selectedIds` | :77 | bulk (:2393+) | KEEP (UI) |
| `importing` | :78 | progress (:2472) | KEEP |
| `importProgress` | :79 | barra (:2477) | KEEP |
| `importCancelToken` | :80 | cancel (:1201-1207) | KEEP |
| `newRulePrefix`/`newRuleType` | :81/:82 | agregar regla (:2306-2313) | REPLACE |
| `showAddRule` | :83 | editor reglas (:2273) | REPLACE |
| `bulkType`/`bulkLevel` | :84/:85 | bulk (:2402-2412) | KEEP (UI) |
| `profileLoaded` | :86 | badge "Perfil Entrenado" (:1590) | REDESIGN (§19) |
| `showProfileLibrary` | :87 | modal biblioteca (:2190) | REDESIGN (§19) |
| `currentPage` | :89 | paginación (:2378-2388) | KEEP (UI) |

### A.3 Inventario de handlers (31 — todos con uso salvo 1)

Conteo verificado por grep (total apariciones / definiciones):

| Handler | Línea | Estado |
|---|---|---|
| `handleFileUpload` | :251 | vivo (picker Excel/PDF; CSV **no aceptado**: regex :256-257) |
| `parsePDFFile` / `parsePDFText` | :287/:371 | vivo; parser regex ASFI + logs masivos |
| `loadSheetData` | :95 | vivo (rango→`detectAndMergeColumns`→paso 3) |
| `detectAndMergeColumns` | :573 | vivo (:127) — **transformación silenciosa** al cargar |
| `processPUCTFormat` | :450 | vivo (:649) — padding a 9 dígitos + `setStructureConfig` forzado (:462-471, efecto lateral) |
| `processDashFormat` | :540 | vivo (:655) — **filtra filas** por `^\d{3}-\d{2}-\d{2}$` (:560): raíces/intermedios fuera de patrón se pierden SIN traza |
| `autoDetectColumns` | :673 | **MUERTO** (única aparición = definición) |
| `analyzeStructure` | :185 | vivo (:1574) — sin multi-col solo navega a 3.5 (no analiza nada) |
| `generateGroupRulesFromLevel1` | :809 | vivo pero con **stale closure**: `loadSheetData` lo llama (:150) justo después de `setRawData` (:149) y lee `rawData` del render anterior → primera carga no genera reglas (idem PDF :342→:363) |
| `determineTypeFromNameOnly` / `determineType` | :701/:773 | vivos — ~60 regex de keywords + fallback primer dígito (:794-806); confianza inventada |
| `calculateLevel` / `calculateParent` | :690/:694 | vivos → delegan en `AccountPlanProfile` |
| `getUniversalLevel` | :28 | vivo (:997,:1242,:1898) — tercera vía de cálculo de nivel (intenta conciliar preview/import) |
| `analyzeWithAI` | :917 | vivo en código pero **inerte en runtime**: `POST /api/ai/orchestrator/orchestrate` (:923) no está registrado (orchestrator roto, AGENTS.md) → 404 → catch → `null`. Badge "IA Activa" (:1849) nunca se muestra |
| `generatePreview` | :946 | vivo (:1814,:2150) — **concentra toda la inteligencia**: filtrado por rango (:957), duplicados toast (:1021-1039), IA (:1043), reglas nivel 1 (:1069-1090), override de tipos (:1094-1101), `AccountPlanProfile.analyze` (:1104), self-correction de config (:1109-1136) |
| `updateAccountField` | :1148 | vivo (:2452-2459) — edición manual; recalcula padre/nivel al editar código (:1152-1155) |
| `deleteAccount` | :1162 | vivo (:2461) — reindexa ids |
| `toggleSelect`/`toggleSelectAll` | :1171/:1177 | vivos |
| `applyBulkAction` | :1185 | vivo — tipo o nivel en lote |
| `performImport` | :1209 | vivo (:2499) — ver A.6 |
| `updateRule`/`addRule`/`deleteRule`/`updateRulePrefix` | :1337-1385 | vivos — reglas dígito→tipo |
| `updatePreviewTypes`/`updateLevel1AccountsDisplay` | :1388/:1407 | vivos — recálculo tras reglas |
| `cancelImport` | :1200 | vivo (:2492) |
| `getTypeInfo` | :1420 | vivo |
| `colToIndex` | :436 | vivo (:114) |

### A.4 Mapas de flujo real (USER ACTION → STATE → HANDLER → PROCESO → SALIDA)

**Excel**
```
Seleccionar .xlsx → handleFileUpload → FileReader binary → XLSX.read → workbook+sheets → step 2
Elegir hoja/columnas fila → loadSheetData → XLSX.sheet_to_json (header:1, defval:'', blankrows)
  → detectAndMergeColumns (SILENCIOSO: PUCT→9 dígitos | DASH→filtro ^\d{3}-\d{2}-\d{2}$ | genérico→levelLengths=(i+1)*2)
  → generateGroupRulesFromLevel1 (stale → no-op en 1ª carga)
  → rawData → step 3
Configurar columnas → analyzeStructure (multi-col: fusiona con padding; sin multi-col: no-op) → step 3.5
Configurar estructura → generatePreview → previewData → step 4
Editar/validar → performImport → POST /bulk → PUT /companies → onSuccess+onClose
```

**PDF**
```
Seleccionar .pdf → handleFileUpload → parsePDFFile (rango páginas → getTextContent → agrupa por Y)
  → parsePDFText (regex ASFI_PATTERNS; si 0 cuentas → error)
  → rawData 'PDF Import' → generateGroupRulesFromLevel1 (stale) → step 2/3
Resto del flujo = Excel desde rawData (mapping {code:0,name:1})
Nota: solo cubre formato ASFI NNN.NN; un PDF real multi-región (MEFP: tabla+narrativa)
NO se separa: todo se funde en una lista y el ruido se descarta por filtros de línea (:391-393).
```

**CSV** → **NO SOPORTADO en legacy** (sin rama en :256-257). El engine sí tiene
`CsvAdapter`. Mejora documentada de la migración, no retrocompatibilidad.

**Error (extracción/parseo)** → `setError` → banner rojo :1432; el usuario debe
volver atrás manualmente. **No existe retry dedicado** (solo re-intentar la
acción). Ver A.7 GAP-1.

**Cancelación (import)** → `cancelImport` → `CancelToken.cancel` → catch
`axios.isCancel` → toast.info (:1324-1326). Correcto. KEEP.

**Edición manual** → `updateAccountField(id, code|name|type|level)` → recalcula
`parent_code`/`level` solo si cambia code (:1152-1155); **sin traza** de la
edición (no se sabe qué tocó el usuario ni el valor original).

**Bulk action** → selección → `applyBulkAction(type|level)` → muta `previewData`
por lote; nivel recalcula padre (:1191). Sin traza.

**Type override (reglas)** → editor reglas → `updatePreviewTypes` reaplica
regla dígito→tipo a TODA la tabla (:1390-1403) — override global no rastreable.

**Importación** → A.6.

**Retry** → no existe como concepto; tras error se repite el paso.

**Cierre** → NexusModal `onClose` (X/Escape) o footer "Atrás"; tras éxito
`onSuccess()` (refresca cuentas en Accounts) + `onClose()` (:1320-1321).

### A.5 Dónde vive HOY la "inteligencia" (resumen)

1. `detectAndMergeColumns` + `processPUCTFormat` + `processDashFormat`
   (detección de formato y normalización **silenciosa**, sin dataLoss).
2. `getUniversalLevel`/`calculateLevel`/`calculateParent`
   (niveles/padres vía `AccountPlanProfile` con 3 rutas de decisión).
3. `determineType`/`determineTypeFromNameOnly` (tipos por keywords).
4. `generateGroupRulesFromLevel1` (reglas dígito→tipo).
5. `generatePreview` (orquestador: duplicados, IA inerte, reglas, tipos, análisis).
6. `analyzeWithAI` (IA — inerte en producción).
7. `performImport` (recálculo FINAL de nivel/padre/tipo al importar, :1230-1256:
   **la tercera pasada de inteligencia**, después de preview y reglas).

### A.6 `performImport` (persistencia — correcta hoy, reutilizable)

`:1209-1335`: guard empresa+preview no vacío → batches de 500 a
`POST /api/accounts/bulk` leyendo `successCount`/`errorCount` reales →
progreso con cancel → **después** del import: `PUT /api/companies/:id` con
`code_mask`/`plan_structure` derivados de `structureConfig`+`planAnalysis`
(:1292-1311) → toast con resultado real → `onSuccess()`+`onClose()`. Pre-cálculo
por fila con limpieza de separadores si `!hasSeparator` (:1237) y recálculo de
nivel (`getUniversalLevel`) y padre (`AccountPlanProfile.calculateParent`).
Este bloque es el que garantiza consistencia contra el backend; se conserva
con su semántica, alimentado por el Effective Contract.

### A.7 Gaps verificados del legacy (para no repetir)

- GAP-1 Sin retry; errores = banner + navegación manual.
- GAP-2 Duplicados solo avisan por toast (:1021-1039); **no bloquean**: se
  importan y fallan lote a lote contra el server (errorCount).
- GAP-3 Transformaciones silenciosas en carga (PUCT expandido, DASH filtrado,
  genérico con longitudes arbitrarias `(i+1)*2` :665). Sin reconciliación.
- GAP-4 Ediciones y overrides sin traza (A.4 edición/bulk/reglas).
- GAP-5 `prompt()` nativo (:2163) para guardar perfil (rompe UX del modal).
- GAP-6 PDF worker remoto por CDN (:12) — dependencia de red de terceros.
- GAP-7 IA "prometida" pero inerte (orchestrator no registrado) + badge
  cosmético (:1849).
- GAP-8 `columnMapping` asume código en col 0 tras merge (pierde el mapping
  original elegido por el usuario al saltar a 3.5 desde multi-col).
- GAP-9 El nivel 3.5 duplica editores de estructura (3.5 completo y panel
  "Entrenar Estructura" en paso 4 :1927-2187): dos caminos al mismo estado.

---

## B. RESPONSABILIDADES (clasificación y propietario futuro)

| Responsabilidad | Clase | Propietario futuro | Regla |
|---|---|---|---|
| Selección de archivo, drag & drop UI | IO/UI | Wizard (paso 1) | presenta |
| Detección de formato (xlsx/xls/pdf/csv) | PARSING | `FormatAdapter.detectFormat` | extrae |
| Lectura workbook/hojas/rango | IO | `ExcelAdapter.extract` | extrae |
| Extracción PDF texto por página | IO | `PdfAdapter.extract` | extrae |
| OCR | PARSING | `PdfAdapter` (NO implementado → UI respeta `UNSUPPORTED`) | extrae |
| Fusión de columnas de código (PUCT multi-col) | NORMALIZATION | `UniversalPlanAnalyzer.detectMultiColumn`/`fuseMultiColumnRow` | analiza |
| Sanitización de códigos (NBSP, ceros, separadores) | NORMALIZATION | `UniversalPlanAnalyzer.sanitizeCode` (con `transformations[]`) | analiza |
| Detección de columnas código/nombre/padre/tipo | ANALYSIS | `UniversalPlanAnalyzer._guessCodeColumn/_guessNameColumn` | analiza |
| Cálculo de nivel | ANALYSIS | Contract (`node.level`), derivado por el analyzer | analiza |
| Cálculo de padre (incl. PAD_TO_BLOCK) | INFERENCE | Contract (`node.parentInfo{method,confidence,evidence}`) | analiza |
| Detección de bloques/jerarquías | ANALYSIS | `UniversalPlanAnalyzer` (SEGMENT_PAD, block signals) | analiza |
| Naturaleza/tipo sugerido | INFERENCE | Contract (`node.nature`, `suggestRootTypes`) + confirmación | declara |
| Reglas dígito→tipo (grupos) | INFERENCE | Derivado: nodos nivel 1 del Contract (nunca un mapa paralelo) | declara |
| Duplicados (exacto/normalizado/conflicto) | VALIDATION | `ImportContractValidator` (BLOCK/REVIEW) | valida |
| Transformaciones auditables | TRANSFORMATION | Contract (`node.transformations`) | declara |
| Reconciliación (dataLoss, silent) | VALIDATION | `UniversalPlanAnalyzer.computeDataLossCounts` | valida |
| Fingerprint del contrato | VALIDATION | `ImportContractSchema.contractFingerprint` | valida |
| Render de preview/estados | PRESENTATION | Wizard renderiza **solo** Contract.nodes | presenta |
| Edición de valores (code/name/type/nivel) | USER OVERRIDE | `UserOverrides` (capa explícita, no muta el Contract) | corrige |
| Confirmación de naturaleza inferida | USER OVERRIDE | `UserOverrides` → `confirmedNatureMap` | corrige |
| Decisión sobre REVIEW/BLOCK | USER OVERRIDE | `UserOverrides` (resolver/descartar explícito) | corrige |
| Perfiles de estructura | USER OVERRIDE | Perfil = presets de overrides + preferencias de extracción | corrige |
| Simulación (payload pre-escritura) | TRANSFORMATION | `CompatibilityAdapter.toBulkPayload` en memoria (nunca POST) | transforma |
| Payload final | TRANSFORMATION | `CompatibilityAdapter.toBulkPayload(EffectiveContract)` | transforma |
| Importación batch + cancel | PERSISTENCE | `POST /api/accounts/bulk` (endpoint existente) | persiste |
| Actualización `code_mask`/`plan_structure` | PERSISTENCE | `PUT /api/companies/:id` post-import (derivado del Contract) | persiste |
| Mensajes accionables por issue | PRESENTATION | UI consume `issue.message`/`evidence` del Contract (no regenera heurísticas) | presenta |
| IA de enriquecimiento | INFERENCE | (futuro, si el orquestador se reactiva; NO es requisito) | — |

**Regla**: no debe existir una segunda inteligencia escondida en React. Toda
decisión de parsing/análisis/validación vive en el engine; el wizard solo
orquesta UI, overrides y persistencia.

---

## C. MATRIZ LEGACY → UNIVERSAL → FUTURO (completa)

| Responsabilidad | Legacy | Universal | Futuro propietario |
|---|---|---|---|
| detect formato archivo | wizard `isExcel/isPDF` (:256) | `FormatAdapter.detectFormat` | FormatAdapter (+CSV) |
| leer workbook | wizard `XLSX.read` (:276) | `ExcelAdapter.extract` | ExcelAdapter |
| extraer PDF | wizard `getTextContent`+agruparY (:287-320) | `PdfAdapter.extract` | PdfAdapter |
| parsear texto PDF → cuentas | `parsePDFText` regex ASFI (:371) | `extractNarrativeAccounts` + regiones | UniversalPlanAnalyzer |
| detectar/merger columnas código | `detectAndMergeColumns` (:573) | `detectMultiColumn`/`fuseMultiColumnRow` | UniversalPlanAnalyzer |
| procesar formato PUCT | `processPUCTFormat` (:450) | pipeline canónico (5-col) | UniversalPlanAnalyzer |
| procesar formato DASH | `processDashFormat` (:540, **pierde filas**) | pipeline canónico + SEGMENT_PAD | UniversalPlanAnalyzer |
| proceso formato genérico | longitudes `(i+1)*2` (:665) | `clusterLengths` + evidencia | UniversalPlanAnalyzer |
| sanitizar códigos | `String().trim()` ad-hoc | `sanitizeCode` auditable | UniversalPlanAnalyzer |
| calcular level | `AccountPlanProfile.calculateLevel` + `getUniversalLevel` (3 rutas) | Contract.node.level | Contract (declarado) |
| calcular parent | `AccountPlanProfile.calculateParent` | `resolveParentReferences`+PAD_TO_BLOCK con evidence | Contract (declarado) |
| detectar bloques (pad-to-block) | no existe | `_padBlockEvidence`/`blockSignal` | UniversalPlanAnalyzer |
| determinar nature/type | `determineType`/`FromNameOnly` keywords (:701-807) | `suggestRootTypes` + node.nature | Contract + override |
| reglas de grupo | `generateGroupRulesFromLevel1` + editor | nivel 1 del Contract | Contract (derivado) |
| detectar duplicados | toast + marca fila (:990,:1009) | `detectIdentityCollisions` + validator | Validator (BLOCK) |
| validar contrato/payload | server devuelve errorCount | `ImportContractValidator.validate` | Validator |
| reconciliar filas | **no existe** | `computeDataLossCounts` | Contract (declarado) |
| auditar transformaciones | **no existe** | `transformations[]` + `sanitizeAuditable` | Contract (declarado) |
| render preview | wizard genera `previewData` | `Contract.nodes` | Wizard renderiza Contract |
| editar fila | `updateAccountField` sin traza | Overrides keyed por uid + valor original | UserOverrides |
| eliminar fila | `deleteAccount` reindexa ids | exclusión explícita por uid (sin reindexar) | UserOverrides |
| bulk type/level | `applyBulkAction` sin traza | overrides en lote con traza | UserOverrides |
| confirmar naturaleza | — | `confirmedNatureMap` | UserOverrides |
| simular import | — | payload en memoria + fingerprint | CompatibilityAdapter |
| import real | `POST /bulk` batches 500 + cancel | ídem, alimentado por Effective Contract | endpoint (intacto) |
| persistir estructura empresa | PUT post-import (:1292) | ídem, derivado del Contract | endpoint (intacto) |
| perfiles | localStorage `struct_profile_*` (:2163-2173) | presets (overrides + extracción) | REDESIGN |
| simulador de códigos | `testCode`+cards (:1739-1763) | preview del split del Contract | REMOVE/equivalente |
| multi-column manual | `multiColumnMode`/`codeColumns` | auto + override de mapping en diagnóstico | REMOVE tras equivalencia |
| IA enriquecimiento | `analyzeWithAI` (inerte) | no-op honesto (sin badge falso) | futuro |
| mensajes de error | `setError` texto libre | issues con mensaje accionable + evidencia | Contract/UI |
| retry | no existe | re-ejecutar extracción/análisis por paso | Wizard |
| PDF worker | CDN (:12) | `?url` local (FormatAdapter) | FormatAdapter |
| máscara `code_mask` | `structureConfig` → `#`.repeat | derivada del Contract (separator/levelLengths) | Contract |

---

## D. IMPORT SESSION — DECISIÓN: SÍ (justificado)

**Decisión explícita**: el objeto superior de la migración será `ImportSession`.

Justificación (con evidencia, no dogma):
1. **Multi-región real**: MEFP-PDF produce 2 regiones (tabla 214 + narrativa
   311) en el mismo archivo (`analyzeCanonicalDocument` devuelve `regions[]`).
   Un solo Contract no puede representar "elegir dataset" sin forzar merge.
2. **Capa de overrides**: los 33 estados del legacy mezclan datos originales,
   datos procesados, decisiones del usuario y UI. Separar
   `Contract original / Overrides / Effective Contract` exige un contenedor.
3. **Ciclo de vida profesional** (PREPARAR→ANALIZAR→VALIDAR→SIMULAR→REVISAR→
   CONFIRMAR→IMPORTAR→RECONCILIAR) mapea 1:1 a una sesión, no a un componente.
4. **Pureza testeable**: `ImportSession` será un módulo **sin React** (Node
   testable), evitando que la lógica de sesión quede atrapada en hooks.

**Forma propuesta** (mínima, sin duplicar inteligencia):

```
ImportSession
├── id                      (uuid para trazabilidad/logs)
├── source                  { fileName, fileType, size, selectedSheet?, pdfRange? }
├── extraction              { doc ref / resumen, confidence, warnings[] }
├── regions[]               [ { regionId, meta (tabla/narrativa/hoja),
│                               contract: ImportContract (INMUTABLE),
│                               validation: { valid, errors[], warnings[] } } ]
├── activeRegionId
├── userOverrides           { uid: { field, value, originalValue, at } },
│                            exclusions: [uid], confirmations: { uid: {nature|review} } }
├── effectiveContract       (derivado puro: contract + overrides - exclusions)
├── simulation              { payload, counts, fingerprint, runAt }  (en memoria)
├── history                 [{ step, at, summary }] (para reconciliación final)
└── result                  { successCount, errorCount, companyPutOk, at }
```

**Dónde vive**: `web-app/client/src/importSession/` con:
`createImportSession.js` (factory + pure updaters: `selectRegion`, `applyOverride`,
`excludeRow`, `confirmNature`, `resolveReview`, `effectiveContractOf`,
`simulate`, `canImport`, `summaryOf`) + `index.js`.
**Qué NO hace**: no parsea, no infiere, no valida por sí mismo — delega en
FormatAdapter/Analyzer/Validator/CompatibilityAdapter (llamadas explícitas del
wizard al transicionar de paso). Es un **contenedor de estado con transiciones
puras**, no un segundo analyzer.

**uid de nodo**: `${regionId}:${nodeIndex}`. Como NO habrá inserción de filas
(solo edición/exclusión), el índice es estable y los overrides no se corrompen
al excluir filas (las exclusiones no renumera; el payload final las omite).

---

## E. STATE MODEL DEL NUEVO WIZARD

El componente tendrá **estados de UI** + **una sola `ImportSession`**.
Nada de `rawData` + `previewData` + `processedData` + `analysis` simultáneos:
todo dato derivado sale de `session` por funciones puras (memoizadas si hace
falta rendimiento con 6k cuentas).

| Estado de UI | Propósito |
|---|---|
| `session` | el modelo central (D) — único estado "de dominio" |
| `uiStep` | 1..6 (paso visible) |
| `submitting`/`progress`/`cancelToken` | importación (KEEP del legacy :78-80) |
| `currentPage`/`selectedIds`/`bulkType`/`bulkLevel` | tabla (KEEP del legacy :77-89) |
| `activeTab` (issues/transformaciones/rechazadas/preview) | dentro de pasos |
| `showAdvancedStructure` | editor avanzado colapsable (MERGE de refinePanel+3.5) |
| `modal` (biblioteca perfiles) | reutiliza NexusModal |

Derivados (funciones puras, nunca estados): `effectiveContract`,
`issuesBySeverity`, `summary` (conteos), `payload`, `canImport`.

Dato que la UI realmente necesita (demostrado en el legacy): solo columnas de la
tabla (code/name/type/level/parent+`parentInfo`), estado por fila
(VALID/REVIEW/BLOCKED/REJECTED/excluida), issues con severidad, transformaciones
de la fila, y conteos. Todo existe en el Contract o es derivable; por eso 33
estados colapsan a ~9 de UI + 1 sesión.

---

## F. UX — PASOS DEFINITIVOS (6)

Se adopta la secuencia propuesta SIN fusionar (cada paso responde una pregunta
del usuario; fusionar Validación con Revisión mezclaría "qué está mal" con
"cómo lo arreglo" — y la simulación debe poder re-ejecutarse tras overrides):

```
1 ARCHIVO          ¿qué archivo? → extracción → regiones detectadas
2 DIAGNÓSTICO      ¿qué encontró el sistema y qué tan seguro está?
3 VALIDACIÓN+SIM   ¿qué problemas hay? → tab de simulación (payload pre-escritura)
4 REVISIÓN         ¿qué corrijo? (overrides explícitos con traza)
5 RESUMEN          reconciliación visual + fingerprint + gate silent=0/unaccounted=0
6 CONFIRMACIÓN     "estos son los datos que se enviarán" → importar → resultado
```

Barra de pasos con estados (actual/completado/bloqueado). Navegación hacia
atrás libre; hacia adelante con **gates** (ver F.1). Tras la importación:
pantalla de resultado (success/errorCount/companyPutOk) y botones "Importar
otro archivo" / "Cerrar" (retry implícito del flujo completo).

### F.1 Gates de navegación (regla de negocio, no capricho de UI)

| De → A | Condición |
|---|---|
| 1 → 2 | extracción terminó con ≥1 región utilizable |
| 2 → 3 | diagnóstico aceptado (mapping ok o corregido; REQUIRES_CONFIRMATION visibles) |
| 3 → 4 | (libre; los issues se resuelven en 4) |
| 4 → 5 | sin BLOCK sin resolver; REVIEW resueltos o confirmados explícitamente |
| 5 → 6 | `silentCorruptionCount === 0 && unaccountedRows === 0` (si no: bloqueado con mensaje) |
| 6 → import | BLOCK=0; REVIEW=0 sin resolver; UNKNOWN sin confirmar no se postea (se excluye o se confirma); botón "Confirmar e Importar" |

---

## G. KEEP (conservar tal cual o con adaptación mínima)

1. `performImport` completo (:1209-1335): batches 500, lectura real de
   successCount/errorCount, CancelToken, PUT `/api/companies` **post-import**,
   toasts reales, `onSuccess()`/`onClose()`.
2. Callbacks del contrato de montaje: `<SmartImportWizard onClose onSuccess>`
   (Accounts.jsx:376 intacto; el punto de montaje solo gana el feature flag).
3. UI de tabla: paginación (:2373-2389), selección (:2427-2449), bulk bar
   (:2393-2422), celdas editables (:2452-2459), delete (:2461), estilos y
   badges existentes.
4. Progress bar + botón cancelar (:2472-2495).
5. Selector de hoja Excel y rango de filas/páginas (convertido en "opciones de
   extracción" del paso 1).
6. ACCOUNT_TYPES (:14-26) como catálogo canónico de tipos del dominio.
7. `getTypeInfo` (:1420).
8. Patrones visuales: NexusModal, toasts, alert-info de contexto, glass panels.
9. Actualización `code_mask`/`plan_structure` — semántica intacta, fuente
   derivada del Contract (mask/regex/levels/behavior).

## H. REPLACE (reemplazado por el engine)

| Legacy | Reemplazo |
|---|---|
| lectura workbook/hoja (:95-181 salvo UI rango) | `ExcelAdapter.extract` |
| parseo PDF (:287-434) | `PdfAdapter.extract` (+worker local) |
| `detectAndMergeColumns`/`processPUCTFormat`/`processDashFormat` (:450-671) | pipeline canónico (multi-región, sin pérdida silenciosa) |
| `determineType`/`FromNameOnly` (:701-807) | `suggestRootTypes` + Contract.nature |
| `generateGroupRulesFromLevel1` (:809-914, con stale-closure) | nodos nivel 1 del Contract |
| `generatePreview` (:946-1140) | pipeline File→Canonical→Analysis→Contract→Validator |
| `analyzeWithAI` (:917-944) | sin llamada (o futuro orquestador sano) |
| `getUniversalLevel` (:28-52) + recálculo en import (:1230-1256) | nivel/padre/tipo vienen del Contract; payload final del CompatibilityAdapter |
| preview/edición sobre `previewData` | Contract.nodes (render) + overrides (edición) |

## I. MERGE (fusionado, no duplicado)

1. Editores de estructura **3.5 + panel Entrenar** (:1582-1819 + :1927-2187)
   → un único "Editor avanzado de estructura" colapsable (en Diagnóstico),
   que modifica **config de análisis de la región** y re-ejecuta el contrato
   (re-análisis local explícito, no segunda inteligencia).
2. `planAnalysis`+`structureConfig` → `region.meta.structure` (mask, levels,
   separator, behavior) derivado del Contract; la UI lo muestra, no lo calcula.
3. `range`/`pdfRange` → opciones de extracción del paso 1 (sin cambiar
   semántica de "qué filas/páginas proceso").
4. `error` global + issues → panel de issues con severidades (ERROR pasa a
   issue BLOCK contextual del paso donde ocurrió).
5. Perfiles → presets (D.§19).
6. Duplicados toast (:1021-1039) → issues del Validator (BLOCK/REVIEW reales
   con filas afectadas), conservando el aviso amistoso.

## J. REMOVE (con evidencia de muerte/reemplazo)

| Elemento | Evidencia |
|---|---|
| `autoDetectColumns` (:673) | única aparición = definición (grep verificado) |
| `fileType` (:64,:269,:272) | seteado 2×, nunca leído |
| imports `useEffect`/`useRef` (:1) | cero usos en el archivo |
| `columnMapping.type` | solo la escribe la función muerta |
| `testCode` + simulador (:1739-1763) | equivalente = split del Contract en Diagnóstico (§20) |
| `multiColumnMode`/`codeColumns` manual (:185-247) | tras demostrar equivalencia (§18) |
| editor de reglas dígito→tipo (:2272-2370) y estados asociados | nivel 1 del Contract + override por tipo |
| `level1Accounts` como estado | derivado |
| worker PDF por CDN (:12) | worker local `?url` |
| `prompt()` (:2163) | NexusModal de perfil |
| badge "IA Activa" (:1849) | inerte (analyzeWithAI 404 en runtime) |
| `originalData` como duplicado | CanonicalDocument es la evidencia única |
| segundo editor de estructura (:1927-2187) | duplicado de 3.5 (MERGE en I.1) |

## K. NEW

1. `importSession/` (D) + updaters puros.
2. Pasos 1-6 (F) como componentes finos (L).
3. Panel de **diagnóstico**: columnas detectadas, confidence, ambigüedad,
   regiones, `REQUIRES_CONFIRMATION` visibles, transformaciones de muestra.
4. **Issues UI**: tabla de issues con severidad, mensaje accionable, filas
   afectadas, evidencia del Contract (sin heurística nueva en React) y botón
   "ir a revisión".
5. **Transformaciones panel** (por fila: raw→normalized + motivos).
6. **Reconciliación visual** (paso 5): Total/Válidas/Rechazadas/Bloqueadas/
   Review/Warnings/Excluidas + `silentCorruptionCount`/`unaccountedRows`
   con gate = 0.
7. **Resumen de importación**: "Importar otro archivo" (retry real del flujo).
8. `confirmedNatureMap` wiring (overrides → payload).
9. Capa `UserOverrides` con traza (original → valor → at) — sin inventar
   auditoría de usuario (no hay infra de login por usuario: se registra
   `at` y `sessionId`, no identidad).
10. Botón "usar asistente clásico" (fallback manual) + banner de modo.

---

## L. COMPONENT ARCHITECTURE (propuesta, sin inflar)

```
src/importSession/            (lógica pura, sin React — testeable en Node)
├── index.js                  createImportSession, selectRegion, applyOverride,
│                             excludeRow, confirmNature, effectiveContractOf,
│                             simulate, canImport, summaryOf, applyExclusions
src/components/import/
├── SmartImportWizard.jsx     ORQUESTADOR: session + uiStep + gates + montaje
│                             (mantiene el nombre exportado; contenido nuevo)
├── ImportFileStep.jsx        archivo + extracción + regiones (reusa picker legacy)
├── ImportDiagnosticStep.jsx  columnas/confidence/ambigüedad/transformaciones
├── ImportValidationStep.jsx  issues por severidad + tab Simulación
├── ImportReviewStep.jsx      tabla editable + panel de overrides + editor avanzado
├── ImportSummaryStep.jsx     reconciliación + fingerprint
├── ImportConfirmationStep.jsx barrera final + progress/cancel + resultado
├── ImportIssuesTable.jsx     issues accionables (mensajes del Contract)
├── ImportPreviewTable.jsx    tabla con paginación/selección/bulk (reusada de legacy)
├── ImportTransformationsPanel.jsx
├── ImportConfidencePanel.jsx
└── ImportStructureEditor.jsx editor avanzado único (MERGE 3.5+refine)
```

No se crean componentes sin evidencia: los paneles coinciden 1:1 con
información que el legacy ya mostraba o con NEW necesario. Se reutilizan
NexusModal, ToastProvider y utilidades de estilo existentes. No hay páginas
nuevas; el montaje sigue en Accounts.jsx.

---

## M. DATA FLOW (definitivo)

```
File (.xlsx/.xls/.xlsm/.pdf/.csv)
  → FormatAdapter.extractDocument (detectFormat; worker pdfjs local)
  → CanonicalDocument            (evidencia: rows/headers/rawValues/formatted)
  → UniversalPlanAnalyzer.analyzeCanonicalDocument
  → ImportAnalysis { regions[] } (regiones: tabla/narrativa/hoja)
  → por región: ImportContract   (nodes: code/name/level/parent/nature/
                                  transformations/dataLoss — DECLARACIÓN)
  → ImportContractValidator.validate
  → UI (Diagnóstico/Validación/Revisión) renderiza el Contract; nunca re-analiza
  → UserOverrides (edición/confirmación/exclusión — traza)
  → Effective Contract (derivado puro)
  → Validator sobre Effective (gate BLOCK/REVIEW/UNKNOWN)
  → Simulation: CompatibilityAdapter.toBulkPayload (en memoria; sin POST)
  → Resumen (reconciliación; silent=0 ∧ unaccounted=0)
  → Confirmación explícita
  → POST /api/accounts/bulk (batches 500 + cancel)   [endpoint intacto]
  → éxito → PUT /api/companies/:id (code_mask/plan_structure del Contract)
  → Resultado (success/error/counts) + onSuccess()/onClose()
```

---

## N. FEATURE FLAG (diseño exacto)

Cliente puro (no requiere config de build ni server):

```
clave:      localStorage 'importEngine'
valores:    'legacy' (DEFAULT) | 'universal'
override:   ?engine=universal|legacy en la URL (dev/test, gana sobre localStorage)
módulo:     src/components/import/engineFlag.js
            export function getImportEngineMode() → 'legacy'|'universal'
            export function setImportEngineMode(mode)
            export function isUniversalEnabled() (consume + escucha storage)
montaje:    Accounts.jsx (único punto): si universal → <UniversalImportWizard>
            (componente nuevo); si legacy → <SmartImportWizard> intacto.
            NUNCA se montan ambos a la vez.
```

Primera fase de validación: `universal` solo accesible por URL param en entorno
controlado (no se anuncia en UI hasta la etapa (b) del plan U).

## O. LEGACY FALLBACK (cuándo y cómo)

- **Automático**: si el modo `universal` lanza error inesperado en extracción/
  análisis (exception no controlada, no un issue del validador), el orquestador
  captura, registra `console.error` + toast "El nuevo asistente encontró un
  problema; abriendo el clásico", y monta el legacy con el archivo ya cargado
  si es posible (o simplemente lo abre en paso 1). `legacyFallback = true`.
- **Manual**: botón "Usar asistente clásico" visible en el footer del wizard
  universal (persiste la preferencia en `importEngine='legacy'`).
- **Por regresión detectada** (si el shadow comparison en harness marcara
  REGRESSION/UNKNOWN en el corpus): se revierte el flag global antes de
  anunciar la feature (rollback = 1 línea en localStorage default).
- El legacy **nunca se elimina** hasta cumplir U-etapa (c).

## P. SHADOW COMPARISON (cómo se hará)

Se comparará **en el harness/suites**, no como segunda inteligencia en
producción:

1. **Differential de corpus (offline, ya existente y ampliable)**: mismo
   archivo → `AccountPlanProfile.analyze` (replicando legacy con config por
   defecto) vs `UniversalPlanAnalyzer` → clasificar por fila:
   SAME / IMPROVEMENT (dangling parents resueltos, filas que legacy perdía) /
   INTENTIONAL_CHANGE (documentado) / REGRESSION / UNKNOWN. Ya hay evidencia:
   DASH = 0 diffs level/name + 226 parents legacy dangling → universal 0.
2. **Browser E2E dual**: `e2e-harness.html` procesa el mismo archivo con ambos
   pipelines y reporta el diff por campo (code/name/level/parent/type/count/
   rejected). Los resultados se archivan en la suite (nunca se ocultan).
3. **Runtime**: NO se ejecuta el legacy dentro del wizard universal (duplicaría
   inteligencia). En su lugar, el wizard expone los checks internos del
   Validator + fingerprint, y el botón "clásico" permite al usuario comparar
   visualmente en la misma sesión de navegador si lo desea (apertura manual
   del legacy con el mismo archivo).
4. **Clasificación de decisiones**: toda diferencia legacy vs universal se
   clasifica con una de las 5 etiquetas en los artefactos de la suite; si
   aparece REGRESSION o UNKNOWN → fallback (O) y bloqueo de activación.

## Q. REGRESSION STRATEGY

1. **Baseline congelada** (`UNIVERSAL_IMPORT_ENGINE_BASELINE.md`): cualquier
   cambio del engine exige `npm test` verde (4 suites + Browser E2E).
2. **Legacy intocable** durante la migración: `SmartImportWizard.jsx` (v1)
   se congela con un commit snapshot; si se detecta un bug legacy se arregla
   en el universal y se documenta (no se patchea el legacy salvo severidad
   crítica en producción).
3. **Differential suite** se ejecuta en cada commit de la migración (P).
4. **Gates por commit** (U): cada commit mantiene build verde, `npm test`
   verde y legacy funcional (el flag nunca cambia de default hasta (b)).
5. **Rollback**: revertir flag = 1 línea; los commits de implementación son
   aditivos (componentes nuevos + flag), nunca destructivos.

## R. TEST STRATEGY (tests nuevos del wizard)

1. **Unit (Node, suites del engine)**: `importSession` (factory, applyOverride,
   excludeRow sin reindexar, effectiveContractOf, canImport, summaryOf);
   purezas: mismos inputs → mismo estado.
2. **Differential corpus**: ampliar `shadow_tests.mjs` para clasificar
   SAME/IMPROVEMENT/REGRESSION/UNKNOWN en TODO el corpus (hoy parcial).
3. **Contract-level**: reutilizar adversarial (42) + negativos (7) ya
   existentes como red de seguridad del wizard (los consume vía API).
4. **Simulación**: `toBulkPayload(effective)` nunca dispara red (monkey-patch
   axios en test) — verificación "sin POST en shadow".
5. **Gates**: unit de `canImport` con matrices BLOCK/REVIEW/UNKNOWN.

## S. E2E STRATEGY (flujos a probar en navegador, harness existente)

1. Excel PUCT5C completo: archivo→diagnóstico→validación→resumen→(simulación
   shadow; sin POST en CI).
2. PDF MEFP multi-región: elección de región tabla vs narrativa.
3. Archivo con duplicados (VARLEN/PUCT5C): BLOCK visible con filas; no se
   puede confirmar sin resolver.
4. Edición manual: change type → override registrado → effectiveContract
   cambia → payload refleja el cambio (mutation-check, patrón ya probado en el
   engine).
5. Cancelación de import y re-intento.
6. Fallback: forzar exception en universal → legacy montado.
7. DASH: comparar con legacy (P) en el propio harness.
Cada flujo verifica `__E2E_RESULTS__` con `silent=0 unacc=0`.

## T. ACCESSIBILITY / UX (criterios)

- Mensajes accionables (nunca "ERROR" pelado): ver §25 del enunciado; la UI
  consume `issue.message`, `issue.evidence`, filas afectadas.
- No depender solo del color: severidad = color + icono + etiqueta de texto.
- Botones con `disabled` correcto según gates (F.1) + `title` explicando por qué.
- Loading explícito en extracción/análisis/import (spinner + texto de fase).
- Feedback tras cada acción (toast) y tras import (resumen de resultado).
- Tabla navegable (teclado), foco razonable (NexusModal ya lo aporta),
  contraste mantenido con la paleta actual.
- Vocabulario contable: "Cuenta", "Padre", "Nivel", "Naturaleza",
  "Duplicado", "Bloqueado", "Requiere revisión" — no términos de engine.
- El usuario siempre puede responder: qué encontró / qué está mal / qué
  corrijo / qué pasará si continúo.

---

## U. MIGRATION PLAN (orden exacto, commits pequeños y reversibles)

Cada commit: build verde, `npm test` verde, legacy intacto, flag default
`legacy`.

| # | Commit propuesto | Contenido | Gate de salida |
|---|---|---|---|
| 1 | `feat(import): ImportSession — factory, overrides, effective contract, summary (puro, sin React)` | `src/importSession/*` + unit suite en `scripts/` (o junto a suites) | npm test verde |
| 2 | `feat(import): UniversalImportWizard paso 1-2 (archivo+diagnóstico) conectado al engine en shadow` | componente nuevo montado SOLO por `?engine=universal`; extracción+análisis+diagnóstico UI; cero POST | build + npm test + E2E manual |
| 3 | `feat(import): paso 3 validación + simulación (issues, severidades, payload en memoria, fingerprint)` | panel issues + tab simulación | gates F.1 |
| 4 | `feat(import): paso 4 revisión — tabla reutilizada, overrides con traza, editor avanzado único` | edición/exclusión/confirmación de natures vía UserOverrides | mutation-check payload |
| 5 | `feat(import): pasos 5-6 resumen + confirmación — reconciliación visual, gates, import real + PUT estructura` | wiring `performImport` (KEEP) sobre Effective Contract + resultado post-import | import real en empresa desechable OK |
| 6 | `feat(import): feature flag importEngine (legacy default) + fallback manual/automático + banner` | `engineFlag.js` + montaje en Accounts.jsx | flag legacy = comportamiento idéntico |
| 7 | `test(import): shadow comparison corpus legacy vs universal (SAME/IMPROVEMENT/REGRESSION/UNKNOWN) + E2E dual del harness` | ampliar suites | 0 REGRESSION en corpus |
| 8 | `feat(import): retirar dead code del wizard legacy (fileType, autoDetectColumns, imports muertos, prompt, worker CDN)` | limpieza con evidencia J | build + npm test |
| 9 | (decisión negocio) `feat(import): default universal con enlace "asistente clásico"` | cambiar default tras validación controlada | 30 días sin incidentes |
| 10 | (decisión negocio) `refactor(import): eliminar wizard legacy y rutas muertas de AccountPlanProfile usadas solo por él` | SOLO tras U-9 y cobertura | corpus + npm test |

Nota: 8 puede adelantarse a cualquier punto (es independiente). 9-10 son
decisiones de negocio posteriores, NO parte de esta fase.

---

## V. FILES TO MODIFY (durante la implementación, NO ahora)

```
web-app/client/src/importSession/*            (nuevo — lógica pura)
web-app/client/src/components/import/*        (nuevo — pasos y paneles)
web-app/client/src/components/import/engineFlag.js  (nuevo)
web-app/client/src/pages/Accounts.jsx         (solo el montaje condicional + flag)
web-app/client/src/components/SmartImportWizard.jsx  (v2 = orquestador nuevo que
                     reemplaza al actual SOLO al final del plan, o se crea
                     UniversalImportWizard.jsx y el legacy queda intacto)
scripts/*                                      (suites nuevas: importSession,
                     differential corpus ampliado, E2E dual)
web-app/client/e2e-harness.html               (modo dual legacy/universal)
package.json (si se agrega suite) · UNIVERSAL_IMPORT_ENGINE_BASELINE.md (actualizar resultados) · ARCHITECTURE.md/AGENTS.md (estado)
```

Decisión de diseño: **crear `UniversalImportWizard.jsx` como componente nuevo**
y dejar `SmartImportWizard.jsx` intacto hasta U-10. Así el legacy es el
fallback real y cada commit es aditivo.

## W. FILES TO PRESERVE (intactos)

```
web-app/server/routes/accounts.js  (endpoint /bulk — NO se toca salvo
                                    incompatibilidad real demostrable)
web-app/server/routes/companies.js · web-app/server/db.js ·
web-app/server/db/schema.sql       (DB intacta)
ai_adjustment_engine.py y zona IA  (intacta)
web-app/client/src/utils/AccountPlanProfile.js  (SÍ lo usan en producción:
   FinancialStatementEngine.analyze → reportes reales; UniversalPlanAnalyzer
   consume calculateLevel/analyze/proposeStructure/getDefaultProfile/
   heuristicTypeGuess; el wizard lo usa para ASFI_PATTERNS/calculateLevel/
   Parent/mergeConfigWithAnalysis/toConfigFromAnalysis). NO se elimina; al
   final solo se podan las funciones cuyo ÚNICO consumidor era el wizard
   (demostrado por grep, no por intuición)
web-app/client/src/utils/UniversalPlanAnalyzer.js · FormatAdapter.js ·
ImportContractSchema.js · ImportContractValidator.js · CompatibilityAdapter.js
· CanonicalDocument.js            (engine — INTOCABLE salvo Fase 7 futura)
web-app/client/src/components/SmartImportWizard.jsx  (v1 congelado hasta U-10)
```

## X. RISKS

| Riesgo | Prob. | Mitigación |
|---|---|---|
| El wizard nuevo "re-analiza" (viola la regla de oro) | media | ImportSession sin lógica; revisión de código: los únicos imports de engine están en el orquestador |
| Pérdida de capacidades legacy (config manual fina, PUCT multi-col manual) | media | editor avanzado (MERGE I.1); equivalencia multi-col demostrada ANTES de REMOVE (§18) |
| PGC/Hoja6 PARTIAL mal representado | baja | el paso Diagnóstico declara SUPPORTED/PARTIAL/UNSUPPORTED/UNVERIFIED por región (nunca se finge soporte) |
| Payload distinto al que espera /bulk | baja | production_gate (validación del contrato del payload) + E2E de import real en empresa desechable |
| Regresión silenciosa en corpus | baja | differential suite en cada commit (Q/P) |
| Tiempo de extracción/análisis en UI (6k filas ok; 100k lento) | baja | región real ≤6k; spinner de fase; worker/async |
| Dependencia de comportamiento exacto de legacy mal entendido | baja | auditoría con línea exacta (A) + flujos mapeados (A.4) |
| Usuarios confundidos por dos asistentes | media | default legacy hasta (b); banner de modo; enlace "asistente clásico" claro |
| localStorage flag fragmentado entre navegadores/empresas | baja | flag global de cliente; override por URL para test |

---

## VEREDICTO

```
PHASE 6 VERDICT

ENGINE BASELINE:
FROZEN

WIZARD AUDIT:
COMPLETE
   — 2512 líneas auditadas; 33 estados clasificados (11 KEEP, 9 REMOVE-dead
     verificados, resto MERGE/REPLACE); 31 handlers verificados por grep
     (1 muerto: autoDetectColumns); 3 flujos principales mapeados + gaps
     GAP-1..9 documentados con línea exacta.

ARCHITECTURE:
READY
   — ImportSession: SÍ (decisión D, multi-región real MEFP).
   — Responsabilidades: tabla B completa; regla de oro §36 obligatoria.
   — Fuente única de verdad: CanonicalDocument = evidencia; ImportContract
     (por región) = declaración editable vía UserOverrides (nunca mutado);
     Effective Contract = derivado; Validator; Payload del CompatibilityAdapter.

MIGRATION PLAN:
READY
   — 10 commits (U), aditivos, reversibles, con gates por commit.
   — Flag importEngine (N): default legacy; fallback (O); shadow comparison
     en harness/suites (P) — nunca segunda inteligencia en runtime.
   — AccountPlanProfile PRESERVED (producción: FinancialStatementEngine).

IMPLEMENTATION:
NOT STARTED

LEGACY:
PRESERVED

PRODUCTION:
UNCHANGED

DATABASE:
UNCHANGED

IA:
UNCHANGED

NEXT COMMIT:
  feat(import): ImportSession — factory, overrides, effective contract,
  summary y gates (puro, sin React, con suite Node propia)
  — primer commit del plan U, cero impacto en producción.
```

Nota de estado: el repo está en `a94d861` (los commits `1663a51` diseño v1 +
`a94d861` versionado de engine/corpus se agregaron después de `10a328e`);
este documento reemplaza al diseño v1 con la versión definitiva auditada.
