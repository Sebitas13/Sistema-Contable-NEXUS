import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { CompanyProvider, useCompany } from './context/CompanyContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { isAuthenticated, clearToken } from './auth';
import Login from './pages/Login';
import CompanySelector from './pages/CompanySelector';
import Dashboard from './pages/Dashboard';
import Journal from './pages/Journal';
import Reports from './pages/Reports';
import Accounts from './pages/Accounts';
import Ledger from './pages/Ledger';
import TrialBalance from './pages/TrialBalance';
import Worksheet from './pages/Worksheet';
import CostCenters from './pages/CostCenters';
import FixedAssets from './pages/FixedAssets';
import UFV from './pages/UFV';
import ExchangeRate from './pages/ExchangeRate';
import DataForge from './DataForge/DataForge';
import FinancialStatements from './pages/FinancialStatements';
import Settings from './pages/Settings';
import CommandPalette from './components/CommandPalette';
import { ToastProvider } from './components/ToastProvider';
import { motion } from 'framer-motion';
import { useState, lazy, Suspense } from 'react';

// Fondo WebGL inmersivo cargado de forma diferida: nunca bloquea el arranque
// ni entra en el bundle principal (React.lazy + dynamic import).
const AmbientCanvas = lazy(() => import('./three/AmbientCanvas'));

function Sidebar({ collapsed, setCollapsed, mobileOpen, setMobileOpen }) {
    const location = useLocation();
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
        { path: '/app/cost-centers', icon: 'bi-diagram-3', label: 'Costos y Almacén' },
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
        <>
            {/* Mobile backdrop wrapper */}
            {mobileOpen && (
                <div 
                    className="sidebar-backdrop d-lg-none" 
                    onClick={() => setMobileOpen(false)}
                ></div>
            )}
            
            <div 
                className={`glass-panel sidebar-container ${collapsed ? 'collapsed-sidebar' : 'full-sidebar'} ${mobileOpen ? 'mobile-open' : ''}`}
                style={{ borderRadius: '0', borderLeft: 'none', borderTop: 'none', borderBottom: 'none' }}
            >
                <div className="p-3 border-bottom border-light border-opacity-10 d-flex flex-column gap-2">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                        {(!collapsed || mobileOpen) && (
                            <h5 className="mb-0 text-truncate">
                                <i className="bi bi-calculator-fill me-2"></i>
                                Contabilidad
                            </h5>
                        )}
                        {/* Mobile close button */}
                        <button className="btn btn-sm btn-outline-light border-0 d-lg-none" onClick={() => setMobileOpen(false)}>
                            <i className="bi bi-x-lg"></i>
                        </button>
                    </div>

                    {(!collapsed || mobileOpen) && selectedCompany && (
                        <div className="company-badge p-2 bg-primary bg-opacity-25 rounded mt-2">
                            <div className="d-flex align-items-center justify-content-between w-100">
                                <div className="text-truncate ps-1">
                                    <small className="text-white-50 d-block" style={{ fontSize: '0.7em' }}>Empresa Activa</small>
                                    <strong className="text-white small text-truncate d-block" style={{ maxWidth: '140px' }} title={selectedCompany.name}>{selectedCompany.name}</strong>
                                </div>
                                <button
                                    className="btn btn-sm btn-outline-light ms-1 px-2"
                                    onClick={handleChangeCompany}
                                    title="Cambiar empresa"
                                >
                                    <i className="bi bi-arrow-left-right"></i>
                                </button>
                            </div>
                        </div>
                    )}
                    
                    {/* Desktop collapse button */}
                    <button className="btn btn-sm btn-outline-light w-100 mt-2 d-none d-lg-block" onClick={() => setCollapsed(!collapsed)}>
                        <i className={`bi bi-chevron-${collapsed ? 'right' : 'left'}`}></i>
                        {!collapsed && <span className="ms-2">Colapsar</span>}
                    </button>
                </div>
                
                <nav className="py-3 sidebar-nav">
                    {menuItems.map((item) => {
                        const showLabel = !collapsed || mobileOpen;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                onClick={() => setMobileOpen(false)} // Close sidebar on mobile select
                                className={`d-flex align-items-center px-3 py-2 text-decoration-none ${isActive(item.path) ? 'bg-primary text-white' : 'text-white-50 hover-bg-secondary'}`}
                                style={{ transition: 'all 0.2s' }}
                                title={!showLabel ? item.label : ''}
                            >
                                <div className="icon-wrapper d-flex justify-content-center align-items-center" style={{ width: '30px' }}>
                                    <i className={`bi ${item.icon}`} style={{ fontSize: '1.2rem' }}></i>
                                </div>
                                {showLabel && <span className="ms-2 text-truncate">{item.label}</span>}
                            </Link>
                        );
                    })}
                </nav>
            </div>
        </>
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

// Auth gate: si la app requiere login y no hay token, redirige a /login.
function RequireAuth({ children }) {
    const { authRequired, ready } = useAuth();

    if (!ready) {
        return <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
            <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Cargando...</span>
            </div>
        </div>;
    }

    if (authRequired && !isAuthenticated()) {
        return <Navigate to="/login" replace />;
    }

    return children;
}

function AppLayout() {
    const { selectedCompany } = useCompany();
    const { authRequired } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = () => {
        clearToken();
        navigate('/login', { replace: true });
    };
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    return (
        <div className="app-layout">
            <Sidebar 
                collapsed={collapsed} 
                setCollapsed={setCollapsed} 
                mobileOpen={mobileOpen} 
                setMobileOpen={setMobileOpen} 
            />
            
            <div className={`main-content ${collapsed ? 'content-collapsed' : 'content-expanded'}`}>
                <header className="glass-panel py-3 px-3 px-md-4 sticky-top d-flex justify-content-between align-items-center mx-md-4 mt-md-3 mb-md-4 mx-2 mt-2 mb-3 shadow-lg" style={{ zIndex: 1020 }}>
                    <div className="d-flex align-items-center gap-2 overflow-hidden">
                        <button 
                            className="btn btn-outline-secondary d-lg-none"
                            onClick={() => setMobileOpen(true)}
                        >
                            <i className="bi bi-list fs-5"></i>
                        </button>
                        <div className="text-truncate">
                            <h5 className="mb-0 fw-bold text-truncate" style={{ fontSize: '1.1rem', color: 'var(--accent-primary)' }}>
                                <i className="bi bi-buildings me-2 d-none d-sm-inline-block"></i>
                                Sistema Contable
                            </h5>
                            {selectedCompany && (
                                <small className="text-white-50 d-none d-md-block text-truncate">
                                    {selectedCompany.name}
                                    {selectedCompany.nit && <span className="ms-2">• NIT: {selectedCompany.nit}</span>}
                                </small>
                            )}
                        </div>
                    </div>
                    
                    <div className="d-flex align-items-center gap-2 gap-sm-3 flex-shrink-0">
                        <button
                            className="btn btn-outline-secondary btn-sm d-none d-md-flex align-items-center gap-2"
                            onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
                            title="Búsqueda rápida (Ctrl + K)"
                        >
                            <i className="bi bi-search"></i>
                            <kbd className="command-kbd">Ctrl K</kbd>
                        </button>
                        <span className="text-white-50 d-none d-sm-flex align-items-center">
                            <i className="bi bi-person-circle me-1"></i>
                            <span className="d-none d-md-inline">Usuario:</span> Admin
                        </span>
                        <button
                            className="btn btn-outline-primary btn-sm d-flex align-items-center px-2 px-sm-3"
                            onClick={() => navigate('/')}
                        >
                            <i className="bi bi-building me-1"></i>
                            <span className="d-none d-sm-inline">Cambiar Empresa</span>
                        </button>
                        {authRequired && (
                            <button
                                className="btn btn-outline-danger btn-sm d-flex align-items-center px-2 px-sm-3"
                                onClick={handleLogout}
                                title="Cerrar sesión"
                            >
                                <i className="bi bi-box-arrow-right me-1"></i>
                                <span className="d-none d-sm-inline">Salir</span>
                            </button>
                        )}
                    </div>
                </header>
                <main className="p-3 p-md-4 main-view-area">
                    <motion.div
                        key={location.pathname}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/accounts" element={<Accounts />} />
                            <Route path="/journal" element={<Journal />} />
                            <Route path="/ledger" element={<Ledger />} />
                            <Route path="/trial-balance" element={<TrialBalance />} />
                            <Route path="/worksheet" element={<Worksheet />} />
                            <Route path="/cost-centers" element={<CostCenters />} />
                            <Route path="/fixed-assets" element={<FixedAssets />} />
                            <Route path="/ufv" element={<UFV />} />
                            <Route path="/exchange-rate" element={<ExchangeRate />} />
                            <Route path="/reports" element={<Reports />} />
                            <Route path="/data-forge" element={<DataForge />} />
                            <Route path="/settings" element={<Settings />} />
                            <Route path="/financial-statements" element={<FinancialStatements />} />
                        </Routes>
                    </motion.div>
                </main>
            </div>

            <CommandPalette />
        </div>
    );
}

function App() {
    return (
        <ToastProvider>
        <AuthProvider>
        <CompanyProvider>
            <Router>
                <Suspense fallback={null}>
                    <AmbientCanvas />
                </Suspense>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route
                        path="/"
                        element={
                            <RequireAuth>
                                <CompanySelector />
                            </RequireAuth>
                        }
                    />
                    <Route
                        path="/app/*"
                        element={
                            <RequireAuth>
                                <ProtectedRoute>
                                    <AppLayout />
                                </ProtectedRoute>
                            </RequireAuth>
                        }
                    />
                </Routes>
                <style>{`
                    /* Global Layout Variables */
                    :root {
                        --sidebar-width: 280px;
                        --sidebar-collapsed-width: 80px;
                        --sidebar-bg: rgba(11, 14, 20, 0.6);
                        --content-bg: transparent;
                    }

                    body, html {
                        margin: 0;
                        padding: 0;
                        overflow-x: hidden; /* Prevent horizontal scroll completely */
                    }

                    .app-layout {
                        display: flex;
                        min-height: 100vh;
                        width: 100vw;
                        overflow-x: hidden;
                        background-color: var(--content-bg);
                    }

                    /* Sidebar Base Styling */
                    .sidebar-container {
                        position: fixed;
                        top: 0;
                        left: 0;
                        height: 100vh;
                        background: var(--sidebar-bg);
                        backdrop-filter: blur(16px);
                        -webkit-backdrop-filter: blur(16px);
                        border-right: 1px solid rgba(255, 255, 255, 0.08);
                        transition: transform 0.3s ease, width 0.3s ease;
                        z-index: 1040; /* HIGHER than the sticky-top header (1020) */
                        display: flex;
                        flex-direction: column;
                        overflow-x: hidden;
                    }

                    .sidebar-nav {
                        flex: 1;
                        overflow-y: auto;
                        overflow-x: hidden;
                    }

                    .sidebar-nav::-webkit-scrollbar {
                        width: 6px;
                    }
                    .sidebar-nav::-webkit-scrollbar-thumb {
                        background-color: rgba(255,255,255,0.2);
                        border-radius: 4px;
                    }

                    /* Sidebar Desktop States */
                    @media (min-width: 992px) {
                        .full-sidebar {
                            width: var(--sidebar-width);
                            transform: translateX(0);
                        }
                        .collapsed-sidebar {
                            width: var(--sidebar-collapsed-width);
                            transform: translateX(0);
                        }
                        .main-content {
                            transition: margin-left 0.3s ease, width 0.3s ease;
                        }
                        .content-expanded {
                            margin-left: var(--sidebar-width);
                            width: calc(100% - var(--sidebar-width));
                        }
                        .content-collapsed {
                            margin-left: var(--sidebar-collapsed-width);
                            width: calc(100% - var(--sidebar-collapsed-width));
                        }
                    }

                    /* Sidebar Mobile States */
                    @media (max-width: 991.98px) {
                        .sidebar-container {
                            width: var(--sidebar-width); /* Fixed width on mobile */
                            transform: translateX(-100%); /* Hidden by default */
                        }
                        .sidebar-container.mobile-open {
                            transform: translateX(0);
                            box-shadow: 4px 0 15px rgba(0,0,0,0.3);
                        }
                        .main-content {
                            width: 100%;
                            margin-left: 0;
                            transition: transform 0.3s ease;
                        }
                        
                        /* Fix padding on small devices */
                        .main-view-area {
                            padding: 1rem !important;
                            max-width: 100vw;
                            overflow-x: hidden;
                        }

                        /* If a table exists in main view, make sure it scrolls */
                        .table-responsive {
                            max-width: 100%;
                            width: 100%;
                            overflow-x: auto;
                        }
                    }

                    /* Mobile Menu Backdrop */
                    .sidebar-backdrop {
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100vw;
                        height: 100vh;
                        background-color: rgba(0, 0, 0, 0.5);
                        z-index: 1035; /* Below sidebar, above header */
                        backdrop-filter: blur(2px);
                        animation: fadeIn 0.3s ease;
                    }

                    /* Utility UI effects */
                    .hover-bg-secondary:hover {
                        background-color: rgba(255, 255, 255, 0.1) !important;
                    }
                    .sidebar-nav a {
                        border-left: 3px solid transparent;
                    }
                    .sidebar-nav a.bg-primary {
                        background-color: rgba(59, 130, 246, 0.15) !important;
                        border-left-color: var(--accent-primary);
                        color: var(--accent-primary) !important;
                    }
                    .company-badge {
                        animation: slideInDown 0.4s ease-out;
                    }

                    @keyframes slideInDown {
                        from { opacity: 0; transform: translateY(-10px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    @keyframes fadeIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                `}</style>
            </Router>
        </CompanyProvider>
        </AuthProvider>
        </ToastProvider>
    );
}

export default App;
