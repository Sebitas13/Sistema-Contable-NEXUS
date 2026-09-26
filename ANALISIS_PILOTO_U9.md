# ANÁLISIS PILOTO U-9 — Bitácoras de importación (2026-09-10)

> Evidencia del período controlado de la Etapa 1 (rollout opt-in).
> Método: lectura de las 3 bitácoras exportadas por el usuario + **replay
> determinista** (reconstruir la sesión aplicando las acciones registradas al
> mismo archivo/hoja con el motor actual y comparar la huella del contrato
> efectivo) + cruce contra el documento fuente `PUCT/Planes de cuentas.xlsx`.
> Herramienta reproducible: `node scripts/analyze_import_trail.mjs "<bitacora.json>"`.

## 1. Resultados por importación

| # | Hoja (fuente) | Nodos | BLOCK | REVIEW | Acciones del usuario | Resultado | companyPut |
|---|---|---|---|---|---|---|---|
| 1 | Hoja2 (DASH) | 235 | 1 (700-10-06 ×2) | 0 | 62 overrides (56 de código por tecleo → 25 re numeraciones; 6 de tipo), 38 confirmaciones, 9 resoluciones, 6 bulk (84 filas) | **235/0** completado | skipped (sin longitudes declaradas) |
| 2 | Plan de cuentas ASFI | 2859 | 0 | 36 | 80 resoluciones, 75 confirmaciones, 9 bulk (687 filas), 7 overrides (5 nombres, 2 tipos) | **SIN `result`** (simulaciones allowed=true ×2859) | desconocido |
| 3 | Hoja5 (VARLEN) | 578 | 5 | 0 | 266 resoluciones, 32 confirmaciones, 18 overrides (6 filas; 4 re numeraciones + tecleo), 2 exclusiones | **576/0** completado | updated (mask `########`, nivel acumulado [1,2,4,6,8]) |

## 2. Reconciliación determinista (evidencia fuerte)

Para las 3 bitácoras, el replay aplicó **todas** las acciones registradas sin
omitir ninguna y comparó la huella del contrato efectivo:

- ✅ **Fingerprint IDÉNTICO** al registrado en las 3 (Hoja2, ASFI, Hoja5).
- ✅ Conteos exactos: Hoja2 235 = 235; Hoja5 576 = 576.
- Conclusión: la bitácora **explica el 100% del resultado**; no hay acciones
  perdidas ni lógica oculta; el motor es determinista bajo las mismas entradas
  y decisiones. Los gates funcionaron (paso 3 `can=false` → resolución →
  paso 5 `can=true`).

## 3. Hallazgos

### H1 🔴 Pérdida de evidencia por tamaño de la huella (ASFI sin `result`)
Las huellas completas del contrato se guardan en la bitácora (2 simulaciones +
resultado). ASFI pesa **3.33M unidades** (~6.4 MB UTF-16) y **no tiene evento
`result`** pese a que hubo simulación `atConfirm=true` (se pulsó Confirmar).
Con el resultado habría llegado a ~4.79M unidades. El guardado de eventos es
best-effort con `try/catch` (jamás bloquea el import), así que la hipótesis
principal es **cuota de localStorage excedida** al guardar el resultado; la
alternativa es una sesión interrumpida. **Desde la evidencia no podemos afirmar
si la importación de ASFI se completó** (no hubo recibo registrado).
Riesgo: si no se corrige, se seguirá perdiendo la evidencia de los imports
grandes — justo la que sostiene el período controlado.

### H2 🟡 Ruido de overrides por tecleo
Cada pulsación en la celda «Código» genera un override (`onChange`). La
bitácora registra intermedios inválidos (`"700-10-"`, `"700-10-1"`) y multiplica
eventos (62 eventos para ~25 ediciones reales). No corrompe datos (el valor
final manda y el gate bloquea intermedios), pero ensucia la traza y agranda la
bitácora. Fix propuesto: confirmar en `blur`/`Enter` con estado local por celda.

### H3 🟡 El tipo sugerido por primer dígito no coincide con estos planes
El motor propone el tipo por nombre + primer dígito; en Hoja2 sugirió «Costo»
para los 700-* (que son gastos) y el usuario corrigió por lotes (84 filas);
en ASFI corrigió 687 filas (Gasto 246, Ingreso 236, Contingente 106, Orden 99).
No es un bug (el override del usuario es el camino diseñado y quedó trazado),
pero es fricción real. Mejora opcional: acción de tipo «por prefijo» en lote.

### H4 🟡 Calidad de la fuente (no del importador)
- Hoja2: **duplicado real** `700-10-06` en dos cuentas distintas («Retenciones
  Laborales» y «Aportes Patronales»). El usuario lo resolvió con una cascada
  +1 sobre 26 códigos; consecuencia: desde `700-10-07` los códigos **divergen**
  del plan fuente. Decisión explícita y trazada; conviene validar contra el plan
  oficial si «Aportes Patronales» debía llevar otro código específico.
- ASFI: **42 celdas de la fuente** traen espaciado roto («P RODUCTOS …»,
  «F IDEICOMISOS …»). Se corrigieron 5 a mano; el resto quedan como en la fuente.

### H5 🟡 VARLEN quedó con ~266 cuentas sin padre
El usuario aceptó 266 revisiones de nodo (padre inferido/ausente). El plan se
importó con 576 cuentas, pero esos nodos conservan `parent_code=null`: el árbol
se verá plano en esos puntos. Es una decisión explícita y trazada; verificar el
resultado visual en Plan de Cuentas.

### H6 ✅ Coherencia de la estructura de empresa
Hoja5 persistió `code_mask` (longitudes declaradas [1,2,4,6,8]); Hoja2 y ASFI
lo omitieron por no declarar longitudes — exactamente la regla conservadora
acordada (jamás inventar máscara).

### H7 ✅ PUCT-guard no fue sorteado
Las tres importaciones usaron hojas soportadas por la ruta universal; no hubo
intentos de forzar multicolumna por el wizard nuevo.

## 4. Recomendaciones priorizadas

- **P1 (alto, evidencia)**: guardar en la bitácora una **huella corta**
  (p. ej. 32 caracteres + longitud) en lugar de la huella completa en
  `simulation`/`result`. Elimina la pérdida de evidencia y mantiene la
  comparabilidad (el replay compara el mismo prefijo). Cambio solo en app/monitoreo.
- **P2 (medio, UX/traza)**: confirmar ediciones de celda en `blur`/`Enter`
  (no en cada tecla). Menos eventos, sin valores intermedios, misma semántica.
- **P3 (opcional, eficiencia)**: acción de asignación de tipo «por prefijo»
  para acelerar correcciones masivas como las de ASFI.
- **Verificación sugerida**: re-importar ASFI con P1 aplicado (o confirmar que
  el recibo se vio) para completar la evidencia de esa importación; revisar en
  Plan de Cuentas las ~266 cuentas de Hoja5 sin padre.

## 5. Estado del período controlado

- Importaciones completadas con evidencia íntegra: Hoja2 y Hoja5 (firmas
  deterministas idénticas, cero errores).
- ASFI: evidencia incompleta por H1; requiere re-import o confirmación manual.
- Fricción observada: alta (266 aceptaciones manuales en VARLEN, 687 correcciones
  de tipo por lote en ASFI) pero **explícita y trazable**, sin invenciones.
- La recomendación P1 se implementó en código local después de este análisis;
  ver la actualización fechada al final. Las importaciones históricas no cambian
  de estado y ASFI sigue necesitando una nueva prueba con recibo.

## 6. Seguimiento de hallazgos (2026-09-26)

Esta sección actualiza el código y el proceso, no la evidencia del piloto del
10 de septiembre.

| Hallazgo | Seguimiento actual | Qué falta para cerrarlo |
|---|---|---|
| H1 — huella enorme / ASFI sin `result` | El código ahora guarda fingerprints largos como `u9fp1:<longitud>:<firma>` de tamaño acotado. `analyze_import_trail.mjs` compara firmas compactas nuevas y sigue aceptando bitácoras antiguas con fingerprint completo. Si el navegador agota cuota, `saveTrail` elimina bitácoras más antiguas para intentar preservar la actual. | La firma es determinista para comparar, no criptográfica; si la bitácora actual sola excede la cuota, el guardado aún puede fallar. Repetir ASFI en el build identificado y comprobar que la bitácora contiene `result`. La importación histórica sigue siendo desconocida. |
| H2 — override por tecla | La revisión actualiza la sesión durante la escritura, pero el evento de bitácora se agrega al salir del campo o con Enter; se conserva el valor final en vez de cada estado intermedio. | Validar el comportamiento de edición con una prueba manual del wizard en navegador y confirmar que el valor final visible/simulado coincide con el guardado. |
| Evidencia reproducible | `npm test` pasó, incluyendo J9 (compactación) y J10 (evicción por cuota); el build del cliente pasó. | El E2E manual del wizard y una nueva importación real no se sustituyen por pruebas unitarias. |

La rutina que evita perder bitácoras prioriza la más reciente: al fallar la
escritura elimina las entradas antiguas una por una. Las bitácoras llevan nombres
de archivo y nombres/códigos de cuentas; no contienen `companyId` ni NIT, pero
pueden ser comercialmente sensibles y deben enviarse solo para diagnóstico.

Las tres entradas analizadas siguen siendo hojas del mismo libro Excel. El
arreglo H1/H2 mejora la recolección de evidencia y la ergonomía del override;
no aumenta por sí mismo la cobertura de formatos ni vuelve universal al motor.
