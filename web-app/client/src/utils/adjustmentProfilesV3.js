// ESQUEMA DE CONTEXTO DE DOMINIO GOBERNABLE (ARS Context Model V3.0)
// Motor de Contexto ARS-DSPy (Billón por Ciento) - Sin dependencia de LLMs externos
// Proporciona contexto suficiente para razonamiento determinístico en Python backend

export const ARS_CONTEXT_PROFILE = {
    id: 1,
    name: "ARS Context Model - Motor de Razonamiento Adaptativo",
    companyId: "global",
    is_active: true,
    version: "3.0-ARS-DSPy",

    // =============================================================================
    // CONFIGURACIÓN DE RECUPERACIÓN DE DATOS (Ground Truth Integration)
    // =============================================================================
    data_retrieval_config: {
        // Fuente de verdad para saldos pre-ajuste
        ledger_endpoint: "/api/reports/ledger",
        query_filters: {
            excludeAdjustments: true,    // Solo saldos del BC original
            excludeClosing: true,        // Sin asientos de cierre
            dateMode: "GestionEnd"       // Calcular fecha fin de gestión automáticamente
        },
        // Mapeo de campos desde API a formato interno del motor
        field_mapping: {
            account_id: "id",
            account_code: "code", 
            account_name: "name",
            balance_field: "saldo_matematico",  // Priorizar saldo_matematico sobre balance
            account_type: "type"
        },
        // Validación de calidad de datos
        data_quality_thresholds: {
            minimum_accounts: 1,
            minimum_balance_abs: 0.01,
            max_null_percentage: 0.1
        }
    },

    // =============================================================================
    // MÓDULO DE RAZONAMIENTO ADAPTATIVO (ARS Core Engine)
    // =============================================================================
    reasoning_config: {
        // Umbrales dinámicos adaptativos
        confidence_threshold: 0.95,
        adaptive_thresholds: {
            high_confidence: 0.98,    // Auto-aplicar sin revisión
            medium_confidence: 0.85,  // Aplicar con logging
            low_confidence: 0.70      // Suprimir y requerir revisión humana
        },
        
        // Factores de ponderación de razonamiento
        reasoning_weights: {
            semantic_match_weight: 1.2,      // Peso para coincidencia semántica exacta
            pattern_match_weight: 1.0,        // Peso para coincidencia de patrones
            fallback_weight: 0.7,             // Peso para reglas genéricas
            historical_accuracy_weight: 1.5   // Peso para aprendizajes previos
        },

        // Configuración de autocrítica y reflexión
        self_critique_config: {
            enable_strategic_reflectivism: true,
            review_triggers: [
                "high_regulatory_risk",
                "uncertain_classification", 
                "historical_failure_pattern",
                "threshold_violation"
            ],
            auto_correction_modes: [
                "conservative_adjustment",
                "human_escalation",
                "rule_refinement"
            ]
        },

        // Optimización de output (Shorter CoT)
        audit_trail_format: "concise",
        max_reasoning_tokens: 200,
        compression_ratio: 0.3
    },

    // =============================================================================
    // CLASIFICACIÓN SEMÁNTICA UNIVERSAL (Enhanced DSPy-like)
    // =============================================================================
    monetary_rules: [
        {
            pattern: "/MN/i",
            tags: ["Monetario", "MonedaNacional"],
            source_nc: "NC3-Rubro-E",
            reasoning_weight: 1.2,
            confidence_boost: 0.05,
            regulatory_reference: "NC-3 Art.4"
        },
        {
            pattern: "/Caja|Banco|Disponibilidad/i",
            tags: ["Monetario", "Liquidez"],
            source_nc: "NC3-Rubro-E", 
            reasoning_weight: 1.3,
            confidence_boost: 0.08,
            regulatory_reference: "NC-3 Art.4"
        },
        {
            pattern: "/Cuentas Por (Cobrar|Pagar) MN/i",
            tags: ["Monetario", "Exigible"],
            source_nc: "NC3-Rubro-E",
            reasoning_weight: 1.1,
            confidence_boost: 0.03,
            regulatory_reference: "NC-3 Art.4"
        },
        {
            pattern: "/^[4-6][0-9]/",
            tags: ["Monetario", "Resultado"],
            source_nc: "PlanCuentas-Resultado",
            reasoning_weight: 1.0,
            confidence_boost: 0.02,
            regulatory_reference: "NC-3 Excluido"
        },
        {
            pattern: "/Préstamos Bancarios MN/i",
            tags: ["Monetario", "Pasivo"],
            source_nc: "NC3-Rubro-E",
            reasoning_weight: 1.1,
            confidence_boost: 0.04,
            regulatory_reference: "NC-3 Art.4"
        }
    ],

    non_monetary_rules: [
        {
            pattern: "/Inventario|Mercadería/i",
            tags: ["NoMonetario", "ActivoCorriente"],
            source_nc: "NC3-Rubro-F",
            reasoning_weight: 1.2,
            confidence_boost: 0.06,
            regulatory_reference: "NC-3 Art.5"
        },
        {
            pattern: "/Activo(s)? Fijo(s)?/i",
            tags: ["NoMonetario", "Depreciable"],
            source_nc: "NC3-Rubro-F",
            reasoning_weight: 1.3,
            confidence_boost: 0.08,
            regulatory_reference: "DS-24051"
        },
        {
            pattern: "/Intangible(s)?|Cargos Diferidos/i",
            tags: ["NoMonetario", "Amortizable"],
            source_nc: "NC3-Rubro-F",
            reasoning_weight: 1.1,
            confidence_boost: 0.05,
            regulatory_reference: "NC-6 Art.38"
        },
        {
            pattern: "/^1[6-9]/",
            tags: ["NoMonetario", "ActivoNoCorriente"],
            source_nc: "PlanCuentas-Activo",
            reasoning_weight: 1.0,
            confidence_boost: 0.02,
            regulatory_reference: "NC-3 Art.5"
        }
    ],

    // =============================================================================
    // AJUSTE INTEGRAL POR INFLACIÓN (Enhanced AITB)
    // =============================================================================
    aitb_settings: {
        aitb_account_patterns: [
            // Patrones para buscar cuenta de AITB en diferentes planes de cuentas
            "Ajuste por inflacion",
            "Ajuste por inflación", 
            "Ajuste inflacion",
            "Ajuste inflación",
            "Inflacion y tenencia",
            "Inflación y tenencia",
            "AITB",
            "Ajuste integral",
            "Revalorizacion",
            "Revalorización"
        ],
        method: "UFV",
        regulatory_risk_factor: 1.15,        // Factor de riesgo regulatorio dinámico
        minimum_threshold: 0.01,             // Mínimo para generar ajuste
        
        // Configuración de riesgo y sensibilidad
        risk_config: {
            high_adjustment_threshold: 10000,    // Sobre este valor, aumenta sensibilidad
            risk_multiplier: 1.25,                // Multiplicador de riesgo para altos valores
            confidence_penalty: 0.1               // Penalización de confianza para ajustes grandes
        },
        
        // Cálculo de Coeficiente Corrector (CC)
        cc_calculation: {
            precision: 6,
            rounding_method: "bankers",
            inflation_threshold: 0.01,          // Solo si inflación > 1%
            zero_adjustment_tolerance: 0.001
        },
        
        // Validación regulatoria
        regulatory_validation: {
            nc3_compliance: true,
            max_cc_variance: 0.05,             // Máxima variación permitida en CC
            require_supporting_docs: false
        }
    },

    // =============================================================================
    // DEPRECIACIÓN Y AMORTIZACIÓN (Enhanced PoT Fidelity)
    // =============================================================================
    depreciation_settings: {
        // Configuración de fidelidad de coincidencia
        asset_type_regex_fidelity: 0.95,      // Fidelidad base para coincidencia exacta
        fallback_fidelity: 0.65,              // Fidelidad para reglas genéricas
        
        // Modelos de vida útil con factores de certeza
        assets_life: [
            {
                asset_type_keyword: "edificios",
                asset_type_regex: "/edificio(s)?/i",
                useful_life_years: 40,
                annual_rate: 0.025,
                monthly_rate_formula: "(VALUE * annual_rate) / 12",
                nc_reference: "DS 24051 - Anexo",
                confidence_level: 0.95,
                reasoning_weight: 1.3,
                depreciation_method: "Linear",
                residual_value_rate: 0.05,
                regulatory_risk: "low"
            },
            {
                asset_type_keyword: "maquinaria y equipo",
                asset_type_regex: "/maquinaria|equipo/i",
                useful_life_years: 10,
                annual_rate: 0.10,
                monthly_rate_formula: "(VALUE * annual_rate) / 12",
                nc_reference: "DS 24051 - Anexo",
                confidence_level: 0.90,
                reasoning_weight: 1.2,
                depreciation_method: "Linear",
                residual_value_rate: 0.10,
                regulatory_risk: "medium"
            },
            {
                asset_type_keyword: "vehiculos",
                asset_type_regex: "/vehiculo(s)?|automotor(es)?/i",
                useful_life_years: 5,
                annual_rate: 0.20,
                monthly_rate_formula: "(VALUE * annual_rate) / 12",
                nc_reference: "DS 24051 - Anexo",
                confidence_level: 0.85,
                reasoning_weight: 1.1,
                depreciation_method: "Linear",
                residual_value_rate: 0.20,
                regulatory_risk: "medium"
            },
            {
                asset_type_keyword: "equipos de computación",
                asset_type_regex: "/computo|computadora|laptop|pc/i",
                useful_life_years: 5,
                annual_rate: 0.20,
                monthly_rate_formula: "(VALUE * annual_rate) / 12",
                nc_reference: "DS 24051 - Anexo",
                confidence_level: 0.85,
                reasoning_weight: 1.1,
                depreciation_method: "Linear",
                residual_value_rate: 0.10,
                regulatory_risk: "low"
            },
            {
                asset_type_keyword: "activos intangibles",
                asset_type_regex: "/intangible|software|patente/i",
                useful_life_years: 10,
                annual_rate: 0.10,
                monthly_rate_formula: "(VALUE * annual_rate) / 12",
                nc_reference: "NC 6 - Art. 38",
                confidence_level: 0.80,
                reasoning_weight: 1.0,
                depreciation_method: "Linear",
                residual_value_rate: 0.0,
                regulatory_risk: "medium"
            },
            {
                asset_type_keyword: "cargos diferidos",
                asset_type_regex: "/cargo|diferido/i",
                useful_life_years: 5,
                annual_rate: 0.20,
                monthly_rate_formula: "(VALUE * annual_rate) / 12",
                nc_reference: "NC 6 - Art. 42",
                confidence_level: 0.75,
                reasoning_weight: 0.9,
                depreciation_method: "Linear",
                residual_value_rate: 0.0,
                regulatory_risk: "low"
            }
        ],
        
        // Validación y control de calidad
        quality_control: {
            minimum_depreciation_amount: 0.01,
            maximum_cumulative_depreciation: 0.95,  // Máximo 95% del valor
            require_asset_verification: false,
            depreciation_ceiling: 0.98              // Techo de depreciación acumulada
        }
    },

    // =============================================================================
    // HISTORIAL DE CORRECCIONES Y AUTOAPRENDIZAJE (SCL Hook)
    // =============================================================================
    correction_history: {
        // Registro de errores y correcciones humanas
        entries: [],
        
        // Configuración de aprendizaje
        learning_config: {
            enable_adaptive_learning: true,
            learning_weight_decay: 0.95,      // Decaimiento de peso de aprendizajes antiguos
            min_corrections_for_pattern: 3,  // Mínimo de correcciones para detectar patrón
            pattern_recognition_threshold: 0.8
        },
        
        // Tipos de errores etiquetados
        error_taxonomy: {
            "WRONG_UFV_COEF": {
                description: "Error en cálculo de coeficiente UFV",
                auto_correction: "recalculate_cc",
                confidence_impact: -0.2
            },
            "INCORRECT_LIFE_YEARS": {
                description: "Vida útil incorrecta para tipo de activo",
                auto_correction: "adjust_depreciation_schedule",
                confidence_impact: -0.15
            },
            "MISCLASSIFIED_ACCOUNT": {
                description: "Clasificación monetaria/no monetaria incorrecta",
                auto_correction: "reclassify_account",
                confidence_impact: -0.25
            },
            "THRESHOLD_VIOLATION": {
                description: "Ajuste por debajo de umbral mínimo",
                auto_correction: "suppress_adjustment",
                confidence_impact: -0.1
            }
        }
    },

    // =============================================================================
    // MÉTRICAS DE DESEMPEÑO Y OPTIMIZACIÓN (Shorter CoT)
    // =============================================================================
    performance_metrics: {
        // Métricas de procesamiento
        processing_targets: {
            max_processing_time_ms: 5000,
            max_memory_usage_mb: 100,
            target_suppression_rate: 0.15,      // 15% de ajustes suprimidos por baja confianza
            target_confidence_average: 0.90
        },
        
        // Optimización de output
        output_optimization: {
            compress_audit_trail: true,
            max_audit_entries: 10,
            include_processing_stats: true,
            token_optimization: true
        },
        
        // Métricas de calidad
        quality_metrics: {
            precision_target: 0.95,
            recall_target: 0.90,
            f1_score_target: 0.92,
            regulatory_compliance_rate: 1.0
        }
    },

    // =============================================================================
    // METADATOS DE TRAZABILIDAD Y AUDITORÍA
    // =============================================================================
    metadata: {
        version: "3.0-ARS-DSPy",
        created_by: "ARS Context Engine",
        last_updated: new Date().toISOString(),
        compliance_framework: ["NC-3", "NC-6", "DS-24051", "IFRS-NIIF"],
        
        // Trazabilidad de decisiones
        decision_trail: {
            source_rules: true,
            calculation_trace: true,
            confidence_scoring: true,
            regulatory_references: true,
            learning_updates: true
        },
        
        // Validación de integridad
        integrity_checks: {
            schema_validation: true,
            rule_consistency: true,
            regulatory_alignment: true,
            performance_monitoring: true
        }
    }
};
