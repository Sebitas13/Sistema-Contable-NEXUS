# Normativa y aplicabilidad contable

> Revisión documental: 2026-09-26. Este documento describe el alcance de los
> criterios usados para los reportes y la propuesta de cierre de NEXUS; no es una
> opinión legal, tributaria ni de auditoría. Antes de registrar asientos o emitir
> estados financieros, corresponde validar la normativa vigente y la situación
> concreta de la entidad con un profesional responsable.

## 1. Propósito y límites

Esta guía deja trazabilidad entre el marco boliviano consultado, el comportamiento
del software y las decisiones que todavía requieren clasificación o criterio
profesional. No declara que NEXUS sea un sistema de reportes regulatorios, ni que
sus salidas sean estados financieros completos, auditados o aptos para presentar
ante una autoridad.

La revisión se hizo contra el corpus local indicado por el propietario en
`C:\Users\user\Desktop\UMSA-CONTA\CONTA\MARCO - INTERNACIONAL_Y_NACIONAL` y fuentes
primarias públicas. El corpus local incluye normas contables, Código de Comercio,
Ley 843/Ley 2492 y material tributario con cortes documentales de junio de 2026.
El compendio del SIN consultado declara actualización hasta el 31 de agosto de
2026, y el índice de RND contiene publicaciones hasta septiembre de 2026. El
archivo descargado localmente no debe asumirse como la última versión disponible.

## 2. Marco aplicable: no hay una sola regla para todas las empresas

### Normas contables bolivianas

Las Normas de Contabilidad emitidas por el CTNAC/CAUB constituyen una referencia
general para la preparación de información financiera en Bolivia, atendiendo a
su texto vigente, modificaciones y contexto de aplicación. La NC 11 describe un
conjunto completo de estados financieros que incluye balance general, estado de
resultados, cambios en el patrimonio, flujo de efectivo y notas, con información
comparativa y moneda constante en los términos que establece la norma. Por tanto,
el Balance General y Estado de Resultados que hoy presenta NEXUS son reportes
parciales, no el conjunto completo exigido para una presentación financiera
formal.

La NC 11 también organiza la presentación del resultado en categorías. La
clasificación actual de NEXUS agrupa cuentas por tipo y, cuando falta, por
prefijo del código y jerarquía. Eso permite calcular un resultado contable
provisional, pero no determina de forma universal si cada cuenta corresponde a
actividad operativa, financiera, otra partida, descuento, ingreso no imponible o
un rubro específico de una actividad. El nombre de una cuenta o el primer dígito
no sustituyen una matriz de presentación validada para cada plan y actividad.

### Entidades bajo supervisión de ASFI

El Manual de Cuentas para Entidades Financieras (MCEF) de ASFI es obligatorio
para las entidades financieras sujetas a control y supervisión de ASFI. La
existencia de cuentas con códigos ASFI o de una jerarquía compatible no convierte
por sí sola a cualquier sociedad en entidad regulada ni hace aplicable el MCEF.
ASFI puede revisar y actualizar su manual; deben comprobarse el manual y las
circulares vigentes para la entidad y fecha concretas. En situaciones no
previstas, el propio marco del MCEF remite al marco contable aplicable allí
señalado; no corresponde extrapolar esa regla a todas las empresas.

### Normas internacionales

Las NIIF no se aplican automáticamente a toda empresa boliviana por estar
presentes en el repositorio. Debe establecerse primero qué marco contable es
exigible a la entidad (incluyendo regulación sectorial y disposiciones locales).
NIIF 18 sustituye IAS 1 para periodos anuales que comiencen desde el 1 de enero
de 2027, con posibilidad de aplicación anticipada según sus términos. Se registra
como cambio futuro a vigilar, no como regla ya impuesta a todos los usuarios de
NEXUS.

## 3. Resultado contable, IUE y distribución de utilidades

### Resultado contable

El Estado de Resultados de NEXUS suma movimientos del periodo de cuentas
clasificadas como ingresos, costos y gastos. En la implementación actual:

- ingresos, costos y gastos se determinan por tipo de cuenta y, como respaldo,
  por familia del código;
- las cuentas de resultado sin una naturaleza explícita se asignan según el
  signo de su movimiento del periodo;
- las cuentas reguladoras y la cuenta de Pérdidas y Ganancias no se suman como
  rubros ordinarios del estado;
- no existe aún una matriz normativa configurable por plan, actividad, entidad
  regulada y tipo de presentación;
- el resultado calculado es contable, no la utilidad neta tributaria ni la base
  imponible del IUE.

La UI etiqueta estos rubros de manera neutral y muestra advertencias sobre la
clasificación. No se deben interpretar los subtotales simplificados (por
ejemplo, “utilidad operativa”) como una presentación normativa completa cuando
la clasificación económica de las cuentas no fue revisada.

### IUE

La Ley 843 y sus reglamentos contienen reglas propias para determinar la utilidad
neta imponible, deducciones, conceptos no imponibles, compensaciones y
obligaciones formales. Esa conciliación fiscal no se obtiene aplicando una tasa
al resultado contable sin más. La vigencia y el tratamiento de pérdidas,
deducciones, excepciones, plazos y regímenes deben confirmarse contra el texto
actual consolidado y las RND aplicables al periodo.

Por esa razón, el cálculo actual deja `base imponible` sin determinar, no
calcula ni contabiliza automáticamente IUE y muestra que se requiere conciliación
tributaria. La ausencia de una estimación es deliberada: evita inventar una
obligación o generar un asiento basándose solo en utilidad contable. Para
incorporar cálculo fiscal en el futuro hará falta una especificación separada,
versionada por gestión, que incluya ajustes extracontables, pérdidas fiscales,
regímenes aplicables, evidencia de cada regla y pruebas de casos reales.

### Reserva legal y distribución

Los artículos 168 a 171 del Código de Comercio vinculan la distribución a
utilidades efectivas y líquidas, aprobadas según corresponda, regulan reservas y
limitan distribuciones cuando existan pérdidas anteriores no absorbidas. El
artículo 169 establece, para sociedades anónimas y de responsabilidad limitada,
la reserva legal mínima del cinco por ciento de las utilidades efectivas y
líquidas hasta alcanzar la mitad del capital pagado, con reposición si disminuye
por cualquier causa. También deben revisarse la forma societaria, estatutos,
resoluciones, reservas ya constituidas, capital, pérdidas y normas especiales.

El software no puede inferir esos datos solo desde el saldo de una cuenta. Por
tanto, el cierre no calcula reserva legal ni distribuye utilidad automáticamente.
Un porcentaje fijo aplicado a la utilidad del Estado de Resultados no basta para
probar la base legal ni el límite de acumulación.

## 4. Hoja de Trabajo y cierres

La Hoja de Trabajo permanece como auxiliar de análisis y borrador. Sus columnas
de saldos, Estado de Resultados, ajustes y cierre no son fuente de datos para el
Balance General, Estado de Resultados ni propuesta de cierre del servidor. Sus
fórmulas y correcciones manuales se guardan localmente y no crean asientos.

El flujo vigente de la propuesta de cierre:

1. toma movimientos de la gestión fiscal de la empresa;
2. excluye del cálculo del resultado las transacciones de tipo `CIERRE`;
3. propone cancelar cuentas hoja de ingresos, costos y gastos contra la cuenta
   hoja de Pérdidas y Ganancias/Resultado del Ejercicio;
4. propone llevar el saldo contable de esa cuenta a Resultados Acumulados;
5. incluye cuentas de orden únicamente cuando sus saldos deudores y acreedores
   agregados se compensan exactamente;
6. valida cada asiento a precisión de centavos y rechaza una propuesta si ya hay
   asientos de cierre en la gestión;
7. no cierra activos, pasivos, patrimonio permanente, ni crea ajustes por IUE o
   reserva legal.

En el Balance General, el resultado del periodo se presenta dentro del patrimonio
como partida sintética mientras no se detecte evidencia de cierre tanto en
Pérdidas y Ganancias/Resultado del Ejercicio como en Resultados Acumulados. Esa
partida es solo de presentación y no crea una transacción ni una cuenta.

Esto define el comportamiento de la herramienta; no afirma que una empresa deba
usar exactamente esos nombres, cuentas de contrapartida o secuencia de asientos.
La naturaleza de cuentas de orden y su cierre depende de su plan, uso y política
contable. Ante saldos que no compensan, el sistema detiene la propuesta y exige
identificar la contrapartida, no crea un saldo de ajuste ficticio.

Hay compatibilidad de lectura para asientos históricos cuyo concepto identifica
el antiguo “Cierre de Cuentas de Balance”: sus movimientos se excluyen del saldo
acumulado usado por el Balance General, porque aquel flujo llevaba cuentas
permanentes a cero. La app no los modifica ni elimina, informa que fueron
ignorados y bloquea una nueva propuesta de cierre si detecta cierre existente en
la gestión. Deben revisarse el mayor y los asientos históricos antes de operar
esa gestión; una advertencia no equivale a reparar la contabilidad.

## 5. Jerarquía, padres virtuales y cuentas

La jerarquía organiza el árbol de presentación; no define por sí sola la
naturaleza contable ni el saldo. En algunos planes, especialmente ciertas
estructuras ASFI, puede haber saltos de nivel o padres agregadores que no se
declaran como cuentas. El código de reportes crea nodos virtuales únicamente en
memoria para presentar esas ramas. No persiste cuentas sintéticas, no renumera
cuentas ni altera el contrato de importación.

Los padres virtuales sirven para navegación/agrupación, no son cuentas
contabilizables. La clasificación heredada desde una cuenta padre es un fallback
de presentación; las cuentas ambiguas se reportan como no clasificadas. No debe
convertirse automáticamente en reparación del plan ni en evidencia de que el
plan fuente esté mal. La interpretación definitiva depende del manual del plan y
la estructura de la fuente importada.

## 6. Implementación y contratos actuales

La lógica pura está en `web-app/server/utils/financialReportsCore.js`; las rutas
de periodo y propuesta están en `web-app/server/routes/reports.js`. El cliente
consume `GET /api/reports/financial-statements` para los reportes y el borrador;
el cierre solicita `POST /api/reports/closing-entries-proposal`. La Hoja de
Trabajo no es una dependencia del ciclo.

Las fechas y empresa se validan en servidor; los importes se convierten a
centavos enteros para comparar y validar. Las consultas usan parámetros. No se
registran transacciones, no se escribe en Turso y no se ejecuta un cierre real
durante las pruebas unitarias.

## 7. Fuentes consultadas

Fuentes públicas primarias consultadas el 2026-09-26. La fecha es importante:
normas y compendios pueden cambiar.

- [SIN: Compendio Tributario Actualizado](https://www.impuestos.gob.bo/index.php/compendio-tributario-actualizado/) — Ley 843, Ley 2492 y tomos publicados; la página consultada indicaba actualización hasta 2026-08-31.
- [SIN: RND 2026](https://www.impuestos.gob.bo/index.php/rnd-2026/) — índice de resoluciones normativas; al consultar se observaban publicaciones hasta septiembre de 2026.
- [ASFI: Manual de Cuentas para Entidades Financieras](https://www.asfi.gob.bo/node/402) — alcance del manual para entidades reguladas y documentación vigente.
- [CAUB/CTNAC: Normas de Contabilidad](https://www.auditores.org.bo/19/?contenido=Normas+de+Contabilidad+del+CTNAC) — índice de normas contables.
- [CAUB: NC 11, Estados Financieros](https://www.auditores.org.bo/static/ftp/files/pdf/normasContabilidad/nc11.pdf) — componentes y presentación de estados financieros.
- [Ministerio de Economía y Finanzas Públicas: Código de Comercio, Ley 14379](https://www.economiayfinanzas.gob.bo/sites/default/files/2021-08/Ley_14379.pdf) — artículos 168 a 171, utilidades, reservas y distribución.
- [IFRS Foundation: IFRS 18](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-18-presentation-and-disclosure-in-financial-statements/) — vigencia y transición de NIIF 18.

El corpus local es material de consulta y evidencia archivada, no una autoridad
de vigencia por sí mismo. En particular, los archivos tributarios con corte junio
de 2026 deben contrastarse con el compendio y las RND más recientes antes de
implementar una regla fiscal.

## 8. Protocolo para cambios normativos futuros

Antes de modificar cálculos o etiquetas:

1. identificar el tipo de entidad, actividad, gestión y marco que realmente le
   aplica; separar entidades ASFI de las que usan planes de cuentas similares;
2. consultar la versión oficial vigente y sus disposiciones transitorias, no solo
   documentos históricos o resúmenes;
3. anotar en este documento la norma, artículo/sección, fecha de vigencia,
   entidades cubiertas y efecto en el software;
4. convertir cada regla a casos de prueba con importes conocidos y comprobar el
   balance al centavo;
5. revisar empresa, periodo, tipo de cuenta y asientos de cierre previos en una
   copia de pruebas, sin comenzar registrando en Turso de producción;
6. obtener revisión profesional para efectos tributarios, laborales,
   regulatorios o de presentación externa.

### Trabajo pendiente antes de ampliar el alcance

- Crear una matriz explícita de clasificación/presentación por plan de cuentas,
  actividad y marco aplicable; eliminar la inferencia universal por prefijo como
  criterio final.
- Definir y probar el conjunto completo de estados financieros y notas que se
  pretende emitir, incluyendo comparativos, patrimonio y flujo de efectivo.
- Especificar el tratamiento de cuentas de orden y contrapartidas por cada plan.
- Diseñar por separado la conciliación fiscal IUE por gestión y régimen, con
  historial de cambios normativos y pruebas revisadas por especialista.
- Ejecutar pruebas de integración en Turso de staging y reconciliar reportes con
  balances conocidos antes de habilitar el registro de propuestas.
- Revisar uno a uno los cierres históricos de cuentas permanentes antes de
  recalcular o cerrar periodos que los contengan.
