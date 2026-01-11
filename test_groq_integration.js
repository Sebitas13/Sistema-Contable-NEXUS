/**
 * Script de prueba para verificar la integración de Groq API
 */
require('dotenv').config();
const { inferWithModel } = require('./web-app/server/services/modelServiceAdapter');

async function testGroqIntegration() {
    console.log('🧪 Probando integración de Groq API...\n');

    // Verificar configuración
    console.log('📋 Configuración actual:');
    console.log(`   AI_BACKEND: ${process.env.AI_BACKEND || 'local'}`);
    console.log(`   LLM_ENDPOINT: ${process.env.LLM_ENDPOINT || 'https://api.groq.com/openai/v1'}`);
    console.log(`   LLM_MODEL: ${process.env.LLM_MODEL || 'llama-3.1-8b-instant'}`);
    console.log(`   GROQ_API_KEY presente: ${!!process.env.GROQ_API_KEY}\n`);

    // Datos de prueba
    const testAccounts = [
        { code: '1.1.01.001', name: 'Edificio Administrativo' },
        { code: '1.1.02.001', name: 'Vehículos' },
        { code: '2.1.01.001', name: 'Proveedores Nacionales' }
    ];

    const input = {
        accounts: testAccounts,
        context: { companyId: '1' }
    };

    try {
        console.log('🚀 Ejecutando inferWithModel...');
        const result = await inferWithModel(input);

        console.log('✅ Resultado obtenido:');
        console.log(`   Análisis completado: ${!!result.analysis}`);
        console.log(`   Predicciones generadas: ${result.predictions.length}`);
        console.log(`   Duración: ${result.metadata.duration_ms}ms\n`);

        if (result.predictions.length > 0) {
            console.log('📊 Primeras predicciones:');
            result.predictions.slice(0, 3).forEach(pred => {
                console.log(`   ${pred.code}: ${pred.predicted_type} (conf: ${pred.confidence})`);
            });
        }

        console.log('\n🎉 ¡Integración exitosa!');

    } catch (error) {
        console.error('❌ Error en la integración:', error.message);

        if (error.message.includes('GROQ_API_KEY')) {
            console.log('\n💡 Solución: Configurar variable de entorno GROQ_API_KEY');
            console.log('   En Windows: set GROQ_API_KEY=tu_api_key_aqui');
            console.log('   O crear archivo .env con: GROQ_API_KEY=tu_api_key_aqui');
        }
    }
}

// Ejecutar prueba
testGroqIntegration();
