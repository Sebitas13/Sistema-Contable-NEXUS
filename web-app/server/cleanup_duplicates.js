// Script para limpiar duplicados de cronología Mahoraga
const db = require('./db');

console.log('🧹 Limpiando duplicados de cronología Mahoraga...');

db.run(
  `DELETE FROM mahoraga_adaptation_events 
   WHERE id NOT IN (
     SELECT MAX(id) FROM mahoraga_adaptation_events GROUP BY account_name
   )`,
  function(err) {
    if (err) {
      console.error('❌ Error:', err.message);
    } else {
      console.log(`✅ Limpiados ${this.changes} eventos duplicados`);
    }
    process.exit();
  }
);
