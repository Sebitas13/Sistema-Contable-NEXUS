# Jerarquía y evidencia del importador universal

Estado: Analyzer 2.3.0 y contrato v1.1. El rollout U-9 permanece pausado; esta política no habilita Etapa 2, U-10 ni cambio del importador predeterminado.

## Conceptos que no se deben mezclar

- `observedCodeLengths` registra el número de dígitos observado en los códigos, sin separadores. Es una propiedad física del identificador.
- `logicalLevelLengths` registra longitudes acumuladas que describen una estructura codificada por segmentos o longitudes variables cuando esa estructura se puede demostrar. No se rellena a partir de una única longitud física.
- `level` es la profundidad semántica de una cuenta. Puede proceder de `sourceLevel`, de una estructura materializada o de una decisión explícita del usuario.
- `parent` es una arista del árbol. Puede proceder de `sourceParent` o de una inferencia auditable. No se obtiene del nombre de la cuenta.

`sourceLevel`, `inferredLevel`, `sourceParent`, `inferredParent` y `hierarchyEvidence` viajan con cada nodo hasta el contrato y la sesión. La columna de origen permanece disponible aunque el valor efectivo tenga otra procedencia.

## Precedencia y contradicciones

1. Una referencia `sourceParent` no vacía define la arista. El motor conserva el valor declarado y la resolución materializada por separado.
2. `sourceLevel` define la profundidad. Nunca se sustituye silenciosamente por una deducción basada en el ancho del código.
3. Cuando ambos están declarados, se conservan ambos. Un padre de igual o mayor nivel que su hijo es un `BLOCK`; no se reescribe ninguna de las dos fuentes.
4. Sin padre explícito, una arista estructural materializada prevalece sobre el orden de filas cuando el padre también tiene nivel fuente `N-1`; así se admiten catálogos agrupados por nivel sin colgar una cuenta del último hermano leído. Si el padre estructural aparece después del hijo, la relación requiere revisión. Sin padre estructural coincidente, solo se usa el orden cuando existe exactamente un candidato anterior de nivel `N-1`. Si hay varios candidatos o la evidencia estructural contradice el nivel, el padre queda nulo y la fila requiere revisión; nunca se elige el último hermano solo por conveniencia.
5. Sin campos explícitos, el analizador conserva las inferencias estructurales ya existentes solo cuando su forma aporta evidencia. Un único ancho, como `[6]`, no aporta profundidad lógica.
6. Sin evidencia suficiente, la jerarquía queda `UNKNOWN`. El validador bloquea el payload aunque se acepten revisiones genéricas.

## Confirmación de plan plano

Para una región `UNKNOWN` sin niveles ni padres explícitos válidos, ImportSession ofrece una acción independiente: confirmar que todas las cuentas están en nivel 1. La decisión `FLAT_ALL_LEVEL_1` guarda fecha, región y anchos observados; en el contrato efectivo fija niveles 1 y padres nulos. No cambia el contrato fuente ni resuelve revisiones de normalización del código: esas siguen visibles y bloquean hasta ser aceptadas explícitamente. Editar posteriormente un nivel invalida la confirmación plana para evitar que coexista con una edición jerárquica sin nueva revisión.

Aceptar una alerta, resolver una fila o confirmar la naturaleza de una cuenta no confirma que el plan sea plano.

## Máscara de empresa

`deriveCompanyStructure()` omite la escritura cuando el estado es `UNKNOWN` o la máscara no se puede demostrar. Si hay varios niveles explícitos pero todos los códigos comparten ancho, se conserva su profundidad en el contrato y se omite el PUT de `code_mask`/`plan_structure`: una máscara física de seis posiciones no describe cómo se distribuyen tres niveles lógicos. Las longitudes derivadas de niveles explícitos solo describen una máscara multinivel si hay evidencia para cada nivel consecutivo desde 1; observar únicamente niveles 2 y 3 no permite tratar sus anchos como los niveles 1 y 2. Una confirmación plana puede declarar un solo nivel con el ancho observado. Si la codificación no se puede representar con la estructura actual, no se inventa una máscara multinivel.

## PDF

Las coordenadas PDF de código y nombre se conservan en `hierarchyEvidence.source`. Actualmente son evidencia de procedencia únicamente: no se usan para inferir niveles. Esta política evita que una indentación visual inestable cambie el árbol.

## Alcance de cambios

La política vive en `UniversalPlanAnalyzer`, se verifica por `ImportContractValidator` y se presenta/decide mediante `ImportSession` y el paso de diagnóstico del asistente universal. No cambia `SmartImportWizard`, el backend, la base de datos, el default ni la fusión PUCT.
