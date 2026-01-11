import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompany } from '../context/CompanyContext';

export default function CompanyCard({ company, onEdit, onDelete }) {
    const navigate = useNavigate();
    const { selectCompany } = useCompany();

    const handleEnter = async () => {
        await selectCompany(company.id);
        navigate('/app');
    };

    const getInitials = (name) => {
        return name
            .split(' ')
            .map(word => word[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'Sin actividad';
        const date = new Date(dateString);
        return date.toLocaleDateString('es-BO', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    return (
        <div className="company-card">
            <div className="company-card-gradient"></div>

            <div className="company-card-content">
                {/* Logo/Avatar */}
                <div className="company-avatar">
                    {company.logo_url ? (
                        <img src={company.logo_url} alt={company.name} />
                    ) : (
                        <div className="company-avatar-initials">
                            {getInitials(company.name)}
                        </div>
                    )}
                </div>

                {/* Company Info */}
                <div className="company-info">
                    <h3 className="company-name">{company.name}</h3>
                    {company.nit && (
                        <p className="company-nit">
                            <i className="bi bi-card-text me-2"></i>
                            NIT: {company.nit}
                        </p>
                    )}
                    {company.city && (
                        <p className="company-location">
                            <i className="bi bi-geo-alt me-2"></i>
                            {company.city}
                        </p>
                    )}
                    {company.operation_start_date && (
                        <p className="company-operation-date" style={{ fontSize: '0.8rem', color: '#6c757d' }}>
                            <i className="bi bi-calendar-check me-2 text-success"></i>
                            Inicia: {company.operation_start_date.split('-').reverse().join('/')}
                        </p>
                    )}
                </div>

                {/* Stats */}
                <div className="company-stats">
                    <div className="stat-item">
                        <i className="bi bi-journal-text"></i>
                        <span className="stat-value">{company.account_count || 0}</span>
                        <span className="stat-label">Cuentas</span>
                    </div>
                    <div className="stat-item">
                        <i className="bi bi-receipt"></i>
                        <span className="stat-value">{company.transaction_count || 0}</span>
                        <span className="stat-label">Asientos</span>
                    </div>
                </div>

                {/* Last Activity */}
                <div className="company-activity">
                    <i className="bi bi-clock-history me-2"></i>
                    <span>Última actividad: {formatDate(company.last_activity)}</span>
                </div>

                {/* Actions */}
                <div className="company-actions">
                    <button
                        className="btn btn-primary btn-enter"
                        onClick={handleEnter}
                    >
                        <i className="bi bi-box-arrow-in-right me-2"></i>
                        Ingresar
                    </button>
                    <button
                        className="btn btn-outline-secondary btn-icon"
                        onClick={() => onEdit(company)}
                        title="Editar"
                    >
                        <i className="bi bi-pencil"></i>
                    </button>
                    <button
                        className="btn btn-outline-danger btn-icon"
                        onClick={() => onDelete(company)}
                        title="Eliminar"
                        disabled={company.id === 1}
                    >
                        <i className="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    );
}
