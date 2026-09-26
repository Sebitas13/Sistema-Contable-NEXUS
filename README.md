# Sistema Contable NEXUS (BVR Edition) 🛡️🚀

Sistema contable avanzado multi-empresa diseñado bajo la normativa contable y tributaria de Bolivia. Este sistema automatiza de forma inteligente los **ajustes contables y el cierre fiscal** mediante un motor de Inteligencia Artificial y un sistema robusto de auditoría y feedback.

---

## 🌟 Características Clave

-   **Ajustes contables**: motor que calcula y propone asientos para depreciación, actualización por inflación (UFV/AITB), revaluaciones y provisiones según las reglas implementadas.
-   **Gestión Multi-Empresa Completa**: Configuración dinámica de periodos fiscales según la actividad económica:
    -   *Comercial, Servicios, Bancos y Seguros* (cierre al 31 de Diciembre).
    -   *Industriales, Constructoras y Petroleras* (cierre al 31 de Marzo).
    -   *Gomeras, Castañeras, Agrícolas y Ganaderas* (cierre al 30 de Junio).
    -   *Mineras* (cierre al 30 de Septiembre).
-   **Acceso a la aplicación**: el backend puede proteger la API con una contraseña compartida (`APP_PASSWORD`). No es un sistema de usuarios ni de permisos independientes por empresa.
-   **Sistema de Backup "Escudo del General"**: exporta 15 tablas en un `.zip` y restaura de forma aditiva (crea otra empresa, no sobreescribe la existente). La exportación usa streaming; la importación descomprime y procesa JSON en memoria, con límites de tamaño.
-   **Reportes Contables**: Generación instantánea de Libro Diario, Libro Mayor, Balances de Comprobación y Hojas de Trabajo configurables en lotes y exportables a PDF o Excel.

---

## 📐 Arquitectura del Sistema

El sistema sigue una arquitectura distribuida de tres servicios independientes y una base de datos centralizada:

```
                    ┌─────────────────────────┐
                    │  Navegador (usuarios)   │
                    └────────────┬────────────┘
                                 │  https
                                 ▼
                ┌──────────────────────────────────┐
                │     Frontend (React + Vite)      │   --> Desplegado en Vercel
                │  sistema-contable-nexus.vercel   │
                └────────────────┬─────────────────┘
                                 │  /api/* (rewrite Vercel)
                                 ▼
                ┌──────────────────────────────────┐
                │    Backend (Node + Express 5)    │   --> Hospedado en Render (Free)
                │  sistema-contable-nexus.onrender │
                └────────┬─────────────┬───────────┘
                         │             │
             ┌────────────┘             └───────────────┐
             ▼                                          ▼
   ┌───────────────────┐                ┌──────────────────────────┐
   │ Turso (libSQL DB) │                │  Motor IA (FastAPI / Py) │   --> Hospedado en Render (Free)
   └───────────────────┘                │  motor-ai-nexus.onrender │
                                        └────────────┬─────────────┘
                                                     │
                                                     │  callback HTTP autenticado
                                                     ▼
                                        (vuelve al backend Node para
                                         leer libro mayor / cuentas)
```

> **Nota sobre el rendimiento (cold start)**: el workflow de GitHub Actions mantiene ambos servicios de Render despiertos en la franja de 08:00 a 19:59, hora de Bolivia; fuera de ella pueden dormir. Con pings cada 10 min y 15 min hasta el spin-down, esa franja consume aproximadamente 725 h en 30 días o 749 h en 31 días de la cuota compartida de 750 h por workspace. En un mes de 31 días casi no hay margen para tráfico fuera de horario. El backend también revisa el motor Python mientras Node está activo y los ajustes reintentan el warmup, pero esto no elimina el cold start ni garantiza que todo servicio responda a tiempo. Ver [ARCHITECTURE.md](ARCHITECTURE.md#3-despliegue-y-cold-start).

---

## 🤖 El Componente de Inteligencia Artificial

Es fundamental distinguir las dos capas de Inteligencia Artificial presentes en el repositorio:

### 1. Motor de Ajustes Contables (`ai_adjustment_engine.py`) 🟢 *ACTIVO Y EN PRODUCCIÓN*
- Es la lógica central contable que sí procesa la base de datos.
- Realiza el cálculo matemático y de prorrateo mensual para la **depreciación de activos fijos**, revaluaciones monetarias y ajustes por inflación (**AITB**) siguiendo trayectorias diarias de UFV e índices cambiarios.
- Interactúa directamente a través de los endpoints `/api/ai/adjustments/*` y el asistente de la Hoja de Trabajo (`AdjustmentWizard.jsx`). **Este motor es estable e intocable.**

### 2. Mahoraga 🟡 *EXPERIMENTAL; NO ES UN ASISTENTE INTEGRAL*
- La pestaña de Configuración combina controles parciales, indicadores derivados de la base de datos y un catálogo técnico de funciones. El modo y el historial de activaciones tienen persistencia parcial en Turso; esto no equivale a un asistente conversacional ni a una autonomía contable funcional.
- El catálogo `skills_output_combined.json` es un inventario AST con poca o ninguna descripción semántica. El endpoint de ejecución depende de `vm2`, que no está declarado/instalado en este repositorio; no debe considerarse una función disponible.
- `MAHORAGA.md` describe qué funciona, qué es solo scaffolding y una ruta segura para una implementación futura. La rueda (`MahoragaWheel.jsx`) se conserva por decisión del usuario.

### 3. Importador universal 🟡 *PILOTO OPT-IN; NO UNIVERSAL AÚN*
- El importador clásico sigue siendo el predeterminado. El nuevo `UniversalImportWizard` se abre explícitamente desde **Importar (nuevo)**; no se ha aprobado retirar el clásico ni cambiar el predeterminado.
- El nuevo flujo analiza, valida y prepara un contrato revisable antes de escribir. El guard deriva los planes PUCT multicolumna al asistente clásico. DASH, ASFI y VARLEN tienen bitácoras piloto; las tres proceden de hojas de un mismo libro Excel, así que todavía no prueban cobertura universal de formatos y fuentes.
- En el piloto de septiembre, DASH (235 cuentas) y VARLEN (576) tienen recibos en bitácora. ASFI (2859 nodos analizados) no tiene evento `result`; no se puede afirmar que esa importación terminara correctamente. El detalle y los pasos para seguir probando están en [ANALISIS_PILOTO_U9.md](ANALISIS_PILOTO_U9.md) y [U9_CONTROLLED_ROLLOUT_DESIGN.md](U9_CONTROLLED_ROLLOUT_DESIGN.md).
- El baseline congelado y la migración de Fase 6 son documentos distintos: [UNIVERSAL_IMPORT_ENGINE_BASELINE.md](UNIVERSAL_IMPORT_ENGINE_BASELINE.md) fija invariantes y limitaciones; [IMPORT_WIZARD_MIGRATION_DESIGN.md](IMPORT_WIZARD_MIGRATION_DESIGN.md) conserva el diseño aprobado solo como diseño.

---

## 🛠️ Requisitos de Instalación

Asegúrate de contar con los siguientes elementos instalados en tu entorno local:
- **Node.js** (Versión 22 o superior recomendada).
- **Python** (Versión 3.10 o superior).
- **Git** (Para clonar el repositorio).

---

## 🚀 Guía de Instalación y Ejecución Local

### Paso 1: Clonar el Repositorio
```bash
git clone https://github.com/Sebitas13/Sistema-Contable-NEXUS.git
cd "Sistema Contable"
```

### Paso 2: Configurar e Iniciar el Backend (Node/Express)
1. Navega al directorio del servidor:
   ```bash
   cd web-app/server
   ```
2. Instala las dependencias necesarias:
   ```bash
   npm install
   ```
3. Crea un archivo `.env` en `web-app/server/.env` basándote en la siguiente plantilla:
   ```env
   PORT=3001
   AI_ENGINE_URL=http://localhost:8000
   TURSO_DATABASE_URL=libsql://tu-db.turso.io
   TURSO_AUTH_TOKEN=tu_token_turso
   APP_PASSWORD=tu_clave_de_acceso_segura
   FRONTEND_ORIGIN=http://localhost:5173
   ```
4. El esquema se inicializa automáticamente al arrancar desde `web-app/server/db/schema.sql`.
   Ya no hay migración manual con `sqlite3`.
5. Vuelve a la raíz del proyecto e inicia el servidor de desarrollo:
   ```bash
   cd ../..
   npm run start:server
   ```

### Paso 3: Configurar e Iniciar el Frontend (React/Vite)
1. Abre una nueva terminal en el directorio raíz del proyecto y navega al cliente:
   ```bash
   cd web-app/client
   ```
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. Crea un archivo `.env` en `web-app/client/.env`:
   ```env
   VITE_API_URL=http://localhost:3001
   ```
4. Ejecuta el servidor del frontend:
   ```bash
   npm run dev
   ```
   *(El cliente estará disponible en `http://localhost:5173`)*.

### Paso 4: Configurar e Iniciar el Motor IA (Python/FastAPI)
1. Abre una nueva terminal en el directorio raíz del proyecto:
   ```bash
   # Crear un entorno virtual
   python -m venv venv
   
   # Activar el entorno virtual
   # En Windows (PowerShell):
   .\venv\Scripts\Activate.ps1
   # En macOS/Linux:
   source venv/bin/activate
   ```
2. Instala las dependencias de Python:
   ```bash
   pip install -r requirements.txt
   ```
3. Crea el archivo `.env` en la raíz del proyecto para el motor IA:
   ```env
   APP_PASSWORD=tu_clave_de_acceso_segura
   GROQ_API_KEY=tu_api_key_de_groq_aqui
   LLM_ENDPOINT=https://api.groq.com/openai/v1
   LLM_MODEL=llama-3.1-8b-instant
   ```
4. Inicia el motor de IA en el puerto 8000:
   ```bash
   uvicorn ai_adjustment_engine:app --reload --host 0.0.0.0 --port 8000
   ```

---

## 💾 El Escudo del General (Backup y Restauración)

Para garantizar la seguridad de tus datos contables e históricos de IA, el sistema incluye un asistente de Backups robusto:
- **Exportación**: Genera un empaquetado `.zip` que contiene un archivo `metadata.json` con la suma de verificación (SHA-256) y colecciones JSON independientes para cada una de las tablas del sistema.
- **Importación**: verifica la integridad y restaura de forma **aditiva** con IDs remapeados a una nueva empresa. El JSON descomprimido se procesa en memoria (límite actual: 200 MB sin comprimir); no es una importación streaming. Las pruebas deben hacerse con un backup conocido y verificando los datos de la empresa restaurada.

## Documentación del repositorio

- [ARCHITECTURE.md](ARCHITECTURE.md): componentes, rutas, base de datos y flujos principales.
- [DIAGNOSTICO.md](DIAGNOSTICO.md): auditoría histórica con el estado actual verificado y la deuda pendiente.
- [MAHORAGA.md](MAHORAGA.md): diagnóstico y roadmap del asistente experimental.
- [ANALISIS_PILOTO_U9.md](ANALISIS_PILOTO_U9.md): evidencia real del piloto del importador y lo que aún no se puede concluir.
- [AGENTS.md](AGENTS.md): mapa breve del repositorio, comandos y reglas de mantenimiento.

---

## ⚖️ Licencia y Términos de Uso

Este software es **propiedad privada** y de código cerrado. Todos los derechos se encuentran reservados. 

Queda prohibida su copia, reproducción, modificación, distribución, uso comercial o despliegue en servidores públicos sin la **autorización previa y explícita por escrito** de su propietario y autor principal.

---
*Desarrollado con ❤️ para la excelencia contable por Sebitas.*
