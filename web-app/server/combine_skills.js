const fs = require('fs');
const path = require('path');

// Rutas de archivos
const JS_SKILLS_PATH = path.join(__dirname, 'skills_output.json');
const PY_SKILLS_PATH = path.join(__dirname, 'skills_output_py.json');
const COMBINED_SKILLS_PATH = path.join(__dirname, 'skills_output_combined.json');

try {
    console.log('🔄 Combinando skills de JS y Python...');

    // Leer archivos
    let jsSkills = [];
    let pySkills = [];

    if (fs.existsSync(JS_SKILLS_PATH)) {
        try {
            const content = fs.readFileSync(JS_SKILLS_PATH, 'utf8');
            const parsed = JSON.parse(content);
            // Manejar tanto array directo como objeto con propiedad skills
            jsSkills = Array.isArray(parsed) ? parsed : (parsed.skills || []);
            console.log(`✅ Cargadas ${jsSkills.length} skills de JS`);
        } catch (e) {
            console.error('⚠️ Error leyendo skills de JS:', e.message);
        }
    } else {
        console.warn('⚠️ Archivo de skills JS no encontrado');
    }

    if (fs.existsSync(PY_SKILLS_PATH)) {
        try {
            const content = fs.readFileSync(PY_SKILLS_PATH, 'utf8');
            const parsed = JSON.parse(content);
            // Manejar tanto array directo como objeto con propiedad skills
            pySkills = Array.isArray(parsed) ? parsed : (parsed.skills || []);
            console.log(`✅ Cargadas ${pySkills.length} skills de Python`);
        } catch (e) {
            console.error('⚠️ Error leyendo skills de Python:', e.message);
        }
    } else {
        console.warn('⚠️ Archivo de skills Python no encontrado');
    }

    // Combinar arrays
    const allSkills = [...jsSkills, ...pySkills];
    
    // Deduplicar por ID
    const uniqueSkillsMap = new Map();
    let duplicatesCount = 0;

    allSkills.forEach(skill => {
        if (!skill.id) {
            console.warn('⚠️ Skill sin ID encontrada, saltando...');
            return;
        }

        if (uniqueSkillsMap.has(skill.id)) {
            duplicatesCount++;
            // Opcional: Podríamos comparar versiones o fechas de actualización aquí
            // Por ahora, mantenemos la última encontrada (que suele ser la de Python si viene después)
            // o la primera si queremos priorizar JS.
            // Sobrescribimos para asegurar la versión más "reciente" en el orden de carga
            uniqueSkillsMap.set(skill.id, skill); 
        } else {
            uniqueSkillsMap.set(skill.id, skill);
        }
    });

    const uniqueSkills = Array.from(uniqueSkillsMap.values());

    console.log(`📊 Estadísticas de combinación:`);
    console.log(`   - Total bruto: ${allSkills.length}`);
    console.log(`   - Duplicados eliminados: ${duplicatesCount}`);
    console.log(`   - Total único final: ${uniqueSkills.length}`);

    // Escribir archivo combinado (como array plano, compatible con SkillLoader)
    const jsonContent = JSON.stringify(uniqueSkills, null, 2);
    
    // Guardar en el archivo combinado
    fs.writeFileSync(COMBINED_SKILLS_PATH, jsonContent);
    console.log(`💾 Guardado en: ${COMBINED_SKILLS_PATH}`);

    // Opcional: Sobrescribir el archivo principal de JS si se desea que el sistema use todo
    // Esto es arriesgado si extract_skills.js sobrescribe este archivo después.
    // Por ahora, dejaremos que el usuario o el proceso de build decida si reemplazar skills_output.json
    // Pero dado que SkillLoader lee skills_output.json, si queremos que funcione YA, deberíamos actualizarlo.
    
    // Haremos una copia de seguridad del original antes de sobrescribir
    if (fs.existsSync(JS_SKILLS_PATH)) {
        fs.copyFileSync(JS_SKILLS_PATH, `${JS_SKILLS_PATH}.bak`);
    }
    fs.writeFileSync(JS_SKILLS_PATH, jsonContent);
    console.log(`🚀 Actualizado archivo principal: ${JS_SKILLS_PATH}`);

} catch (error) {
    console.error('❌ Error fatal combinando skills:', error.message);
    process.exit(1);
}
