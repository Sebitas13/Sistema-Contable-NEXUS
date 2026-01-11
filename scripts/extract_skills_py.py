#!/usr/bin/env python3
"""
Mahoraga Skill System V7.0 - Extractor de Skills Python
Extrae automáticamente funciones, métodos y clases de archivos Python
Genera skill cards JSON con metadatos para el sistema de habilidades
"""

import os
import re
import json
import ast
import inspect
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path

class PythonSkillExtractor:
    """Extractor de skills para archivos Python"""

    def __init__(self):
        self.config = {
            # Directorios a escanear
            'scan_dirs': [
                'ai_adjustment_engine.py',
                'web-app/server/utils',
                'scripts'
            ],

            # Exclusiones
            'exclude_patterns': [
                '__pycache__',
                '.venv',
                'node_modules',
                '*.pyc',
                '*test*.py',
                '*spec*.py'
            ],

            # Funciones puras (sin dependencias de contexto)
            'pure_functions': [
                'calculate_depreciation_pot',
                'calculate_aitb_pot',
                'calculate_provision_pot',
                'classify_account_semantic',
                'bankers_round',
                'is_non_monetary'
            ],

            # Funciones dependientes de contexto
            'context_deps': {
                'generate_adjustments': ['company_id', 'gestion'],
                'learn_from_feedback': ['company_id'],
                'fetch_transactions': ['company_id'],
                'get_fiscal_year_details': ['company_id']
            }
        }

    def extract_function_info(self, node: ast.FunctionDef, file_path: str, source_code: str) -> Dict[str, Any]:
        """Extrae información de una función desde el AST"""

        skill = {
            'id': '',
            'name': node.name,
            'file': file_path.replace('\\', '/'),
            'type': 'function',
            'signature': '',
            'isPure': False,
            'contextDeps': [],
            'doc': ast.get_docstring(node) or '',
            'keywords': [],
            'anchors': [],
            'examples': [],
            'confidence': 0.9,
            'version': '1.0.0',
            'lastUpdated': datetime.now().isoformat()
        }

        # ID único
        skill['id'] = f"{skill['file']}::{skill['name']}"

        # Parámetros (firma)
        if node.args.args:
            params = []
            for arg in node.args.args:
                param_name = arg.arg
                # Verificar si tiene valor por defecto
                if node.args.defaults:
                    # Calcular cuál default corresponde a este arg
                    default_index = len(node.args.args) - len(node.args.defaults)
                    arg_index = node.args.args.index(arg)
                    if arg_index >= default_index:
                        default_value = node.args.defaults[arg_index - default_index]
                        if isinstance(default_value, ast.Str):
                            param_name += f"='{default_value.s}'"
                        elif isinstance(default_value, ast.Num):
                            param_name += f"={default_value.n}"
                        elif isinstance(default_value, ast.NameConstant):
                            param_name += f"={default_value.value}"
                        else:
                            param_name += "=default"

                params.append(param_name)

            # Args variables (*args, **kwargs)
            if node.args.vararg:
                params.append(f"*{node.args.vararg.arg}")
            if node.args.kwarg:
                params.append(f"**{node.args.kwarg.arg}")

            skill['signature'] = f"({', '.join(params)})"
        else:
            skill['signature'] = '()'

        # Verificar si es función pura
        skill['isPure'] = any(pure in skill['name'] for pure in self.config['pure_functions'])

        # Dependencias de contexto
        if skill['name'] in self.config['context_deps']:
            skill['contextDeps'] = self.config['context_deps'][skill['name']]
            skill['isPure'] = False

        # Generar keywords automáticamente
        skill['keywords'] = self.generate_keywords(skill['name'], skill['doc'])

        # Generar anchors (patrones de matching)
        skill['anchors'] = self.generate_anchors(skill['name'], skill['keywords'])

        # Generar ejemplos si es función pura
        if skill['isPure']:
            skill['examples'] = self.generate_examples(skill['name'])

        return skill

    def extract_class_info(self, node: ast.ClassDef, file_path: str, source_code: str) -> List[Dict[str, Any]]:
        """Extrae información de una clase y sus métodos"""

        skills = []
        class_name = node.name

        # Skill para la clase misma
        class_skill = {
            'id': f"{file_path.replace('\\', '/')}::{class_name}",
            'name': class_name,
            'file': file_path.replace('\\', '/'),
            'type': 'class',
            'signature': '',
            'isPure': False,
            'contextDeps': [],
            'doc': ast.get_docstring(node) or '',
            'keywords': self.generate_keywords(class_name, ast.get_docstring(node) or ''),
            'anchors': self.generate_anchors(class_name, self.generate_keywords(class_name, ast.get_docstring(node) or '')),
            'examples': [],
            'confidence': 0.85,
            'version': '1.0.0',
            'lastUpdated': datetime.now().isoformat()
        }
        skills.append(class_skill)

        # Extraer métodos de la clase
        for item in node.body:
            if isinstance(item, ast.FunctionDef):
                method_skill = self.extract_function_info(item, file_path, source_code)
                method_skill['name'] = f"{class_name}.{item.name}"
                method_skill['id'] = f"{file_path.replace('\\', '/')}::{class_name}.{item.name}"
                skills.append(method_skill)

        return skills

    def generate_keywords(self, name: str, doc: str) -> List[str]:
        """Genera keywords automáticamente del nombre y documentación"""

        keywords = set()

        # Del nombre
        name_words = re.findall(r'\b\w{4,}\b', name.lower().replace('_', ' '))
        keywords.update(name_words)

        # De la documentación
        if doc:
            doc_words = re.findall(r'\b\w{4,}\b', doc.lower())
            # Filtrar palabras comunes
            filtered_words = [
                word for word in doc_words
                if word not in ['that', 'this', 'with', 'from', 'into', 'when', 'then', 'will', 'should',
                              'could', 'would', 'para', 'como', 'este', 'esta', 'para', 'con', 'por']
            ]
            keywords.update(filtered_words[:5])  # Limitar a 5 keywords de doc

        return list(keywords)

    def generate_anchors(self, name: str, keywords: List[str]) -> List[str]:
        """Genera anchors para matching de consultas"""

        anchors = []

        # Exact match del nombre
        anchors.append(f"^{name.lower()}$")

        # Keywords principales
        for keyword in keywords[:3]:
            anchors.append(f".*{keyword}.*")

        # Patrones específicos por dominio
        if 'depreciation' in name.lower() or 'depreciacion' in name.lower():
            anchors.append('/depreciacion|depreciation|activo.*fijo/i')
        if 'adjustment' in name.lower() or 'ajuste' in name.lower():
            anchors.append('/ajuste|adjustment|inflacion/i')
        if 'classify' in name.lower() or 'clasificar' in name.lower():
            anchors.append('/clasificar|classify|cuenta|account/i')
        if 'aitb' in name.lower():
            anchors.append('/aitb|inflacion|tenencia/i')

        return anchors

    def generate_examples(self, name: str) -> List[Dict[str, Any]]:
        """Genera ejemplos para funciones puras"""

        examples = []

        if 'calculate_depreciation_pot' in name:
            examples.append({
                'input': {
                    'account': {'code': '1.2.01.001', 'name': 'Maquinaria', 'balance': 10000},
                    'params': {'ufv_initial': 1.0, 'ufv_final': 1.1}
                },
                'output': {'amount': 833.33, 'confidence': 0.95, 'audit_trail': '[DEPRECIACIÓN]'}
            })

        if 'calculate_aitb_pot' in name:
            examples.append({
                'input': {
                    'account': {'code': '1.1.01.001', 'name': 'Edificio', 'balance': 50000},
                    'params': {'ufv_initial': 1.0, 'ufv_final': 1.15}
                },
                'output': {'amount': 6250, 'confidence': 0.98, 'audit_trail': '[AITB]'}
            })

        if 'classify_account_semantic' in name:
            examples.append({
                'input': {'account': {'code': '1.1.01.001', 'name': 'Edificio Administrativo'}},
                'output': {'type': 'non_monetary', 'confidence': 0.95, 'tags': ['NoMonetario', 'ActivoFijo']}
            })

        if 'bankers_round' in name:
            examples.append({
                'input': {'num': 1.2345, 'decimalPlaces': 2},
                'output': 1.23
            })

        return examples

    def process_file(self, file_path: str) -> List[Dict[str, Any]]:
        """Procesa un archivo Python y extrae skills"""

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                source_code = f.read()

            # Parsear AST
            try:
                tree = ast.parse(source_code, filename=file_path)
            except SyntaxError as e:
                print(f"⚠️ No se pudo parsear {file_path}: {e}")
                return []

            skills = []

            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    # Solo funciones de nivel módulo (no métodos de clase)
                    if not self.is_method_of_class(node, tree):
                        skill = self.extract_function_info(node, file_path, source_code)
                        skills.append(skill)

                elif isinstance(node, ast.ClassDef):
                    class_skills = self.extract_class_info(node, file_path, source_code)
                    skills.extend(class_skills)

            return skills

        except Exception as error:
            print(f"❌ Error procesando {file_path}: {error}")
            return []

    def find_python_files(self) -> List[str]:
        """Encuentra todos los archivos Python a procesar"""

        files = []

        for scan_item in self.config['scan_dirs']:
            if os.path.isfile(scan_item) and scan_item.endswith('.py'):
                # Archivo específico
                files.append(scan_item)
            elif os.path.isdir(scan_item):
                # Directorio
                for root, dirs, filenames in os.walk(scan_item):
                    # Excluir directorios
                    dirs[:] = [d for d in dirs if not any(ex in d for ex in self.config['exclude_patterns'])]

                    for filename in filenames:
                        if filename.endswith('.py') and not any(ex in filename for ex in self.config['exclude_patterns']):
                            files.append(os.path.join(root, filename))
            else:
                print(f"⚠️ Elemento no encontrado: {scan_item}")

        return list(set(files))  # Eliminar duplicados

    def is_method_of_class(self, func_node: ast.FunctionDef, tree: ast.AST) -> bool:
        """Verifica si una función es un método de clase (tiene ancestro ClassDef)"""
        # Recorrer todos los nodos para encontrar si func_node está dentro de una clase
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                # Verificar si func_node está en el body de esta clase
                if func_node in node.body:
                    return True
        return False

def main():
    """Función principal"""

    print('🐍 MAHORAGA SKILL SYSTEM V7.0 - EXTRACTOR PYTHON')
    print('=' * 60)

    extractor = PythonSkillExtractor()
    all_skills = []
    files_processed = 0

    # Encontrar archivos Python
    python_files = extractor.find_python_files()
    print(f"\n📁 Encontrados {len(python_files)} archivos Python")

    # Procesar archivos
    for file_path in python_files:
        print(f"\n📄 Procesando: {file_path}")
        skills = extractor.process_file(file_path)

        if skills:
            all_skills.extend(skills)
            print(f"  ✓ {len(skills)} skills extraídas")
            for skill in skills[:3]:  # Mostrar primeras 3
                print(f"    - {skill['name']} {skill['signature']}")
            if len(skills) > 3:
                print(f"    ... y {len(skills) - 3} más")
        else:
            print("  ⚠️ Sin skills encontradas")

        files_processed += 1

    # Filtrar duplicados por ID
    unique_skills = []
    seen_ids = set()

    for skill in all_skills:
        if skill['id'] not in seen_ids:
            unique_skills.append(skill)
            seen_ids.add(skill['id'])

    # Guardar resultado
    output_path = os.path.join('web-app', 'server', 'skills_output_py.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(unique_skills, f, indent=2, ensure_ascii=False)

    print(f'\n🎯 EXTRACCIÓN PYTHON COMPLETADA')
    print('=' * 60)
    print(f'📊 Estadísticas:')
    print(f'   Archivos procesados: {files_processed}')
    print(f'   Skills extraídas: {len(unique_skills)}')
    print(f'   Skills puras: {len([s for s in unique_skills if s["isPure"]])}')
    print(f'   Skills con contexto: {len([s for s in unique_skills if s["contextDeps"]])}')
    print(f'   Clases extraídas: {len([s for s in unique_skills if s["type"] == "class"])}')
    print(f'\n💾 Output guardado en: {output_path}')

    # Mostrar resumen de skills por archivo
    skills_by_file = {}
    for skill in unique_skills:
        file_key = skill['file']
        if file_key not in skills_by_file:
            skills_by_file[file_key] = []
        skills_by_file[file_key].append(skill['name'])

    print('\n📋 Skills por archivo:')
    for file_path, skill_names in skills_by_file.items():
        print(f'   {file_path}: {len(skill_names)} ({", ".join(skill_names[:3])}{"..." if len(skill_names) > 3 else ""})')

if __name__ == '__main__':
    main()
