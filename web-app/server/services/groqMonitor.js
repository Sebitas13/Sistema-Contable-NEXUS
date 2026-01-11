/**
 * Monitor de Uso de Groq API - Dashboard de Consumo
 * Sistema para rastrear uso de tokens, costos y límites de la API
 */

class GroqMonitor {
    constructor() {
        this.usageStats = {
            daily: {
                tokens_input: 0,
                tokens_output: 0,
                requests: 0,
                cost: 0,
                last_reset: new Date().toISOString().split('T')[0]
            },
            monthly: {
                tokens_input: 0,
                tokens_output: 0,
                requests: 0,
                cost: 0,
                last_reset: new Date().toISOString().slice(0, 7)
            },
            session: {
                tokens_input: 0,
                tokens_output: 0,
                requests: 0,
                cost: 0,
                start_time: new Date()
            }
        };

        this.models = {
            'llama-3.1-8b-instant': {
                input_cost: 0.05,
                output_cost: 0.08,
                limits: { tpm: 250000, rpm: 1000 },
                context_window: 131072
            },
            'llama-3.3-70b-versatile': {
                input_cost: 0.59,
                output_cost: 0.79,
                limits: { tpm: 300000, rpm: 1000 },
                context_window: 131072
            },
            'openai/gpt-oss-20b': {
                input_cost: 0.075,
                output_cost: 0.30,
                limits: { tpm: 250000, rpm: 1000 },
                context_window: 131072
            },
            'openai/gpt-oss-120b': {
                input_cost: 0.15,
                output_cost: 0.60,
                limits: { tpm: 250000, rpm: 1000 },
                context_window: 131072
            }
        };

        this.currentModel = process.env.LLM_MODEL || 'llama-3.1-8b-instant';
        this.loadPersistedStats();
        this.startAutoReset();
    }

    /**
     * Registra una llamada a la API de Groq
     */
    recordUsage(model, tokensInput, tokensOutput, success = true) {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const thisMonth = now.toISOString().slice(0, 7);

        // Reset diario si es necesario
        if (this.usageStats.daily.last_reset !== today) {
            this.resetDailyStats();
        }

        // Reset mensual si es necesario
        if (this.usageStats.monthly.last_reset !== thisMonth) {
            this.resetMonthlyStats();
        }

        const modelInfo = this.models[model] || this.models[this.currentModel];
        const cost = (tokensInput * modelInfo.input_cost + tokensOutput * modelInfo.output_cost) / 1000000;

        // Actualizar estadísticas
        this.usageStats.daily.tokens_input += tokensInput;
        this.usageStats.daily.tokens_output += tokensOutput;
        this.usageStats.daily.requests += 1;
        this.usageStats.daily.cost += cost;

        this.usageStats.monthly.tokens_input += tokensInput;
        this.usageStats.monthly.tokens_output += tokensOutput;
        this.usageStats.monthly.requests += 1;
        this.usageStats.monthly.cost += cost;

        this.usageStats.session.tokens_input += tokensInput;
        this.usageStats.session.tokens_output += tokensOutput;
        this.usageStats.session.requests += 1;
        this.usageStats.session.cost += cost;

        this.savePersistedStats();

        return {
            cost,
            total_daily_cost: this.usageStats.daily.cost,
            remaining_daily_limit: modelInfo.limits.tpm - this.usageStats.daily.tokens_input
        };
    }

    /**
     * Obtiene estadísticas de uso
     */
    getUsageStats() {
        const modelInfo = this.models[this.currentModel];
        const dailyUsagePercent = (this.usageStats.daily.tokens_input / modelInfo.limits.tpm) * 100;
        const monthlyUsagePercent = (this.usageStats.monthly.tokens_input / (modelInfo.limits.tpm * 30)) * 100;

        return {
            current_model: this.currentModel,
            model_info: modelInfo,
            daily: {
                ...this.usageStats.daily,
                usage_percent: Math.round(dailyUsagePercent * 100) / 100,
                remaining_tokens: Math.max(0, modelInfo.limits.tpm - this.usageStats.daily.tokens_input),
                status: dailyUsagePercent > 90 ? 'WARNING' : dailyUsagePercent > 75 ? 'CAUTION' : 'GOOD'
            },
            monthly: {
                ...this.usageStats.monthly,
                usage_percent: Math.round(monthlyUsagePercent * 100) / 100,
                estimated_monthly_cost: this.usageStats.monthly.cost,
                status: monthlyUsagePercent > 90 ? 'WARNING' : monthlyUsagePercent > 75 ? 'CAUTION' : 'GOOD'
            },
            session: this.usageStats.session,
            available_models: Object.keys(this.models).map(model => ({
                id: model,
                ...this.models[model],
                is_current: model === this.currentModel
            }))
        };
    }

    /**
     * Cambia el modelo activo
     */
    switchModel(newModel) {
        if (this.models[newModel]) {
            this.currentModel = newModel;
            process.env.LLM_MODEL = newModel;
            console.log(`🔄 Modelo cambiado a: ${newModel}`);
            return true;
        }
        return false;
    }

    /**
     * Obtiene recomendaciones de modelo basado en uso
     */
    getModelRecommendations() {
        const currentUsage = this.getUsageStats();
        const recommendations = [];

        // Si el uso diario es alto, recomendar modelo más eficiente
        if (currentUsage.daily.usage_percent > 80) {
            recommendations.push({
                type: 'COST_OPTIMIZATION',
                message: 'Uso alto diario. Considera usar llama-3.1-8b-instant para mayor eficiencia.',
                suggested_model: 'llama-3.1-8b-instant'
            });
        }

        // Si necesitas más capacidad, sugerir modelos premium
        if (currentUsage.daily.usage_percent > 60) {
            recommendations.push({
                type: 'CAPACITY_UPGRADE',
                message: 'Acercándote al límite. Considera openai/gpt-oss-120b para más capacidad.',
                suggested_model: 'openai/gpt-oss-120b'
            });
        }

        // Recomendación por costo
        const cheapestModel = Object.entries(this.models)
            .sort(([,a], [,b]) => (a.input_cost + a.output_cost) - (b.input_cost + b.output_cost))[0][0];

        if (cheapestModel !== this.currentModel) {
            recommendations.push({
                type: 'COST_SAVING',
                message: `Ahorra cambiando a ${cheapestModel} (más económico).`,
                suggested_model: cheapestModel
            });
        }

        return recommendations;
    }

    /**
     * Genera reporte de uso detallado
     */
    generateReport() {
        const stats = this.getUsageStats();
        const recommendations = this.getModelRecommendations();

        return {
            timestamp: new Date().toISOString(),
            summary: {
                current_model: stats.current_model,
                daily_cost: `$${stats.daily.cost.toFixed(4)}`,
                monthly_cost: `$${stats.monthly.cost.toFixed(4)}`,
                daily_usage: `${stats.daily.usage_percent}%`,
                monthly_usage: `${stats.monthly.usage_percent}%`,
                session_requests: stats.session.requests,
                status: stats.daily.status
            },
            details: stats,
            recommendations,
            alerts: this.generateAlerts(stats)
        };
    }

    /**
     * Genera alertas basadas en uso
     */
    generateAlerts(stats) {
        const alerts = [];

        if (stats.daily.usage_percent > 95) {
            alerts.push({
                level: 'CRITICAL',
                message: '¡CRÍTICO! Casi llegando al límite diario de tokens (95%+)',
                action: 'Reduce el uso o cambia a modelo más eficiente'
            });
        } else if (stats.daily.usage_percent > 85) {
            alerts.push({
                level: 'WARNING',
                message: 'Advertencia: Uso diario alto (85%+)',
                action: 'Monitorea el consumo'
            });
        }

        if (stats.daily.cost > 1.0) { // Más de $1 diario
            alerts.push({
                level: 'INFO',
                message: `Costo diario: $${stats.daily.cost.toFixed(4)} - Considera optimización`,
                action: 'Revisa recomendaciones de modelo'
            });
        }

        return alerts;
    }

    // Métodos privados
    resetDailyStats() {
        this.usageStats.daily = {
            tokens_input: 0,
            tokens_output: 0,
            requests: 0,
            cost: 0,
            last_reset: new Date().toISOString().split('T')[0]
        };
    }

    resetMonthlyStats() {
        this.usageStats.monthly = {
            tokens_input: 0,
            tokens_output: 0,
            requests: 0,
            cost: 0,
            last_reset: new Date().toISOString().slice(0, 7)
        };
    }

    startAutoReset() {
        // Reset diario a medianoche
        setInterval(() => {
            const now = new Date();
            const today = now.toISOString().split('T')[0];
            if (this.usageStats.daily.last_reset !== today) {
                this.resetDailyStats();
                console.log('🔄 Reset automático de estadísticas diarias');
            }
        }, 60000); // Verificar cada minuto
    }

    loadPersistedStats() {
        try {
            // En un entorno real, cargar desde base de datos o archivo
            // Por ahora, mantener en memoria
            console.log('📊 Estadísticas de Groq Monitor inicializadas');
        } catch (error) {
            console.error('Error cargando estadísticas:', error.message);
        }
    }

    savePersistedStats() {
        try {
            // En un entorno real, guardar en base de datos
            // Por ahora, solo mantener en memoria
        } catch (error) {
            console.error('Error guardando estadísticas:', error.message);
        }
    }
}

module.exports = new GroqMonitor();
