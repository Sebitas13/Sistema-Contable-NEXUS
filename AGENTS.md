# AGENTS.md - Sistema Contable Project Guidelines

## Build, Lint, and Test Commands

### JavaScript/Node.js Commands
```bash
# Start development server (auto-restarts on changes)
npm run start:server

# Start client development server
npm run start:client

# Run single test file
node web-app/server/test_orchestrator.js
node test_groq_integration.js

# Run analysis scripts
npm run analyze  # python analyze_excel.py
```

### Python/FastAPI Commands
```bash
# Install dependencies
pip install -r requirements.txt

# Run FastAPI server (from project root)
uvicorn ai_adjustment_engine:app --reload --host 0.0.0.0 --port 8000
```

### Database
```bash
# Database location: web-app/server/db/accounting.db (SQLite3)
# Schema file: web-app/server/db/schema.sql
```

---

## Code Style Guidelines

### JavaScript Conventions

**Imports:**
```javascript
// Use CommonJS require (project standard)
const express = require('express');
const db = require('./db');  // Relative imports with .js extension

// Group imports: built-in first, then third-party, then local
```

**Naming:**
- `camelCase` for variables and functions: `calculateTotal()`, `ufvValue`
- `PascalCase` for classes: `CognitiveOrchestrator`, `AccountService`
- `SCREAMING_SNAKE_CASE` for constants: `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT`
- Descriptive Spanish variable names accepted: `montoTotal`, `saldoCuenta`

**Formatting:**
- 4-space indentation (or 2 spaces - match surrounding code)
- Semicolons at end of statements
- Line length ~100 characters
- Template literals for string interpolation: `Server running on http://localhost:${PORT}`

**Error Handling:**
```javascript
try {
    // Async operations with await
    const result = await someAsyncCall();
} catch (error) {
    console.error('Descriptive error:', error.message);
    console.error('Stack:', error.stack);
    throw error;  // Re-throw for caller handling
}
```

**Async/Await:**
- Always wrap async operations in try/catch
- Use `require.main === module` pattern for direct script execution
- Export test functions for module reuse

### Python Conventions

**Imports:**
```python
# Standard library first, then third-party, then local
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Optional
```

**Naming:**
- `snake_case` for functions and variables: `calculate_total()`, `ufv_value`
- `PascalCase` for classes: `AdjustmentRequest`, `AccountModel`
- Private methods start with `_`: `_internal_helper()`

**Type Hints (Pydantic):**
```python
class Account(BaseModel):
    code: str = Field(..., description="Código de cuenta contable")
    name: str = Field(..., description="Nombre de cuenta")
    balance: float = Field(..., description="Saldo pre-ajuste")
    type: Optional[str] = Field(None, description="Tipo contable básico")
```

**Error Handling:**
```python
try:
    result = await process_adjustment(request)
except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e))
except Exception as e:
    raise HTTPException(status_code=500, detail="Internal error")
```

---

## Project Structure

```
Sistema Contable/
├── web-app/
│   ├── server/
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # Business logic
│   │   ├── utils/          # Helper functions
│   │   ├── db/            # SQLite database
│   │   └── index.js       # Entry point (port 3001)
│   └── client/            # Frontend (if exists)
├── scripts/               # Utility scripts
├── PUCT/                  # Plan de Cuentas Uniforme Tributario
├── DataForgeDocs/         # Documentation
├── ai_adjustment_engine.py # FastAPI AI service (port 8000)
└── package.json
```

**Key Routes:**
- `/api/transactions` - Transaction management
- `/api/accounts` - Account plan operations
- `/api/ufv` - UFV values handling
- `/api/companies` - Multi-tenant company support
- `/api/reports` - Financial reports
- `/api/ai/*` - AI/ML inference endpoints

---

## Development Notes

**Environment Variables (.env):**
- `PORT` - Server port (default 3001)
- `AI_BACKEND` - AI provider (groq, local)
- `GROQ_API_KEY` - Required for AI features
- `ENABLE_AI` - Enable/disable AI routes

**Database:**
- SQLite3 at `web-app/server/db/accounting.db`
- Schema in `web-app/server/db/schema.sql`
- Use `require('./db')` for shared connection

**AI Integration:**
- Uses Groq SDK for LLM inference
- Skill system: `skillLoader.loadSkills()` on startup
- Cognitive orchestrator for multi-step AI workflows

**Testing:**
- No formal test framework (Jest/Vitest not configured)
- Manual test scripts in project root
- Run individual test files with `node <filename>`

---

## Important Considerations

1. **Spanish Language**: Project uses Spanish for comments, console output, user-facing messages
2. **Bolivian Accounting**: NC-3, NC-6 compliance; UFV adjustments; PUCT code structure
3. **Multi-tenant**: Most endpoints expect `companyId` parameter
4. **No Formal Testing**: Add Jest/Vitest for unit tests, pytest for Python
5. **No ESLint/Prettier**: Consider adding for code quality enforcement
6. **Hot Reload**: Use `nodemon` for JS, `--reload` for FastAPI
