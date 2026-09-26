# Mahoraga — Diagnóstico y manual técnico

Documento de referencia para entender el estado real del asistente experimental
Mahoraga y encaminar una implementación futura. Verificado contra el código el
2026-09-26. Hay interfaz, endpoints, catálogo técnico y persistencia parcial; no
hay un asistente conversacional conectado de extremo a extremo.

> Distinción crítica que vamos a repetir varias veces: hay **dos cosas distintas**
> bajo el prefijo `/api/ai`:
>
> 1. **Motor de ajustes contables** (`ai_adjustment_engine.py`, `/api/ai/adjustments/*`,
>    `/api/ai/profile/:companyId`, `AIAdjustmentPanel`, `Worksheet`, `AdjustmentWizard`,
>    `ClosingWizard`). **SÍ FUNCIONA. INTOCABLE.**
> 2. **Mahoraga experimental** (rutas de control, reconocimiento, skills y monitor;
>    `mahoragaController`, `skillLoader`, `groqMonitor`, `systemRecognition` y
>    `modelServiceAdapter`). Algunas piezas tienen backend real, pero no componen
>    todavía un asistente que entienda una petición, elija una herramienta segura,
>    responda con evidencia y registre feedback de forma integral.
>
> Este documento es solo sobre la **segunda**.

---

## 1. Resumen ejecutivo

| Aspecto | Estado |
|---|---|
| UI | ⚠️ Pestaña de Settings con controles, indicadores y buscador técnico; no es un chat ni un asistente general. La rueda SVG se conserva. |
| Modos/controlador | ⚠️ `canActivate` y activaciones existen. El modo global e historial tienen persistencia parcial en Turso; los modos no ejecutan herramientas contables. |
| Configuración por empresa | ✅ `active_pages` se guarda en `company_adjustment_profiles`; controla la presentación de la rueda, no permisos de acceso a páginas. |
| Sistema de "Skills" | ⚠️ Catálogo estático (266 KB JSON) de funciones del código, **sin metadatos semánticos** (`keywords:[]`, `anchors:["^$"]`, `confidence:0.9` fijo) |
| Conexión con Groq | ⚠️ `modelServiceAdapter` puede llamar al proveedor si se configura; `groqMonitor` registra en memoria cuando la respuesta trae `usage`. Las métricas no persisten. |
| Ejecución de skills | ❌ `/api/skills/dispatch` requiere `vm2`, no declarado/instalado; no está disponible de forma fiable. No habilitar ejecución dinámica. |
| Orquestador | ❌ Ruta experimental desconectada de Settings, con contratos incompatibles y auditoría placeholder. No usar para operaciones reales. |
| Progreso/madurez | ⚠️ Se deriva de conteos por empresa y se etiqueta como madurez; no mide aprendizaje ni calidad del agente. |
| Integración con el motor Python de ajustes | ❌ Mahoraga no orquesta el motor real. El flujo contable Python es independiente y queda protegido. |

**En una frase**: existen controles y piezas funcionales aisladas, pero todavía
no hay un asistente que traduzca una petición del usuario en una respuesta
contable explicable y segura.

---

## 2. Mapa de archivos de Mahoraga

```
Mahoraga ─┬─ Frontend (cliente)
          │   ├─ pages/Settings.jsx (pestaña de configuración Mahoraga)
          │   ├─ components/MahoragaWheel.jsx      ✅ Rueda animada (estética)
          │   └─ three/MahoragaWheel3D.jsx          (variante visual)
          │
          ├─ Backend Node (servicios)
          │   ├─ services/mahoragaController.js   ⚠️  Modos/activaciones, persistencia parcial
          │   ├─ services/systemRecognition.js    ⚠️  Conocimiento estático; progreso interno en memoria
          │   ├─ services/skillLoader.js          ✅ Lee skills_output_combined.json
          │   ├─ services/skillDispatcher.js       ❌ Requiere vm2, no instalado
          │   ├─ services/groqMonitor.js          ⚠️  Invocado, pero métricas solo en memoria
          │   ├─ services/modelServiceAdapter.js   ⚠️  Inferencia local/LLM independiente
          │   └─ services/cognitiveOrchestrator.js ❌ Ruta experimental no confiable
          │
          ├─ Backend Node (rutas)
          │   ├─ routes/ai.js → secciones /mahoraga, /recognition, /skills, /monitor
          │   ├─ routes/skills.js (montada en /api/skills)
          │   └─ routes/orchestrator.js (montada en /api/ai/orchestrator)
          │
          └─ Catálogos / datos
              ├─ skills_output.json                      JS-detectado
              ├─ skills_output_py.json                   Python-detectado
              ├─ skills_output_combined.json             Combinado
              ├─ combine_skills.js                       Une JS + Py
              └─ scripts/extract_skills.js               Genera los catálogos por AST
              └─ scripts/extract_skills_py.py
```

No existen actualmente `MahoragaDashboard.jsx`, `MahoragaActivationButton.jsx`,
`MahoragaInsightsBanner.jsx`, `knowledgeBrain.js`, `knowledgeExtractor.js`,
`routes/knowledge.js`, `routes/aiKnowledge.js` ni `AI_README.md`; las referencias
antiguas a ellos pertenecían a otra iteración.

---

## 3. Cómo se supone que debería funcionar (intención original)

El diseño que se intuye del código combina cuatro ideas que nunca se unieron:

### 3.1. Ciclo contable en 4 fases ("educación" del asistente)

```
GÉNESIS        → empresa, plan de cuentas, UFV, tipo de cambio cargados
   ↓
OPERACIÓN      → libro diario activo, asientos registrados
   ↓
RITUAL         → ajustes (UFV, depreciación, provisiones) corridos y aceptados
   ↓
REVELACIÓN     → estados financieros y cierre fiscal generados
```

Settings muestra un porcentaje consultado a `GET /api/ai/mahoraga/maturity/:companyId`.
Se calcula con conteos: cuentas (>0), operaciones (>=5), ajustes/transacciones o
eventos de adaptación (>0), y existencia de un cierre. Cada hito agrega 25 puntos.
Es un indicador derivado de datos contables, no un modelo que haya aprendido ni
una medición de calidad del plan.

### 3.2. Catálogo de Skills

La idea es que cada función relevante del código sea una "skill" con metadatos:
qué hace, cuándo usarla, qué inputs, ejemplos. Un script (`extract_skills.js`)
recorre el código y genera un JSON. En teoría el asistente, ante un pedido del
usuario, **buscaría la skill más relevante** y la ejecutaría.

Esquema de una skill (lo que **debería** tener):
```json
{
  "id": "Journal.jsx::handleSubmit",
  "name": "handleSubmit",
  "file": "web-app/client/src/pages/Journal.jsx",
  "type": "function",
  "signature": "(event)",
  "doc": "Guarda un asiento del libro diario",
  "keywords": ["asiento", "diario", "guardar"],
  "anchors": ["^crear .* asiento", "registrar .* movimiento"],
  "examples": ["registrar un asiento por venta a crédito"],
  "confidence": 0.92
}
```

Esquema **actual** (lo que está en `skills_output_combined.json`):
```json
{
  "id": "Journal.jsx::handleSubmit",
  "name": "handleSubmit",
  "file": "web-app/client/src/pages/Journal.jsx",
  "type": "function",
  "signature": "(event)",
  "doc": "",
  "keywords": [],
  "anchors": ["^$"],
  "examples": [],
  "confidence": 0.9
}
```

Es decir: el catálogo existe pero **sin metadatos semánticos útiles**. Es un
inventario AST. `searchByKeywords()` normalmente no encuentra resultados; la
búsqueda que usa Settings puntúa principalmente nombre, id, archivo y tipo, con
el texto de documentación/keywords como campos adicionales cuando existen.

### 3.3. Modos de operación (control de autonomía)

`mahoragaController.js` define `disabled`, `manual`, `assisted` y `autonomous`.
No interpretar esos nombres como capacidades de escritura:

- `manual` bloquea la llamada LLM en `inferWithModel` y devuelve predicciones
  heurísticas locales. `activate` puede crear una activación pendiente, pero
  `confirm` solo cambia/guarda el estado de la activación; no reanuda ni ejecuta
  la inferencia que quedó bloqueada.
- `assisted`/`autonomous` permiten la ruta de inferencia LLM cuando está
  configurada. Esa ruta devuelve predicciones de clasificación; no escribe asientos
  ni modifica cuentas automáticamente. No hay una aprobación conectada al flujo.
- El modo global se persiste en `mahoraga_state` (`company_id=0`) y se hidrata al
  iniciar. La escritura es best-effort asíncrona: la API puede responder antes de
  confirmar la persistencia. El historial guarda activaciones y eventos de
  confirmación/rechazo en `mahoraga_activations`, con reconstrucción limitada.
- La parada de emergencia fuerza `disabled`; no existe actualmente un protocolo
  independiente de reset con doble autorización.
- `APP_PASSWORD` es una contraseña compartida para la API; los `userId` de estos
  endpoints vienen en el body y no representan identidades autenticadas distintas.

Por seguridad, no activar `assisted` ni `autonomous` en producción como si fueran
una ruta para habilitar un asistente completo.

### 3.4. Aprendizaje por feedback

La tabla `mahoraga_adaptation_events` está en el esquema y guarda eventos como
"el usuario revirtió este ajuste por esta razón". El plan era:
- El motor de ajustes registra cada decisión como evento.
- Cuando el usuario acepta o rechaza, se actualiza `company_adjustment_profiles`.
- Con el tiempo, las reglas se "aprenden" por empresa.

**Esto está parcialmente implementado en el motor de ajustes**, no como un ciclo
general de aprendizaje de Mahoraga. El feedback de ajustes puede escribir eventos
en `mahoraga_adaptation_events` y modificar reglas del perfil de la empresa.
Settings cuenta las reglas guardadas; no hay job de entrenamiento ni garantía de
que un cambio de regla generalice correctamente. Mahoraga no contribuye un loop
autónomo adicional.

---

## 4. Estado actual por componente

### 4.1. Frontend

| Componente / panel | Archivo:línea | Llamadas | Estado |
|---|---|---|---|
| Tarjeta de Gobernanza (fases + madurez) | `Settings.jsx` | `GET /api/ai/mahoraga/maturity/:companyId` | ⚠️ Los conteos vienen de BD; fases y porcentaje son heurísticas, no cognición del agente. |
| Activación por página | `Settings.jsx` | `GET/POST /api/ai/mahoraga/config/:companyId` | ✅ Persiste `mahoraga_settings.active_pages` en `company_adjustment_profiles`; solo muestra/oculta la rueda y controles de Mahoraga en páginas. |
| Seguridad & Modos | `Settings.jsx` | `GET /mahoraga/status`, `POST /change-mode`, `/emergency-stop` | ⚠️ Modos globales en `mahoraga_state`, activaciones en `mahoraga_activations`; persistencia best-effort y efecto limitado a `canActivate`. |
| Cognición (contador de reglas) | `Settings.jsx` | `GET /mahoraga/maturity/:companyId` + perfil | ⚠️ Cuenta reglas monetarias/no monetarias del perfil de ajustes; no son reglas creadas por un asistente general. |
| Monitor de API (Groq) | `Settings.jsx` | `GET /api/ai/monitor/stats` | ⚠️ Stats calculadas en memoria del proceso; no sobreviven reinicios y solo se registran respuestas con `usage`. |
| Catálogo Técnico de Skills | `Settings.jsx` | `GET /api/ai/skills/search` | ⚠️ Inventario AST con búsqueda principalmente por nombre/id/archivo/tipo; no resuelve peticiones contables en lenguaje natural. |
| `MahoragaWheel.jsx` | componente | — | ✅ Rueda SVG pura. **Se conserva.** |

### 4.2. Backend

| Servicio | Qué pretende | Estado real |
|---|---|---|
| `mahoragaController.js` | Modos, permisos y activaciones | ⚠️ Persiste modo global/historial en Turso y los hidrata; estado runtime y errores de escritura son best-effort. |
| `systemRecognition.js` | Describir arquitectura y fases de reconocimiento | ⚠️ Conocimiento estático y avance en memoria; no entrena ni cambia un modelo. |
| `skillLoader.js` | Carga e indexa `skills_output_combined.json` | ✅ Catálogo cargado; índices de keywords/anchors aportan poco por metadatos vacíos/genéricos. |
| `skillDispatcher.js` | Ejecutar funciones permitidas | ❌ Requiere `vm2`, que no está declarado/instalado; las rutas de dispatch fallan al cargarlo. |
| `groqMonitor.js` | Registrar uso/costo | ⚠️ `modelServiceAdapter` lo llama, pero solo guarda en memoria y su persistencia es no-op. |
| `modelServiceAdapter.js` | Heurística local y enriquecimiento LLM de `/api/ai/analyze` | ⚠️ Inferencia separada; su output no se aplica a datos contables. Requiere configuración del proveedor para LLM. |
| `cognitiveOrchestrator.js` | Pipeline LLM + reglas + auditoría | ❌ No confiable: contrato de llamada incompatible con `inferWithModel`, auditoría de consulta es placeholder y `pg` no está declarado si se configura Postgres. |

### 4.3. Rutas (`routes/ai.js`)

Las rutas viven mezcladas en `routes/ai.js` con el motor contable, bajo el gate
global de autenticación del servidor. `routes/skills.js` se monta aparte en
`/api/skills`; `routes/orchestrator.js` se intenta montar en
`/api/ai/orchestrator`.

- Control de modos/activaciones: `GET /api/ai/mahoraga/status` y
  `POST /api/ai/mahoraga/{activate,confirm,reject,change-mode,emergency-stop}`.
  Los endpoints existen; sus estados no representan la ejecución real de una tarea.
- Datos de gobernanza: `/api/ai/mahoraga/{maturity/:companyId,insights,config/:companyId}`.
  Madurez e insights consultan datos; Settings carga insights pero actualmente no
  los renderiza en el panel.
- Reconocimiento: `/api/ai/recognition/status` usa `buildMahoragaLearningProgress`
  y conteos de BD. `teach`, `advance`, `preview` y el mapa de conocimiento usan
  definiciones estáticas/de proceso; no equivalen a entrenamiento.
- Catálogo: `/api/ai/skills/{health,search}` y `/api/skills/{health,search}` tienen
  rutas de consulta. Los endpoints de dispatch intentan cargar `skillDispatcher`
  de forma diferida y fallan porque `vm2` no está disponible.
- Monitor: `/api/ai/monitor/{stats,dashboard,models,alerts}` responde con el estado
  del singleton en memoria; los datos no son históricos ni persistentes.
- Orquestador: `/api/ai/orchestrator/{orchestrate,feedback,audit/:id,health}` está
  montado en el código, pero no conectado a la UI ni listo para producción. La
  lectura de auditoría retorna placeholder; no confiar en el health check como
  prueba de disponibilidad de DB/LLM.

En la revisión actual no aparece el antiguo bloque duplicado bajo
`ENABLE_MAHORAGA_EXPERIMENTAL`, ni routers de knowledge separados. El registro del
orquestador usa un `try/catch`; puede no montarse si falla su carga.

---

## 5. Lo que está roto / inconcluso (lista corta para arreglar)

1. **Activaciones no ejecutan una tarea**: la confirmación solo cambia estado;
   no retoma la inferencia bloqueada ni propone una acción desde Settings.
2. **`AUTONOMOUS` no es autonomía contable**: habilita una ruta que puede devolver
   predicciones LLM; no aplica escrituras ni tiene una capa de aprobación/rollback.
3. **Dispatcher roto por dependencia ausente**: `vm2` no figura en los package
   manifests y `require.resolve('vm2')` falla en este checkout. No solucionarlo
   simplemente instalando `vm2`; diseñar herramientas tipadas sin ejecución de
   código arbitrario.
4. **Catálogo semánticamente pobre**: los JSON se generan por AST; keywords,
   ejemplos y documentación son vacíos y anchors genéricos. No es una base de
   conocimiento contable curada.
5. **Métricas volátiles**: `groqMonitor` se actualiza desde `modelServiceAdapter`
   solo si el proveedor devuelve `usage`; `savePersistedStats()` es no-op.
6. **Orquestador no confiable**: su llamada a `inferWithModel` no coincide con la
   firma real, `/audit/:id` devuelve datos de ejemplo y `pg` no está declarado.
   El health route reporta servicios como `ok` sin comprobarlos.
7. **Madurez no significa aprendizaje**: se deriva de filas/cuentas existentes;
   `systemRecognition` conserva conocimiento y avance adicional en memoria.
8. **Insights sin presentar**: Settings los solicita pero el estado `insights` no
   se usa en el render actual.
9. **Seguridad por revisar antes de herramientas**: las rutas usan la contraseña
   compartida global y aceptan `userId` del cliente; no hay autorización por rol
   o empresa vinculada a una identidad individual.

---

## 6. La rueda (`MahoragaWheel.jsx`) — se conserva

41 líneas de SVG puro. Acepta props `size` (default 40), `color` (default
`#FFD700`, oro) y `spinning` (default `false`).

Visualmente:
- Forma de cruz octagonal estilizada (las "ocho empuñaduras" del nombre).
- Al **hover** rota 45° con una transición suave.
- Con `spinning={true}` rota 360° en loop infinito (2 s/vuelta) y agrega un
  resplandor.

Se usa como señal visual en distintas páginas y flujos del sistema. **No implica
que el asistente esté activo** y no debe eliminarse como parte de una limpieza
de Mahoraga.

> Decisión del usuario: la rueda se mantiene tal cual.

---

## 7. Roadmap para hacer realidad Mahoraga

El objetivo recomendado es un asistente útil de **consulta y explicación**, no
un agente que contabilice por su cuenta. Implementar cada etapa por separado,
con aprobación y pruebas antes de tocar los flujos productivos.

### Etapa 0 — Definir alcance y límites
- Elegir 3-5 tareas concretas: explicar una pantalla/campo, orientar un flujo,
  explicar un reporte ya calculado y responder preguntas sobre arquitectura.
- No prometer que responde por toda la app ni usar el término "autónomo" como
  sinónimo de asistente conversacional.
- Mantener intocables `ai_adjustment_engine.py`, endpoints de ajustes, perfiles
  contables y los componentes protegidos en `AGENTS.md`.
- Resolver identidad y autorización por empresa antes de enviar datos financieros
  a un LLM. La contraseña global actual no identifica usuarios distintos.

### Etapa 1 — Servicio de conocimiento mantenible
- Crear fuentes curadas y versionadas: arquitectura, manuales de usuario, glosario
  contable, límites conocidos y procedimientos de la app.
- Definir un schema de habilidad con `id`, propósito, cuándo aplica, entradas
  tipadas, efectos (solo lectura/escritura), permisos requeridos, fuente/cita,
  ejemplos de evaluación y versión.
- Tratar el extractor AST como inventario para desarrolladores, no como autoridad
  ni como código que el asistente pueda ejecutar.
- Añadir revisión humana y pruebas al regenerar índices. No inventar anchors o
  ejemplos con un LLM y publicarlos sin validación.

### Etapa 2 — API de consulta sin efectos
- Crear un router Mahoraga independiente de las rutas `/api/ai/adjustments/*`.
- Validar `companyId` contra una identidad/permisos del servidor; no aceptar el
  `userId` del body como prueba de identidad.
- Recuperar solo documentación aprobada y herramientas read-only con schema
  (por ejemplo, explicar datos ya devueltos por un reporte existente).
- El LLM puede seleccionar entre esas herramientas; no puede ejecutar JavaScript,
  shell, SQL libre, ni construir URLs arbitrarias.
- Devolver respuesta, fuentes, datos consultados, incertidumbre y versión del
  modelo. Si no hay fuente suficiente, responder que no sabe.

### Etapa 3 — Fiabilidad, costos y auditoría
- Unificar el adaptador de proveedor, configurar timeout, límites de tokens,
  retries acotados, tratamiento de errores y protección de datos.
- Guardar telemetría persistente con retención definida y redacción de nombres,
  cuentas, prompts y respuestas sensibles. El monitor actual es solo de proceso.
- Separar los errores del LLM de los fallos contables; nunca convertir una falla
  en un cálculo exitoso de contingencia sin advertir al usuario.

### Etapa 4 — UI conversacional acotada
- Reemplazar el concepto del panel actual solo después de que la API read-only
  esté probada. Mostrar contexto de empresa, fuentes y advertencias por respuesta.
- Permitir copiar/exportar la conversación con consentimiento; definir borrado y
  retención. No incluir datos financieros en logs de consola.
- Mantener la rueda como elemento visual. La rueda no representa un permiso ni
  una acción pendiente.

### Etapa 5 — Evaluación antes de ampliar
- Crear un conjunto de preguntas sintéticas y casos con respuesta esperada sobre
  arquitectura, UI y reglas de negocio, sin datos reales de usuarios.
- Medir exactitud con citas, respuestas no sustentadas, aislamiento entre
  empresas, latencia, tokens/costo y recuperación ante cold start.
- Hacer rollout interno opt-in, conservar fallback clásico y tener rollback.
- No cambiar los modos actuales para activar el chat: definir estados nuevos con
  semántica inequívoca (desactivado, consulta habilitada, escritura nunca implícita).

### Etapa 6 — Acciones de escritura, solo si se aprueban aparte
- Empezar por propuestas revisables, no ejecución autónoma: preview determinista,
  validación contable server-side, consentimiento explícito y recibo auditable.
- Reutilizar los endpoints y validadores contables existentes. Mahoraga no duplica
  cálculos ni escribe directo a la base de datos.
- Exigir idempotencia, transacción, permisos por empresa, rollback probado y
  separación de duties. El LLM nunca confirma por el usuario.

No se asigna estimación de semanas hasta elegir alcance, proveedor, esquema de
identidad y retención de datos.

---

## 8. Decisiones recomendadas si se decide NO activar Mahoraga

Si más adelante se decide no convertir Mahoraga en asistente:

- Conservar `MahoragaWheel.jsx` (estética).
- Conservar la tabla `mahoraga_adaptation_events` y `company_adjustment_profiles`
  porque el motor real las usa.
- Decidir por separado si se conserva la pestaña de Settings como diagnóstico.
- Mantener los indicadores/controles solo si tienen un propósito claro y su
  etiqueta coincide con el efecto real.
- Auditar call sites antes de borrar `mahoragaController`, `systemRecognition`,
  `skillLoader`, `skillDispatcher`, `groqMonitor`, `modelServiceAdapter` o
  `cognitiveOrchestrator`.
- Antes de retirar rutas de Mahoraga (`/mahoraga/*`, `/recognition/*`,
  `/skills/*`, `/monitor/*`), buscar todos sus consumidores, incluidos los de
  `Settings.jsx`, y decidir qué paneles se conservan o se reemplazan. En
  particular, no retirar `/api/ai/skills/search` ni rutas de monitor mientras
  Settings siga dependiendo de ellas. **NO BORRAR `ai.js`**: también contiene
  rutas activas de ajustes contables y perfiles que alimentan el motor real.
- Borrar `skills_output*.json`, `combine_skills.js` y `scripts/extract_skills*`
  solo después de confirmar que no existe consumidor ni necesidad de auditoría.

Esa limpieza es segura porque el **motor real de ajustes** vive en otras
rutas y archivos (ver §1 y `ARCHITECTURE.md`).
