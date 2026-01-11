/**
 * AI Adjustment Service - Cliente para motor Python
 * Conexión entre React y FastAPI para ajustes inteligentes
 */
import axios from 'axios';

const AI_BASE_URL = import.meta.env.VITE_API_URL 
    ? `${import.meta.env.VITE_API_URL}/api/ai` 
    : 'http://localhost:3001/api/ai';

class AIAdjustmentService {
    constructor() {
        this.client = axios.create({
            baseURL: AI_BASE_URL,
            timeout: 30000, // 30 segundos timeout
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Genera ajustes automatizados usando IA
     */
    async generateAdjustments(companyId, accounts, parameters, profileSchema = null) {
        try {
            const response = await this.client.post('/adjustments/generate', {
                companyId,
                accounts: accounts.map(acc => ({
                    code: acc.code,
                    name: acc.name,
                    balance: acc.saldo_matematico || acc.balance || 0, // Priorizar saldo_matematico
                    type: acc.type
                })).filter(acc => acc.balance > 0), // Solo cuentas con saldo > 0
                parameters: {
                    ufv_initial: parameters.ufv_initial,
                    ufv_final: parameters.ufv_final,
                    method: parameters.method || 'UFV',
                    confidence_threshold: parameters.confidence_threshold || 0.95
                },
                profile_schema: profileSchema // Incluir perfil dinámico
            });

            return response.data;
        } catch (error) {
            console.error('Error en AI Adjustment Service:', error);

            // Fallback a lógica existente si AI no está disponible
            return this.fallbackAdjustments(accounts, parameters);
        }
    }

    /**
     * Wrapper para cumplir con la firma esperada por AdjustmentWizard
     */
    async proposeAdjustments(params, profileSchema = null) {
        // En un caso real, aquí obtendríamos las cuentas del backend o context
        // Por ahora, simulamos una llamada o adaptamos los parámetros
        // Nota: AdjustmentWizard espera que este método devuelva { success: true, data: proposal }

        try {
            // Si necesitamos cuentas, deberíamos pedirlas o pasarlas. 
            // Como este método es llamado desde el Wizard que no tiene las cuentas completas aun (quizas),
            // asumiremos que el endpoint /adjustments/generate-proposal del servidor 
            // (que deberíamos crear o usar uno existente) maneja la obtención de cuentas.

            // O, reutilizamos generateAdjustmentsFromLedger que ya parece hacer eso (toma companyId)

            return this.generateAdjustmentsFromLedger(
                params.companyId,
                {
                    ufv_initial: params.exchangeRate_initial,
                    ufv_final: params.exchangeRate_final,
                    tc_initial: params.tc_initial,
                    tc_final: params.tc_final,
                    method: 'UFV',
                    // V7.0: Pass through new parameters
                    acquisition_dates: params.acquisition_dates,
                    fiscal_end_date: params.fiscal_end_date,
                    // V8.0 AoT: Enable trajectory-based calculation
                    use_trajectory_mode: params.use_trajectory_mode || false
                },
                profileSchema // V6.0 - Pass the updated profile schema
            );
        } catch (error) {
            console.error('Error proponiendo ajustes:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Health check del motor AI
     */
    async healthCheck() {
        try {
            const response = await this.client.get('/health');
            return response.data.status === 'healthy';
        } catch (error) {
            return false;
        }
    }

    /**
     * Validación por lotes de asientos
     */
    async batchValidateTransactions(transactions) {
        try {
            const response = await this.client.post('/adjustments/batch-validate', transactions);
            return response.data;
        } catch (error) {
            console.error('Error en validación por lotes:', error);
            return null;
        }
    }

    /**
     * Explicación detallada del razonamiento AI
     */
    async explainAdjustment(account, parameters) {
        try {
            const response = await this.client.post('/adjustments/explain', {
                account: {
                    code: account.code,
                    name: account.name,
                    balance: account.balance || account.saldo_matematico || 0,
                    type: account.type
                },
                params: parameters
            });
            return response.data;
        } catch (error) {
            console.error('Error obteniendo explicación:', error);
            return null;
        }
    }

    /**
     * Obtener configuración del motor AI
     */
    async getAIConfig() {
        try {
            const response = await this.client.get('/adjustments/config');
            return response.data;
        } catch (error) {
            console.error('Error obteniendo configuración AI:', error);
            return null;
        }
    }

    /**
     * Generar ajustes automáticamente desde ledger del middleware
     */
    async generateAdjustmentsFromLedger(companyId, parameters, profileSchema = null) {
        try {
            const response = await this.client.post('/adjustments/generate-from-ledger', {
                company_id: String(companyId), // Ensure string as per error
                accounts: [], // Required field even if empty for this endpoint
                parameters: {
                    ufv_initial: parameters.ufv_initial,
                    ufv_final: parameters.ufv_final,
                    method: parameters.method || 'UFV',
                    confidence_threshold: parameters.confidence_threshold || 0.95,
                    // V7.0: Include new prorated depreciation parameters
                    acquisition_dates: parameters.acquisition_dates,
                    fiscal_end_date: parameters.fiscal_end_date,
                    // V8.0 AoT: Enable trajectory-based calculation
                    use_trajectory_mode: parameters.use_trajectory_mode || false
                },
                profile_schema: profileSchema
            });

            return response.data;
        } catch (error) {
            console.error('Error generando ajustes desde ledger:', error);

            // Fallback a método tradicional
            return {
                success: false,
                error: 'No se pudo conectar con el motor AI para obtener datos del ledger',
                proposedTransactions: [],
                confidence: 0,
                reasoning: 'Fallback: motor AI no disponible',
                warnings: ['Servicio AI no disponible para integración con ledger']
            };
        }
    }

    /**
     * Fallback a lógica existente cuando AI no está disponible
     */
    fallbackAdjustments(accounts, parameters) {
        console.log('Usando fallback para ajustes (sin AI)');
        const proposedTransactions = [];
        let totalAitb = 0;

        const { ufv_initial, ufv_final } = parameters;
        const canCalculateAitb = ufv_initial && ufv_final && parseFloat(ufv_initial) > 0;
        const inflationFactor = canCalculateAitb ? parseFloat(ufv_final) / parseFloat(ufv_initial) : 1;

        // Palabras clave para identificar cuentas no monetarias que se ajustan
        const nonMonetaryKeywords = [
            'terreno', 'edificio', 'muebles', 'vehículo', 'maquinaria',
            'equipo de computacion', 'activo fijo', 'inventario', 'capital social', 'ajuste de capital'
        ];

        accounts.forEach(account => {
            const balance = parseFloat(account.balance) || 0;
            if (balance <= 0) return;

            const accountNameLower = account.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            // 1. Lógica de Ajuste por Inflación (AITB)
            let isNonMonetary = nonMonetaryKeywords.some(keyword => accountNameLower.includes(keyword));

            // NC-3 Universal Logic: Result Accounts (Ingreso/Gasto) are Non-Monetary unless excluded
            // Priority: Account Type > Code Heuristic
            const typeNorm = account.type ? account.type.toLowerCase() : "";
            const isResultType = ["ingreso", "egreso", "gasto", "costo", "resultado"].some(k => typeNorm.includes(k));
            const isResultCode = account.code && (account.code.startsWith('4') || account.code.startsWith('5') || account.code.startsWith('6'));

            if (!isNonMonetary && (isResultType || isResultCode)) {
                const exclusions = ["ajuste por inflacion", "diferencia de cambio", "mantenimiento de valor", "exposicion a la inflacion", "perdidas y ganancias"];
                const isExcluded = exclusions.some(exc => accountNameLower.includes(exc));
                if (!isExcluded) {
                    isNonMonetary = true;
                }
            }

            if (canCalculateAitb && isNonMonetary) {
                const adjustment = balance * (inflationFactor - 1);
                if (Math.abs(adjustment) > 0.01) {
                    // El ajuste se acumula y se genera en un solo asiento al final
                    totalAitb += adjustment;

                    // Proponemos el asiento de contrapartida para la cuenta individual
                    proposedTransactions.push({
                        gloss: `Ajuste por inflación (AITB) - ${account.name}`,
                        entries: [
                            { accountId: account.code, accountName: account.name, debit: adjustment, credit: 0 },
                        ],
                        type: 'AITB'
                    });
                }
            }

            // 2. Lógica simple de depreciación (ejemplo)
            if (accountNameLower.includes('edificio')) {
                const depreciation = balance * 0.025 / 12; // Asumiendo depreciación mensual
                if (depreciation > 0.01) {
                    proposedTransactions.push({
                        gloss: `Depreciación mensual - ${account.name}`,
                        entries: [
                            { accountId: "50001", accountName: "Gasto por Depreciación", debit: depreciation.toFixed(2), credit: 0 },
                            { accountId: "12301-D", accountName: `Depreciación Acumulada ${account.name}`, debit: 0, credit: depreciation.toFixed(2) }
                        ],
                        type: 'DEPRECIATION'
                    });
                }
            }
        });

        // 3. Crear el asiento consolidado de AITB
        if (Math.abs(totalAitb) > 0.01) {
            const aitbEntryIndex = proposedTransactions.findIndex(t => t.type === 'AITB');
            if (aitbEntryIndex !== -1) {
                proposedTransactions[aitbEntryIndex].entries.push({
                    accountId: "40001", // Cuenta de resultado (ej. Gasto o Ingreso por Inflación)
                    accountName: "Ajuste por Inflación y Tenencia de Bienes",
                    debit: totalAitb < 0 ? Math.abs(totalAitb).toFixed(2) : 0,
                    credit: totalAitb > 0 ? totalAitb.toFixed(2) : 0
                });
            }
        }

        // Limpiar tipos temporales
        proposedTransactions.forEach(t => delete t.type);

        return {
            success: proposedTransactions.length > 0,
            proposedTransactions,
            confidence: 0.75, // Menor confianza en fallback
            reasoning: "Fallback: Usando lógica tradicional de AITB y depreciación (sin IA).",
            warnings: ["Motor AI no disponible, usando lógica simplificada. Verifique los cálculos."]
        };
    }
    /**
     * El Ritual de Invocación (Mahoraga SCL): Envía feedback para adaptar el motor
     */
    async sendFeedback(feedbackData) {
        try {
            const response = await this.client.post('/adjustments/feedback', feedbackData);
            return response.data;
        } catch (error) {
            console.error('Error enviando feedback SCL:', error);
            return {
                success: false,
                error: error.response?.data?.error || 'No se pudo procesar la adaptación'
            };
        }
    }

    /**
     * Reset de la Rueda (Mahoraga Rollback): Revierte la última adaptación
     */
    async rollbackAdaptation() {
        try {
            const response = await this.client.post('/adjustments/rollback');
            return response.data;
        } catch (error) {
            console.error('Error revirtiendo adaptación:', error);
            return {
                success: false,
                error: 'No se pudo revertir la adaptación'
            };
        }
    }

    /**
     * Adaptar Mahoraga (forzar clasificación de cuenta)
     */
    async adaptMahoraga(params) {
        try {
            const feedbackData = {
                account_code: params.accountCode || '',
                account_name: params.accountName || '',
                correct_type: params.action === 'FORZAR_NO_MONETARIO' ? 'non_monetary' : 'monetary',
                error_tag: 'USER_OVERRIDE', // Required by Python FeedbackRequest
                user: 'Usuario Frontend',
                user_comment: `Corrección manual: ${params.origin_trans || 'Ajuste directo'}`,
                company_id: String(params.companyId || '1'),
                is_global_adaptation: false
            };
            const response = await this.client.post('/adjustments/feedback', feedbackData);
            return {
                success: true,
                message: response.data.new_rule_generated || 'Adaptación aplicada',
                warnings: response.data.warnings || [],
                updated_profile_schema: response.data.updated_profile_schema
            };
        } catch (error) {
            console.error('Error adaptando Mahoraga:', error);
            return {
                success: false,
                error: error.response?.data?.detail || 'No se pudo aplicar la adaptación'
            };
        }
    }

    /**
     * Obtener cronología de adaptaciones (V6.0 - Backend Real)
     * Consulta la tabla mahoraga_adaptation_events en SQLite
     */
    async getChronology(companyId) {
        try {
            const response = await this.client.get(`/adjustments/chronology/${companyId}`);
            return {
                success: true,
                events: response.data.events || []
            };
        } catch (error) {
            console.error('Error obteniendo cronología Mahoraga:', error);
            // Fallback silencioso si el endpoint no está disponible
            return {
                success: false,
                events: [],
                error: 'No se pudo cargar la cronología de adaptaciones'
            };
        }
    }

    /**
     * Confirmar y guardar ajustes generados
     */
    async confirmAdjustments(params) {
        try {
            // Aquí se guardarían los asientos en la base de datos
            // Por ahora simulamos la confirmación
            const response = await this.client.post('/adjustments/confirm', params);
            return response.data;
        } catch (error) {
            console.error('Error confirmando ajustes:', error);
            // Fallback: intentar guardar directamente via transactions API
            return {
                success: false,
                error: error.response?.data?.error || 'No se pudieron guardar los ajustes'
            };
        }
    }
}


export default new AIAdjustmentService();
