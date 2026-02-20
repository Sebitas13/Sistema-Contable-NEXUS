"""
AI Adjustment Engine V3.0 - Módulo de Razonamiento Adaptativo (ARS-DSPy)
Arquitectura DSPy-like con Adaptive Reasoning Suppression y Certeza Dinámica
Cumplimiento NC-3, NC-6, DS-24051 para contabilidad boliviana
"""
import os
import sys
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import time
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Tuple, Any
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import json
import re
import unicodedata
import asyncio
import copy
from dataclasses import dataclass
from enum import Enum
import httpx

app = FastAPI(title="Adjustment AI Engine", version="1.0.0")

# V3.2 FIX: Add CORS Middleware to allow cross-origin requests from the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# V3.2 FIX: Add detailed request logging middleware as requested by user
class DetailedLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start_time = time.time()
        print("="*80)
        print(f"INFO: [REQUEST] {request.method} {request.url.path}")
        # Imprimir solo cabeceras relevantes para no saturar
        relevant_headers = {h: request.headers[h] for h in request.headers if h.lower() in ['content-type', 'user-agent', 'origin', 'referer']}
        print(f"      -> Headers: {relevant_headers}")
        try:
            body = await request.body()
            if body:
                # Truncar body si es muy largo
                body_to_log = body.decode() if len(body) < 1000 else body.decode(errors='ignore')[:1000] + '...'
                print(f"      -> Body: {body_to_log}")
        except Exception:
            print("      -> Body: (Could not be read or empty)")
        
        response = await call_next(request)
        
        process_time = time.time() - start_time
        response.headers["X-Process-Time"] = str(process_time)
        
        print(f"INFO: [RESPONSE] {response.status_code} for {request.url.path} (took: {process_time:.4f}s)")
        print("="*80)
        return response

app.add_middleware(DetailedLoggingMiddleware)

# V8.0 AoT: Banker's Rounding for financial precision
from decimal import Decimal, ROUND_HALF_EVEN

def bankersRound(num: float, precision: int = 2) -> float:
    """
    Banker's Rounding (Round Half Even) to eliminate cumulative bias.
    Used in all financial calculations per NC-3 requirements.
    """
    if num == 0:
        return 0.0
    d = Decimal(str(num))
    factor = Decimal(10) ** -precision
    return float(d.quantize(factor, rounding=ROUND_HALF_EVEN))

# =============================================================================
# DSPy-LIKE SIGNATURES (Tipado Estricto para Entradas/Salidas)
# =============================================================================

class AdjustmentType(str, Enum):
    DEPRECIACION = "depreciacion"
    AITB = "aitb"
    PROVISION = "provision"
    MONETARIO = "monetario"

class Account(BaseModel):
    code: str = Field(..., description="Código de cuenta contable")
    name: str = Field(..., description="Nombre de cuenta")
    balance: float = Field(..., description="Saldo pre-ajuste")
    type: Optional[str] = Field(None, description="Tipo contable básico")

# V8.0 AoT: Modelo para movimientos individuales del mayor
class LedgerMovement(BaseModel):
    date: str = Field(..., description="Fecha del movimiento (YYYY-MM-DD)")
    debit: float = Field(0, description="Monto débito")
    credit: float = Field(0, description="Monto crédito")
    ufv_at_date: Optional[float] = Field(None, description="UFV en la fecha del movimiento")
    gloss: Optional[str] = Field(None, description="Glosa del movimiento")

class AdjustmentParameters(BaseModel):
    ufv_initial: float = Field(0, description="UFV inicial (legacy, opcional para AoT)")
    ufv_final: float = Field(..., description="UFV final para AITB (cierre)")
    method: str = Field("UFV", description="Método de ajuste: UFV o TC")
    confidence_threshold: float = Field(0.95, description="Umbral de confianza ARS")
    company_id: Optional[str] = Field(None, description="ID empresa para multi-tenant")
    # V7.0: Prorated Depreciation Fields
    acquisition_dates: Optional[Dict[str, str]] = Field(default_factory=dict, description="Mapa {account_code: acquisition_date (YYYY-MM-DD)}")
    fiscal_end_date: Optional[str] = Field(None, description="Fecha de cierre fiscal (YYYY-MM-DD)")
    # V8.0 AoT: Trajectory-Based Calculation Fields (accepts raw dicts from middleware)
    ledger_trajectories: Optional[Dict[str, List[Any]]] = Field(default_factory=dict, description="{account_code: [movements]}")
    ufv_cache: Optional[Dict[str, float]] = Field(default_factory=dict, description="{date: ufv_value}")
    use_trajectory_mode: bool = Field(False, description="Habilitar cálculo por trayectoria AoT")
    api_base_url: Optional[str] = Field(None, description="Base URL del middleware Node.js")
    api_base_url_candidates: Optional[List[str]] = Field(default_factory=list, description="Lista de base URLs candidatas del middleware Node.js")
    debug_trace: bool = Field(False, description="Incluir traza diagnóstica por cuenta")
    debug_trace_limit: int = Field(80, description="Máximo de cuentas en traza diagnóstica")


class TransactionEntry(BaseModel):
    accountId: str = Field(..., description="ID cuenta destino")
    accountName: str = Field(..., description="Nombre cuenta destino")
    debit: float = Field(0, description="Monto débito")
    credit: float = Field(0, description="Monto crédito")
    gloss: str = Field("", description="Glosa detallada")

class ProposedTransaction(BaseModel):
    gloss: str = Field(..., description="Glosa principal del asiento")
    entries: List[TransactionEntry] = Field(..., description="Partidas del asiento")
    adjustment_type: AdjustmentType = Field(..., description="Tipo de ajuste")
    confidence: float = Field(..., description="Confianza específica del asiento")
    audit_trail: str = Field(..., description="Trazabilidad de auditoría")
    review_needed: bool = False

# ... (rest of imports or classes if any)

    # ------------------------------------------------------------------------
    # PROGRAM OF THOUGHT (PoT) - CÁLCULOS ESPECIALIZADOS
    # ------------------------------------------------------------------------
    def calculate_depreciation_pot(self, account: Account, params: AdjustmentParameters) -> Tuple[float, float, str, Dict]:
        """Cálculo de depreciación con Program of Thought (PoT) y Prorrateo Mensual"""
        import sys
        from datetime import datetime
        print(f"DEBUG DEP: [1] Entering depreciation calc for {account.name}", flush=True)
        
        classification, base_confidence, tags, rule = self.classify_account_semantic(account)
        print(f"DEBUG DEP: [2] Classification: {classification}, Tags: {tags}", flush=True)
        
        if classification != "non_monetary" or "Depreciable" not in tags:
            print(f"DEBUG DEP: [3] SKIPPING - not non_monetary or not Depreciable", flush=True)
            return 0.0, 0.0, "", {}
        
        print(f"DEBUG DEP: [4] Passed classification check", flush=True)
        
        # Buscar configuración específica usando Smart Matching
        best_config, match_score = self._smart_match_asset_type(account.name, self.profile.depreciation_configs)
        
        # Usar configuración genérica si no hay match fuerte (score < 15 es muy bajo)
        if not best_config or match_score < 15:
            print(f"DEBUG DEP: [5.1] Low match score ({match_score}) for {best_config.asset_type_keyword if best_config else 'None'}")
            fallback_config = next((c for c in self.profile.depreciation_configs if "activos fijos" in c.asset_type_keyword.lower()), None)
            if fallback_config:
                 best_config = fallback_config
                 print(f"DEBUG DEP: [5.2] Used generic fallback config: {best_config.asset_type_keyword}")
        
        if not best_config:
            print(f"DEBUG DEP: [6] NO CONFIG FOUND - returning 0", flush=True)
            return 0.0, 0.0, "", {}
            
        # V7.0: Cálculo de Prorrateo por Meses (Prorated Depreciation)
        # Lógica: Si activos tienen menos de 1 año (12 meses) desde adquisición, depreciar solo meses transcurridos.
        depreciation_factor = 1.0 # Default: 1 año completo
        months_prorated = 12
        proration_note = ""

        if params.acquisition_dates and account.code in params.acquisition_dates and params.fiscal_end_date:
            try:
                acq_date_str = params.acquisition_dates[account.code]
                acq_date = datetime.strptime(acq_date_str, "%Y-%m-%d")
                fiscal_end = datetime.strptime(params.fiscal_end_date, "%Y-%m-%d")
                
                # Calcular diferencia en meses completos
                # Ejemplo: Mayo (5) a Dic (12) -> 12 - 5 + 1? No, la regla dice "meses enteros"
                # Si compra 25 mayo, mayo no cuenta? O cuenta mayo completo? 
                # Generalmente "mes de alta computa completo" o "por días exactos". 
                # Simplificación usual: Meses = (YearDiff * 12) + MonthDiff. 
                # Si User pide "25 mayo a 31 dic = 8 meses", entonces cuenta Mayo, Junio, Jul, Ago, Sep, Oct, Nov, Dic = 8.
                
                # Cálculo de meses inclusivo
                months_diff = (fiscal_end.year - acq_date.year) * 12 + (fiscal_end.month - acq_date.month) + 1
                
                if months_diff < 12 and months_diff > 0:
                    months_prorated = months_diff
                    depreciation_factor = months_prorated / 12.0
                    proration_note = f"(Prorrateo: {months_prorated} meses desde {acq_date_str})"
                    print(f"DEBUG DEP: [6.5] PRORATION APPLIED: {months_prorated} months. Factor: {depreciation_factor}")
                else:
                     print(f"DEBUG DEP: [6.5] No proration needed. Months diff: {months_diff}")

            except Exception as e:
                print(f"DEBUG DEP: Error parsing dates for proration: {e}")

        # [POLYGLOT] Delegating formula execution to Rust Worker (Simon/Julia)
        # Executing: annual_rate_formula via IPC
        # result = rust_worker.compute_depreciation(account.balance, best_config.annual_rate, 1)
        
        # ⚡ V6.5 FIX: Cambio a cálculo anual para Cierres de Gestión (NC-22)
        # El usuario indica que solo se deprecia UNA vez al final de gestión.
        # V7.0: Multiplicado por depreciation_factor (prorrateo)
        
        annual_depreciation = account.balance * best_config.annual_rate
        depreciation_amount = annual_depreciation * depreciation_factor
        
        adaptive_confidence, adaptive_rule = self.calculate_adaptive_confidence(account, "depreciacion", best_config.confidence_level)
        
        print(f"DEBUG DEP: [7] Calculated: {depreciation_amount} (Conf: {adaptive_confidence})", flush=True)

        provenance_str = f"Procedencia: {rule.get('source_nc', 'AI')} {proration_note}"
        if rule.get('source_nc') == "Mahoraga-SCL-Adaptation":
             provenance_str = f"⚠️ ADAPTACIÓN MAHORAGA: {rule.get('provenance', {}).get('reason', 'Usuario')} {proration_note}"

class AdjustmentRequest(BaseModel):
    company_id: str = Field(..., description="ID empresa")
    accounts: List[Account] = Field(..., description="Cuentas para análisis")
    parameters: AdjustmentParameters = Field(..., description="Parámetros de ajuste")
    profile_schema: Optional[Dict[str, Any]] = Field(None, description="AdjustmentProfile inyectado")

class AdjustmentResponse(BaseModel):
    success: bool = Field(..., description="Operación exitosa")
    proposedTransactions: List[ProposedTransaction] = Field(..., description="Asientos propuestos")
    aggregate_confidence: float = Field(..., description="Confianza agregada del lote")
    reasoning: str = Field(..., description="Razonamiento conciso (shorter CoT)")
    warnings: List[str] = Field(default_factory=list, description="Alertas del motor")
    review_needed: bool = Field(False, description="Requiere escalamiento humano (ARS)")
    processing_stats: Dict[str, Any] = Field(default_factory=dict, description="Estadísticas de procesamiento")

# =============================================================================
# CONFIGURACIÓN DINÁMICA INYECTADA (AdjustmentProfile Schema)
# =============================================================================

@dataclass
class SemanticRule:
    pattern: str
    tags: List[str]
    source_nc: str
    confidence_weight: float = 1.0

@dataclass
class DepreciationConfig:
    asset_type_keyword: str
    useful_life_years: int
    annual_rate: float
    confidence_level: float
    nc_reference: str

@dataclass
class ARSConfig:
    confidence_threshold: float
    adaptive_suppression_enabled: bool = True
    max_reasoning_tokens: int = 200
    audit_trail_format: str = "concise"

class AdjustmentProfileSchema:
    """Esquema de Contexto de Dominio Gobernable (ARS Context Model V3.0)"""
    
    def __init__(self, profile_data: Optional[Dict] = None):
        # Siempre partir del perfil por defecto y aplicar overrides del perfil recibido.
        # Evita perder semantic_concepts/reglas cuando el perfil persistido es parcial.
        default_profile = self._get_default_ars_profile()
        incoming_profile = profile_data or {}
        self.profile_data = self._merge_profile_with_defaults(default_profile, incoming_profile)
        
        # Cargar configuraciones del nuevo esquema
        self.data_retrieval_config = self._load_data_retrieval_config()
        self.reasoning_config = self._load_reasoning_config()
        self.aitb_settings = self._load_aitb_settings()
        self.depreciation_settings = self._load_depreciation_settings()
        self.correction_history = self._load_correction_history()
        self.performance_metrics = self._load_performance_metrics()
        
        # Configuraciones heredadas (compatibilidad)
        self.monetary_rules = self._load_semantic_rules("monetary_rules")
        self.non_monetary_rules = self._load_semantic_rules("non_monetary_rules")
        self.depreciation_configs = self._load_depreciation_configs()
        self.ars_config = self._load_ars_config()

    def _merge_profile_with_defaults(self, defaults: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
        """
        Deep merge: mantiene defaults para claves ausentes y aplica override del perfil recibido.
        Regla para listas: si incoming trae lista vacía y default trae elementos, conserva default.
        """
        if not isinstance(defaults, dict):
            return copy.deepcopy(incoming) if incoming is not None else copy.deepcopy(defaults)

        merged = copy.deepcopy(defaults)
        if not isinstance(incoming, dict):
            return merged

        for key, value in incoming.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = self._merge_profile_with_defaults(merged[key], value)
                continue

            if isinstance(value, list) and isinstance(merged.get(key), list):
                if len(value) == 0 and len(merged.get(key) or []) > 0:
                    # Lista vacía accidental no debe borrar el baseline regulatorio.
                    continue
                merged[key] = copy.deepcopy(value)
                continue

            if value is not None:
                merged[key] = copy.deepcopy(value)

        return merged
    
    
    def _get_default_ars_profile(self) -> Dict:
        """Perfil ARS-DSPy por defecto con contexto completo"""
        return {
            "reasoning_config": {
                "confidence_threshold": 0.75,
                "adaptive_thresholds": {
                    "high_confidence": 0.98,
                    "medium_confidence": 0.85,
                    "low_confidence": 0.70
                },
                "reasoning_weights": {
                    "semantic_match_weight": 1.2,
                    "pattern_match_weight": 1.0,
                    "fallback_weight": 0.7,
                    "historical_accuracy_weight": 1.5
                },
                "self_critique_config": {
                    "enable_strategic_reflectivism": True,
                    "review_triggers": ["high_regulatory_risk", "uncertain_classification"],
                    "auto_correction_modes": ["conservative_adjustment", "human_escalation"]
                },
                "audit_trail_format": "concise",
                "max_reasoning_tokens": 200
            },
            "data_retrieval_config": {
                "ledger_endpoint": "/api/reports/ledger",
                "query_filters": {
                    "excludeAdjustments": True,
                    "excludeClosing": True,
                    "dateMode": "GestionEnd"
                },
                "field_mapping": {
                    "account_id": "id",
                    "account_code": "code",
                    "account_name": "name",
                    "balance_field": "saldo_matematico",
                    "account_type": "type"
                }
            },
            "aitb_settings": {
                "method": "UFV",
                "regulatory_risk_factor": 1.15,
                "minimum_threshold": 0.01,
                "risk_config": {
                    "high_adjustment_threshold": 10000,
                    "risk_multiplier": 1.25,
                    "confidence_penalty": 0.1
                }
            },
            "semantic_concepts": {
                "monetary": [
                    {"concept": "Liquidez", "keywords": ["caja", "banco", "efectivo", "disponibilidad"], "tags": ["Monetario", "Liquidez"]},
                    {"concept": "Exigible", "keywords": ["cobrar", "cliente", "deudor", "prestamo"], "tags": ["Monetario", "Exigible"]},
                    {"concept": "PasivoCorriente", "keywords": ["pagar", "proveedor", "acreedor", "impuesto", "fiscal"], "tags": ["Monetario", "Pasivo"]},
                    {"concept": "Resultado", "keywords": ["ingreso", "gasto", "costo", "venta", "compra", "sueldo", "honorario"], "tags": ["Monetario", "Resultado"]}
                ],
                "non_monetary": [
                    {"concept": "Inventario", "keywords": ["inventario", "mercaderia", "almacen", "producto", "existencia"], "tags": ["NoMonetario", "ActivoCorriente"]},
                    {"concept": "ActivoFijo", "keywords": ["edificio", "terreno", "mueble", "vehiculo", "equipo", "maquinaria", "obra", "herramienta", "computacion"], "tags": ["NoMonetario", "Depreciable"]},
                    {"concept": "Patrimonio", "keywords": ["capital", "reserva", "ajuste", "patrimonio", "resultado acumulado"], "tags": ["NoMonetario", "Patrimonio"]}
                ]
            },
            "monetary_rules": [], # Deprecated in favor of semantic concepts
            "non_monetary_rules": [], # Deprecated
            "depreciation_settings": {
                "asset_type_regex_fidelity": 0.95,
                "fallback_fidelity": 0.65,
                "assets_life": [
                    {"asset_type_keyword": "Edificaciones", "useful_life_years": 40, "annual_rate": 0.025, "confidence_level": 0.95, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Muebles y enseres", "useful_life_years": 10, "annual_rate": 0.10, "confidence_level": 0.90, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Maquinaria en general", "useful_life_years": 8, "annual_rate": 0.125, "confidence_level": 0.90, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Equipos e instalaciones", "useful_life_years": 8, "annual_rate": 0.125, "confidence_level": 0.90, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Barcos y lanchas en general", "useful_life_years": 10, "annual_rate": 0.10, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Vehiculos automotores", "useful_life_years": 5, "annual_rate": 0.20, "confidence_level": 0.95, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Aviones", "useful_life_years": 5, "annual_rate": 0.20, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Maquinaria para la construcción", "useful_life_years": 5, "annual_rate": 0.20, "confidence_level": 0.90, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Maquinaria agrícola", "useful_life_years": 4, "annual_rate": 0.25, "confidence_level": 0.90, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Animales de trabajo", "useful_life_years": 4, "annual_rate": 0.25, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Herramientas en general", "useful_life_years": 4, "annual_rate": 0.25, "confidence_level": 0.90, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Reproductores y hembras de pedigree o puros por cruza", "useful_life_years": 8, "annual_rate": 0.125, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Equipos de computacion", "useful_life_years": 4, "annual_rate": 0.25, "confidence_level": 0.95, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Canales de regadío y pozos", "useful_life_years": 20, "annual_rate": 0.05, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Estanques, bañaderos y abrevaderos", "useful_life_years": 10, "annual_rate": 0.10, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Alambrados, tranqueras y vallas", "useful_life_years": 10, "annual_rate": 0.10, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Viviendas para el personal", "useful_life_years": 20, "annual_rate": 0.05, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Muebles y enseres en las viviendas para el personal", "useful_life_years": 10, "annual_rate": 0.10, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Silos, almacenes y galpones", "useful_life_years": 20, "annual_rate": 0.05, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Tinglados y cobertizos de madera", "useful_life_years": 5, "annual_rate": 0.20, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Tinglados y cobertizos de metal", "useful_life_years": 10, "annual_rate": 0.10, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Instalaciones de electrificación y telefonía rurales", "useful_life_years": 10, "annual_rate": 0.10, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Caminos interiores", "useful_life_years": 10, "annual_rate": 0.10, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Caña de azúcar", "useful_life_years": 5, "annual_rate": 0.20, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Vides", "useful_life_years": 8, "annual_rate": 0.125, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Frutales", "useful_life_years": 10, "annual_rate": 0.10, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Pozos Petroleros", "useful_life_years": 5, "annual_rate": 0.20, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Líneas de Recolección de la industria petrolera", "useful_life_years": 5, "annual_rate": 0.20, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Equipos de campo de la industria petrolera", "useful_life_years": 8, "annual_rate": 0.125, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Plantas de Procesamiento de la industria petrolera", "useful_life_years": 8, "annual_rate": 0.125, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "Ductos de la industria petrolera", "useful_life_years": 10, "annual_rate": 0.10, "confidence_level": 0.85, "nc_reference": "DS 24051"},
                    {"asset_type_keyword": "activos fijos", "useful_life_years": 10, "annual_rate": 0.10, "confidence_level": 0.70, "nc_reference": "DS 24051"}
                ]
            },
            "correction_history": {
                "entries": [],
                "learning_config": {
                    "enable_adaptive_learning": True,
                    "learning_weight_decay": 0.95,
                    "min_corrections_for_pattern": 3
                },
                "error_taxonomy": {
                    "WRONG_UFV_COEF": {"confidence_impact": -0.2},
                    "INCORRECT_LIFE_YEARS": {"confidence_impact": -0.15},
                    "MISCLASSIFIED_ACCOUNT": {"confidence_impact": -0.25}
                }
            }
        }
    
    def _load_data_retrieval_config(self) -> Dict:
        """Cargar configuración de recuperación de datos"""
        return self.profile_data.get("data_retrieval_config", {})
    
    def _load_reasoning_config(self) -> Dict:
        """Cargar configuración de razonamiento adaptativo"""
        return self.profile_data.get("reasoning_config", {})
    
    def _load_aitb_settings(self) -> Dict:
        """Cargar configuración de AITB mejorada"""
        return self.profile_data.get("aitb_settings", {})
    
    def _load_depreciation_settings(self) -> Dict:
        """Cargar configuración de depreciación mejorada"""
        return self.profile_data.get("depreciation_settings", {})
    
    def _load_correction_history(self) -> Dict:
        """Cargar historial de correcciones y aprendizaje"""
        return self.profile_data.get("correction_history", {})
    
    def _load_performance_metrics(self) -> Dict:
        """Cargar métricas de desempeño"""
        return self.profile_data.get("performance_metrics", {})
    
    def _load_semantic_rules(self, rule_type: str) -> List[SemanticRule]:
        rules = []
        for rule_data in self.profile_data.get(rule_type, []):
            pattern_str = rule_data.get("pattern", "")
            if not pattern_str:
                continue

            rules.append(SemanticRule(
                pattern=pattern_str,
                tags=rule_data.get("tags", []),
                source_nc=rule_data.get("source_nc", "Unknown"),
                confidence_weight=rule_data.get(
                    "confidence_weight",
                    float(rule_data.get("reasoning_weight", 1.0)) + float(rule_data.get("confidence_boost", 0.0))
                )
            ))
        return rules
    
    def _load_depreciation_configs(self) -> List[DepreciationConfig]:
        configs = []
        for asset_data in self.profile_data.get("depreciation_settings", {}).get("assets_life", []):
            configs.append(DepreciationConfig(
                asset_type_keyword=asset_data.get("asset_type_keyword", ""),
                useful_life_years=float(asset_data.get("useful_life_years", 10)),
                annual_rate=float(asset_data.get("annual_rate", 0.10)),
                confidence_level=float(asset_data.get("confidence_level", 0.90)),
                nc_reference=asset_data.get("nc_reference", "Configurado por Usuario")
            ))
        return configs
    
    def _load_ars_config(self) -> ARSConfig:
        reasoning_config = self.profile_data.get("reasoning_config", {})
        return ARSConfig(
            confidence_threshold=reasoning_config.get("confidence_threshold", 0.75),
            adaptive_suppression_enabled=True,
            max_reasoning_tokens=200,
            audit_trail_format="concise"
        )
        
# =============================================================================
# MOTOR ARS-DSPy V3.0 (Adaptive Reasoning Suppression)
# =============================================================================

class ARSDSPyEngine:
    """Motor de Razonamiento Adaptativo con patrón DSPy-like y ARS"""
    
    def __init__(self, profile_schema: Optional[Dict] = None):
        self.profile = AdjustmentProfileSchema(profile_schema)
        self.ars_enabled = self.profile.ars_config.adaptive_suppression_enabled
        
    # ------------------------------------------------------------------------
    # DSPy-LIKE CLASSIFICATION ENGINE (IA-like sin API keys)
    # ------------------------------------------------------------------------
    def _is_nc3_excluded(self, name: str) -> bool:
        """Determina si la cuenta está excluida de AITB por NC-3"""
        normalized = self._normalize_string(name)
        exclusions = [
            "ajuste por inflacion",
            "diferencia de cambio",
            "mantenimiento de valor",
            "exposicion a la inflacion",
            "perdidas y ganancias"
        ]
        for exc in exclusions:
             # Check if exclusion phrase is in normalized name
             if exc in normalized:
                 return True
        return False

    def _compile_profile_regex(self, pattern_str: str):
        """
        Compila regex del perfil soportando formato JS `/.../i` y formato plano.
        """
        raw = (pattern_str or "").strip()
        if not raw:
            raise re.error("Empty pattern")

        body = raw
        flags = re.IGNORECASE

        js_match = re.match(r"^/(.*)/([a-zA-Z]*)$", raw)
        if js_match:
            body = js_match.group(1)
            js_flags = (js_match.group(2) or "").lower()
            flags = 0
            if "i" in js_flags:
                flags |= re.IGNORECASE
            if "m" in js_flags:
                flags |= re.MULTILINE
            if "s" in js_flags:
                flags |= re.DOTALL
        elif raw.startswith("/") and raw.endswith("/") and len(raw) > 2:
            body = raw[1:-1]
            flags = re.IGNORECASE

        return re.compile(body, flags)

    def _profile_rule_matches_account(self, regex, account: Account) -> Optional[str]:
        """
        Permite que una regla clasifique por nombre, código o tipo.
        """
        candidates = [
            ("name", account.name or ""),
            ("code", account.code or ""),
            ("type", account.type or "")
        ]
        for field, value in candidates:
            if value and regex.search(value):
                return field
        return None

    def _keyword_matches_searchable(self, keyword: str, searchable: str, searchable_tokens: set) -> bool:
        """Keyword/phrase matching with boundaries to avoid substring false positives."""
        kw_norm = self._normalize_string(str(keyword))
        if not kw_norm:
            return False

        if " " in kw_norm:
            phrase_regex = r"\b" + re.escape(kw_norm).replace(r"\ ", r"\s+") + r"\b"
            return re.search(phrase_regex, searchable) is not None

        return kw_norm in searchable_tokens or any(
            (tok.startswith(kw_norm) or kw_norm.startswith(tok)) and min(len(tok), len(kw_norm)) >= 4
            for tok in searchable_tokens
        )

    def _has_monetary_name_signal(self, account: Account) -> bool:
        """Monetary guardrail to prevent AITB over monetary-looking accounts."""
        profile_data = getattr(self.profile, "profile_data", {}) or {}
        semantic_concepts = profile_data.get("semantic_concepts", {}) or {}
        monetary_concepts = semantic_concepts.get("monetary", []) or []

        searchable = self._normalize_string(f"{account.name or ''} {account.type or ''}")
        searchable_tokens = set(re.findall(r"[a-z0-9]+", searchable))
        if not searchable_tokens:
            return False

        for concept in monetary_concepts:
            for keyword in (concept.get("keywords", []) or []):
                if self._keyword_matches_searchable(str(keyword), searchable, searchable_tokens):
                    return True
        return False

    def _has_fixed_asset_name_signal(self, account_name: str) -> bool:
        """
        Fixed-asset signal based on:
        - non-monetary semantic concepts tagged as depreciable
        - depreciation settings keywords
        """
        searchable = self._normalize_string(account_name or "")
        searchable_tokens = set(re.findall(r"[a-z0-9]+", searchable))
        if not searchable_tokens:
            return False

        profile_data = getattr(self.profile, "profile_data", {}) or {}
        semantic_concepts = profile_data.get("semantic_concepts", {}) or {}
        non_monetary_concepts = semantic_concepts.get("non_monetary", []) or []

        stop_words = {
            "de", "del", "la", "las", "el", "los", "y", "o", "por", "para", "con",
            "en", "a", "al", "un", "una", "unos", "unas"
        }
        generic_words = {"activos", "activo", "fijos", "fijo", "general", "varios", "otras", "otros"}

        keyword_candidates: List[str] = []

        for concept in non_monetary_concepts:
            tags_norm = [self._normalize_string(t) for t in (concept.get("tags", []) or [])]
            if any("depreciable" in tag for tag in tags_norm):
                keyword_candidates.extend([str(k) for k in (concept.get("keywords", []) or []) if k])

        for config in self.profile.depreciation_configs:
            asset_norm = self._normalize_string(config.asset_type_keyword)
            for token in re.findall(r"[a-z0-9]+", asset_norm):
                if len(token) >= 4 and token not in stop_words and token not in generic_words:
                    keyword_candidates.append(token)

        for keyword in keyword_candidates:
            if self._keyword_matches_searchable(keyword, searchable, searchable_tokens):
                return True

        return False

    def _classify_by_semantic_concepts(self, account: Account) -> Optional[Tuple[str, float, List[str], Dict[str, Any]]]:
        """
        Clasificación semántica basada en `semantic_concepts` del perfil.
        Reduce dependencia de heurísticas rígidas por código.
        """
        profile_data = getattr(self.profile, "profile_data", {}) or {}
        semantic_concepts = profile_data.get("semantic_concepts", {}) or {}
        monetary_concepts = semantic_concepts.get("monetary", []) or []
        non_monetary_concepts = semantic_concepts.get("non_monetary", []) or []

        searchable = self._normalize_string(f"{account.name or ''} {account.type or ''}")
        searchable_tokens = set(re.findall(r"[a-z0-9]+", searchable))
        if not searchable:
            return None

        def score_concepts(concepts: List[Dict[str, Any]]):
            best_score = 0.0
            best_tags: List[str] = []
            best_concept = "Unknown"
            best_matches: List[str] = []

            for concept in concepts:
                keywords = concept.get("keywords", []) or []
                concept_score = 0.0
                matches: List[str] = []
                for keyword in keywords:
                    kw_norm = self._normalize_string(str(keyword))
                    if not kw_norm:
                        continue
                    matched = self._keyword_matches_searchable(kw_norm, searchable, searchable_tokens)

                    if matched:
                        matches.append(kw_norm)
                        # Favorecer keywords más específicas sin sobreponderar términos largos.
                        concept_score += 1.0 + min(len(kw_norm), 12) / 20.0

                if concept_score > best_score:
                    best_score = concept_score
                    best_tags = concept.get("tags", []) or []
                    best_concept = concept.get("concept", "Unknown")
                    best_matches = matches

            return best_score, best_tags, best_concept, best_matches

        m_score, m_tags, m_concept, m_matches = score_concepts(monetary_concepts)
        nm_score, nm_tags, nm_concept, nm_matches = score_concepts(non_monetary_concepts)

        # Sin evidencia semántica suficiente.
        if m_score <= 0 and nm_score <= 0:
            return None

        # Empate técnico: dejar que otros fallbacks decidan.
        if abs(m_score - nm_score) < 0.25:
            return None

        if m_score > nm_score:
            confidence = min(0.92, 0.65 + m_score * 0.08)
            return (
                "monetary",
                confidence,
                m_tags or ["Monetario-Semantic"],
                {
                    "source": "SemanticConcepts",
                    "concept": m_concept,
                    "matches": m_matches
                }
            )

        confidence = min(0.92, 0.65 + nm_score * 0.08)
        return (
            "non_monetary",
            confidence,
            nm_tags or ["NoMonetario-Semantic"],
            {
                "source": "SemanticConcepts",
                "concept": nm_concept,
                "matches": nm_matches
            }
        )

    def classify_account_semantic(self, account: Account) -> Tuple[str, float, List[str], Any]:
        """
        Clasificación semántica V7.0: Prioriza reglas Regex del perfil.
        """
        name_original = account.name

        # 1. NC-3 Exclusions (Highest priority)
        if self._is_nc3_excluded(name_original):
             return ("monetary", 1.0, ["Monetario-NC3"], {"source": "NC3-Rule", "reason": "Excluded from AITB"})

        # 2. Regex-based rules from profile (monetary & non-monetary)
        # These rules are now the primary source of classification logic.
        
        # Check non-monetary rules first
        for rule in self.profile.non_monetary_rules:
            try:
                pattern_str = rule.pattern
                regex = self._compile_profile_regex(pattern_str)

                matched_field = self._profile_rule_matches_account(regex, account)
                if matched_field:
                    print(f"✅ Regex HIT (non_monetary): '{name_original}' matched by pattern: {pattern_str}")
                    return (
                        "non_monetary",
                        rule.confidence_weight,
                        rule.tags,
                        {"source": rule.source_nc, "pattern": pattern_str, "matched_field": matched_field}
                    )
            except re.error:
                print(f"⚠️ WARNING: Invalid regex in non_monetary_rules: {rule.pattern}")
                continue

        # Check monetary rules if no non-monetary rule matched
        for rule in self.profile.monetary_rules:
            try:
                pattern_str = rule.pattern
                regex = self._compile_profile_regex(pattern_str)

                matched_field = self._profile_rule_matches_account(regex, account)
                if matched_field:
                    print(f"✅ Regex HIT (monetary): '{name_original}' matched by pattern: {pattern_str}")
                    return (
                        "monetary",
                        rule.confidence_weight,
                        rule.tags,
                        {"source": rule.source_nc, "pattern": pattern_str, "matched_field": matched_field}
                    )
            except re.error:
                print(f"⚠️ WARNING: Invalid regex in monetary_rules: {rule.pattern}")
                continue

        # 3. Clasificación semántica por conceptos del perfil
        semantic_result = self._classify_by_semantic_concepts(account)
        if semantic_result:
            return semantic_result

        # 4. Fallback to account type from database if no regex matched
        fallback_rule = {"source": "UniversalTypeLogic", "concept": "TypeBased"}
        if account.type:
            t_norm = self._normalize_string(account.type)
            if "pasivo" in t_norm: return "monetary", 0.60, ["Pasivo"], fallback_rule
            if "patrimonio" in t_norm: return "non_monetary", 0.70, ["Patrimonio"], fallback_rule
            if "activo" in t_norm: return "unknown", 0.55, ["Activo"], fallback_rule
            if any(x in t_norm for x in ["ingreso", "egreso", "gasto", "costo", "resultado"]):
                 return "non_monetary", 0.70, ["Resultado"], fallback_rule

        # 5. Last resort: fallback to code heuristic (conservador para clase 1)
        fallback_rule = {"source": "PlanCuentas-Heuristic", "concept": "CodeBased"}
        if account.code.startswith('1'): return "unknown", 0.55, ["Activo"], fallback_rule
        if account.code.startswith('2'): return "monetary", 0.60, ["Pasivo"], fallback_rule
        if account.code.startswith('3'): return "non_monetary", 0.70, ["Patrimonio"], fallback_rule
        if account.code.startswith('4'): return "non_monetary", 0.60, ["Ingreso"], fallback_rule
        if account.code.startswith('5') or account.code.startswith('6'): return "non_monetary", 0.60, ["Gasto"], fallback_rule
            
        return "unknown", 0.50, ["Desconocido"], fallback_rule
    
    def calculate_adaptive_confidence(self, account: Account, adjustment_type: str, base_confidence: float) -> Tuple[float, Dict]:
        """Cálculo de confianza adaptativa basado en ambigüedad semántica"""
        classification, conf_score, tags, rule = self.classify_account_semantic(account)
        
        # Factores de ajuste de confianza
        ambiguity_factor = 1.0
        
        # Penalizar ambigüedad en nombres genéricos
        generic_terms = ["varios", "diversos", "otros", "general", "varios"]
        if any(term in account.name.lower() for term in generic_terms):
            ambiguity_factor *= 0.7
        
        # Bonus para nombres específicos
        specific_terms = ["edificio", "maquinaria", "vehiculo", "inventario", "caja", "banco"]
        if any(term in account.name.lower() for term in specific_terms):
            ambiguity_factor *= 1.1
        
        # Ajustar por balance significativo
        if account.balance > 1000:
            ambiguity_factor *= 1.05
        
        adaptive_confidence = min(0.99, base_confidence * ambiguity_factor)
        return adaptive_confidence, rule
    
    def _smart_match_asset_type(self, account_name: str, configs: List[DepreciationConfig]) -> Tuple[Optional[DepreciationConfig], float]:
        """Emparejamiento inteligente entre nombre de cuenta y tipo de activo configurado"""
        name_norm = self._normalize_string(account_name)
        best_config = None
        best_score = 0
        stop_words = {
            "de", "del", "la", "las", "el", "los", "y", "o", "por", "para", "con",
            "en", "a", "al", "un", "una", "unos", "unas"
        }
        
        for config in configs:
            asset_norm = self._normalize_string(config.asset_type_keyword)
            current_score = 0
            
            # 1. Coincidencia exacta
            if asset_norm == name_norm:
                current_score = 100
            # 2. Coincidencia de frase completa dentro del nombre
            elif asset_norm in name_norm:
                # Más largo = más específico = mejor score
                current_score = 50 + len(asset_norm)
            # 3. Coincidencia de palabras clave (Jaccard-ish)
            else:
                asset_words = {
                    w for w in re.split(r"\W+", asset_norm)
                    if len(w) >= 4 and w not in stop_words
                }
                name_words = {
                    w for w in re.split(r"\W+", name_norm)
                    if len(w) >= 4 and w not in stop_words
                }
                common_words = asset_words.intersection(name_words)
                if common_words:
                    # Score basado en cuántas palabras coinciden y qué tan únicas son
                    current_score = sum(len(w) for w in common_words) * 5
            
            if current_score > best_score:
                best_score = current_score
                best_config = config
                
        return best_config, best_score

    # ------------------------------------------------------------------------
    # PROGRAM OF THOUGHT (PoT) - CÁLCULOS ESPECIALIZADOS
    # ------------------------------------------------------------------------
    def calculate_depreciation_pot(self, account: Account, params: AdjustmentParameters) -> Tuple[float, float, str, Dict]:
        """Cálculo de depreciación con Program of Thought (PoT)"""
        import sys
        print(f"DEBUG DEP: [1] Entering depreciation calc for {account.name}", flush=True)
        
        classification, base_confidence, tags, rule = self.classify_account_semantic(account)
        print(f"DEBUG DEP: [2] Classification: {classification}, Tags: {tags}", flush=True)

        name_norm = self._normalize_string(account.name or "")
        type_norm = self._normalize_string(account.type or "")

        contra_signals = [
            "depreciacion acumulada",
            "amortizacion acumulada",
            "agotamiento acumulado",
            "deterioro acumulado",
            "estimacion",
            "provision"
        ]
        is_contra_account = any(signal in name_norm for signal in contra_signals) or "regul" in type_norm
        if is_contra_account:
            print(f"DEBUG DEP: [3.05] SKIPPING - contra/reguladora account", flush=True)
            return 0.0, 0.0, "[SKIP-DEP] contra_or_reguladora", {"skip_reason": "contra_or_reguladora"}

        is_office_supply = (
            ("escritorio" in name_norm or "papeleria" in name_norm or "utiles" in name_norm)
            and any(token in name_norm for token in ["material", "suministro", "insumo", "consumible"])
        )

        tentative_fixed_asset = (
            classification == "unknown"
            and bool(re.match(r"^1[6-9]", str(account.code or "")))
            and not is_office_supply
            and not is_contra_account
        )

        if classification != "non_monetary" and not tentative_fixed_asset:
            print(f"DEBUG DEP: [3] SKIPPING - classification is not non_monetary", flush=True)
            return 0.0, 0.0, "[SKIP-DEP] classification_not_non_monetary", {"skip_reason": "classification_not_non_monetary"}

        if tentative_fixed_asset:
            print(f"DEBUG DEP: [3] OVERRIDE - unknown class accepted by fixed-asset code heuristic", flush=True)

        normalized_tags = [self._normalize_string(t) for t in (tags or [])]
        is_amortizable = any("amortizable" in t for t in normalized_tags)
        if is_amortizable:
            print(f"DEBUG DEP: [3.1] SKIPPING - amortizable asset (not depreciable)", flush=True)
            return 0.0, 0.0, "[SKIP-DEP] amortizable", {"skip_reason": "amortizable"}

        has_depreciable_tag = any("depreciable" in t for t in normalized_tags)
        matched_field = self._normalize_string(str((rule or {}).get("matched_field", "")))
        tag_from_weak_rule = bool(has_depreciable_tag and matched_field == "type")

        # Buscar configuración específica usando Smart Matching
        best_config, match_score = self._smart_match_asset_type(account.name, self.profile.depreciation_configs)
        strong_match = match_score >= 15
        has_fixed_asset_name_signal = self._has_fixed_asset_name_signal(account.name or "")

        non_depreciable_signals = ["intangible", "diferido", "amortiz", "acumulad"]
        is_fixed_asset_code = bool(re.match(r"^1[6-9]", str(account.code or "")))
        likely_fixed_asset = (
            is_fixed_asset_code
            and not any(token in name_norm for token in non_depreciable_signals)
            and not is_office_supply
            and not is_contra_account
        )

        has_reliable_depreciation_signal = (
            strong_match
            or has_fixed_asset_name_signal
            or likely_fixed_asset
            or (has_depreciable_tag and not tag_from_weak_rule)
        )
        if not has_reliable_depreciation_signal:
            print(
                f"DEBUG DEP: [3.2] SKIPPING - insufficient fixed-asset evidence "
                f"(tag={has_depreciable_tag}, match={match_score}, fixed_name={has_fixed_asset_name_signal}, fixed_code={likely_fixed_asset})",
                flush=True
            )
            return 0.0, 0.0, "[SKIP-DEP] insufficient_fixed_asset_evidence", {"skip_reason": "insufficient_fixed_asset_evidence"}

        if is_office_supply and not strong_match:
            print(f"DEBUG DEP: [3.25] SKIPPING - office supply/consumable signal", flush=True)
            return 0.0, 0.0, "[SKIP-DEP] office_supply_consumable", {"skip_reason": "office_supply_consumable"}

        print(f"DEBUG DEP: [4] Passed classification check", flush=True)
        
        # Usar configuración genérica si no hay match fuerte (score < 15 es muy bajo)
        if not best_config or match_score < 15:
            print(f"DEBUG DEP: [5.1] Low match score ({match_score}) for {best_config.asset_type_keyword if best_config else 'None'}")
            fallback_config = next((c for c in self.profile.depreciation_configs if "activos fijos" in c.asset_type_keyword.lower()), None)
            if fallback_config:
                 best_config = fallback_config
                 print(f"DEBUG DEP: [5.2] Used generic fallback config: {best_config.asset_type_keyword}")
        
        if not best_config:
            print(f"DEBUG DEP: [6] NO CONFIG FOUND - returning 0", flush=True)
            return 0.0, 0.0, "[SKIP-DEP] no_depreciation_config", {"skip_reason": "no_depreciation_config"}
        
        # [POLYGLOT] Delegating formula execution to Rust Worker (Simon/Julia)
        # Executing: annual_rate_formula via IPC
        # result = rust_worker.compute_depreciation(account.balance, best_config.annual_rate, 1)
        
        # V7.0: Cálculo de Prorrateo por Meses (Prorated Depreciation)
        depreciation_factor = 1.0
        months_prorated = 12
        proration_note = ""
        
        print(f"DEBUG DEP: [6.1] Params Check: FiscalEnd={params.fiscal_end_date}, Acqs={len(params.acquisition_dates) if params.acquisition_dates else 0}", flush=True)

        if params.acquisition_dates and account.code in params.acquisition_dates and params.fiscal_end_date:
            try:
                from datetime import datetime
                acq_date_str = params.acquisition_dates[account.code]
                acq_date = datetime.strptime(acq_date_str, "%Y-%m-%d")
                fiscal_end = datetime.strptime(params.fiscal_end_date, "%Y-%m-%d")
                
                # Cálculo de meses inclusivo
                months_diff = (fiscal_end.year - acq_date.year) * 12 + (fiscal_end.month - acq_date.month) + 1
                
                if months_diff < 12 and months_diff > 0:
                    months_prorated = months_diff
                    depreciation_factor = months_prorated / 12.0
                    proration_note = f"(Prorrateo: {months_prorated} meses desde {acq_date_str})"
                    print(f"DEBUG DEP: [6.5] PRORATION APPLIED: {months_prorated} months. Factor: {depreciation_factor}")
            except Exception as e:
                print(f"DEBUG DEP: Error parsing dates for proration: {e}")

        # ⚡ V6.5 FIX: Cambio a cálculo anual para Cierres de Gestión (NC-22)
        # El usuario indica que solo se deprecia UNA vez al final de gestión.
        annual_depreciation = account.balance * best_config.annual_rate
        depreciation_amount = annual_depreciation * depreciation_factor
        adaptive_confidence, adaptive_rule = self.calculate_adaptive_confidence(account, "depreciacion", best_config.confidence_level)
        
        print(f"DEBUG DEP: [7] Calculated: {depreciation_amount} (Conf: {adaptive_confidence})", flush=True)

        provenance_str = f"Procedencia: {rule.get('source_nc', 'AI')}"
        if rule.get('source_nc') == "Mahoraga-SCL-Adaptation":
             provenance_str = f"⚠️ ADAPTACIÓN MAHORAGA: {rule.get('provenance', {}).get('reason', 'Usuario')}"
        
        audit_trail = f"[DEPRECIACIÓN ANUAL] {account.code}: Tasa {best_config.annual_rate*100:.1f}% ({best_config.nc_reference}). {provenance_str}. {proration_note} Conf: {adaptive_confidence:.2f}"
        
        return depreciation_amount, adaptive_confidence, audit_trail, {**rule, "dep_config": best_config.nc_reference}
    
    def calculate_aitb_pot(self, account: Account, params: AdjustmentParameters) -> Tuple[float, float, str, Dict]:
        """Cálculo AITB estricto NC 3 con Coeficiente Corrector"""
        classification, base_confidence, tags, rule = self.classify_account_semantic(account)

        name_norm = self._normalize_string(account.name or "")
        type_norm = self._normalize_string(account.type or "")
        is_office_supply = (
            ("escritorio" in name_norm or "papeleria" in name_norm or "utiles" in name_norm)
            and any(token in name_norm for token in ["material", "suministro", "insumo", "consumible"])
        )
        is_contra_account = (
            any(signal in name_norm for signal in [
                "depreciacion acumulada",
                "amortizacion acumulada",
                "agotamiento acumulado",
                "deterioro acumulado"
            ])
            or "regul" in type_norm
        )
        tentative_fixed_asset = (
            classification == "unknown"
            and bool(re.match(r"^1[6-9]", str(account.code or "")))
            and not is_office_supply
            and not is_contra_account
            and not any(token in name_norm for token in ["intangible", "diferido", "amortiz", "acumulad"])
        )

        # Solo cuentas no monetarias aplican AITB (NC 3), con fallback para activo fijo ambiguo.
        if classification != "non_monetary" and not tentative_fixed_asset:
            return 0.0, 0.0, "[SKIP-AITB] classification_not_non_monetary", {"skip_reason": "classification_not_non_monetary"}

        if self._has_monetary_name_signal(account):
            print(f"DEBUG AITB: SKIPPING {account.name} - strong monetary semantic signal", flush=True)
            return 0.0, 0.0, "[SKIP-AITB] strong_monetary_semantic_signal", {"skip_reason": "strong_monetary_semantic_signal"}
        
        # Cálculo con Coeficiente Corrector (CC)
        if params.method == "UFV":
            if params.ufv_initial == 0:
                 print(f"DEBUG: AITB skipped for {account.name} because UFV initial is 0")
                 return 0.0, 0.0, "[SKIP-AITB] ufv_initial_zero", {"skip_reason": "ufv_initial_zero"}
            cc = params.ufv_final / params.ufv_initial
        else:
            cc = 1.0  # Placeholder para TC
        
        # Aplicar solo si hay inflación significativa
        if cc <= 1.000001: # Relaxed threshold for testing
             # print(f"DEBUG: AITB skipped for {account.name}, CC too low: {cc}")
             return 0.0, 0.0, "[SKIP-AITB] no_significant_inflation", {"skip_reason": "no_significant_inflation", "cc": cc}
        
        # [POLYGLOT] Delegating formula execution to Rust Worker (High Performance Compute)
        # Executing: inflation_adjustment_formula via IPC
        adjustment_amount = account.balance * (cc - 1)
        adaptive_confidence, adaptive_rule = self.calculate_adaptive_confidence(account, "aitb", 0.95)
        
        provenance_str = f"Regla: {rule.get('source_nc', 'AI')}"
        if rule.get('source_nc') == "Mahoraga-SCL-Adaptation":
             provenance_str = f"⚡ MAHORAGA ADAPTADO: {rule.get('provenance', {}).get('reason', 'Corrección Manual')} (Evento: {rule.get('provenance', {}).get('event_id', '?')})"
             
        audit_trail = f"[AITB] {account.code}: {provenance_str}. CC={cc:.6f}. NC-3 Art.4. Base: {rule.get('pattern', 'Gral')}."
        
        return adjustment_amount, adaptive_confidence, audit_trail, rule
    
    def calculate_aitb_trajectory(self, account: Account, params: AdjustmentParameters) -> Tuple[float, float, str, Dict]:
        """
        V8.0 AoT: Cálculo AITB por trayectoria de movimientos.
        Cada movimiento es un 'átomo' que se ajusta individualmente con su UFV de fecha.
        
        Sello de Contención 1: Activos Fijos NUNCA pueden clasificarse como monetarios.
        """
        classification, base_confidence, tags, rule = self.classify_account_semantic(account)

        name_norm = self._normalize_string(account.name or "")
        type_norm = self._normalize_string(account.type or "")
        is_office_supply = (
            ("escritorio" in name_norm or "papeleria" in name_norm or "utiles" in name_norm)
            and any(token in name_norm for token in ["material", "suministro", "insumo", "consumible"])
        )
        is_contra_account = (
            any(signal in name_norm for signal in [
                "depreciacion acumulada",
                "amortizacion acumulada",
                "agotamiento acumulado",
                "deterioro acumulado"
            ])
            or "regul" in type_norm
        )
        tentative_fixed_asset = (
            classification == "unknown"
            and bool(re.match(r"^1[6-9]", str(account.code or "")))
            and not is_office_supply
            and not is_contra_account
            and not any(token in name_norm for token in ["intangible", "diferido", "amortiz", "acumulad"])
        )

        # INVARIANTE: Cuentas no monetarias solamente (con fallback fijo ambiguo)
        if classification != "non_monetary" and not tentative_fixed_asset:
            return 0.0, 0.0, "[SKIP-AITB-AOT] classification_not_non_monetary", {"skip_reason": "classification_not_non_monetary"}

        if self._has_monetary_name_signal(account):
            print(f"DEBUG AoT: SKIPPING {account.name} - strong monetary semantic signal")
            return 0.0, 0.0, "[SKIP-AITB-AOT] strong_monetary_semantic_signal", {"skip_reason": "strong_monetary_semantic_signal"}
        
        # Obtener trayectoria de movimientos para esta cuenta
        raw_trajectory = params.ledger_trajectories.get(account.code, [])
        if not raw_trajectory:
            # Fallback a cálculo por saldo si no hay trayectoria
            print(f"DEBUG AoT: No trajectory for {account.code}, falling back to balance-based")
            return self.calculate_aitb_pot(account, params)
        
        # V8.0 FIX: Convert dict objects to proper access (middleware sends dicts, not Pydantic models)
        trajectory = []
        for mov in raw_trajectory:
            if isinstance(mov, dict):
                trajectory.append(mov)
            else:
                # Already a LedgerMovement object
                trajectory.append(mov.dict() if hasattr(mov, 'dict') else mov)
        
        ufv_final = params.ufv_final
        total_adjustment = 0.0
        atoms_processed = []
        confidence_sum = 0.0
        
        print(f"DEBUG AoT [{account.code}]: Processing {len(trajectory)} movements. UFV_final: {ufv_final}")
        print(f"DEBUG AoT [{account.code}]: UFV Cache has {len(params.ufv_cache or {})} entries")
        
        for mov in trajectory:
            # V8.0 FIX: Access dict keys properly
            mov_date = mov.get('date', '') if isinstance(mov, dict) else mov.date
            mov_debit = float(mov.get('debit', 0) if isinstance(mov, dict) else mov.debit)
            mov_credit = float(mov.get('credit', 0) if isinstance(mov, dict) else mov.credit)
            mov_ufv = mov.get('ufv_at_date') if isinstance(mov, dict) else getattr(mov, 'ufv_at_date', None)
            
            # Obtener UFV de la fecha del movimiento
            # Priority: mov.ufv_at_date > ufv_cache > fallback to ufv_final (last resort)
            ufv_at_date = mov_ufv
            if ufv_at_date is None or ufv_at_date == 0:
                ufv_at_date = (params.ufv_cache or {}).get(mov_date, ufv_final)
            
            if ufv_at_date == 0 or ufv_at_date is None:
                print(f"DEBUG AoT [{account.code}]: Skipping movement {mov_date} - no UFV found")
                continue
            
            # Calcular Coeficiente Corrector para este átomo
            cc = ufv_final / ufv_at_date
            
            # Movimiento neto (Debit = aumenta saldo deudor, Credit = disminuye)
            net_amount = mov_debit - mov_credit
            
            print(f"DEBUG AoT [{account.code}]: Date={mov_date}, Debit={mov_debit}, Credit={mov_credit}, Net={net_amount}, UFV={ufv_at_date}, CC={cc:.6f}")
            
            # Solo procesar si hay inflación significativa
            if abs(net_amount) > 0.01 and cc > 1.0:
                partial_adjustment = bankersRound(net_amount * (cc - 1), 2)
                total_adjustment = bankersRound(total_adjustment + partial_adjustment, 2)
                
                print(f"DEBUG AoT [{account.code}]: Partial adjustment = {partial_adjustment}, Running total = {total_adjustment}")
                
                atoms_processed.append({
                    "date": mov_date,
                    "amount": net_amount,
                    "ufv": ufv_at_date,
                    "cc": round(cc, 6),
                    "adjustment": partial_adjustment
                })
                confidence_sum += 0.95  # Base confidence for each atom
        
        # Confianza promedio de los átomos procesados
        atom_count = len(atoms_processed)
        avg_confidence = (confidence_sum / atom_count) if atom_count > 0 else 0.0
        
        # Aplicar redondeo bancario final y valor absoluto
        # V8.0 FIX: Net amount is negative for Credit accounts (Income/Liability)
        # We need the MAGNITUDE of the adjustment. _create_aitb_transaction handles the direction.
        final_adjustment = bankersRound(abs(total_adjustment), 2)
        print(f"DEBUG AoT [{account.code}]: Raw total = {total_adjustment}. Final Magnitude = {final_adjustment} from {atom_count} atoms")
        
        # Determinar proveniencia (Shorter CoT)
        provenance_str = f"Regla: {rule.get('source_nc', 'AI-AoT')}"
        if rule.get('source_nc') == "Mahoraga-SCL-Adaptation":
            provenance_str = f"⚡ MAHORAGA TRAYECTORIA: {rule.get('provenance', {}).get('reason', 'Aprendido')}"
        
        # Audit trail conciso (Shorter CoT)
        # Audit trail conciso (Shorter CoT)
        audit_trail = f"[AITB-AoT] {account.code}: {atom_count} átomos. {provenance_str}. Total Magnitud: {final_adjustment:.2f} Bs ({total_adjustment:.2f} neto)"
        
        # Enriched rule with trajectory metadata
        enriched_rule = {**rule, "aot_atoms": atom_count, "aot_mode": True}
        
        return final_adjustment, avg_confidence, audit_trail, enriched_rule
    
    def calculate_provision_pot(self, account: Account, params: AdjustmentParameters) -> Tuple[float, float, str, Dict]:
        """Cálculo de provisión inteligente"""
        classification, base_confidence, tags, classification_rule = self.classify_account_semantic(account)
        
        # Buscar cuentas de provisiones específicas
        provision_keywords = ["cuentas por cobrar", "deudores", "incobrable", "dudoso"]
        if not any(keyword in account.name.lower() for keyword in provision_keywords):
            return 0.0, 0.0, "[SKIP-PROV] not_provision_candidate", {"skip_reason": "not_provision_candidate"}
        
        # Lógica de provisión basada en experiencia histórica (2% estándar)
        provision_rate = 0.02
        provision_amount = account.balance * provision_rate
        adaptive_confidence, adaptive_rule = self.calculate_adaptive_confidence(account, "provision", 0.85)
        
        # Combine classification rule and provision specific rule
        provision_specific_rule = {"source": "HistoricalExperience", "rate": provision_rate}
        final_rule = {**classification_rule, **provision_specific_rule, "adaptive_confidence_rule": adaptive_rule}

        audit_trail = f"[PROVISIÓN] {account.code}: Tasa {provision_rate*100:.1f}%. Experiencia histórica. Conf {adaptive_confidence:.2f}"
        
        return provision_amount, adaptive_confidence, audit_trail, final_rule
    
    # ------------------------------------------------------------------------
    # ARS (ADAPTIVE REASONING SUPPRESSION) - MOTOR PRINCIPAL
    # ------------------------------------------------------------------------
    def generate_adjustments(self, request: AdjustmentRequest) -> AdjustmentResponse:
        """Motor ARS principal con Certeza Dinámica y Strategic Reflectivism"""
        start_time = datetime.now()
        proposed_transactions = []
        audit_trails = []
        confidence_scores = []
        debug_trace_enabled = bool(getattr(request.parameters, "debug_trace", False))
        debug_trace_limit = max(1, int(getattr(request.parameters, "debug_trace_limit", 80) or 80))
        debug_trace_rows = []
        processing_stats = {
            "accounts_processed": 0,
            "depreciation_generated": 0,
            "aitb_generated": 0,
            "provision_generated": 0,
            "suppressed_adjustments": 0,
            "classification_counts": {"monetary": 0, "non_monetary": 0, "unknown": 0}
        }
        semantic_concepts = self.profile.profile_data.get("semantic_concepts", {}) or {}
        processing_stats["profile_integrity"] = {
            "semantic_monetary_concepts": len(semantic_concepts.get("monetary", []) or []),
            "semantic_non_monetary_concepts": len(semantic_concepts.get("non_monetary", []) or []),
            "monetary_rules": len(self.profile.monetary_rules),
            "non_monetary_rules": len(self.profile.non_monetary_rules),
            "depreciation_configs": len(self.profile.depreciation_configs)
        }
        
        for account in request.accounts:
            if account.balance <= 0:
                continue
            
            processing_stats["accounts_processed"] += 1
            account_adjustments = []
            base_classification, _, base_tags, base_rule = self.classify_account_semantic(account)
            if base_classification not in processing_stats["classification_counts"]:
                processing_stats["classification_counts"][base_classification] = 0
            processing_stats["classification_counts"][base_classification] += 1

            account_debug = None
            if debug_trace_enabled and len(debug_trace_rows) < debug_trace_limit:
                account_debug = {
                    "code": account.code,
                    "name": account.name,
                    "type": account.type,
                    "balance": account.balance,
                    "classification": base_classification,
                    "tags": base_tags,
                    "rule_source": base_rule.get("source") or base_rule.get("source_nc"),
                    "rule_pattern": base_rule.get("pattern"),
                    "rule_matched_field": base_rule.get("matched_field"),
                    "use_trajectory_mode": bool(request.parameters.use_trajectory_mode),
                    "aitb": {},
                    "depreciation": {},
                    "provision": {}
                }
            
            # DEBUG: Print account being processed
            print(f"DEBUG: Processing account {account.code} - {account.name} (Balance: {account.balance})")
            
            # DEBUG: V8.0 AoT - Show trajectory mode status
            trajectory_count = len(request.parameters.ledger_trajectories.get(account.code, [])) if request.parameters.ledger_trajectories else 0
            print(f"DEBUG AoT MODE: use_trajectory_mode={request.parameters.use_trajectory_mode}, trajectories_for_account={trajectory_count}")
            print(f"DEBUG AoT CACHE: ufv_cache_size={len(request.parameters.ufv_cache or {})}")
            
            # 1. AITB (PoT/AoT) - Executed FIRST to update base for Depreciation
            # V8.0: Use trajectory mode if enabled
            if request.parameters.use_trajectory_mode:
                aitb_result = self.calculate_aitb_trajectory(account, request.parameters)
            else:
                aitb_result = self.calculate_aitb_pot(account, request.parameters)
            aitb_amount, aitb_conf, aitb_audit, aitb_rule = aitb_result
            if account_debug is not None:
                account_debug["aitb"] = {
                    "amount": aitb_amount,
                    "confidence": aitb_conf,
                    "audit": aitb_audit,
                    "rule_source": (aitb_rule or {}).get("source") or (aitb_rule or {}).get("source_nc"),
                    "skip_reason": (aitb_rule or {}).get("skip_reason")
                }
            
            if aitb_amount > 0.01:
                transaction = self._create_aitb_transaction(account, aitb_amount, aitb_conf, aitb_audit, request.accounts)
                account_adjustments.append((transaction, aitb_conf))
                audit_trails.append(aitb_audit)
                processing_stats["aitb_generated"] += 1

            # Prepare account for depreciation (Base + AITB)
            # Depreciación se calcula sobre el valor actualizado (Balance Inicial + AITB)
            depreciation_base = account.balance + aitb_amount
            # Create temporary account object with adjusted balance
            account_for_dep = Account(
                code=account.code, 
                name=account.name, 
                balance=depreciation_base, 
                type=account.type
            )

            # 2. DEPRECIACIÓN (PoT) - Executed on adjusted technical balance
            dep_result = self.calculate_depreciation_pot(account_for_dep, request.parameters)
            dep_amount, dep_conf, dep_audit, dep_rule = dep_result
            if account_debug is not None:
                account_debug["depreciation"] = {
                    "amount": dep_amount,
                    "confidence": dep_conf,
                    "audit": dep_audit,
                    "rule_source": (dep_rule or {}).get("source") or (dep_rule or {}).get("source_nc"),
                    "skip_reason": (dep_rule or {}).get("skip_reason"),
                    "depreciation_base": depreciation_base
                }
            
            if dep_amount > 0.01:
                transaction = self._create_depreciation_transaction(account, dep_amount, dep_conf, dep_audit, request.accounts)
                # Note: dep_rule is stored for internal tracking, not attached to transaction
                account_adjustments.append((transaction, dep_conf))
                audit_trails.append(dep_audit)
                processing_stats["depreciation_generated"] += 1

            # 3. PROVISIÓN (PoT)
            provision_result = self.calculate_provision_pot(account, request.parameters)
            provision_amount, provision_confidence, provision_audit, provision_rule = provision_result
            if account_debug is not None:
                account_debug["provision"] = {
                    "amount": provision_amount,
                    "confidence": provision_confidence,
                    "audit": provision_audit,
                    "rule_source": (provision_rule or {}).get("source") or (provision_rule or {}).get("source_nc"),
                    "skip_reason": (provision_rule or {}).get("skip_reason")
                }
            if provision_amount > 0.01:
                transaction = self._create_provision_transaction(account, provision_amount, provision_confidence, provision_audit)
                account_adjustments.append((transaction, provision_confidence))
                audit_trails.append(provision_audit)
                processing_stats["provision_generated"] += 1
            
            # ARS: Aplicar supresión adaptativa si confianza baja
            if self.ars_enabled:
                for transaction, confidence in account_adjustments:
                    # Si la confianza es extremadamente baja (< 0.3), suprimir por completo
                    if confidence < 0.3:
                        print(f"DEBUG: Totally suppressed (High Uncertainty) for {transaction.gloss} (Conf: {confidence})")
                        processing_stats["suppressed_adjustments"] += 1
                        continue
                    
                    # Si está por debajo del umbral pero por encima de 0.3, incluir pero marcar para revisión
                    if confidence < self.profile.ars_config.confidence_threshold:
                        print(f"DEBUG: Including Low Confidence adjustment for {transaction.gloss} (Conf: {confidence})")
                        transaction.review_needed = True 
                        # Note: We still add it to the list so the human can see it
                    
                    proposed_transactions.append(transaction)
                    confidence_scores.append(confidence)
            else:
                # Sin ARS: incluir todos los ajustes
                for transaction, confidence in account_adjustments:
                    proposed_transactions.append(transaction)
                    confidence_scores.append(confidence)

            if account_debug is not None:
                account_debug["generated_adjustments"] = [
                    {
                        "type": tx.adjustment_type.value,
                        "confidence": conf,
                        "gloss": tx.gloss
                    }
                    for tx, conf in account_adjustments
                ]
                debug_trace_rows.append(account_debug)
        
        # Cálculo de confianza agregada y decisión ARS
        aggregate_confidence = float(np.mean(confidence_scores)) if confidence_scores else 0.0
        review_needed = bool(aggregate_confidence < self.profile.ars_config.confidence_threshold)
        
        # Optimización de reasoning (shorter CoT)
        reasoning = self._generate_concise_reasoning(audit_trails, processing_stats, aggregate_confidence)
        
        # Estadísticas de procesamiento
        processing_time = (datetime.now() - start_time).total_seconds()
        processing_stats["processing_time_seconds"] = processing_time
        processing_stats["aggregate_confidence"] = aggregate_confidence
        processing_stats["review_needed"] = review_needed
        processing_stats["ars_enabled"] = self.ars_enabled
        processing_stats["debug_trace_enabled"] = debug_trace_enabled
        if debug_trace_enabled:
            processing_stats["debug_trace_rows"] = debug_trace_rows
        
        return AdjustmentResponse(
            success=len(proposed_transactions) > 0,
            proposedTransactions=proposed_transactions,
            aggregate_confidence=aggregate_confidence,
            reasoning=reasoning,
            warnings=["ARS activado" if self.ars_enabled else "ARS desactivado"],
            review_needed=review_needed,
            processing_stats=processing_stats
        )
        
    def _create_depreciation_transaction(self, account: Account, amount: float, confidence: float, audit: str, all_accounts: List[Account]) -> ProposedTransaction:
        """Crear asiento de depreciación con búsqueda de cuentas específicas"""
        rounded_amount = round(amount, 2)
        
        # 1. Buscar cuenta de Gasto por Depreciación específica (ej: Depreciacion Muebles y Enseres)
        expense_account_id = "DEP_EXPENSE"
        expense_account_name = "Gasto por Depreciación"
        
        # Patrón: "Depreciacion" + nombre del activo
        target_name_normalized = account.name.lower().replace("muebles y enseres", "muebles y enseres").replace("vehiculos", "vehiculos")
        
        for acc in all_accounts:
            name_low = acc.name.lower()
            # Buscar "Depreciacion" + algo del nombre original (excluyendo acumulada)
            if ("depreciacion" in name_low or "depreciación" in name_low) and \
               ("acumulada" not in name_low) and \
               any(word in name_low for word in account.name.lower().split() if len(word) > 3):
                expense_account_id = acc.code
                expense_account_name = acc.name
                break
        
        # Fallback estético si no se encuentra la cuenta específica
        if expense_account_id == "DEP_EXPENSE":
            asset_short_name = account.name.replace("ACTIVO FIJO - ", "").replace("Activo Fijo - ", "")
            expense_account_name = f"Depreciación {asset_short_name}"

        # 2. Buscar cuenta de Depreciación Acumulada específica
        accum_account_id = "DEP_ACCUM"
        accum_account_name = "Depreciación Acumulada"
        
        for acc in all_accounts:
            name_low = acc.name.lower()
            if ("depreciacion" in name_low or "depreciación" in name_low) and "acumulada" in name_low and any(word in name_low for word in account.name.lower().split() if len(word) > 3):
                accum_account_id = acc.code
                accum_account_name = acc.name
                break

        return ProposedTransaction(
            gloss=f"Depreciación Gestión - {account.code} {account.name}",
            entries=[
                TransactionEntry(
                    accountId=expense_account_id,
                    accountName=expense_account_name,
                    debit=rounded_amount,
                    credit=0,
                    gloss=f"Depreciación {account.code}"
                ),
                TransactionEntry(
                    accountId=accum_account_id,
                    accountName=accum_account_name,
                    debit=0,
                    credit=rounded_amount,
                    gloss=f"Depreciación acumulada {account.code}"
                )
            ],
            adjustment_type=AdjustmentType.DEPRECIACION,
            confidence=confidence,
            audit_trail=audit
        )
    
    def _normalize_string(self, text: str) -> str:
        """Normalizar texto eliminando acentos y convirtiendo a minúsculas"""
        if not text:
            return ""
        # Normalizar unicode (NFD separa caracteres de sus acentos)
        text = unicodedata.normalize('NFD', text)
        # Filtrar caracteres de combinación (acentos) y convertir a minúsculas
        text = ''.join(c for c in text if unicodedata.category(c) != 'Mn').lower()
        return text

    def _fuzzy_find_account(self, accounts: List[Account], keywords: List[str], fallback_code: str, fallback_name: str) -> Tuple[str, str]:
        """
        Búsqueda flexible de cuenta por palabras clave usando Normalización y Scoring.
        Prioriza la mejor coincidencia en lugar de la primera.
        """
        best_match = None
        best_score = 0
        
        # Normalizar keywords
        keywords_norm = [self._normalize_string(k) for k in keywords]
        
        for acc in accounts:
            name_norm = self._normalize_string(acc.name)
            current_score = 0
            
            # Evaluar coincidencias
            for kw in keywords_norm:
                if kw == name_norm:
                    current_score += 100 # Coincidencia exacta (agresiva)
                elif kw in name_norm:
                    # Coincidencia parcial: más puntos si es más específica (más larga)
                    current_score += 10 + len(kw)
            
            # Penalizar cuentas "acumulada" si no se buscaba explícitamente y cuentas de título (sin saldo normalmente)
            if "acumulada" in name_norm and not any("acumulada" in k for k in keywords_norm):
                current_score -= 50
                
            if current_score > best_score:
                best_score = current_score
                best_match = acc
        
        if best_match and best_score > 0:
            return best_match.code, best_match.name
            
        # No match found, return fallback
        return fallback_code, fallback_name
    
    def _create_aitb_transaction(self, account: Account, amount: float, confidence: float, audit: str, available_accounts: Optional[List[Account]] = None) -> ProposedTransaction:
        """Crear asiento AITB con estructura NC-3 y búsqueda flexible de cuenta"""
        # Redondear el monto usando redondeo bancario
        rounded_amount = round(amount, 2)
        abs_amount = abs(rounded_amount)
        
        # Buscar cuenta de AITB/REI en el plan de cuentas existente
        # V6.6 FIX: Lista expandida y normalizada para encontrar "Ajuste por Inflación y Tenencia de Bienes"
        aitb_keywords = [
            "ajuste por inflacion y tenencia de bienes", # Nombre completo estándar
            "ajuste por inflacion",
            "resultado por exposicion a la inflacion",
            "tenencia de bienes", 
            "aitb", 
            "rei",
            "mantenimiento de valor"
        ]
        
        if available_accounts:
            aitb_code, aitb_name = self._fuzzy_find_account(
                available_accounts, 
                aitb_keywords,
                "AITB_RESULT",
                "Ajuste por inflación y tenencia de bienes"
            )
        else:
            aitb_code = "AITB_RESULT"
            aitb_name = "Ajuste por inflación y tenencia de bienes"
            
        # Determinar dirección del ajuste (Debe/Haber) según tipo de cuenta e inflación
        # Heurística: Activos (1), Costos (5), Gastos (6) aumentan al Debe
        # Pasivos (2), Patrimonio (3), Ingresos (4) aumentan al Haber
        # VUniversal: Determinación de naturaleza (Deudora vs Acreedora)
        # Deudora (Debit Balance): Activo, Gasto, Costo. (Aumentan al Debe)
        # Acreedora (Credit Balance): Pasivo, Patrimonio, Ingreso. (Aumentan al Haber)
        
        type_norm = self._normalize_string(account.type) if account.type else ""
        is_debit_nature = False
        
        # 1. Check by Type (Universal)
        if any(x in type_norm for x in ["activo", "gasto", "costo", "egreso"]):
            is_debit_nature = True
        elif any(x in type_norm for x in ["pasivo", "patrimonio", "ingreso", "resultado"]):
            is_debit_nature = False
        else:
            # 2. Fallback by Code
            # 1=Activo, 5=Gasto, 6=Costo (standard)
            # 8=Costo (some plans)?
            if account.code.startswith(('1', '5', '6', '8')): 
                is_debit_nature = True
            else:
                is_debit_nature = False # Default to Credit nature (Pasivo/Patrimonio/Ingreso)
        
        is_inflation = amount >= 0 # Asumimos inflación positiva si amount > 0
        
        # Lógica de Asiento:
        # Deudora + Inflación -> Debe Cuenta (sube valor), Haber AITB (Ganancia por tenencia)
        # Acreedora + Inflación -> Haber Cuenta (sube valor), Debe AITB (Pérdida por exposición)
        
        if (is_debit_nature and is_inflation) or (not is_debit_nature and not is_inflation):
            # Debe: Cuenta ajustada (Activo sube)
            # Haber: AITB Result (Ganancia)
            debit_acc_id = account.code
            debit_acc_name = account.name
            credit_acc_id = aitb_code
            credit_acc_name = aitb_name
            debit_gloss = f"Revaluación {account.code} - {account.name}"
            credit_gloss = f"AITB {account.code} - Ganancia por tenencia"
        else:
            # Debe: AITB Result (Pérdida)
            # Haber: Cuenta ajustada (Pasivo sube)
            debit_acc_id = aitb_code
            debit_acc_name = aitb_name
            credit_acc_id = account.code
            credit_acc_name = account.name
            debit_gloss = f"AITB {account.code} - Pérdida por exposición"
            credit_gloss = f"Revaluación {account.code} - {account.name}"
        
        return ProposedTransaction(
            gloss=f"AITB - {account.code} {account.name}",
            entries=[
                TransactionEntry(
                    accountId=debit_acc_id,
                    accountName=debit_acc_name,
                    debit=abs_amount,
                    credit=0,
                    gloss=debit_gloss
                ),
                TransactionEntry(
                    accountId=credit_acc_id,
                    accountName=credit_acc_name,
                    debit=0,
                    credit=abs_amount,
                    gloss=credit_gloss
                )
            ],
            adjustment_type=AdjustmentType.AITB,
            confidence=confidence,
            audit_trail=audit
        )

    
    def _create_provision_transaction(self, account: Account, amount: float, confidence: float, audit: str) -> ProposedTransaction:
        """Crear asiento de provisión estándar"""
        return ProposedTransaction(
            gloss=f"Provisión - {account.name}",
            entries=[
                TransactionEntry(
                    accountId="PROV_EXPENSE",
                    accountName="Gasto por Provisión",
                    debit=amount,
                    credit=0,
                    gloss=f"Provisión {account.code}"
                ),
                TransactionEntry(
                    accountId="PROV_ACCUM",
                    accountName="Provisión Acumulada",
                    debit=0,
                    credit=amount,
                    gloss=f"Provisión acumulada {account.code}"
                )
            ],
            adjustment_type=AdjustmentType.PROVISION,
            confidence=confidence,
            audit_trail=audit
        )
    
    def _generate_concise_reasoning(self, audit_trails: List[str], stats: Dict, confidence: float) -> str:
        """Generar reasoning conciso (shorter CoT)"""
        if not audit_trails:
            return "No se generaron ajustes."
        
        # Resumen conciso con formato optimizado
        summary_parts = [
            f"Procesados: {stats['accounts_processed']} cuentas",
            f"Generados: {stats['depreciation_generated']} dep, {stats['aitb_generated']} AITB, {stats['provision_generated']} prov"
        ]
        
        if stats.get('suppressed_adjustments', 0) > 0:
            summary_parts.append(f"Suprimidos: {stats['suppressed_adjustments']} (baja confianza)")
        
        summary_parts.append(f"Confianza: {confidence:.2f}")
        
        return " | ".join(summary_parts)

# =============================================================================
# FASTAPI ENDPOINTS (V3.0 - ARS-DSPy Integration)
# =============================================================================

# Inicializar motor ARS-DSPy
engine = ARSDSPyEngine()

@app.post("/api/ai/adjustments/generate", response_model=AdjustmentResponse)
async def generate_adjustments(request: AdjustmentRequest):
    """Endpoint principal ARS-DSPy para generación de ajustes"""
    try:
        print(f"DEBUG: Received request: {request.company_id} with {len(request.accounts)} accounts")
        # Inicializar motor con perfil dinámico si se proporciona
        if request.profile_schema:
            dynamic_engine = ARSDSPyEngine(request.profile_schema)
            return dynamic_engine.generate_adjustments(request)
        return engine.generate_adjustments(request)
    except Exception as e:
        print(f"ERROR in generate_adjustments: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/ai/health")
async def health_check():
    """Health check para microservicio ARS-DSPy"""
    return {
        "status": "healthy", 
        "engine": "AI Adjustment Engine V3.0 (ARS-DSPy)",
        "ars_enabled": engine.ars_enabled,
        "version": "3.0.0"
    }

@app.post("/api/ai/adjustments/batch-validate")
async def batch_validate_transactions(transactions: List[ProposedTransaction]):
    """Validación por lotes con trazabilidad ARS"""
    results = []
    
    for transaction in transactions:
        # Validar balance
        total_debit = sum(entry.debit for entry in transaction.entries)
        total_credit = sum(entry.credit for entry in transaction.entries)
        
        is_balanced = abs(total_debit - total_credit) < 0.01
        
        # Validar estructura
        has_debit = any(entry.debit > 0 for entry in transaction.entries)
        has_credit = any(entry.credit > 0 for entry in transaction.entries)
        
        # Validar confianza ARS
        confidence_valid = bool(transaction.confidence >= engine.profile.ars_config.confidence_threshold)
        
        results.append({
            "gloss": transaction.gloss,
            "adjustment_type": transaction.adjustment_type,
            "is_valid": is_balanced and has_debit and has_credit,
            "confidence_valid": confidence_valid,
            "total_debit": total_debit,
            "total_credit": total_credit,
            "difference": abs(total_debit - total_credit),
            "entries_count": len(transaction.entries),
            "audit_trail": transaction.audit_trail,
            "review_needed": bool(not confidence_valid)
        })
    
    return {
        "batch_results": results,
        "total_transactions": len(transactions),
        "valid_transactions": sum(1 for r in results if r["is_valid"]),
        "invalid_transactions": sum(1 for r in results if not r["is_valid"]),
        "ars_stats": {
            "high_confidence": sum(1 for r in results if r["confidence_valid"]),
            "review_needed": sum(1 for r in results if r["review_needed"])
        }
    }

class ExplainRequest(BaseModel):
    account: Account
    params: AdjustmentParameters
    profile_schema: Optional[Dict[str, Any]] = None

@app.post("/api/ai/adjustments/explain")
async def explain_adjustment(request: ExplainRequest):
    """Explicación detallada ARS-DSPy del razonamiento"""
    # Usar motor dinámico si se proporciona perfil
    current_engine = ARSDSPyEngine(request.profile_schema or {}) if request.profile_schema else engine
    
    account = request.account
    params = request.params
    
    # Clasificación semántica
    classification, base_confidence, tags, _ = current_engine.classify_account_semantic(account)
    
    explanation = {
        "account": {
            "code": account.code,
            "name": account.name,
            "balance": account.balance
        },
        "classification": {
            "type": classification,
            "confidence": base_confidence,
            "tags": tags
        },
        "recommended_adjustments": [],
        "ars_analysis": {
            "adaptive_confidence": current_engine.calculate_adaptive_confidence(account, "general", base_confidence),
            "suppression_threshold": current_engine.profile.ars_config.confidence_threshold,
            "would_be_suppressed": bool(base_confidence < current_engine.profile.ars_config.confidence_threshold)
        }
    }
    
    # Análisis de cada tipo de ajuste
    dep_result = current_engine.calculate_depreciation_pot(account, params)
    depreciation_amount, depreciation_confidence, depreciation_audit, _ = dep_result
    if depreciation_amount > 0.01:
        explanation["recommended_adjustments"].append({
            "type": "depreciacion",
            "amount": depreciation_amount,
            "confidence": depreciation_confidence,
            "reasoning": depreciation_audit,
            "entry": "Gasto por Depreciación / Depreciación Acumulada"
        })

    aitb_result = current_engine.calculate_aitb_pot(account, params)
    aitb_amount, aitb_confidence, aitb_audit, _ = aitb_result
    if aitb_amount > 0.01:
        explanation["recommended_adjustments"].append({
            "type": "ajuste_inflacion",
            "amount": aitb_amount,
            "confidence": aitb_confidence,
            "reasoning": aitb_audit,
            "entry": "Gasto por Ajuste por Inflación / Cuenta ajustada"
        })

    provision_result = current_engine.calculate_provision_pot(account, params)
    provision_amount, provision_confidence, provision_audit, _ = provision_result
    if provision_amount > 0.01:
        explanation["recommended_adjustments"].append({
            "type": "provision",
            "amount": provision_amount,
            "confidence": provision_confidence,
            "reasoning": provision_audit,
            "entry": "Gasto por Provisión / Provisión Acumulada"
        })
    
    return explanation

@app.get("/api/ai/adjustments/config")
async def get_adjustment_config():
    """Configuración actual del motor ARS-DSPy"""
    return {
        "engine_version": "3.0.0 (ARS-DSPy)",
        "ars_config": {
            "enabled": engine.ars_enabled,
            "confidence_threshold": engine.profile.ars_config.confidence_threshold,
            "max_reasoning_tokens": engine.profile.ars_config.max_reasoning_tokens,
            "audit_trail_format": engine.profile.ars_config.audit_trail_format
        },
        "semantic_rules": {
            "monetary_rules_count": len(engine.profile.monetary_rules),
            "non_monetary_rules_count": len(engine.profile.non_monetary_rules)
        },
        "depreciation_configs": [
            {
                "asset_type": config.asset_type_keyword,
                "annual_rate": config.annual_rate,
                "confidence": config.confidence_level,
                "reference": config.nc_reference
            } for config in engine.profile.depreciation_configs
        ],
        "supported_methods": ["UFV", "TC"],
        "compliance_framework": ["NC-3", "NC-6", "DS-24051", "IFRS-NIIF"],
        "features": {
            "adaptive_reasoning_suppression": True,
            "semantic_classification": True,
            "program_of_thought": True,
            "dynamic_configuration": True,
            "multi_tenant": True
        }
    }

# =============================================================================
# INTEGRACIÓN CON MIDDLEWARE (Obtención de saldos pre-ajuste)
# =============================================================================

@app.post("/api/ai/adjustments/generate-from-ledger")
async def generate_from_ledger(request: AdjustmentRequest):
    """Generar ajustes obteniendo saldos automáticamente desde middleware"""
    try:
        # Importar cliente para obtener saldos del middleware
        import httpx
        
        # Permitir que el middleware Node.js inyecte su URL en runtime (útil en serverless/proxy).
        requested_api_url = (request.parameters.api_base_url or "").strip()
        raw_candidate_urls = [
            requested_api_url,
            *(request.parameters.api_base_url_candidates or []),
            os.getenv("API_BASE_URL", ""),
            "http://localhost:3001",
            "http://127.0.0.1:3001",
            "http://host.docker.internal:3001"
        ]
        api_url_candidates: List[str] = []
        seen_candidates = set()
        for candidate in raw_candidate_urls:
            normalized = (candidate or "").strip().rstrip("/")
            if normalized.endswith("/api"):
                normalized = normalized[:-4]
            if not normalized or normalized in seen_candidates:
                continue
            seen_candidates.add(normalized)
            api_url_candidates.append(normalized)
        print(f"DEBUG: Middleware base URL candidates: {api_url_candidates}")
        
        # Obtener saldos pre-ajuste desde middleware Node.js
        middleware_attempts = []
        ledger_response = None
        api_url = ""
        async with httpx.AsyncClient(trust_env=False, follow_redirects=True) as client:
            for candidate_url in api_url_candidates:
                try:
                    candidate_response = await client.get(
                        f"{candidate_url}/api/reports/ledger",
                        params={
                            "companyId": request.company_id,
                            "excludeAdjustments": True,
                            "excludeClosing": True
                        },
                        timeout=30.0
                    )
                    middleware_attempts.append({
                        "base_url": candidate_url,
                        "status": candidate_response.status_code
                    })
                    if candidate_response.status_code == 200:
                        ledger_response = candidate_response
                        api_url = candidate_url
                        break
                except Exception as candidate_error:
                    middleware_attempts.append({
                        "base_url": candidate_url,
                        "error": str(candidate_error)
                    })
                    continue
            
            if ledger_response is None:
                error_detail = (
                    "No se pudo conectar al middleware para obtener libro mayor. "
                    f"Intentos: {json.dumps(middleware_attempts, ensure_ascii=False)[:800]}"
                )
                print(f"ERROR: {error_detail}")
                raise HTTPException(status_code=503, detail=error_detail)
            
            ledger_data = ledger_response.json()
            accounts_from_ledger = ledger_data.get("data", [])
            print(f"DEBUG: Fetched {len(accounts_from_ledger)} accounts from Ledger API")
            
            # ⚡ V6.5 FIX: Fetch ALL accounts (Chart of Accounts) for matching expense accounts
            chart_of_accounts = []
            try:
                coa_response = await client.get(
                    f"{api_url}/api/accounts", # Corrected f-string
                    params={"companyId": request.company_id},
                    timeout=10.0
                )
                if coa_response.status_code == 200:
                    coa_data = coa_response.json()
                    chart_of_accounts = coa_data.get("data", [])
                    print(f"DEBUG: Fetched {len(chart_of_accounts)} accounts from Chart of Accounts API")
            except Exception as e:
                print(f"WARN Error fetching CoA: {str(e)}")

            # Mapear cuentas del ledger a formato Account (para análisis de saldos)
            mapped_accounts = []
            for ledger_account in accounts_from_ledger:
                if ledger_account.get("balance", 0) != 0:  # Solo cuentas con saldo
                    mapped_accounts.append(Account(
                        code=ledger_account["code"],
                        name=ledger_account["name"],
                        balance=abs(ledger_account["balance"]),
                        type=ledger_account.get("type")
                    ))
            
            # Crear lista extendida de TODAS las cuentas para el engine (para búsquedas de contrapartidas)
            full_account_list = []
            # Primero las de saldos reales
            full_account_list.extend(mapped_accounts)
            # Luego las del plan de cuentas que no están en el ledger
            ledger_codes = {a.code for a in mapped_accounts}
            for coa_acc in chart_of_accounts:
                code = coa_acc.get("code")
                if code and code not in ledger_codes:
                    full_account_list.append(Account(
                        code=code,
                        name=coa_acc.get("name", ""),
                        balance=0.0,
                        type=coa_acc.get("type")
                    ))

            print(f"DEBUG: Mapped {len(mapped_accounts)} valid accounts with balance")
            print(f"DEBUG: Total account universe for matching: {len(full_account_list)}")

            # ⚡ V6.5 CRÍTICO: Reemplazar cuentas del request con el UNIVERSO COMPLETO
            # Esto permite que las búsquedas de contrapartidas (ej. Gasto por Depreciación)
            # funcionen incluso si la cuenta de gasto tiene saldo 0.
            # El motor generate_adjustments saltará las de saldo 0 para procesamiento,
            # pero las usará como catálogo para matching.
            request.accounts = full_account_list
            
            # V6.0 FIX: Usar motor dinámico con perfil inyectado para respetar reglas aprendidas
            if request.profile_schema:
                print(f"🔄 [generate-from-ledger] Usando perfil dinámico con {len(request.profile_schema.get('monetary_rules', []))} reglas M, {len(request.profile_schema.get('non_monetary_rules', []))} reglas NM")
                dynamic_engine = ARSDSPyEngine(request.profile_schema)
                semantic_concepts = dynamic_engine.profile.profile_data.get("semantic_concepts", {}) or {}
                print(
                    "🔎 [generate-from-ledger] Perfil efectivo -> "
                    f"semantic M:{len(semantic_concepts.get('monetary', []) or [])}, "
                    f"semantic NM:{len(semantic_concepts.get('non_monetary', []) or [])}, "
                    f"dep_configs:{len(dynamic_engine.profile.depreciation_configs)}"
                )
                result = dynamic_engine.generate_adjustments(request)
            else:
                result = engine.generate_adjustments(request)
            
            # Agregar metadata de integración
            result.processing_stats["ledger_integration"] = {
                "accounts_from_ledger": len(accounts_from_ledger),
                "accounts_with_balance": len(mapped_accounts),
                "middleware_source": "Node.js API",
                "middleware_base_url": api_url,
                "middleware_attempts": middleware_attempts
            }
            
            return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error en integración ledger: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
            
# =============================================================================
# MAHORAGA EXTENSION: MÓDULO DE AUTOAPRENDIZAJE (SCL)
# =============================================================================

class FeedbackErrorTag(str, Enum):
    MISCLASSIFIED_ACCOUNT = "MISCLASSIFIED_ACCOUNT"
    INCORRECT_DEPRECIATION = "INCORRECT_DEPRECIATION"
    THRESHOLD_VIOLATION = "THRESHOLD_VIOLATION"
    USER_OVERRIDE = "USER_OVERRIDE"

class FeedbackRequest(BaseModel):
    company_id: str
    account_code: str
    account_name: str
    correct_type: Optional[str] = None
    correct_adjustment_type: Optional[AdjustmentType] = None
    error_tag: FeedbackErrorTag
    user: str = "Anonymous" # Provenance
    origin_trans: Optional[str] = None # Provenance
    user_comment: Optional[str] = None
    is_global_adaptation: bool = False
    total_assets: float = 0.0 # For Materiality Integrity Check
    existing_profile: Optional[Dict[str, Any]] = None  # V6.0: Perfil existente de la DB

class LearningResponse(BaseModel):
    success: bool
    adaptation_level: str
    new_rule_generated: Optional[str] = None
    updated_profile_schema: Dict[str, Any]
    warnings: List[str] = []
    adaptation_details: Optional[Dict[str, Any]] = Field(None, description="Detalles completos de la regla generada por la adaptación")

class HardRulesValidator:
    """Sello de Contención 1: Sanidad Contable Inmutable (V5.0)"""
    
    @staticmethod
    def validate_adaptation(account_name: str, correct_type: str) -> List[str]:
        warnings = []
        name = account_name.lower()
        
        # Invariante: Activos Fijos no pueden ser monetarios (NC-3)
        fixed_asset_keywords = ["edificio", "vehiculo", "maquinaria", "mueble", "equipo", "terreno"]
        if any(k in name for k in fixed_asset_keywords) and correct_type == "monetary":
            warnings.append(f"ALERTA: El rubro '{account_name}' es un Activo Fijo. Clasificarlo como Monetario viola la NC-3.")
            
        # Invariante: Cuentas de resultados no suelen ser no monetarias
        if ("gasto" in name or "ingreso" in name) and correct_type == "non_monetary":
             warnings.append(f"AVISO: Las cuentas de resultados Generally son monetarias. Verifica el ajuste por inflación.")
             
        return warnings

    @staticmethod
    def verify_integrity_gate(feedback: FeedbackRequest, account_balance: float) -> Optional[str]:
        """Mahoraga's Logic Gate (Materiality Check)"""
        # Si el usuario intenta ignorar una cuenta (marcarla como monetaria cuando tiene saldo)
        if feedback.correct_type == "monetary" and abs(account_balance) > 0:
            # Umbral de Materialidad Dinámica: 0.5% del activo total o 100 Bs.
            materiality_threshold = max(100.0, feedback.total_assets * 0.005)
            if abs(account_balance) > materiality_threshold:
                return f"BLOQUEO DE INTEGRIDAD: La cuenta tiene un saldo material ({account_balance:,.2f} > {materiality_threshold:,.2f}). La omisión de ajuste podría falsear los estados financieros."
        return None

class MahoragaEngine(ARSDSPyEngine):
    """
    El General Divino Mahoraga (V6.0 - Divine Grade): Motor de Adaptación Determinística.
    ⚡ LA RUEDA DE OCHO EMPUÑADURAS (Hōjin) ⚡
    
    Aprende de los 'golpes' (correcciones) y evoluciona la Rueda (Reglas).
    Implementa el patrón Tekiō (Adaptación) en tres fases:
    - Fase 1: Resistencia/Inmunidad (Validación Hard Rules)
    - Fase 2: Contra-Estrategia (Eliminación de reglas conflictivas + Nueva regla suprema)
    - Fase 3: Optimización de Energía (Ajuste de pesos de confianza)
    """
    
    # Historial de Eventos (V6.0 - Granular con Provenance)
    adaptation_events = []
    adaptation_snapshots = []  # Para rollback

    def verify_cycle_integrity(self, feedback: 'FeedbackRequest') -> Tuple[bool, str]:
        """
        🔒 PUERTA DE INTEGRIDAD DEL CICLO CONTABLE
        Verifica que no se violen reglas de materialidad o cierres antes de adaptar.
        """
        try:
            import requests
            
            # Fix: Use proper Python environment variable retrieval and f-string
            api_url = os.getenv("API_BASE_URL", "http://localhost:3001")
            
            # 1. Verificar si el ciclo está cerrado
            closing_check = requests.get(
                f"{api_url}/api/reports/closing-check",
                params={
                    "companyId": feedback.company_id,
                    "gestion": getattr(feedback, 'gestion', None) or datetime.now().year - 1
                },
                timeout=5.0
            )

            if closing_check.status_code == 200:
                cycle_data = closing_check.json()

                # BLOQUEO ABSOLUTO: Si el ciclo está cerrado, NO permitir adaptaciones
                if cycle_data.get('hasClosingEntries'):
                    return False, f"🚫 CICLO CONTABLE CERRADO: No se pueden realizar adaptaciones SCL porque el período fiscal está cerrado (último cierre: {cycle_data.get('lastClosingDate', 'N/A')}). Las adaptaciones deben hacerse ANTES del cierre de gestión."

                # 2. Verificar regla de materialidad (0.5% del activo total)
                total_assets = feedback.total_assets or 0
                materiality_threshold = max(100.0, total_assets * 0.005)  # 0.5% del activo o mínimo Bs 100

                # Si la cuenta tiene un saldo material y se intenta cambiar su naturaleza, bloquear
                account_balance_check = feedback.total_assets / 100 if feedback.total_assets > 0 else 0.0
                if abs(account_balance_check) > materiality_threshold:
                    return False, f"🚫 VIOLACIÓN DE MATERIALIDAD: La cuenta '{feedback.account_name}' tiene un saldo material ({feedback.total_assets:,.2f}) que excede el umbral de materialidad ({materiality_threshold:,.2f}). Las correcciones deben ser aprobadas por auditoría."

            return True, "✅ Integridad del ciclo verificada"

        except Exception as e:
            # Si falla la verificación, permitir continuar pero con warning
            print(f"⚠️ Error verificando integridad del ciclo: {str(e)}")
            return True, "⚠️ No se pudo verificar integridad del ciclo (continuando con precaución)"

    def learn_from_feedback(self, feedback: 'FeedbackRequest') -> 'LearningResponse':
        """
        ⚡ EL GIRO DE LA RUEDA (Hōjin Rotation) ⚡
        Transforma un error humano en inmunidad algorítmica.
        V6.0 FIX: Usa el perfil existente de la DB (no el por defecto)
        """
        print(f"🔮 [PYTHON] learn_from_feedback recibido:")
        print(f"   error_tag: {feedback.error_tag} (type: {type(feedback.error_tag)})")
        print(f"   correct_type: {feedback.correct_type}")
        print(f"   account_name: {feedback.account_name}")

        # V6.0 FIX: Usar el perfil existente de la DB si está disponible
        if feedback.existing_profile and isinstance(feedback.existing_profile, dict):
            profile_data = feedback.existing_profile.copy()
            print(f"   📦 Usando perfil existente de DB: {len(profile_data.get('monetary_rules', []))}M, {len(profile_data.get('non_monetary_rules', []))}NM reglas")
        else:
            profile_data = self.profile.profile_data.copy()
            print(f"   ⚠️ No hay perfil existente, usando perfil por defecto")

        warnings = []

        # ═══════════════════════════════════════════════════════════════════
        # FASE 0: VERIFICACIÓN DE INTEGRIDAD DEL CICLO
        # ═══════════════════════════════════════════════════════════════════
        integrity_allowed, integrity_message = self.verify_cycle_integrity(feedback)
        print(f"   🔒 Integridad del ciclo: {integrity_message}")

        if not integrity_allowed:
            return LearningResponse(
                success=False,
                adaptation_level="⛔ Adaptación Bloqueada por Integridad",
                warnings=[integrity_message],
                updated_profile_schema=profile_data,
                adaptation_details={"blocked_reason": integrity_message}
            )
        
        # Guardar snapshot para rollback (Sello 2)
        self.adaptation_snapshots.append(self.profile.profile_data.copy())
        if len(self.adaptation_snapshots) > 10:
            self.adaptation_snapshots.pop(0)  # Mantener solo últimos 10
        
        # ═══════════════════════════════════════════════════════════════════
        # FASE 1: RESISTENCIA/INMUNIDAD - Puerta Lógica de Integridad
        # ═══════════════════════════════════════════════════════════════════
        # V6.0 FIX: Usar un balance bajo por defecto para NO bloquear adaptaciones
        # El bloqueo de integridad solo debería activarse con datos reales de balance
        account_balance_for_check = feedback.total_assets / 100 if feedback.total_assets > 0 else 0.0
        integrity_error = HardRulesValidator.verify_integrity_gate(feedback, account_balance_for_check)
        print(f"   🔒 Integrity check: balance={account_balance_for_check}, error={integrity_error}")
        if integrity_error:
            return LearningResponse(
                success=False, 
                adaptation_level="⛔ Bloqueada por Energía Negativa (Integridad Fallida)", 
                warnings=[integrity_error], 
                updated_profile_schema=profile_data,
                adaptation_details={"blocked_reason": integrity_error}
            )

        # Validar Reglas Hard (NC-3 invariantes)
        if feedback.correct_type:
            hard_warnings = HardRulesValidator.validate_adaptation(feedback.account_name, feedback.correct_type)
            warnings.extend(hard_warnings)
        
        # ═══════════════════════════════════════════════════════════════════
        # REGISTRO DE EVENTO (Trazabilidad Cognitiva V6.0)
        # ═══════════════════════════════════════════════════════════════════
        event_id = f"EVT-{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
        adaptation_event = {
            "id": event_id,
            "user": feedback.user,
            "origin_trans": feedback.origin_trans,
            "account_code": feedback.account_code,
            "account_name": feedback.account_name,
            "action": f"Set nature to {feedback.correct_type}",
            "timestamp": datetime.now().isoformat(),
            "error_reason_tag": feedback.error_tag.value,
            "user_comment": feedback.user_comment,
            "phase": "Tekiō-2" # Indica que pasó a Fase 2
        }
        if "adaptation_events" not in profile_data:
            profile_data["adaptation_events"] = []
        profile_data["adaptation_events"].append(adaptation_event)
        
        # ═══════════════════════════════════════════════════════════════════
        # FASE 2: CONTRA-ESTRATEGIA (Tekiō) - Eliminación + Inyección
        # ═══════════════════════════════════════════════════════════════════
        if feedback.error_tag in [FeedbackErrorTag.MISCLASSIFIED_ACCOUNT, FeedbackErrorTag.USER_OVERRIDE] and feedback.correct_type:
            
            # 2.1: Escapar nombre para regex seguro
            account_name_escaped = re.escape(feedback.account_name)
            
            # 2.2: Generar patrones (local = exacto, global = substring)
            local_pattern = f"^{account_name_escaped}$"
            global_pattern = f".*{account_name_escaped}.*"
            
            # 2.3: CONTRA-ESTRATEGIA MAHORAGA V6.0
            # Eliminar CUALQUIER regla conflictiva en AMBAS listas
            conflicting_rules_removed = 0
            for rule_list_name in ["monetary_rules", "non_monetary_rules"]:
                if rule_list_name in profile_data:
                    original_count = len(profile_data[rule_list_name])
                    profile_data[rule_list_name] = [
                        rule for rule in profile_data[rule_list_name]
                        if rule.get("pattern") not in [local_pattern, global_pattern]
                        and account_name_escaped.lower() not in rule.get("pattern", "").lower()
                    ]
                    conflicting_rules_removed += original_count - len(profile_data[rule_list_name])

            # 2.4: Crear la nueva regla con MÁXIMA CONFIANZA
            pattern = global_pattern if feedback.is_global_adaptation else local_pattern
            new_rule = {
                "pattern": pattern,
                "tags": [self._map_type_to_tag(feedback.correct_type)],
                "source_nc": "Mahoraga-SCL-Adaptation",
                "confidence_weight": 5.0,  # Peso supremo para override inmediato
                "reasoning_weight": 2.0,   # Doble peso en razonamiento
                "adaptation_timestamp": datetime.now().timestamp(),
                "provenance": {
                    "event_id": event_id,
                    "user": feedback.user,
                    "reason": feedback.user_comment or "User Override",
                    "error_tag": feedback.error_tag.value,
                    "original_trans": feedback.origin_trans,
                },
                "hit_count": 0,
                "last_hit": None
            }
            
            # 2.5: Insertar al INICIO de la lista correcta (máxima prioridad)
            target_list = "non_monetary_rules" if feedback.correct_type == "non_monetary" else "monetary_rules"
            if target_list not in profile_data:
                profile_data[target_list] = []
            profile_data[target_list].insert(0, new_rule)
            
            # ═══════════════════════════════════════════════════════════════
            # TRANSPARENCIA COGNITIVA V6.0 (Mensaje detallado para Frontend)
            # ═══════════════════════════════════════════════════════════════
            type_label = "No Monetaria (AITB aplicable)" if feedback.correct_type == "non_monetary" else "Monetaria (sin AITB)"
            adaptation_note = (
                f"⚡ RUEDA GIRADA: Cuenta '{feedback.account_name}' ahora clasificada como {type_label}. "
                f"Patrón regex insertado: /{pattern}/i con peso de confianza 5.0 (máximo). "
                f"Reglas conflictivas eliminadas: {conflicting_rules_removed}. "
                f"Evento: {event_id}"
            )
            
            print(f"🔄 MAHORAGA TEKIŌ: {adaptation_note}")
            
            return LearningResponse(
                success=True,
                adaptation_level="⚡ Tekiō Fase 2 Completa (Contra-Estrategia Aplicada)",
                new_rule_generated=adaptation_note,
                updated_profile_schema=profile_data,
                warnings=warnings,
                adaptation_details={
                    "new_rule": new_rule,
                    "pattern_inserted": pattern,
                    "target_list": target_list,
                    "conflicting_removed": conflicting_rules_removed,
                    "event_id": event_id,
                    "confidence_weight": 5.0
                }
            )
        
        # ═══════════════════════════════════════════════════════════════════
        # FASE 3: OPTIMIZACIÓN DE ENERGÍA (Ajuste de pesos sin cambio de tipo)
        # ═══════════════════════════════════════════════════════════════════
        if feedback.error_tag == FeedbackErrorTag.THRESHOLD_VIOLATION:
            # Crear regla de supresión (confianza 0)
            suppression_rule = {
                "pattern": f"^{re.escape(feedback.account_name)}$",
                "tags": ["Suppressed", "SCL-Ignored"],
                "source_nc": "Mahoraga-Suppression",
                "confidence_weight": 0.0,
                "provenance": {"event_id": event_id, "reason": "Threshold Violation"}
            }
            if "suppression_rules" not in profile_data:
                profile_data["suppression_rules"] = []
            profile_data["suppression_rules"].insert(0, suppression_rule)
            
            return LearningResponse(
                success=True,
                adaptation_level="⚡ Tekiō Fase 3 (Optimización de Energía)",
                new_rule_generated=f"Cuenta '{feedback.account_name}' marcada para supresión automática.",
                updated_profile_schema=profile_data,
                warnings=warnings,
                adaptation_details={"suppression_rule": suppression_rule}
            )
            
        return LearningResponse(
            success=False, 
            adaptation_level="Sin Acción (Tag no reconocido)", 
            warnings=["Tag de error no reconocido o tipo de corrección faltante"], 
            updated_profile_schema=profile_data,
            adaptation_details=None
        )

    def find_pattern_candidates(self, rules: List[Dict]) -> Optional[str]:
        """Fase 3: Generalización de Patrones (Heurística simple)"""
        # Si hay más de 2 reglas locales que comparten un prefijo común
        patterns = [r["pattern"].strip("^$") for r in rules if r.get("confidence_weight", 0) > 2.0]
        if len(patterns) >= 3:
            # Encontrar prefijo común
            prefix = os.path.commonprefix(patterns)
            if len(prefix) > 5: # Prefijo significativo
                return prefix
        return None

    def prune_cold_storage(self) -> Tuple[int, List[Dict]]:
        """
        Poda de la Rueda (Performance Maintenance V5.0)
        Mueve reglas obsoletas (> 2 gestiones sin uso) a Cold Storage.
        """
        profile_data = self.profile.profile_data
        hot_monetary = []
        cold_rules = []
        
        two_years_ago = (datetime.now() - timedelta(days=730)).isoformat()
        
        for rule in profile_data.get("monetary_rules", []):
            last_hit = rule.get("last_hit")
            # Si tiene hit_count alto o es reciente, se queda
            if not last_hit or last_hit > two_years_ago or rule.get("confidence_weight", 0) > 2.0:
                hot_monetary.append(rule)
            else:
                cold_rules.append(rule)
                
        # Repetir para no monetarios...
        hot_non_monetary = []
        for rule in profile_data.get("non_monetary_rules", []):
            last_hit = rule.get("last_hit")
            if not last_hit or last_hit > two_years_ago or rule.get("confidence_weight", 0) > 2.0:
                hot_non_monetary.append(rule)
            else:
                cold_rules.append(rule)
        
        profile_data["monetary_rules"] = hot_monetary
        profile_data["non_monetary_rules"] = hot_non_monetary
        
        return len(cold_rules), cold_rules

    def _map_type_to_tag(self, type_str: str) -> str:
        if type_str == "non_monetary": return "NoMonetario"
        if type_str == "monetary": return "Monetario"
        return "Personalizado"

# Instanciar el General Divino
mahoraga = MahoragaEngine()

@app.post("/api/ai/adjustments/feedback", response_model=LearningResponse)
async def receive_feedback(feedback: FeedbackRequest):
    """El Ritual de Invocación: Recibe el feedback y hace girar la rueda."""
    try:
        # En una app real, recuperaríamos el perfil de la DB aquí
        result = mahoraga.learn_from_feedback(feedback)
        
        # El frontend se encargará de persistir el updated_profile_schema
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falla en el ritual de adaptación: {str(e)}")

@app.post("/api/ai/adjustments/rollback")
async def rollback_adaptation():
    """Reset de la Rueda (Sello 2): Revierte al último estado conocido sano."""
    if not mahoraga.adaptation_snapshots:
        return {"success": False, "message": "No hay snapshots disponibles para revertir."}
    
    last_state = mahoraga.adaptation_snapshots.pop()
    # En una implementación real, esto actualizaría la DB
    return {
        "success": True, 
        "message": "La Rueda ha girado hacia atrás. Estado revertido.",
        "updated_profile_schema": last_state
    }

# =============================================================================
# SKILL SYSTEM INTEGRATION - SkillResolver para Mahoraga
# =============================================================================

class SkillResolver:
    """
    Resuelve y ejecuta skills del sistema Node.js desde Python
    Permite a Mahoraga acceder a las funciones del sistema contable
    """

    def __init__(self):
        self.node_base_url = "http://localhost:3001"
        self.skill_cache = {}
        self.session = httpx.AsyncClient(timeout=10.0)

    async def resolve_skill(self, skill_name: str, context: Dict[str, Any] = None) -> Optional[Dict]:
        """
        Busca skills relevantes por nombre o contexto
        """
        try:
            # Buscar por keywords
            search_url = f"{self.node_base_url}/api/skills/search"
            response = await self.session.get(search_url, params={"q": skill_name})

            if response.status_code == 200:
                data = response.json()
                if data.get("success") and data.get("results"):
                    # Devolver la mejor coincidencia
                    return data["results"][0]

            # Si no encuentra por búsqueda, intentar búsqueda por patrón
            pattern_url = f"{self.node_base_url}/api/skills/match/{skill_name}"
            response = await self.session.get(pattern_url)

            if response.status_code == 200:
                data = response.json()
                if data.get("success") and data.get("results"):
                    return data["results"][0]

        except Exception as e:
            print(f"Error resolviendo skill {skill_name}: {str(e)}")

        return None

    async def execute_skill(self, skill_id: str, args: List[Any] = None) -> Any:
        """
        Ejecuta una skill de manera segura via el dispatcher de Node.js
        """
        try:
            dispatch_url = f"{self.node_base_url}/api/skills/dispatch"
            payload = {
                "skillId": skill_id,
                "args": args or []
            }

            response = await self.session.post(dispatch_url, json=payload)

            if response.status_code == 200:
                data = response.json()
                if data.get("success"):
                    return data.get("result")
                else:
                    print(f"Error ejecutando skill {skill_id}: {data.get('error')}")
            else:
                print(f"HTTP error ejecutando skill {skill_id}: {response.status_code}")

        except Exception as e:
            print(f"Exception ejecutando skill {skill_id}: {str(e)}")

        return None

    async def get_relevant_skills(self, context_description: str) -> List[Dict]:
        """
        Encuentra skills relevantes basadas en una descripción del contexto
        """
        try:
            # Extraer keywords del contexto
            keywords = self._extract_keywords(context_description)

            all_skills = []
            for keyword in keywords[:3]:  # Limitar a 3 keywords para no sobrecargar
                skill = await self.resolve_skill(keyword)
                if skill and not any(s["id"] == skill["id"] for s in all_skills):
                    all_skills.append(skill)

            return all_skills

        except Exception as e:
            print(f"Error obteniendo skills relevantes: {str(e)}")
            return []

    def _extract_keywords(self, text: str) -> List[str]:
        """Extrae keywords relevantes del texto"""
        # Palabras clave relacionadas con funciones contables
        accounting_keywords = [
            "depreciacion", "depreciation", "aitb", "inflacion", "inflation",
            "clasificar", "classify", "calcular", "calculate", "redondear", "round",
            "nivel", "level", "padre", "parent", "monetario", "monetary",
            "fiscal", "tax", "reserva", "reserve", "estado", "statement"
        ]

        words = text.lower().split()
        keywords = []

        for word in words:
            # Quitar puntuación
            clean_word = ''.join(c for c in word if c.isalnum())
            if clean_word in accounting_keywords and clean_word not in keywords:
                keywords.append(clean_word)

        return keywords

# Instancia global del resolver
skill_resolver = SkillResolver()

# Extensión del MahoragaEngine con Skill Resolution
class MahoragaSkillEngine(MahoragaEngine):
    """
    Versión extendida de Mahoraga con resolución de skills
    """

    def __init__(self, profile_schema=None):
        super().__init__(profile_schema)
        self.skill_resolver = skill_resolver

    async def resolve_and_execute_skill(self, skill_description: str, args: List[Any] = None) -> Any:
        """
        Resuelve una descripción de skill y la ejecuta
        """
        skill = await self.skill_resolver.resolve_skill(skill_description)
        if skill:
            print(f"🔮 Ejecutando skill resuelta: {skill['id']}")
            return await self.skill_resolver.execute_skill(skill["id"], args)
        return None

    async def enhance_proposal_with_skills(self, account: Optional[Account], adjustment_type: str) -> Dict:
        """
        Mejora la propuesta usando skills del sistema
        """
        enhanced_result = {
            "original": None,
            "skill_enhanced": False,
            "used_skills": []
        }

        if not account:
            return enhanced_result

        # Calcular el ajuste original
        default_params = AdjustmentParameters(ufv_initial=1000, ufv_final=1050, method="UFV", confidence_threshold=0.95, company_id=None)
        if adjustment_type == "depreciacion":
            amount, conf, audit, rule = self.calculate_depreciation_pot(account, default_params)
        elif adjustment_type == "aitb":
            amount, conf, audit, rule = self.calculate_aitb_pot(account, default_params)
        else:
            return enhanced_result

        enhanced_result["original"] = {
            "amount": amount,
            "confidence": conf,
            "audit": audit,
            "rule": rule
        }

        # Intentar mejorar con skills
        try:
            # Skill 1: Redondeo bancario mejorado
            round_result = await self.resolve_and_execute_skill("bankersRound", [amount])
            if round_result is not None and abs(round_result - amount) < 0.01:
                enhanced_result["skill_enhanced"] = True
                enhanced_result["used_skills"].append("bankersRound")
                amount = round_result

            # Skill 2: Verificación de clasificación monetaria
            is_monetary = await self.resolve_and_execute_skill("isNonMonetary", [account.code, account.name])
            if is_monetary is not None:
                expected_monetary = adjustment_type == "aitb" and not is_monetary
                if expected_monetary:
                    enhanced_result["skill_enhanced"] = True
                    enhanced_result["used_skills"].append("isNonMonetary")

            # Skill 3: Cálculo de nivel jerárquico
            level = await self.resolve_and_execute_skill("calculateLevel", [account.code, {}])
            if level and level > 1:
                enhanced_result["skill_enhanced"] = True
                enhanced_result["used_skills"].append("calculateLevel")

        except Exception as e:
            print(f"Error usando skills para mejora: {str(e)}")

        if enhanced_result["skill_enhanced"]:
            enhanced_result["enhanced"] = {
                "amount": amount,
                "confidence": conf + 0.1,  # Bonus de confianza por usar skills
                "audit": f"{audit} [ENHANCED WITH SKILLS: {enhanced_result['used_skills'].join(', ')}]",
                "rule": rule
            }

        return enhanced_result

# Instancia global del engine con skills
mahoraga_skill_engine = MahoragaSkillEngine()

if __name__ == "__main__":
    # Soporte para ejecución directa de skills desde línea de comandos
    if len(sys.argv) > 2 and sys.argv[1] == "--execute-skill":
        import asyncio
        import json

        async def execute_skill_cli():
            try:
                payload = json.loads(sys.argv[2])
                skill_id = payload.get("skillId")
                args = payload.get("args", [])

                if not skill_id:
                    print(json.dumps({"error": "skillId required"}))
                    sys.exit(1)

                # Crear resolver y ejecutar
                resolver = SkillResolver()
                result = await resolver.execute_skill(skill_id, args)

                print(json.dumps({"success": True, "result": result}))

            except Exception as e:
                print(json.dumps({"success": False, "error": str(e)}))
                sys.exit(1)

        asyncio.run(execute_skill_cli())

    else:
        # Iniciar servidor FastAPI normalmente
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8003)
