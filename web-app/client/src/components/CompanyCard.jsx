import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { useCompany } from '../context/CompanyContext';

export default function CompanyCard({ company, onEdit, onDelete }) {
    const navigate = useNavigate();
    const { selectCompany } = useCompany();
    const cardRef = useRef(null);

    // Tilt 3D sutil siguiendo al puntero: refuerza que la tarjeta es interactiva.
    const rx = useMotionValue(0);
    const ry = useMotionValue(0);
    const rotateX = useSpring(rx, { stiffness: 220, damping: 18 });
    const rotateY = useSpring(ry, { stiffness: 220, damping: 18 });

    const handlePointerMove = (e) => {
        const el = cardRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        ry.set(px * 12);   // giro horizontal
        rx.set(-py * 12);  // giro vertical
    };

    const handlePointerLeave = () => {
        rx.set(0);
        ry.set(0);
    };

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
        <motion.div
            ref={cardRef}
            className="company-card glass-panel border-secondary"
            style={{
                background: 'rgba(11, 14, 20, 0.4)',
                rotateX,
                rotateY,
                transformPerspective: 900,
                transformStyle: 'preserve-3d',
            }}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            whileHover={{ y: -6, boxShadow: '0 18px 48px rgba(59,130,246,0.28)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        >
            <div className="company-card-gradient opacity-50"></div>

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
                    <h3 className="company-name text-white">{company.name}</h3>
                    {company.nit && (
                        <p className="company-nit text-white-50">
                            <i className="bi bi-card-text me-2"></i>
                            NIT: {company.nit}
                        </p>
                    )}
                    {company.city && (
                        <p className="company-location text-white-50">
                            <i className="bi bi-geo-alt me-2"></i>
                            {company.city}
                        </p>
                    )}
                    {company.operation_start_date && (
                        <p className="company-operation-date" style={{ fontSize: '0.8rem', color: '#adb5bd' }}>
                            <i className="bi bi-calendar-check me-2 text-success"></i>
                            Inicia: {company.operation_start_date.split('-').reverse().join('/')}
                        </p>
                    )}
                </div>

                {/* Stats */}
                <div className="company-stats-premium d-flex justify-content-around py-3 my-3">
                    <div className="stat-item d-flex flex-column align-items-center">
                        <span className="stat-value h4 mb-1 fw-bold text-white mb-0">{company.account_count || 0}</span>
                        <span className="stat-label small text-white-50 text-uppercase" style={{ fontSize: '0.65rem', letterSpacing: '1px' }}>Cuentas</span>
                    </div>
                    <div className="stat-divider border-end border-secondary"></div>
                    <div className="stat-item d-flex flex-column align-items-center">
                        <span className="stat-value h4 mb-1 fw-bold text-white mb-0">{company.transaction_count || 0}</span>
                        <span className="stat-label small text-white-50 text-uppercase" style={{ fontSize: '0.65rem', letterSpacing: '1px' }}>Asientos</span>
                    </div>
                </div>

                {/* Last Activity */}
                <div className="company-activity text-white-50 small mt-2 mb-3 text-center">
                    <i className="bi bi-clock-history me-2"></i>
                    <span>Última actividad: {formatDate(company.last_activity)}</span>
                </div>

                {/* Actions */}
                <div className="company-actions d-flex gap-2">
                    <button
                        className="btn btn-premium btn-enter flex-grow-1"
                        onClick={handleEnter}
                    >
                        <i className="bi bi-box-arrow-in-right me-2"></i>
                        Ingresar
                    </button>
                    <button
                        className="btn glass-panel border-secondary text-white btn-icon"
                        onClick={() => onEdit(company)}
                        title="Editar"
                        style={{ width: '42px', height: '42px' }}
                    >
                        <i className="bi bi-pencil"></i>
                    </button>
                    <button
                        className="btn glass-panel border-secondary text-danger btn-icon"
                        onClick={() => onDelete(company)}
                        title="Eliminar"
                        disabled={company.id === 1}
                        style={{ width: '42px', height: '42px' }}
                    >
                        <i className="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        </motion.div>
    );
}
