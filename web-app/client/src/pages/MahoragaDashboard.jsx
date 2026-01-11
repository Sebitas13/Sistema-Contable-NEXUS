/**
 * Mahoraga Dashboard - Centro de Control Inteligente V6.0
 *
 * Dashboard dinámico para entender y controlar el aprendizaje de Mahoraga.
 */

import React, { useState, useEffect } from 'react';
import { useCompany } from '../context/CompanyContext';
import axios from 'axios';
import MahoragaActivationButton from '../components/MahoragaActivationButton';

export default function MahoragaDashboard() {
  const { selectedCompany } = useCompany();
  const [mahoragaStatus, setMahoragaStatus] = useState(null);
  const [learningStatus, setLearningStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showActivationDemo, setShowActivationDemo] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [monitorStats, setMonitorStats] = useState(null);
  const [monitorDashboard, setMonitorDashboard] = useState(null);
  const [showModeChange, setShowModeChange] = useState(false);
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [selectedMode, setSelectedMode] = useState('');
  const [modeChangeReason, setModeChangeReason] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [companyProfile, setCompanyProfile] = useState(null);
  const [insights, setInsights] = useState([]);
  const [skillStats, setSkillStats] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  useEffect(() => {
    if (selectedCompany) {
      setLoading(true);
      refreshData().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [selectedCompany]);

  const refreshData = async () => {
    await Promise.all([
      fetchMahoragaStatus(),
      fetchLearningStatus(),
      fetchMonitorData(),
      fetchCompanyProfile(),
      fetchInsights(),
      fetchSkillHealth()
    ]);
  };

  const fetchInsights = async () => {
    try {
      const response = await axios.get(`/api/ai/mahoraga/insights?companyId=${selectedCompany.id}`);
      if (response.data.success) {
        setInsights(response.data.insights);
      }
    } catch (error) {
      console.error("Error fetching insights:", error);
    }
  };

  const fetchCompanyProfile = async () => {
    try {
      const response = await axios.get(`/api/ai/profile/${selectedCompany.id}`);
      if (response.data.success) {
        setCompanyProfile(response.data.profile_json);
      }
    } catch (error) {
      console.error("Error fetching company profile:", error);
    }
  };

  const fetchMonitorData = async () => {
    try {
      const [statsRes, dashboardRes] = await Promise.all([
        axios.get('/api/ai/monitor/stats'),
        axios.get('/api/ai/monitor/dashboard')
      ]);
      setMonitorStats(statsRes.data);
      setMonitorDashboard(dashboardRes.data.dashboard);
    } catch (error) {
      console.error("Error fetching monitor data:", error);
    }
  };

  const fetchMahoragaStatus = async () => {
    if (!selectedCompany) return;
    try {
      const response = await axios.get('/api/ai/mahoraga/status');
      setMahoragaStatus(response.data.mahoraga);
    } catch (error) {
      console.error("Error fetching Mahoraga status:", error);
    }
  };

  const fetchSkillHealth = async () => {
    try {
      const response = await axios.get('/api/ai/skills/health');
      if (response.data.success) {
        setSkillStats(response.data.stats);
      }
    } catch (error) {
      console.error("Error fetching skill health:", error);
    }
  };

  const handleSearchSkills = async (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (query.length > 2) {
      try {
        const response = await axios.get('/api/ai/skills/search', {
          params: { q: query, limit: 20 }
        });
        if (response.data.success) {
          setSearchResults(response.data.results);
        }
      } catch (error) {
        console.error("Error searching skills:", error);
      }
    } else {
      setSearchResults([]);
    }
  };

  const fetchLearningStatus = async () => {
    if (!selectedCompany) return;
    try {
      const response = await axios.get('/api/ai/recognition/status', {
        params: { companyId: selectedCompany.id }
      });
      setLearningStatus(response.data);
    } catch (error) {
      console.error("Error fetching learning status:", error);
    }
  };

  const handleModeChange = async () => {
    if (!selectedMode || !modeChangeReason.trim()) {
      alert('Selecciona un modo y proporciona una razón');
      return;
    }

    try {
      await axios.post('/api/ai/mahoraga/change-mode', {
        newMode: selectedMode,
        userId: 'admin',
        reason: modeChangeReason
      });

      alert(`Modo cambiado exitosamente a ${selectedMode}`);
      setSelectedMode('');
      setModeChangeReason('');
      setShowModeChange(false);
      fetchMahoragaStatus();
    } catch (error) {
      console.error('Error cambiando modo:', error);
      alert('Error al cambiar modo: ' + error.response?.data?.error);
    }
  };

  const handleEmergencyStop = async () => {
    if (!confirm('¿Estás seguro de activar la PARADA DE EMERGENCIA? Esto detendrá TODAS las operaciones de Mahoraga.')) {
      return;
    }

    try {
      await axios.post('/api/ai/mahoraga/emergency-stop', {
        userId: 'admin',
        reason: 'Emergency stop from dashboard'
      });

      alert('🛑 PARADA DE EMERGENCIA ACTIVADA');
      fetchMahoragaStatus();
    } catch (error) {
      console.error('Error en parada de emergencia:', error);
      alert('Error en parada de emergencia: ' + error.response?.data?.error);
    }
  };

  const handleAdvanceLearning = async () => {
    if (!selectedCompany) return;
    try {
      await axios.post('/api/ai/recognition/advance', {
        companyId: selectedCompany.id
      });
      fetchLearningStatus();
    } catch (error) {
      console.error("Error advancing learning phase:", error);
      alert('Error al avanzar fase de aprendizaje: ' + (error.response?.data?.error || error.message));
    }
  };

  if (loading) {
    return (
      <div className="fade-in">
        <div className="text-center py-5">
          <div className="spinner-border text-primary"></div>
          <p className="mt-3 text-muted">Sincronizando con Mahoraga V6.0...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in pb-5">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">
            <i className="bi bi-robot me-2 text-primary"></i>
            Centro de Control Mahoraga
          </h2>
          <p className="text-muted mb-0">Cognitive Orchestrator & System Recognition Engine (V6.0 Atonement)</p>
        </div>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-primary btn-sm" onClick={refreshData}>
            <i className="bi bi-arrow-clockwise me-1"></i> Actualizar
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleEmergencyStop}>
            <i className="bi bi-stop-circle me-1"></i> Parada de Emergencia
          </button>
        </div>
      </div>

      <div className="row g-4 mb-4">
        {/* Insights Section */}
        <div className="col-12">
          <div className="card shadow-sm border-0 bg-light">
            <div className="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
              <h5 className="mb-0 text-primary fw-bold">
                <i className="bi bi-lightbulb-fill me-2"></i>Perspectivas Activas (Insights)
              </h5>
              <span className="badge bg-primary rounded-pill">{insights.length} encontrados</span>
            </div>
            <div className="card-body">
              {insights.length === 0 ? (
                <div className="text-center py-4 text-muted">
                  <i className="bi bi-shield-check fs-1 d-block mb-3 text-success opacity-50"></i>
                  <p className="mb-0">No se detectaron anomalías o sugerencias críticas en este momento.</p>
                </div>
              ) : (
                <div className="row g-3">
                  {insights.map((insight, idx) => (
                    <div key={idx} className="col-md-6">
                      <div className={`card border-start border-4 border-${insight.type === 'warning' ? 'warning' : 'info'} shadow-sm h-100`}>
                        <div className="card-body">
                          <div className="d-flex align-items-center mb-2">
                            <i className={`bi bi-${insight.type === 'warning' ? 'exclamation-triangle' : 'info-circle'}-fill text-${insight.type} me-2 fs-5`}></i>
                            <h6 className="card-title mb-0 fw-bold">{insight.title}</h6>
                          </div>
                          <p className="card-text small text-muted mb-3">{insight.message}</p>
                          <div className="d-flex justify-content-between align-items-center">
                            <span className="badge bg-dark bg-opacity-10 text-dark font-monospace small">SKILL: {insight.skill}</span>
                            <a href="/app/journal" className="btn btn-link btn-sm p-0 text-decoration-none">Resolver con Mahoraga <i className="bi bi-chevron-right small"></i></a>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Cards */}
        <div className="col-md-4">
          <div className="card shadow-sm h-100 border-0 overflow-hidden" style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', color: 'white' }}>
            <div className="card-body">
              <h6 className="opacity-75 mb-3 text-uppercase small ls-1">Estado de Seguridad</h6>
              <h3 className="fw-bold mb-2">
                {mahoragaStatus?.currentMode?.toUpperCase() || 'OFFLINE'}
              </h3>
              <p className="small opacity-75 mb-4">
                {mahoragaStatus?.currentMode === 'manual' ? 'Control total del usuario activado.' : 'Sugerencias asistidas habilitadas.'}
              </p>
              <button className="btn btn-sm btn-outline-light w-100" onClick={() => setShowModeChange(true)}>
                Cambiar Modo
              </button>
            </div>
          </div>
        </div>

        <div className="col-md-4">
          <div className="card shadow-sm h-100 border-0" style={{ background: 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)' }}>
            <div className="card-body">
              <h6 className="text-success text-uppercase small fw-bold mb-3">Madurez del Ciclo (SCL)</h6>
              <h3 className="fw-bold mb-0">{learningStatus?.learning_progress?.percentage || 0}%</h3>
              <div className="progress mt-2 mb-3" style={{ height: '8px' }}>
                <div className="progress-bar bg-success" style={{ width: `${learningStatus?.learning_progress?.percentage || 0}%` }}></div>
              </div>
              <p className="small text-muted mb-1 font-bold">Fase: <span className="text-success">{learningStatus?.learning_progress?.current_phase || 'Génesis'}</span></p>
              <p className="text-xs text-muted mb-3" style={{ fontSize: '0.75rem' }}>
                <i className="bi bi-info-circle me-1"></i>
                {learningStatus?.learning_progress?.details || 'Mahoraga está observando el sistema.'}
              </p>
              <button className="btn btn-sm btn-success w-100 mt-auto" onClick={refreshData}>
                <i className="bi bi-arrow-repeat me-2"></i>Sincronizar Conocimiento
              </button>
            </div>
          </div>
        </div>

        <div className="col-md-4">
          <div className="card shadow-sm h-100 border-0" style={{ background: 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)' }}>
            <div className="card-body">
              <h6 className="text-primary text-uppercase small fw-bold mb-3">Cognición (Reglas)</h6>
              <h3 className="fw-bold mb-2">
                {(companyProfile?.monetary_rules?.length || 0) + (companyProfile?.non_monetary_rules?.length || 0)}
              </h3>
              <p className="small text-muted mb-4">Patrones específicos aprendidos de tus correcciones.</p>
              <div className="d-flex gap-2">
                <span className="badge bg-primary bg-opacity-75">{companyProfile?.monetary_rules?.length || 0} Monetarias</span>
                <span className="badge bg-info text-dark bg-opacity-75">{companyProfile?.non_monetary_rules?.length || 0} No Monetarias</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-md-8">
          <div className="card shadow-sm border-0">
            <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center">
              <h5 className="mb-0 fw-bold"><i className="bi bi-cpu me-2 text-primary"></i>Habilidades Absorbidas del Sistema</h5>
              <div className="input-group input-group-sm w-50">
                <span className="input-group-text bg-light border-0"><i className="bi bi-search"></i></span>
                <input
                  type="text"
                  className="form-control border-0 bg-light"
                  placeholder="Buscar habilidad por nombre o lógica..."
                  value={searchQuery}
                  onChange={handleSearchSkills}
                />
              </div>
            </div>
            <div className="card-body p-0">
              <div className="bg-slate-900 text-white p-3 rounded-bottom-0 border-b border-slate-700">
                <h6 className="small text-yellow-500 mb-2 uppercase font-bold tracking-wider">
                  <i className="bi bi-shield-shaded me-2"></i>Capa de Gobernanza Activa
                </h6>
                <p className="text-xs opacity-75 leading-relaxed mb-0">
                  Mahoraga no es una herramienta de consulta; es el garante de la integridad del ciclo contable.
                  Su madurez aumenta con la actividad real:
                  <strong> Génesis</strong> (Cimientos) → <strong> Operación</strong> (Hechos) →
                  <strong> Ritual</strong> (SCL) → <strong> Revelación</strong> (Juicio Final).
                </p>
              </div>
              <div className="px-3 py-2 bg-slate-50 border-bottom d-flex justify-content-between align-items-center">
                <span className="text-xs font-bold text-slate-500">PRÓXIMO HITO:</span>
                <span className="badge bg-slate-200 text-slate-700 font-monospace">
                  <i className="bi bi-flag-fill me-1"></i> {learningStatus?.learning_progress?.next_milestone || 'Cargar Plan de Cuentas'}
                </span>
              </div>
              <div className="table-responsive" style={{ maxHeight: '400px' }}>
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light sticky-top">
                    <tr>
                      <th>Habilidad / Función</th>
                      <th>Extensión</th>
                      <th>Propiedad</th>
                      <th>Confianza</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.length > 0 ? (
                      searchResults.map((res, i) => (
                        <tr key={res.skill.id || i}>
                          <td>
                            <div className="d-flex flex-column">
                              <code className="text-primary fw-bold mb-1" style={{ fontSize: '0.85rem' }}>{res.skill.name}</code>
                              <span className="text-muted" style={{ fontSize: '0.7rem' }}>{res.skill.file.split('/').pop()}</span>
                            </div>
                          </td>
                          <td><span className="badge bg-secondary">{res.skill.type || 'func'}</span></td>
                          <td>
                            {res.skill.isPure ?
                              <span className="badge bg-success-subtle text-success">Pura</span> :
                              <span className="badge bg-info-subtle text-info">Contexto ({res.skill.contextDeps?.length || 0})</span>
                            }
                          </td>
                          <td>
                            <div className="d-flex align-items-center">
                              <div className="progress w-100 me-2" style={{ height: '4px' }}>
                                <div className="progress-bar bg-primary" style={{ width: `${(res.skill.confidence || 0.9) * 100}%` }}></div>
                              </div>
                              <span className="small">{(res.skill.confidence || 0.9) * 100}%</span>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <>
                        <tr>
                          <td><code className="text-primary fw-bold">AuditBalance</code></td>
                          <td><span className="badge bg-secondary">Domain</span></td>
                          <td><span className="badge bg-success-subtle text-success">Pura</span></td>
                          <td>98.5%</td>
                        </tr>
                        <tr>
                          <td><code className="text-primary fw-bold">AitbCategorizer</code></td>
                          <td><span className="badge bg-secondary">Logic</span></td>
                          <td><span className="badge bg-info-subtle text-info">Contexto</span></td>
                          <td>92.0%</td>
                        </tr>
                        {skillStats && skillStats.totalSkills > 0 && (
                          <tr className="table-info bg-opacity-10 border-top-0">
                            <td colSpan="4" className="text-center py-3">
                              <div className="d-flex align-items-center justify-content-center">
                                <i className="bi bi-cpu-fill me-2 fs-5"></i>
                                <span><strong>{skillStats.totalSkills} habilidades totales</strong> absorbidas del código fuente.</span>
                              </div>
                              <small className="text-muted d-block mt-1">Sincronizado con Mahoraga Engine V7.0 (JS/Python)</small>
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-4">
          <div className="card shadow-sm border-0 mb-4">
            <div className="card-header bg-white py-3">
              <h5 className="mb-0 fw-bold"><i className="bi bi-activity me-2 text-primary"></i>Uso de API (Monitor)</h5>
            </div>
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <span className="text-muted">Modelo Activo</span>
                <span className="badge bg-dark rounded-pill px-3">{monitorStats?.current_model || 'Buscando...'}</span>
              </div>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <span className="text-muted">Peticiones (Sesión)</span>
                <span className="fw-bold">{monitorStats?.session_requests || 0}</span>
              </div>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <span className="text-muted">Costo Diario Estimado</span>
                <span className="text-success fw-bold">${monitorStats?.daily_cost || '0.00'}</span>
              </div>
              <hr />
              <div className="d-flex justify-content-between align-items-center">
                <span className="text-muted small">Cuota de Uso</span>
                <span className={`badge ${monitorStats?.daily_usage_percent > 80 ? 'bg-danger' : 'bg-success'} rounded-pill`}>
                  {monitorStats?.daily_usage_percent || 0}% utilizado
                </span>
              </div>
            </div>
          </div>

          <div className="card shadow-sm border-0 bg-primary text-white">
            <div className="card-body text-center py-4">
              <h6 className="text-uppercase small ls-1 mb-3 opacity-75">Mahoraga V6.0 Live</h6>
              <div className="d-flex justify-content-center align-items-center mb-3">
                <div className="spinner-grow spinner-grow-sm text-light me-2"></div>
                <span className="fw-bold">Escaneando Sistema...</span>
              </div>
              <p className="small mb-0 opacity-75">
                Mahoraga está procesando el flujo de datos en tiempo real para generar nuevas adaptaciones.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Cambio de Modo (Mismo de antes) */}
      {showModeChange && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content shadow-lg border-0">
              <div className="modal-header bg-dark text-white">
                <h5 className="modal-title"><i className="bi bi-shield-lock me-2"></i>Seguridad de Mahoraga</h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowModeChange(false)}></button>
              </div>
              <div className="modal-body p-4">
                <div className="mb-4">
                  <label className="form-label fw-bold">Nuevo Modo de Operación</label>
                  <select className="form-select form-select-lg" value={selectedMode} onChange={(e) => setSelectedMode(e.target.value)}>
                    <option value="">Seleccionar...</option>
                    <option value="disabled">🚫 Desactivado</option>
                    <option value="manual">👆 Manual (Por defecto)</option>
                    <option value="assisted">🤖 Asistido (Sugerencias)</option>
                    <option value="autonomous">⚡ Autónomo (Experimental)</option>
                  </select>
                </div>
                <div className="mb-3">
                  <label className="form-label fw-bold">Razón del Cambio</label>
                  <textarea
                    className="form-control"
                    rows="3"
                    value={modeChangeReason}
                    onChange={(e) => setModeChangeReason(e.target.value)}
                    placeholder="Escribe el motivo del cambio de seguridad..."
                  ></textarea>
                </div>
              </div>
              <div className="modal-footer bg-light">
                <button className="btn btn-secondary" onClick={() => setShowModeChange(false)}>Cancelar</button>
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
