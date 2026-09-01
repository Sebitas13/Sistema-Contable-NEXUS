import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import API_URL from '../api';
import { useCompany } from '../context/CompanyContext';
import { exportToExcel } from '../utils/exportUtils';
import SmartImportWizard from '../components/SmartImportWizard';
import MahoragaWheel from '../components/MahoragaWheel';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';

export default function Accounts() {
    const navigate = useNavigate();
    const { selectedCompany } = useCompany();
    const toast = useToast();
    const confirmDialog = useConfirm();
    const [accounts, setAccounts] = useState([]);
    const [filteredAccounts, setFilteredAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showImportWizard, setShowImportWizard] = useState(false);

    // Preview States
    const [showPDFPreview, setShowPDFPreview] = useState(false);
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
    const [showExcelPreview, setShowExcelPreview] = useState(false);
    const [excelPreviewData, setExcelPreviewData] = useState([]);

    const [editingAccount, setEditingAccount] = useState(null);

    // Search and Filter states
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all');
    const [filterLevel, setFilterLevel] = useState('all');
    const [maxLevel, setMaxLevel] = useState(5);

    const [formData, setFormData] = useState({
        code: '',
        name: '',
        type: 'Activo',
        level: '1',
        parent_code: ''
    });

    // Tipos de cuenta para filtros con iconos
    const ACCOUNT_TYPES = [
        { value: 'Activo', label: 'Activo', icon: 'bi-cash-stack' },
        { value: 'Pasivo', label: 'Pasivo', icon: 'bi-graph-down' },
        { value: 'Patrimonio', label: 'Patrimonio', icon: 'bi-bank' },
        { value: 'Reguladora', label: 'Reguladora', icon: 'bi-scales' },
        { value: 'Orden', label: 'Orden', icon: 'bi-card-list' },
        { value: 'Costo', label: 'Costo', icon: 'bi-box-seam' },
        { value: 'Gasto', label: 'Gasto', icon: 'bi-credit-card' },
        { value: 'Ingreso', label: 'Ingreso', icon: 'bi-arrow-up-circle' },
        { value: 'Resultado', label: 'Resultado', icon: 'bi-graph-up' }
    ];

    const [mahoragaActive, setMahoragaActive] = useState(false);

    useEffect(() => {
        if (selectedCompany) {
            fetchAccounts();
            checkMahoragaStatus();
        }
    }, [selectedCompany]);

    const checkMahoragaStatus = async () => {
        try {
            const response = await axios.get(`${API_URL}/api/ai/mahoraga/config/${selectedCompany.id}`);
            if (response.data.success && Array.isArray(response.data.active_pages)) {
                setMahoragaActive(response.data.active_pages.includes('Accounts'));
            }
        } catch (error) { console.error("Error checking Mahoraga status:", error); }
    };

    useEffect(() => {
        applyFilters();
        if (accounts.length > 0) {
            const max = Math.max(...accounts.map(a => a.level));
            setMaxLevel(max > 0 ? max : 5);
        }
    }, [accounts, searchTerm, filterType, filterLevel]);

    const fetchAccounts = async () => {
        if (!selectedCompany) return;
        try {
            const response = await axios.get(`${API_URL}/api/accounts?companyId=${selectedCompany.id}`);
            setAccounts(response.data.data);
            setLoading(false);
        } catch (error) {
            console.error('Error fetching accounts:', error);
            setLoading(false);
        }
    };

    const applyFilters = () => {
        let filtered = [...accounts];

        // Search filter
        if (searchTerm) {
            filtered = filtered.filter(acc =>
                acc.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                acc.name.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        // Type filter
        if (filterType !== 'all') {
            filtered = filtered.filter(acc => acc.type === filterType);
        }

        // Level filter
        if (filterLevel !== 'all') {
            filtered = filtered.filter(acc => acc.level === parseInt(filterLevel));
        }

        setFilteredAccounts(filtered);
    };

    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    // Validar código duplicado
    const validateUniqueCode = async (code) => {
        if (!code || !selectedCompany) return true;

        try {
            const response = await axios.get(`${API_URL}/api/accounts?companyId=${selectedCompany.id}`);
            const existingAccounts = response.data.data || [];

            // Si estamos editando, excluir la cuenta actual
            const isDuplicate = existingAccounts.some(acc =>
                acc.code === code.trim() && (!editingAccount || acc.id !== editingAccount.id)
            );

            return !isDuplicate;
        } catch (error) {
            console.error('Error validating code:', error);
            return true; // En caso de error, permitir continuar
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!selectedCompany) {
            toast.warning('No hay una empresa seleccionada.');
            return;
        }

        // Validar código único
        const isUnique = await validateUniqueCode(formData.code);
        if (!isUnique) {
            toast.warning(`El código "${formData.code}" ya existe. Por favor usa un código diferente.`);
            return;
        }

        // Validar que el código no esté vacío
        if (!formData.code.trim() || !formData.name.trim()) {
            toast.warning('El código y nombre son obligatorios.');
            return;
        }

        try {
            const dataToSend = { ...formData, companyId: selectedCompany.id };

            if (editingAccount) {
                await axios.put(`${API_URL}/api/accounts/${editingAccount.id}`, dataToSend);
            } else {
                await axios.post(`${API_URL}/api/accounts`, dataToSend);
            }
            setShowModal(false);
            setEditingAccount(null);
            fetchAccounts();
            resetForm();
        } catch (error) {
            console.error('Error saving account:', error);
            if (error.response?.status === 409) {
                toast.warning('Ya existe una cuenta con este código.');
            } else {
                toast.error('Error guardando cuenta: ' + (error.response?.data?.error || error.message));
            }
        }
    };

    const handleEdit = (account) => {
        setEditingAccount(account);
        setFormData({
            code: account.code,
            name: account.name,
            type: account.type,
            level: account.level.toString(),
            parent_code: account.parent_code || ''
        });
        setShowModal(true);
    };

    const handleDelete = async (id) => {
        if (!selectedCompany) return;
        const ok = await confirmDialog({
            title: 'Eliminar cuenta',
            message: '¿Está seguro de eliminar esta cuenta?',
            confirmText: 'Eliminar',
            danger: true
        });
        if (!ok) return;
        try {
            await axios.delete(`${API_URL}/api/accounts/${id}?companyId=${selectedCompany.id}`);
            fetchAccounts();
        } catch (error) {
            console.error('Error deleting account:', error);
            toast.error('Error eliminando cuenta');
        }
    };

    const handleDeleteAll = async () => {
        if (!selectedCompany) return;
        const firstOk = await confirmDialog({
            title: 'Eliminar TODO el plan de cuentas',
            message: 'Esta acción no se puede deshacer y eliminará todas las cuentas registradas.',
            confirmText: 'Continuar',
            danger: true
        });
        if (!firstOk) return;
        const finalOk = await confirmDialog({
            title: 'CONFIRMACIÓN FINAL',
            message: '¿Realmente desea vaciar el plan de cuentas?',
            confirmText: 'Sí, vaciar todo',
            danger: true
        });
        if (!finalOk) return;
        try {
            await axios.delete(`${API_URL}/api/accounts/all?companyId=${selectedCompany.id}`);
            fetchAccounts();
            toast.success('Plan de cuentas eliminado correctamente.');
        } catch (error) {
            console.error('Error deleting all accounts:', error);
            toast.error('Error eliminando el plan de cuentas.');
        }
    };

    const resetForm = () => {
        setFormData({
            code: '',
            name: '',
            type: 'Activo',
            level: '1',
            parent_code: ''
        });
    };

    const openNewAccountModal = () => {
        setEditingAccount(null);
        resetForm();
        setShowModal(true);
    };

    const prepareExportData = () => {
        return filteredAccounts.map(acc => ({
            Código: acc.code,
            Nombre: acc.name,
            Tipo: acc.type,
            Nivel: acc.level,
            'Cuenta Padre': acc.parent_code || ''
        }));
    };

    const handleExportPDF = async () => {
        try {
            const { jsPDF } = await import('jspdf');
            const autoTable = (await import('jspdf-autotable')).default;

            const doc = new jsPDF('landscape');

            // Initialize autoTable
            // autoTable(doc); // Some versions require this, but usually just importing is enough if side-effect.
            // However, with dynamic import, we might need to ensure it's registered.
            // The safest way with jspdf-autotable v3+ is:

            doc.setFontSize(18);
            doc.text('Plan de Cuentas', 14, 15);
            doc.setFontSize(10);
            doc.text(`Total: ${filteredAccounts.length} cuentas`, 14, 22);

            const tableData = filteredAccounts.map(acc => [
                acc.code,
                acc.name,
                acc.type,
                acc.level.toString(),
                acc.parent_code || '-'
            ]);

            autoTable(doc, {
                head: [['Código', 'Nombre', 'Tipo', 'Nivel', 'Cuenta Padre']],
                body: tableData,
                startY: 28,
                theme: 'grid',
                headStyles: { fillColor: [13, 110, 253], fontSize: 9 },
                styles: { fontSize: 8 },
                columnStyles: {
                    0: { cellWidth: 30 },
                    1: { cellWidth: 90 },
                    2: { cellWidth: 30 },
                    3: { cellWidth: 20 },
                    4: { cellWidth: 30 }
                }
            });

            const pdfBlob = doc.output('blob');
            const url = URL.createObjectURL(pdfBlob);
            setPdfPreviewUrl(url);
            setShowPDFPreview(true);
        } catch (error) {
            console.error('Error generating PDF:', error);
            toast.error('Error generando PDF. Verifique la consola para más detalles.');
        }
    };

    const handleExportExcelPreview = () => {
        const data = prepareExportData();
        setExcelPreviewData(data);
        setShowExcelPreview(true);
    };

    const confirmExportExcel = () => {
        exportToExcel(excelPreviewData, 'Plan de Cuentas', 'plan_de_cuentas');
        setShowExcelPreview(false);
    };

    const clearFilters = () => {
        setSearchTerm('');
        setFilterType('all');
        setFilterLevel('all');
    };

    // Compute available types and levels for dynamic filters
    const availableTypes = [...new Set(accounts.map(a => a.type))].sort();
    const availableLevels = [...new Set(accounts.map(a => a.level))].sort((a, b) => a - b);

    return (
        <div>
            <div className="d-flex flex-column flex-lg-row justify-content-between align-items-start align-items-lg-center gap-3 mb-4">
                <div>
                    <h2 className="mb-1 text-white"><i className="bi bi-journal-text me-2" style={{ color: 'var(--accent-primary)' }}></i>Plan de Cuentas</h2>
                    <small className="text-white-50">{accounts.length} cuentas totales | {filteredAccounts.length} mostradas</small>
                </div>
                <div className="d-flex flex-wrap gap-2 align-items-center">
                    {mahoragaActive && <MahoragaWheel size="small" />}
                    <button className="btn btn-danger btn-sm" onClick={handleDeleteAll} title="Eliminar todo el plan de cuentas">
                        <i className="bi bi-trash3-fill me-1"></i> <span className="d-none d-md-inline">Eliminar Todo</span>
                    </button>
                    <div className="vr mx-1 d-none d-sm-block"></div>
                    <button className="btn btn-success btn-sm" onClick={handleExportExcelPreview}>
                        <i className="bi bi-file-earmark-excel me-1"></i> Excel
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={handleExportPDF}>
                        <i className="bi bi-file-earmark-pdf me-1"></i> PDF
                    </button>
                    <button className="btn btn-info btn-sm" onClick={() => setShowImportWizard(true)}>
                        <i className="bi bi-magic me-1"></i> <span className="d-none d-sm-inline">Importar</span>
                    </button>
                    <button className="btn btn-warning btn-sm" style={{ color: '#000' }} onClick={() => navigate('/data-forge')}>
                        <i className="bi bi-lightning-charge-fill me-1"></i> DataForge
                    </button>
                    <button className="btn btn-premium btn-sm px-3" onClick={openNewAccountModal}>
                        <i className="bi bi-plus-circle me-1"></i> <span className="d-none d-sm-inline">Nueva Cuenta</span>
                    </button>
                </div>
            </div>


            {/* Smart Import Wizard */}
            {showImportWizard && (
                <SmartImportWizard
                    onClose={() => setShowImportWizard(false)}
                    onSuccess={fetchAccounts}
                />
            )}

            {/* Search and Filters */}
            <div className="card glass-panel border-0 mb-3">
                <div className="card-body">
                    <div className="row g-3">
                        <div className="col-md-5">
                            <div className="input-group">
                                <span className="input-group-text bg-dark text-white-50 border-secondary"><i className="bi bi-search"></i></span>
                                <input
                                    type="text"
                                    className="form-control bg-dark text-white border-secondary"
                                    placeholder="Buscar por código o nombre..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="col-md-3">
                            <select className="form-select bg-dark text-white border-secondary" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                                <option value="all">Todos los tipos ({availableTypes.length})</option>
                                {availableTypes.map(type => {
                                    const typeInfo = ACCOUNT_TYPES.find(t => t.value === type);
                                    return (
                                        <option key={type} value={type}>
                                            {typeInfo ? typeInfo.label : type}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                        <div className="col-md-2">
                            <select className="form-select bg-dark text-white border-secondary" value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
                                <option value="all">Todos los niveles</option>
                                {availableLevels.map(level => (
                                    <option key={level} value={level}>Nivel {level}</option>
                                ))}
                            </select>
                        </div>
                        <div className="col-md-2">
                            <button className="btn btn-outline-light w-100" onClick={clearFilters}>
                                <i className="bi bi-x-circle me-1"></i> Limpiar Filtros
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* PDF Preview Modal */}
            {showPDFPreview && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
                    <div className="modal-dialog modal-xl modal-dialog-centered">
                        <div className="modal-content glass-panel border-secondary text-white">
                            <div className="modal-header border-secondary">
                                <h5 className="modal-title"><i className="bi bi-file-earmark-pdf me-2"></i>Vista Previa del PDF</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => { setShowPDFPreview(false); URL.revokeObjectURL(pdfPreviewUrl); }}></button>
                            </div>
                            <div className="modal-body" style={{ height: '70vh', overflow: 'hidden' }}>
                                <iframe src={pdfPreviewUrl} style={{ width: '100%', height: '100%', border: 'none' }}></iframe>
                            </div>
                            <div className="modal-footer border-secondary">
                                <button className="btn btn-outline-secondary" onClick={() => { setShowPDFPreview(false); URL.revokeObjectURL(pdfPreviewUrl); }}>Cerrar</button>
                                <a href={pdfPreviewUrl} download="plan_de_cuentas.pdf" className="btn btn-danger">
                                    <i className="bi bi-download me-1"></i> Descargar PDF
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Excel Preview Modal */}
            {showExcelPreview && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
                    <div className="modal-dialog modal-lg modal-dialog-centered">
                        <div className="modal-content glass-panel border-secondary text-white">
                            <div className="modal-header border-secondary">
                                <h5 className="modal-title"><i className="bi bi-file-earmark-excel me-2 text-success"></i>Vista Previa de Exportación Excel</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowExcelPreview(false)}></button>
                            </div>
                            <div className="modal-body">
                                <p className="text-white-50">Se exportarán <strong>{excelPreviewData.length}</strong> registros con las siguientes columnas:</p>
                                <div className="table-responsive" style={{ maxHeight: '400px' }}>
                                    <table className="table table-dark table-sm table-bordered table-striped border-secondary">
                                        <thead className="table-dark sticky-top border-secondary">
                                            <tr>
                                                <th>Código</th>
                                                <th>Nombre</th>
                                                <th>Tipo</th>
                                                <th>Nivel</th>
                                                <th>Padre</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {excelPreviewData.slice(0, 10).map((row, idx) => (
                                                <tr key={idx}>
                                                    <td>{row.Código}</td>
                                                    <td>{row.Nombre}</td>
                                                    <td>{row.Tipo}</td>
                                                    <td>{row.Nivel}</td>
                                                    <td>{row['Cuenta Padre']}</td>
                                                </tr>
                                            ))}
                                            {excelPreviewData.length > 10 && (
                                                <tr>
                                                    <td colSpan="5" className="text-center text-white-50 fst-italic">
                                                        ... y {excelPreviewData.length - 10} filas más
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div className="modal-footer border-secondary">
                                <button className="btn btn-outline-secondary" onClick={() => setShowExcelPreview(false)}>Cancelar</button>
                                <button className="btn btn-success" onClick={confirmExportExcel}>
                                    <i className="bi bi-download me-1"></i> Confirmar Descarga
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* New/Edit Account Modal */}
            {showModal && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content glass-panel border-secondary text-white">
                            <div className="modal-header border-secondary border-bottom">
                                <h5 className="modal-title"><i className={`bi ${editingAccount ? 'bi-pencil text-warning' : 'bi-plus-circle text-primary'} me-2`}></i>{editingAccount ? 'Editar Cuenta' : 'Nueva Cuenta'}</h5>
                                <button type="button" className="btn-close btn-close-white" onClick={() => setShowModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <form onSubmit={handleSubmit}>
                                    <div className="mb-3">
                                        <label className="form-label text-white-50">Código</label>
                                        <input type="text" className="form-control bg-dark text-white border-secondary" name="code" value={formData.code} onChange={handleInputChange} required placeholder="Ej: 1.1.1.01" />
                                    </div>
                                    <div className="mb-3">
                                        <label className="form-label text-white-50">Nombre</label>
                                        <input type="text" className="form-control bg-dark text-white border-secondary" name="name" value={formData.name} onChange={handleInputChange} required placeholder="Nombre de la cuenta" />
                                    </div>
                                    <div className="mb-3">
                                        <label className="form-label text-white-50">Tipo</label>
                                        <select className="form-select bg-dark text-white border-secondary" name="type" value={formData.type} onChange={handleInputChange}>
                                            {ACCOUNT_TYPES.map(type => (
                                                <option key={type.value} value={type.value}>{type.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="row">
                                        <div className="col-md-6 mb-3">
                                            <label className="form-label text-white-50">Nivel</label>
                                            <input type="number" className="form-control bg-dark text-white border-secondary" name="level" value={formData.level} onChange={handleInputChange} required min="1" max="5" />
                                        </div>
                                        <div className="col-md-6 mb-3">
                                            <label className="form-label text-white-50">Cuenta Padre (Código)</label>
                                            <input type="text" className="form-control bg-dark text-white border-secondary" name="parent_code" value={formData.parent_code} onChange={handleInputChange} placeholder="Opcional" />
                                        </div>
                                    </div>
                                    <div className="modal-footer border-secondary px-0 pb-0 justify-content-end gap-2">
                                        <button type="button" className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                                        <button type="submit" className="btn btn-premium px-4 border-0"><i className="bi bi-save me-2"></i>Guardar</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Accounts Table */}
            <div className="card glass-panel border-0">
                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-dark table-hover mb-0" style={{ backgroundColor: 'transparent' }}>
                            <thead className="sticky-top" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                                <tr>
                                    <th style={{ width: '120px' }} className="border-secondary text-white-50">Código</th>
                                    <th className="border-secondary text-white-50">Nombre</th>
                                    <th style={{ width: '100px' }} className="border-secondary text-white-50">Tipo</th>
                                    <th style={{ width: '80px' }} className="border-secondary text-white-50">Nivel</th>
                                    <th style={{ width: '120px' }} className="border-secondary text-white-50">Cuenta Padre</th>
                                    <th style={{ width: '150px' }} className="border-secondary text-white-50">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan="6" className="text-center py-4 border-secondary">
                                            <div className="spinner-border text-primary" role="status"></div>
                                        </td>
                                    </tr>
                                ) : filteredAccounts.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="text-center py-4 text-white-50 border-secondary">
                                            <i className="bi bi-inbox me-2"></i>
                                            {searchTerm || filterType !== 'all' || filterLevel !== 'all'
                                                ? 'No se encontraron cuentas con los filtros aplicados'
                                                : 'No hay cuentas registradas'}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredAccounts.map((account) => {
                                        const typeInfo = ACCOUNT_TYPES.find(t => t.value === account.type);
                                        return (
                                            <tr key={account.id} className="border-secondary">
                                                <td className="border-secondary"><code className="text-primary">{account.code}</code></td>
                                                <td className="border-secondary text-white">{account.name}</td>
                                                <td className="border-secondary">
                                                    <span className={`badge bg-${account.type === 'Activo' || account.type === 'Ingreso' ? 'success' :
                                                        account.type === 'Pasivo' || account.type === 'Gasto' ? 'danger' :
                                                            account.type === 'Patrimonio' ? 'primary' : 'secondary'
                                                        }`}>
                                                        {typeInfo && <i className={`bi ${typeInfo.icon} me-1`}></i>}
                                                        {account.type}
                                                    </span>
                                                </td>
                                                <td className="text-center border-secondary">
                                                    <span className="badge bg-dark text-white border border-secondary">{account.level}</span>
                                                </td>
                                                <td className="border-secondary"><small className="text-white-50">{account.parent_code || '-'}</small></td>
                                                <td className="border-secondary">
                                                    <button className="btn btn-sm btn-outline-primary me-1" onClick={() => handleEdit(account)} title="Editar">
                                                        <i className="bi bi-pencil"></i>
                                                    </button>
                                                    <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(account.id)} title="Eliminar">
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
