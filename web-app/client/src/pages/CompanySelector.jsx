import React, { useState, useEffect } from 'react';
import DatePicker from 'react-datepicker';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import { useCompany } from '../context/CompanyContext';
import CompanyCard from '../components/CompanyCard';

export default function CompanySelector() {
    const { companies, loading, deleteCompany, refreshCompanies, createCompany, updateCompany } = useCompany();

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

    if (loading) {
        return (
            <div className="company-selector-loading">
                <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Cargando...</span>
                </div>
                <p className="mt-3">Cargando empresas...</p>
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
            <div className="company-toolbar">
                <div className="search-container">
                    <i className="bi bi-search search-icon"></i>
                    <input
                        type="text"
                        className="form-control search-input"
                        placeholder="Buscar empresas por nombre o NIT..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <button
                    className="btn btn-primary btn-new-company"
                    onClick={openNewCompanyModal}
                >
                    <i className="bi bi-plus-circle me-2"></i>
                    Nueva Empresa
                </button>
            </div>

            {/* Companies Grid */}
            <div className="companies-container">
                {filteredCompanies.length === 0 ? (
                    <div className="no-companies">
                        <i className="bi bi-building"></i>
                        <h3>No hay empresas registradas</h3>
                        <p>Comienza registrando tu primera empresa</p>
                        <button
                            className="btn btn-primary"
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
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-lg modal-dialog-centered">
                        <div className="modal-content company-modal">
                            <div className="modal-header">
                                <h5 className="modal-title">
                                    <i className={`bi bi-${editingCompany ? 'pencil' : 'plus-circle'} me-2`}></i>
                                    {editingCompany ? 'Editar Empresa' : 'Registrar Nueva Empresa'}
                                </h5>
                                <button
                                    type="button"
                                    className="btn-close"
                                    onClick={() => setShowModal(false)}
                                ></button>
                            </div>
                            <div className="modal-body">
                                <form onSubmit={handleSubmit}>
                                    <div className="row g-3">
                                        {/* Company Name */}
                                        <div className="col-md-6">
                                            <label className="form-label">
                                                <i className="bi bi-building me-2"></i>
                                                Nombre Comercial de la Empresa *
                                            </label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={formData.name}
                                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                                required
                                                placeholder="Ej: Mi Empresa"
                                            />
                                        </div>

                                        {/* NIT */}
                                        <div className="col-md-6">
                                            <label className="form-label">
                                                <i className="bi bi-card-text me-2"></i>
                                                NIT
                                            </label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={formData.nit}
                                                onChange={(e) => setFormData({ ...formData, nit: e.target.value })}
                                                placeholder="Ej: 1234567890"
                                            />
                                        </div>

                                        {/* Legal Name */}
                                        <div className="col-12">
                                            <label className="form-label">
                                                <i className="bi bi-file-text me-2"></i>
                                                Razón o Denominación Social
                                            </label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={formData.legal_name}
                                                onChange={(e) => setFormData({ ...formData, legal_name: e.target.value })}
                                                placeholder="Nombre legal completo con siglas del tipo de sociedad"
                                            />
                                        </div>

                                        {/* Societal Type */}
                                        <div className="col-md-6">
                                            <label className="form-label">
                                                <i className="bi bi-people me-2"></i>
                                                Tipo Societario
                                            </label>
                                            <select
                                                className="form-select"
                                                value={formData.societal_type}
                                                onChange={(e) => setFormData({ ...formData, societal_type: e.target.value })}
                                            >
                                                {SOCIETAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                            </select>
                                            <small className="text-muted" style={{ fontSize: '0.7rem' }}>Define la obligación de Reserva Legal</small>
                                        </div>

                                        {/* Activity Type */}
                                        <div className="col-md-6">
                                            <label className="form-label">
                                                <i className="bi bi-briefcase me-2"></i>
                                                Actividad Económica
                                            </label>
                                            <select
                                                className="form-select"
                                                value={formData.activity_type}
                                                onChange={handleActivityChange}
                                            >
                                                {ACTIVITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                            </select>
                                        </div>

                                        {/* Address */}
                                        <div className="col-md-8">
                                            <label className="form-label">
                                                <i className="bi bi-geo-alt me-2"></i>
                                                Dirección
                                            </label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={formData.address}
                                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                                placeholder="Calle, número, zona"
                                            />
                                        </div>

                                        {/* City */}
                                        <div className="col-md-4">
                                            <label className="form-label">
                                                <i className="bi bi-pin-map me-2"></i>
                                                Ciudad
                                            </label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={formData.city}
                                                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                                placeholder="Ej: La Paz"
                                            />
                                        </div>

                                        {/* Phone */}
                                        <div className="col-md-6">
                                            <label className="form-label">
                                                <i className="bi bi-telephone me-2"></i>
                                                Teléfono
                                            </label>
                                            <input
                                                type="tel"
                                                className="form-control"
                                                value={formData.phone}
                                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                                placeholder="Ej: +591 2 1234567"
                                            />
                                        </div>

                                        {/* Email */}
                                        <div className="col-md-6">
                                            <label className="form-label">
                                                <i className="bi bi-envelope me-2"></i>
                                                Email
                                            </label>
                                            <input
                                                type="email"
                                                className="form-control"
                                                value={formData.email}
                                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                                placeholder="contacto@empresa.com"
                                            />
                                        </div>

                                        {/* Website */}
                                        <div className="col-md-6">
                                            <label className="form-label">
                                                <i className="bi bi-globe me-2"></i>
                                                Sitio Web
                                            </label>
                                            <input
                                                type="url"
                                                className="form-control"
                                                value={formData.website}
                                                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                                                placeholder="https://www.empresa.com"
                                            />
                                        </div>

                                        {/* Currency */}
                                        <div className="col-md-6">
                                            <label className="form-label">
                                                <i className="bi bi-currency-exchange me-2"></i>
                                                Moneda
                                            </label>
                                            <select
                                                className="form-select"
                                                value={formData.currency}
                                                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                            >
                                                <option value="BOB">BOB - Bolivianos</option>
                                                <option value="USD">USD - Dólares</option>
                                            </select>
                                        </div>

                                        {/* Fiscal Year Info (Dynamic) */}
                                        <div className="col-md-6">
                                            <label className="form-label">
                                                <i className="bi bi-calendar-check me-2"></i>
                                                Año de Gestión Activa
                                            </label>
                                            <input
                                                type="number"
                                                className="form-control"
                                                value={formData.current_year}
                                                onChange={(e) => setFormData({ ...formData, current_year: parseInt(e.target.value) || new Date().getFullYear() })}
                                                min="2000"
                                                max="2030"
                                            />
                                            <small className="text-muted d-block mt-1">
                                                Determina el periodo contable activo.
                                            </small>
                                        </div>

                                        <div className="col-md-6">
                                            <div className="alert alert-info border small mb-0 h-100 d-flex flex-column justify-content-center">
                                                <div><i className="bi bi-calendar-range me-2"></i><strong>Periodo Fiscal:</strong></div>
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
                                            <label className="form-label">
                                                <i className="bi bi-calendar-event me-2"></i>
                                                Inicio de Operaciones (Opcional)
                                            </label>
                                            <DatePicker
                                                selected={formData.operation_start_date ? parseISO(formData.operation_start_date) : null}
                                                onChange={(date) => setFormData({ ...formData, operation_start_date: date ? format(date, 'yyyy-MM-dd') : '' })}
                                                className="form-control"
                                                placeholderText="Seleccione fecha (Opcional)"
                                                dateFormat="dd/MM/yyyy"
                                                locale={es}
                                                isClearable
                                                popperProps={{ strategy: 'fixed' }}
                                            />
                                            <small className="text-muted" style={{ fontSize: '0.7rem' }}>
                                                Úselo si la empresa inició actividades después del inicio de gestión.
                                            </small>
                                        </div>
                                    </div>

                                    <div className="modal-footer mt-4 px-0">
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
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
        </div>
    );
}
