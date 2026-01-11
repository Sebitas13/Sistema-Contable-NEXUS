const express = require('express');
const cors = require('cors');
const db = require('./db'); // Importar la conexión compartida

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
const allowedOrigins = [
  'https://sistemacontablenexus.vercel.app',
  'http://localhost:3000', // Para que sigas pudiendo probar en tu laptop
  'http://localhost:5173'  // Por si usas Vite localmente
];

app.use(cors({
  origin: function (origin, callback) {
    // Permitir peticiones sin origen (como apps móviles o curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'El permiso CORS para este origen es denegado.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));
app.use(express.json());

// Esperar a que la DB esté lista (opcional, para log visual)
db.on('open', () => {
    console.log('Database connection established via shared module.');
});

// Routes
const transactionsRouter = require('./routes/transactions');
const reportsRouter = require('./routes/reports');
const accountsRouter = require('./routes/accounts');
const ufvRouter = require('./routes/ufv');
const companiesRouter = require('./routes/companies');
const exchangeRatesRouter = require('./routes/exchange_rates');
const skillsRouter = require('./routes/skills');
const backupRouter = require('./routes/backup');
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

// Knowledge Brain Routes (Mahoraga's Understanding)
try {
    const knowledgeRouter = require('./routes/knowledge');
    app.use('/api/knowledge', knowledgeRouter);
    console.log('Knowledge Brain registered at /api/knowledge');

    // AI Knowledge Bridge (for Python engine)
    const aiKnowledgeRouter = require('./routes/aiKnowledge');
    app.use('/api/ai/knowledge', aiKnowledgeRouter);
    console.log('AI Knowledge Bridge registered at /api/ai/knowledge');
} catch (e) {
    console.warn('Knowledge router could not be registered:', e.message);
}

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
