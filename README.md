# Sistema Contable NEXUS (BVR Edition) 🛡️🚀

Sistema contable avanzado multi-empresa diseñado bajo la normativa contable y tributaria de Bolivia. Este sistema automatiza de forma inteligente los **ajustes contables y el cierre fiscal** mediante un motor de Inteligencia Artificial y un sistema robusto de auditoría y feedback.

---

## 🌟 Características Clave

-   **Detección e Indexación de Ajustes**: Motor IA que detecta y propone de forma precisa asientos de depreciación, actualización por inflación (UFV) y provisiones.
-   **Gestión Multi-Empresa Completa**: Configuración dinámica de periodos fiscales según la actividad económica:
    -   *Comercial, Servicios, Bancos y Seguros* (cierre al 31 de Diciembre).
    -   *Industriales, Constructoras y Petroleras* (cierre al 31 de Marzo).
    -   *Gomeras, Castañeras, Agrícolas y Ganaderas* (cierre al 30 de Junio).
    -   *Mineras* (cierre al 30 de Septiembre).
-   **Seguridad y Modos de Autonomía**: Permite controlar el nivel de autonomía de la IA (Manual, Asistida y Autónoma) con interruptores de parada de emergencia.
-   **Sistema de Backup "Escudo del General"**: Importaciones y exportaciones seguras basadas en streaming (`archiver`/`unzipper`), resguardando la integridad referencial de 15 tablas e importando de forma aditiva (nunca sobreescribe datos).
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

> **Nota sobre el rendimiento (Cold-Start)**: Debido a las limitaciones de los servidores gratuitos en Render, si el sistema ha estado inactivo, el motor de ajustes y el backend Express entrarán en estado de reposo. El primer inicio o consulta al motor de IA puede tardar entre 50 y 60 segundos mientras ambos contenedores se reactivan de manera secuencial y bidireccional.

---

## 🤖 El Componente de Inteligencia Artificial

Es fundamental distinguir las dos capas de Inteligencia Artificial presentes en el repositorio:

### 1. Motor de Ajustes Contables (`ai_adjustment_engine.py`) 🟢 *ACTIVO Y EN PRODUCCIÓN*
- Es la lógica central contable que sí procesa la base de datos.
- Realiza el cálculo matemático y de prorrateo mensual para la **depreciación de activos fijos**, revaluaciones monetarias y ajustes por inflación (**AITB**) siguiendo trayectorias diarias de UFV e índices cambiarios.
- Interactúa directamente a través de los endpoints `/api/ai/adjustments/*` y el asistente de la Hoja de Trabajo (`AdjustmentWizard.jsx`). **Este motor es estable e intocable.**

### 2. Asistente Autónomo Mahoraga 🟡 *EXPERIMENTAL / INTERFAZ ESTÉTICA*
- Referencia el diseño a futuro de un agente autónomo de gobernanza (ubicado en la pestaña *Mahoraga* en Configuración).
- Integra una rueda de cognición animada (`MahoragaWheel.jsx`) y botones de interacción visual, pero no cuenta con un motor persistente en el backend (funciona principalmente con datos mockeados en memoria y un catálogo AST estático en `skills_output_combined.json`).
- **Se conserva en el código por su alto valor estético y propósitos de desarrollo futuro.**

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
   TURSO_DATABASE_URL=file:./db/accounting.db
   TURSO_AUTH_TOKEN=your_turso_token_here
   APP_PASSWORD=tu_clave_de_acceso_segura
   FRONTEND_ORIGIN=http://localhost:5173
   ```
4. Ejecuta las migraciones de base de datos para inicializar el esquema SQLite (si no existe):
   ```bash
   node migrate.js
   ```
5. Inicia el servidor de desarrollo:
   ```bash
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
   LLM_MODEL=llama3-70b-8192
   ```
4. Inicia el motor de IA en el puerto 8000:
   ```bash
   uvicorn ai_adjustment_engine:app --reload --host 0.0.0.0 --port 8000
   ```

---

## 💾 El Escudo del General (Backup y Restauración)

Para garantizar la seguridad de tus datos contables e históricos de IA, el sistema incluye un asistente de Backups robusto:
- **Exportación**: Genera un empaquetado `.zip` que contiene un archivo `metadata.json` con la suma de verificación (SHA-256) y colecciones JSON independientes para cada una de las tablas del sistema.
- **Importación**: Procesa el archivo `.zip`, verifica su integridad contra el checksum original y, de ser válido, inserta la información de forma **aditiva**. Mapea secuencialmente todas las claves foráneas (FK) a una nueva entidad de empresa, lo que previene colisiones o pérdidas de datos existentes.

---

## ⚖️ Licencia y Términos de Uso

Este software es **propiedad privada** y de código cerrado. Todos los derechos se encuentran reservados. 

Queda prohibida su copia, reproducción, modificación, distribución, uso comercial o despliegue en servidores públicos sin la **autorización previa y explícita por escrito** de su propietario y autor principal.

---
*Desarrollado con ❤️ para la excelencia contable por Sebitas.*
