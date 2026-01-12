# 📋 Guía de Integración y Armonización

## 🔍 ANÁLISIS DE CONFLICTOS RESUELTOS

### ✅ CONFLICTO #1: `db.js` vs `connectionManager.js`
**PROBLEMA:** Doble inicialización de LibSQL
**SOLUCIÓN:** `connectionManager.js` ahora usa el cliente existente de `db.js`
**ESTADO:** ✅ RESUELTO

### ✅ CONFLICTO #2: `index.js` vs `corsConfig.js`
**PROBLEMA:** Doble configuración CORS
**SOLUCIÓN:** `corsConfig.js` tiene `shouldUseDynamicCors()` para elegir cuál usar
**ESTADO:** ✅ RESUELTO

---

## 🛡️ SEGURIDAD IMPLEMENTADA

### 1. Data Cleaning (`dataCleaner.js`)
- ✅ Convierte `undefined` a `null`
- ✅ Valida números y fechas
- ✅ Previene errores de tipo en LibSQL

### 2. Keep-Alive Service (`keepAlive.js`)
- ✅ Health checks cada 14 minutos
- ✅ Reintentos con backoff exponencial
- ✅ Timeouts configurables (30 segundos)

### 3. CORS Dinámico (`corsConfig.js`)
- ✅ Soporte multi-plataforma (Vercel, Render, Local)
- ✅ Wildcard para subdominios
- ✅ Modo condicional (`USE_DYNAMIC_CORS`)

### 4. Connection Manager (`connectionManager.js`)
- ✅ Usa cliente existente de `db.js`
- ✅ Batch operations eficientes
- ✅ Health monitoring

### 5. JSON Serializer (`jsonSerializer.js`)
- ✅ Formato de fechas ISO 8601
- ✅ Sanitización de valores monetarios
- ✅ Manejo seguro de BigInt

---

## 🔧 CÓMO USAR LAS UTILIDADES

### En tus rutas existentes:

```javascript
// Importar utilidades
const { 
    cleanObject, 
    validateUFVValue,
    formatDateForDB,
    prepareForPython 
} = require('../utils');

// Usar en POST /bulk
router.post('/bulk', async (req, res) => {
    const { data, companyId } = req.body;
    
    // Limpiar datos antes de enviar a DB
    const cleanData = cleanArray(data);
    
    try {
        await db.run('BEGIN TRANSACTION');
        
        for (const item of cleanData) {
            const sql = 'INSERT INTO ufv_rates (company_id, date, value) VALUES (?, ?, ?)';
            const params = [
                companyId,
                formatDateForDB(item.date),
                validateUFVValue(item.value)
            ];
            
            await db.run(sql, params);
        }
        
        await db.run('COMMIT');
        res.json({ success: true, message: 'Bulk import completed' });
        
    } catch (error) {
        await db.run('ROLLBACK');
        res.status(500).json({ error: error.message });
    }
});
```

### Para comunicación con Python:

```javascript
const { keepAlive, prepareForPython } = require('../utils');

// Llamada a Python con reintentos
const response = await keepAlive.makeAPICall('POST', `${AI_ENGINE_URL}/adjust`, {
    transactions: prepareForPython(transactions),
    companyId,
    endDate: new Date().toISOString().split('T')[0]
});

// Respuesta estandarizada
res.json(prepareForPython(result));
```

### Configuración CORS condicional:

```javascript
// En index.js
const { shouldUseDynamicCors } = require('./utils');

if (shouldUseDynamicCors()) {
    // Usar CORS dinámico para producción
    const { corsMiddleware } = require('./utils');
    app.use(corsMiddleware);
} else {
    // Usar CORS existente para desarrollo
    app.use(cors({
        origin: /^(.*)$/,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        credentials: false
    }));
}
```

---

## 🚀 VARIABLES DE ENTORNO RECOMENDADAS

```bash
# Para producción (Render)
USE_DYNAMIC_CORS=true
NODE_ENV=production
RENDER_URL=https://tu-app.onrender.com

# Para desarrollo (local)
USE_DYNAMIC_CORS=false
NODE_ENV=development

# Para comunicación Python
AI_ENGINE_URL=http://localhost:8000
AI_ENGINE_URL_ALT=http://localhost:8003

# Para base de datos
TURSO_DATABASE_URL=file:./db/accounting.db
TURSO_AUTH_TOKEN=local_dev_token
```

---

## 🔍 VERIFICACIONES ANTES DE DEPLOY

### 1. Test de integración:
```bash
node -e "
const { cleanObject, connectionManager } = require('./utils');
console.log('✅ Data cleaner:', cleanObject({ value: undefined }));
console.log('✅ Connection manager:', await connectionManager.healthCheck());
"
```

### 2. Test de CORS:
```bash
curl -H "Origin: https://sistemacontablenexus.vercel.app" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS \
     http://localhost:3001/api/companies
```

### 3. Test de comunicación Python:
```bash
# Asegurar que Python esté corriendo
curl http://localhost:8000/health

# Probar keep-alive
curl -H "User-Agent: Sistema-Contable-KeepAlive/1.0" \
     http://localhost:3001/api/ai/test-route
```

---

## 📊 ESTADO FINAL

✅ **Todos los conflictos resueltos**
✅ **Utilidades integradas con código existente**
✅ **Seguridad mejorada**
✅ **Compatibilidad LibSQL/SQLite garantizada**
✅ **Comunicación Python robusta**

**LISTO PARA PRODUCCIÓN** 🚀
