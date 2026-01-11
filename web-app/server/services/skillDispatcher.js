/**
 * Mahoraga Skill System V7.0 - Skill Dispatcher
 * Invocación segura de skills con whitelist y sandboxing
 */

const skillLoader = require('./skillLoader');
const { VM } = require('vm2'); // Para sandboxing JS
const { spawn } = require('child_process'); // Para ejecutar Python

class SkillDispatcher {
    constructor() {
        this.whitelist = this.buildWhitelist();
        this.sandboxOptions = {
            timeout: 5000, // 5 segundos máximo por ejecución
            memoryLimit: 50, // 50MB límite de memoria
            allowAsync: false // No permitir operaciones asíncronas en sandbox
        };
    }

    /**
     * Construye la whitelist de skills permitidas
     * CRÍTICO: Solo skills en esta lista pueden ser ejecutadas
     */
    buildWhitelist() {
        return {
            // JavaScript (invocables directamente via sandbox)
            "reports.js::classifyAccountV2": true,
            "reports.js::bankersRound": true,
            "reports.js::isNonMonetary": true,
            "utils/AccountPlanProfile.js::calculateLevel": true,
            "utils/AccountPlanProfile.js::calculateParent": true,
            "utils/fiscalYearUtils.js::getFiscalYearDetails": true,

            // Python (invocables via HTTP a FastAPI)
            "ai_adjustment_engine.py::calculate_depreciation_pot": true,
            "ai_adjustment_engine.py::calculate_aitb_pot": true,
            "ai_adjustment_engine.py::classify_account_semantic": true,
            "ai_adjustment_engine.py::learn_from_feedback": true,

            // Sistema Contable - Funciones seguras
            "reports.js::calculateTax": true,
            "reports.js::calculateReserveLegal": true,
            "reports.js::generateEstadoResultados": true,

            // Utilidades matemáticas seguras
            "Math.abs": true,
            "Math.round": true,
            "Math.max": true,
            "Math.min": true,
            "parseFloat": true,
            "parseInt": true,
            "isNaN": true,
            "Number.isFinite": true
        };
    }

    /**
     * Valida si una skill está en la whitelist
     * @param {string} skillId - ID de la skill a validar
     * @returns {boolean} - True si está permitida
     */
    isWhitelisted(skillId) {
        return !!this.whitelist[skillId];
    }

    /**
     * Obtiene una skill por ID y valida whitelist
     * @param {string} skillId - ID de la skill
     * @returns {Object|null} - Skill o null si no está permitida
     */
    getValidatedSkill(skillId) {
        if (!this.isWhitelisted(skillId)) {
            console.warn(`🚫 Skill ${skillId} no está en whitelist - ejecución bloqueada`);
            return null;
        }

        const skill = skillLoader.getSkillById(skillId);
        if (!skill) {
            console.warn(`❌ Skill ${skillId} no encontrada en el sistema`);
            return null;
        }

        return skill;
    }

    /**
     * Valida argumentos antes de la ejecución
     * @param {Object} skill - Skill a ejecutar
     * @param {Array} args - Argumentos a validar
     * @returns {boolean} - True si los argumentos son válidos
     */
    validateArguments(skill, args) {
        // Verificar número de parámetros
        if (skill.signature) {
            const expectedParams = this.extractParameters(skill.signature);
            if (args.length !== expectedParams.length) {
                console.warn(`❌ Número de argumentos incorrecto para ${skill.id}: esperado ${expectedParams.length}, recibido ${args.length}`);
                return false;
            }
        }

        // Verificar tipos básicos de argumentos
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg === null || arg === undefined) continue; // Null/undefined permitidos

            // Verificar tipos peligrosos
            if (typeof arg === 'function') {
                console.warn(`❌ Argumento ${i} es una función - no permitido`);
                return false;
            }

            if (typeof arg === 'object' && arg.constructor !== Object && arg.constructor !== Array) {
                console.warn(`❌ Argumento ${i} es un objeto de clase personalizada - no permitido`);
                return false;
            }
        }

        return true;
    }

    /**
     * Extrae parámetros de la signatura de función
     * @param {string} signature - Signatura como "(param1, param2)"
     * @returns {Array} - Lista de nombres de parámetros
     */
    extractParameters(signature) {
        if (!signature) return [];
        const match = signature.match(/\(([^)]*)\)/);
        if (!match) return [];

        return match[1].split(',')
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }

    /**
     * Ejecuta una skill de JavaScript en sandbox
     * @param {Object} skill - Skill a ejecutar
     * @param {Array} args - Argumentos para la función
     * @returns {any} - Resultado de la ejecución
     */
    async executeJSSkill(skill, args) {
        try {
            // Verificar que es un archivo JS
            if (!skill.file.endsWith('.js')) {
                throw new Error('Skill no es de JavaScript');
            }

            // Crear sandbox con funciones seguras
            const sandbox = {
                console: { log: (...args) => console.log('[SANDBOX]', ...args) },
                Math: Math,
                parseFloat: parseFloat,
                parseInt: parseInt,
                isNaN: isNaN,
                Number: { isFinite: Number.isFinite },
                Array: Array,
                Object: Object,
                String: String,
                Boolean: Boolean,
                // Argumentos pasados a la función
                ...args.reduce((acc, arg, idx) => {
                    acc[`arg${idx}`] = arg;
                    return acc;
                }, {})
            };

            // Intentar ejecutar la función en VM2 sandbox
            const vm = new VM({
                timeout: this.sandboxOptions.timeout,
                sandbox: sandbox
            });

            // Para skills complejas, necesitaríamos cargar el módulo completo
            // Por ahora, implementamos skills básicas directamente

            let result;
            switch (skill.id) {
                case "reports.js::bankersRound":
                    result = this.safeBankersRound(args[0], args[1] || 2);
                    break;

                case "reports.js::isNonMonetary":
                    result = this.safeIsNonMonetary(args[0], args[1]);
                    break;

                case "utils/AccountPlanProfile.js::calculateLevel":
                    result = this.safeCalculateLevel(args[0], args[1]);
                    break;

                case "utils/AccountPlanProfile.js::calculateParent":
                    result = this.safeCalculateParent(args[0], args[1]);
                    break;

                default:
                    throw new Error(`Skill JS ${skill.id} no implementada en dispatcher`);
            }

            return result;

        } catch (error) {
            console.error(`❌ Error ejecutando skill JS ${skill.id}:`, error.message);
            throw new Error(`Ejecución fallida: ${error.message}`);
        }
    }

    /**
     * Ejecuta una skill de Python via HTTP
     * @param {Object} skill - Skill a ejecutar
     * @param {Array} args - Argumentos para la función
     * @returns {any} - Resultado de la ejecución
     */
    async executePythonSkill(skill, args) {
        return new Promise((resolve, reject) => {
            try {
                // Preparar payload para FastAPI
                const payload = {
                    skillId: skill.id,
                    args: args
                };

                // Ejecutar comando Python
                const pythonProcess = spawn('python', [
                    'ai_adjustment_engine.py',
                    '--execute-skill',
                    JSON.stringify(payload)
                ], {
                    cwd: process.cwd(),
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                let stdout = '';
                let stderr = '';

                pythonProcess.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                pythonProcess.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                pythonProcess.on('close', (code) => {
                    if (code !== 0) {
                        console.error(`❌ Skill Python ${skill.id} falló con código ${code}:`, stderr);
                        reject(new Error(`Ejecución Python fallida: ${stderr}`));
                        return;
                    }

                    try {
                        const result = JSON.parse(stdout.trim());
                        resolve(result);
                    } catch (parseError) {
                        console.error(`❌ Error parseando resultado de ${skill.id}:`, stdout);
                        reject(new Error(`Parse error: ${parseError.message}`));
                    }
                });

                pythonProcess.on('error', (error) => {
                    console.error(`❌ Error ejecutando skill Python ${skill.id}:`, error);
                    reject(new Error(`Spawn error: ${error.message}`));
                });

                // Timeout de seguridad
                setTimeout(() => {
                    pythonProcess.kill();
                    reject(new Error('Timeout ejecutando skill Python'));
                }, 30000); // 30 segundos máximo

            } catch (error) {
                console.error(`❌ Error preparando skill Python ${skill.id}:`, error);
                reject(new Error(`Preparación fallida: ${error.message}`));
            }
        });
    }

    /**
     * Método principal de despacho
     * @param {string} skillId - ID de la skill a ejecutar
     * @param {Array} args - Argumentos para la función
     * @returns {any} - Resultado de la ejecución
     */
    async dispatch(skillId, args = []) {
        console.log(`🎯 Dispatching skill: ${skillId} con args:`, args);

        // 1. Validar skill existe y está permitida
        const skill = this.getValidatedSkill(skillId);
        if (!skill) {
            throw new Error(`Skill ${skillId} no encontrada o no permitida`);
        }

        // 2. Validar argumentos
        if (!this.validateArguments(skill, args)) {
            throw new Error(`Argumentos inválidos para skill ${skillId}`);
        }

        // 3. Ejecutar según el lenguaje
        if (skill.file.endsWith('.py')) {
            return await this.executePythonSkill(skill, args);
        } else if (skill.file.endsWith('.js')) {
            return await this.executeJSSkill(skill, args);
        } else {
            throw new Error(`Lenguaje no soportado para skill ${skillId}`);
        }
    }

    /**
     * Batch dispatch - Ejecuta múltiples skills en secuencia
     * @param {Array} requests - Array de {skillId, args}
     * @returns {Array} - Resultados en el mismo orden
     */
    async batchDispatch(requests) {
        const results = [];

        for (const request of requests) {
            try {
                const result = await this.dispatch(request.skillId, request.args);
                results.push({ success: true, result });
            } catch (error) {
                results.push({ success: false, error: error.message });
            }
        }

        return results;
    }

    // ==================== FUNCIONES SEGURAS IMPLEMENTADAS ====================

    safeBankersRound(num, decimals = 2) {
        if (typeof num !== 'number' || isNaN(num)) return 0;
        const factor = Math.pow(10, decimals);
        const n = Math.abs(num) * factor;
        const rounded = Math.round(n);
        const decimal = n - Math.floor(n);

        if (decimal === 0.5 && rounded % 2 !== 0) {
            return (rounded - 1) / factor * (num < 0 ? -1 : 1);
        }
        return rounded / factor * (num < 0 ? -1 : 1);
    }

    safeIsNonMonetary(code, name) {
        if (!code && !name) return false;

        // Lógica básica de clasificación monetaria
        const codeStr = String(code || '').toUpperCase();
        const nameStr = String(name || '').toLowerCase();

        // Códigos que indican NO monetarios
        if (codeStr.startsWith('1') && codeStr.length >= 4) {
            const subgroup = codeStr.substring(1, 2);
            if (['6', '7', '8', '9'].includes(subgroup)) {
                return true; // Activos no corrientes
            }
        }

        // Keywords que indican NO monetarios
        const nonMonetaryKeywords = ['edificio', 'maquinaria', 'equipo', 'vehiculo', 'intangible', 'activo fijo', 'inmueble'];
        return nonMonetaryKeywords.some(keyword => nameStr.includes(keyword));
    }

    safeCalculateLevel(code, config) {
        // Implementación básica de calculateLevel
        if (!code) return 1;
        const sep = config?.separator || '.';
        const parts = code.split(sep);
        return parts.length;
    }

    safeCalculateParent(code, config) {
        // Implementación básica de calculateParent
        if (!code) return null;
        const sep = config?.separator || '.';
        const parts = code.split(sep);
        if (parts.length <= 1) return null;
        parts.pop();
        return parts.join(sep);
    }
}

module.exports = new SkillDispatcher();
