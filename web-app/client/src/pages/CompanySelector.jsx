import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import DatePicker from 'react-datepicker';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import 'react-datepicker/dist/react-datepicker.css';
import { useCompany } from '../context/CompanyContext';
import CompanyCard from '../components/CompanyCard';
import API_URL from '../api';

export default function CompanySelector() {
    const navigate = useNavigate();
    const { companies, loading, deleteCompany, refreshCompanies, createCompany, updateCompany, selectCompany } = useCompany();

    // Constantes de Tipos Societarios y Actividades
    const SOCIETAL_TYPES = [
        { value: 'Unipersonal', label: 'Empresa Unipersonal' },
        { value: 'S.R.L', label: 'Sociedad de Responsabilidad Limitada (S.R.L.)' },
        { value: 'S.A', label: 'Sociedad Anónima (S.A.)' },
        { value: 'S.C', label: 'Sociedad Colectiva (S.C.)' },
        { value: 'S.C.S', label: 'Sociedad en Comandita Simple (S.C.S.)' },
        { value: 'S.C.A', label: 'Sociedad en Comandita por Acciones (S.C.A.)' },
        { value: 'Asociacion', label: 'Asociación Accidental o Cuentas en Participación' }
    ];

    const ACTIVITY_TYPES = [
        { value: 'Comercial', label: 'Comerciales, Servicios, Bancos y Seguros', start: '01-01', end: '31-12' },
        { value: 'Industrial', label: 'Industriales, Constructoras y Petroleras', start: '04-01', end: '31-03' },
        { value: 'Agroindustrial', label: 'Gomeras, Castañeras, Agrícolas y Ganaderas', start: '07-01', end: '30-06' },
        { value: 'Minera', label: 'Mineras', start: '10-01', end: '30-09' }
    ];

    const [showModal, setShowModal] = useState(false);
    const [editingCompany, setEditingCompany] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    // --- Restore Backup State ---
    const [showRestoreModal, setShowRestoreModal] = useState(false);
    const [restoreLoading, setRestoreLoading] = useState(false);
    const [restoreProgress, setRestoreProgress] = useState(0);
    const [restoreError, setRestoreError] = useState(null);
    const [restoreDryRunData, setRestoreDryRunData] = useState(null);
    const [restoreSuccess, setRestoreSuccess] = useState(false);
    const [restoreResult, setRestoreResult] = useState(null);
    const [restoreSelectedFile, setRestoreSelectedFile] = useState(null);
    const restoreFileRef = useRef(null);
    const [formData, setFormData] = useState({
        name: '',
        nit: '',
        legal_name: '',
        address: '',
        city: '',
        country: 'Bolivia',
        phone: '',
        email: '',
        website: '',
        currency: 'BOB',
        fiscal_year_start: '01-01',
        societal_type: 'Unipersonal',
        activity_type: 'Comercial',
        operation_start_date: ''
    });

    useEffect(() => {
        refreshCompanies();
    }, []);

    const filteredCompanies = companies.filter(company =>
        company.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (company.nit && company.nit.includes(searchTerm))
    );

    const handleEdit = (company) => {
        setEditingCompany(company);
        setFormData({
            name: company.name || '',
            nit: company.nit || '',
            legal_name: company.legal_name || '',
            address: company.address || '',
            city: company.city || '',
            country: company.country || 'Bolivia',
            phone: company.phone || '',
            email: company.email || '',
            website: company.website || '',
            currency: company.currency || 'BOB',
            fiscal_year_start: company.fiscal_year_start || '01-01',
            societal_type: company.societal_type || 'Unipersonal',
            activity_type: company.activity_type || 'Comercial',
            operation_start_date: company.operation_start_date || '',
            current_year: company.current_year ? parseInt(company.current_year) : new Date().getFullYear()
        });
        setShowModal(true);
    };

    const handleDelete = async (company) => {
        if (company.id === 1) {
            alert('No se puede eliminar la empresa predeterminada');
            return;
        }

        if (window.confirm(`¿Estás seguro de eliminar "${company.name}"? Todos los datos asociados se eliminarán permanentemente.`)) {
            const result = await deleteCompany(company.id);
            if (result.success) {
                alert('Empresa eliminada exitosamente');
            } else {
                alert('Error al eliminar la empresa: ' + result.error);
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        const result = editingCompany
            ? await updateCompany(editingCompany.id, formData)
            : await createCompany(formData);

        if (result.success) {
            setShowModal(false);
            setEditingCompany(null);
            resetForm();
            refreshCompanies();
        } else {
            alert('Error: ' + result.error);
        }
    };

    const resetForm = () => {
        setFormData({
            name: '',
            nit: '',
            legal_name: '',
            address: '',
            city: '',
            country: 'Bolivia',
            phone: '',
            email: '',
            website: '',
            currency: 'BOB',
            fiscal_year_start: '01-01',
            societal_type: 'Unipersonal',
            activity_type: 'Comercial',
            operation_start_date: '',
            current_year: new Date().getFullYear()
        });
    };

    const openNewCompanyModal = () => {
        setEditingCompany(null);
        resetForm();
        setShowModal(true);
    };

    // Auto-set fiscal year based on activity type
    const handleActivityChange = (e) => {
        const type = e.target.value;
        const activity = ACTIVITY_TYPES.find(a => a.value === type);
        setFormData(prev => ({
            ...prev,
            activity_type: type,
            fiscal_year_start: activity ? activity.start : '01-01'
        }));
    };

    // --- Restore Backup Handlers ---
    const openRestoreModal = () => {
        setRestoreDryRunData(null);
        setRestoreError(null);
        setRestoreProgress(0);
        setRestoreSuccess(false);
        setRestoreResult(null);
        setRestoreSelectedFile(null);
        setShowRestoreModal(true);
    };

    const closeRestoreModal = () => {
        setShowRestoreModal(false);
        setRestoreDryRunData(null);
        setRestoreError(null);
        setRestoreProgress(0);
        setRestoreSuccess(false);
        setRestoreResult(null);
        setRestoreSelectedFile(null);
        if (restoreFileRef.current) restoreFileRef.current.value = '';
    };

    const handleRestoreFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 100 * 1024 * 1024) {
            setRestoreError('El archivo excede el límite de 100MB.');
            return;
        }

        setRestoreLoading(true);
        setRestoreError(null);
        setRestoreDryRunData(null);
        setRestoreResult(null);
        setRestoreSelectedFile(file);

        const fd = new FormData();
        fd.append('file', file);

        try {
            const baseUrl = API_URL || '';
            const response = await axios.post(`${baseUrl}/api/backup/dry-run`, fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setRestoreDryRunData(response.data.metadata);
        } catch (err) {
            setRestoreError(err.response?.data?.error || 'Error al leer el archivo de backup.');
        } finally {
            setRestoreLoading(false);
        }
    };

    const handleRestoreImport = async () => {
        // Nota: el input file se desmonta cuando hay restoreDryRunData, por eso persistimos el archivo en estado.
        const selectedFile = restoreSelectedFile || restoreFileRef.current?.files?.[0] || null;
        if (!selectedFile) {
            setRestoreError('Selecciona nuevamente el archivo .ZIP para restaurar.');
            return;
        }

        if (!restoreDryRunData) {
            setRestoreError('Primero selecciona un backup para previsualizarlo.');
            return;
        }

        if (restoreDryRunData?.integrity?.valid === false) {
            setRestoreError('El backup tiene errores de integridad y no puede restaurarse.');
            return;
        }

        if (!restoreDryRunData?.compatibility?.ready) {
            setRestoreError('El backup no es compatible con este entorno y no puede restaurarse.');
            return;
        }

        if (!window.confirm('¿Estás seguro de restaurar esta empresa? Se creará una nueva empresa con los datos del backup.')) {
            return;
        }

        setRestoreLoading(true);
        setRestoreProgress(10);
        setRestoreError(null);

        const fd = new FormData();
        fd.append('file', selectedFile);

        try {
            setRestoreProgress(30);
            const baseUrl = API_URL || '';
            const response = await axios.post(`${baseUrl}/api/backup/import`, fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (progressEvent) => {
                    const total = progressEvent.total || progressEvent.loaded || 1;
                    const percentCompleted = Math.round((progressEvent.loaded * 100) / total);
                    setRestoreProgress(30 + (percentCompleted * 0.4));
                }
            });

            setRestoreProgress(90);
            if (response.data.success) {
                setRestoreProgress(100);
                setRestoreSuccess(true);
                setRestoreResult(response.data);
                setRestoreDryRunData(null);
                setRestoreSelectedFile(null);
                if (restoreFileRef.current) restoreFileRef.current.value = '';
                await refreshCompanies();

                if (response.data.newCompanyId) {
                    await selectCompany(response.data.newCompanyId);
                    setTimeout(() => {
                        closeRestoreModal();
                        navigate('/app');
                    }, 1200);
                } else {
                    setTimeout(() => {
                        closeRestoreModal();
                    }, 2500);
                }
            }
        } catch (err) {
            setRestoreError(err.response?.data?.error || 'Error durante la restauración.');
        } finally {
            setRestoreLoading(false);
            setTimeout(() => setRestoreProgress(0), 2000);
        }
    };

    if (loading) {
        return (
            <div className="loading-screen-premium">
                <div className="spinner-premium"></div>
                <h4 className="mt-4 text-white fw-light animate__animated animate__pulse animate__infinite">Cargando empresas...</h4>
                <p className="text-white-50 small">Preparando su espacio contable</p>
            </div>
        );
    }

    return (
        <div className="company-selector-page">
            {/* Hero Section */}
            <div className="company-hero">
                <div className="company-hero-content">
                    <h1 className="company-hero-title">
                        <i className="bi bi-buildings me-3"></i>
                        Sistema Contable Multi-Empresa
                    </h1>
                    <p className="company-hero-subtitle">
                        Gestiona la contabilidad de múltiples empresas desde un solo lugar
                    </p>
                </div>
            </div>

            {/* Search and Actions Bar */}
            <div className="company-toolbar glass-panel border-secondary p-3 mb-4 rounded-3 d-flex justify-content-between align-items-center flex-wrap gap-3">
                <div className="search-container position-relative flex-grow-1" style={{ maxWidth: '500px' }}>
                    <i className="bi bi-search search-icon position-absolute top-50 translate-middle-y ms-3 text-white-50"></i>
                    <input
                        type="text"
                        className="form-control search-input bg-dark border-secondary text-white ps-5"
                        placeholder="Buscar empresas por nombre o NIT..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="d-flex gap-2 flex-shrink-0">
                    <button
                        className="btn btn-outline-info px-3"
                        onClick={openRestoreModal}
                        title="Restaurar empresa desde un archivo de backup"
                    >
                        <i className="bi bi-cloud-upload me-2"></i>
                        Cargar Backup
                    </button>
                    <button
                        className="btn btn-premium btn-new-company px-4"
                        onClick={openNewCompanyModal}
                    >
                        <i className="bi bi-plus-circle me-2"></i>
                        Nueva Empresa
                    </button>
                </div>
            </div>

            {/* Companies Grid */}
            <div className="companies-container">
                {filteredCompanies.length === 0 ? (
                    <div className="no-companies text-center py-5 glass-panel border-secondary rounded-3">
                        <i className="bi bi-building display-1 text-white-50 mb-3"></i>
                        <h3 className="text-white">No hay empresas registradas</h3>
                        <p className="text-white-50">Comienza registrando tu primera empresa</p>
                        <button
                            className="btn btn-primary mt-3"
                            onClick={openNewCompanyModal}
                        >
                            <i className="bi bi-plus-circle me-2"></i>
                            Registrar Primera Empresa
                        </button>
                    </div>
                ) : (
                    <div className="companies-grid">
                        {filteredCompanies.map((company) => (
                            <CompanyCard
                                key={company.id}
                                company={company}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Registration/Edit Modal */}
            {showModal && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                    <div className="modal-dialog modal-lg modal-dialog-centered">
                        <div className="modal-content company-modal glass-panel border-secondary text-white">
                            <div className="modal-header border-secondary border-bottom">
                                <h5 className="modal-title">
                                    <i className={`bi bi-${editingCompany ? 'pencil' : 'plus-circle'} me-2`}></i>
                                    {editingCompany ? 'Editar Empresa' : 'Registrar Nueva Empresa'}
                                </h5>
                                <button
                                    type="button"
                                    className="btn-close btn-close-white"
                                    onClick={() => setShowModal(false)}
                                ></button>
                            </div>
                            <div className="modal-body">
                                <form onSubmit={handleSubmit}>
                                    <div className="row g-3">
                                        {/* Company Name */}
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-building me-2"></i>
                                                Nombre Comercial de la Empresa *
                                            </label>
                                            <input
                                                type="text"
                                                className="form-control bg-dark text-white border-secondary"
                                                value={formData.name}
                                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                                required
                                                placeholder="Ej: Mi Empresa"
                                            />
                                        </div>

                                        {/* NIT */}
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-card-text me-2"></i>
                                                NIT *
                                            </label>
                                            <input
                                                type="text"
                                                className="form-control bg-dark text-white border-secondary"
                                                value={formData.nit}
                                                onChange={(e) => setFormData({ ...formData, nit: e.target.value })}
                                                placeholder="Ej: 1234567890"
                                                required
                                            />
                                        </div>

                                        {/* Legal Name */}
                                        <div className="col-12">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-file-text me-2"></i>
                                                Razón o Denominación Social *
                                            </label>
                                            <input
                                                type="text"
                                                className="form-control bg-dark text-white border-secondary"
                                                value={formData.legal_name}
                                                onChange={(e) => setFormData({ ...formData, legal_name: e.target.value })}
                                                placeholder="Nombre legal completo con siglas del tipo de sociedad"
                                                required
                                            />
                                        </div>

                                        {/* Societal Type */}
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-people me-2"></i>
                                                Tipo Societario *
                                            </label>
                                            <select
                                                className="form-select bg-dark text-white border-secondary"
                                                value={formData.societal_type}
                                                onChange={(e) => setFormData({ ...formData, societal_type: e.target.value })}
                                                required
                                            >
                                                {SOCIETAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                            </select>
                                            <small className="text-white-50" style={{ fontSize: '0.7rem' }}>Define la obligación de Reserva Legal</small>
                                        </div>

                                        {/* Activity Type */}
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-briefcase me-2"></i>
                                                Actividad Económica *
                                            </label>
                                            <select
                                                className="form-select bg-dark text-white border-secondary"
                                                value={formData.activity_type}
                                                onChange={handleActivityChange}
                                                required
                                            >
                                                {ACTIVITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                            </select>
                                        </div>

                                        {/* Address */}
                                        <div className="col-md-8">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-geo-alt me-2"></i>
                                                Dirección *
                                            </label>
                                            <input
                                                type="text"
                                                className="form-control bg-dark text-white border-secondary"
                                                value={formData.address}
                                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                                placeholder="Calle, número, zona"
                                                required
                                            />
                                        </div>

                                        {/* City */}
                                        <div className="col-md-4">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-pin-map me-2"></i>
                                                Ciudad *
                                            </label>
                                            <input
                                                type="text"
                                                className="form-control bg-dark text-white border-secondary"
                                                value={formData.city}
                                                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                                placeholder="Ej: La Paz"
                                                required
                                            />
                                        </div>

                                        {/* Phone */}
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-telephone me-2"></i>
                                                Teléfono *
                                            </label>
                                            <input
                                                type="tel"
                                                className="form-control bg-dark text-white border-secondary"
                                                value={formData.phone}
                                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                                placeholder="Ej: +591 2 1234567"
                                                required
                                            />
                                        </div>

                                        {/* Email */}
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-envelope me-2"></i>
                                                Email *
                                            </label>
                                            <input
                                                type="email"
                                                className="form-control bg-dark text-white border-secondary"
                                                value={formData.email}
                                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                                placeholder="contacto@empresa.com"
                                                required
                                            />
                                        </div>

                                        {/* Website */}
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-globe me-2"></i>
                                                Sitio Web
                                            </label>
                                            <input
                                                type="url"
                                                className="form-control bg-dark text-white border-secondary"
                                                value={formData.website}
                                                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                                                placeholder="https://www.empresa.com"
                                            />
                                        </div>

                                        {/* Currency */}
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-currency-exchange me-2"></i>
                                                Moneda *
                                            </label>
                                            <select
                                                className="form-select bg-dark text-white border-secondary"
                                                value={formData.currency}
                                                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                                required
                                            >
                                                <option value="BOB">BOB - Bolivianos</option>
                                                <option value="USD">USD - Dólares</option>
                                            </select>
                                        </div>

                                        {/* Fiscal Year Info (Dynamic) */}
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-calendar-check me-2"></i>
                                                Año de Gestión Activa *
                                            </label>
                                            <input
                                                type="number"
                                                className="form-control bg-dark text-white border-secondary"
                                                value={formData.current_year}
                                                onChange={(e) => setFormData({ ...formData, current_year: parseInt(e.target.value) || new Date().getFullYear() })}
                                                min="2000"
                                                max="2030"
                                                required
                                            />
                                            <small className="text-white-50 d-block mt-1">
                                                Determina el periodo contable activo.
                                            </small>
                                        </div>

                                        <div className="col-md-6">
                                            <div className="alert alert-info bg-info bg-opacity-10 border border-info small mb-0 h-100 d-flex flex-column justify-content-center text-info">
                                                <div><i className="bi bi-calendar-range me-2"></i><strong className="text-white">Periodo Fiscal:</strong></div>
                                                <div className="mt-1">
                                                    {(() => {
                                                        const startParts = formData.fiscal_year_start.split('-');
                                                        const startMonth = parseInt(startParts[0]);
                                                        const activeYear = parseInt(formData.current_year);

                                                        // Logic for cross-year periods (Industrial, Agro, Mining)
                                                        // Commercial (01-01) is same year. Others start in previous year if they end in activeYear?
                                                        // STANDARD: activeYear usually refers to the Closing Year.
                                                        // E.g. Commercial 2024: Jan 1 2024 - Dec 31 2024
                                                        // Industrial 2024 (Ends Mar 31): Apr 1 2023 - Mar 31 2024

                                                        let startDate, endDate;

                                                        if (formData.activity_type === 'Comercial') {
                                                            // Al 31 de Diciembre
                                                            startDate = `01/01/${activeYear}`;
                                                            endDate = `31/12/${activeYear}`;
                                                        } else if (formData.activity_type === 'Industrial') {
                                                            // Al 31 de Marzo (Starts April 1st previous year)
                                                            startDate = `01/04/${activeYear - 1}`;
                                                            endDate = `31/03/${activeYear}`;
                                                        } else if (formData.activity_type === 'Agroindustrial') {
                                                            // Al 30 de Junio (Starts July 1st previous year)
                                                            startDate = `01/07/${activeYear - 1}`;
                                                            endDate = `30/06/${activeYear}`;
                                                        } else if (formData.activity_type === 'Minera') {
                                                            // Al 30 de Septiembre (Starts Oct 1st previous year)
                                                            startDate = `01/10/${activeYear - 1}`;
                                                            endDate = `30/09/${activeYear}`;
                                                        }

                                                        return `${startDate} - ${endDate}`;
                                                    })()}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Operation Start Date (Override) */}
                                        <div className="col-md-6">
                                            <label className="form-label text-white-50">
                                                <i className="bi bi-calendar-event me-2"></i>
                                                Inicio de Operaciones (Opcional)
                                            </label>
                                            <DatePicker
                                                selected={formData.operation_start_date ? parseISO(formData.operation_start_date) : null}
                                                onChange={(date) => setFormData({ ...formData, operation_start_date: date ? format(date, 'yyyy-MM-dd') : '' })}
                                                className="form-control bg-dark text-white border-secondary"
                                                placeholderText="Seleccione fecha (Opcional)"
                                                dateFormat="dd/MM/yyyy"
                                                locale={es}
                                                isClearable
                                                popperProps={{ strategy: 'fixed' }}
                                            />
                                            <small className="text-white-50" style={{ fontSize: '0.7rem' }}>
                                                Úselo si la empresa inició actividades después del inicio de gestión.
                                            </small>
                                        </div>
                                    </div>

                                    <div className="modal-footer border-secondary mt-4 px-0">
                                        <button
                                            type="button"
                                            className="btn btn-outline-secondary"
                                            onClick={() => setShowModal(false)}
                                        >
                                            Cancelar
                                        </button>
                                        <button type="submit" className="btn btn-primary">
                                            <i className="bi bi-check-circle me-2"></i>
                                            {editingCompany ? 'Actualizar' : 'Registrar'} Empresa
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Restore Backup Modal */}
            {showRestoreModal && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content glass-panel border-secondary text-white">
                            <div className="modal-header border-secondary">
                                <h5 className="modal-title">
                                    <i className="bi bi-cloud-upload me-2 text-info"></i>
                                    Restaurar Empresa desde Backup
                                </h5>
                                <button
                                    type="button"
                                    className="btn-close btn-close-white"
                                    onClick={closeRestoreModal}
                                    disabled={restoreLoading}
                                ></button>
                            </div>
                            <div className="modal-body">
                                {/* Success state */}
                                {restoreSuccess ? (
                                    <div className="text-center py-4 animate__animated animate__fadeIn">
                                        <div className="rounded-circle mx-auto d-flex align-items-center justify-content-center mb-3"
                                            style={{ width: '80px', height: '80px', background: 'rgba(25, 135, 84, 0.15)', border: '2px solid rgba(25, 135, 84, 0.4)' }}>
                                            <i className="bi bi-check-lg text-success" style={{ fontSize: '2.5rem' }}></i>
                                        </div>
                                        <h5 className="text-success fw-bold">¡Restauración Completada!</h5>
                                        <p className="text-white-50 small mb-2">
                                            {restoreResult?.restoredCompanyName || 'La empresa ha sido creada exitosamente desde el backup.'}
                                        </p>
                                        <p className="text-info small mb-0">Abriendo empresa restaurada...</p>
                                    </div>
                                ) : (
                                    <>
                                        {/* Upload area */}
                                        {!restoreDryRunData && (
                                            <div className="text-center">
                                                <div
                                                    className="p-4 rounded-3 mb-3 position-relative"
                                                    style={{
                                                        border: '2px dashed rgba(13, 202, 240, 0.3)',
                                                        backgroundColor: 'rgba(13, 202, 240, 0.03)',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.3s ease'
                                                    }}
                                                    onClick={() => restoreFileRef.current?.click()}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.borderColor = 'rgba(13, 202, 240, 0.6)';
                                                        e.currentTarget.style.backgroundColor = 'rgba(13, 202, 240, 0.08)';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.borderColor = 'rgba(13, 202, 240, 0.3)';
                                                        e.currentTarget.style.backgroundColor = 'rgba(13, 202, 240, 0.03)';
                                                    }}
                                                >
                                                    <div className="rounded-circle mx-auto d-flex align-items-center justify-content-center mb-3"
                                                        style={{ width: '64px', height: '64px', background: 'rgba(13, 202, 240, 0.1)', border: '1px solid rgba(13, 202, 240, 0.25)' }}>
                                                        <i className="bi bi-file-earmark-zip text-info" style={{ fontSize: '1.8rem' }}></i>
                                                    </div>
                                                    <h6 className="text-white fw-bold mb-1">Seleccionar archivo de Backup</h6>
                                                    <p className="text-white-50 small mb-0">Haz clic aquí o arrastra un archivo <code className="text-info">.ZIP</code></p>
                                                    <input
                                                        type="file"
                                                        className="d-none"
                                                        accept=".zip"
                                                        ref={restoreFileRef}
                                                        onChange={handleRestoreFileChange}
                                                        disabled={restoreLoading}
                                                    />
                                                </div>
                                                <small className="text-white-50">
                                                    <i className="bi bi-shield-check me-1 text-info"></i>
                                                    Se creará una <strong className="text-white">nueva empresa</strong> con los datos del backup. Nada existente será modificado.
                                                </small>
                                            </div>
                                        )}

                                        {/* Loading spinner during dry-run */}
                                        {restoreLoading && !restoreDryRunData && (
                                            <div className="text-center py-3">
                                                <div className="spinner-border text-info" role="status"></div>
                                                <p className="text-white-50 small mt-2 mb-0">Analizando archivo...</p>
                                            </div>
                                        )}

                                        {/* Error display */}
                                        {restoreError && (
                                            <div className="alert alert-danger border-danger bg-danger bg-opacity-10 text-danger d-flex align-items-center mt-3 small">
                                                <i className="bi bi-exclamation-octagon-fill me-2 fs-5"></i>
                                                {restoreError}
                                            </div>
                                        )}

                                        {/* Dry Run Preview */}
                                        {restoreDryRunData && (
                                            <div className="animate__animated animate__fadeIn">
                                                <div className="d-flex justify-content-between align-items-center mb-3">
                                                    <h6 className="fw-bold text-info mb-0">
                                                        <i className="bi bi-eye-fill me-2"></i>Previsualización del Backup
                                                    </h6>
                                                    <span className="badge bg-info bg-opacity-20 text-info border border-info">V {restoreDryRunData.version}</span>
                                                </div>
                                                <div className="p-3 rounded-3 mb-3" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                    <div className="row g-3 small">
                                                        <div className="col-6">
                                                            <div className="text-white-50">Empresa Origen</div>
                                                            <div className="fw-bold text-white">{restoreDryRunData.companyName}</div>
                                                        </div>
                                                        <div className="col-6">
                                                            <div className="text-white-50">NIT</div>
                                                            <div className="fw-bold text-white">{restoreDryRunData.nit || 'N/A'}</div>
                                                        </div>
                                                        <div className="col-6">
                                                            <div className="text-white-50">Cuentas</div>
                                                            <div className="fw-bold text-white">
                                                                <i className="bi bi-journal-text me-1 text-info"></i>
                                                                {restoreDryRunData.counts?.accounts || 0}
                                                            </div>
                                                        </div>
                                                        <div className="col-6">
                                                            <div className="text-white-50">Asientos</div>
                                                            <div className="fw-bold text-white">
                                                                <i className="bi bi-receipt me-1 text-info"></i>
                                                                {restoreDryRunData.counts?.transactions || 0}
                                                            </div>
                                                        </div>
                                                        <div className="col-6">
                                                            <div className="text-white-50">Inventario</div>
                                                            <div className="fw-bold text-white">
                                                                <i className="bi bi-box-seam me-1 text-info"></i>
                                                                {restoreDryRunData.counts?.inventory_items || 0}
                                                            </div>
                                                        </div>
                                                        <div className="col-6">
                                                            <div className="text-white-50">Activos Fijos</div>
                                                            <div className="fw-bold text-white">
                                                                <i className="bi bi-building-gear me-1 text-info"></i>
                                                                {restoreDryRunData.counts?.fixed_assets || 0}
                                                            </div>
                                                        </div>
                                                        <div className="col-12">
                                                            <div className="text-white-50">Fecha Generación</div>
                                                            <div className="fw-bold text-white small">
                                                                {new Date(restoreDryRunData.createdAt || restoreDryRunData.timestamp).toLocaleString()}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {!restoreDryRunData.compatibility?.ready && (
                                                    <div className="alert alert-danger border-danger bg-danger bg-opacity-10 text-danger small">
                                                        <div className="fw-bold mb-1">
                                                            <i className="bi bi-shield-x me-2"></i>
                                                            El backup no es restaurable en este entorno.
                                                        </div>
                                                        {(restoreDryRunData.compatibility?.errors || []).map((error, index) => (
                                                            <div key={index}>{error}</div>
                                                        ))}
                                                    </div>
                                                )}

                                                {restoreDryRunData.integrity?.errors?.length > 0 && (
                                                    <div className="alert alert-danger border-danger bg-danger bg-opacity-10 text-danger small">
                                                        <div className="fw-bold mb-1">
                                                            <i className="bi bi-exclamation-octagon me-2"></i>
                                                            El backup contiene errores de integridad.
                                                        </div>
                                                        {(restoreDryRunData.integrity?.errors || []).map((error, index) => (
                                                            <div key={index}>{error}</div>
                                                        ))}
                                                    </div>
                                                )}

                                                {(restoreDryRunData.compatibility?.warnings?.length > 0 || restoreDryRunData.integrity?.warnings?.length > 0) && (
                                                    <div className="alert alert-warning border-warning bg-warning bg-opacity-10 text-warning small">
                                                        <div className="fw-bold mb-1">
                                                            <i className="bi bi-exclamation-triangle me-2"></i>
                                                            Observaciones del backup
                                                        </div>
                                                        {[...(restoreDryRunData.compatibility?.warnings || []), ...(restoreDryRunData.integrity?.warnings || [])].map((warning, index) => (
                                                            <div key={index}>{warning}</div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Progress Bar */}
                                                {restoreProgress > 0 && (
                                                    <div className="progress mb-3 bg-dark border border-secondary" style={{ height: '10px', borderRadius: '8px' }}>
                                                        <div
                                                            className="progress-bar progress-bar-striped progress-bar-animated bg-info"
                                                            role="progressbar"
                                                            style={{ width: `${restoreProgress}%`, boxShadow: '0 0 12px rgba(13,202,240,0.4)' }}
                                                        ></div>
                                                    </div>
                                                )}

                                                <div className="d-flex gap-2">
                                                    <button
                                                        className="btn btn-premium flex-grow-1"
                                                        onClick={handleRestoreImport}
                                                        disabled={restoreLoading || !restoreDryRunData.compatibility?.ready || restoreDryRunData.integrity?.valid === false}
                                                    >
                                                        {restoreLoading ? (
                                                            <span><span className="spinner-border spinner-border-sm me-2"></span>Restaurando...</span>
                                                        ) : (
                                                            <span><i className="bi bi-check-circle me-2"></i>Confirmar Restauración</span>
                                                        )}
                                                    </button>
                                                    <button
                                                        className="btn btn-outline-secondary"
                                                        onClick={() => {
                                                            setRestoreDryRunData(null);
                                                            setRestoreError(null);
                                                            setRestoreSelectedFile(null);
                                                            if (restoreFileRef.current) restoreFileRef.current.value = '';
                                                        }}
                                                        disabled={restoreLoading}
                                                    >
                                                        Cancelar
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
