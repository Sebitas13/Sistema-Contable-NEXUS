const express = require('express');
const cors = require('cors');
const db = require('./db'); // Importar la conexión compartida

// Importar utilidades nuevas
const { shouldUseDynamicCors, corsMiddleware } = require('./utils');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - CORS dinámico o estático
if (shouldUseDynamicCors()) {
    console.log('🌐 Usando CORS dinámico para producción');
    app.use(corsMiddleware);
} else {
    console.log('🔧 Usando CORS estático para desarrollo');
    app.use(cors({
        origin: /^(.*)$/, // Permite cualquier origen (Vercel, Localhost, etc.)
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        credentials: false // Cambiado a false para evitar conflictos con '*'
    }));
    app.options(/^(.*)$/, (req, res) => {
        res.header('Access-Control-Allow-Origin', /^(.*)$/);
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.sendStatus(200);
    });
}

app.use(express.json());

// --- Autenticación (contraseña única compartida) ---
const authRouter = require('./routes/auth');
const { requireAuth, isAuthRequired } = require('./utils/auth');

// Rutas públicas de login/config (se montan ANTES del gate).
app.use('/api/auth', authRouter);

// Gate de autenticación: protege todas las rutas /api salvo la whitelist.
// Whitelist: /api/status y /api/ai/health (necesarias para los pings de keep-alive
// y para no romper el monitoreo externo). El callback del motor Python a
// /api/reports/ledger pasa el token interno, así que no necesita whitelist.
app.use((req, res, next) => {
    if (req.method === 'GET' && (req.path === '/api/status' || req.path === '/api/ai/health')) {
        return next();
    }
    return requireAuth(req, res, next);
});

if (isAuthRequired()) {
    console.log('🔐 Autenticación ACTIVA (APP_PASSWORD configurada).');
} else {
    console.warn('⚠️  Autenticación DESACTIVADA: define APP_PASSWORD para proteger la app.');
}

// Routes
const transactionsRouter = require('./routes/transactions');
const reportsRouter = require('./routes/reports');
const accountsRouter = require('./routes/accounts');
const ufvRouter = require('./routes/ufv');
const companiesRouter = require('./routes/companies');
const exchangeRatesRouter = require('./routes/exchange_rates');
const skillsRouter = require('./routes/skills');
const backupRouter = require('./routes/backup');
const inventoryRouter = require('./routes/inventory');
const skillLoader = require('./services/skillLoader');

// Inicializar Skill System
console.log('🔮 Inicializando Mahoraga Skill System...');
const skillsLoaded = skillLoader.loadSkills();
if (skillsLoaded) {
  console.log('✅ Skill System inicializado exitosamente');
} else {
  console.log('⚠️ Skill System no pudo cargar skills (archivo no encontrado)');
}

app.use('/api/exchange-rates', exchangeRatesRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/ufv', ufvRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/backup', backupRouter);
app.use('/api/inventory', inventoryRouter);

// Optional AI router (opt-in). Enable by setting environment variable ENABLE_AI=1
// Cambiado a true por defecto para pruebas, o si ENABLE_AI es 1
if (true || (process.env.ENABLE_AI && process.env.ENABLE_AI !== '0')) {
  try {
    // Load base AI routes first
    const aiRouter = require('./routes/ai');
    app.use('/api/ai', aiRouter);
    console.log('AI router registered at /api/ai (ENABLE_AI=1)');

    // Load Cognitive Orchestrator routes (mount under /api/ai/orchestrator to avoid conflicts)
    const orchestratorRouter = require('./routes/orchestrator');
    app.use('/api/ai/orchestrator', orchestratorRouter);
    console.log('Cognitive Orchestrator registered at /api/ai/orchestrator');
  } catch (e) {
    console.warn('AI router could not be registered:', e.message);
  }
}

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Knowledge Brain Routes remain experimental and are disabled by default.
if (process.env.ENABLE_MAHORAGA_EXPERIMENTAL === '1') {
  try {
    const knowledgeRouter = require('./routes/knowledge');
    app.use('/api/knowledge', knowledgeRouter);
    console.log('Knowledge Brain registered at /api/knowledge');

    const aiKnowledgeRouter = require('./routes/aiKnowledge');
    app.use('/api/ai/knowledge', aiKnowledgeRouter);
    console.log('AI Knowledge Bridge registered at /api/ai/knowledge');
  } catch (e) {
    console.warn('Knowledge router could not be registered:', e.message);
  }
} else {
  console.log('Knowledge Brain routes disabled (ENABLE_MAHORAGA_EXPERIMENTAL!=1)');
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Keep-alive interno: mientras el backend Node esté despierto, mantiene caliente al
  // motor Python (ping cada 14 min). NO basta por sí solo (si Node se duerme, deja de
  // pinguear): combinar con el cron externo (.github/workflows/keep-warm.yml) que mantiene
  // despierto también a Node. Desactivable con DISABLE_KEEPALIVE=1.
  if (process.env.DISABLE_KEEPALIVE !== '1') {
    try {
      const { keepAlive } = require('./utils');
      keepAlive.start();
    } catch (e) {
      console.warn('No se pudo iniciar keep-alive:', e.message);
    }
  }
});
