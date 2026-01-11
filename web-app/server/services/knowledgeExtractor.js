/**
 * Knowledge Extractor V1.0
 * Extrae conocimiento estructural del sistema para Mahoraga
 * Lee archivos existentes y construye mapas de conocimiento
 */

const fs = require('fs');
const path = require('path');

class KnowledgeExtractor {
    constructor() {
        this.serverRoot = path.join(__dirname, '..');
        this.knowledge = {
            fileStructure: {},
            dataFlow: {},
            apiEndpoints: {},
            accountingCycle: {},
            relationships: {}
        };
    }

    extract() {
        console.log('🧠 MAHORAGA: Extrayendo conocimiento del sistema...');
        
        this.extractFileStructure();
        this.extractRouteRelationships();
        this.extractServiceRelationships();
        this.extractAccountingCycle();
        this.extractDataFlow();
        
        console.log('✅ Conocimiento extraído exitosamente');
        return this.knowledge;
    }

    extractFileStructure() {
        const structure = {
            entryPoints: [],
            routes: [],
            services: [],
            utils: [],
            models: []
        };

        const serverDir = path.join(this.serverRoot, 'server');
        
        // Entry points
        const indexPath = path.join(serverDir, 'index.js');
        if (fs.existsSync(indexPath)) {
            structure.entryPoints.push({
                file: 'index.js',
                port: 3001,
                description: 'Servidor principal Express'
            });
        }

        // Routes
        const routesDir = path.join(serverDir, 'routes');
        if (fs.existsSync(routesDir)) {
            const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
            structure.routes = routeFiles.map(f => ({
                file: f,
                endpoint: `/api/${f.replace('.js', '')}`,
                description: this.getRouteDescription(f)
            }));
        }

        // Services
        const servicesDir = path.join(serverDir, 'services');
        if (fs.existsSync(servicesDir)) {
            const serviceFiles = fs.readdirSync(servicesDir).filter(f => f.endsWith('.js'));
            structure.services = serviceFiles.map(f => ({
                file: f,
                purpose: this.getServicePurpose(f)
            }));
        }

        // Utils
        const utilsDir = path.join(serverDir, 'utils');
        if (fs.existsSync(utilsDir)) {
            const utilFiles = fs.readdirSync(utilsDir).filter(f => f.endsWith('.js'));
            structure.utils = utilFiles.map(f => ({
                file: f,
                purpose: this.getUtilPurpose(f)
            }));
        }

        this.knowledge.fileStructure = structure;
    }

    getRouteDescription(filename) {
        const descriptions = {
            'transactions.js': 'Gestión de transacciones contables (libro diario)',
            'accounts.js': 'Plan de cuentas contables (PUCT)',
            'reports.js': 'Reportes financieros y estados contables',
            'ufv.js': 'Valores UFV para ajustes por inflación',
            'companies.js': 'Gestión de empresas multi-tenant',
            'exchange_rates.js': 'Tipos de cambio de divisas',
            'ai.js': 'Motor AI y ajustes automatizados (Mahoraga)',
            'skills.js': 'Sistema de skills de Mahoraga',
            'orchestrator.js': 'Orquestador cognitivo AI'
        };
        return descriptions[filename] || 'Endpoint del sistema';
    }

    getServicePurpose(filename) {
        const purposes = {
            'skillLoader.js': 'Carga y indexa skills del sistema',
            'skillDispatcher.js': 'Dispatching seguro de skills',
            'mahoragaController.js': 'Control de seguridad y permisos de Mahoraga',
            'systemRecognition.js': 'Reconocimiento del sistema y aprendizaje',
            'cognitiveOrchestrator.js': 'Orquestación de pipelines AI',
            'groqMonitor.js': 'Monitoreo de uso de API Groq',
            'modelServiceAdapter.js': 'Adaptador para servicios de modelo AI',
            'db.js': 'Conexión a base de datos SQLite'
        };
        return purposes[filename] || 'Servicio del sistema';
    }

    getUtilPurpose(filename) {
        const purposes = {
            'AccountPlanIntelligence.js': 'Análisis inteligente del plan de cuentas',
            'serverFiscalYearUtils.js': 'Utilidades de ejercicio fiscal',
            'serverIncomeStatement.js': ' motor de estado de resultados'
        };
        return purposes[filename] || 'Utilidad del sistema';
    }

    extractRouteRelationships() {
        const relationships = {
            'transactions': ['accounts', 'companies'],
            'accounts': ['companies', 'transactions'],
            'reports': ['accounts', 'transactions', 'ufv'],
            'ufv': ['companies', 'transactions'],
            'companies': ['accounts', 'transactions', 'ufv'],
            'ai': ['accounts', 'ufv', 'companies', 'skills'],
            'skills': ['ai'],
            'exchange_rates': ['transactions', 'companies']
        };

        this.knowledge.relationships.routes = relationships;
    }

    extractServiceRelationships() {
        const relationships = {
            'index.js': ['db', 'routes/*'],
            'routes/ai.js': ['services/mahoragaController', 'services/groqMonitor', '../services/modelServiceAdapter'],
            'routes/skills.js': ['services/skillLoader', 'services/skillDispatcher'],
            'routes/reports.js': ['../utils/AccountPlanIntelligence', '../utils/serverIncomeStatement'],
            'services/cognitiveOrchestrator.js': ['modelServiceAdapter', 'systemRecognition'],
            'services/skillDispatcher.js': ['skillLoader', 'groqMonitor']
        };

        this.knowledge.relationships.services = relationships;
    }

    extractAccountingCycle() {
        this.knowledge.accountingCycle = {
            phases: [
                {
                    id: 'setup',
                    name: 'Configuración Inicial',
                    order: 1,
                    activities: [
                        'Crear empresa',
                        'Definir plan de cuentas (PUCT)',
                        'Configurar ejercicio fiscal',
                        'Establecer tipos de cambio iniciales'
                    ],
                    mahoragaRole: 'Sugerir estructura PUCT según normativa boliviana'
                },
                {
                    id: 'transactions',
                    name: 'Registro de Transacciones',
                    order: 2,
                    activities: [
                        'Ingresar asientos contables',
                        'Validar partida doble',
                        'Verificar balances',
                        'Clasificar cuentas'
                    ],
                    mahoragaRole: 'Auto-clasificar cuentas según ontología contable'
                },
                {
                    id: 'adjustments',
                    name: 'Ajustes Contables',
                    order: 3,
                    activities: [
                        'Ajustes UFV (NC-3)',
                        'Ajustes TC (NC-6)',
                        'Depreciación de activos (DS-24051)',
                        'Provisiones'
                    ],
                    mahoragaRole: 'Generar asientos de ajuste automáticamente'
                },
                {
                    id: 'closing',
                    name: 'Cierre Contable',
                    order: 4,
                    activities: [
                        'Mayorización',
                        'Hoja de trabajo',
                        'Estados financieros',
                        'Cierre de gestión'
                    ],
                    mahoragaRole: 'Validar cierre y detectar inconsistencias'
                }
            ],
            normativeReferences: {
                'NC-3': 'Ajuste por inflación de estados financieros',
                'NC-6': 'Registro de operaciones en moneda extranjera',
                'DS-24051': 'Reglamento de depreciación de activos fijos'
            }
        };
    }

    extractDataFlow() {
        this.knowledge.dataFlow = {
            frontendToBackend: {
                description: 'El frontend React envía requests HTTP al backend Express',
                endpoints: ['/api/transactions', '/api/accounts', '/api/reports', '/api/ai/*'],
                format: 'JSON'
            },
            backendToDatabase: {
                description: 'El backend usa SQLite3 para persistencia',
                database: 'web-app/server/db/accounting.db',
                tables: ['companies', 'accounts', 'transactions', 'transaction_entries', 
                        'ufv_rates', 'exchange_rates', 'fixed_assets', 'inventory_items',
                        'mahoraga_adaptation_events', 'company_adjustment_profiles']
            },
            nodeToPython: {
                description: 'Node.js hace proxy al motor Python para operaciones AI',
                port: 8003,
                endpoints: ['/api/ai/adjustments/*'],
                fallback: 'Lógica tradicional cuando Python no está disponible'
            },
            aiLearning: {
                description: 'Mahoraga aprende de correcciones del usuario',
                storage: 'company_adjustment_profiles table',
                events: 'mahoraga_adaptation_events table',
                adaptationTypes: ['monetary_rules', 'non_monetary_rules', 'suppression_rules']
            }
        };
    }

    getKnowledge() {
        return this.knowledge;
    }

    getContext(phase) {
        const phaseData = this.knowledge.accountingCycle.phases.find(p => p.id === phase);
        if (phaseData) {
            return {
                phase: phaseData,
                relatedRoutes: this.knowledge.relationships.routes[phase] || [],
                fileStructure: this.knowledge.fileStructure
            };
        }
        return null;
    }
}

module.exports = new KnowledgeExtractor();
