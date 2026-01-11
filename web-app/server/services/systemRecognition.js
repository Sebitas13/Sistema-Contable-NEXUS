/**
 * Sistema de Reconocimiento del Funcionamiento de la Aplicación
 * Enseña a Mahoraga cómo funciona el sistema antes de permitir operaciones
 */

class SystemRecognition {
    constructor() {
        this.systemKnowledge = {
            architecture: this.getSystemArchitecture(),
            workflows: this.getSystemWorkflows(),
            dataFlow: this.getDataFlow(),
            businessLogic: this.getBusinessLogic(),
            securityModel: this.getSecurityModel(),
            integrationPoints: this.getIntegrationPoints()
        };

        this.learningPhases = {
            PHASE_1: 'system_architecture',    // Arquitectura del sistema
            PHASE_2: 'data_flow',              // Flujo de datos
            PHASE_3: 'business_logic',         // Lógica de negocio
            PHASE_4: 'workflows',              // Flujos de trabajo
            PHASE_5: 'integration',            // Puntos de integración
            PHASE_6: 'security'                // Modelo de seguridad
        };

        this.currentPhase = this.learningPhases.PHASE_1;
        this.learningProgress = {
            [this.learningPhases.PHASE_1]: false,
            [this.learningPhases.PHASE_2]: false,
            [this.learningPhases.PHASE_3]: false,
            [this.learningPhases.PHASE_4]: false,
            [this.learningPhases.PHASE_5]: false,
            [this.learningPhases.PHASE_6]: false
        };

        this.searchPreview = new SearchPreviewSystem();
    }

    /**
     * Arquitectura del sistema
     */
    getSystemArchitecture() {
        return {
            frontend: {
                framework: 'React.js',
                routing: 'React Router',
                state_management: 'Context API + Local State',
                styling: 'Bootstrap + Tailwind CSS',
                components: [
                    'Dashboard', 'Accounts', 'Journal', 'Ledger',
                    'Worksheet', 'Reports', 'Settings', 'MahoragaDashboard'
                ]
            },
            backend: {
                runtime: 'Node.js + Express',
                database: 'SQLite',
                apis: ['RESTful API', 'File Upload', 'Export/Import'],
                services: [
                    'modelServiceAdapter', 'groqMonitor', 'mahoragaController',
                    'skillLoader', 'skillDispatcher', 'systemRecognition'
                ]
            },
            ai_engine: {
                language: 'Python (FastAPI)',
                models: ['Llama-3.1-8b-instant', 'OpenAI GPT-OSS models'],
                capabilities: ['Classification', 'Adjustment Generation', 'Auto-learning'],
                skills_count: require('./skillLoader').isReady() ? require('./skillLoader').getStats().totalSkills : 446
            },
            data_structure: {
                companies: 'Multi-tenant con aislamiento',
                accounts: 'Jerarquía multinivel',
                transactions: 'Libro diario + mayor',
                adjustments: 'Inflación + depreciación'
            }
        };
    }

    /**
     * Flujos de trabajo del sistema
     */
    getSystemWorkflows() {
        return {
            accounting_cycle: [
                'FASE 1: GÉNESIS (Configuración y Cimientos) - Creado en CompanySelector, Accounts y UFV/TC',
                'FASE 2: OPERACIÓN (Registro de Hechos) - Libro Diario (transactions.js) y Mayorización (reports.js)',
                'FASE 3: RITUAL DE MAHORAGA (Ajuste y Adaptación) - Balance de Comprobación y Asistente de Ajustes SCL',
                'FASE 4: REVELACIÓN Y CIERRE (Reporting) - Estados Financieros y Cierre de Gestión'
            ],
            ai_integration: [
                '1. Absorción de skills del sistema',
                '2. Verificación de permisos (Mahoraga Controller)',
                '3. Activación manual del usuario',
                '4. Preview de operaciones a realizar',
                '5. Ejecución con monitoreo',
                '6. Auto-aprendizaje de correcciones'
            ],
            user_management: [
                '1. Selección de empresa',
                '2. Autenticación por empresa',
                '3. Control de permisos por módulo',
                '4. Auditoría de acciones',
                '5. Aislamiento de datos'
            ]
        };
    }

    /**
     * Flujo de datos
     */
    getDataFlow() {
        return {
            input_sources: [
                'Importación de archivos Excel/CSV',
                'API REST para integración externa',
                'Interface manual de usuario',
                'Auto-generación por IA'
            ],
            processing_layers: [
                'Validación de datos',
                'Transformación y normalización',
                'Cálculos contables automáticos',
                'Aplicación de reglas de negocio',
                'Generación de ajustes por IA'
            ],
            storage_layers: [
                'Base de datos SQLite por empresa',
                'Archivos de configuración JSON',
                'Cache de skills en memoria',
                'Historial de operaciones auditado'
            ],
            output_formats: [
                'Estados Financieros (PDF/Excel)',
                'Reportes contables',
                'Exportación de datos',
                'API responses para integraciones'
            ]
        };
    }

    /**
     * Lógica de negocio
     */
    getBusinessLogic() {
        return {
            accounting_principles: [
                'Principio de partida doble',
                'Devengo vs efectivo',
                'Valor histórico vs valor razonable',
                'Conservadurismo contable'
            ],
            bolivian_standards: [
                'Normas Bolivianas de Contabilidad (NBC)',
                'Ajustes por tenencia (AITB)',
                'Unidad de Fomento a la Vivienda (UFV)',
                'Depreciación de activos fijos',
                'Provisiones y contingencias'
            ],
            validation_rules: [
                'Balance de partida doble',
                'Consistencia de fechas',
                'Jerarquía de cuentas',
                'Límites de importes',
                'Validación de tipos de cambio'
            ],
            ai_decision_logic: [
                'Clasificación automática de cuentas',
                'Generación de ajustes por inflación',
                'Cálculo de depreciaciones',
                'Detección de asientos irregulares',
                'Sugerencias de corrección'
            ]
        };
    }

    /**
     * Modelo de seguridad
     */
    getSecurityModel() {
        return {
            data_isolation: [
                'Base de datos separada por empresa',
                'Control de acceso por compañía',
                'Encriptación de datos sensibles',
                'Auditoría de todas las operaciones'
            ],
            ai_safety: [
                'Modo manual por defecto',
                'Activación explícita requerida',
                'Parada de emergencia disponible',
                'Monitoreo continuo de uso',
                'Límites de API configurables'
            ],
            user_permissions: [
                'Control granular por módulo',
                'Auditoría de acciones de usuario',
                'Sesiones con timeout automático',
                'Validación de integridad de datos'
            ]
        };
    }

    /**
     * Puntos de integración
     */
    getIntegrationPoints() {
        return {
            external_apis: [
                'API de Groq para IA generativa',
                'Servicio de tipos de cambio',
                'API de UFV histórica',
                'Servicios de validación fiscal'
            ],
            file_formats: [
                'Excel (.xlsx, .xls)',
                'CSV delimitado',
                'PDF para reportes',
                'JSON para configuraciones'
            ],
            third_party: [
                'Integración con sistemas ERP',
                'Exportación a sistemas de auditoría',
                'API para aplicaciones móviles',
                'Webhooks para notificaciones'
            ]
        };
    }

    /**
     * Enseñar una fase específica a Mahoraga
     */
    teachPhase(phase, companyId = null) {
        const knowledge = this.systemKnowledge;

        switch (phase) {
            case this.learningPhases.PHASE_1:
                return {
                    phase,
                    title: 'Arquitectura del Sistema',
                    content: knowledge.architecture,
                    examples: [
                        'El frontend React maneja la UI/UX',
                        'El backend Node.js procesa la lógica de negocio',
                        'Python maneja la IA avanzada',
                        'SQLite almacena datos por empresa'
                    ],
                    next_actions: ['Explorar componentes frontend', 'Revisar APIs backend']
                };

            case this.learningPhases.PHASE_2:
                return {
                    phase,
                    title: 'Flujo de Datos',
                    content: knowledge.dataFlow,
                    examples: [
                        'Datos entran via Excel/CSV o API',
                        'Se validan y transforman',
                        'Se almacenan en SQLite por empresa',
                        'Salen como reportes PDF/Excel'
                    ],
                    next_actions: ['Ver esquemas de base de datos', 'Revisar validaciones']
                };

            case this.learningPhases.PHASE_3:
                return {
                    phase,
                    title: 'Lógica de Negocio Contable',
                    content: knowledge.businessLogic,
                    examples: [
                        'Partida doble: Débito = Crédito',
                        'AITB: Ajustes por tenencia en Bolivia',
                        'UFV: Unidad de Fomento a la Vivienda',
                        'Depreciación según normas NBC'
                    ],
                    next_actions: ['Estudiar normas bolivianas', 'Practicar cálculos contables']
                };

            case this.learningPhases.PHASE_4:
                return {
                    phase,
                    title: 'Flujos de Trabajo',
                    content: knowledge.workflows,
                    examples: [
                        'Ciclo contable completo mensual',
                        'De transacciones a estados financieros',
                        'IA integrada en ajustes automáticos',
                        'Aprobaciones y validaciones'
                    ],
                    next_actions: ['Simular ciclo contable', 'Probar flujos de IA']
                };

            case this.learningPhases.PHASE_5:
                return {
                    phase,
                    title: 'Integraciones Externas',
                    content: knowledge.integrationPoints,
                    examples: [
                        'Groq API para razonamiento avanzado',
                        'Importación masiva de Excel',
                        'Exportación de estados financieros',
                        'APIs REST para integraciones'
                    ],
                    next_actions: ['Configurar APIs externas', 'Probar importaciones']
                };

            case this.learningPhases.PHASE_6:
                return {
                    phase,
                    title: 'Modelo de Seguridad',
                    content: knowledge.securityModel,
                    examples: [
                        'Aislamiento completo por empresa',
                        'IA solo con activación manual',
                        'Auditoría de todas las operaciones',
                        'Parada de emergencia disponible'
                    ],
                    next_actions: ['Configurar permisos', 'Probar controles de seguridad']
                };

            default:
                return { error: 'Fase de aprendizaje no reconocida' };
        }
    }

    /**
     * Avanzar a la siguiente fase de aprendizaje
     */
    advancePhase(companyId = null) {
        const phases = Object.values(this.learningPhases);
        const currentIndex = phases.indexOf(this.currentPhase);

        if (currentIndex < phases.length - 1) {
            this.learningProgress[this.currentPhase] = true;
            this.currentPhase = phases[currentIndex + 1];

            return {
                advanced: true,
                from_phase: phases[currentIndex],
                to_phase: this.currentPhase,
                progress: this.getLearningProgress(),
                next_lesson: this.teachPhase(this.currentPhase, companyId)
            };
        }

        return {
            advanced: false,
            message: 'Todas las fases completadas',
            progress: this.getLearningProgress()
        };
    }

    /**
     * Obtener progreso de aprendizaje
     */
    getLearningProgress() {
        const completed = Object.values(this.learningProgress).filter(Boolean).length;
        const total = Object.keys(this.learningProgress).length;

        return {
            completed,
            total,
            percentage: Math.round((completed / total) * 100),
            current_phase: this.currentPhase,
            completed_phases: Object.keys(this.learningProgress).filter(phase => this.learningProgress[phase])
        };
    }

    /**
     * Sistema de preview de búsquedas
     */
    getSearchPreview(operation, context = {}) {
        return this.searchPreview.generatePreview(operation, context);
    }

    /**
     * Verificar si Mahoraga está listo para operar
     */
    isReadyToOperate(companyId = null) {
        const progress = this.getLearningProgress();
        const mahoragaController = require('./mahoragaController');

        return {
            learning_complete: progress.percentage >= 80, // 80% mínimo
            security_configured: mahoragaController.currentMode !== 'disabled',
            company_context: companyId ? true : false,
            ready: progress.percentage >= 80 && mahoragaController.currentMode !== 'disabled'
        };
    }
}

/**
 * Sistema de Preview de Búsquedas
 * Muestra qué operaciones realizará Mahoraga antes de ejecutar
 */
class SearchPreviewSystem {
    constructor() {
        this.estimations = {
            token_usage: {
                account_classification: { min: 50, max: 200, avg: 125 },
                adjustment_generation: { min: 200, max: 800, avg: 500 },
                report_analysis: { min: 100, max: 500, avg: 300 },
                data_validation: { min: 25, max: 100, avg: 60 }
            },
            api_calls: {
                single_classification: 1,
                batch_processing: { calls_per_100_items: 3 },
                complex_analysis: 2
            }
        };
    }

    generatePreview(operation, context = {}) {
        const { accounts = 0, complexity = 'medium', data_size = 'small' } = context;

        switch (operation) {
            case 'classify_accounts':
                return this.previewAccountClassification(accounts, complexity);

            case 'generate_adjustments':
                return this.previewAdjustmentGeneration(accounts, complexity);

            case 'analyze_financials':
                return this.previewFinancialAnalysis(data_size, complexity);

            case 'validate_data':
                return this.previewDataValidation(accounts);

            default:
                return this.previewGenericOperation(operation, context);
        }
    }

    previewAccountClassification(accountCount, complexity) {
        const tokensPerAccount = this.estimations.token_usage.account_classification;
        const totalTokens = accountCount * tokensPerAccount.avg;
        const apiCalls = Math.ceil(accountCount / 50); // 50 cuentas por llamada

        return {
            operation: 'classify_accounts',
            description: `Clasificar ${accountCount} cuentas contables`,
            estimated_operations: [
                `Analizar nombres y códigos de ${accountCount} cuentas`,
                `Aplicar reglas semánticas aprendidas`,
                `Generar clasificaciones monetario/no-monetario`,
                `Calcular niveles jerárquicos`
            ],
            resource_usage: {
                tokens_estimated: totalTokens,
                api_calls_estimated: apiCalls,
                cost_estimated: `$${(totalTokens * 0.05 / 1000000).toFixed(6)}`,
                time_estimated: `${Math.ceil(apiCalls * 2)}s`
            },
            risks: [
                'Posible clasificación incorrecta en cuentas ambiguas',
                'Uso de tokens si hay muchas cuentas complejas'
            ],
            recommendations: [
                complexity === 'high' ? 'Considerar procesamiento por lotes' : 'Configuración óptima',
                accountCount > 1000 ? 'Dividir en lotes más pequeños' : 'Procesamiento directo'
            ]
        };
    }

    previewAdjustmentGeneration(accountCount, complexity) {
        const tokensPerAccount = this.estimations.token_usage.adjustment_generation;
        const totalTokens = accountCount * tokensPerAccount.avg;
        const apiCalls = Math.ceil(accountCount / 20); // 20 ajustes complejos por llamada

        return {
            operation: 'generate_adjustments',
            description: `Generar ajustes contables para ${accountCount} cuentas`,
            estimated_operations: [
                `Calcular ajustes UFV/AITB según normas bolivianas`,
                `Generar asientos de depreciación`,
                `Aplicar coeficientes de inflación`,
                `Validar integridad contable`
            ],
            resource_usage: {
                tokens_estimated: totalTokens,
                api_calls_estimated: apiCalls,
                cost_estimated: `$${(totalTokens * 0.05 / 1000000).toFixed(6)}`,
                time_estimated: `${Math.ceil(apiCalls * 3)}s`
            },
            risks: [
                'Cálculos complejos pueden agotar límites de tokens',
                'Errores en fórmulas contables críticas'
            ],
            recommendations: [
                'Verificar normas NBC antes de ejecutar',
                'Tener backup de datos contables',
                complexity === 'high' ? 'Ejecutar en horario de baja carga' : 'Listo para ejecutar'
            ]
        };
    }

    previewFinancialAnalysis(dataSize, complexity) {
        const tokensBase = this.estimations.token_usage.report_analysis;
        const multiplier = dataSize === 'large' ? 3 : dataSize === 'medium' ? 2 : 1;
        const totalTokens = tokensBase.avg * multiplier;
        const apiCalls = complexity === 'high' ? 3 : 2;

        return {
            operation: 'analyze_financials',
            description: `Análisis completo de estados financieros (${dataSize})`,
            estimated_operations: [
                `Analizar balance general y estado de resultados`,
                `Calcular ratios financieros clave`,
                `Identificar tendencias y anomalías`,
                `Generar recomendaciones de mejora`
            ],
            resource_usage: {
                tokens_estimated: totalTokens,
                api_calls_estimated: apiCalls,
                cost_estimated: `$${(totalTokens * 0.05 / 1000000).toFixed(6)}`,
                time_estimated: `${Math.ceil(apiCalls * 4)}s`
            },
            risks: [
                'Análisis complejo puede requerir múltiples llamadas API',
                'Interpretaciones subjetivas en recomendaciones'
            ],
            recommendations: [
                'Revisar manualmente resultados críticos',
                'Comparar con benchmarks del sector'
            ]
        };
    }

    previewDataValidation(accountCount) {
        const tokensPerAccount = this.estimations.token_usage.data_validation;
        const totalTokens = accountCount * tokensPerAccount.avg;
        const apiCalls = Math.ceil(accountCount / 100); // 100 validaciones por llamada

        return {
            operation: 'validate_data',
            description: `Validar integridad de ${accountCount} registros contables`,
            estimated_operations: [
                `Verificar consistencia de partida doble`,
                `Validar jerarquía de cuentas`,
                `Detectar asientos irregulares`,
                `Generar reporte de validación`
            ],
            resource_usage: {
                tokens_estimated: totalTokens,
                api_calls_estimated: apiCalls,
                cost_estimated: `$${(totalTokens * 0.05 / 1000000).toFixed(6)}`,
                time_estimated: `${Math.ceil(apiCalls * 1.5)}s`
            },
            risks: [
                'Falsos positivos en detección de irregularidades',
                'Configuración incorrecta de reglas de validación'
            ],
            recommendations: [
                'Configurar umbrales de validación apropiados',
                'Revisar excepciones manualmente'
            ]
        };
    }

    previewGenericOperation(operation, context) {
        return {
            operation,
            description: `Operación: ${operation}`,
            estimated_operations: ['Procesamiento de datos', 'Análisis inteligente', 'Generación de resultados'],
            resource_usage: {
                tokens_estimated: 100,
                api_calls_estimated: 1,
                cost_estimated: '$0.000005',
                time_estimated: '2s'
            },
            risks: ['Operación no estándar - revisar manualmente'],
            recommendations: ['Monitorear ejecución', 'Verificar resultados']
        };
    }
}

module.exports = new SystemRecognition();
