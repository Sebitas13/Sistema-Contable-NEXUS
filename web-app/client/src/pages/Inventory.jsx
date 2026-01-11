import React, { useState, useRef } from 'react';
import { exportToPDF, exportToExcel, importFromExcel } from '../utils/exportUtils';

export default function Inventory() {
    const [items, setItems] = useState([]);
    const [selectedItem, setSelectedItem] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [showMovementModal, setShowMovementModal] = useState(false);
    const [valuationMethod, setValuationMethod] = useState('CPP'); // PEPS, UEPS, CPP, IE
    const [formData, setFormData] = useState({
        code: '',
        name: '',
        unit: 'Unidad',
        initial_quantity: 0,
        initial_cost: 0
    });
    const [movementData, setMovementData] = useState({
        type: 'Entrada',
        quantity: 0,
        unit_cost: 0,
        date: new Date().toISOString().split('T')[0]
    });
    const fileInputRef = useRef(null);

    const calculateInventory = (item, method = valuationMethod) => {
        if (!item.movements || item.movements.length === 0) {
            return {
                quantity: parseFloat(item.initial_quantity || 0),
                value: parseFloat(item.initial_quantity || 0) * parseFloat(item.initial_cost || 0),
                unit_cost: parseFloat(item.initial_cost || 0)
            };
        }

        let inventory = [{
            type: 'Inicial',
            quantity: parseFloat(item.initial_quantity || 0),
            unit_cost: parseFloat(item.initial_cost || 0),
            total: parseFloat(item.initial_quantity || 0) * parseFloat(item.initial_cost || 0)
        }];

        item.movements.forEach(movement => {
            if (movement.type === 'Entrada') {
                inventory.push({
                    type: 'Entrada',
                    quantity: parseFloat(movement.quantity),
                    unit_cost: parseFloat(movement.unit_cost),
                    total: parseFloat(movement.quantity) * parseFloat(movement.unit_cost)
                });
            } else if (movement.type === 'Salida') {
                const exitQty = parseFloat(movement.quantity);

                if (method === 'PEPS') { // FIFO
                    let remaining = exitQty;
                    inventory = inventory.filter(batch => {
                        if (remaining <= 0) return true;
                        if (batch.quantity <= remaining) {
                            remaining -= batch.quantity;
                            return false;
                        } else {
                            batch.quantity -= remaining;
                            batch.total = batch.quantity * batch.unit_cost;
                            remaining = 0;
                            return true;
                        }
                    });
                } else if (method === 'UEPS') { // LIFO
                    let remaining = exitQty;
                    for (let i = inventory.length - 1; i >= 0 && remaining > 0; i--) {
                        if (inventory[i].quantity <= remaining) {
                            remaining -= inventory[i].quantity;
                            inventory.splice(i, 1);
                        } else {
                            inventory[i].quantity -= remaining;
                            inventory[i].total = inventory[i].quantity * inventory[i].unit_cost;
                            remaining = 0;
                        }
                    }
                } else if (method === 'CPP') { // Weighted Average
                    const totalQty = inventory.reduce((sum, b) => sum + b.quantity, 0);
                    const totalValue = inventory.reduce((sum, b) => sum + b.total, 0);
                    const avgCost = totalValue / totalQty;
                    const newQty = totalQty - exitQty;
                    inventory = [{
                        type: 'Promedio',
                        quantity: newQty,
                        unit_cost: avgCost,
                        total: newQty * avgCost
                    }];
                }
            }
        });

        const finalQty = inventory.reduce((sum, b) => sum + b.quantity, 0);
        const finalValue = inventory.reduce((sum, b) => sum + b.total, 0);

        return {
            quantity: finalQty,
            value: finalValue,
            unit_cost: finalQty > 0 ? finalValue / finalQty : 0
        };
    };

    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleMovementChange = (e) => {
        setMovementData({ ...movementData, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const newItem = {
            id: Date.now(),
            ...formData,
            movements: []
        };
        setItems([...items, newItem]);
        setShowModal(false);
        resetForm();
    };

    const handleMovementSubmit = (e) => {
        e.preventDefault();
        const updatedItems = items.map(item => {
            if (item.id === selectedItem.id) {
                return {
                    ...item,
                    movements: [...(item.movements || []), { ...movementData, id: Date.now() }]
                };
            }
            return item;
        });
        setItems(updatedItems);
        setShowMovementModal(false);
        setSelectedItem(null);
        setMovementData({
            type: 'Entrada',
            quantity: 0,
            unit_cost: 0,
            date: new Date().toISOString().split('T')[0]
        });
    };

    const resetForm = () => {
        setFormData({
            code: '',
            name: '',
            unit: 'Unidad',
            initial_quantity: 0,
            initial_cost: 0
        });
    };

    const handleExportPDF = () => {
        const exportData = items.map(item => {
            const calc = calculateInventory(item);
            return { ...item, ...calc };
        });
        const columns = [
            { header: 'Código', field: 'code' },
            { header: 'Nombre', field: 'name' },
            { header: 'Unidad', field: 'unit' },
            { header: 'Cantidad', field: 'quantity' },
            { header: 'Costo Unit.', field: 'unit_cost' }
        ];
        exportToPDF(exportData, columns, `Inventario Kardex - ${valuationMethod}`);
    };

    const handleExportExcel = () => {
        const exportData = items.map(item => {
            const calc = calculateInventory(item);
            return {
                'Código': item.code,
                'Nombre': item.name,
                'Unidad': item.unit,
                'Método': valuationMethod,
                'Cantidad': calc.quantity.toFixed(2),
                'Costo Unitario': calc.unit_cost.toFixed(2),
                'Valor Total': calc.value.toFixed(2)
            };
        });
        exportToExcel(exportData, 'Inventario', `inventario_${valuationMethod.toLowerCase()}`);
    };

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const data = await importFromExcel(file);
            const importedItems = data.map((row, index) => ({
                id: Date.now() + index,
                code: row['Código'] || row.code || `ITEM-${index + 1}`,
                name: row['Nombre'] || row.name || 'Artículo sin nombre',
                unit: row['Unidad'] || row.unit || 'Unidad',
                initial_quantity: parseFloat(row['Cantidad Inicial'] || row['Cantidad'] || row.quantity || 0),
                initial_cost: parseFloat(row['Costo Inicial'] || row['Costo'] || row.cost || 0),
                movements: []
            }));

            setItems([...items, ...importedItems]);
            alert(`Se importaron ${importedItems.length} artículos exitosamente`);
        } catch (error) {
            console.error('Error importing inventory:', error);
            alert('Error importando inventario. Verifica el formato del archivo.');
        }

        e.target.value = null;
    };

    const totalValue = items.reduce((sum, item) => {
        const calc = calculateInventory(item);
        return sum + calc.value;
    }, 0);

    return (
        <div>
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2 className="mb-2"><i className="bi bi-box-seam me-2"></i>Inventarios (Kardex)</h2>
                    <p className="text-muted mb-0">Control de existencias con métodos de valuación</p>
                </div>
                <div className="d-flex gap-2">
                    <select className="form-select form-select-sm" value={valuationMethod} onChange={(e) => setValuationMethod(e.target.value)} style={{ width: 'auto' }}>
                        <option value="PEPS">PEPS (FIFO)</option>
                        <option value="UEPS">UEPS (LIFO)</option>
                        <option value="CPP">CPP (Promedio)</option>
                        <option value="IE">IE (Identificación)</option>
                    </select>
                    <button className="btn btn-success btn-sm" onClick={handleExportExcel}>
                        <i className="bi bi-file-earmark-excel me-1"></i> Exportar
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={handleExportPDF}>
                        <i className="bi bi-file-earmark-pdf me-1"></i> PDF
                    </button>
                    <button className="btn btn-info btn-sm" onClick={() => fileInputRef.current.click()}>
                        <i className="bi bi-upload me-1"></i> Importar
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleImport} accept=".xlsx,.xls" style={{ display: 'none' }} />
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                        <i className="bi bi-plus-circle me-1"></i> Nuevo Artículo
                    </button>
                </div>
            </div>

            {/* Method Info Card */}
            <div className="alert alert-info mb-4">
                <h6 className="mb-1"><i className="bi bi-info-circle me-2"></i>Método Actual: <strong>{valuationMethod}</strong></h6>
                <small>
                    {valuationMethod === 'PEPS' && 'Primeros en Entrar, Primeros en Salir - Las primeras compras son las primeras en salir del inventario'}
                    {valuationMethod === 'UEPS' && 'Últimos en Entrar, Primeros en Salir - Las últimas compras son las primeras en salir del inventario'}
                    {valuationMethod === 'CPP' && 'Costo Promedio Ponderado - Se calcula un costo promedio de todas las compras'}
                    {valuationMethod === 'IE' && 'Identificación Específica - Cada artículo se identifica individualmente con su costo específico'}
                </small>
            </div>

            {/* Summary Cards */}
            <div className="row g-3 mb-4">
                <div className="col-md-4">
                    <div className="card shadow-sm border-0 bg-primary text-white">
                        <div className="card-body">
                            <h6 className="mb-1">Total Artículos</h6>
                            <h3 className="mb-0">{items.length}</h3>
                        </div>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="card shadow-sm border-0 bg-success text-white">
                        <div className="card-body">
                            <h6 className="mb-1">Valor Total Inventario ({valuationMethod})</h6>
                            <h3 className="mb-0">Bs {totalValue.toFixed(2)}</h3>
                        </div>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="card shadow-sm border-0 bg-info text-white">
                        <div className="card-body">
                            <h6 className="mb-1">Unidades Totales</h6>
                            <h3 className="mb-0">{items.reduce((sum, item) => sum + calculateInventory(item).quantity, 0).toFixed(2)}</h3>
                        </div>
                    </div>
                </div>
            </div>

            {/* New Item Modal */}
            {showModal && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title"><i className="bi bi-plus-circle me-2"></i>Nuevo Artículo</h5>
                                <button type="button" className="btn-close" onClick={() => setShowModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <form onSubmit={handleSubmit}>
                                    <div className="mb-3">
                                        <label className="form-label">Código</label>
                                        <input type="text" className="form-control" name="code" value={formData.code} onChange={handleInputChange} required />
                                    </div>
                                    <div className="mb-3">
                                        <label className="form-label">Nombre del Artículo</label>
                                        <input type="text" className="form-control" name="name" value={formData.name} onChange={handleInputChange} required />
                                    </div>
                                    <div className="row">
                                        <div className="col-md-6 mb-3">
                                            <label className="form-label">Unidad</label>
                                            <select className="form-select" name="unit" value={formData.unit} onChange={handleInputChange}>
                                                <option value="Unidad">Unidad</option>
                                                <option value="Kg">Kg</option>
                                                <option value="Litro">Litro</option>
                                                <option value="Metro">Metro</option>
                                                <option value="Caja">Caja</option>
                                            </select>
                                        </div>
                                        <div className="col-md-6 mb-3">
                                            <label className="form-label">Cantidad Inicial</label>
                                            <input type="number" step="0.01" className="form-control" name="initial_quantity" value={formData.initial_quantity} onChange={handleInputChange} required />
                                        </div>
                                    </div>
                                    <div className="mb-3">
                                        <label className="form-label">Costo Unitario Inicial (Bs)</label>
                                        <input type="number" step="0.01" className="form-control" name="initial_cost" value={formData.initial_cost} onChange={handleInputChange} required />
                                    </div>
                                    <div className="modal-footer px-0 pb-0">
                                        <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                                        <button type="submit" className="btn btn-primary">Guardar</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Movement Modal */}
            {showMovementModal && selectedItem && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title"><i className="bi bi-arrow-left-right me-2"></i>Nuevo Movimiento - {selectedItem.name}</h5>
                                <button type="button" className="btn-close" onClick={() => { setShowMovementModal(false); setSelectedItem(null); }}></button>
                            </div>
                            <div className="modal-body">
                                <form onSubmit={handleMovementSubmit}>
                                    <div className="mb-3">
                                        <label className="form-label">Fecha</label>
                                        <input type="date" className="form-control" name="date" value={movementData.date} onChange={handleMovementChange} required />
                                    </div>
                                    <div className="mb-3">
                                        <label className="form-label">Tipo de Movimiento</label>
                                        <select className="form-select" name="type" value={movementData.type} onChange={handleMovementChange}>
                                            <option value="Entrada">Entrada (Compra)</option>
                                            <option value="Salida">Salida (Venta)</option>
                                        </select>
                                    </div>
                                    <div className="mb-3">
                                        <label className="form-label">Cantidad</label>
                                        <input type="number" step="0.01" className="form-control" name="quantity" value={movementData.quantity} onChange={handleMovementChange} required />
                                    </div>
                                    {movementData.type === 'Entrada' && (
                                        <div className="mb-3">
                                            <label className="form-label">Costo Unitario (Bs)</label>
                                            <input type="number" step="0.01" className="form-control" name="unit_cost" value={movementData.unit_cost} onChange={handleMovementChange} required />
                                        </div>
                                    )}
                                    <div className="modal-footer px-0 pb-0">
                                        <button type="button" className="btn btn-secondary" onClick={() => { setShowMovementModal(false); setSelectedItem(null); }}>Cancelar</button>
                                        <button type="submit" className="btn btn-primary">Registrar</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Inventory Table */}
            <div className="card shadow-sm border-0">
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-hover mb-0">
                            <thead className="table-light">
                                <tr>
                                    <th>Código</th>
                                    <th>Nombre</th>
                                    <th>Unidad</th>
                                    <th className="text-end">Cantidad</th>
                                    <th className="text-end">Costo Unit.</th>
                                    <th className="text-end">Valor Total</th>
                                    <th>Movimientos</th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 ? (
                                    <tr>
                                        <td colSpan="8" className="text-center py-4 text-muted">
                                            <i className="bi bi-inbox me-2"></i>No hay artículos registrados
                                        </td>
                                    </tr>
                                ) : (
                                    items.map((item) => {
                                        const calc = calculateInventory(item);
                                        return (
                                            <tr key={item.id}>
                                                <td><code>{item.code}</code></td>
                                                <td>{item.name}</td>
                                                <td><span className="badge bg-secondary">{item.unit}</span></td>
                                                <td className="text-end">{calc.quantity.toFixed(2)}</td>
                                                <td className="text-end">Bs {calc.unit_cost.toFixed(2)}</td>
                                                <td className="text-end fw-bold">Bs {calc.value.toFixed(2)}</td>
                                                <td><span className="badge bg-info">{(item.movements || []).length}</span></td>
                                                <td>
                                                    <button className="btn btn-sm btn-outline-success me-1" onClick={() => { setSelectedItem(item); setShowMovementModal(true); }}>
                                                        <i className="bi bi-plus"></i>
                                                    </button>
                                                    <button className="btn btn-sm btn-outline-primary me-1">
                                                        <i className="bi bi-eye"></i>
                                                    </button>
                                                    <button className="btn btn-sm btn-outline-danger">
                                                        <i className="bi bi-trash"></i>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
