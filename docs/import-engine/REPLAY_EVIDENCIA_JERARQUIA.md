# Replay de evidencia jerárquica

Estado: corrección arquitectónica local lista para revisión/commit. U-9 continúa pausado. No se habilitan Etapa 2, U-10, cambio de default ni retiro del importador legacy.

## Causa raíz y corrección

El analizador reutilizaba `clusterLengths()` para producir anchos físicos y los trataba como profundidades jerárquicas. En códigos de ancho fijo, `[6]` podía convertirse en un nivel lógico único. Además, las columnas fuente `NIVEL`/`PADRE` y parte de la procedencia espacial del PDF podían perderse antes de construir y validar el contrato. El validador no podía detectar evidencia descartada antes de recibirla, y `deriveCompanyStructure()` podía persistir una máscara falsa como `######` con un nivel.

La versión revisada separa ancho físico, profundidad lógica, aristas explícitas, inferencias y procedencia. Se usa Analyzer 2.3.0 y contrato v1.1. Las coordenadas PDF se preservan como procedencia, pero no se convierten en niveles.

## Política de evidencia

- `observedCodeLengths` solo describe largos observados de códigos. `logicalLevelLengths` existe únicamente cuando la jerarquía codificada es demostrable; no se obtiene de un ancho único.
- `sourceLevel` y `sourceParent` se preservan, sin reemplazarlos por `inferredLevel` o `inferredParent`. La detección de columnas acepta encabezados normalizados equivalentes a nivel/level/lvl/jerarquía y padre/parent/cuenta padre/código padre, sin excepciones por archivo.
- Un padre explícito define la arista; un nivel explícito define la profundidad. Una incompatibilidad estructural explícita bloquea o requiere revisión conforme a la regla del contrato, sin reescribir los valores fuente.
- Con nivel explícito y sin padre: se prefiere el padre estructural materializado cuyo nivel fuente sea exactamente `N-1`. En ausencia de esa evidencia, solo se asigna el único candidato anterior de nivel `N-1`. Candidato ambiguo, ausente o contradictorio deja el padre nulo y requiere revisión.
- Sin evidencia suficiente, la jerarquía permanece desconocida. Una acción independiente `FLAT_ALL_LEVEL_1` confirma un plan realmente plano; no es equivalente a aceptar avisos, resolver filas o confirmar naturaleza. Las revisiones de normalización siguen bloqueando.
- `deriveCompanyStructure()` omite la persistencia si solo conoce el ancho físico o si la estructura no puede representarse con seguridad. Una confirmación plana sí permite declarar un único nivel. La jerarquía explícita fixed-width no se convierte en una máscara multinivel inventada.

## Replay del corpus

Los conteos de `sourceLevel`/`sourceParent` son valores fuente presentes; los de inferencia son valores derivados no nulos. “Padres materializados” cuenta aristas efectivas en el contrato. REVIEW distingue alertas de contrato y nodos marcados para revisión; una marca puede resolverse mediante una decisión explícita. `canImport` y `simulation` reflejan el estado base, salvo que se indique la acción aplicada. Payload es el tamaño JSON medido en bytes e incluye `companyId: "c1"` en los casos indicados.

| Corpus | Filas / nodos | sourceLevel / sourceParent | inferredLevel / inferredParent | Niveles efectivos | Padres materializados | BLOCK | REVIEW alertas / nodos |
|---|---:|---:|---:|---|---:|---:|---:|
| PUCT5C | 2217 / 2217 | 0 / 0 | 2217 / 2212 | 1:5, 2:15, 3:54, 4:464, 5:1679 | 2212 | 1 | 0 / 5 |
| DASH | 235 / 235 | 0 / 0 | 235 / 226 | 1:9, 2:29, 3:197 | 226 | 1 | 0 / 9 |
| ASFI | 2859 / 2859 | 0 / 2850 | 2859 / 0 | 1:9, 2:66, 3:327, 4:1541, 5:911, 6:5 | 2815 | 0 | 36 / 35 |
| VARLEN | 577 / 577 | 0 / 0 | 577 / 567 | 1:5, 2:26, 3:90, 4:195, 5:261 | 567 | 5 | 0 / 10 |
| MEFP, PDF (379) | 379 / 379 | 0 / 0 | 379 / 370 | 1:7, 2:27, 3:114, 4:134, 5:97 | 370 | 0 | 0 / 9 |
| APS, PDF (67) | 67 / 67 | 0 / 0 | 67 / 61 | 1:4, 2:4, 3:11, 4:14, 5:14, 6:20 | 61 | 0 | 0 / 6 |
| CSV limpio | 3 / 3 | 0 / 0 | 3 / 2 | 1:1, 2:1, 3:1 | 2 | 0 | 0 / 1 |
| CSV fixed-width + NIVEL | 3 / 3 | 3 / 0 | 0 / 2 | 1:1, 2:1, 3:1 | 2 | 0 | 0 / 0 |
| Flat fixed-width sin confirmar | 3 / 3 | 0 / 0 | 0 / 0 | Desconocidos | 0 | 0 | 3 / 3 |
| Flat fixed-width confirmado | 3 / 3 | 0 / 0 | 0 / 0 | 1:3, por decisión `FLAT_ALL_LEVEL_1` | 0 | 0 | 3 / 3, resueltos por confirmación plana |
| Fixture sintético 313 | 313 / 313 | 313 / 312 | 0 / 0 | 1:1, 2:78, 3:78, 4:78, 5:78 | 312 | 0 | 0 / 0 |

| Corpus | Validator | canImport / simulation | Pérdida silenciosa / filas sin contabilizar | observedCodeLengths | logicalLevelLengths | companyStructure / máscara | Payload |
|---|---|---|---|---|---|---|---:|
| PUCT5C | No, duplicado real | No / No | 0 / 0 | `[1,2,3,4,6,7,9,10]` | `[1,2,3,6,9]` | `#-#-#-###-###` no se usa como solución del duplicado | No generado |
| DASH | No, duplicado real | No / No | 0 / 0 | `[7]` | `[3,5,7]` | `###-##-##`; contrato bloqueado | No generado |
| ASFI | Sí | No / No, quedan revisiones por resolver | 0 / 0 | `[5,8,10]` | `[3,5,8,10]` | No representable con seguridad; se omite | No generado |
| VARLEN | No, cinco duplicados reales | No / No | 0 / 0 | `[1,2,4,6,7,8]` | `[1,2,4,6,8]` | `########`; contrato bloqueado | No generado |
| MEFP, PDF (379) | Sí | No / No, quedan revisiones por resolver | 0 / 0 | `[1,2,3,4,5]` | `[1,2,3,4,5]` | `#####`; gate sigue requiriendo resolver revisiones/naturalezas | No generado |
| APS, PDF (67) | Sí | No / No, quedan revisiones por resolver | 0 / 0 | `[1,2,3,4,5,6,8]` | `[1,2,3,5,6,8]` | `#.#.#.##.#.##`; gate sigue requiriendo resolver revisiones/naturalezas | No generado |
| CSV limpio | Sí | No / No, hay una revisión de nodo pendiente | 0 / 0 | `[1,2,4]` | `[1,2,4]` | `####` | No generado |
| CSV fixed-width + NIVEL | Sí | No / No antes de confirmar naturalezas; Sí / Sí después | 0 / 0 | `[6]` | `[]` | Se omite; seis caracteres no describen tres niveles | 281 bytes tras confirmar naturalezas |
| Flat fixed-width sin confirmar | No | No / No | 0 / 0 | `[6]` | `[]` | Se omite | No generado |
| Flat fixed-width confirmado | Sí | Sí / Sí | 0 / 0 | `[6]` | `[]` (un nivel plano declarado por decisión) | `######`, nivel único confirmado | 255 bytes |
| Fixture sintético 313 | Sí | Sí / Sí después de confirmar naturalezas | 0 / 0 | `[6]` | `[]` (niveles proceden de fuente explícita) | Se omite; estructura lógica no representable como máscara | 27,150 bytes |

Los BLOCK de PUCT5C, DASH y VARLEN corresponden a duplicados presentes en las fuentes, no a una pérdida o invención del importador. El replay conserva esos bloqueos y no modifica ni normaliza los archivos de origen. En MEFP, APS y ASFI, la aceptación del validador no equivale a autorización de importación: las revisiones pendientes continúan cerrando el gate. La fila plana confirmada registra marcas de revisión brutas de jerarquía que esa decisión específica resuelve; no elimina revisiones de otro tipo.

PUCT conserva la política existente; no se cambió la fusión ni se alteró el corpus. Los defectos humanos de numeración/diseño de catálogos se tratan como evidencia o warnings conforme a las reglas vigentes, no se atribuyen automáticamente al parser.

## Fixtures, regresiones y extremo a extremo

`scripts/test_hierarchy_evidence.mjs` pasa 33 comprobaciones. Incluye ancho físico fijo sin inferencia plana, flat confirmado/no confirmado, preservación de NIVEL y PADRE explícitos, coherencia nivel/padre, orden fuente determinista, ambigüedad sin padre inventado, niveles agrupados en anchura, regresión de longitud variable, fuente 313 y resolución plana sin ocultar revisión de normalización.

La prueba dirigida de wizard U-9 terminó con 3 PASS / 0 FAIL: niveles explícitos fixed-width avanzan correctamente de nivel 2 a 6; la jerarquía desconocida se detiene en revisión; y la contradicción entre nivel y padre produce BLOCK y no avanza. La prueba registró cero peticiones `/api/*` en esos recorridos.

El import E2E se ejecutó contra una base SQLite desechable local, nunca contra Turso/producción. Importó tres cuentas fixed-width de niveles 1/2/3 con sus padres; la máscara se omitió y el comprobante informó que no se determinó una estructura de empresa. El E2E de producción del runner también comprobó que no se emite POST de importación con estructura inválida.

## Cambios incluidos

- `.gitignore`: ignora directorios temporales `.tmp-e2e-*` y `.tmp-wiz-*` generados por pruebas. Los directorios existentes quedaron físicamente en el worktree, pero verificados como ubicados dentro de él e ignorados; no se borraron.
- `UniversalPlanAnalyzer.js`, `CompatibilityAdapter.js`, `ImportContractSchema.js`, `ImportContractValidator.js`: transportan evidencia fuente/inferida, separan ancho de nivel lógico y aplican la resolución genérica con procedencia.
- `createImportSession.js`, `importSession/index.js`, `UniversalImportWizard.jsx` y pasos de diagnóstico, revisión y resumen: exponen y mantienen la decisión plana y el estado de revisión coherentes con el gate.
- `companyStructure.js`: evita máscaras derivadas solo del ancho físico y omite estructuras no demostrables.
- Harnesses y regresiones: `scripts/test_hierarchy_evidence.mjs`, runners de import/session/PDF/browser/E2E y `web-app/client/e2e-confirmation-harness.html`.
- Documentación: `JERARQUIA_Y_EVIDENCIA.md` define la política; este archivo registra el replay.

No se modificaron `SmartImportWizard.jsx`, backend/DB, motor IA, archivos del corpus PUCT ni el default/rollout. No hay cambios de allowlist para ocultar divergencias.

## Verificación y revisión

- `node scripts/test_hierarchy_evidence.mjs`: 33 PASS.
- `npm test`: exit 0; gate de producción 51 PASS / 0 FAIL / 0 UNVERIFIED; browser E2E 7 PASS / 0 FAIL; wizard U-9 81 PASS / 0 FAIL; shadow differential 16 PASS / 0 FAIL; calidades PDF MEFP 379 y APS 67 aprobadas.
- `node scripts/wizard_e2e_u2.mjs --only=U9-FIXED`: 3 PASS / 0 FAIL.
- `node scripts/wizard_import_e2e.mjs`: import local temporal correcto, sin Turso.
- `npm run build`: exit 0. Permanecen advertencias conocidas de `eval` en pdfjs/DataForge y chunks mayores a 500 KB.
- `git diff --check`: limpio antes de añadir este informe; debe repetirse tras la edición.
- Revisión independiente read-only mediante OpenCode CLI, modelo `opencode-go/deepseek-v4.1-flash`, agente `plan`: dictamen final **READY TO COMMIT**, sin hallazgos HIGH/MEDIUM. La primera revisión encontró una divergencia entre la confirmación plana y el estado de revisión; se corrigió compartiendo `nodeNeedsReview()` entre gate, resumen y UI, y fue re-revisada.

## Riesgos residuales y decisión

- Se conserva un detalle informativo de baja severidad: `effectiveRegionContract` puede mantener `requiresReview=true` después de resolver explícitamente una revisión de normalización en una región plana. El estado efectivo de gate/UI/resumen usa el predicado compartido, y la construcción de payload no depende de esa bandera; las pruebas cubren el comportamiento. Conviene limpiar esta bandera derivada en una iteración acotada, no bloquea el payload actual.
- Niveles explícitos malformados (por ejemplo, texto no entero) se bloquean conservadoramente y hoy pueden requerir excluir/corregir la fila para continuar; no se reinterpretan automáticamente.
- El índice de fila de evidencia jerárquica conserva una diferencia de base (0-based) respecto a otros ordinales (1-based); es de presentación/trazabilidad, no cambia decisiones.
- Los datos locales con duplicados/jerarquías defectuosas siguen requiriendo revisión humana. No se afirma compatibilidad universal de formatos.
- La lista de temporales generados permanece en el worktree, aunque ignorada por Git; no se hizo limpieza destructiva.

**Estado U-9: PAUSADO.** Sin commit. Dictamen de código y pruebas: **READY TO COMMIT**. Detener aquí y esperar aprobación explícita antes de crear el commit o reanudar el rollout.
