import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { CompanyProvider, useCompany } from './context/CompanyContext';
import CompanySelector from './pages/CompanySelector';
import Dashboard from './pages/Dashboard';
import Journal from './pages/Journal';
import Reports from './pages/Reports';
import Accounts from './pages/Accounts';
import Ledger from './pages/Ledger';
import TrialBalance from './pages/TrialBalance';
import Worksheet from './pages/Worksheet';
import Inventory from './pages/Inventory';
import FixedAssets from './pages/FixedAssets';
import UFV from './pages/UFV';
import ExchangeRate from './pages/ExchangeRate';
import DataForge from './DataForge/DataForge';
import FinancialStatements from './pages/FinancialStatements';
import Settings from './pages/Settings';
import MahoragaDashboard from './pages/MahoragaDashboard';
import { useState } from 'react';

function Sidebar() {
    const location = useLocation();
    const [collapsed, setCollapsed] = useState(false);
    const { selectedCompany, clearCompany } = useCompany();
    const navigate = useNavigate();

    const isActive = (path) => location.pathname === path;

    const menuItems = [
        { path: '/app', icon: 'bi-speedometer2', label: 'Dashboard' },
        { path: '/app/accounts', icon: 'bi-journal-text', label: 'Plan de Cuentas' },
        { path: '/app/journal', icon: 'bi-pencil-square', label: 'Libro Diario' },
        { path: '/app/ledger', icon: 'bi-book', label: 'Libro Mayor' },
        { path: '/app/trial-balance', icon: 'bi-calculator', label: 'Balance Comprobación' },
        { path: '/app/worksheet', icon: 'bi-file-earmark-spreadsheet', label: 'Hoja de Trabajo' },
        { path: '/app/inventory', icon: 'bi-box-seam', label: 'Inventarios (Kardex)' },
        { path: '/app/fixed-assets', icon: 'bi-building', label: 'Activos Fijos' },
        { path: '/app/ufv', icon: 'bi-graph-up-arrow', label: 'UFV' },
        { path: '/app/exchange-rate', icon: 'bi-currency-exchange', label: 'Tipo de Cambio' },
        { path: '/app/reports', icon: 'bi-graph-up', label: 'Reportes' },
        { path: '/app/settings', icon: 'bi-gear', label: 'Configuración' },
    ];

    const handleChangeCompany = () => {
        clearCompany();
        navigate('/');
    };

    return (
        <div className={`bg-dark text-white ${collapsed ? 'collapsed-sidebar' : 'sidebar'}`} style={{
            width: collapsed ? '80px' : '280px',
            height: '100vh',
            position: 'fixed',
            left: 0,
            top: 0,
            transition: 'width 0.3s',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column'
        }}>
            <div className="p-3 border-bottom border-secondary">
                {!collapsed && (
                    <div className="mb-3">
                        <h5 className="mb-0">
                            <i className="bi bi-calculator-fill me-2"></i>
                            Contabilidad
                        </h5>
                    </div>
                )}
                {!collapsed && selectedCompany && (
                    <div className="company-badge mb-2 p-2 bg-primary bg-opacity-25 rounded">
                        <div className="d-flex align-items-center justify-content-between">
                            <div className="flex-grow-1 text-truncate">
                                <small className="text-white-50 d-block">Empresa Activa</small>
                                <strong className="text-white small">{selectedCompany.name}</strong>
                            </div>
                            <button
                                className="btn btn-sm btn-outline-light ms-2"
                                onClick={handleChangeCompany}
                                title="Cambiar empresa"
                            >
                                <i className="bi bi-arrow-left-right"></i>
                            </button>
                        </div>
                    </div>
                )}
                <button className="btn btn-sm btn-outline-light w-100" onClick={() => setCollapsed(!collapsed)}>
                    <i className={`bi bi-chevron-${collapsed ? 'right' : 'left'}`}></i>
                    {!collapsed && <span className="ms-2">Colapsar</span>}
                </button>
            </div>
            <nav className="py-3" style={{ flex: 1, overflowY: 'auto' }}>
                {menuItems.map((item) => (
                    <Link
                        key={item.path}
                        to={item.path}
                        className={`d-flex align-items-center px-3 py-2 text-decoration-none ${isActive(item.path) ? 'bg-primary text-white' : 'text-white-50 hover-bg-secondary'}`}
                        style={{ transition: 'all 0.2s' }}
                    >
                        <i className={`bi ${item.icon} ${collapsed ? '' : 'me-3'}`} style={{ fontSize: '1.2rem' }}></i>
                        {!collapsed && <span>{item.label}</span>}
                    </Link>
                ))}
            </nav>
        </div>
    );
}

// Protected route wrapper
function ProtectedRoute({ children }) {
    const { selectedCompany, loading } = useCompany();

    if (loading) {
        return <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
            <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Cargando...</span>
            </div>
        </div>;
    }

    if (!selectedCompany) {
        return <Navigate to="/" replace />;
    }

    return children;
}

function AppLayout() {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();

    return (
        <div className="d-flex" style={{ minHeight: '100vh' }}>
            <Sidebar />
            <div style={{ marginLeft: '280px', width: 'calc(100% - 280px)', backgroundColor: '#f8f9fa' }} className="main-content">
                <header className="bg-white shadow-sm py-3 px-4 sticky-top">
                    <div className="d-flex justify-content-between align-items-center">
                        <div>
                            <h4 className="mb-0 text-primary">
                                <i className="bi bi-buildings me-2"></i>
                                Sistema Contable
                            </h4>
                            {selectedCompany && (
                                <small className="text-muted">
                                    {selectedCompany.name}
                                    {selectedCompany.nit && <span className="ms-2">• NIT: {selectedCompany.nit}</span>}
                                </small>
                            )}
                        </div>
                        <div className="d-flex align-items-center gap-3">
                            <span className="text-muted">
                                <i className="bi bi-person-circle me-1"></i>
                                Usuario: Admin
                            </span>
                            <button
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => navigate('/')}
                            >
                                <i className="bi bi-building me-1"></i>
                                Cambiar Empresa
                            </button>
                        </div>
                    </div>
                </header>
                <main className="p-4">
                    <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/accounts" element={<Accounts />} />
                        <Route path="/journal" element={<Journal />} />
                        <Route path="/ledger" element={<Ledger />} />
                        <Route path="/trial-balance" element={<TrialBalance />} />
                        <Route path="/worksheet" element={<Worksheet />} />
                        <Route path="/inventory" element={<Inventory />} />
                        <Route path="/fixed-assets" element={<FixedAssets />} />
                        <Route path="/ufv" element={<UFV />} />
                        <Route path="/exchange-rate" element={<ExchangeRate />} />
                        <Route path="/reports" element={<Reports />} />
                        <Route path="/data-forge" element={<DataForge />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/financial-statements" element={<FinancialStatements />} />
                    </Routes>
                </main>
            </div>
        </div>
    );
}

function App() {
    return (
        <CompanyProvider>
            <Router>
                <Routes>
                    <Route path="/" element={<CompanySelector />} />
                    <Route
                        path="/app/*"
                        element={
                            <ProtectedRoute>
                                <AppLayout />
                            </ProtectedRoute>
                        }
                    />
                </Routes>
                <style>{`
                    .hover-bg-secondary:hover {
                        background-color: rgba(255, 255, 255, 0.1) !important;
                    }
                    .sidebar a {
                        border-left: 3px solid transparent;
                    }
                    .sidebar a.bg-primary {
                        border-left-color: #ffc107;
                    }
                    .main-content {
                        transition: margin-left 0.3s, width 0.3s;
                    }
                    .company-badge {
                        animation: slideInDown 0.5s ease-out;
                    }
                    @keyframes slideInDown {
                        from {
                            opacity: 0;
                            transform: translateY(-10px);
                        }
                        to {
                            opacity: 1;
                            transform: translateY(0);
                        }
                    }
                        
                `}</style>
            </Router>
        </CompanyProvider>
    );
}

export default App;
