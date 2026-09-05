# U-9 CONTROLLED ROLLOUT — DISEÑO (NO IMPLEMENTAR SIN APROBACIÓN)

> Estado: PROPUESTA para revisión. U-8 = PASS. U-10 (retiro legacy) = NO APROBADO.
> Principio rector: U-9 es un **rollout controlado con exposición progresiva,
> monitoreo honesto y rollback real**. NO es un cambio ciego de default.
> Condición innegociable: **PUCT multicolumna explícitamente excluido** (hallazgo U-7).

---

## 1. Por qué U-9 cambia el nivel de riesgo

Hasta U-8, Universal era código muerto en producción (solo accesible por
`?engine=universal` explícito): riesgo ≈ 0. U-9 expone Universal a usuarios
reales. Lo que puede salir mal, ordenado por severidad:

| # | Riesgo | Severidad | Mitigación en este diseño |
|---|---|---|---|
| R1 | Usuario importa PUCT-multicolumna por Universal (fusión sin cablear → 2217 nodos `1`–`5` bloqueados, o peor: confusión) | **ALTA** | §4 PUCT-guard duro en código (detección + redirección, no solo gates) |
| R2 | Divergencia no cubierta por el diferencial en un formato real nuevo | MEDIA | Exposición opt-in (§5) + gates + fallback + log (§6–§7) |
| R3 | Bug de UI en pasos 5–6 con datos reales (progreso, cancelación, receipt) | MEDIA | Probado en E2E U-5; monitoreo de recibos (§6) |
| R4 | Usuario queda "atrapado" en Universal sin saber volver | BAJA | Banner + botón clásico en cada paso (ya existe, U-6) |
| R5 | Activación accidental global (default flip por error) | BAJA | A22 lo prohíbe por suite; §5 no cambia el default |

Decisión explícita: **el default sigue `legacy` durante TODO U-9**. El cambio
de default es U-10-otro (o U-11), nunca parte de U-9.

## 2. Objetivo / no-objetivos

**Objetivo**: permitir uso real opt-in de Universal con red de seguridad
completa, y demostrar durante un período controlado que aguanta uso real
(evidencia requerida antes de siquiera discutir U-10).

**No-objetivos de U-9**:
- Cambiar el default (sigue `legacy`).
- Tocar `SmartImportWizard.jsx`, engine, backend, DB, IA.
- Habilitar PUCT-multicolumna en Universal (excluido por diseño, §4).
- Retirar nada (U-10 no aprobado).
- Telemetría remota (no existe infraestructura; §6 es honesto al respecto).

## 3. Modelo de exposición (etapas, con criterios de entrada/salida)

```
Etapa 0 (hoy):   Universal solo vía ?engine=universal explícito. [ESTADO ACTUAL]
Etapa 1 (U-9):   + botón opt-in "Importar (nuevo)" en Cuentas (§5)
                 + PUCT-guard duro (§4) + log local (§6) + procedimiento rollback (§7)
Etapa 2 (futura, OTRA aprobación): cohorte por empresa (allowlist explícita).
Etapa 3 (futura, OTRA aprobación): cambio de default (con PUCT-guard intacto).
```

Cada etapa exige: suites verdes + E2E verdes + criterios de salida medidos.
U-9 implementa SOLO la Etapa 1. Las Etapas 2–3 se diseñan cuando la Etapa 1
demuestre el período controlado (§8).

**Criterio de entrada a Etapa 1** (ya cumplido): U-8 PASS + este diseño aprobado.

## 4. PUCT-guard duro (exclusión en código, no solo en docs)

Los gates (`canImport`) ya bloquean PUCT5C en la práctica (5 BLOCKs irresolubles),
pero eso es insuficiente como UX y como garantía: un usuario podría excluir
filas hasta vaciar el contrato, o confundirse ante 2217 nodos `1`–`5`. La
exclusión debe ser **explícita, temprana y con ruta de salida**.

### 4.1 Detección (nuevo helper puro, código de app, testeable en Node)

`src/components/import/puctGuard.js` — `needsLegacyWizard(doc)`:
- Señal A (fuerte): hoja Excel con patrón de cabecera 5-col PUCT
  (`C,G,SG,CP,CA` en columnas 0–4) en la grilla canónica.
- Señal B (fuerte): columna única de códigos de 1 dígito con ≥50 filas y
  nombre adyacente (caso VARLEN/Hoja6-columna-única que el flujo canónico
  no cubre: PGC PARTIAL + VARLEN sin padres).
- Señal C (soporte): contrato canónico resultante con ≤9 códigos únicos
  numéricos de 1 dígito y >100 nodos (síntoma exacto del hallazgo U-7).
- A ∨ B ∨ C → `{ excluded: true, reason, signal }`; si no → `{ excluded: false }`.

Nota deliberada: esto NO duplica inteligencia de análisis — es un clasificador
de formato para enrutamiento, del mismo nivel que `detectFormat`. No calcula
niveles, padres ni naturalezas. La lógica de detección ya existe y está probada
en `ShadowComparator.detectLegacyKind` (infra de test); el guard la reimplementa
mínima para la grilla canónica (no importa infra de test en app: regla Z2).

### 4.2 UX del guard

En paso 1, tras la extracción: si `needsLegacyWizard` → panel dedicado
(testids `u2-puct-guard`, `u2-puct-goto-classic`):
- "Este archivo es un plan multicolumna (PUCT). El asistente nuevo aún no lo
  soporta. Usa el asistente clásico, que sí lo maneja."
- Botón "Abrir asistente clásico": `setImportEngineMode('legacy')` + `onClose()`
  (al reabrir Importar → legacy). Sin mortos: el botón ejecuta la acción real.
- No se permite continuar a diagnóstico con ese archivo (el botón Analizar se
  deshabilita con motivo). No se finge soporte.

### 4.3 Tests del guard (requeridos en U-9)

- Node: fixtures PUCT-5col / columna-única / DASH / ASFI / CSV-limpio →
  `excluded` true/false exactos + `reason` no vacía cuando excluye.
- Harness E2E: subir PUCT5C → panel guard visible, botón Analizar deshabilitado,
  clic a clásico persiste `legacy` + cierra. CSV limpio → sin panel.
- App E2E: opt-in con PUCT5C → guard visible (cero POST, import imposible).

## 5. Entrada opt-in (sin tocar el legacy)

En `Accounts.jsx`, junto al botón "Importar" (:364), nuevo botón secundario
"Importar (nuevo)" (testid `open-universal-wizard`):
- Monta `UniversalImportWizard` directamente (dentro del boundary existente),
  SIN modificar el flag almacenado (opt-in por sesión/uso, no global).
- Visible siempre (no es default: es una opción explícita y etiquetada como
  nueva; el botón "Importar" original sigue abriendo el clásico por default).
- Rollback de la entrada = quitar el botón (1 línea, redeploy).

Alternativa considerada y RECHAZADA: banner dentro del legacy invitando a
probar el nuevo → exigiría tocar `SmartImportWizard.jsx` (congelado). No.

## 6. Monitoreo honesto (sin inventar telemetría)

No existe backend de telemetría y U-9 no lo crea. Monitoreo real disponible:
1. **Log local** `universalImportLog` (localStorage, cap 50, FIFO):
   `{ at, fileName, nodes, successCount, errorCount, companyPut, companyId, fp }`,
   escrito al completar/cancelar/fallar un import (paso 6). Visible en consola
   (`localStorage`) y resumido en el banner del wizard ("N imports con esta
   herramienta en este navegador"). Capado y sin PII (nombres de cuenta NO).
2. **Recibo post-import** (ya existe, U-5) como evidencia por operación.
3. **Suites como gates**: `npm test` + E2E antes de cada despliegue de etapa;
   A22 (sin activación global) + nuevo criterio "PUCT-guard activo".
4. **Reporte de usuario**: el botón clásico + banner garantizan salida; los
   fallos del boundary ya hacen `console.error` con contexto.

Límite declarado: sin agregación remota, el "período controlado" se demuestra
con reportes de los usuarios piloto + log local inspeccionable, no con
dashboards. Si se quiere telemetría real, es otro proyecto (backend + tabla).

## 7. Rollback real (procedimiento, no promesa)

| Nivel | Mecanismo | Estado | RTO |
|---|---|---|---|
| Usuario | Botón "Usar asistente clásico" (cada paso) | ✅ existe (U-6) | inmediato |
| Cliente | `setImportEngineMode('legacy')` / borrar `importEngine` | ✅ existe | inmediato |
| Crash | `ImportErrorBoundary` → clásico + flag legacy | ✅ existe (U-6) | automático |
| Entrada | Quitar botón opt-in + redeploy frontend | procedure | 1 deploy |
| Global | No hay nada global que revertir (default intacto) | n/a | — |

Procedimiento de rollback de Etapa 1 (a documentar en el informe U-9):
1. Quitar el botón opt-in de `Accounts.jsx` (revert 1 commit) + redeploy Vercel.
2. Verificar: sin flag, Importar abre el clásico (check E2E U-6 existente).
3. Usuarios con `importEngine=universal` en storage: vuelven con el botón
   clásico o limpiando storage (documentado en el informe, no código).

## 8. Criterios de aceptación U-9 y salida hacia U-10

**Aceptación U-9** (todo verificable):
- [ ] PUCT-guard: fixtures + harness E2E + app E2E en verde; PUCT5C no puede
      llegar a diagnóstico por Universal (panel + redirección probados).
- [ ] Opt-in abre Universal; default abre clásico (E2E app ambos caminos).
- [ ] Log local escribe en import/cancel/error (E2E o Node según factibilidad).
- [ ] `npm test` + build verdes; scope sin legacy/engine/backend/DB.
- [ ] Informe U-9 con procedimiento de rollback ejecutado al menos en seco.

**Salida hacia U-10** (requerida ANTES de discutir retiro legacy; NO parte de U-9):
- Período controlado con imports reales exitosos en ≥2 formatos no-PUCT,
  cero incidentes de pérdida de datos, cero activaciones accidentales.
- Track PUCT-fusión resuelto en fase de engine separada (criterio `fusionGap`
  en verde por cableado real, no por allowlist).
- Decisión de negocio explícita (default flip = otra fase; retiro = U-10).

## 9. Plan de implementación propuesto (commits pequeños, reversibles)

1. `puctGuard.js` + suite Node (fixtures por señal A/B/C + negativos).
2. Panel guard en paso 1 + redirección a clásico + tests harness/app.
3. Botón opt-in en Accounts + log local + banner con conteo.
4. E2E app: camino opt-in + camino default + camino PUCT-bloqueado.
5. Informe U-9 + rollback en seco + propuesta de métricas de salida.

Cada commit: build + suites verdes, legacy/engine intactos, default intacto.

## 10. Archivos a tocar / preservar (propuesta)

Tocar (solo app/import + tests + Accounts.jsx puntual):
`import/puctGuard.js` (nuevo), `UniversalImportWizard.jsx` (paso 1 + banner),
`Accounts.jsx` (botón opt-in), suites (`+guard`, harness, app E2E), runner labels.
Preservar: `SmartImportWizard.jsx`, engine, `routes/*`, `db.js`, `schema.sql`,
zona IA, `importSession/`, baseline y diseño congelados, PUCT/corpus.

## 11. Riesgos residuales declarados

- El guard es heurístico: un PUCT atípico podría pasar (los gates + review
  siguen como red; reportarlo afina señales, no arquitectura).
- El log local es por navegador (no agregado); suficiente para piloto, no
  para flota (declarado en §6).
- Sin telemetría remota no hay detección proactiva (aceptado conscientemente).

---

## DECISIONES QUE REQUIEREN TU APROBACIÓN ANTES DE IMPLEMENTAR

- D1: Opt-in por botón separado (propuesto) vs solo `?engine=` actual.
- D2: PUCT-guard con redirección dura (propuesto) vs solo aviso + gates.
- D3: Log local con `companyId` (propuesto) vs sin identificador alguno.
- D4: Alcance U-9 = Etapa 1 solamente (propuesto) — Etapas 2–3 fuera.
