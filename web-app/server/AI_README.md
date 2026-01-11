AI integration helper files

Files added:
- services/modelServiceAdapter.js  -> adapter to run local analysis or call an LLM; optional Postgres audit logging.
- routes/ai.js                    -> Express router exposing /api/ai/analyze and /api/ai/feedback (not registered by default).
- sql/ai_audit_logs.sql           -> Postgres schema for audit logs.
- client/src/utils/onnxClient.js  -> client-side ONNX Runtime Web quick scoring example.
- scripts/test_levels.js & fixtures -> small local runner to validate AccountPlanProfile levels.

How to integrate (server):
1) Register router in your Express app (web-app/server/index.js or similar):
   const aiRouter = require('./routes/ai');
   app.use('/api/ai', aiRouter);

2) Optional: set environment variables for enhanced behavior:
   - POSTGRES_URL=postgresql://user:pass@host:5432/dbname
   - AI_BACKEND=llm  # or 'local'
   - OPENAI_API_KEY=...

3) Create the Postgres table (if using Postgres audit):
   psql < web-app/server/sql/ai_audit_logs.sql

Client-side ONNX usage:
- Install: npm install onnxruntime-web
- Host your quantized model under client/public/models/account_classifier.onnx
- Call `quickScore(features, '/models/account_classifier.onnx')` to get probabilities.

Notes:
- The adaptor implements defensive fallbacks (local heuristics) so nothing breaks if no API keys or DB are present.
- Active learning pipeline is out-of-scope here; /api/ai/feedback stores/echoes corrections for later processing.
