import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import API_URL from '../api';
import DatePicker from 'react-datepicker';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import { useCompany } from '../context/CompanyContext';
import { getFiscalYearDetails } from '../utils/fiscalYearUtils';
import { ARS_CONTEXT_PROFILE } from '../utils/adjustmentProfilesV3';
import { getUFVValue, getExchangeRateValue } from '../utils/ufvUtils';
import aiAdjustmentService from '../services/aiAdjustmentService';
import MahoragaWheel from '../components/MahoragaWheel';

// Rule of rounding to the nearest even (Banker's Rounding)
// Avoids cumulative bias in financial systems.
const bankersRound = (num, decimalPlaces = 2) => {
    const m = Math.pow(10, decimalPlaces);
    const n = +(num * m).toFixed(8);
    const i = Math.floor(n);
    const f = n - i;
    const e = 1e-8;
    let r;
    if (f > 0.5 - e && f < 0.5 + e) {
        r = (i % 2 === 0) ? i : i + 1;
    } else {
        r = Math.round(n);
    }
    return r / m;
};

// MahoragaWheel is now imported from ../components/MahoragaWheel

export default function AdjustmentWizard({ onClose, onSuccess }) {
    const { selectedCompany } = useCompany();
    const [step, setStep] = useState(1);
    const [gestion, setGestion] = useState(new Date().getFullYear() - 1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [proposal, setProposal] = useState(null);
    const [adjustmentProfile, setAdjustmentProfile] = useState(ARS_CONTEXT_PROFILE);

    // New Date Selection States
    const [startDate, setStartDate] = useState(null);
    const [endDate, setEndDate] = useState(null);

    const [exchangeRates, setExchangeRates] = useState({
        ufv_initial: '',
        ufv_final: '',
        tc_initial: '',
        tc_final: ''
    });
    const [ufvData, setUfvData] = useState({
        startUFV: null,
        endUFV: null,
        availableDates: []
    });
    const [loadingUFV, setLoadingUFV] = useState(false);
    const [aiEngineStatus, setAiEngineStatus] = useState('checking'); // checking, available, unavailable
    const [useAI, setUseAI] = useState(true); // Preferencia del usuario
    const [useTrajectoryMode, setUseTrajectoryMode] = useState(true); // V8.0 AoT: Cálculo por trayectoria de movimientos
    const [adaptationToast, setAdaptationToast] = useState(null);
    const [showConfirmRollback, setShowConfirmRollback] = useState(false);
    const [showChronology, setShowChronology] = useState(false);
    const [chronology, setChronology] = useState([]);
    const [provenanceInfo, setProvenanceInfo] = useState(null);
    const [showProvenance, setShowProvenance] = useState(false);
    const [patternSuggestion, setPatternSuggestion] = useState(null);
    const [wheelSpinning, setWheelSpinning] = useState(false); // For Mahoraga animation during adaptation
    const [availableAccounts, setAvailableAccounts] = useState([]); // For dropdown editing

    useEffect(() => {
        const fetchAccounts = async () => {
            if (!selectedCompany?.id) return;
            try {
                // V6.7 FIX: Usar Plan de Cuentas completo (no solo ledger) para permitir elegir cuentas sin saldo
                const res = await axios.get(`${API_URL}/api/accounts`, {
                    params: { companyId: selectedCompany.id }
                });
                if (res.data.data) {
                    setAvailableAccounts(res.data.data);
                }
            } catch (err) {
                console.error("Error fetching accounts for autocomplete:", err);
            }
        };
        fetchAccounts();
    }, [selectedCompany]);

    const fiscalYearDetails = useMemo(() => {
        if (!selectedCompany) return null;
        return getFiscalYearDetails(selectedCompany.activity_type, gestion, selectedCompany.operation_start_date);
    }, [selectedCompany, gestion]);

    const fetchRatesForDate = async (dateStr, type) => {
        if (!selectedCompany) return;
        try {
            const ufv = await getUFVValue(dateStr, selectedCompany.id);
            const tc = await getExchangeRateValue(dateStr, selectedCompany.id);

            setExchangeRates(prev => ({
                ...prev,
                [`ufv_${type}`]: ufv || '',
                [`tc_${type}`]: tc || ''
            }));
        } catch (err) {
            console.error(`Error fetching rates for ${type}:`, err);
        }
    };

    useEffect(() => {
        if (selectedCompany) {
            loadInitialProfile();
        }
    }, [selectedCompany]);

    const loadInitialProfile = async () => {
        try {
            const response = await axios.get(`${API_URL}/api/ai/profile/${selectedCompany.id}`);

            if (response.data.success && response.data.profile_json) {
                setAdjustmentProfile(response.data.profile_json);
                console.log('✅ Perfil de IA específico de la empresa cargado.');
            } else {
                setAdjustmentProfile(ARS_CONTEXT_PROFILE);
                console.log('ℹ️ No se encontró perfil de IA para la empresa, usando perfil por defecto.');
            }
        } catch (e) {
            console.warn('No se pudo cargar perfil persistente, usando default.', e.message);
            setAdjustmentProfile(ARS_CONTEXT_PROFILE);
        }
    };

    // Auto-initialize dates and rates when fiscal year details change
    useEffect(() => {
        if (selectedCompany && fiscalYearDetails) {
            const start = parseISO(fiscalYearDetails.startDate);
            const end = parseISO(fiscalYearDetails.endDate);
            setStartDate(start);
            setEndDate(end);

            fetchRatesForDate(fiscalYearDetails.startDate, 'initial');
            fetchRatesForDate(fiscalYearDetails.endDate, 'final');
        }
    }, [selectedCompany, fiscalYearDetails]);

    useEffect(() => {
        checkAIAvailability();
    }, []);

    const checkAIAvailability = async () => {
        setAiEngineStatus('checking');
        const isAvailable = await aiAdjustmentService.healthCheck();
        setAiEngineStatus(isAvailable ? 'available' : 'unavailable');
    };

    const handleDateChange = (date, type) => {
        if (type === 'start') {
            setStartDate(date);
            fetchRatesForDate(format(date, 'yyyy-MM-dd'), 'initial');
        } else {
            setEndDate(date);
            fetchRatesForDate(format(date, 'yyyy-MM-dd'), 'final');
        }
    };

    const handleGenerateProposal = async () => {
        setLoading(true);
        setError('');
        try {
            const params = {
                companyId: selectedCompany.id,
                gestion,
                exchangeRate_initial: exchangeRates.ufv_initial || 0,
                exchangeRate_final: exchangeRates.ufv_final || 0,
                tc_initial: exchangeRates.tc_initial || 0,
                tc_final: exchangeRates.tc_final || 0,
                // El health-check es informativo; no bloquear intento AI por falla transitoria.
                useAI,
                // V8.0 AoT: Habilitar cálculo por trayectoria de movimientos
                use_trajectory_mode: useTrajectoryMode,
                // V8.2: Enviar fechas fiscales para trayectoria
                fiscal_start_date: startDate ? format(startDate, 'yyyy-MM-dd') : null,
                fiscal_end_date: endDate ? format(endDate, 'yyyy-MM-dd') : null
            };

            const result = await aiAdjustmentService.proposeAdjustments(params, adjustmentProfile);
            console.log('DEBUG: proposeAdjustments result:', result); // Debug log
            if (result.success) {
                setProposal(result); // The result IS the proposal (not result.data)
                setStep(2);
            } else {
                setError(result.error || 'El motor AI no generó ajustes.');
            }
        } catch (err) {
            console.error('Error generando propuesta:', err);
            setError(err.response?.data?.error || 'Error al generar la propuesta de ajustes.');
        } finally {
            setLoading(false);
        }
    };

    // --- NUEVO: Step 1.5 - Gestión de Fechas de Adquisición de Activos ---
    const [fixedAssets, setFixedAssets] = useState([]);
    const [acquisitionDates, setAcquisitionDates] = useState({}); // { accountCode: 'YYYY-MM-DD' }
    const [loadingAssets, setLoadingAssets] = useState(false);

    // Identificar activos fijos usando heurística simple (luego la AI lo hace mejor, pero esto es pre-filtro)
    const detectFixedAssets = () => {
        // Filtramos cuentas que parecen activos fijos para pedir sus fechas
        const candidates = availableAccounts.filter(acc => {
            const name = acc.name.toLowerCase();
            return (
                (name.includes('edificio') ||
                    name.includes('mueble') ||
                    name.includes('vehic') ||
                    name.includes('maquin') ||
                    name.includes('comput') ||
                    name.includes('equip')) &&
                !name.includes('acumulada') // Ignorar depreciación acumulada
            );
        });

        // Cargar fechas existentes
        const datesMap = {};
        candidates.forEach(c => {
            if (c.acquisition_date) {
                datesMap[c.code] = c.acquisition_date;
            }
        });

        setFixedAssets(candidates);
        setAcquisitionDates(datesMap);
        setStep(1.5); // Ir al paso intermedio
    };

    const handleAcquisitionDateChange = (code, date) => {
        setAcquisitionDates(prev => ({
            ...prev,
            [code]: formatDateISO(date)
        }));
    };

    // Helper para formato YYYY-MM-DD
    const formatDateISO = (date) => {
        if (!date) return null;
        return format(date, 'yyyy-MM-dd');
    };

    const handleSaveAcquisitionsAndGenerate = async () => {
        setLoading(true);
        // 1. Guardar fechas en BD
        try {
            const updates = Object.entries(acquisitionDates).map(([code, date]) => ({
                accountCode: code,
                acquisitionDate: date,
                companyId: selectedCompany.id
            }));

            if (updates.length > 0) {
                await axios.patch(`${API_URL}/api/accounts/acquisition-dates`, { acquisitions: updates });
            }

            // 2. Generar propuesta (ahora enviando las fechas al motor)
            const params = {
                companyId: selectedCompany.id,
                gestion,
                exchangeRate_initial: exchangeRates.ufv_initial || 0, // Legacy support if not using trajectory
                exchangeRate_final: exchangeRates.ufv_final || 0,
                tc_initial: exchangeRates.tc_initial || 0,
                tc_final: exchangeRates.tc_final || 0,
                // El health-check es informativo; no bloquear intento AI por falla transitoria.
                useAI,
                // V7.0: Enviar fechas para prorrateo
                acquisition_dates: acquisitionDates,
                fiscal_end_date: format(endDate, 'yyyy-MM-dd'),
                // V8.0 AoT: Habilitar cálculo por trayectoria de movimientos
                use_trajectory_mode: useTrajectoryMode,
                // V8.2: Enviar fecha de inicio para trayectoria
                fiscal_start_date: format(startDate, 'yyyy-MM-dd')
            };

            const result = await aiAdjustmentService.proposeAdjustments(params, adjustmentProfile);

            if (result.success) {
                setProposal(result);
                setStep(2);
            } else {
                setError(result.error || 'El motor AI no generó ajustes.');
            }

        } catch (err) {
            console.error(err);
            setError("Error al procesar fechas de activos: " + err.message);
        } finally {
            setLoading(false);
        }
    };
    // ---------------------------------------------------------------------


    const handleConfirmAndSave = async () => {
        setLoading(true);
        try {
            const response = await aiAdjustmentService.confirmAdjustments({
                companyId: selectedCompany.id,
                gestion,
                transactions: proposal.proposedTransactions,
                batchId: proposal.batchId,
                endDate: format(endDate, 'yyyy-MM-dd')
            });

            if (response.success) {
                onSuccess && onSuccess(response.message);
                onClose();
            }
        } catch (err) {
            console.error('Error al guardar ajustes:', err);
            setError(err.response?.data?.error || 'Error al guardar los ajustes.');
        } finally {
            setLoading(false);
        }
    };

    const handleEntryChange = (transIndex, entryIndex, field, value) => {
        const newProposal = { ...proposal };
        const trans = newProposal.proposedTransactions[transIndex];
        const entry = trans.entries[entryIndex];

        if (field === 'account_name' || field === 'accountName') {
            entry.accountName = value;
            entry.account_name = value; // Sync both keys
            // Find matching account to update code
            const match = availableAccounts.find(a => a.name === value);
            if (match) {
                entry.accountId = match.code;
                entry.accountCode = match.code;
                entry.account_code = match.code;
            }
        } else if (field === 'gloss') {
            entry.gloss = value;
        } else {
            entry[field] = value; // Keep as string for input, convert on submit if needed
        }
        setProposal(newProposal);
    };

    const handleAddEntry = (transIndex) => {
        const newProposal = { ...proposal };
        newProposal.proposedTransactions[transIndex].entries.push({
            accountId: null,
            account_name: '',
            debit: 0,
            credit: 0
        });
        setProposal(newProposal);
    };

    const handleRemoveEntry = (transIndex, entryIndex) => {
        const newProposal = { ...proposal };
        newProposal.proposedTransactions[transIndex].entries.splice(entryIndex, 1);
        setProposal(newProposal);
    };

    const handleAdaptation = async (type, trans) => {
        setLoading(true);
        setWheelSpinning(true); // Start wheel animation
        try {
            // Buscar la entrada con monto (puede ser accountId o account_code)
            const entry = trans.entries.find(e => e.debit > 0 || e.credit > 0);
            const accountCode = entry?.accountId || entry?.account_code || '';
            const accountName = entry?.accountName || entry?.account_name || '';

            const res = await aiAdjustmentService.adaptMahoraga({
                companyId: selectedCompany.id,
                accountCode,
                accountName,
                action: type === 'NM' ? 'FORZAR_NO_MONETARIO' : 'FORZAR_MONETARIO',
                origin_trans: trans.gloss
            });

            if (res.success) {
                // ⚡ V6.0: TRANSPARENCIA COGNITIVA - Mostrar regex y detalles
                const adaptationDetails = res.updated_profile_schema?.adaptation_events?.slice(-1)[0] || {};
                const patternInfo = res.message?.match(/Patrón regex insertado: (\/[^/]+\/i)/)?.[1] || 'patrón aprendido';

                setAdaptationToast({
                    message: `⚡ RUEDA GIRADA: ${res.message}`,
                    warnings: res.warnings,
                    description: `La cuenta "${accountName}" ha sido reclasificada como ${type === 'NM' ? 'No Monetaria (AITB aplicable)' : 'Monetaria (sin AITB)'}. La rueda gira y aprende.`,
                    // V6.0: Detalles técnicos para transparencia
                    technicalDetails: {
                        pattern: patternInfo,
                        eventId: adaptationDetails.id,
                        confidenceWeight: 5.0,
                        phase: 'Tekiō Fase 2'
                    }
                });

                // ⚡ V6.0: CRÍTICO - Actualizar el perfil local ANTES de regenerar propuesta
                // Esto asegura que la próxima llamada use las reglas recién aprendidas
                const updatedProfile = res.updated_profile_schema;
                setAdjustmentProfile(updatedProfile);

                // Regenerar propuesta CON EL PERFIL ACTUALIZADO (Fase 1: Corrección de Persistencia)
                const retryParams = {
                    companyId: selectedCompany.id,
                    gestion,
                    exchangeRate_initial: exchangeRates.ufv_initial,
                    exchangeRate_final: exchangeRates.ufv_final,
                    tc_initial: exchangeRates.tc_initial,
                    tc_final: exchangeRates.tc_final,
                    useAI: true
                };

                // V6.0: Pasar el perfil actualizado explícitamente
                const newProposal = await aiAdjustmentService.proposeAdjustments(retryParams, updatedProfile);
                if (newProposal.success || newProposal.proposedTransactions?.length > 0) {
                    setProposal(newProposal);
                }
            } else {
                setError(res.error || 'No se pudo aplicar la adaptación.');
            }
        } catch (err) {
            console.error('Error en adaptación:', err);
            setError(err.response?.data?.error || err.message || 'Error en la adaptación.');
        } finally {
            setLoading(false);
            // Keep wheel spinning for 2 more seconds after completion for visual effect
            setTimeout(() => setWheelSpinning(false), 2000);
            setTimeout(() => setAdaptationToast(null), 12000); // Más tiempo para leer detalles
        }
    };

    const handleShowChronology = async () => {
        try {
            const response = await aiAdjustmentService.getChronology(selectedCompany.id);
            if (response.success) {
                setChronology(response.events);
                setShowChronology(true);
            }
        } catch (err) {
            alert('No se pudo cargar la cronología.');
        }
    };

    const renderWheelIcon = (rule, trans) => {
        const isSCL = rule?.source_nc?.includes('Adaptation');
        const isMahoragaSCL = rule?.source_nc?.includes('Mahoraga-SCL-Adaptation');

        // 🎨 Indicadores visuales V6.0
        const iconClass = isMahoragaSCL ? 'bi-stars text-warning' : (isSCL ? 'bi-robot text-warning' : 'bi-robot text-secondary');
        const badgeText = isMahoragaSCL ? 'SCL' : (isSCL ? 'Adapt' : 'Base');
        const badgeColor = isMahoragaSCL ? 'badge-warning' : (isSCL ? 'badge-info' : 'badge-secondary');

        return (
            <div className="d-flex align-items-center gap-1">
                <div
                    className="cursor-pointer d-inline-block"
                    onClick={() => {
                        setProvenanceInfo({
                            account_name: trans.entries[0]?.account_name,
                            user: rule?.provenance?.user || rule?.user || 'Sistema',
                            origin_trans: rule?.provenance?.origin_trans || rule?.origin_trans || 'Automático',
                            timestamp: rule?.provenance?.timestamp || rule?.timestamp || new Date().toISOString(),
                            source_nc: rule?.source_nc || 'Predeterminado',
                            confidence_weight: rule?.confidence_weight || 1.0,
                            provenance: rule?.provenance || {}
                        });
                        setShowProvenance(true);
                    }}
                    title={`${isMahoragaSCL ? 'Regla aprendida por Mahoraga SCL' : isSCL ? 'Regla adaptada' : 'Regla base del sistema'} - Click para ver procedencia`}
                >
                    <i className={`bi ${iconClass} fs-5`}></i>
                </div>
                <span className={`badge ${badgeColor} badge-sm`} style={{ fontSize: '0.65rem' }}>
                    {badgeText}
                </span>
            </div>
        );
    };

    const handleRollback = async () => {
        setLoading(true);
        try {
            const result = await aiAdjustmentService.rollbackAdaptation();
            if (result.success) {
                setAdjustmentProfile(result.updated_profile_schema);
                setShowConfirmRollback(false);
                handleGenerateProposal();
            }
        } catch (err) {
            setError('No se pudo revertir la adaptación.');
        } finally {
            setLoading(false);
        }
    };

    const totalBatchDebit = useMemo(() => {
        if (!proposal) return 0;
        return proposal.proposedTransactions.reduce((total, trans) =>
            total + trans.entries.reduce((sub, entry) => sub + (entry.debit || 0), 0), 0);
    }, [proposal]);

    const totalBatchCredit = useMemo(() => {
        if (!proposal) return 0;
        return proposal.proposedTransactions.reduce((total, trans) =>
            total + trans.entries.reduce((sub, entry) => sub + (entry.credit || 0), 0), 0);
    }, [proposal]);

    const isBalanced = Math.abs(totalBatchDebit - totalBatchCredit) < 0.01;

    return (
        <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-xl modal-dialog-centered">
                <div className="modal-content glass-panel border-secondary shadow-lg">
                    <div className="modal-header border-secondary" style={{ backgroundColor: 'transparent' }}>
                        <h5 className="modal-title d-flex align-items-center text-white">
                            <i className="bi bi-gear-wide-connected me-2"></i>
                            Asistente de Ajustes
                        </h5>
                        <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
                    </div>
                    <div className="modal-body p-4" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
                        {error && <div className="alert alert-danger mb-4">{error}</div>}

                        {step === 1 && (
                            <div className="text-center py-4">
                                <div className="mb-4">
                                    <label className="form-label h5 mb-3 text-white">Definir Período de Ajuste</label>
                                    <div className="d-flex justify-content-center gap-4 mb-4">
                                        <div className="text-start">
                                            <label className="form-label small text-white-50">Fecha Apertura</label>
                                            <DatePicker
                                                selected={startDate}
                                                onChange={(date) => handleDateChange(date, 'start')}
                                                className="form-control form-control-lg text-center bg-dark text-white border-secondary"
                                                dateFormat="dd/MM/yyyy"
                                                locale={es}
                                                popperProps={{ strategy: 'fixed' }}
                                            />
                                        </div>
                                        <div className="text-start">
                                            <label className="form-label small text-white-50">Fecha Cierre</label>
                                            <DatePicker
                                                selected={endDate}
                                                onChange={(date) => handleDateChange(date, 'end')}
                                                className="form-control form-control-lg text-center bg-dark text-white border-secondary"
                                                dateFormat="dd/MM/yyyy"
                                                locale={es}
                                                popperProps={{ strategy: 'fixed' }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="card border-0 bg-dark mb-4 shadow-sm mx-auto" style={{ maxWidth: '600px' }}>
                                    <div className="card-body">
                                        {/* V8.0 AoT: Trajectory Mode Toggle */}
                                        <div className="d-flex justify-content-between align-items-center mb-3">
                                            <h6 className="card-title text-white-50 mb-0">Tasas de Cambio e Indicadores</h6>
                                            <div className="form-check form-switch">
                                                <input
                                                    className="form-check-input"
                                                    type="checkbox"
                                                    id="trajectoryModeSwitch"
                                                    checked={useTrajectoryMode}
                                                    onChange={(e) => setUseTrajectoryMode(e.target.checked)}
                                                />
                                                <label className="form-check-label small text-primary fw-bold" htmlFor="trajectoryModeSwitch">
                                                    <i className="bi bi-graph-up me-1"></i>Modo Trayectoria
                                                </label>
                                            </div>
                                        </div>

                                        {/* Info banner for trajectory mode */}
                                        {useTrajectoryMode && (
                                            <div className="alert alert-success border-success bg-dark text-success py-2 mb-3 small" style={{ backgroundColor: 'rgba(25, 135, 84, 0.1) !important' }}>
                                                <i className="bi bi-lightning-charge-fill me-1"></i>
                                                <strong>AoT Activo:</strong> Cada movimiento se ajustará con su UFV de fecha correspondiente.
                                            </div>
                                        )}

                                        <div className="row g-3">
                                            {/* UFV Indicators */}
                                            <div className="col-md-6 border-end border-secondary">
                                                {/* UFV Inicial - hidden in trajectory mode */}
                                                {!useTrajectoryMode && (
                                                    <>
                                                        <label className="form-label small fw-bold text-success">UFV Inicial</label>
                                                        <input
                                                            type="number" step="0.00001" className="form-control text-center bg-dark text-white border-secondary"
                                                            value={exchangeRates.ufv_initial}
                                                            onChange={(e) => setExchangeRates({ ...exchangeRates, ufv_initial: e.target.value })}
                                                        />
                                                    </>
                                                )}
                                                <label className={`form-label small fw-bold text-success ${useTrajectoryMode ? '' : 'mt-2'}`}>UFV Final (Cierre)</label>
                                                <input
                                                    type="number" step="0.00001" className="form-control text-center bg-dark text-white border-secondary"
                                                    value={exchangeRates.ufv_final}
                                                    onChange={(e) => setExchangeRates({ ...exchangeRates, ufv_final: e.target.value })}
                                                />
                                            </div>
                                            {/* TC Indicators */}
                                            <div className="col-md-6">
                                                {/* TC Inicial - hidden in trajectory mode */}
                                                {!useTrajectoryMode && (
                                                    <>
                                                        <label className="form-label small fw-bold text-primary">T/C Inicial (Venta)</label>
                                                        <input
                                                            type="number" step="0.01" className="form-control text-center bg-dark text-white border-secondary"
                                                            value={exchangeRates.tc_initial}
                                                            onChange={(e) => setExchangeRates({ ...exchangeRates, tc_initial: e.target.value })}
                                                        />
                                                    </>
                                                )}
                                                <label className={`form-label small fw-bold text-primary ${useTrajectoryMode ? '' : 'mt-2'}`}>T/C Final (Cierre)</label>
                                                <input
                                                    type="number" step="0.01" className="form-control text-center bg-dark text-white border-secondary"
                                                    value={exchangeRates.tc_final}
                                                    onChange={(e) => setExchangeRates({ ...exchangeRates, tc_final: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="mt-3 small text-white-50 border-top border-secondary pt-2">
                                            <i className="bi bi-info-circle me-1"></i>
                                            {useTrajectoryMode
                                                ? 'Modo Trayectoria: Solo necesitas UFV/TC de cierre. Las fechas intermedias se obtienen automáticamente.'
                                                : 'Valores obtenidos automáticamente de Tablas UFV y Tipo de Cambio'}
                                        </div>
                                    </div>
                                </div>

                                <div className="alert border-info d-flex align-items-center" style={{ backgroundColor: 'rgba(13, 202, 240, 0.1)', color: '#0dcaf0' }}>
                                    <h6 className="alert-heading mb-0 me-3">
                                        <i className="bi bi-robot me-2"></i>Ajustes a Procesar:
                                    </h6>
                                    <div className="d-flex justify-content-center gap-3">
                                        <span className="badge rounded-pill bg-dark text-white shadow-sm px-3 py-2 border border-secondary">Depreciación</span>
                                        <span className="badge rounded-pill bg-dark text-white shadow-sm px-3 py-2 border border-secondary">Actualización AITB</span>
                                        <span className="badge rounded-pill bg-dark text-white shadow-sm px-3 py-2 border border-secondary">Provisiones</span>
                                    </div>
                                </div>

                                <div className="mb-4">
                                    <div className="form-check form-switch d-inline-block">
                                        <input
                                            className="form-check-input"
                                            type="checkbox"
                                            id="useAI"
                                            checked={useAI}
                                            onChange={(e) => setUseAI(e.target.checked)}
                                        />
                                        <label className="form-check-label text-white h6 ms-2" htmlFor="useAI">
                                            Activar Smart Engine
                                        </label>
                                    </div>
                                    <div className="mt-2">
                                        {aiEngineStatus === 'checking' && (
                                            <div className="text-info small fade-in">
                                                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                                Despertando motor AI (este primer arranque puede tardar 50-60s)...
                                            </div>
                                        )}
                                        {aiEngineStatus === 'available' && (
                                            <div className="text-success small fade-in">
                                                <i className="bi bi-check-circle-fill me-2"></i>
                                                Motor IA listo y optimizado
                                            </div>
                                        )}
                                        {aiEngineStatus === 'unavailable' && (
                                            <div className="text-warning small fade-in">
                                                <i className="bi bi-exclamation-triangle-fill me-2"></i>
                                                Motor IA fuera de línea - usando modo contingencia
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="d-flex justify-content-between align-items-center">
                                    <button className="btn btn-outline-secondary" onClick={onClose}>Cancelar</button>
                                    <button
                                        className="btn btn-primary btn-lg px-5 shadow"
                                        onClick={detectFixedAssets}
                                        disabled={loading || !startDate || !endDate}
                                    >
                                        {loading ? <span className="spinner-border spinner-border-sm me-2"></span> : <i className="bi bi-arrow-right-circle me-2"></i>}
                                        Siguiente: Revisar Activos
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 1.5 && (
                            <div className="fixed-asset-step fade-in">
                                <div className="alert border-info d-flex align-items-center" style={{ backgroundColor: 'rgba(13, 202, 240, 0.1)', color: '#0dcaf0' }}>
                                    <div className="me-3 fs-3"><i className="bi bi-calendar-check"></i></div>
                                    <div>
                                        <h6 className="alert-heading text-info fw-bold mb-1">
                                            Fechas de Adquisición de Activos Fijos
                                        </h6>
                                        <p className="mb-0 small text-white-50">
                                            Para calcular correctamente la depreciación (prorrateo de meses), verifica la fecha de adquisición de los activos detectados.
                                        </p>
                                    </div>
                                </div>

                                <div className="table-responsive mb-3 border border-secondary rounded glass-panel" style={{ maxHeight: '400px' }}>
                                    <table className="table table-sm table-dark table-hover align-middle mb-0" style={{ backgroundColor: 'transparent' }}>
                                        <thead style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }} className="sticky-top">
                                            <tr>
                                                <th className="text-white-50 border-secondary">Código</th>
                                                <th className="text-white-50 border-secondary">Activo Fijo</th>
                                                <th className="text-white-50 border-secondary" style={{ width: '200px' }}>Fecha Adquisición</th>
                                                <th className="text-white-50 border-secondary">Cálculo</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {fixedAssets.length === 0 && (
                                                <tr>
                                                    <td colSpan="4" className="text-center py-5 text-white-50 border-secondary">
                                                        <i className="bi bi-search fs-4 d-block mb-2"></i>
                                                        No se detectaron activos fijos nuevos probables.
                                                    </td>
                                                </tr>
                                            )}
                                            {fixedAssets.map((asset) => {
                                                const dateVal = acquisitionDates[asset.code] ? parseISO(acquisitionDates[asset.code]) : null;
                                                let months = "12 (Año completo)";
                                                let isProrated = false;

                                                if (dateVal && endDate) {
                                                    if (dateVal > startDate) {
                                                        const m = (endDate.getFullYear() - dateVal.getFullYear()) * 12 + (endDate.getMonth() - dateVal.getMonth()) + 1;
                                                        if (m < 12 && m > 0) {
                                                            months = `${m} mes(es)`;
                                                            isProrated = true;
                                                        }
                                                    }
                                                }

                                                return (
                                                    <tr key={asset.code}>
                                                        <td className="text-white-50 border-secondary"><small>{asset.code}</small></td>
                                                        <td className="fw-bold text-white border-secondary">{asset.name}</td>
                                                        <td className="border-secondary">
                                                            <DatePicker
                                                                selected={dateVal}
                                                                onChange={(date) => handleAcquisitionDateChange(asset.code, date)}
                                                                className="form-control form-control-sm border-secondary bg-dark text-white"
                                                                dateFormat="dd/MM/yyyy"
                                                                placeholderText="Fecha de compra"
                                                                maxDate={endDate}
                                                                showYearDropdown
                                                                dropdownMode="select"
                                                            />
                                                        </td>
                                                        <td className="border-secondary">
                                                            <span className={`badge ${isProrated ? 'bg-warning text-dark border border-warning' : 'bg-success text-white'}`}>
                                                                {months}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="d-flex justify-content-between mt-4 pt-3 border-top">
                                    <button className="btn btn-outline-secondary" onClick={() => setStep(1)}>
                                        <i className="bi bi-arrow-left me-2"></i>Atrás
                                    </button>
                                    <button
                                        className="btn btn-primary px-4 shadow-sm"
                                        onClick={handleSaveAcquisitionsAndGenerate}
                                        disabled={loading}
                                    >
                                        {loading ? (
                                            <span><span className="spinner-border spinner-border-sm me-2"></span>Procesando...</span>
                                        ) : (
                                            <span><i className="bi bi-lightning-charge-fill me-2"></i>Generar Propuesta con IA</span>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 2 && proposal && (
                            <div>
                                <div className="alert border-info shadow-sm mb-4" style={{ backgroundColor: 'rgba(13, 202, 240, 0.1)', color: '#0dcaf0' }}>
                                    <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center">
                                        <div className="me-md-4 mb-3 mb-md-0 align-self-center p-2 rounded-circle shadow-sm" style={{ border: '3px solid #FFD700', backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                                            <MahoragaWheel size={80} spinning={loading || wheelSpinning} />
                                        </div>
                                        <div className="flex-grow-1">
                                            <h6 className="alert-heading fw-bold d-flex align-items-center text-info">
                                                <i className="bi bi-robot me-2"></i>
                                                Ajustes Generados
                                            </h6>
                                            <div className="row text-white">
                                                <div className="col-md-6 mb-2 mb-md-0">
                                                    <strong>Confianza:</strong> {((proposal.aggregate_confidence || proposal.confidence || 0) * 100).toFixed(1)}%<br />
                                                    <strong>Razonamiento:</strong> {proposal.reasoning || 'Procesamiento automático'}
                                                </div>
                                                <div className="col-md-6">
                                                    <strong>Período:</strong> {format(startDate, 'yyyy-MM-dd')} al {format(endDate, 'yyyy-MM-dd')}<br />
                                                    <small className="text-white-50">Generado: {proposal.processing_stats?.accounts_processed || 0} cuentas procesadas</small>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-md-end d-flex flex-row flex-wrap flex-md-column gap-2 mt-3 mt-md-0 ms-md-3">
                                            <button className="btn btn-warning btn-sm text-dark" onClick={handleShowChronology}>
                                                <i className="bi bi-clock-history me-1"></i>Cronología
                                            </button>
                                            <button className="btn btn-outline-light btn-sm" onClick={() => setShowConfirmRollback(true)}>
                                                <i className="bi bi-arrow-counterclockwise me-1"></i>Reset
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                {adaptationToast && (
                                    <div className="mt-3 p-2 bg-success text-white rounded shadow-sm animate__animated animate__fadeInUp">
                                        <i className="bi bi-stars me-2"></i> {adaptationToast.message}
                                    </div>
                                )}
                                <div className="table-responsive glass-panel rounded shadow-sm border border-secondary">
                                    <table className="table table-dark table-hover mb-0 align-middle" style={{ backgroundColor: 'transparent' }}>
                                        <thead style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                                            <tr>
                                                <th style={{ width: '40%' }} className="text-white-50 border-secondary">Descripción / Glosa</th>
                                                <th style={{ width: '30%' }} className="text-white-50 border-secondary">Cuenta Contable</th>
                                                <th style={{ width: '12%' }} className="text-end text-white-50 border-secondary">Debe</th>
                                                <th style={{ width: '12%' }} className="text-end text-white-50 border-secondary">Haber</th>
                                                <th style={{ width: '6%' }} className="text-center text-white-50 border-secondary">Acción</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {proposal.proposedTransactions.map((trans, transIndex) => (
                                                <React.Fragment key={transIndex}>
                                                    {trans.entries.map((entry, entryIndex) => (
                                                        <tr key={`${transIndex}-${entryIndex}`}>
                                                            {entryIndex === 0 && (
                                                                <td rowSpan={trans.entries.length} className="align-top border-secondary">
                                                                    <div className="mb-2">
                                                                        <textarea
                                                                            className="form-control form-control-sm border-0 bg-transparent fw-bold text-white"
                                                                            rows="2"
                                                                            value={trans.gloss}
                                                                            onChange={(e) => {
                                                                                const newProposal = { ...proposal };
                                                                                newProposal.proposedTransactions[transIndex].gloss = e.target.value;
                                                                                setProposal(newProposal);
                                                                            }}
                                                                        />
                                                                    </div>
                                                                    <div className="d-flex gap-1">
                                                                        <button className="btn btn-outline-info btn-xs py-0 px-1" onClick={() => handleAdaptation('NM', trans)} title="Forzar No Monetario">NM</button>
                                                                        <button className="btn btn-outline-light btn-xs py-0 px-1" onClick={() => handleAdaptation('MN', trans)} title="Forzar Monetario">MN</button>
                                                                        <button className="btn btn-link btn-xs p-0 text-success ms-auto" onClick={() => handleAddEntry(transIndex)}><i className="bi bi-plus-circle"></i></button>
                                                                    </div>
                                                                    {trans.audit_trail && (
                                                                        <div className="text-white-50 mt-2 border-top border-secondary pt-1" style={{ fontSize: '0.65rem', lineHeight: '1.2' }}>
                                                                            <i className="bi bi-diagram-3-fill me-1"></i>
                                                                            {trans.audit_trail}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                            )}
                                                            <td className="border-secondary">
                                                                <div className="d-flex align-items-center flex-grow-1">
                                                                    <div className="me-2">{entryIndex === 0 && renderWheelIcon(trans.applied_rule, trans)}</div>
                                                                    <div className="w-100">
                                                                        <small className="text-white-50 d-block">{entry.accountId || entry.accountCode || ''}</small>
                                                                        <input
                                                                            type="text"
                                                                            list={`accounts-list-${transIndex}-${entryIndex}`}
                                                                            className="form-control form-control-sm border-0 bg-transparent p-0 fw-bold text-white"
                                                                            value={entry.accountName || entry.account_name || ''}
                                                                            placeholder="Buscar cuenta..."
                                                                            onChange={(e) => handleEntryChange(transIndex, entryIndex, 'account_name', e.target.value)}
                                                                            style={{ minWidth: '150px' }}
                                                                        />
                                                                        <datalist id={`accounts-list-${transIndex}-${entryIndex}`}>
                                                                            {availableAccounts.map(acc => (
                                                                                <option key={acc.id} value={acc.name}>{acc.code}</option>
                                                                            ))}
                                                                        </datalist>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="p-0 border-secondary">
                                                                <input
                                                                    type="number" step="0.01"
                                                                    className="form-control form-control-sm border-0 bg-transparent text-end text-white"
                                                                    value={entry.debit ? bankersRound(parseFloat(entry.debit), 2).toFixed(2) : ''}
                                                                    onChange={(e) => handleEntryChange(transIndex, entryIndex, 'debit', e.target.value)}
                                                                />
                                                            </td>
                                                            <td className="p-0 border-secondary">
                                                                <input
                                                                    type="number" step="0.01"
                                                                    className="form-control form-control-sm border-0 bg-transparent text-end text-white"
                                                                    value={entry.credit ? bankersRound(parseFloat(entry.credit), 2).toFixed(2) : ''}
                                                                    onChange={(e) => handleEntryChange(transIndex, entryIndex, 'credit', e.target.value)}
                                                                />
                                                            </td>
                                                            <td className="text-center border-secondary">
                                                                <button className="btn btn-link btn-sm text-danger p-0" onClick={() => handleRemoveEntry(transIndex, entryIndex)}><i className="bi bi-trash"></i></button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </React.Fragment>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="d-flex justify-content-between mt-4">
                                    <button className="btn btn-secondary btn-lg" onClick={() => setStep(1)} disabled={loading}>Volver</button>
                                    <button className="btn btn-success btn-lg px-5 shadow" onClick={handleConfirmAndSave} disabled={loading || !isBalanced}>
                                        {loading ? <span className="spinner-border spinner-border-sm me-2"></span> : <i className="bi bi-check-circle me-2"></i>}
                                        Confirmar y Guardar Ajustes
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Modal de Cronología V6.0 - Audit Trail Fidelity */}
            {showChronology && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 }}>
                    <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                        <div className="modal-content glass-panel border-secondary shadow">
                            <div className="modal-header border-secondary text-white" style={{ backgroundColor: 'transparent' }}>
                                <h6 className="modal-title d-flex align-items-center">
                                    <MahoragaWheel size={28} spinning={false} color="#FFD700" />
                                    <span className="ms-2">⚡ CRONOLOGÍA DE ADAPTACIONES (Mahoraga V6.0)</span>
                                </h6>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowChronology(false)}></button>
                            </div>
                            <div className="modal-body p-0" style={{ maxHeight: '60vh' }}>
                                {chronology.length === 0 ? (
                                    <div className="text-center py-5 text-white-50">
                                        <i className="bi bi-inbox fs-1"></i>
                                        <p className="mt-2 text-white">No hay adaptaciones registradas aún.</p>
                                        <small>Usa los botones NM/MN para entrenar a Mahoraga.</small>
                                    </div>
                                ) : (
                                    <div className="list-group list-group-flush bg-transparent">
                                        {chronology.map((event, idx) => (
                                            <div key={event.id || idx} className="list-group-item py-3 bg-transparent text-white border-secondary">
                                                <div className="d-flex justify-content-between align-items-start">
                                                    <div>
                                                        <h6 className="mb-1 fw-bold text-white">
                                                            <i className="bi bi-gear-fill text-warning me-2"></i>
                                                            {event.action || 'Adaptación'}
                                                        </h6>
                                                        <p className="mb-1 text-white-50 small">
                                                            <strong>Cuenta:</strong> {event.account_name} ({event.account_code})
                                                        </p>
                                                        {event.error_reason_tag && (
                                                            <span className="badge bg-info me-2">
                                                                <i className="bi bi-tag me-1"></i>
                                                                {event.error_reason_tag}
                                                            </span>
                                                        )}
                                                        {event.user_comment && (
                                                            <p className="mb-0 mt-2 small fst-italic border-start border-3 border-warning ps-2 text-white-50">
                                                                "{event.user_comment}"
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="text-end">
                                                        <small className="text-white-50 d-block">
                                                            {event.timestamp ? new Date(event.timestamp).toLocaleString() : '-'}
                                                        </small>
                                                        <small className="text-white-50">
                                                            <i className="bi bi-person me-1"></i>
                                                            {event.user || 'Sistema'}
                                                        </small>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer bg-light">
                                <small className="text-muted me-auto">
                                    <i className="bi bi-database me-1"></i>
                                    {chronology.length} eventos registrados
                                </small>
                                <button className="btn btn-secondary btn-sm" onClick={() => setShowChronology(false)}>
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Provenance V6.0 - Transparencia Cognitiva */}
            {showProvenance && provenanceInfo && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 2000 }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content glass-panel border-secondary shadow">
                            <div className="modal-header border-secondary text-white" style={{ background: 'linear-gradient(135deg, rgba(26, 26, 46, 0.8) 0%, rgba(22, 33, 62, 0.8) 100%)' }}>
                                <h6 className="modal-title font-monospace d-flex align-items-center text-white">
                                    <MahoragaWheel size={24} spinning={false} color="#FFD700" />
                                    <span className="ms-2">⚡ RAZONAMIENTO V6.0</span>
                                </h6>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowProvenance(false)}></button>
                            </div>
                            <div className="modal-body text-white">
                                <div className="mb-3 p-2 bg-dark border border-secondary rounded">
                                    <strong className="d-block mb-1 text-white">📊 Cuenta Analizada:</strong>
                                    <span className="font-monospace text-white-50">{provenanceInfo.account_name}</span>
                                </div>
                                <div className="row g-2 mb-3">
                                    <div className="col-6">
                                        <div className="p-2 border border-secondary rounded h-100 bg-dark">
                                            <small className="text-white-50 d-block">Origen Transacción</small>
                                            <strong className="text-white">{provenanceInfo.provenance?.origin_trans || provenanceInfo.origin_trans || 'Automático'}</strong>
                                        </div>
                                    </div>
                                    <div className="col-6">
                                        <div className="p-2 border border-secondary rounded h-100 bg-dark">
                                            <small className="text-white-50 d-block">Usuario</small>
                                            <strong className="text-white">{provenanceInfo.provenance?.user || provenanceInfo.user || 'Sistema'}</strong>
                                        </div>
                                    </div>
                                </div>
                                {/* V6.0: Información de confianza y peso */}
                                <div className="mb-3 p-2 border border-success rounded" style={{ backgroundColor: 'rgba(25, 135, 84, 0.1)' }}>
                                    <strong className="d-block mb-1 text-white">
                                        <i className="bi bi-shield-check text-success me-1"></i>
                                        Confianza de la Regla:
                                    </strong>
                                    <div className="d-flex align-items-center">
                                        <span className="badge bg-success text-white me-2">
                                            Peso: {provenanceInfo.confidence_weight || 1.0}
                                        </span>
                                        <small className="text-white-50">
                                            {provenanceInfo.confidence_weight >= 2.0 ? 'Alta prioridad' : 'Prioridad normal'}
                                        </small>
                                    </div>
                                </div>
                                {provenanceInfo.provenance?.error_tag && (
                                    <div className="mb-3 p-2 border border-warning rounded" style={{ backgroundColor: 'rgba(255, 193, 7, 0.1)' }}>
                                        <strong className="d-block mb-1 text-white">
                                            <i className="bi bi-exclamation-triangle text-warning me-1"></i>
                                            Razón de Corrección:
                                        </strong>
                                        <span className="badge bg-warning text-dark">{provenanceInfo.provenance.error_tag}</span>
                                    </div>
                                )}
                                {provenanceInfo.provenance?.reason && (
                                    <div className="mb-3 p-2 border border-info rounded" style={{ backgroundColor: 'rgba(13, 202, 240, 0.1)' }}>
                                        <strong className="d-block mb-1 text-white">
                                            <i className="bi bi-chat-quote text-info me-1"></i>
                                            Justificación:
                                        </strong>
                                        <em className="text-white-50">"{provenanceInfo.provenance.reason}"</em>
                                    </div>
                                )}

                                <div className="mb-3">
                                    <small className="text-white-50 d-block">Fecha de Evento</small>
                                    <strong className="text-white">{provenanceInfo.provenance?.timestamp || provenanceInfo.timestamp ? new Date(provenanceInfo.provenance?.timestamp || provenanceInfo.timestamp).toLocaleString() : '-'}</strong>
                                </div>
                                {/* V6.0: Event ID y trazabilidad */}
                                {provenanceInfo.provenance?.event_id && (
                                    <div className="mb-3 p-2 border border-secondary rounded" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                                        <strong className="d-block mb-1 text-white">
                                            <i className="bi bi-fingerprint text-white-50 me-1"></i>
                                            ID de Evento:
                                        </strong>
                                        <code className="small text-info">{provenanceInfo.provenance.event_id}</code>
                                    </div>
                                )}

                                <hr className="border-secondary" />
                                <div className="alert border-secondary small mb-0 text-white" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                                    <i className="bi bi-cpu me-1 text-white-50"></i>
                                    <strong>Fuente NC:</strong> {provenanceInfo.source_nc || 'Semántica Jerárquica'}
                                    <br />
                                    <small className="text-white-50">
                                        Lógica de clasificación inferida mediante el Motor Cognitivo
                                        (Tekiō: Adaptación en 3 Fases con Gobernanza Activa)
                                    </small>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Confirmación de Rollback */}
            {showConfirmRollback && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content glass-panel border-secondary shadow">
                            <div className="modal-header border-danger text-white" style={{ backgroundColor: 'transparent' }}>
                                <h6 className="modal-title text-danger">
                                    <i className="bi bi-arrow-counterclockwise me-2"></i>
                                    Revertir Adaptaciones
                                </h6>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowConfirmRollback(false)}></button>
                            </div>
                            <div className="modal-body text-center py-4 text-white">
                                <MahoragaWheel size={60} spinning={false} color="#dc3545" />
                                <p className="mt-3">
                                    ¿Estás seguro de querer revertir la última adaptación?
                                    <br />
                                    <small className="text-white-50">La rueda girará hacia atrás y se perderá el aprendizaje más reciente.</small>
                                </p>
                            </div>
                            <div className="modal-footer border-secondary">
                                <button className="btn btn-outline-secondary text-white" onClick={() => setShowConfirmRollback(false)}>Cancelar</button>
                                <button className="btn btn-danger" onClick={handleRollback} disabled={loading}>
                                    {loading ? <span className="spinner-border spinner-border-sm me-2"></span> : <i className="bi bi-arrow-counterclockwise me-2"></i>}
                                    Confirmar Reset
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
