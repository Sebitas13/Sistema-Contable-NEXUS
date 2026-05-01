import React, { useState, useEffect, useRef } from 'react';
import { exportToPDF, exportToExcel, importFromExcel } from '../utils/exportUtils';
import { useCompany } from '../context/CompanyContext';
import inventoryService from '../services/inventoryService';

export default function Inventory() {
    const { selectedCompany } = useCompany();
    const companyId = selectedCompany?.id;

    const [items, setItems] = useState([]);
    const [costCenters, setCostCenters] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedItem, setSelectedItem] = useState(null);
    
    // Modals state
    const [showModal, setShowModal] = useState(false);
    const [showMovementModal, setShowMovementModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [movementHistory, setMovementHistory] = useState([]);

    const [formData, setFormData] = useState({
        code: '',
        name: '',
        unit: 'Unidad',
        item_type: 'PT', // PT, MP, WIP, SU
        valuation_method: 'CPP', // CPP, PEPS, UEPS, IE
        initial_quantity: 0,
        initial_cost: 0
    });

    const [movementData, setMovementData] = useState({
        type: 'Entrada',
        quantity: 0,
        unit_cost: 0,
        date: new Date().toISOString().split('T')[0],
        cost_center_id: '',
        gloss: ''
    });

    const fileInputRef = useRef(null);

    useEffect(() => {
        if (companyId) {
            fetchData();
        }
    }, [companyId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [itemsRes, centersRes] = await Promise.all([
                inventoryService.getItems(companyId),
                inventoryService.getCostCenters(companyId)
            ]);
            
            if (itemsRes.success) setItems(itemsRes.data);
            if (centersRes.success) setCostCenters(centersRes.data);
        } catch (error) {
            console.error("Error fetching inventory data:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleMovementChange = (e) => {
        setMovementData({ ...movementData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await inventoryService.createItem({
                company_id: companyId,
                ...formData
            });
            setShowModal(false);
            resetForm();
            fetchData();
        } catch (error) {
            alert(error.response?.data?.error || "Error al guardar el artículo");
        }
    };

    const handleMovementSubmit = async (e) => {
        e.preventDefault();
        try {
            await inventoryService.addMovement({
                item_id: selectedItem.id,
                type: movementData.type,
                quantity: movementData.quantity,
                unit_cost: movementData.type === 'Entrada' ? movementData.unit_cost : 0,
                date: movementData.date,
                cost_center_id: movementData.cost_center_id || null,
                gloss: movementData.gloss
            });
            setShowMovementModal(false);
            setSelectedItem(null);
            setMovementData({
                type: 'Entrada',
                quantity: 0,
                unit_cost: 0,
                date: new Date().toISOString().split('T')[0],
                cost_center_id: '',
                gloss: ''
            });
            fetchData();
        } catch (error) {
            alert("Error al registrar movimiento");
        }
    };

    const viewHistory = async (item) => {
        setSelectedItem(item);
        try {
            const res = await inventoryService.getMovements(item.id);
            if (res.success) {
                setMovementHistory(res.data);
                setShowHistoryModal(true);
            }
        } catch (error) {
            alert("Error al cargar historial");
        }
    };

    const resetForm = () => {
        setFormData({
            code: '',
            name: '',
            unit: 'Unidad',
            item_type: 'PT',
            valuation_method: 'CPP',
            initial_quantity: 0,
            initial_cost: 0
        });
    };

    const handleExportPDF = () => {
        const columns = [
            { header: 'Código', field: 'code' },
            { header: 'Nombre', field: 'name' },
            { header: 'Unidad', field: 'unit' },
            { header: 'Método', field: 'valuation_method' },
            { header: 'Cantidad', field: 'quantity' },
            { header: 'Costo Unit.', field: 'unit_cost' },
            { header: 'Valor Total', field: 'total_cost' }
        ];
        
        const exportData = items.map(item => ({
            ...item,
            quantity: item.quantity?.toFixed(2) || '0.00',
            unit_cost: item.unit_cost?.toFixed(2) || '0.00',
            total_cost: item.total_cost?.toFixed(2) || '0.00'
        }));
        
        exportToPDF(exportData, columns, `Kardex Físico Valorado - ${selectedCompany?.name || ''}`);
    };

    const handleExportExcel = () => {
        const exportData = items.map(item => ({
            'Código': item.code,
            'Nombre': item.name,
            'Tipo': item.item_type,
            'Unidad': item.unit,
            'Método': item.valuation_method,
            'Cantidad': parseFloat(item.quantity || 0).toFixed(2),
            'Costo Unitario': parseFloat(item.unit_cost || 0).toFixed(2),
            'Valor Total': parseFloat(item.total_cost || 0).toFixed(2)
        }));
        exportToExcel(exportData, 'Inventario', 'inventario_kardex');
    };

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const data = await importFromExcel(file);
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                await inventoryService.createItem({
                    company_id: companyId,
                    code: row['Código'] || row.code || `ITEM-${Date.now()}-${i}`,
                    name: row['Nombre'] || row.name || 'Artículo Importado',
                    unit: row['Unidad'] || row.unit || 'Unidad',
                    item_type: row['Tipo'] || 'PT',
                    valuation_method: row['Método'] || 'CPP',
                    initial_quantity: parseFloat(row['Cantidad Inicial'] || 0),
                    initial_cost: parseFloat(row['Costo Inicial'] || 0)
                });
            }
            alert(`Se importaron ${data.length} artículos exitosamente`);
            fetchData();
        } catch (error) {
            console.error('Error importing inventory:', error);
            alert('Error importando inventario. Verifica el formato del archivo.');
        }

        e.target.value = null;
    };

    const totalValue = items.reduce((sum, item) => sum + parseFloat(item.total_cost || 0), 0);
    const totalQty = items.reduce((sum, item) => sum + parseFloat(item.quantity || 0), 0);

    return (
        <div>
            <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3 mb-4">
                <div>
                    <h2 className="mb-1"><i className="bi bi-box-seam me-2"></i>Kardex Físico Valorado</h2>
                    <p className="text-white-50 mb-0">Control de existencias, valuación REA y costos</p>
                </div>
                <div className="d-flex flex-wrap gap-2 align-items-center">
                    <button className="btn btn-outline-success btn-sm" onClick={handleExportExcel}>
                        <i className="bi bi-file-earmark-excel me-1"></i> <span className="d-none d-sm-inline">Exportar </span>
                    </button>
                    <button className="btn btn-outline-danger btn-sm" onClick={handleExportPDF}>
                        <i className="bi bi-file-earmark-pdf me-1"></i> PDF
                    </button>
                    <button className="btn btn-outline-info btn-sm" onClick={() => fileInputRef.current.click()}>
                        <i className="bi bi-upload me-1"></i> <span className="d-none d-sm-inline">Importar</span>
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleImport} accept=".xlsx,.xls" style={{ display: 'none' }} />
                    <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
                        <i className="bi bi-plus-circle me-1"></i> Nuevo <span className="d-none d-sm-inline">Artículo</span>
                    </button>
                </div>
            </div>

            {/* Resumen */}
            <div className="row g-3 mb-4">
                <div className="col-md-4">
                    <div className="card shadow-sm border-0 text-white" style={{ background: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)' }}>
                        <div className="card-body">
                            <h6 className="mb-1 opacity-75">Total Artículos</h6>
                            <h3 className="mb-0 fw-bold">{items.length}</h3>
                        </div>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="card shadow-sm border-0 text-white" style={{ background: 'linear-gradient(135deg, #0ba360 0%, #3cba92 100%)' }}>
                        <div className="card-body">
                            <h6 className="mb-1 opacity-75">Valorización Total</h6>
                            <h3 className="mb-0 fw-bold">Bs {totalValue.toLocaleString('es-BO', {minimumFractionDigits: 2})}</h3>
                        </div>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="card shadow-sm border-0 text-white" style={{ background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' }}>
                        <div className="card-body">
                            <h6 className="mb-1 opacity-75">Unidades en Stock</h6>
                            <h3 className="mb-0 fw-bold">{totalQty.toFixed(2)}</h3>
                        </div>
                    </div>
                </div>
            </div>

            {/* Nuevo Artículo Modal */}
            {showModal && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                    <div className="modal-dialog modal-lg">
                        <div className="modal-content glass-panel border-secondary text-white">
                            <div className="modal-header border-secondary border-bottom">
                                <h5 className="modal-title"><i className="bi bi-plus-circle me-2"></i>Alta de Artículo</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <form onSubmit={handleSubmit}>
                                    <div className="row mb-3">
                                        <div className="col-md-4">
                                            <label className="form-label text-white-50">Código</label>
                                            <input type="text" className="form-control bg-dark text-white border-secondary" name="code" value={formData.code} onChange={handleInputChange} required />
                                        </div>
                                        <div className="col-md-8">
                                            <label className="form-label text-white-50">Nombre del Artículo</label>
                                            <input type="text" className="form-control bg-dark text-white border-secondary" name="name" value={formData.name} onChange={handleInputChange} required />
                                        </div>
                                    </div>
                                    
                                    <div className="row mb-3">
                                        <div className="col-md-4">
                                            <label className="form-label text-white-50">Tipo</label>
                                            <select className="form-select bg-dark text-white border-secondary" name="item_type" value={formData.item_type} onChange={handleInputChange}>
                                                <option value="PT">Producto Terminado</option>
                                                <option value="MP">Materia Prima</option>
                                                <option value="WIP">Trabajo en Proceso</option>
                                                <option value="SU">Suministros</option>
                                            </select>
                                        </div>
                                        <div className="col-md-4">
                                            <label className="form-label text-white-50">Método de Valuación</label>
                                            <select className="form-select bg-dark text-white border-secondary" name="valuation_method" value={formData.valuation_method} onChange={handleInputChange}>
                                                <option value="CPP">Promedio Ponderado (CPP)</option>
                                                <option value="PEPS">PEPS (FIFO)</option>
                                                <option value="IE">Identificación Específica (IE)</option>
                                                <option value="UEPS">UEPS (LIFO - No IAS2)</option>
                                            </select>
                                        </div>
                                        <div className="col-md-4">
                                            <label className="form-label text-white-50">Unidad de Medida</label>
                                            <select className="form-select bg-dark text-white border-secondary" name="unit" value={formData.unit} onChange={handleInputChange}>
                                                <option value="Unidad">Unidad</option>
                                                <option value="Kg">Kilogramo (Kg)</option>
                                                <option value="Litro">Litro (L)</option>
                                                <option value="Metro">Metro (m)</option>
                                                <option value="Caja">Caja</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="row mb-3">
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">Stock Inicial (Opcional)</label>
                                            <input type="number" step="0.01" className="form-control bg-dark text-white border-secondary" name="initial_quantity" value={formData.initial_quantity} onChange={handleInputChange} />
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">Costo Unitario Inicial (Bs)</label>
                                            <input type="number" step="0.01" className="form-control bg-dark text-white border-secondary" name="initial_cost" value={formData.initial_cost} onChange={handleInputChange} />
                                        </div>
                                    </div>
                                    
                                    <div className="alert bg-dark border-secondary text-white-50 mt-3 mb-0 fs-7">
                                        <i className="bi bi-info-circle me-2"></i>
                                        {formData.valuation_method === 'UEPS' ? 
                                            <span className="text-warning">Atención: El método UEPS no es aceptado por las normas NIIF/IAS 2 para estados financieros oficiales.</span> :
                                            <span>El método {formData.valuation_method} es totalmente compatible con la normativa vigente.</span>
                                        }
                                    </div>

                                    <div className="modal-footer border-secondary px-0 pb-0 pt-3 mt-3">
                                        <button type="button" className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                                        <button type="submit" className="btn btn-primary">Registrar Artículo</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Movement Modal */}
            {showMovementModal && selectedItem && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                    <div className="modal-dialog">
                        <div className="modal-content glass-panel border-secondary text-white">
                            <div className="modal-header border-secondary border-bottom">
                                <h5 className="modal-title"><i className="bi bi-arrow-left-right me-2"></i>Movimiento - {selectedItem.name}</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => { setShowMovementModal(false); setSelectedItem(null); }}></button>
                            </div>
                            <div className="modal-body">
                                <form onSubmit={handleMovementSubmit}>
                                    <div className="row mb-3">
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">Fecha</label>
                                            <input type="date" className="form-control bg-dark text-white border-secondary" name="date" value={movementData.date} onChange={handleMovementChange} required />
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">Tipo</label>
                                            <select className="form-select bg-dark text-white border-secondary" name="type" value={movementData.type} onChange={handleMovementChange}>
                                                <option value="Entrada">Entrada (Compra/Recepción)</option>
                                                <option value="Salida">Salida (Venta)</option>
                                                <option value="Consumo">Consumo (Para Producción)</option>
                                                <option value="Ajuste">Ajuste / Merma</option>
                                            </select>
                                        </div>
                                    </div>
                                    
                                    <div className="row mb-3">
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">Cantidad</label>
                                            <input type="number" step="0.01" className="form-control bg-dark text-white border-secondary" name="quantity" value={movementData.quantity} onChange={handleMovementChange} required />
                                        </div>
                                        {movementData.type === 'Entrada' && (
                                            <div className="col-md-6">
                                                <label className="form-label text-white-50">Costo Unit. (Bs)</label>
                                                <input type="number" step="0.01" className="form-control bg-dark text-white border-secondary" name="unit_cost" value={movementData.unit_cost} onChange={handleMovementChange} required />
                                            </div>
                                        )}
                                    </div>

                                    {(movementData.type === 'Salida' || movementData.type === 'Consumo') && (
                                        <div className="mb-3">
                                            <label className="form-label text-white-50">Destino (Centro de Costo)</label>
                                            <select className="form-select bg-dark text-white border-secondary" name="cost_center_id" value={movementData.cost_center_id} onChange={handleMovementChange}>
                                                <option value="">-- Sin asignar --</option>
                                                {costCenters.map(cc => (
                                                    <option key={cc.id} value={cc.id}>{cc.code} - {cc.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    <div className="mb-3">
                                        <label className="form-label text-white-50">Glosa / Concepto</label>
                                        <input type="text" className="form-control bg-dark text-white border-secondary" name="gloss" value={movementData.gloss} onChange={handleMovementChange} placeholder="Nro Factura, Vale de Consumo..." />
                                    </div>

                                    <div className="modal-footer px-0 pb-0 pt-3 border-secondary border-top">
                                        <button type="button" className="btn btn-outline-secondary" onClick={() => { setShowMovementModal(false); setSelectedItem(null); }}>Cancelar</button>
                                        <button type="submit" className="btn btn-primary">Registrar Movimiento</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* History Modal */}
            {showHistoryModal && selectedItem && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                    <div className="modal-dialog modal-lg">
                        <div className="modal-content glass-panel border-secondary text-white">
                            <div className="modal-header border-secondary border-bottom">
                                <h5 className="modal-title"><i className="bi bi-clock-history me-2"></i>Kardex: {selectedItem.name}</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowHistoryModal(false)}></button>
                            </div>
                            <div className="modal-body p-0">
                                <div className="table-responsive" style={{maxHeight: '400px'}}>
                                    <table className="table table-dark table-striped table-hover mb-0">
                                        <thead className="position-sticky top-0 bg-dark">
                                            <tr>
                                                <th>Fecha</th>
                                                <th>Concepto</th>
                                                <th>Tipo</th>
                                                <th className="text-end">Cantidad</th>
                                                <th className="text-end">Costo Unit.</th>
                                                <th className="text-end">Total</th>
                                                <th>Destino</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {movementHistory.length === 0 ? (
                                                <tr><td colSpan="7" className="text-center py-4">No hay movimientos registrados.</td></tr>
                                            ) : (
                                                movementHistory.map((mov, i) => (
                                                    <tr key={i}>
                                                        <td>{mov.date}</td>
                                                        <td>{mov.gloss || '-'}</td>
                                                        <td>
                                                            <span className={`badge ${mov.type==='Entrada' ? 'bg-success' : mov.type==='Consumo' ? 'bg-warning' : 'bg-danger'}`}>
                                                                {mov.type}
                                                            </span>
                                                        </td>
                                                        <td className="text-end">{mov.quantity.toFixed(2)}</td>
                                                        <td className="text-end">{(mov.unit_cost || 0).toFixed(2)}</td>
                                                        <td className="text-end">{(mov.total_cost || 0).toFixed(2)}</td>
                                                        <td>{mov.cost_center_name || '-'}</td>
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

            {/* Inventory Table */}
            <div className="card glass-panel border-secondary shadow-sm">
                <div className="card-body p-0">
                    <div className="table-responsive">
                        {loading ? (
                            <div className="text-center py-5 text-white-50">
                                <div className="spinner-border mb-3" role="status"></div>
                                <p>Calculando valuaciones en el servidor...</p>
                            </div>
                        ) : (
                            <table className="table table-dark table-hover mb-0 align-middle border-secondary" style={{ backgroundColor: 'transparent' }}>
                                <thead className="border-secondary text-white-50" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                                    <tr>
                                        <th className="border-secondary">Código</th>
                                        <th className="border-secondary">Nombre</th>
                                        <th className="border-secondary">Tipo</th>
                                        <th className="border-secondary text-center">Método</th>
                                        <th className="text-end border-secondary">Stock</th>
                                        <th className="text-end border-secondary">Costo Unit.</th>
                                        <th className="text-end border-secondary">Valorizado</th>
                                        <th className="border-secondary text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="border-secondary">
                                    {items.length === 0 ? (
                                        <tr>
                                            <td colSpan="8" className="text-center py-5 text-white-50">
                                                <i className="bi bi-inbox fs-1 d-block mb-2"></i>
                                                Inventario vacío
                                            </td>
                                        </tr>
                                    ) : (
                                        items.map((item) => (
                                            <tr key={item.id} className="border-secondary">
                                                <td className="border-secondary"><code>{item.code}</code></td>
                                                <td className="border-secondary text-white fw-bold">{item.name}</td>
                                                <td className="border-secondary">
                                                    <span className={`badge border ${
                                                        item.item_type === 'MP' ? 'border-primary text-primary bg-primary bg-opacity-10' :
                                                        item.item_type === 'WIP' ? 'border-warning text-warning bg-warning bg-opacity-10' :
                                                        'border-success text-success bg-success bg-opacity-10'
                                                    }`}>
                                                        {item.item_type}
                                                    </span>
                                                </td>
                                                <td className="text-center border-secondary text-white-50">
                                                    {item.valuation_method}
                                                    {item.ias2_compliant === 0 && <i className="bi bi-exclamation-triangle-fill text-warning ms-1" title="No cumple IAS 2"></i>}
                                                </td>
                                                <td className="text-end border-secondary text-white">
                                                    {parseFloat(item.quantity || 0).toFixed(2)} {item.unit}
                                                </td>
                                                <td className="text-end border-secondary text-white-50">
                                                    Bs {parseFloat(item.unit_cost || 0).toFixed(2)}
                                                </td>
                                                <td className="text-end fw-bold text-success border-secondary">
                                                    Bs {parseFloat(item.total_cost || 0).toLocaleString('es-BO', {minimumFractionDigits: 2})}
                                                </td>
                                                <td className="border-secondary text-center">
                                                    <button className="btn btn-sm btn-outline-success me-1" title="Registrar Movimiento" onClick={() => { setSelectedItem(item); setShowMovementModal(true); }}>
                                                        <i className="bi bi-plus-slash-minus"></i>
                                                    </button>
                                                    <button className="btn btn-sm btn-outline-primary me-1" title="Ver Historial" onClick={() => viewHistory(item)}>
                                                        <i className="bi bi-clock-history"></i>
                                                    </button>
                                                    <button className="btn btn-sm btn-outline-danger" title="Eliminar Artículo" onClick={async () => {
                                                        if(window.confirm(`¿Eliminar el artículo ${item.code}?`)) {
                                                            await inventoryService.deleteItem(item.id);
                                                            fetchData();
                                                        }
                                                    }}>
                                                        <i className="bi bi-trash"></i>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
