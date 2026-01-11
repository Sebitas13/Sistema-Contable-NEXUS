const { createClient } = require('@libsql/client');

// CONFIGURACIÓN DE TURSO
const dbTurso = createClient({
  url: "libsql://nexus-db-sebitas13.aws-us-west-2.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NjgxNDQyMDQsImlkIjoiNjUyODNjOWItOWE2ZS00MmEyLWI0Y2UtNDY3NzY3NWM4NjNjIiwicmlkIjoiYmU4MjdhNDgtNjFmNi00NzQ1LWEwZjgtZWFjNmE2MzkzNjJkIn0.ouDmTK_6F60Iq_1Ost0vdvXdAlUPUxCoe5ZBD6lYlFhK8FOh8I4ZgOIl3n6rLKZMANeL0092Y-9slfUZ-j0vAg",
});

// ADAPTADOR: Esto hace que Turso se comporte como el viejo sqlite3
const db = {
  // Simula db.exec (para el schema)
  exec: async (sql, callback) => {
    try {
      await dbTurso.executeMultiple(sql);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  },
  // Simula db.all (para SELECTs)
  all: async (sql, params, callback) => {
    // Si no mandas params y solo el callback
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    try {
      const rs = await dbTurso.execute({ sql, args: params || [] });
      if (callback) callback(null, rs.rows);
    } catch (err) {
      if (callback) callback(err, null);
    }
  },
  // Simula db.run (para INSERT, UPDATE, DELETE)
  run: async (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    try {
      const rs = await dbTurso.execute({ sql, args: params || [] });
      if (callback) callback(null, { lastID: Number(rs.lastInsertRowid), changes: rs.rowsAffected });
    } catch (err) {
      if (callback) callback(err);
    }
  }
};

// Inicialización del Schema (Copiado de tu código original)
const path = require('path');
const fs = require('fs');

const schemaPath = path.resolve(__dirname, 'schema.sql');
if (fs.existsSync(schemaPath)) {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema, (err) => {
    if (err) console.error('Error al iniciar Turso Schema:', err);
    else console.log('Base de datos Turso lista y sincronizada.');
  });
}

module.exports = db;
