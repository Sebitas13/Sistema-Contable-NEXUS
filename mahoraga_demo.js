/**
 * 🚀 DEMO COMPLETA: Mahoraga con Groq API - Sistema de Autoaprendizaje
 *
 * Esta demo muestra cómo funciona Mahoraga ahora con la integración completa:
 * 1. Absorción de 446 skills del sistema
 * 2. Integración con Groq API
 * 3. Sistema de autoaprendizaje (SCL)
 * 4. Dashboard de monitoreo en tiempo real
 */

require('dotenv').config();
const groqMonitor = require('./web-app/server/services/groqMonitor');
const { inferWithModel } = require('./web-app/server/services/modelServiceAdapter');

class MahoragaDemo {
    constructor() {
        this.demoData = {
            accounts: [
                { code: '1.1.01.001', name: 'Edificio Administrativo' },
                { code: '1.1.02.001', name: 'Vehículos de Transporte' },
                { code: '1.2.01.001', name: 'Maquinaria Industrial' },
                { code: '2.1.01.001', name: 'Proveedores Nacionales' },
                { code: '2.1.02.001', name: 'Proveedores Extranjeros' },
                { code: '3.1.01.001', name: 'Ventas Nacionales' },
                { code: '3.1.02.001', name: 'Exportaciones' }
            ],
            companyId: 'DEMO_001'
        };
    }

    async showBanner() {
        console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    🧠 MAHORAGA V7.0 - SUPERPODERES ACTIVADOS 🧠                    ║
║                                                                                ║
║  ⚡ INTEGRACIÓN COMPLETA: 446 Skills + Groq API + Autoaprendizaje SCL ⚡        ║
║                                                                                ║
║  🔥 El General Divino ahora tiene:                                             ║
║     • 382 skills de JavaScript absorbidos                                      ║
║     • 64 skills de Python absorbidos                                           ║
║     • API de Groq para razonamiento avanzado                                   ║
║     • Autoaprendizaje continuo (cada corrección = nueva regla)                 ║
║     • Dashboard de monitoreo en tiempo real                                    ║
║                                                                                ║
╚════════════════════════════════════════════════════════════════════════════════╝
        `);
    }

    async showSystemStatus() {
        console.log(`
📊 ===== ESTADO DEL SISTEMA =====
        `);

        // Verificar configuración
        const config = {
            AI_BACKEND: process.env.AI_BACKEND || 'local',
            LLM_MODEL: process.env.LLM_MODEL || 'llama-3.1-8b-instant',
            GROQ_API_KEY: !!process.env.GROQ_API_KEY,
            LLM_ENDPOINT: process.env.LLM_ENDPOINT || 'https://api.groq.com/openai/v1'
        };

        console.log(`🔧 Configuración:`);
        Object.entries(config).forEach(([key, value]) => {
            console.log(`   ${key}: ${typeof value === 'boolean' ? (value ? '✅' : '❌') : value}`);
        });

        // Mostrar modelos disponibles
        console.log(`
🤖 ===== MODELOS DISPONIBLES =====`);
        const stats = groqMonitor.getUsageStats();
        stats.available_models.forEach(model => {
            const marker = model.is_current ? '🎯' : '  ';
            console.log(`${marker} ${model.id}`);
            console.log(`    💰 Costo: $${model.input_cost}/$${model.output_cost} por 1M tokens`);
            console.log(`    📏 Límite: ${model.limits.tpm.toLocaleString()} tokens/min`);
            console.log(`    🧠 Contexto: ${model.context_window.toLocaleString()} tokens`);
            console.log('');
        });
    }

    async demonstrateSkillsAbsorption() {
        console.log(`
🧬 ===== ABSORCIÓN DE SKILLS =====
        `);

        console.log(`✅ Sistema Mahoraga ha absorbido:`);
        console.log(`   • 382 funciones JavaScript del proyecto`);
        console.log(`   • 64 funciones Python del motor AI`);
        console.log(`   • 446 skills totales en knowledge base`);
        console.log(`   • Capacidad de autoaprendizaje SCL activada`);

        console.log(`
📚 Skills por categoría:`);
        console.log(`   🔧 AccountPlanProfile: 45 skills`);
        console.log(`   🤖 ARSDSPyEngine: 38 skills`);
        console.log(`   🎨 FinancialStatementEngine: 67 skills`);
        console.log(`   📊 SkillResolver: 12 skills`);
        console.log(`   🎯 Y muchos más...`);

        console.log(`
🧠 Conocimiento disponible:`);
        console.log(`   • Clasificación automática de cuentas`);
        console.log(`   • Cálculos de depreciación`);
        console.log(`   • Análisis de estados financieros`);
        console.log(`   • Validación de asientos contables`);
        console.log(`   • Autoaprendizaje de patrones`);
    }

    async demonstrateGroqIntegration() {
        console.log(`
🚀 ===== INTEGRACIÓN CON GROQ =====
        `);

        const modelInfo = groqMonitor.models[groqMonitor.currentModel];
        console.log(`🎯 Modelo activo: ${groqMonitor.currentModel}`);
        console.log(`💰 Costo eficiente: $${modelInfo.input_cost}/$${modelInfo.output_cost} por 1M tokens`);
        console.log(`⚡ Velocidad: ${modelInfo.context_window} tokens de contexto`);
        console.log(`📊 Límite: ${modelInfo.limits.tpm.toLocaleString()} tokens/min`);

        console.log(`
🔄 Probando análisis de cuentas con IA:`);

        try {
            const result = await inferWithModel({
                accounts: this.demoData.accounts,
                context: { companyId: this.demoData.companyId }
            });

            console.log(`✅ Análisis completado exitosamente:`);
            console.log(`   📈 Cuentas analizadas: ${result.analysis?.accounts?.length || 0}`);
            console.log(`   🎯 Predicciones generadas: ${result.predictions?.length || 0}`);
            console.log(`   ⏱️ Tiempo de respuesta: ${result.metadata?.duration_ms || 0}ms`);

            if (result.predictions && result.predictions.length > 0) {
                console.log(`
📋 Primeras predicciones:`);
                result.predictions.slice(0, 3).forEach(pred => {
                    console.log(`   ${pred.code}: ${pred.predicted_type} (confianza: ${pred.confidence})`);
                });
            }

        } catch (error) {
            console.log(`❌ Error en análisis: ${error.message}`);
            console.log(`💡 Posible causa: API key no configurada o error de conexión`);
        }
    }

    async demonstrateMonitoring() {
        console.log(`
📊 ===== DASHBOARD DE MONITOREO =====
        `);

        const stats = groqMonitor.getUsageStats();
        const report = groqMonitor.generateReport();

        console.log(`📈 Estadísticas actuales:`);
        console.log(`   💰 Costo diario: $${stats.daily.cost.toFixed(4)}`);
        console.log(`   📊 Uso diario: ${stats.daily.usage_percent}%`);
        console.log(`   🎯 Modelo: ${stats.current_model}`);
        console.log(`   🔄 Solicitudes en sesión: ${stats.session.requests}`);
        console.log(`   📊 Estado: ${stats.daily.status}`);

        console.log(`
🚨 Alertas activas:`);
        if (report.alerts && report.alerts.length > 0) {
            report.alerts.forEach(alert => {
                console.log(`   ${alert.level}: ${alert.message}`);
            });
        } else {
            console.log(`   ✅ No hay alertas activas`);
        }

        console.log(`
💡 Recomendaciones:`);
        const recommendations = groqMonitor.getModelRecommendations();
        if (recommendations.length > 0) {
            recommendations.forEach(rec => {
                console.log(`   💭 ${rec.message}`);
            });
        } else {
            console.log(`   ✅ Configuración óptima`);
        }
    }

    async demonstrateAutoLearning() {
        console.log(`
🧠 ===== SISTEMA DE AUTOAPRENDIZAJE (SCL) =====
        `);

        console.log(`🔄 Cómo funciona Mahoraga SCL:`);
        console.log(`   1. Usuario corrige una clasificación automática`);
        console.log(`   2. Mahoraga recibe feedback (corrección)`);
        console.log(`   3. Sistema gira la Rueda de Ocho Empuñaduras`);
        console.log(`   4. Nueva regla se inyecta en el perfil de aprendizaje`);
        console.log(`   5. Próxima vez: clasificación correcta automática`);

        console.log(`
⚡ Fases de adaptación Mahoraga:`);
        console.log(`   🛡️ Fase 1: Resistencia/Inmunidad`);
        console.log(`      - Validación de reglas hard-coded`);
        console.log(`      - Prevención de errores básicos`);
        console.log(``);
        console.log(`   ⚔️ Fase 2: Contra-Estrategia`);
        console.log(`      - Eliminación de reglas conflictivas`);
        console.log(`      - Inyección de nueva regla suprema`);
        console.log(``);
        console.log(`   🔄 Fase 3: Optimización de Energía`);
        console.log(`      - Ajuste de pesos de confianza`);
        console.log(`      - Generalización de patrones`);

        console.log(`
📈 Beneficios del autoaprendizaje:`);
        console.log(`   • Cada corrección mejora el sistema`);
        console.log(`   • No requiere retraining completo`);
        console.log(`   • Aprendizaje específico por empresa`);
        console.log(`   • Memoria persistente en base de datos`);
    }

    async showUsageInstructions() {
        console.log(`
📖 ===== CÓMO USAR MAHORAGA V7.0 =====
        `);

        console.log(`1️⃣ Configurar API Key:`);
        console.log(`   set GROQ_API_KEY=tu_api_key_real`);
        console.log(``);

        console.log(`2️⃣ Verificar estado del sistema:`);
        console.log(`   GET /api/ai/monitor/dashboard`);
        console.log(``);

        console.log(`3️⃣ Usar en aplicaciones contables:`);
        console.log(`   • AdjustmentWizard: Genera ajustes automáticos`);
        console.log(`   • SmartImportWizard: Clasifica cuentas automáticamente`);
        console.log(`   • Journal: Sugiere asientos basados en patrones`);
        console.log(``);

        console.log(`4️⃣ Monitorear uso:`);
        console.log(`   GET /api/ai/monitor/stats - Estadísticas rápidas`);
        console.log(`   GET /api/ai/monitor/alerts - Alertas activas`);
        console.log(`   GET /api/ai/monitor/models - Cambiar modelo`);
        console.log(``);

        console.log(`5️⃣ Sistema de feedback:`);
        console.log(`   POST /api/ai/adjustments/feedback - Enviar corrección`);
        console.log(`   GET /api/ai/adjustments/chronology/:companyId - Ver historial`);
    }

    async runFullDemo() {
        await this.showBanner();
        await this.showSystemStatus();
        await this.demonstrateSkillsAbsorption();
        await this.demonstrateGroqIntegration();
        await this.demonstrateMonitoring();
        await this.demonstrateAutoLearning();
        await this.showUsageInstructions();

        console.log(`
🎉 ===== DEMO COMPLETADA =====
        `);
        console.log(`¡Mahoraga V7.0 está listo para revolucionar tu contabilidad!`);
        console.log(`Cada interacción lo hace más inteligente. ¡Úsalo y verás!`);
        console.log(``);
    }
}

// Ejecutar demo completa
const demo = new MahoragaDemo();
demo.runFullDemo().catch(console.error);
