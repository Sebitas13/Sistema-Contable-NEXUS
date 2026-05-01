import React, { useState, useEffect } from 'react';
import { useCompany } from '../context/CompanyContext';
import inventoryService from '../services/inventoryService';

export default function CostCenters() {
    const { selectedCompany } = useCompany();
    const companyId = selectedCompany?.id;

    const [costCenters, setCostCenters] = useState([]);
    const [distributionModels, setDistributionModels] = useState([]);
    const [loading, setLoading] = useState(true);

    const [showModal, setShowModal] = useState(false);
    const [showModelModal, setShowModelModal] = useState(false);

    // Cost Center Form
    const [formData, setFormData] = useState({
        code: '',
        name: '',
        type: 'Analytic', // Analytic, Production, Administrative
        is_active: 1
    });

    // Distribution Model Form
    const [modelData, setModelData] = useState({
        name: '',
        description: '',
        entries: [] // { cost_center_id, percentage }
    });

    useEffect(() => {
        if (companyId) {
            fetchData();
        }
    }, [companyId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [ccRes, dmRes] = await Promise.all([
                inventoryService.getCostCenters(companyId),
                inventoryService.getDistributionModels(companyId)
            ]);
            
            if (ccRes.success) setCostCenters(ccRes.data);
            if (dmRes.success) setDistributionModels(dmRes.data);
        } catch (error) {
            console.error("Error fetching cost center data:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleCCSubmit = async (e) => {
        e.preventDefault();
        try {
            await inventoryService.createCostCenter({
                company_id: companyId,
                ...formData
            });
            setShowModal(false);
            setFormData({ code: '', name: '', type: 'Analytic', is_active: 1 });
            fetchData();
        } catch (error) {
            alert(error.response?.data?.error || "Error al guardar el centro de costo");
        }
    };

    const handleModelSubmit = async (e) => {
        e.preventDefault();
        
        const totalPct = modelData.entries.reduce((sum, entry) => sum + parseFloat(entry.percentage || 0), 0);
        if (Math.abs(totalPct - 100) > 0.01) {
            alert(`La suma de los porcentajes debe ser exactamente 100%. Actual: ${totalPct}%`);
            return;
        }

        try {
            await inventoryService.createDistributionModel({
                company_id: companyId,
                ...modelData
            });
            setShowModelModal(false);
            setModelData({ name: '', description: '', entries: [] });
            fetchData();
        } catch (error) {
            alert(error.response?.data?.error || "Error al guardar el modelo de distribución");
        }
    };

    const addModelEntry = () => {
        setModelData({
            ...modelData,
            entries: [...modelData.entries, { cost_center_id: '', percentage: 0 }]
        });
    };

    const updateModelEntry = (index, field, value) => {
        const newEntries = [...modelData.entries];
        newEntries[index][field] = value;
        setModelData({ ...modelData, entries: newEntries });
    };

    const removeModelEntry = (index) => {
        const newEntries = modelData.entries.filter((_, i) => i !== index);
        setModelData({ ...modelData, entries: newEntries });
    };

    return (
        <div>
            <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3 mb-4">
                <div>
                    <h2 className="mb-1"><i className="bi bi-diagram-3 me-2"></i>Contabilidad Analítica</h2>
                    <p className="text-white-50 mb-0">Gestión de Centros de Costo y Modelos de Distribución</p>
                </div>
            </div>

            <div className="row g-4">
                {/* Panel Centros de Costo */}
                <div className="col-lg-6">
                    <div className="card glass-panel border-secondary shadow-sm h-100">
                        <div className="card-header border-secondary d-flex justify-content-between align-items-center">
                            <h5 className="mb-0 text-white"><i className="bi bi-building me-2"></i>Centros de Costo</h5>
                            <button className="btn btn-sm btn-primary" onClick={() => setShowModal(true)}>
                                <i className="bi bi-plus"></i> Nuevo
                            </button>
                        </div>
                        <div className="card-body p-0">
                            {loading ? (
                                <div className="text-center py-4 text-white-50">Cargando...</div>
                            ) : (
                                <div className="table-responsive">
                                    <table className="table table-dark table-hover mb-0 align-middle" style={{ backgroundColor: 'transparent' }}>
                                        <thead style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                                            <tr>
                                                <th>Código</th>
                                                <th>Nombre</th>
                                                <th>Tipo</th>
                                                <th className="text-end">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {costCenters.length === 0 ? (
                                                <tr><td colSpan="4" className="text-center py-4 text-white-50">No hay centros de costo registrados</td></tr>
                                            ) : (
                                                costCenters.map(cc => (
                                                    <tr key={cc.id}>
                                                        <td><code>{cc.code}</code></td>
                                                        <td className="text-white">{cc.name}</td>
                                                        <td><span className="badge bg-secondary border border-secondary">{cc.type}</span></td>
                                                        <td className="text-end">
                                                            <button className="btn btn-sm btn-outline-danger" onClick={async () => {
                                                                if(window.confirm('¿Eliminar centro de costo?')) {
                                                                    await inventoryService.deleteCostCenter(cc.id);
                                                                    fetchData();
                                                                }
                                                            }}><i className="bi bi-trash"></i></button>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Panel Modelos de Distribución */}
                <div className="col-lg-6">
                    <div className="card glass-panel border-secondary shadow-sm h-100">
                        <div className="card-header border-secondary d-flex justify-content-between align-items-center">
                            <h5 className="mb-0 text-white"><i className="bi bi-pie-chart me-2"></i>Modelos de Distribución (GIF)</h5>
                            <button className="btn btn-sm btn-primary" onClick={() => setShowModelModal(true)}>
                                <i className="bi bi-plus"></i> Nuevo Modelo
                            </button>
                        </div>
                        <div className="card-body p-0">
                            {loading ? (
                                <div className="text-center py-4 text-white-50">Cargando...</div>
                            ) : (
                                <div className="table-responsive">
                                    <table className="table table-dark table-hover mb-0 align-middle" style={{ backgroundColor: 'transparent' }}>
                                        <thead style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                                            <tr>
                                                <th>Nombre del Modelo</th>
                                                <th>Distribución</th>
                                                <th className="text-end">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {distributionModels.length === 0 ? (
                                                <tr><td colSpan="3" className="text-center py-4 text-white-50">No hay modelos de distribución registrados</td></tr>
                                            ) : (
                                                distributionModels.map(dm => (
                                                    <tr key={dm.id}>
                                                        <td className="text-white fw-bold">
                                                            {dm.name}
                                                            <small className="d-block text-white-50 fw-normal">{dm.description}</small>
                                                        </td>
                                                        <td>
                                                            {dm.entries.map((entry, i) => (
                                                                <div key={i} className="small text-white-50">
                                                                    {entry.cost_center_name}: <span className="text-info">{(entry.percentage * 100).toFixed(0)}%</span>
                                                                </div>
                                                            ))}
                                                        </td>
                                                        <td className="text-end">
                                                            <button className="btn btn-sm btn-outline-danger" onClick={async () => {
                                                                if(window.confirm('¿Eliminar modelo de distribución?')) {
                                                                    await inventoryService.deleteDistributionModel(dm.id);
                                                                    fetchData();
                                                                }
                                                            }}><i className="bi bi-trash"></i></button>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal CC */}
            {showModal && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                    <div className="modal-dialog">
                        <div className="modal-content glass-panel border-secondary text-white">
                            <div className="modal-header border-secondary border-bottom">
                                <h5 className="modal-title">Nuevo Centro de Costo</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <form onSubmit={handleCCSubmit}>
                                    <div className="mb-3">
                                        <label className="form-label text-white-50">Código</label>
                                        <input type="text" className="form-control bg-dark text-white border-secondary" value={formData.code} onChange={(e) => setFormData({...formData, code: e.target.value})} required />
                                    </div>
                                    <div className="mb-3">
                                        <label className="form-label text-white-50">Nombre</label>
                                        <input type="text" className="form-control bg-dark text-white border-secondary" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} required />
                                    </div>
                                    <div className="mb-3">
                                        <label className="form-label text-white-50">Tipo</label>
                                        <select className="form-select bg-dark text-white border-secondary" value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value})}>
                                            <option value="Analytic">Analítico (Gastos)</option>
                                            <option value="Production">Producción (Plantas)</option>
                                            <option value="Administrative">Administrativo</option>
                                        </select>
                                    </div>
                                    <div className="modal-footer px-0 pb-0 pt-3 border-secondary border-top">
                                        <button type="button" className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                                        <button type="submit" className="btn btn-primary">Guardar</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Model */}
            {showModelModal && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                    <div className="modal-dialog modal-lg">
                        <div className="modal-content glass-panel border-secondary text-white">
                            <div className="modal-header border-secondary border-bottom">
                                <h5 className="modal-title">Nuevo Modelo de Distribución (Prorrateo)</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowModelModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <form onSubmit={handleModelSubmit}>
                                    <div className="row mb-3">
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">Nombre del Modelo</label>
                                            <input type="text" className="form-control bg-dark text-white border-secondary" placeholder="Ej: Energía Eléctrica" value={modelData.name} onChange={(e) => setModelData({...modelData, name: e.target.value})} required />
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">Descripción</label>
                                            <input type="text" className="form-control bg-dark text-white border-secondary" placeholder="Ej: Distribución basada en m2" value={modelData.description} onChange={(e) => setModelData({...modelData, description: e.target.value})} />
                                        </div>
                                    </div>
                                    
                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                        <label className="form-label text-white-50 mb-0">Reglas de Distribución</label>
                                        <button type="button" className="btn btn-sm btn-outline-info" onClick={addModelEntry}>
                                            <i className="bi bi-plus"></i> Añadir Centro
                                        </button>
                                    </div>
                                    
                                    <div className="bg-dark p-3 rounded border border-secondary mb-3">
                                        {modelData.entries.length === 0 ? (
                                            <div className="text-center text-white-50 py-2">No se han añadido centros de costo. Usa el botón superior.</div>
                                        ) : (
                                            modelData.entries.map((entry, idx) => (
                                                <div key={idx} className="row g-2 align-items-center mb-2">
                                                    <div className="col-md-8">
                                                        <select className="form-select bg-dark text-white border-secondary" value={entry.cost_center_id} onChange={(e) => updateModelEntry(idx, 'cost_center_id', e.target.value)} required>
                                                            <option value="">Seleccionar Centro de Costo...</option>
                                                            {costCenters.map(cc => <option key={cc.id} value={cc.id}>{cc.code} - {cc.name}</option>)}
                                                        </select>
                                                    </div>
                                                    <div className="col-md-3">
                                                        <div className="input-group">
                                                            <input type="number" step="0.01" className="form-control bg-dark text-white border-secondary" placeholder="Porcentaje" value={entry.percentage} onChange={(e) => updateModelEntry(idx, 'percentage', e.target.value)} required />
                                                            <span className="input-group-text bg-dark text-white-50 border-secondary">%</span>
                                                        </div>
                                                    </div>
                                                    <div className="col-md-1 text-end">
                                                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeModelEntry(idx)}>
                                                            <i className="bi bi-trash"></i>
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                        
                                        {modelData.entries.length > 0 && (
                                            <div className="d-flex justify-content-end mt-3 pt-2 border-top border-secondary">
                                                <span className={`fw-bold ${modelData.entries.reduce((s,e) => s + parseFloat(e.percentage||0), 0) === 100 ? 'text-success' : 'text-danger'}`}>
                                                    Total: {modelData.entries.reduce((s,e) => s + parseFloat(e.percentage||0), 0).toFixed(2)}%
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="modal-footer px-0 pb-0 pt-3 border-secondary border-top">
                                        <button type="button" className="btn btn-outline-secondary" onClick={() => setShowModelModal(false)}>Cancelar</button>
                                        <button type="submit" className="btn btn-primary" disabled={modelData.entries.length === 0}>Guardar Modelo</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
