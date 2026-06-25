# Mahoraga — Diagnóstico y manual técnico

Documento de referencia para entender, conservar y eventualmente activar el
"Asistente IA Mahoraga". Mahoraga es un sistema **decorativo / incompleto** que
se desplegó en `Settings.jsx` pero **nunca se cableó de extremo a extremo**.

> Distinción crítica que vamos a repetir varias veces: hay **dos cosas distintas**
> bajo el prefijo `/api/ai`:
>
> 1. **Motor de ajustes contables** (`ai_adjustment_engine.py`, `/api/ai/adjustments/*`,
>    `/api/ai/profile/:companyId`, `AIAdjustmentPanel`, `Worksheet`, `AdjustmentWizard`,
>    `ClosingWizard`). **SÍ FUNCIONA. INTOCABLE.**
> 2. **Asistente Mahoraga** (rutas `/api/ai/mahoraga/*`, `/recognition/*`, `/skills/*`,
>    `/monitor/*`, componentes `Mahoraga*.jsx`, servicios `mahoragaController`,
>    `skillLoader`, `knowledgeBrain`, etc.). **UI sin backend real**. Eliminable
>    pero el usuario lo conserva por valor estético/futuro.
>
> Este documento es solo sobre la **segunda**.

---

## 1. Resumen ejecutivo

| Aspecto | Estado |
|---|---|
| UI | ✅ Pulida y profesional (rueda SVG, paneles, búsqueda de skills) |
| Backend services | ⚠️ Esqueleto en memoria; no persiste; sin lógica real |
| Endpoints API | ⚠️ ~14 endpoints respondiendo, pero la mayoría con mocks o reglas hardcoded |
| Sistema de "Skills" | ⚠️ Catálogo estático (266 KB JSON) de funciones del código, **sin metadatos semánticos** (`keywords:[]`, `anchors:["^$"]`, `confidence:0.9` fijo) |
| Conexión con Groq | ❌ Monitor existe, pero **nunca se llama** desde ningún endpoint real |
| Persistencia en BD | ❌ Todo vive en memoria del proceso, se pierde al reiniciar |
| Aprendizaje | ❌ La "matriz de decisiones" está hardcoded y no se actualiza |
| Integración con el motor real | ❌ Nunca se cableó al motor Python de ajustes |

**En una frase**: Mahoraga tiene la fachada terminada, los planos del edificio
y algunas cañerías, pero el agua y la electricidad nunca se conectaron.

---

## 2. Mapa de archivos de Mahoraga

```
Mahoraga ─┬─ Frontend (cliente)
          │   ├─ pages/Settings.jsx (pestaña "mahoraga", ~lineas 718-946)
          │   ├─ pages/MahoragaDashboard.jsx       (página suelta, NO ruteada)
          │   ├─ components/MahoragaWheel.jsx      ✅ Rueda animada (estética)
          │   ├─ components/MahoragaActivationButton.jsx
          │   └─ components/MahoragaInsightsBanner.jsx
          │
          ├─ Backend Node (servicios)
          │   ├─ services/mahoragaController.js   ⚠️  Permisos y modos (memoria)
          │   ├─ services/systemRecognition.js    ⚠️  Hardcoded; nunca progresa
          │   ├─ services/skillLoader.js          ✅ Lee skills_output_combined.json
          │   ├─ services/groqMonitor.js          ❌ Definido pero nunca invocado
          │   ├─ services/knowledgeBrain.js       ⚠️  Decisiones hardcoded
          │   ├─ services/knowledgeExtractor.js   ⚠️  Extrae pero nadie consume
          │   └─ services/cognitiveOrchestrator.js ❌ Imports rotos; no exporta singleton
          │
          ├─ Backend Node (rutas)
          │   ├─ routes/ai.js → secciones /mahoraga, /recognition, /skills, /monitor
          │   ├─ routes/skills.js, routes/orchestrator.js (referenciados)
          │   ├─ routes/knowledge.js, routes/aiKnowledge.js (DESACTIVADOS por flag)
          │   └─ AI_README.md (notas del diseño original; explícitamente experimental)
          │
          └─ Catálogos / datos
              ├─ skills_output.json (~271 KB)            JS-detectado
              ├─ skills_output_py.json (~45 KB)          Python-detectado
              ├─ skills_output_combined.json (~266 KB)   Combinado
              ├─ skills_output.json.bak                  Backup antiguo
              ├─ combine_skills.js                       Une JS + Py
              └─ scripts/extract_skills.js               Genera los catálogos por AST
              └─ scripts/extract_skills_py.py
```

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

El `Settings.jsx` muestra una **barra de madurez** que se llenaría a medida que
la empresa avanza por estas fases. Hoy el porcentaje es un valor **default
hardcoded** que nunca cambia.

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

Es decir: el catálogo existe pero **sin metadatos semánticos**. Es solo un
inventario AST. Buscar por keyword devuelve 0 resultados; las búsquedas de la
UI funcionan solo por nombre/archivo/tipo.

### 3.3. Modos de operación (control de autonomía)

`mahoragaController.js` define cuatro modos:
- **OFFLINE / DISABLED**: nada.
- **MANUAL**: el usuario hace todo; Mahoraga solo observa.
- **ASSISTED**: Mahoraga propone y el usuario aprueba (con la "activación" como token).
- **AUTONOMOUS**: Mahoraga aplica cambios sin pedir confirmación.

Existe un endpoint `POST /api/ai/mahoraga/change-mode` que funciona (cambia el
modo en memoria), y un botón de "parada de emergencia". Estos cambios **se
pierden al reiniciar** el servidor.

### 3.4. Aprendizaje por feedback

La tabla `mahoraga_adaptation_events` está en el esquema y guarda eventos como
"el usuario revirtió este ajuste por esta razón". El plan era:
- El motor de ajustes registra cada decisión como evento.
- Cuando el usuario acepta o rechaza, se actualiza `company_adjustment_profiles`.
- Con el tiempo, las reglas se "aprenden" por empresa.

**Esto SÍ está parcialmente implementado** — pero como parte del **motor de
ajustes**, no de Mahoraga. El motor escribe en `mahoraga_adaptation_events`. El
asistente Mahoraga (la pestaña en Settings) lee algo de ahí, pero no contribuye.

---

## 4. Estado actual por componente

### 4.1. Frontend

| Componente / panel | Archivo:línea | Llamadas | Estado |
|---|---|---|---|
| Tarjeta de Gobernanza (rueda + fases + madurez) | `Settings.jsx:718-770` | Ninguna (solo estado local) | ✅ Visual |
| Central de Activación (toggles por página) | `Settings.jsx:772-819` | `POST /api/ai/mahoraga/config/:companyId` | ⚠️ Acepta pero no persiste |
| Seguridad & Modos | `Settings.jsx:822-840` | `POST /mahoraga/change-mode`, `POST /mahoraga/emergency-stop` | ⚠️ Memoria solamente |
| Cognición (contador de reglas) | `Settings.jsx:842-856` | `GET /api/ai/profile/:companyId` | ❌ Aunque el endpoint sí existe (alimenta el motor real), Mahoraga no agrega reglas — el contador refleja solo lo que pone el motor de ajustes |
| Monitor de API (Groq) | `Settings.jsx:858-882` | `GET /api/ai/monitor/stats` | ❌ Mock vacío |
| Catálogo Técnico de Skills | `Settings.jsx:884-945` | `GET /api/ai/skills/search` | ⚠️ Busca pero los resultados no tienen contenido semántico (ver §3.2) |
| `MahoragaWheel.jsx` | componente | — | ✅ Rueda SVG pura. **Se conserva.** |
| `MahoragaActivationButton.jsx` | componente | `/api/ai/mahoraga/{status,activate,confirm,reject}` | ⚠️ Funciona como interruptor en memoria |
| `MahoragaInsightsBanner.jsx` | componente | `/api/ai/mahoraga/{status,insights}` | ⚠️ Insights = arreglo vacío hardcoded |
| `MahoragaDashboard.jsx` | página | varias | ❌ **No tiene ruta** en `App.jsx`, está huérfana |

### 4.2. Backend

| Servicio | Qué pretende | Estado real |
|---|---|---|
| `mahoragaController.js` | Modos (OFFLINE/MANUAL/ASSISTED/AUTONOMOUS) y permisos | ✅ Funciona en memoria, ❌ no persiste |
| `systemRecognition.js` | Que Mahoraga "aprenda" la arquitectura antes de operar | ⚠️ Definiciones hardcoded; las fases nunca avanzan |
| `skillLoader.js` | Carga `skills_output_combined.json` al arrancar y arma índices | ✅ Carga bien, pero los índices están vacíos porque los skills no tienen `keywords`/`anchors` |
| `groqMonitor.js` | Registrar uso de tokens/costo de Groq | ❌ **Nadie lo llama**. Datos siempre en cero |
| `knowledgeBrain.js` | API unificada para que Mahoraga sepa qué skill aplicar | ⚠️ Matriz de decisiones hardcoded para 7 operaciones; nunca se actualiza |
| `knowledgeExtractor.js` | Re-extraer estructura del proyecto | ⚠️ Se invoca pero nadie consume su salida |
| `cognitiveOrchestrator.js` | Pipeline final (LLM + reglas + auditoría en Postgres) | ❌ Roto (imports ESM desde CJS, Postgres no configurado) |

### 4.3. Rutas (`routes/ai.js`)

Las rutas viven mezcladas en `ai.js` junto con las del motor real. Aproximadamente:

**Funcionando (responden 200, aunque con datos pobres)**:
- `GET /api/ai/mahoraga/status`
- `POST /api/ai/mahoraga/{activate,confirm,reject,change-mode,emergency-stop}`
- `GET /api/ai/mahoraga/{history,can-activate,insights}`
- `GET /api/ai/skills/{health,search}`
- `GET /api/ai/recognition/status` (devuelve `DEFAULT_LEARNING_STATUS` hardcoded)
- `GET /api/ai/monitor/{stats,dashboard}` (mocks)

**Desactivadas por flag**:
- `routes/knowledge.js`, `routes/aiKnowledge.js` solo se montan si
  `ENABLE_MAHORAGA_EXPERIMENTAL=1`. Por defecto NO están registradas.

**Duplicadas / sospechosas**: dentro de `ai.js`, hay un bloque condicional
(`if (ENABLE_MAHORAGA_EXPERIMENTAL)`) con re-definiciones de varios endpoints
(`/mahoraga/config/:companyId`, `/mahoraga/insights`, `/monitor/stats`, etc.)
que **sobre-escribirían** a las versiones funcionales si el flag estuviera
encendido. Conviene limpiar esto antes de cualquier intento de activación.

---

## 5. Lo que está roto / inconcluso (lista corta para arreglar)

1. **`cognitiveOrchestrator.js`** intenta `require('../../client/src/utils/AccountPlanProfile.js')`
   (un archivo ESM desde un módulo CJS). No corre y nadie lo importa.
2. **Endpoints duplicados** en `ai.js` detrás de `ENABLE_MAHORAGA_EXPERIMENTAL`
   que sobre-escribirían a los buenos.
3. **`groqMonitor.js`** sin call sites: cualquier llamada a Groq desde el motor
   de ajustes debería notificarle, pero hoy no lo hace.
4. **`MahoragaDashboard.jsx`** sin ruta — código muerto en el cliente.
5. **Skills sin metadatos**: el catálogo es un inventario AST; las búsquedas
   semánticas no funcionan porque `keywords/anchors/examples` están vacíos.
6. **`mahoragaController` en memoria**: cualquier cambio de modo se pierde al
   reiniciar (cosa que pasa varias veces al día con Render free).
7. **`/api/auth/knowledge` no montadas**: hay routers escritos que nunca se
   registran en `index.js`.

---

## 6. La rueda (`MahoragaWheel.jsx`) — se conserva

41 líneas de SVG puro. Acepta props `size` (default 40), `color` (default
`#FFD700`, oro) y `spinning` (default `false`).

Visualmente:
- Forma de cruz octagonal estilizada (las "ocho empuñaduras" del nombre).
- Al **hover** rota 45° con una transición suave.
- Con `spinning={true}` rota 360° en loop infinito (2 s/vuelta) y agrega un
  resplandor.

Se usa como icono principal del asistente, en el botón de activación, en el
banner de insights y como adorno en diálogos. **No depende de nada más**.

> Decisión del usuario: la rueda se mantiene tal cual.

---

## 7. Roadmap para activar Mahoraga (cuando se quiera intentar)

Un orden razonable, por etapas independientes. Cada etapa se puede hacer y
mergear por separado sin romper nada del motor real de ajustes.

### Etapa 0 — Limpieza (1 día)
- Eliminar el bloque duplicado dentro de `if (ENABLE_MAHORAGA_EXPERIMENTAL)` en
  `routes/ai.js`.
- Borrar `cognitiveOrchestrator.js` (roto y sin uso) o reescribirlo desde cero.
- Borrar `MahoragaDashboard.jsx` o agregarle una ruta en `App.jsx`.
- Decidir si `routes/knowledge.js` y `routes/aiKnowledge.js` se eliminan o se
  cablean (hoy son código muerto).

### Etapa 1 — Persistencia (1-2 días)
- Crear tabla `mahoraga_state` (company_id, mode, page_config JSON, updated_at)
  para reemplazar el estado en memoria de `mahoragaController`.
- Mover `change-mode`, `emergency-stop`, `config/:companyId` a leer/escribir en
  esa tabla.
- Persistir las activaciones en una tabla `mahoraga_activations`.

### Etapa 2 — Catálogo de skills con sentido (3-5 días)
- Mejorar `scripts/extract_skills.js` para:
  - Extraer keywords del nombre, doc, parámetros (LLM o heurística).
  - Inferir `anchors` (frases típicas que disparan la skill).
  - Sembrar 1-2 `examples` cortos por skill manualmente para las más usadas.
- Re-correr la extracción contra el código actual.
- Que `skillLoader` los indexe y `searchCatalog` devuelva resultados útiles.

### Etapa 3 — Conexión con Groq y monitoreo (2-3 días)
- Hacer que `routes/ai.js`, cuando llama a Groq (si se decide hacerlo), notifique
  a `groqMonitor.recordUsage`.
- Persistir esas métricas (archivo plano o tabla `groq_usage`).
- Que `GET /api/ai/monitor/stats` devuelva datos reales.

### Etapa 4 — Cerebro mínimo (5-7 días)
- Diseñar la API `knowledgeBrain.getSkillsForOperation(operation, context)`:
  toma un nombre de operación + contexto contable y devuelve un ranking de skills.
- Un endpoint nuevo `POST /api/ai/mahoraga/suggest {operation, context}` que:
  1. Pide skills al `knowledgeBrain`.
  2. Si la skill es 100% determinista, la ejecuta directo.
  3. Si requiere LLM, arma el prompt con las skills como contexto, llama Groq.
  4. Devuelve `{ suggestion, confidence, skills_used, requires_confirmation }`.
- Wirearlo al `MahoragaActivationButton` y al `MahoragaInsightsBanner`.

### Etapa 5 — Feedback loop (3-5 días)
- Capturar el "aceptar/rechazar/revertir" en cada `Mahoraga*` action y registrarlo
  en `mahoraga_adaptation_events` (la tabla ya existe).
- Endpoint `POST /api/ai/mahoraga/feedback {event_id, action, comment}`.
- Un job nocturno que recalcule `company_adjustment_profiles` a partir de los
  últimos eventos.
- Mostrar el contador real en el panel "Cognición" de Settings.

### Etapa 6 — UI: madurez en vivo (2 días)
- Calcular la madurez real (% de fases completadas) consultando datos:
  `accounts.count > 0`, `transactions.count > 0`, `ajustes_aplicados > 0`,
  `cierre_creado > 0`.
- Reemplazar `DEFAULT_LEARNING_STATUS` por esa lectura.

### Etapa 7 — Modo autónomo opcional (5+ días, riesgo alto)
- Solo después de Etapas 1-6 con uso real. Que en modo `AUTONOMOUS`, Mahoraga
  pueda aplicar ajustes sin confirmación, con dry-run obligatorio + ventana de
  reversión de 24 h.

> **Total estimado**: ~3-5 semanas de trabajo enfocado para tener un Mahoraga
> funcional y útil (no autónomo). El modo autónomo agregaría 1-2 semanas más.

---

## 8. Decisiones recomendadas si se decide NO activar Mahoraga

Si más adelante se decide que Mahoraga no vale el esfuerzo:

- Conservar `MahoragaWheel.jsx` (estética).
- Conservar la tabla `mahoraga_adaptation_events` y `company_adjustment_profiles`
  porque el motor real las usa.
- Quitar la pestaña "mahoraga" de `Settings.jsx` (líneas 718-946).
- Quitar `MahoragaInsightsBanner` y `MahoragaActivationButton` (sus imports
  en Journal, Ledger, etc.).
- Borrar servicios huérfanos: `mahoragaController`, `systemRecognition`,
  `skillLoader`, `skillDispatcher`, `groqMonitor`, `knowledgeBrain`,
  `knowledgeExtractor`, `cognitiveOrchestrator`.
- Borrar las rutas `/mahoraga/*`, `/recognition/*`, `/skills/*`, `/monitor/*`
  de `ai.js`. **NO BORRAR `ai.js`** (mezcla rutas vivas y muertas).
- Borrar `skills_output*.json`, `combine_skills.js`, `AI_README.md` y los
  scripts `extract_skills*`.

Esa limpieza es segura porque el **motor real de ajustes** vive en otras
rutas y archivos (ver §1 y `ARCHITECTURE.md`).
