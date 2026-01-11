const { createClient } = require('@libsql/client');
require('dotenv').config();

// CONFIGURACIÓN (Intenta leer variables, si no usa las strings)
// IMPORTANTE: ¡Actualiza este token en Render si generas uno nuevo!
const dbTurso = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://nexus-db-sebitas13.aws-us-west-2.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NjgxNDQyMDQsImlkIjoiNjUyODNjOWItOWE2ZS00MmEyLWI0Y2UtNDY3NzY3NWM4NjNjIiwicmlkIjoiYmU4MjdhNDgtNjFmNi00NzQ1LWEwZjgtZWFjNmE2MzkzNjJkIn0.ouDmTK_6F60Iq_1Ost0vdvXdAlUPUxCoe5ZBD6lYlFhK8FOh8I4ZgOIl3n6rLKZMANeL0092Y-9slfUZ-j0vAg", 
});

// ADAPTADOR UNIVERSAL (Ahora incluye serialize)
const db = {
  // 1. Mock para "on"
  on: (event, callback) => {
    return this; 
  },
  
  // 2. Mock para "configure"
  configure: () => { 
    return this; 
  },

  // 3. LA SOLUCIÓN AL ERROR ACTUAL: Mock para "serialize"
  // Simplemente ejecutamos la función que trae adentro inmediatamente.
  serialize: (callback) => {
    if (callback) callback();
  },

  // 4. Métodos reales de Base de Datos
  exec: async (sql, callback) => {
    try {
      await dbTurso.executeMultiple(sql);
      if (callback) callback(null);
    } catch (err) {
      console.error("[Turso Exec Error]", err);
      if (callback) callback(err);
    }
  },
  all: async (sql, params, callback) => {
    if (typeof params === 'function') { callback = params; params = []; }
    try {
      const rs = await dbTurso.execute({ sql, args: params || [] });
      if (callback) callback(null, rs.rows);
    } catch (err) {
      console.error("[Turso All Error]", err);
      if (callback) callback(err, null);
    }
  },
  run: async (sql, params, callback) => {
    if (typeof params === 'function') { callback = params; params = []; }
    try {
      const rs = await dbTurso.execute({ sql, args: params || [] });
      const context = { lastID: Number(rs.lastInsertRowid), changes: rs.rowsAffected };
      if (callback) callback.call(context, null);
    } catch (err) {
      console.error("[Turso Run Error]", err);
      if (callback) callback(err);
    }
  },
  get: async (sql, params, callback) => {
    if (typeof params === 'function') { callback = params; params = []; }
    try {
        const rs = await dbTurso.execute({ sql, args: params || [] });
        if (callback) callback(null, rs.rows[0]);
    } catch (err) {
        if (callback) callback(err, null);
    }
  }
};

// Inicializador de Schema
const path = require('path');
const fs = require('fs');
const schemaPath = path.resolve(__dirname, 'schema.sql');

if (fs.existsSync(schemaPath)) {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  setTimeout(() => {
      db.exec(schema, (err) => {
        if (err) console.error('Error Schema Turso:', err);
        else console.log('✅ Base de datos Turso Sincronizada y lista.');
      });
  }, 1000);
}

module.exports = db;
