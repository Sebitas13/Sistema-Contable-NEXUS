import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useCompany } from '../context/CompanyContext';

export default function Reports() {
    const { selectedCompany } = useCompany();
    const [stats, setStats] = useState({ total_transactions: 0, total_accounts: 0, total_inventory_items: 0, total_fixed_assets: 0 });
    const reports = [
        {
            title: 'Estados Financieros',
            description: 'Balance General y Estado de Resultados',
            icon: 'bi-bank',
            color: 'primary',
            path: '/app/financial-statements'
        },
        {
            title: 'Libro Mayor',
            description: 'Resumen de movimientos y saldos por cuenta contable',
            icon: 'bi-book',
            color: 'primary',
            path: '/app/ledger'
        },
        {
            title: 'Balance de Comprobación',
            description: 'Verificación de sumas y saldos deudores y acreedores',
            icon: 'bi-calculator',
            color: 'success',
            path: '/app/trial-balance'
        },
        {
            title: 'Hoja de Trabajo',
            description: 'Estado de Resultados, Balance General, Saldos del Balance de Comprobación de Sumas y Saldos',
            icon: 'bi-file-earmark-spreadsheet',
            color: 'info',
            path: '/app/worksheet'
        },
        {
            title: 'Libro Diario',
            description: 'Registro cronológico de todas las transacciones contables',
            icon: 'bi-pencil-square',
            color: 'warning',
            path: '/app/journal'
        },
        {
            title: 'Inventarios (Kardex)',
            description: 'Control de existencias con métodos PEPS, UEPS, CPP e IE',
            icon: 'bi-box-seam',
            color: 'danger',
            path: '/app/inventory'
        },
        {
            title: 'Activos Fijos',
            description: 'Registro y depreciación de bienes de uso',
            icon: 'bi-building',
            color: 'secondary',
            path: '/app/fixed-assets'
        }
    ];

    const utilities = [
        {
            title: 'Plan de Cuentas',
            description: 'Gestión del catálogo de cuentas contables',
            icon: 'bi-journal-text',
            color: 'primary',
            path: '/app/accounts'
        },
        {
            title: 'UFV',
            description: 'Histórico de Unidad de Fomento de Vivienda',
            icon: 'bi-graph-up-arrow',
            color: 'success',
            path: '/app/ufv'
        },
        {
            title: 'Tipo de Cambio',
            description: 'Registro de tipos de cambio por moneda',
            icon: 'bi-currency-exchange',
            color: 'info',
            path: '/app/exchange-rate'
        }
    ];

    useEffect(() => {
        if (selectedCompany) {
            const fetchStats = async () => {
                try {
                    const response = await axios.get(`http://localhost:3001/api/companies/${selectedCompany.id}/stats`);
                    if (response.data.success) {
                        setStats(response.data.data);
                    }
                } catch (error) {
                    console.error("Error fetching company stats:", error);
                }
            };
            fetchStats();
        }
    }, [selectedCompany]);

    return (
        <div>
            <div className="mb-4">
                <h2 className="mb-2"><i className="bi bi-graph-up me-2"></i>Reportes y Consultas</h2>
                <p className="text-muted">Acceso rápido a todos los reportes contables del sistema</p>
            </div>

            {/* Reportes Principales */}
            <div className="mb-5">
                <h5 className="mb-3"><i className="bi bi-file-earmark-bar-graph me-2"></i>Reportes Contables</h5>
                <div className="row g-4">
                    {reports.map((report, index) => (
                        <div className="col-md-4" key={index}>
                            <Link to={report.path} className="text-decoration-none">
                                <div className="card shadow-sm border-0 h-100 hover-card" style={{ transition: 'transform 0.3s ease, box-shadow 0.3s ease' }}>
                                    <div className="card-body">
                                        <div className="d-flex align-items-start">
                                            <div className={`bg-${report.color} bg-opacity-10 p-3 rounded-3 me-3`}>
                                                <i className={`bi ${report.icon} text-${report.color}`} style={{ fontSize: '2rem' }}></i>
                                            </div>
                                            <div className="flex-grow-1">
                                                <h5 className="card-title mb-2">{report.title}</h5>
                                                <p className="card-text text-muted small mb-0">{report.description}</p>
                                            </div>
                                            <i className="bi bi-arrow-right text-muted"></i>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        </div>
                    ))}
                </div>
            </div>

            {/* Utilidades */}
            <div className="mb-4">
                <h5 className="mb-3"><i className="bi bi-tools me-2"></i>Herramientas y Utilidades</h5>
                <div className="row g-4">
                    {utilities.map((utility, index) => (
                        <div className="col-md-4" key={index}>
                            <Link to={utility.path} className="text-decoration-none">
                                <div className="card shadow-sm border-0 h-100 hover-card" style={{ transition: 'transform 0.3s ease, box-shadow 0.3s ease' }}>
                                    <div className="card-body">
                                        <div className="d-flex align-items-start">
                                            <div className={`bg-${utility.color} bg-opacity-10 p-3 rounded-3 me-3`}>
                                                <i className={`bi ${utility.icon} text-${utility.color}`} style={{ fontSize: '2rem' }}></i>
                                            </div>
                                            <div className="flex-grow-1">
                                                <h5 className="card-title mb-2">{utility.title}</h5>
                                                <p className="card-text text-muted small mb-0">{utility.description}</p>
                                            </div>
                                            <i className="bi bi-arrow-right text-muted"></i>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        </div>
                    ))}
                </div>
            </div>

            {/* Quick Stats */}
            <div className="card shadow-sm border-0">
                <div className="card-header bg-white border-bottom">
                    <h5 className="mb-0"><i className="bi bi-speedometer2 me-2"></i>Estadísticas Rápidas</h5>
                </div>
                <div className="card-body">
                    <div className="row g-4">
                        <div className="col-md-3">
                            <div className="text-center">
                                <div className="display-6 text-primary mb-2"><i className="bi bi-files"></i></div>
                                <h4 className="mb-1">{stats.total_transactions || 0}</h4>
                                <small className="text-muted">Transacciones</small>
                            </div>
                        </div>
                        <div className="col-md-3">
                            <div className="text-center">
                                <div className="display-6 text-success mb-2"><i className="bi bi-journal-check"></i></div>
                                <h4 className="mb-1">{stats.total_accounts || 0}</h4>
                                <small className="text-muted">Cuentas Activas</small>
                            </div>
                        </div>
                        <div className="col-md-3">
                            <div className="text-center">
                                <div className="display-6 text-info mb-2"><i className="bi bi-box"></i></div>
                                <h4 className="mb-1">{stats.total_inventory_items || 0}</h4>
                                <small className="text-muted">Items Inventario</small>
                            </div>
                        </div>
                        <div className="col-md-3">
                            <div className="text-center">
                                <div className="display-6 text-warning mb-2"><i className="bi bi-buildings"></i></div>
                                <h4 className="mb-1">{stats.total_fixed_assets || 0}</h4>
                                <small className="text-muted">Activos Fijos</small>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
        .hover-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15) !important;
        }
      `}</style>
        </div>
    );
}
