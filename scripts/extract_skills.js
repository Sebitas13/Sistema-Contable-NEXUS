#!/usr/bin/env node

/**
 * Mahoraga Skill System V7.0 - Extractor de Skills JavaScript/JSX
 * Extrae automáticamente funciones, métodos y propiedades de archivos JS/JSX
 * Genera skill cards JSON con metadatos para el sistema de habilidades
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const glob = require('glob');

// Configuración del extractor
const CONFIG = {
    // Lista específica de archivos a procesar (para el sistema contable completo)
    filesToExtract: [
        // Archivos principales del motor AI
        'web-app/server/routes/ai.js',
        'web-app/client/src/services/aiAdjustmentService.js',
        'ai_adjustment_engine.py', // Aunque es Python, incluir para referencia

        // Sistema contable completo - archivos listados por usuario
        'web-app/client/src/pages/Journal.jsx',
        'web-app/server/routes/accounts.js',
        'web-app/client/src/utils/AccountPlanProfile.js',
        'web-app/server/routes/transactions.js',
        'web-app/client/src/components/SmartImportWizard.jsx',
        'web-app/client/src/pages/TrialBalance.jsx',
        'web-app/client/src/pages/Worksheet.jsx',
        'web-app/client/src/pages/FinancialStatements.jsx',
        'web-app/client/src/utils/FinancialStatementEngine.js',
        'web-app/server/utils/serverIncomeStatement.js',
        'web-app/client/src/utils/IncomeStatementEngine.js',
        'web-app/server/routes/ufv.js',
        'web-app/client/src/utils/ufvUtils.js',
        'web-app/server/utils/serverFiscalYearUtils.js',
        'web-app/server/routes/exchange_rates.js',
        'web-app/server/routes/reports.js',
        'web-app/server/db/schema.sql',
        'web-app/server/db.js',
        'web-app/client/src/pages/Ledger.jsx',
        'web-app/client/src/pages/Settings.jsx',
        'web-app/client/src/components/CompanyCard.jsx',
        'web-app/server/routes/companies.js',
        'web-app/client/src/context/CompanyContext.jsx',
        'web-app/client/src/pages/CompanySelector.jsx',
        'web-app/client/src/utils/fiscalYearUtils.js',
        'web-app/server/index.js',
        'web-app/server/services/index.js',
        'web-app/server/routes/index.js',
        'web-app/client/src/pages/ClosingWizard.jsx',
        'web-app/client/src/App.jsx',
        'web-app/client/src/main.jsx',
        'web-app/client/src/pages/Dashboard.jsx',

        // Archivos adicionales importantes para el sistema contable
        'web-app/client/src/pages/Accounts.jsx',
        'web-app/client/src/pages/ExchangeRate.jsx',
        'web-app/client/src/pages/UFV.jsx',
        'web-app/client/src/pages/FixedAssets.jsx',
        'web-app/client/src/pages/Inventory.jsx',
        'web-app/server/routes/inventory.js',
        'web-app/server/routes/fixed_assets.js',
        'web-app/client/src/components/AIAdjustmentPanel.jsx',
        'web-app/client/src/pages/AdjustmentWizard.jsx',
        'web-app/server/services/modelServiceAdapter.js',
        'web-app/server/services/skillLoader.js',
        'web-app/server/services/skillDispatcher.js',
        'web-app/server/routes/skills.js',
        'web-app/server/utils/AccountPlanIntelligence.js',
        'web-app/client/src/DataForge/DataForge.jsx',
        'web-app/client/src/pages/Reports.jsx'
    ],

    // Funciones puras (sin dependencias de contexto)
    pureFunctions: [
        'calculate_depreciation',
        'bankersRound',
        'isNonMonetary',
        'classifyAccountV2',
        'formatCurrency',
        'formatearMonto'
    ],

    // Funciones dependientes de contexto
    contextDeps: {
        'getFiscalYearDetails': ['companyId'],
        'fetchTransactions': ['companyId'],
        'generateAdjustments': ['companyId', 'gestion']
    }
};

/**
 * Extrae información de una función desde el AST
 */
function extractFunctionInfo(node, filePath, code) {
    const skill = {
        id: '',
        name: '',
        file: filePath.replace(/\\/g, '/'),
        type: 'function',
        signature: '',
        isPure: false,
        contextDeps: [],
        doc: '',
        keywords: [],
        anchors: [],
        examples: [],
        confidence: 0.9,
        version: '1.0.0',
        lastUpdated: new Date().toISOString()
    };

    // Nombre de la función
    if (node.id) {
        skill.name = node.id.name;
    } else if (node.key && node.key.name) {
        skill.name = node.key.name;
    }

    // ID único
    skill.id = `${skill.file}::${skill.name}`;

    // Parámetros (firma)
    if (node.params && node.params.length > 0) {
        const params = node.params.map(param => {
            if (param.type === 'Identifier') {
                return param.name;
            } else if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') {
                return `${param.left.name}=${param.right ? param.right.value || param.right.name : 'default'}`;
            }
            return 'param';
        });
        skill.signature = `(${params.join(', ')})`;
    } else {
        skill.signature = '()';
    }

    // Verificar si es función pura
    skill.isPure = CONFIG.pureFunctions.some(pure => skill.name.includes(pure));

    // Dependencias de contexto
    if (CONFIG.contextDeps[skill.name]) {
        skill.contextDeps = CONFIG.contextDeps[skill.name];
        skill.isPure = false;
    }

    // Extraer documentación del comentario anterior
    const lines = code.split('\n');
    let functionLine = -1;

    // Encontrar línea de la función
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(`function ${skill.name}`) ||
            line.includes(`${skill.name}(`) ||
            line.includes(`${skill.name}: function`)) {
            functionLine = i;
            break;
        }
    }

    // Buscar comentario JSDoc anterior
    if (functionLine > 0) {
        let commentStart = -1;
        for (let i = functionLine - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.startsWith('/**')) {
                commentStart = i;
                break;
            } else if (line.startsWith('//') || line === '') {
                continue;
            } else {
                break;
            }
        }

        if (commentStart >= 0) {
            let commentEnd = -1;
            for (let i = commentStart; i < lines.length; i++) {
                if (lines[i].trim().endsWith('*/')) {
                    commentEnd = i;
                    break;
                }
            }

            if (commentEnd > commentStart) {
                const commentLines = lines.slice(commentStart, commentEnd + 1);
                skill.doc = commentLines
                    .map(line => line.replace(/^\s*\*\s?/, '').replace(/^\s*\/\*\*?\s?/, '').replace(/\*\/\s*$/, ''))
                    .join(' ')
                    .trim();
            }
        }
    }

    // Generar keywords automáticamente
    skill.keywords = generateKeywords(skill.name, skill.doc);

    // Generar anchors (patrones de matching)
    skill.anchors = generateAnchors(skill.name, skill.keywords);

    // Generar ejemplos si es función pura
    if (skill.isPure) {
        skill.examples = generateExamples(skill.name);
    }

    return skill;
}

/**
 * Genera keywords automáticamente del nombre y documentación
 */
function generateKeywords(name, doc) {
    const keywords = new Set();

    // Del nombre
    const nameWords = name.toLowerCase().split(/[_-]/);
    nameWords.forEach(word => {
        if (word.length > 3) keywords.add(word);
    });

    // De la documentación
    if (doc) {
        const docWords = doc.toLowerCase().match(/\b\w{4,}\b/g) || [];
        docWords.forEach(word => {
            if (!['that', 'this', 'with', 'from', 'into', 'when', 'then', 'will', 'should', 'could', 'would', 'para', 'para', 'como', 'este', 'esta'].includes(word)) {
                keywords.add(word);
            }
        });
    }

    return Array.from(keywords);
}

/**
 * Genera anchors para matching de consultas
 */
function generateAnchors(name, keywords) {
    const anchors = [];

    // Exact match del nombre
    anchors.push(`^${name.toLowerCase()}$`);

    // Keywords principales
    keywords.slice(0, 3).forEach(keyword => {
        anchors.push(`.*${keyword}.*`);
    });

    // Patrones específicos por dominio
    if (name.includes('depreciation') || name.includes('depreciacion')) {
        anchors.push('/depreciacion|depreciation|activo.*fijo/i');
    }
    if (name.includes('adjustment') || name.includes('ajuste')) {
        anchors.push('/ajuste|adjustment|inflacion/i');
    }
    if (name.includes('classify') || name.includes('clasificar')) {
        anchors.push('/clasificar|classify|cuenta|account/i');
    }

    return anchors;
}

/**
 * Genera ejemplos para funciones puras
 */
function generateExamples(name) {
    const examples = [];

    if (name.includes('bankersRound')) {
        examples.push({
            input: { num: 1.2345, decimalPlaces: 2 },
            output: 1.23
        });
    }

    if (name.includes('calculate_depreciation')) {
        examples.push({
            input: { account: { balance: 10000 }, params: { ufv_initial: 1.0, ufv_final: 1.1 } },
            output: { amount: 833.33, confidence: 0.95 }
        });
    }

    if (name.includes('isNonMonetary')) {
        examples.push({
            input: { code: '1.1.01.001', name: 'Edificio Administrativo' },
            output: true
        });
    }

    return examples;
}

/**
 * Procesa un archivo y extrae skills
 */
function processFile(filePath) {
    try {
        const code = fs.readFileSync(filePath, 'utf8');
        const skills = [];

        // Parsear con Babel (soporte JSX)
        let ast;
        try {
            ast = parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript', 'classProperties', 'decorators-legacy'],
                allowImportExportEverywhere: true,
                allowReturnOutsideFunction: true
            });
        } catch (parseError) {
            console.warn(`⚠️ No se pudo parsear ${filePath}: ${parseError.message}`);
            return skills;
        }

        // Traversar AST
        traverse(ast, {
            FunctionDeclaration(nodePath) {
                const skill = extractFunctionInfo(nodePath.node, filePath, code);
                if (skill.name) skills.push(skill);
            },

            FunctionExpression(nodePath) {
                // Funciones asignadas a variables
                if (nodePath.parent.type === 'VariableDeclarator' && nodePath.parent.id.name) {
                    const skill = extractFunctionInfo(nodePath.node, filePath, code);
                    skill.name = nodePath.parent.id.name;
                    skill.id = `${skill.file}::${skill.name}`;
                    skills.push(skill);
                }

                // Funciones en object methods
                if (nodePath.parent.type === 'ObjectMethod' && nodePath.parent.key.name) {
                    const skill = extractFunctionInfo(nodePath.node, filePath, code);
                    skill.name = nodePath.parent.key.name;
                    skill.id = `${skill.file}::${skill.name}`;
                    skills.push(skill);
                }
            },

            ArrowFunctionExpression(nodePath) {
                // Arrow functions asignadas
                if (nodePath.parent.type === 'VariableDeclarator' && nodePath.parent.id.name) {
                    const skill = extractFunctionInfo(nodePath.node, filePath, code);
                    skill.name = nodePath.parent.id.name;
                    skill.id = `${skill.file}::${skill.name}`;
                    skills.push(skill);
                }
            },

            ClassMethod(nodePath) {
                const skill = extractFunctionInfo(nodePath.node, filePath, code);
                if (nodePath.parentPath.parent.type === 'ClassDeclaration') {
                    const className = nodePath.parentPath.parent.id.name;
                    skill.name = `${className}.${skill.name}`;
                }
                skill.id = `${skill.file}::${skill.name}`;
                skills.push(skill);
            }
        });

        return skills;

    } catch (error) {
        console.error(`❌ Error procesando ${filePath}:`, error.message);
        return [];
    }
}

/**
 * Función principal
 */
async function main() {
    console.log('🔮 MAHORAGA SKILL SYSTEM V7.0 - EXTRACTOR JS/JSX');
    console.log('='.repeat(60));

    const allSkills = [];
    let filesProcessed = 0;

    console.log(`\n📁 Procesando ${CONFIG.filesToExtract.length} archivos específicos del sistema contable`);

    // Procesar archivos específicos
    for (const filePath of CONFIG.filesToExtract) {
        const fullPath = path.resolve(filePath);

        if (!fs.existsSync(fullPath)) {
            console.warn(`⚠️ Archivo no existe: ${fullPath}`);
            continue;
        }

        console.log(`📄 Procesando: ${filePath}`);
        const skills = processFile(fullPath);

        if (skills.length > 0) {
            allSkills.push(...skills);
            console.log(`  ✓ ${skills.length} skills extraídas`);
            // Mostrar primeras 3 skills
            skills.slice(0, 3).forEach(skill => {
                console.log(`    - ${skill.name} ${skill.signature}`);
            });
            if (skills.length > 3) {
                console.log(`    ... y ${skills.length - 3} más`);
            }
        } else {
            console.log(`  ⚠️ Sin skills encontradas`);
        }

        filesProcessed++;
    }

    // Filtrar duplicados por ID
    const uniqueSkills = [];
    const seenIds = new Set();

    for (const skill of allSkills) {
        if (!seenIds.has(skill.id)) {
            uniqueSkills.push(skill);
            seenIds.add(skill.id);
        }
    }

    // Guardar resultado
    const outputPath = path.resolve('web-app/server/skills_output.json');
    fs.writeFileSync(outputPath, JSON.stringify(uniqueSkills, null, 2), 'utf8');

    console.log('\n🎯 EXTRACCIÓN COMPLETADA');
    console.log('='.repeat(60));
    console.log(`📊 Estadísticas:`);
    console.log(`   Archivos procesados: ${filesProcessed}`);
    console.log(`   Skills extraídas: ${uniqueSkills.length}`);
    console.log(`   Skills puras: ${uniqueSkills.filter(s => s.isPure).length}`);
    console.log(`   Skills con contexto: ${uniqueSkills.filter(s => s.contextDeps.length > 0).length}`);
    console.log(`\n💾 Output guardado en: ${outputPath}`);

    // Mostrar resumen de skills por archivo
    const skillsByFile = {};
    uniqueSkills.forEach(skill => {
        const file = skill.file;
        if (!skillsByFile[file]) skillsByFile[file] = [];
        skillsByFile[file].push(skill.name);
    });

    console.log('\n📋 Skills por archivo:');
    Object.entries(skillsByFile).forEach(([file, skills]) => {
        console.log(`   ${file}: ${skills.length} (${skills.slice(0, 3).join(', ')}${skills.length > 3 ? '...' : ''})`);
    });
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { extractFunctionInfo, processFile, generateKeywords, generateAnchors };
