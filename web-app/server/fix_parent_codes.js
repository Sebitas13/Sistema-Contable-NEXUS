const db = require('./db');

/**
 * Script para poblar parent_code en la tabla accounts
 * Basado en la lógica de reports.js
 */
async function fixParentCodes() {
    try {
        console.log('🔧 Iniciando corrección de parent_code...');

        // Obtener todas las cuentas
        const accounts = await new Promise((resolve, reject) => {
            db.all('SELECT id, code, name, level, parent_code FROM accounts ORDER BY code', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        console.log(`📊 Encontradas ${accounts.length} cuentas`);

        let updatedCount = 0;

        for (const acc of accounts) {
            let parentCode = acc.parent_code;

            // Si ya tiene parent_code, saltar
            if (parentCode) continue;

            // Lógica de inferencia
            if (acc.level > 1 && acc.code.length > 1) {
                if (acc.code.includes('.')) {
                    const parts = acc.code.split('.');
                    parts.pop();
                    parentCode = parts.join('.');
                } else if (acc.code.includes('-')) {
                    const parts = acc.code.split('-');
                    parts.pop();
                    parentCode = parts.join('-');
                } else {
                    // Heurística para PUCT boliviano
                    if (acc.code.length === 4) {
                        parentCode = acc.code.substring(0, 2);
                    } else if (acc.code.length === 6) {
                        parentCode = acc.code.substring(0, 4);
                    } else if (acc.code.length === 8) {
                        parentCode = acc.code.substring(0, 6);
                    }
                }
            }

            if (parentCode && parentCode !== acc.parent_code) {
                // Verificar que el padre existe
                const parentExists = accounts.some(a => a.code === parentCode);
                if (parentExists) {
                    await new Promise((resolve, reject) => {
                        db.run('UPDATE accounts SET parent_code = ? WHERE id = ?', [parentCode, acc.id], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                    updatedCount++;
                    console.log(`✅ Actualizado: ${acc.code} -> parent_code: ${parentCode}`);
                } else {
                    console.log(`⚠️ Padre no encontrado para ${acc.code}: ${parentCode}`);
                }
            }
        }

        console.log(`🎉 Proceso completado. Actualizadas ${updatedCount} cuentas.`);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        process.exit(0);
    }
}

fixParentCodes();
