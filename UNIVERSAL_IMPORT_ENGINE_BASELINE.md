# UNIVERSAL_IMPORT_ENGINE_BASELINE

> Baseline congelada del motor universal de importación de planes de cuentas.
> Fecha de congelación: 2026-09-04. Commit de referencia: (ver git log).
>
> Cualquier cambio posterior al engine DEBE demostrar `no regression` contra
> esta baseline ejecutando `npm test` completo.

## Versiones

| Componente | Versión |
|---|---|
| `analyzerVersion` (`UniversalPlanAnalyzer.js`) | 2.1.0 |
| `contractVersion` / `schemaVersion` (`ImportContractSchema.js`) | 1.0 |
| `VALIDATOR_VERSION` | 1.0 |
| Pipeline | File → FormatAdapter → CanonicalDocument → UniversalPlanAnalyzer → ImportContract → ImportContractValidator → CompatibilityAdapter → payload `/bulk` |

## Corpus de pruebas (golden + adversarial + E2E real)

- **Excel**: PUCT 5-col (2217 nodos), PUCT9/Hoja4 (2217), Hoja1 dual-code (586),
  DASH/Hoja2 (235), VARLEN/Hoja5 (577), PGC/Hoja6 (886 vía parser de columna
  única), ASFI (2859).
- **PDF**: MEFP PlanDeCuentasPublicacionVer5 (págs 6-16: 214 tabla + 311 narrativa),
  Clasificadores Presupuestarios 2026 (págs 22-49).
- **TXT (verdad de tierra)**: MEFP 979 cuentas, Clasificadores 2789 — recall 100%.
- **Adversarial sintético**: 42 casos (outliers, ciclos, huérfanos, dual-code,
  ceros iniciales, NBSP, separadores mixtos, merged, hidden, corruptos...).
- **Negativos E2E**: self-parent, múltiples padres, missing parent, vacío,
  corrupto, formato no soportado, naturaleza UNKNOWN, pad-to-block rechazado.

## Resultados de la baseline

| Suite | Resultado |
|---|---|
| `benchmark_adversarial.mjs` | 42/42 PASS |
| `shadow_tests.mjs` | 68/68 PASS |
| `contract_audit.mjs` | 42 PASS / 0 FAIL |
| `production_gate.mjs` | 51 PASS / 0 FAIL / 0 UNVERIFIED (incluye Browser E2E real) |
| Browser E2E real (Edge headless vía CDP) | 6 PASS / 0 FAIL (5 SUPPORTED, PGC PARTIAL) |
| Build cliente | PASS |

## Invariantes (deben permanecer)

1. `silentCorruptionCount === 0` — ninguna transformación sin traza.
2. `dataLoss.unaccountedRows === 0` — cada fila termina en UNA categoría
   (VALID / REVIEW / BLOCKED / REJECTED / IGNORED) sin doble conteo.
3. `rawCode` conservado + `transformations[]` obligatoria si raw ≠ norm.
4. Fingerprint canónico determinista (orden-insensible, sin timestamps).
5. Idempotencia: mismo archivo + mismo mapping → mismo contrato.
6. BLOCK gate: ningún error BLOCK llega al payload `/bulk`.
7. Pad-to-block con evidencia (≥1 hermano o jerarquía de longitud compatible);
   `parentInfo{code,method,confidence,evidence,requiresReview}` siempre presente.
8. Naturalezas INFERRED → `requiresConfirmation=true`; jamás certeza inventada.
9. Shadow mode: cero escrituras (sin POST/PUT/INSERT/UPDATE/DELETE).
10. Architecture boundaries: analyzer/validator/adapter sin xlsx/pdfjs/DB/React;
    analyzer solo consume CanonicalDocument.

## Limitaciones conocidas (documentadas, NO fallos silenciosos)

1. **PGC/Hoja6 en flujo canónico automático = PARTIAL**: requiere parser de
   columna única ("N. Nombre."), ya implementado y probado en Node (886 cuentas),
   pero no auto-seleccionado por `analyzeCanonicalDocument`.
2. **SheetJS CE no persiste `!cols[].hidden` al re-escribir** (metadata de
   columnas ocultas se pierde en write/read) — el adapter la preserva en
   memoria, la limitación es del parser.
3. **Ceros iniciales**: si Excel guardó "001" como número sin formato, los
   ceros YA NO existen en el archivo. El adapter lo documenta
   (`leadingZeroCoerced`/`formattedValue`), no lo finge.
4. **PDF/OCR**: no hay OCR implementado. PDFs escaneados sin texto →
   `EXTRACTION_LOW_CONFIDENCE` + revisión, nunca auto-import.
5. **Duplicados reales en archivos del corpus** (DASH: 1, VARLEN: 5,
   PUCT5C: 5, Hoja1: 60): política = BLOCK (gate), con traza `duplicateCode`.
6. **Performance**: 100k filas ≈ 68s (PERFORMANCE WARNING documentado);
   caso de uso real ≤ 6k cuentas ≈ segundos.
7. **MEFP con sets mínimos**: sin hermanos no se infiere pad-to-block
   (conservador: requiere evidencia documental).

## Política de duplicados (Fase 5, conclusión del corpus real)

- A duplicado exacto → **BLOCK** (hay 11 en el corpus: errores de datos reales).
- C normalizado conflicto (nombre/padre/tipo distinto) → **BLOCK**.
- D mismo significado → **REVIEW → DEDUPLICATE** con evidencia (no silencioso).
- E nombre distinto mismo código → **BLOCK**.
- F padre distinto mismo código → **BLOCK**.
- G duplicado entre regiones/tablas → decisión por región en ImportAnalysis.
- Regla: **nunca deduplicar silenciosamente datos contables**.

## Decisiones arquitectónicas

- `ImportAnalysis` (multi-región) cubre multitabla: cada región produce un
  `ImportContract` y el usuario elige cuál importar (evidencia: MEFP-PDF
  produce 2 regiones — tabla + narrativa).
- `CompatibilityAdapter` es transformación MECÁNICA (prueba de mutación:
  mutar level/parent/type del contrato → payload refleja exactamente la
  mutación, sin recálculo).
- Separación estricta SIMULATION (en memoria, sin DB) vs IMPORT (payload →
  `/api/accounts/bulk` con gate).
