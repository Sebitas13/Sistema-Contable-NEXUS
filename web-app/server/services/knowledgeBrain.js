/**
 * Knowledge Brain V1.0 - Cerebro Centralizado de Conocimiento para Mahoraga
 * API unificada para que Mahoraga entienda el sistema, el ciclo contable y cuándo usar skills
 */

const knowledgeExtractor = require('./knowledgeExtractor');
const skillLoader = require('./skillLoader');
const systemRecognition = require('./systemRecognition');
const db = require('../db');

class KnowledgeBrain {
    constructor() {
        this.initialized = false;
        this.knowledge = null;
        this.decisionMatrix = null;
        this.systemMap = null;
    }

    initialize() {
        if (this.initialized) return;

        console.log('🧠 MAHORAGA BRAIN: Inicializando cerebro de conocimiento...');
        
        // Extraer conocimiento del sistema
        this.knowledge = knowledgeExtractor.extract();
        
        // Cargar matriz de decisiones
        this.loadDecisionMatrix();
        
        // Construir mapa del sistema
        this.buildSystemMap();
        
        this.initialized = true;
        console.log('✅ Mahoraga Brain inicializado');
    }

    loadDecisionMatrix() {
        this.decisionMatrix = {
            transaction: {
                triggers: ['new_entry', 'edit_entry', 'asiento_manual'],
                requiredSkills: ['classifyAccount', 'validateDoubleEntry', 'suggestReclassification'],
                checkPoints: ['balance_debits_credits', 'account_type_match', 'gloss_completeness'],
                phase: 'transactions'
            },
            adjustment_ufv: {
                triggers: ['month_end', 'ufv_change', 'generate_adjustments'],
                requiredSkills: ['calculateUFVAdjustment', 'applyNC3Rules', 'generateUFVEntry'],
                checkPoints: ['ufv_dates_valid', 'monetary_accounts_identified', 'balance_preserved'],
                phase: 'adjustments'
            },
            adjustment_aitb: {
                triggers: ['year_end', 'generate_aitb', 'fiscal_closing'],
                requiredSkills: ['calculateAITB', 'applyNC3Rules', 'generateAITBEntry'],
                checkPoints: ['all_accounts_classified', 'inflation_rate_applied', 'result_calculated'],
                phase: 'adjustments'
            },
            depreciation: {
                triggers: ['month_end', 'asset_acquired', 'generate_depreciation'],
                requiredSkills: ['calculateDepreciation', 'applyDS24051', 'generateDepreciationEntry'],
                checkPoints: ['asset_life_valid', 'method_compliant', 'accumulated_correct'],
                phase: 'adjustments'
            },
            account_setup: {
                triggers: ['new_account', 'import_plan', 'validate_plan'],
                requiredSkills: ['classifyAccount', 'suggestPUCTCode', 'validateAccountStructure'],
                checkPoints: ['code_structure_valid', 'parent_exists', 'type_consistent'],
                phase: 'setup'
            },
            report_generation: {
                triggers: ['request_report', 'generate_balance', 'export_financials'],
                requiredSkills: ['validateBalances', 'generateFinancialStatements', 'checkAccountingEquilibrium'],
                checkPoints: ['debits_equals_credits', 'all_accounts_matched', 'period_complete'],
                phase: 'closing'
            },
            feedback_learning: {
                triggers: ['user_correction', 'account_type_changed', 'rule_override'],
                requiredSkills: ['updateClassification', 'generateAdaptationRule', 'logLearningEvent'],
                checkPoints: ['profile_updated', 'rule_persisted', 'event_logged'],
                phase: 'learning'
            }
        };
    }

    buildSystemMap() {
        this.systemMap = {
            architecture: {
                frontend: {
                    framework: 'React',
                    entry: 'web-app/client/src/index.jsx',
                    pages: ['Journal', 'Accounts', 'Reports', 'Settings']
                },
                backend: {
                    framework: 'Express.js',
                    port: 3001,
                    entry: 'web-app/server/index.js',
                    database: 'SQLite3 (web-app/server/db/accounting.db)'
                },
                aiEngine: {
                    framework: 'FastAPI (Python)',
                    port: 8003,
                    entry: 'ai_adjustment_engine.py',
                    purpose: ' razonamiento adaptativo y ajustes'
                }
            },
            dataFlow: {
                userInteraction: 'React UI → Express API → SQLite DB',
                aiProcessing: 'React UI → Express API → FastAPI AI → Express API → React UI',
                learningFlow: 'User Correction → Express API → SQLite (profile) → FastAPI (analyze) → Express API → React UI'
            },
            mahoragaComponents: {
                security: 'mahoragaController.js',
                skills: 'skillLoader.js + skillDispatcher.js',
                learning: 'systemRecognition.js + cognitiveOrchestrator.js',
                monitoring: 'groqMonitor.js'
            }
        };
    }

    // ============ API PÚBLICA ============

    /**
     * Obtiene el estado del cerebro
     */
    getStatus() {
        return {
            initialized: this.initialized,
            skillsLoaded: skillLoader.isReady() ? skillLoader.skills.length : 0,
            phasesKnown: this.knowledge?.accountingCycle?.phases?.length || 0,
            decisionsDefined: Object.keys(this.decisionMatrix || {}).length
        };
    }

    /**
     * Obtiene contexto para una fase específica del ciclo contable
     */
    getPhaseContext(phaseId) {
        if (!this.initialized) this.initialize();

        const phase = this.knowledge.accountingCycle.phases.find(p => p.id === phaseId);
        if (!phase) return null;

        const decision = this.decisionMatrix[phaseId] || {};

        return {
            phase,
            decisionContext: decision,
            relatedFiles: this.getRelatedFiles(phaseId),
            relevantSkills: this.getRelevantSkills(decision.requiredSkills || []),
            systemMap: this.systemMap
        };
    }

    /**
     * Determina qué skills usar según el contexto de operación
     */
    getSkillsForOperation(operationType, context = {}) {
        if (!this.initialized) this.initialize();

        const decision = this.decisionMatrix[operationType];
        if (!decision) {
            // Buscar por palabras clave
            return this.searchSkillsByContext(operationType, context);
        }

        return {
            operation: operationType,
            phase: decision.phase,
            requiredSkills: decision.requiredSkills.map(skillId => ({
                skill: skillLoader.getSkillById(skillId),
                reason: this.getSkillReason(skillId, operationType)
            })).filter(s => s.skill),
            checkpoints: decision.checkPoints,
            workflow: this.getWorkflow(decision)
        };
    }

    /**
     * Obtiene el flujo de trabajo recomendado para una operación
     */
    getWorkflow(decision) {
        return {
            steps: [
                { step: 1, action: 'validate_prerequisites', description: 'Validar prerrequisitos del sistema' },
                { step: 2, action: 'load_skills', description: 'Cargar skills requeridas' },
                { step: 3, action: 'execute_skills', description: 'Ejecutar skills en secuencia' },
                { step: 4, action: 'validate_results', description: 'Validar resultados contra checkpoints' },
                { step: 5, action: 'present_results', description: 'Presentar resultados al usuario' }
            ],
            errorHandling: 'Si alguna skill falla, usar fallback heurístico y notificar'
        };
    }

    /**
     * Busca skills relevantes por contexto
     */
    searchSkillsByContext(query, context = {}) {
        const keywordResults = skillLoader.searchByKeywords(query);
        const anchorResults = skillLoader.searchByAnchor(query);

        const allResults = [...keywordResults, ...anchorResults];
        const uniqueSkills = new Map();

        allResults.forEach(r => {
            if (!uniqueSkills.has(r.skill?.id)) {
                uniqueSkills.set(r.skill?.id, r);
            }
        });

        return {
            query,
            skills: Array.from(uniqueSkills.values())
                .sort((a, b) => b.score - a.score)
                .slice(0, 10),
            searchMethod: 'keyword_anchor_hybrid'
        };
    }

    /**
     * Obtiene conocimiento del sistema completo
     */
    getFullKnowledge() {
        if (!this.initialized) this.initialize();

        return {
            status: this.getStatus(),
            fileStructure: this.knowledge.fileStructure,
            relationships: this.knowledge.relationships,
            accountingCycle: this.knowledge.accountingCycle,
            dataFlow: this.knowledge.dataFlow,
            decisionMatrix: this.decisionMatrix,
            systemMap: this.systemMap,
            skillStats: skillLoader.getStats(),
            recognitionStatus: systemRecognition.getLearningProgress()
        };
    }

    /**
     * Verifica si Mahoraga puede operar en el contexto actual
     */
    canOperate(operation, context = {}) {
        if (!this.initialized) this.initialize();

        const decision = this.decisionMatrix[operation];
        if (!decision) {
            return {
                allowed: true,
                reason: 'OPERATION_RECOGNIZED',
                message: 'Operación reconocida, usando búsqueda de skills',
                fallback: 'search'
            };
        }

        const skillsAvailable = decision.requiredSkills.every(skillId => 
            skillLoader.getSkillById(skillId) !== null
        );

        return {
            allowed: skillsAvailable,
            reason: skillsAvailable ? 'ALL_SKILLS_AVAILABLE' : 'MISSING_SKILLS',
            message: skillsAvailable 
                ? 'Todas las skills requeridas están disponibles'
                : 'Algunas skills no están disponibles',
            missingSkills: skillsAvailable ? [] : decision.requiredSkills.filter(
                skillId => skillLoader.getSkillById(skillId) === null
            )
        };
    }

    // ============ MÉTODOS PRIVADOS ============

    getRelatedFiles(phaseId) {
        const routeMapping = {
            setup: ['accounts.js', 'companies.js'],
            transactions: ['transactions.js', 'accounts.js'],
            adjustments: ['ufv.js', 'ai.js', 'reports.js'],
            closing: ['reports.js', 'transactions.js']
        };

        const related = routeMapping[phaseId] || [];
        
        return related.map(route => ({
            file: route,
            path: `routes/${route}`,
            description: knowledgeExtractor.getRouteDescription(route)
        }));
    }

    getRelevantSkills(skillIds) {
        return skillIds
            .map(id => skillLoader.getSkillById(id))
            .filter(s => s !== null);
    }

    getSkillReason(skillId, operation) {
        const reasons = {
            'classifyAccount': 'Identifica el tipo de cuenta según código y nombre',
            'validateDoubleEntry': 'Verifica que débitos igualen créditos',
            'suggestReclassification': 'Sugiere correcciones de clasificación',
            'calculateUFVAdjustment': 'Calcula ajuste por inflación UFV (NC-3)',
            'applyNC3Rules': 'Aplica normativa NC-3 de ajuste por inflación',
            'generateUFVEntry': 'Genera asiento contable de ajuste UFV',
            'calculateAITB': 'Calcula AITB para cierre fiscal',
            'generateAITBEntry': 'Genera asiento de Ajuste por Inflación y Tenencia de Bienes',
            'calculateDepreciation': 'Calcula depreciación de activos fijos',
            'applyDS24051': 'Aplica Decreto Supremo 24051 de depreciación',
            'generateDepreciationEntry': 'Genera asiento de depreciación',
            'validateBalances': 'Valida que los balances estén correctos',
            'generateFinancialStatements': 'Genera estados financieros',
            'checkAccountingEquilibrium': 'Verifica equilibrio contable',
            'updateClassification': 'Actualiza clasificación de cuenta',
            'generateAdaptationRule': 'Genera regla de adaptación',
            'logLearningEvent': 'Registra evento de aprendizaje'
        };
        return reasons[skillId] || 'Skill requerida para esta operación';
    }
}

module.exports = new KnowledgeBrain();
