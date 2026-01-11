import React, { useState, useRef } from 'react';
import { exportToPDF, exportToExcel, importFromExcel } from '../utils/exportUtils';

export default function FixedAssets() {
    const [assets, setAssets] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({
        code: '',
        name: '',
        category: 'Muebles y Enseres',
        acquisition_date: new Date().toISOString().split('T')[0],
        acquisition_cost: 0,
        useful_life: 5,
        residual_value: 0
    });
    const fileInputRef = useRef(null);

    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const calculateDepreciation = (asset) => {
        const cost = parseFloat(asset.acquisition_cost);
        const residual = parseFloat(asset.residual_value);
        const life = parseFloat(asset.useful_life);
        const annualDepreciation = (cost - residual) / life;

        const acquisitionDate = new Date(asset.acquisition_date);
        const today = new Date();
        const monthsElapsed = (today.getFullYear() - acquisitionDate.getFullYear()) * 12 +
            (today.getMonth() - acquisitionDate.getMonth());
        const yearsElapsed = monthsElapsed / 12;

        const accumulatedDepreciation = Math.min(annualDepreciation * yearsElapsed, cost - residual);
        const bookValue = cost - accumulatedDepreciation;

        return {
            annualDepreciation,
            accumulatedDepreciation,
            bookValue,
            yearsElapsed: yearsElapsed.toFixed(2)
        };
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const newAsset = {
            id: Date.now(),
            ...formData
        };
        setAssets([...assets, newAsset]);
        setShowModal(false);
        resetForm();
    };

    const resetForm = () => {
        setFormData({
            code: '',
            name: '',
            category: 'Muebles y Enseres',
            acquisition_date: new Date().toISOString().split('T')[0],
            acquisition_cost: 0,
            useful_life: 5,
            residual_value: 0
        });
    };

    const handleExportPDF = () => {
        const exportData = assets.map(asset => {
            const dep = calculateDepreciation(asset);
            return {
                ...asset,
                ...dep
            };
        });
        const columns = [
            { header: 'Código', field: 'code' },
            { header: 'Nombre', field: 'name' },
            { header: 'Costo', field: 'acquisition_cost' },
            { header: 'Dep. Acumulada', field: 'accumulatedDepreciation' },
            { header: 'Valor Libros', field: 'bookValue' }
        ];
        exportToPDF(exportData, columns, 'Activos Fijos');
    };

    const handleExportExcel = () => {
        const exportData = assets.map(asset => {
            const dep = calculateDepreciation(asset);
            return {
                'Código': asset.code,
                'Nombre': asset.name,
                'Categoría': asset.category,
                'Fecha Adquisición': asset.acquisition_date,
                'Costo Adquisición': parseFloat(asset.acquisition_cost).toFixed(2),
                'Vida Útil (años)': asset.useful_life,
                'Valor Residual': parseFloat(asset.residual_value).toFixed(2),
                'Dep. Anual': dep.annualDepreciation.toFixed(2),
                'Dep. Acumulada': dep.accumulatedDepreciation.toFixed(2),
                'Valor en Libros': dep.bookValue.toFixed(2)
            };
        });
        exportToExcel(exportData, 'Activos Fijos', 'activos_fijos');
    };

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const data = await importFromExcel(file);
            const importedAssets = data.map((row, index) => ({
                id: Date.now() + index,
                code: row['Código'] || row.code || `AF-${index + 1}`,
                name: row['Nombre'] || row.name || 'Activo sin nombre',
                category: row['Categoría'] || row.category || 'Otros',
                acquisition_date: row['Fecha Adquisición'] || row.acquisition_date || new Date().toISOString().split('T')[0],
                acquisition_cost: parseFloat(row['Costo Adquisición'] || row['Costo'] || row.cost || 0),
                useful_life: parseInt(row['Vida Útil (años)'] || row['Vida Útil'] || row.useful_life || 5),
                residual_value: parseFloat(row['Valor Residual'] || row.residual_value || 0)
            }));

            setAssets([...assets, ...importedAssets]);
            alert(`Se importaron ${importedAssets.length} activos fijos exitosamente`);
        } catch (error) {
            console.error('Error importing assets:', error);
            alert('Error importando activos. Verifica el formato del archivo.');
        }

        e.target.value = null;
    };

    const totalCost = assets.reduce((sum, asset) => sum + parseFloat(asset.acquisition_cost), 0);
    const totalDepreciation = assets.reduce((sum, asset) => {
        const dep = calculateDepreciation(asset);
        return sum + dep.accumulatedDepreciation;
    }, 0);
    const totalBookValue = totalCost - totalDepreciation;

    return (
        <div>
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2 className="mb-2"><i className="bi bi-building me-2"></i>Activos Fijos</h2>
                    <p className="text-muted mb-0">Registro y depreciación de bienes de uso</p>
                </div>
                <div className="d-flex gap-2">
                    <button className="btn btn-success btn-sm" onClick={handleExportExcel}>
                        <i className="bi bi-file-earmark-excel me-1"></i> Exportar Excel
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={handleExportPDF}>
                        <i className="bi bi-file-earmark-pdf me-1"></i> Exportar PDF
                    </button>
                    <button className="btn btn-info btn-sm" onClick={() => fileInputRef.current.click()}>
                        <i className="bi bi-upload me-1"></i> Importar Excel
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleImport} accept=".xlsx,.xls" style={{ display: 'none' }} />
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                        <i className="bi bi-plus-circle me-1"></i> Nuevo Activo
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="row g-3 mb-4">
                <div className="col-md-4">
                    <div className="card shadow-sm border-0" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                        <div className="card-body text-white">
                            <h6 className="mb-1 opacity-75">Costo Total Activos</h6>
                            <h3 className="mb-0">Bs {totalCost.toFixed(2)}</h3>
                        </div>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="card shadow-sm border-0" style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}>
                        <div className="card-body text-white">
                            <h6 className="mb-1 opacity-75">Depreciación Acumulada</h6>
                            <h3 className="mb-0">Bs {totalDepreciation.toFixed(2)}</h3>
                        </div>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="card shadow-sm border-0" style={{ background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' }}>
                        <div className="card-body text-white">
                            <h6 className="mb-1 opacity-75">Valor en Libros</h6>
                            <h3 className="mb-0">Bs {totalBookValue.toFixed(2)}</h3>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-lg">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title"><i className="bi bi-plus-circle me-2"></i>Nuevo Activo Fijo</h5>
                                <button type="button" className="btn-close" onClick={() => setShowModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <form onSubmit={handleSubmit}>
                                    <div className="row">
                                        <div className="col-md-6 mb-3">
                                            <label className="form-label">Código</label>
                                            <input type="text" className="form-control" name="code" value={formData.code} onChange={handleInputChange} required />
                                        </div>
                                        <div className="col-md-6 mb-3">
                                            <label className="form-label">Categoría</label>
                                            <select className="form-select" name="category" value={formData.category} onChange={handleInputChange}>
                                                <option value="Muebles y Enseres">Muebles y Enseres</option>
                                                <option value="Equipos de Computación">Equipos de Computación</option>
                                                <option value="Vehículos">Vehículos</option>
                                                <option value="Maquinaria">Maquinaria</option>
                                                <option value="Edificios">Edificios</option>
                                                <option value="Terrenos">Terrenos</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="mb-3">
                                        <label className="form-label">Nombre del Activo</label>
                                        <input type="text" className="form-control" name="name" value={formData.name} onChange={handleInputChange} required />
                                    </div>
                                    <div className="row">
                                        <div className="col-md-6 mb-3">
                                            <label className="form-label">Fecha de Adquisición</label>
                                            <input type="date" className="form-control" name="acquisition_date" value={formData.acquisition_date} onChange={handleInputChange} required />
                                        </div>
                                        <div className="col-md-6 mb-3">
                                            <label className="form-label">Costo de Adquisición (Bs)</label>
                                            <input type="number" step="0.01" className="form-control" name="acquisition_cost" value={formData.acquisition_cost} onChange={handleInputChange} required />
                                        </div>
                                    </div>
                                    <div className="row">
                                        <div className="col-md-6 mb-3">
                                            <label className="form-label">Vida Útil (años)</label>
                                            <input type="number" className="form-control" name="useful_life" value={formData.useful_life} onChange={handleInputChange} required />
                                        </div>
                                        <div className="col-md-6 mb-3">
                                            <label className="form-label">Valor Residual (Bs)</label>
                                            <input type="number" step="0.01" className="form-control" name="residual_value" value={formData.residual_value} onChange={handleInputChange} />
                                        </div>
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

            {/* Assets Table */}
            <div className="card shadow-sm border-0">
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-hover mb-0">
                            <thead className="table-light">
                                <tr>
                                    <th>Código</th>
                                    <th>Nombre</th>
                                    <th>Categoría</th>
                                    <th className="text-end">Costo</th>
                                    <th className="text-end">Dep. Acum.</th>
                                    <th className="text-end">Valor Libros</th>
                                    <th className="text-center">Años Uso</th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {assets.length === 0 ? (
                                    <tr>
                                        <td colSpan="8" className="text-center py-4 text-muted">
                                            <i className="bi bi-inbox me-2"></i>No hay activos fijos registrados
                                        </td>
                                    </tr>
                                ) : (
                                    assets.map((asset) => {
                                        const dep = calculateDepreciation(asset);
                                        return (
                                            <tr key={asset.id}>
                                                <td><code>{asset.code}</code></td>
                                                <td>{asset.name}</td>
                                                <td><span className="badge bg-secondary">{asset.category}</span></td>
                                                <td className="text-end">Bs {parseFloat(asset.acquisition_cost).toFixed(2)}</td>
                                                <td className="text-end text-danger">Bs {dep.accumulatedDepreciation.toFixed(2)}</td>
                                                <td className="text-end fw-bold text-primary">Bs {dep.bookValue.toFixed(2)}</td>
                                                <td className="text-center">{dep.yearsElapsed}</td>
                                                <td>
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
