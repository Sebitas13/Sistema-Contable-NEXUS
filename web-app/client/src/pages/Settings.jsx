import React, { useState } from 'react';
import axios from 'axios';
import { useCompany } from '../context/CompanyContext';
import BackupManager from '../components/BackupManager';
import API_URL from '../api';

// Default ARS Profile
const ARS_CONTEXT_PROFILE = {
    active_pages: ['Journal', 'Ledger', 'FinancialStatements'], // Default active pages
    data_retrieval_config: {},
    reasoning_config: { confidence_threshold: 0.75 },
    depreciation_settings: { assets_life: [] },
    aitb_settings: {},
    correction_history: { entries: [] }
};

const DEFAULT_LEARNING_STATUS = {
    success: true,
    readiness: 0,
    learning_progress: {
        percentage: 0,
        current_phase: 'Genesis contable',
        next_milestone: 'Crear Plan de Cuentas',
        details: 'Mahoraga aun no tiene suficiente actividad para medir madurez.',
        stats: {
            accounts: 0,
            operations: 0,
            adaptations: 0,
            hasClosing: false
        }
    }
};

// Initial Depreciation Table from CSV
const INITIAL_DEPRECIATION_RULES = [
    { asset_type_keyword: "Edificaciones", useful_life_years: 40, annual_rate: 0.025 },
    { asset_type_keyword: "Muebles y enseres", useful_life_years: 10, annual_rate: 0.10 },
    { asset_type_keyword: "Maquinaria en general", useful_life_years: 8, annual_rate: 0.125 },
    { asset_type_keyword: "Equipos e instalaciones", useful_life_years: 8, annual_rate: 0.125 },
    { asset_type_keyword: "Barcos y lanchas en general", useful_life_years: 10, annual_rate: 0.10 },
    { asset_type_keyword: "Vehiculos automotores", useful_life_years: 5, annual_rate: 0.20 },
    { asset_type_keyword: "Aviones", useful_life_years: 5, annual_rate: 0.20 },
    { asset_type_keyword: "Maquinaria para la construcciÃ³n", useful_life_years: 5, annual_rate: 0.20 },
    { asset_type_keyword: "Maquinaria agrÃ­cola", useful_life_years: 4, annual_rate: 0.25 },
    { asset_type_keyword: "Animales de trabajo", useful_life_years: 4, annual_rate: 0.25 },
    { asset_type_keyword: "Herramientas en general", useful_life_years: 4, annual_rate: 0.25 },
    { asset_type_keyword: "Reproductores y hembras de pedigree o puros por cruza", useful_life_years: 8, annual_rate: 0.125 },
    { asset_type_keyword: "Equipos de computacion", useful_life_years: 4, annual_rate: 0.25 },
    { asset_type_keyword: "Canales de regadÃ­o y pozos", useful_life_years: 20, annual_rate: 0.05 },
    { asset_type_keyword: "Estanques, baÃ±aderos y abrevaderos", useful_life_years: 10, annual_rate: 0.10 },
    { asset_type_keyword: "Alambrados, tranqueras y vallas", useful_life_years: 10, annual_rate: 0.10 },
    { asset_type_keyword: "Viviendas para el personal", useful_life_years: 20, annual_rate: 0.05 },
    { asset_type_keyword: "Muebles y enseres en las viviendas para el personal", useful_life_years: 10, annual_rate: 0.10 },
    { asset_type_keyword: "Silos, almacenes y galpones", useful_life_years: 20, annual_rate: 0.05 },
    { asset_type_keyword: "Tinglados y cobertizos de madera", useful_life_years: 5, annual_rate: 0.20 },
    { asset_type_keyword: "Tinglados y cobertizos de metal", useful_life_years: 10, annual_rate: 0.10 },
    { asset_type_keyword: "Instalaciones de electrificaciÃ³n y telefonÃ­a rurales", useful_life_years: 10, annual_rate: 0.10 },
    { asset_type_keyword: "Caminos interiores", useful_life_years: 10, annual_rate: 0.10 },
    { asset_type_keyword: "CaÃ±a de azÃºcar", useful_life_years: 5, annual_rate: 0.20 },
    { asset_type_keyword: "Vides", useful_life_years: 8, annual_rate: 0.125 },
    { asset_type_keyword: "Frutales", useful_life_years: 10, annual_rate: 0.10 },
    { asset_type_keyword: "Otras plantaciones (segÃºn experiencia del contribuyente)", useful_life_years: 0, annual_rate: 0.00 },
    { asset_type_keyword: "Pozos Petroleros", useful_life_years: 5, annual_rate: 0.20 },
    { asset_type_keyword: "LÃ­neas de RecolecciÃ³n de la industria petrolera", useful_life_years: 5, annual_rate: 0.20 },
    { asset_type_keyword: "Equipos de campo de la industria petrolera", useful_life_years: 8, annual_rate: 0.125 },
    { asset_type_keyword: "Plantas de Procesamiento de la industria petrolera", useful_life_years: 8, annual_rate: 0.125 },
    { asset_type_keyword: "Ductos de la industria petrolera", useful_life_years: 10, annual_rate: 0.10 }
];

export default function Settings() {
    const { selectedCompany, refreshCompanies } = useCompany();
    const [activeTab, setActiveTab] = useState('data'); // 'data', 'profiles', 'mahoraga'
    const [healing, setHealing] = useState(false);
    const [healResult, setHealResult] = useState(null);
    const [diagnosticResult, setDiagnosticResult] = useState(null);
    const { companies } = useCompany();

    // Mahoraga State
    const [mahoragaStatus, setMahoragaStatus] = useState(null);
    const [learningStatus, setLearningStatus] = useState(null);
    const [maturity, setMaturity] = useState(null);
    const [loadingMahoraga, setLoadingMahoraga] = useState(false);
    const [loadingSkills, setLoadingSkills] = useState(false);
    const [monitorStats, setMonitorStats] = useState(null);
    const [companyProfile, setCompanyProfile] = useState(null);
    const [insights, setInsights] = useState([]);
    const [skillStats, setSkillStats] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [selectedMode, setSelectedMode] = useState('');
    const [modeChangeReason, setModeChangeReason] = useState('');
    const [activePages, setActivePages] = useState([...ARS_CONTEXT_PROFILE.active_pages]);
    const [savingConfig, setSavingConfig] = useState(false);
    const [showModeChange, setShowModeChange] = useState(false);

    // Profile Management State
    const [editingProfile, setEditingProfile] = useState(null);
    const [showCloneModal, setShowCloneModal] = useState(null);
    const [targetCompanyId, setTargetCompanyId] = useState('');
    const [depreciationRules, setDepreciationRules] = useState(INITIAL_DEPRECIATION_RULES);

    const getProfiles = () => {
        const profiles = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('struct_profile_')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    // Refresh companies to get latest data including new columns
                    const company = companies.find(c => String(c.id) === String(data.companyId));
                    profiles.push({
                        key,
                        id: data.id,
                        name: data.name || `Perfil #${data.id}`,
                        companyId: data.companyId,
                        config: data.config,
                        companyName: company?.name || (data.companyId === 'global' ? 'ðŸŒ Plantilla Global' : `Empresa ID: ${data.companyId}`)
                    });
                } catch (e) { console.error("Error parsing profile", key); }
            }
        }
        return profiles.sort((a, b) => a.id - b.id);
    };

    const getNextProfileId = () => {
        const profiles = getProfiles();
        if (profiles.length === 0) return 1;
        return Math.max(...profiles.map(p => p.id)) + 1;
    };

    const deleteProfile = (key, name) => {
        if (window.confirm(`Â¿EstÃ¡s seguro de eliminar el perfil "${name}"?`)) {
            localStorage.removeItem(key);
            setEditingProfile(null);
        }
    };

    const saveProfileEdit = () => {
        if (!editingProfile) return;
        const profileData = {
            id: editingProfile.id,
            name: editingProfile.name,
            companyId: editingProfile.companyId,
            config: editingProfile.config
        };
        localStorage.setItem(editingProfile.key, JSON.stringify(profileData));
        setEditingProfile(null);
        alert('Perfil actualizado correctamente.');
    };

    const cloneProfile = (sourceProfile) => {
        const nextId = getNextProfileId();
        const newId = nextId;
        const newKey = `struct_profile_${newId}`;
        const targetCompany = targetCompanyId || sourceProfile.companyId;

        const newProfileData = {
            id: newId,
            name: `${sourceProfile.name} (Copia ${newId})`,
            companyId: targetCompany,
            config: JSON.parse(JSON.stringify(sourceProfile.config))
        };

        localStorage.setItem(newKey, JSON.stringify(newProfileData));
        setShowCloneModal(null);
        setTargetCompanyId('');
        alert(`Perfil #${newId} creado exitosamente.`);
    };

    const loadInitialProfile = async () => {
        try {
            const response = await axios.get(`${API_URL}/api/ai/profile/${selectedCompany.id}`);

            if (response.data.success && response.data.profile_json) {
                setCompanyProfile(response.data.profile_json);
                console.log('âœ… Perfil de IA especÃ­fico de la empresa cargado.');
            } else {
                setCompanyProfile(ARS_CONTEXT_PROFILE); // Fallback
                console.log('â„¹ï¸ No se encontrÃ³ perfil de IA para la empresa, usando perfil por defecto.');
            }
        } catch (e) {
            console.warn('No se pudo cargar perfil persistente, usando default.', e.message);
            setCompanyProfile(ARS_CONTEXT_PROFILE);
        }
    };

    // Load profile on mount and refresh companies data
    React.useEffect(() => {
        if (selectedCompany) {
            loadInitialProfile();
            // Refresh companies to get latest data including new columns
            refreshCompanies();
        }
    }, [selectedCompany]);

    // Sync depreciation rules when company profile loads
    // Always use INITIAL_DEPRECIATION_RULES as base (full CSV data)
    // Only use saved profile if it has substantial data (more than default 3 items)
    React.useEffect(() => {
        const savedRules = companyProfile?.depreciation_settings?.assets_life;
        if (savedRules && savedRules.length > 10) {
            // User has customized their rules, use the saved version
            setDepreciationRules(savedRules);
        } else {
            // Use the full CSV data
            setDepreciationRules(INITIAL_DEPRECIATION_RULES);
        }
    }, [companyProfile]);

    const handleDepreciationChange = (index, field, value) => {
        const newRules = [...depreciationRules];
        newRules[index] = { ...newRules[index], [field]: value };

        // Auto-calculate rate if years change
        if (field === 'useful_life_years') {
            const years = parseFloat(value);
            if (years > 0) {
                newRules[index].annual_rate = 1 / years;
            }
        }

        setDepreciationRules(newRules);
    };

    const handleAddDepreciationRule = () => {
        setDepreciationRules([...depreciationRules, { asset_type_keyword: "Nuevo Activo", useful_life_years: 10, annual_rate: 0.10 }]);
    };

    const handleRemoveDepreciationRule = (index) => {
        const newRules = depreciationRules.filter((_, i) => i !== index);
        setDepreciationRules(newRules);
    };

    const saveDepreciationConfig = async () => {
        if (!selectedCompany) return;
        setSavingConfig(true);
        try {
            // Update or create profile with new settings
            const updatedProfile = {
                ...(companyProfile || {}),
                depreciation_settings: {
                    ...(companyProfile?.depreciation_settings || {}),
                    assets_life: depreciationRules
                }
            };

            await axios.post(`${API_URL}/api/ai/profile/${selectedCompany.id}`, { profile_json: updatedProfile });
            setCompanyProfile(updatedProfile); // Optimistic update
            alert('Configuración de depreciación guardada correctamente.');
        } catch (error) {
            console.error("Error saving depreciation config:", error);
            alert('Error al guardar configuracion.');
        } finally {
            setSavingConfig(false);
        }
    };

    const checkStatus = async () => {
        if (!selectedCompany) return;
        setHealResult(null);
        setDiagnosticResult(null);

        try {
            const response = await axios.get(`${API_URL}/api/accounts?companyId=${selectedCompany.id}`);
            const accounts = response.data.data;

            const total = accounts.length;
            const withParent = accounts.filter(a => a.parent_code).length;
            const withoutParent = accounts.filter(a => !a.parent_code && a.level > 1).length;

            setDiagnosticResult({
                total,
                withParent,
                withoutParent,
                status: withoutParent > 0 ? 'critical' : 'healthy'
            });

        } catch (error) {
            console.error('Error checking status:', error);
        }
    };

    const handleHealHierarchy = async () => {
        if (!selectedCompany) return;
        setHealing(true);
        setHealResult(null);

        try {
            // 1. Fetch all accounts
            const response = await axios.get(`${API_URL}/api/accounts?companyId=${selectedCompany.id}`);
            const accounts = response.data.data;

            if (!accounts || accounts.length === 0) {
                setHealResult({ type: 'warning', message: 'No hay cuentas para procesar.' });
                setHealing(false);
                return;
            }

            // 2. Calculate hierarchy locally
            const updates = AccountPlanProfile.calculateHierarchy(accounts);

            if (updates.length === 0) {
                setHealResult({ type: 'success', message: 'La jerarquÃ­a ya estÃ¡ correcta. No se requieren cambios.' });
                setHealing(false);
                setDiagnosticResult(prev => ({ ...prev, status: 'healthy', withoutParent: 0 }));
                return;
            }

            // 3. Send updates to backend
            await axios.patch(`${API_URL}/api/accounts/batch-parents`, {
                companyId: selectedCompany.id,
                updates: updates.map(u => ({ id: u.id, parent_code: u.parent_code }))
            });

            setHealResult({
                type: 'success',
                message: `Jerarquía regenerada con Éxito. Se actualizaron ${updates.length} cuentas.`
            });

            // Refresh diagnostic
            checkStatus();

        } catch (error) {
            console.error('Error healing hierarchy:', error);
            // Log full error details
            if (error.response) {
                console.error('Response data:', error.response.data);
                console.error('Response status:', error.response.status);
            }
            setHealResult({ type: 'danger', message: 'Error al actualizar: ' + error.message });
        } finally {
            setHealing(false);
        }
    };

    // --- Mahoraga Logic ---
    const refreshMahoragaData = async () => {
        if (!selectedCompany) return;
        setLoadingMahoraga(true);
        try {
            await Promise.all([
                fetchMahoragaStatus(),
                fetchLearningStatus(),
                fetchMaturity(),
                fetchMonitorData(),
                fetchCompanyProfile(),
                fetchInsights(),
                fetchSkillHealth(),
                fetchPageConfig()
            ]);
        } finally {
            setLoadingMahoraga(false);
        }
    };

    const fetchPageConfig = async () => {
        if (!selectedCompany) return;
        try {
            const response = await axios.get(`${API_URL}/api/ai/mahoraga/config/${selectedCompany.id}`);
            if (response.data.success) {
                let pages = response.data.active_pages;
                // Safe parsing if it comes as string
                if (typeof pages === 'string') {
                    try { pages = JSON.parse(pages); } catch (e) { pages = []; }
                }
                setActivePages(Array.isArray(pages) && pages.length > 0 ? pages : [...ARS_CONTEXT_PROFILE.active_pages]);
            }
        } catch (error) {
            console.error("Error fetching page config:", error);
            setActivePages([...ARS_CONTEXT_PROFILE.active_pages]);
        }
    };

    const togglePage = async (pageId) => {
        const newPages = activePages.includes(pageId)
            ? activePages.filter(p => p !== pageId)
            : [...activePages, pageId];

        setActivePages(newPages);
        setSavingConfig(true);
        try {
            await axios.post(`${API_URL}/api/ai/mahoraga/config/${selectedCompany.id}`, { active_pages: newPages });
        } catch (error) {
            console.error("Error saving page config:", error);
            alert("Error al guardar configuración de páginas");
        } finally {
            setSavingConfig(false);
        }
    };

    const fetchInsights = async () => {
        try {
            const response = await axios.get(`${API_URL}/api/ai/mahoraga/insights?companyId=${selectedCompany.id}`);
            if (response.data.success) setInsights(response.data.insights);
        } catch (error) { console.error("Error fetching insights:", error); }
    };

    const fetchCompanyProfile = async () => {
        try {
            const response = await axios.get(`${API_URL}/api/ai/profile/${selectedCompany.id}`);
            if (response.data.success) setCompanyProfile(response.data.profile_json);
        } catch (error) { console.error("Error fetching company profile:", error); }
    };

    const fetchMonitorData = async () => {
        try {
            const [statsRes] = await Promise.all([axios.get(`${API_URL}/api/ai/monitor/stats`)]);
            setMonitorStats(statsRes.data);
        } catch (error) { console.error("Error fetching monitor data:", error); }
    };

    const fetchMahoragaStatus = async () => {
        if (!selectedCompany) return;
        try {
            const response = await axios.get(`${API_URL}/api/ai/mahoraga/status`);
            if (response.data && response.data.mahoraga) {
                setMahoragaStatus(response.data.mahoraga);
            }
        } catch (error) { console.error("Error fetching Mahoraga status:", error); }
    };

    const fetchSkillHealth = async () => {
        try {
            const response = await axios.get(`${API_URL}/api/ai/skills/health`);
            if (response.data.success) setSkillStats(response.data.stats);
            // Fetch initial skills after health stats
            if (searchResults.length === 0) {
                const skillsRes = await axios.get(`${API_URL}/api/ai/skills/search?limit=20`);
                if (skillsRes.data.success) setSearchResults(skillsRes.data.results);
            }
        } catch (error) { console.error("Error fetching skill health:", error); }
    };

    const fetchLearningStatus = async () => {
        if (!selectedCompany) return;
        try {
            const response = await axios.get(`${API_URL}/api/ai/recognition/status`, { params: { companyId: selectedCompany.id } });
            setLearningStatus(response.data?.success ? response.data : DEFAULT_LEARNING_STATUS);
        } catch (error) {
            console.error("Error fetching learning status:", error);
            setLearningStatus(DEFAULT_LEARNING_STATUS);
        }
    };

    // Madurez viva: fuente unica para la tarjeta de Gobernanza (fases, % real y Cognicion).
    const fetchMaturity = async () => {
        if (!selectedCompany) return;
        try {
            const response = await axios.get(`${API_URL}/api/ai/mahoraga/maturity/${selectedCompany.id}`);
            if (response.data?.success) setMaturity(response.data);
        } catch (error) {
            console.error("Error fetching maturity:", error);
            setMaturity(null);
        }
    };

    const handleModeChange = async () => {
        if (!selectedMode || !modeChangeReason.trim()) return alert('Selecciona un modo y proporciona una razÃ³n');
        try {
            await axios.post(`${API_URL}/api/ai/mahoraga/change-mode`, { newMode: selectedMode, userId: 'admin', reason: modeChangeReason });
            alert(`Modo cambiado exitosamente a ${selectedMode}`);
            setSelectedMode(''); setModeChangeReason(''); setShowModeChange(false);
            fetchMahoragaStatus();
        } catch (error) { alert('Error al cambiar modo: ' + error.response?.data?.error); }
    };

    const handleEmergencyStop = async () => {
        if (!confirm('¿Estás seguro de activar la PARADA DE EMERGENCIA? Esto detendrÃ¡ TODAS las operaciones de Mahoraga.')) return;
        try {
            await axios.post(`${API_URL}/api/ai/mahoraga/emergency-stop`, { userId: 'admin', reason: 'Emergency stop from dashboard' });
            alert('PARADA DE EMERGENCIA ACTIVADA');
            fetchMahoragaStatus();
        } catch (error) { alert('Error en parada de emergencia: ' + error.response?.data?.error); }
    };

    const handleSearch = async (e) => {
        const query = e ? e.target.value : searchQuery;
        setSearchQuery(query);

        if (query.length > 2 || query.length === 0) {
            setLoadingSkills(true);
            try {
                const response = await axios.get(`${API_URL}/api/ai/skills/search`, {
                    params: { q: query, limit: 20 }
                });
                if (response.data.success) setSearchResults(response.data.results);
            } catch (error) { console.error("Error searching skills:", error); }
            setLoadingSkills(false);
        }
    };

    React.useEffect(() => {
        if (activeTab === 'mahoraga' && selectedCompany) {
            refreshMahoragaData();
            // Initial search for skills when Mahoraga tab is active
            handleSearch(null);
        }
    }, [activeTab, selectedCompany]);
    // ... rest of the file is JSX and doesn't need to be changed
    // ... I will only replace the part of the file that is relevant
    return (
        <div className="container-fluid py-4">
            <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3 mb-4">
                <h2 className="mb-0"><i className="bi bi-gear me-2"></i>ConfiguraciÃ³n <span className="d-none d-sm-inline">del Sistema</span></h2>
                <div className="d-flex flex-wrap gap-2">
                    <button
                        className={`btn ${activeTab === 'data' ? 'btn-primary' : 'btn-outline-primary'}`}
                        onClick={() => setActiveTab('data')}
                    >
                        <i className="bi bi-tools me-1"></i>Mantenimiento
                    </button>
                    <button
                        className={`btn ${activeTab === 'profiles' ? 'btn-primary' : 'btn-outline-primary'}`}
                        onClick={() => setActiveTab('profiles')}
                    >
                        <i className="bi bi-journal-bookmark-fill me-1"></i>Perfiles
                    </button>
                    <button
                        className={`btn ${activeTab === 'mahoraga' ? 'btn-primary' : 'btn-outline-primary'}`}
                        onClick={() => setActiveTab('mahoraga')}
                    >
                        <i className="bi bi-cpu me-1"></i>Asistente IA
                    </button>
                </div>
            </div>

            {activeTab === 'data' && (
                <div className="row fade-in g-4">
                    <div className="col-md-10 mx-auto">
                        <BackupManager />
                    </div>

                    <div className="col-md-8 mx-auto">
                        <div className="card shadow-sm border-warning glass-panel">
                            <div className="card-header border-warning" style={{ backgroundColor: 'rgba(255, 193, 7, 0.1)', color: '#ffc107' }}>
                                <h5 className="mb-0"><i className="bi bi-tools me-2"></i>Mantenimiento de Datos</h5>
                            </div>
                            <div className="card-body">
                                <h6 className="text-white">Regenerar Jerarquía de Cuentas</h6>
                                <p className="text-white-50 small">
                                    Esta herramienta analiza los códigos de tus cuentas y reconstruye las relaciones
                                    padre-hijo (campo <code className="text-info">parent_code</code>). <br />
                                    <strong className="text-white">Uso recomendado:</strong> Si tus Estados Financieros aparecen vacÃ­os o desordenados.
                                </p>

                                <div className="d-grid gap-2 mb-3">
                                    <button className="btn btn-outline-primary" onClick={checkStatus}>
                                        <i className="bi bi-search me-2"></i>Verificar Integridad
                                    </button>
                                </div>

                                {diagnosticResult && (
                                    <div className={`alert alert-${diagnosticResult.status === 'healthy' ? 'success' : 'warning'} mb-3`}>
                                        <h6 className="alert-heading">Diagnóstico:</h6>
                                        <ul className="mb-0 small">
                                            <li>Total Cuentas: <strong>{diagnosticResult.total}</strong></li>
                                            <li>Con Padre Definido: <strong>{diagnosticResult.withParent}</strong></li>
                                            <li>Sin Padre (Huérfanas): <strong>{diagnosticResult.withoutParent}</strong></li>
                                        </ul>
                                        {diagnosticResult.status === 'critical' && (
                                            <div className="mt-2 text-danger fw-bold">
                                                Se requiere regeneración.
                                            </div>
                                        )}
                                    </div>
                                )}

                                {healResult && (
                                    <div className={`alert alert-${healResult.type} mb-3`}>
                                        {healResult.type === 'success' ? <i className="bi bi-check-circle me-2"></i> : <i className="bi bi-exclamation-triangle me-2"></i>}
                                        {healResult.message}
                                    </div>
                                )}

                                <button
                                    className="btn btn-warning w-100"
                                    onClick={handleHealHierarchy}
                                    disabled={healing || !selectedCompany || (diagnosticResult && diagnosticResult.status === 'healthy' && !healResult)}
                                >
                                    {healing ? (
                                        <span><span className="spinner-border spinner-border-sm me-2"></span>Procesando...</span>
                                    ) : (
                                        <span><i className="bi bi-diagram-3-fill me-2"></i>Regenerar Jerarquí­a</span>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="col-md-12 mt-4 mx-auto">
                        <div className="card shadow-sm border-primary glass-panel">
                            <div className="card-header border-primary d-flex justify-content-between align-items-center" style={{ backgroundColor: 'rgba(13, 110, 253, 0.1)' }}>
                                <h5 className="mb-0 text-primary"><i className="bi bi-table me-2"></i>Tabla de Depreciacion Configurable</h5>
                                <button className="btn btn-sm btn-outline-primary fw-bold text-white" onClick={saveDepreciationConfig} disabled={savingConfig}>
                                    {savingConfig ? <span className="spinner-border spinner-border-sm me-2"></span> : <i className="bi bi-save me-2"></i>}
                                    Guardar Cambios
                                </button>
                            </div>
                            <div className="card-body p-0">
                                <div className="table-responsive" style={{ maxHeight: '500px' }}>
                                    <table className="table table-sm table-dark table-hover mb-0 align-middle" style={{ backgroundColor: 'transparent' }}>
                                        <thead style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }} className="sticky-top">
                                            <tr>
                                                <th style={{ width: '40%' }} className="text-white-50 border-secondary">Bien / Activo (Palabra Clave)</th>
                                                <th style={{ width: '20%' }} className="text-white-50 border-secondary">Vida Ãštil (AÃ±os)</th>
                                                <th style={{ width: '20%' }} className="text-white-50 border-secondary">Coeficiente %</th>
                                                <th style={{ width: '20%' }} className="text-end text-white-50 border-secondary">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {depreciationRules.map((rule, idx) => (
                                                <tr key={idx}>
                                                    <td className="border-secondary">
                                                        <input
                                                            type="text"
                                                            className="form-control form-control-sm border-secondary bg-dark text-white fw-bold"
                                                            value={rule.asset_type_keyword}
                                                            onChange={(e) => handleDepreciationChange(idx, 'asset_type_keyword', e.target.value)}
                                                        />
                                                    </td>
                                                    <td className="border-secondary">
                                                        <input
                                                            type="number"
                                                            className="form-control form-control-sm border-secondary bg-dark text-white"
                                                            value={rule.useful_life_years}
                                                            onChange={(e) => handleDepreciationChange(idx, 'useful_life_years', e.target.value)}
                                                        />
                                                    </td>
                                                    <td className="border-secondary">
                                                        <div className="input-group input-group-sm">
                                                            <input
                                                                type="text"
                                                                className="form-control border-secondary bg-dark text-white text-end"
                                                                value={(rule.annual_rate * 100).toFixed(2)}
                                                                readOnly
                                                            />
                                                            <span className="input-group-text border-secondary bg-dark text-white-50">%</span>
                                                        </div>
                                                    </td>
                                                    <td className="text-end border-secondary">
                                                        <button className="btn btn-outline-danger btn-sm border-0" onClick={() => handleRemoveDepreciationRule(idx)}>
                                                            <i className="bi bi-trash"></i>
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div className="card-footer border-secondary" style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                                <button className="btn btn-outline-success btn-sm" onClick={handleAddDepreciationRule}>
                                    <i className="bi bi-plus-circle me-2"></i>Agregar Nuevo Activo
                                </button>
                                <small className="text-white-50 ms-3">
                                    <i className="bi bi-info-circle me-1"></i>
                                    El sistema buscará coincidencias inteligentes con estos nombres en tu Plan de Cuentas.
                                </small>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'profiles' && (
                <div className="row fade-in">
                    <div className="col-md-10 mx-auto">
                        <div className="card shadow-sm border-info h-100 glass-panel">
                            <div className="card-header border-info" style={{ backgroundColor: 'rgba(13, 202, 240, 0.1)', color: '#0dcaf0' }}>
                                <h5 className="mb-0"><i className="bi bi-journal-bookmark-fill me-2"></i>Biblioteca de Perfiles de Estructura</h5>
                            </div>
                            <div className="card-body">
                                <p className="text-white-50 small">
                                    Gestiona las configuraciones de niveles y longitudes de cuenta guardadas por empresa.
                                    Estos perfiles se usan en el Asistente de Importación Inteligente.
                                </p>

                                <div className="table-responsive" style={{ maxHeight: '450px' }}>
                                    <table className="table table-sm table-dark table-hover align-middle" style={{ backgroundColor: 'transparent' }}>
                                        <thead style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                                            <tr>
                                                <th className="text-white-50 border-secondary">Empresa</th>
                                                <th className="text-white-50 border-secondary">Configuración</th>
                                                <th className="text-end text-white-50 border-secondary">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {getProfiles().length === 0 ? (
                                                <tr><td colSpan="3" className="text-center py-3 text-white-50 border-secondary">No hay perfiles guardados.</td></tr>
                                            ) : (
                                                getProfiles().map(p => (
                                                    <tr key={p.key}>
                                                        <td className="border-secondary">
                                                            <div className="d-flex align-items-center gap-2">
                                                                <span className="badge bg-dark border border-info text-info">#{p.id}</span>
                                                                <div>
                                                                    <div className="fw-bold small text-white">{p.name}</div>
                                                                    <div className="text-white-50" style={{ fontSize: '0.65rem' }}>{p.companyName}</div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="border-secondary">
                                                            <div className="badge bg-dark text-white border border-secondary p-1" style={{ fontSize: '0.65rem' }}>
                                                                {p.config.levelCount} Niv. | {p.config.hasSeparator ? `Sep: ${p.config.separator}` : 'Fijo'}
                                                            </div>
                                                        </td>
                                                        <td className="text-end border-secondary">
                                                            <div className="btn-group btn-group-sm">
                                                                <button className="btn btn-outline-primary" title="Editar con Entrenador" onClick={() => setEditingProfile(p)}>
                                                                    <i className="bi bi-pencil-square"></i>
                                                                </button>
                                                                <button className="btn btn-outline-success" title="Clonar / Nueva VersiÃ³n" onClick={() => setShowCloneModal(p)}>
                                                                    <i className="bi bi-copy"></i>
                                                                </button>
                                                                <button className="btn btn-outline-danger" title="Eliminar" onClick={() => deleteProfile(p.key, p.name)}>
                                                                    <i className="bi bi-trash"></i>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'mahoraga' && (
                <div className="row g-4 fade-in">
                    {/* Tarjeta de Gobernanza Prominente - FIXED COLORS */}
                    <div className="col-12">
                        <div className="card shadow-lg border-0 overflow-hidden" style={{ background: '#0f172a', color: '#f8fafc' }}>
                            <div className="card-body p-4">
                                <div className="row align-items-center">
                                    <div className="col-md-8">
                                        <div className="d-flex align-items-center mb-3">
                                            <div className="rounded-circle p-2 me-3 shadow-lg" style={{ background: '#eab308', color: '#0f172a' }}>
                                                <i className="bi bi-shield-shaded fs-3"></i>
                                            </div>
                                            <div>
                                                <h4 className="fw-bold mb-0 text-uppercase tracking-wider" style={{ color: '#eab308' }}>Capa de Gobernanza Activa</h4>
                                                <small className="opacity-75">Garante de Integridad del Ciclo Contable</small>
                                            </div>
                                        </div>
                                        <p className="lead small opacity-90 mb-4">
                                            Mahoraga opera aqui como capa de gobernanza: observa actividad real, resume madurez,
                                            muestra insights contables y expone el catalogo tecnico disponible sin intervenir de forma invasiva.
                                        </p>
                                        <div className="row g-3">
                                            {[
                                                { id: 'GENESIS', label: 'GÃ‰NESIS', sub: 'Cimientos', threshold: 25 },
                                                { id: 'OPERACION', label: 'OPERACIÃ“N', sub: 'Hechos Reales', threshold: 50 },
                                                { id: 'RITUAL', label: 'RITUAL', sub: 'Ajustes/SCL', threshold: 75 },
                                                { id: 'REVELACION', label: 'REVELACIÃ“N', sub: 'Juicio Final', threshold: 100 }
                                            ].map(phase => (
                                                <div key={phase.id} className="col-6 col-md-3">
                                                    <div className={`p-2 rounded text-center border ${(maturity?.percentage ?? learningStatus?.learning_progress?.percentage) >= phase.threshold
                                                        ? 'border-warning' : 'border-secondary opacity-50'}`}
                                                        style={(maturity?.percentage ?? learningStatus?.learning_progress?.percentage) >= phase.threshold
                                                            ? { background: '#eab308', color: '#0f172a' }
                                                            : { background: '#1e293b', color: '#94a3b8' }}>
                                                        <div className="small fw-bold">{phase.label}</div>
                                                        <div className="text-xs">{phase.sub}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="col-md-4 text-center mt-4 mt-md-0 border-start border-secondary">
                                        <div className="display-4 fw-bold mb-0" style={{ color: '#eab308' }}>{maturity?.percentage ?? learningStatus?.learning_progress?.percentage ?? 0}%</div>
                                        <div className="small text-uppercase opacity-75 mb-3">Madurez de OrquestaciÃ³n</div>
                                        <div className="badge p-2 border border-secondary w-100" style={{ background: '#1e293b', color: '#eab308' }}>
                                            <i className="bi bi-flag-fill me-2"></i>
                                            {maturity?.next_milestone || learningStatus?.learning_progress?.next_milestone || 'Pendiente'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Controles de ActivaciÃ³n por PÃ¡gina */}
                    <div className="col-12">
                        <div className="card shadow-sm border-0 border-top border-4 border-primary glass-panel">
                            <div className="card-body">
                                <div className="d-flex justify-content-between align-items-center mb-3">
                                    <h5 className="mb-0 fw-bold text-white"><i className="bi bi-toggle-on me-2"></i>Central de ActivaciÃ³n</h5>
                                    {savingConfig && <span className="spinner-border spinner-border-sm text-primary"></span>}
                                </div>
                                <div className="row g-2">
                                    {[
                                        { id: 'Journal', name: 'Libro Diario', icon: 'bi-pencil-square' },
                                        { id: 'Accounts', name: 'Plan de Cuentas', icon: 'bi-journal-text' },
                                        { id: 'TrialBalance', name: 'Balance ComprobaciÃ³n', icon: 'bi-calculator' },
                                        { id: 'Ledger', name: 'Libro Mayor', icon: 'bi-book' },
                                        { id: 'UFV', name: 'Mantenimiento UFV', icon: 'bi-graph-up-arrow' },
                                        { id: 'ExchangeRate', name: 'Tipo de Cambio', icon: 'bi-currency-exchange' },
                                        { id: 'Worksheet', name: 'Hoja de Trabajo', icon: 'bi-file-earmark-spreadsheet' },
                                        { id: 'FinancialStatements', name: 'Estados Financieros', icon: 'bi-bank' }
                                    ].map(page => (
                                        <div key={page.id} className="col-md-3 col-6">
                                            <div
                                                className={`p-2 rounded border border-secondary d-flex align-items-center justify-content-between cursor-pointer transition-all ${activePages.includes(page.id) ? 'bg-primary bg-opacity-25 border-primary mt-1' : 'bg-dark hover-bg-secondary text-white-50'}`}
                                                onClick={() => togglePage(page.id)}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                <div className="d-flex align-items-center gap-2">
                                                    <i className={`bi ${page.icon} ${activePages.includes(page.id) ? 'text-primary' : 'text-white-50'}`}></i>
                                                    <span className={`small fw-semibold ${activePages.includes(page.id) ? 'text-white' : 'text-white-50'}`}>{page.name}</span>
                                                </div>
                                                <div className={`form-check form-switch mb-0`}>
                                                    <input
                                                        className="form-check-input"
                                                        type="checkbox"
                                                        checked={activePages.includes(page.id)}
                                                        onChange={() => { }}
                                                        style={{ cursor: 'pointer' }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-3 small text-white-50">
                                    <i className="bi bi-info-circle me-1"></i> Mahoraga solo mostrarÃ¡ su rueda y controles en las pÃ¡ginas seleccionadas.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Controles de Seguridad */}
                    <div className="col-md-4">
                        <div className="card shadow-sm h-100 border-0 overflow-hidden bg-dark text-white">
                            <div className="card-body">
                                <h6 className="opacity-75 mb-3 text-uppercase small ls-1">Seguridad & Modos</h6>
                                <h3 className="fw-bold mb-2 text-primary" style={{ color: '#3b82f6' }}>
                                    {mahoragaStatus?.currentMode?.toUpperCase() || 'OFFLINE'}
                                </h3>
                                <p className="small opacity-75 mb-4">
                                    Haz clic para gestionar los permisos de intervención de Mahoraga en el sistema.
                                </p>
                                <button className="btn btn-outline-light w-100 mb-2" onClick={() => setShowModeChange(true)}>
                                    <i className="bi bi-shield-lock me-2"></i>Cambiar Seguridad
                                </button>
                                <button className="btn btn-danger btn-sm w-100 opacity-75" onClick={handleEmergencyStop}>
                                    <i className="bi bi-stop-circle me-1"></i> Parada de Emergencia
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="col-md-4">
                        <div className="card shadow-sm h-100 border-secondary glass-panel" style={{ background: 'linear-gradient(135deg, rgba(240, 249, 255, 0.05) 0%, rgba(224, 242, 254, 0.05) 100%)' }}>
                            <div className="card-body">
                                <h6 className="text-primary text-uppercase small fw-bold mb-3">CogniciÃ³n (Reglas)</h6>
                                <h3 className="fw-bold mb-2 text-white">
                                    {maturity?.cognition?.total ?? ((companyProfile?.monetary_rules?.length || 0) + (companyProfile?.non_monetary_rules?.length || 0))}
                                </h3>
                                <p className="small text-white-50 mb-4">Patrones especÃ­ficos aprendidos de tus correcciones diarias.</p>
                                <div className="d-flex gap-2">
                                    <span className="badge bg-primary bg-opacity-75">{maturity?.cognition?.monetary_rules ?? (companyProfile?.monetary_rules?.length || 0)} Monetarias</span>
                                    <span className="badge bg-info text-dark bg-opacity-75">{maturity?.cognition?.non_monetary_rules ?? (companyProfile?.non_monetary_rules?.length || 0)} No Monetarias</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="col-md-4">
                        <div className="card shadow-sm h-100 border-secondary glass-panel">
                            <div className="card-body">
                                <h6 className="text-secondary text-uppercase small fw-bold mb-3">Monitor de API</h6>
                                <div className="d-flex justify-content-between mb-2">
                                    <span className="small text-white-50">Modelo:</span>
                                    <span className="small fw-bold text-white">{monitorStats?.current_model || 'Buscando...'}</span>
                                </div>
                                <div className="d-flex justify-content-between mb-2">
                                    <span className="small text-white-50">Uso Diario:</span>
                                    <div className="progress w-50 bg-dark border border-secondary" style={{ height: '6px', marginTop: '6px' }}>
                                        <div className="progress-bar bg-primary" style={{ width: `${monitorStats?.daily_usage_percent || 0}%` }}></div>
                                    </div>
                                </div>
                                <div className="d-flex justify-content-between">
                                    <span className="small text-white-50">Costo:</span>
                                    <span className="small fw-bold text-success">${monitorStats?.daily_cost || '0.00'}</span>
                                </div>
                                <hr className="border-secondary" />
                                <button className="btn btn-sm btn-outline-primary w-100" onClick={refreshMahoragaData}>
                                    <i className="bi bi-arrow-repeat me-1"></i> Sincronizar Ahora
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Catalogo Tecnico de Skills */}
                    <div className="col-12">
                        <div className="card shadow-sm border-secondary glass-panel">
                            <div className="card-header border-secondary d-flex justify-content-between align-items-center" style={{ backgroundColor: 'transparent' }}>
                                <h5 className="mb-0 fw-bold text-white"><i className="bi bi-cpu me-2 text-primary"></i>Catalogo Tecnico de Skills</h5>
                                <div className="input-group input-group-sm w-50">
                                    <span className="input-group-text bg-dark border-secondary text-white-50"><i className="bi bi-search"></i></span>
                                    <input
                                        type="text"
                                        className="form-control border-secondary bg-dark text-white"
                                        placeholder="Buscar por nombre, ID, archivo o tipo..."
                                        value={searchQuery}
                                        onChange={handleSearch}
                                    />
                                </div>
                            </div>
                            <div className="table-responsive" style={{ maxHeight: '400px' }}>
                                <table className="table table-dark table-hover align-middle mb-0" style={{ backgroundColor: 'transparent' }}>
                                    <thead style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }} className="sticky-top">
                                        <tr>
                                            <th className="text-white-50 border-secondary">Skill</th>
                                            <th className="text-white-50 border-secondary">Tipo</th>
                                            <th className="text-white-50 border-secondary">Archivo</th>
                                            <th className="text-white-50 border-secondary">Indice</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {searchResults.length > 0 ? (
                                            searchResults.map((res, i) => (
                                                <tr key={i}>
                                                    <td className="border-secondary">
                                                        <div className="d-flex flex-column">
                                                            <code className="text-primary fw-bold" style={{ fontSize: '0.85rem' }}>{res.skill?.name || res.skill?.id || 'Skill sin nombre'}</code>
                                                            <small className="text-white-50">{res.skill?.id || 'Sin ID'}</small>
                                                        </div>
                                                    </td>
                                                    <td className="border-secondary"><span className="badge border border-secondary text-white-50" style={{ background: '#1e293b' }}>{res.skill?.type || 'general'}</span></td>
                                                    <td className="border-secondary"><code className="text-info small">{res.skill?.file || 'Catalogo unificado'}</code></td>
                                                    <td className="border-secondary"><span className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25">Indexada</span></td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan="4" className="text-center py-5 border-secondary">
                                                    <span className="text-white-50">
                                                        {searchQuery.length > 2 ? 'No se encontraron skills que coincidan.' : 'Explora el catalogo tecnico indexado por Mahoraga.'}
                                                    </span>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            <div className="card-footer border-secondary" style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                                <small className="text-white-50">
                                    <i className="bi bi-database-check me-1"></i>
                                    Fuente unificada: <code className="text-info">{skillStats?.sourceFile || 'skillLoader'}</code>
                                    {' '}| Total indexado: <strong className="text-white">{skillStats?.totalSkills || 0}</strong>
                                </small>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modals Section */}
            {editingProfile && (
                <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
                    <div className="modal-dialog modal-lg modal-dialog-centered">
                        <div className="modal-content glass-panel border-primary shadow-lg">
                            <div className="modal-header border-primary" style={{ backgroundColor: 'rgba(13, 110, 253, 0.1)', color: '#0d6efd' }}>
                                <h5 className="modal-title text-primary"><i className="bi bi-cpu-fill me-2"></i>Entrenador de Perfil: <span className="text-white">{editingProfile.name}</span></h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setEditingProfile(null)}></button>
                            </div>
                            <div className="modal-body">
                                <div className="row g-3 mb-4">
                                    <div className="col-md-6">
                                        <label className="form-label small fw-bold text-white-50">Nombre del Perfil</label>
                                        <input type="text" className="form-control bg-dark text-white border-secondary" value={editingProfile.name}
                                            onChange={e => setEditingProfile({ ...editingProfile, name: e.target.value })} />
                                    </div>
                                    <div className="col-md-6">
                                        <label className="form-label small fw-bold text-white-50">Empresa Asignada</label>
                                        <select className="form-select bg-dark text-white border-secondary" value={editingProfile.companyId}
                                            onChange={e => setEditingProfile({ ...editingProfile, companyId: e.target.value })}>
                                            <option value="global">ðŸŒ Plantilla Global (Para todos)</option>
                                            {companies.map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="p-3 rounded border border-secondary shadow-sm" style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                                    <h6 className="border-bottom border-secondary pt-1 pb-2 mb-3 text-white"><i className="bi bi-sliders me-2"></i>ConfiguraciÃ³n de Estructura</h6>
                                    <div className="row g-3 align-items-end">
                                        <div className="col-md-3">
                                            <label className="form-label small fw-bold text-white-50">DetecciÃ³n</label>
                                            <div className="btn-group btn-group-sm w-100">
                                                <button className={`btn ${editingProfile.config.hasSeparator ? 'btn-primary' : 'btn-outline-primary text-white'}`}
                                                    onClick={() => setEditingProfile({ ...editingProfile, config: { ...editingProfile.config, hasSeparator: true } })}>Separador</button>
                                                <button className={`btn ${!editingProfile.config.hasSeparator ? 'btn-primary' : 'btn-outline-primary text-white'}`}
                                                    onClick={() => setEditingProfile({ ...editingProfile, config: { ...editingProfile.config, hasSeparator: false } })}>Longitud</button>
                                            </div>
                                        </div>
                                        <div className="col-md-3">
                                            <label className="form-label small fw-bold text-white-50">Niveles ({editingProfile.config.levelCount})</label>
                                            <div className="input-group input-group-sm">
                                                <button className="btn btn-outline-secondary text-white" type="button"
                                                    onClick={() => setEditingProfile(p => ({ ...p, config: { ...p.config, levelCount: Math.max(1, p.config.levelCount - 1) } }))}>
                                                    <i className="bi bi-dash"></i>
                                                </button>
                                                <input type="text" className="form-control text-center bg-dark text-white border-secondary" value={editingProfile.config.levelCount} readOnly />
                                                <button className="btn btn-outline-secondary text-white" type="button"
                                                    onClick={() => {
                                                        const currentCount = editingProfile.config.levelCount;
                                                        if (currentCount >= 10) return;
                                                        const newLens = [...editingProfile.config.levelLengths];
                                                        if (newLens[currentCount] === undefined || newLens[currentCount] === 0) {
                                                            const prev = newLens[currentCount - 1] || 0;
                                                            newLens[currentCount] = prev + 2;
                                                        }
                                                        setEditingProfile({
                                                            ...editingProfile,
                                                            config: { ...editingProfile.config, levelCount: currentCount + 1, levelLengths: newLens }
                                                        });
                                                    }}>
                                                    <i className="bi bi-plus"></i>
                                                </button>
                                            </div>
                                        </div>
                                        {editingProfile.config.hasSeparator && (
                                            <div className="col-md-2">
                                                <label className="form-label small fw-bold text-white-50">Separador</label>
                                                <input type="text" className="form-control form-control-sm text-center bg-dark text-white border-secondary"
                                                    value={editingProfile.config.separator} maxLength="1"
                                                    onChange={e => setEditingProfile({ ...editingProfile, config: { ...editingProfile.config, separator: e.target.value } })} />
                                            </div>
                                        )}
                                        <div className="col-12 mt-3">
                                            <div className="row g-2">
                                                {editingProfile.config.levelLengths.slice(0, editingProfile.config.levelCount).map((len, idx) => (
                                                    <div key={idx} className="col-2 text-center">
                                                        <span className="badge bg-secondary mb-1" style={{ fontSize: '0.6rem' }}>N{idx + 1}</span>
                                                        <input type="number" className="form-control form-control-sm text-center bg-dark text-white border-secondary"
                                                            value={len}
                                                            onChange={e => {
                                                                const newLens = [...editingProfile.config.levelLengths];
                                                                newLens[idx] = parseInt(e.target.value) || 0;
                                                                setEditingProfile({ ...editingProfile, config: { ...editingProfile.config, levelLengths: newLens } });
                                                            }} />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="modal-footer border-secondary" style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                                <button className="btn btn-outline-secondary text-white" onClick={() => setEditingProfile(null)}>Cancelar</button>
                                <button className="btn btn-primary" onClick={saveProfileEdit}><i className="bi bi-save me-1"></i>Guardar</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showCloneModal && (
                <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content glass-panel border-success">
                            <div className="modal-header border-success" style={{ backgroundColor: 'rgba(25, 135, 84, 0.1)', color: '#198754' }}>
                                <h5 className="modal-title"><i className="bi bi-copy me-2"></i>Clonar Perfil</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowCloneModal(null)}></button>
                            </div>
                            <div className="modal-body">
                                <div className="mb-3">
                                    <label className="form-label small fw-bold text-white-50">Empresa Destino</label>
                                    <select className="form-select bg-dark text-white border-secondary" value={targetCompanyId} onChange={e => setTargetCompanyId(e.target.value)}>
                                        <option value="">-- Misma Empresa --</option>
                                        <option value="global">ðŸŒ Plantilla Global</option>
                                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="modal-footer border-secondary" style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                                <button className="btn btn-outline-secondary text-white" onClick={() => setShowCloneModal(null)}>Cancelar</button>
                                <button className="btn btn-success" onClick={() => cloneProfile(showCloneModal)}><i className="bi bi-check2-circle me-1"></i>Clonar</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showModeChange && (
                <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content glass-panel shadow-lg border-secondary">
                            <div className="modal-header border-secondary" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                                <h5 className="modal-title text-white"><i className="bi bi-shield-lock me-2"></i>Seguridad de Mahoraga</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowModeChange(false)}></button>
                            </div>
                            <div className="modal-body p-4">
                                <div className="mb-4">
                                    <label className="form-label fw-bold text-white-50">Modo de OperaciÃ³n</label>
                                    <select className="form-select form-select-lg bg-dark text-white border-secondary" value={selectedMode} onChange={(e) => setSelectedMode(e.target.value)}>
                                        <option value="">Seleccionar...</option>
                                        <option value="disabled">ðŸš« Desactivado</option>
                                        <option value="manual">ðŸ‘† Manual (Por defecto)</option>
                                        <option value="assisted">ðŸ¤– Asistido (Sugerencias)</option>
                                        <option value="autonomous">âš¡ AutÃ³nomo (Experimental)</option>
                                    </select>
                                </div>
                                <div className="mb-3">
                                    <label className="form-label fw-bold text-white-50">RazÃ³n del Cambio</label>
                                    <textarea className="form-control bg-dark text-white border-secondary" rows="3" value={modeChangeReason}
                                        onChange={(e) => setModeChangeReason(e.target.value)}
                                        placeholder="Escribe el motivo del cambio..."></textarea>
                                </div>
                            </div>
                            <div className="modal-footer border-secondary" style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                                <button className="btn btn-outline-secondary text-white" onClick={() => setShowModeChange(false)}>Cancelar</button>
                                <button className="btn btn-primary px-4" onClick={handleModeChange} disabled={!selectedMode || !modeChangeReason.trim()}>
                                    Aplicar Cambio
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
