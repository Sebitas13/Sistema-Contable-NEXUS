import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useCompany } from '../context/CompanyContext';
import axios from 'axios';
import API_URL from '../api';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { FinancialStatementEngine } from '../utils/FinancialStatementEngine';
import { generarEstadoResultadosDesdeWorksheet } from '../utils/IncomeStatementEngine';
import { motion, AnimatePresence } from 'framer-motion';
import Sparkline from '../components/Sparkline';
import CountUp from '../components/CountUp';

// Torres 3D de la ecuación contable, diferidas (no pesan en el bundle principal).
const BalanceTowers3D = lazy(() => import('../three/BalanceTowers3D'));

export default function Dashboard() {
  const { selectedCompany } = useCompany();
  const [stats, setStats] = useState({
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    totalTransactions: 0,
  });
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [activitySeries, setActivitySeries] = useState([]);
  const [loading, setLoading] = useState(true);
  // Error de carga (p. ej. cold start de Render): nunca mostrar "Bs 0.00" como si
  // fueran saldos reales. Se distingue con '—' + banner de reintentos.
  const [loadError, setLoadError] = useState(false);

  const retryTimerRef = useRef(null);
  const attemptRef = useRef(0);
  // Siempre apunta a la ÚLTIMA versión de fetchDashboardData (evita closures stale
  // en el setTimeout de reintento si la empresa activa cambió).
  const fetchRef = useRef(() => {});

  useEffect(() => {
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, []);

  useEffect(() => {
    if (selectedCompany) {
      fetchDashboardData();
    } else {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      attemptRef.current = 0;
      setLoading(false);
      setLoadError(false);
      setStats({ totalAssets: 0, totalLiabilities: 0, totalEquity: 0, totalTransactions: 0 });
      setRecentTransactions([]);
      setActivitySeries([]);
    }
  }, [selectedCompany]);

  const fetchDashboardData = async () => {
    if (!selectedCompany) return;
    setLoading(true);
    setLoadError(false);
    try {
      const companyId = selectedCompany.id;

      // 1. Obtener TODOS los catálogos y movimientos como hace el Balance General
      const [accountsRes, bcRes, adjRes, statsRes, transRes] = await Promise.all([
        axios.get(`${API_URL}/api/accounts`, { params: { companyId } }),
        axios.get(`${API_URL}/api/reports/ledger`, { params: { companyId, excludeAdjustments: true, excludeClosing: true } }),
        axios.get(`${API_URL}/api/reports/ledger`, { params: { companyId, adjustmentsOnly: true, excludeClosing: true } }),
        axios.get(`${API_URL}/api/companies/${companyId}/stats`),
        axios.get(`${API_URL}/api/transactions`, { params: { companyId } })
      ]);

      const allAccounts = accountsRes.data.data || [];
      const bcData = bcRes.data.data || [];
      const adjData = adjRes.data.data || [];

      // Mapear para búsqueda rápida por ID
      const bcMap = {};
      bcData.forEach(item => bcMap[item.id] = item);
      const adjMap = {};
      adjData.forEach(item => adjMap[item.id] = item);

      // Sincronizar preparación de datos con FinancialStatements.jsx (Línea 168+)
      const merged = allAccounts.map(acc => {
        const bcInfo = bcMap[acc.id] || { total_debit: 0, total_credit: 0 };
        const adjInfo = adjMap[acc.id] || { total_debit: 0, total_credit: 0 };

        return {
          ...acc,
          total_debit: bcInfo.total_debit || 0,
          total_credit: bcInfo.total_credit || 0,
          adj_debit: adjInfo.total_debit || 0,
          adj_credit: adjInfo.total_credit || 0
        };
      });

      // 2. Recuperar configuración de Worksheet
      let options = {};
      try {
        const key = `worksheet_custom_section_${companyId}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          const obj = JSON.parse(raw);
          options = {
            porcentajeReservaLegal: obj.reservaLegalPct !== undefined ? obj.reservaLegalPct : 5,
            overrideReservaLegal: obj.overrideReservaLegal || false
          };
        }
      } catch (e) { }

      // 3. Calcular Resultados dinámicos (ER)
      const reporteV5 = await generarEstadoResultadosDesdeWorksheet(companyId, options);
      const { iue, reservaLegal, utilidadLiquida } = reporteV5.totales;

      // 4. Calcular Totales usando la lógica EXACTA de Estados Financieros
      // IMPORTANTE: El motor usa `total_debit` y `total_credit`. Debemos sumar los ajustes antes de pasarlo.
      const preparedData = merged.map(acc => ({
        ...acc,
        total_debit: (Number(acc.total_debit) || 0) + (Number(acc.adj_debit) || 0),
        total_credit: (Number(acc.total_credit) || 0) + (Number(acc.adj_credit) || 0)
      }));

      const engine = new FinancialStatementEngine(preparedData);

      // Inyectar resultados externos como se hace en FinancialStatements.jsx
      engine.utilidadLiquidaExterna = utilidadLiquida;
      engine.iuePorPagar = iue;
      engine.reservaLegalMonto = reservaLegal;

      // Generar el balance completo para obtener los totales finales estructurales
      const balanceGeneral = await engine.generarBalanceGeneral();

      // Extraer totales directamente de la estructura generada (Motor v4.0)
      const finalActivo = balanceGeneral.totales.activo;
      const finalPasivo = balanceGeneral.totales.pasivo;
      const finalPatrimonio = balanceGeneral.totales.patrimonio;

      setStats({
        totalAssets: finalActivo,
        totalLiabilities: finalPasivo,
        totalEquity: finalPatrimonio,
        totalTransactions: statsRes.data.data?.total_transactions || 0,
        isClosed: statsRes.data.data?.is_closed || false
      });

      const allTransactions = transRes.data.data || [];
      setRecentTransactions(allTransactions.slice(0, 5));
      setActivitySeries(buildActivitySeries(allTransactions, 14));
      attemptRef.current = 0;
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      setLoadError(true);
      // Auto-retry con backoff (hasta 3 intentos): el servidor puede estar despertando.
      attemptRef.current += 1;
      if (attemptRef.current <= 3) {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => fetchRef.current(), 8000 * attemptRef.current);
      }
    } finally {
      setLoading(false);
    }
  };

  fetchRef.current = fetchDashboardData;

  const formatCurrency = (value) => {
    return `Bs ${(value || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Serie diaria de asientos de los últimos `days` días (orden cronológico) para el sparkline.
  const buildActivitySeries = (transactions, days = 14) => {
    const counts = new Map();
    for (const tx of transactions) {
      if (!tx?.date) continue;
      const key = String(tx.date).slice(0, 10);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const series = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      series.push(counts.get(key) || 0);
    }
    return series;
  };

  return (
    <div className="fade-in pb-5">
      <div className="mb-4 d-flex justify-content-between align-items-center">
        <div>
          <h2 className="mb-2 text-white" style={{ fontWeight: 800, letterSpacing: '-1px' }}>
            <i className="bi bi-grid-fill me-2" style={{ color: 'var(--accent-primary)' }}></i>
            Centro de Mando
          </h2>
          <p className="text-white-50">Visión panorámica e inteligencia financiera</p>
        </div>
        <button className="btn glass-panel btn-sm px-4" style={{ borderRadius: '12px' }} onClick={fetchDashboardData} disabled={loading}>
          <i className="bi bi-arrow-clockwise me-2"></i>Actualizar
        </button>
      </div>

      {/* Banner de error de carga: el usuario SABE que los datos no cargaron
          (p. ej. cold start de Render) en vez de ver ceros que parecen reales. */}
      {loadError && (
        <div className="glass-panel border-warning rounded-3 p-3 mb-4 d-flex flex-column flex-sm-row align-items-start align-items-sm-center gap-3" role="alert">
          <i className="bi bi-cloud-slash fs-2 text-warning"></i>
          <div className="flex-grow-1">
            <strong className="text-white d-block">
              <i className="bi bi-moon-stars me-2"></i>No se pudo cargar el resumen financiero
            </strong>
            <small className="text-white-50 d-block">
              El servidor puede estar despertando (plan gratuito de Render).
              {attemptRef.current <= 3 ? ' Reintentando automáticamente…' : ' Reintentos agotados.'}
            </small>
          </div>
          <button className="btn btn-sm btn-outline-warning flex-shrink-0" onClick={fetchDashboardData} disabled={loading}>
            <i className="bi bi-arrow-clockwise me-1"></i>Reintentar ahora
          </button>
        </div>
      )}

      <AnimatePresence>
        <motion.div 
          className="dashboard-bento-grid"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, staggerChildren: 0.1 }}
        >
          {/* Total Activos */}
          <motion.div layoutId="assets" className="bento-card bento-assets border border-primary border-opacity-25" whileHover={{ scale: 1.02, zIndex: 10 }}>
            <div className="d-flex justify-content-between align-items-start mb-3">
              <div className="p-2 rounded-3" style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-primary)' }}>
                <i className="bi bi-wallet2 fs-4"></i>
              </div>
              <span className="badge bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25 rounded-pill">Activos</span>
            </div>
            <div className="mt-auto">
              <small className="text-white-50 fw-semibold">Total Bienes y Derechos</small>
              <h3 className="mb-0 fw-bold text-white">{loading ? '...' : loadError ? '—' : <CountUp value={stats.totalAssets} format={formatCurrency} />}</h3>
            </div>
          </motion.div>

          {/* Total Pasivos */}
          <motion.div layoutId="liabilities" className="bento-card bento-liabilities border border-danger border-opacity-25" whileHover={{ scale: 1.02, zIndex: 10 }}>
            <div className="d-flex justify-content-between align-items-start mb-3">
              <div className="p-2 rounded-3" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-danger)' }}>
                <i className="bi bi-credit-card fs-4"></i>
              </div>
              <span className="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25 rounded-pill">Pasivos</span>
            </div>
            <div className="mt-auto">
              <small className="text-white-50 fw-semibold">Total Obligaciones</small>
              <h3 className="mb-0 fw-bold text-white">{loading ? '...' : loadError ? '—' : <CountUp value={stats.totalLiabilities} format={formatCurrency} />}</h3>
            </div>
          </motion.div>

          {/* Patrimonio */}
          <motion.div layoutId="equity" className="bento-card bento-equity border border-success border-opacity-25" whileHover={{ scale: 1.02, zIndex: 10 }}>
            <div className="d-flex justify-content-between align-items-start mb-3">
              <div className="p-2 rounded-3" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-success)' }}>
                <i className="bi bi-piggy-bank fs-4"></i>
              </div>
              <span className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 rounded-pill">Capital</span>
            </div>
            <div className="mt-auto">
              <small className="text-white-50 fw-semibold">Total Patrimonio</small>
              <h3 className="mb-0 fw-bold text-white">{loading ? '...' : loadError ? '—' : <CountUp value={stats.totalEquity} format={formatCurrency} />}</h3>
            </div>
          </motion.div>

          {/* Transacciones */}
          <motion.div layoutId="transactions" className="bento-card bento-transactions border border-warning border-opacity-25" whileHover={{ scale: 1.02, zIndex: 10 }}>
            <div className="d-flex justify-content-between align-items-start mb-3">
              <div className="p-2 rounded-3" style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--accent-warning)' }}>
                <i className="bi bi-receipt fs-4"></i>
              </div>
              <span className="badge bg-warning bg-opacity-10 text-warning border border-warning border-opacity-25 rounded-pill">Flujo</span>
            </div>
            <div className="mt-auto">
              <small className="text-white-50 fw-semibold">Asientos Registrados</small>
              <h3 className="mb-0 fw-bold text-white">{loading ? '...' : loadError ? '—' : <CountUp value={stats.totalTransactions} format={(v) => Math.round(v).toLocaleString('es-BO')} />}</h3>
            </div>
          </motion.div>

          {/* Actividad Reciente */}
          <motion.div layoutId="activity" className="bento-card bento-activity pe-0" style={{ paddingRight: 0 }}>
            <div className="d-flex justify-content-between align-items-center mb-4 pe-4">
              <h5 className="mb-0 fw-bold text-white"><i className="bi bi-clock-history me-2" style={{ color: 'var(--accent-primary)' }}></i>Actividad Reciente</h5>
              {!loading && activitySeries.some(v => v > 0) && (
                <div className="d-flex align-items-center gap-2" title="Asientos por día (últimos 14 días)">
                  <Sparkline data={activitySeries} width={110} height={30} color="#3b82f6" />
                  <small className="text-white-50 d-none d-sm-inline">14d</small>
                </div>
              )}
            </div>
            <div className="flex-grow-1 pe-4" style={{ overflowY: 'auto' }}>
              {loading ? (
                <div className="d-flex justify-content-center align-items-center h-100">
                  <div className="spinner-border text-primary"></div>
                </div>
              ) : recentTransactions.length > 0 ? (
                <div className="d-flex flex-column gap-3 pb-3">
                  {recentTransactions.map((tx, idx) => (
                    <motion.div 
                      key={tx.id} 
                      initial={{ x: -20, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: idx * 0.1 }}
                      className="d-flex justify-content-between align-items-center p-3 rounded-4"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)' }}
                      whileHover={{ scale: 1.01, background: 'rgba(255,255,255,0.06)' }}
                    >
                      <div>
                        <small className="d-block text-white-50 mb-1">{format(new Date(tx.date + 'T00:00:00'), 'dd MMM yyyy', { locale: es })}</small>
                        <strong className="text-white d-block">{tx.gloss}</strong>
                      </div>
                      <span className="badge rounded-pill px-3 py-2" style={{ 
                        background: tx.type === 'Ingreso' ? 'rgba(16, 185, 129, 0.2)' : tx.type === 'Egreso' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                        color: tx.type === 'Ingreso' ? 'var(--accent-success)' : tx.type === 'Egreso' ? 'var(--accent-danger)' : 'var(--accent-primary)'
                      }}>
                        {tx.type}
                      </span>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="d-flex flex-column justify-content-center align-items-center h-100 text-white-50">
                  <i className="bi bi-inbox mb-3" style={{ fontSize: '3rem', opacity: 0.5 }}></i>
                  <p className="mb-0">No hay transacciones recientes.</p>
                </div>
              )}
            </div>
          </motion.div>

          {/* Salud Financiera (Ratios y Cuentas) */}
          <motion.div layoutId="health" className="bento-card bento-health">
             <h6 className="fw-bold mb-4 text-white"><i className="bi bi-heart-pulse-fill me-2" style={{ color: 'var(--accent-danger)' }}></i>Ratios</h6>
             
             {/* Autonomía */}
             <div className="mb-4">
               {(() => {
                 const ratioValue = stats.totalAssets > 0 ? (stats.totalEquity / stats.totalAssets) : 0;
                 let status = { label: 'Indefinido', color: 'var(--text-secondary)' };
                 let isPulse = false;
                 if (ratioValue < 0.4) { status = { label: 'Riesgo', color: 'var(--accent-danger)' }; isPulse = true; }
                 else if (ratioValue <= 0.6) status = { label: 'Óptimo', color: 'var(--accent-success)' };
                 else if (ratioValue <= 0.8) status = { label: 'Sólido', color: 'var(--accent-primary)' };
                 else status = { label: 'Exceso', color: 'var(--text-secondary)' };

                 return (
                   <>
                     <div className="d-flex justify-content-between mb-1">
                       <small className="text-white-50">Autonomía ({status.label})</small>
                       <span className="fw-bold" style={{ color: status.color }}>{loading ? '...' : `${(ratioValue * 100).toFixed(1)}%`}</span>
                     </div>
                     <div className="progress rounded-pill" style={{ height: '6px', overflow: 'visible', background: 'rgba(255,255,255,0.1)' }}>
                       <div className={`progress-bar rounded-pill ${isPulse ? 'progress-pulse' : ''}`} style={{ width: `${Math.min(100, ratioValue * 100)}%`, backgroundColor: status.color, boxShadow: `0 0 10px ${status.color}` }}></div>
                     </div>
                   </>
                 );
               })()}
             </div>

             {/* Endeudamiento */}
             <div className="mb-4">
               {(() => {
                 const ratioValue = stats.totalAssets > 0 ? (stats.totalLiabilities / stats.totalAssets) : 0;
                 let status = { label: 'Indefinido', color: 'var(--text-secondary)' };
                 let isPulse = false;
                 if (ratioValue < 0.4) status = { label: 'Sólido', color: 'var(--accent-success)' };
                 else if (ratioValue <= 0.6) status = { label: 'Equilibrado', color: 'var(--accent-warning)' };
                 else { status = { label: 'Crítico', color: 'var(--accent-danger)' }; isPulse = true; }

                 return (
                   <>
                     <div className="d-flex justify-content-between mb-1">
                       <small className="text-white-50">Deuda ({status.label})</small>
                       <span className="fw-bold" style={{ color: status.color }}>{loading ? '...' : `${(ratioValue * 100).toFixed(1)}%`}</span>
                     </div>
                     <div className="progress rounded-pill" style={{ height: '6px', overflow: 'visible', background: 'rgba(255,255,255,0.1)' }}>
                       <div className={`progress-bar rounded-pill ${isPulse ? 'progress-pulse' : ''}`} style={{ width: `${Math.min(100, ratioValue * 100)}%`, backgroundColor: status.color, boxShadow: `0 0 10px ${status.color}` }}></div>
                     </div>
                   </>
                 );
               })()}
             </div>
             
             <div className="mt-auto p-3 rounded-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)' }}>
                <span className="d-block small text-white-50 mb-1">Periodo Activo</span>
                <strong className="d-block text-white mb-1">{selectedCompany?.name || 'Empresa'}</strong>
                <span className="badge bg-primary bg-opacity-20 text-white border border-primary border-opacity-50 rounded-pill mt-2">Gestión {selectedCompany?.current_year || new Date().getFullYear()}</span>
             </div>
          </motion.div>

           {/* Sistema */}
           <motion.div layoutId="system" className="bento-card bento-system align-items-center justify-content-center text-center">
              <i className={`bi mb-3 ${loadError ? 'bi-cloud-slash text-warning' : 'bi-hdd-network'}`} style={{ fontSize: '2.5rem', color: loadError ? undefined : 'var(--accent-success)' }}></i>
              <h6 className="fw-bold mb-3 text-white">{loadError ? 'Conectando…' : 'Sistema En Línea'}</h6>
              <span className={`badge rounded-pill px-3 py-2 ${loadError ? 'bg-warning text-dark border border-warning' : stats.isClosed ? 'bg-danger text-white border border-danger' : 'bg-success text-white border border-success'}`}>
                {loadError ? 'Despertando servidor…' : stats.isClosed ? 'Gestión Cerrada' : 'Totalmente Operativo'}
              </span>
           </motion.div>

          {/* Estructura Financiera (Torres 3D: Activo = Pasivo + Patrimonio) */}
          <motion.div layoutId="structure" className="bento-card bento-structure" whileHover={{ scale: 1.005 }}>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h6 className="fw-bold mb-0 text-white"><i className="bi bi-bar-chart-fill me-2" style={{ color: 'var(--accent-primary)' }}></i>Estructura Financiera</h6>
              <div className="d-flex gap-3 small">
                <span className="text-primary"><i className="bi bi-square-fill me-1"></i>Activo</span>
                <span className="text-danger"><i className="bi bi-square-fill me-1"></i>Pasivo</span>
                <span className="text-success"><i className="bi bi-square-fill me-1"></i>Patrimonio</span>
              </div>
            </div>
            <div className="flex-grow-1" style={{ minHeight: 200 }}>
              {loading ? (
                <div className="d-flex justify-content-center align-items-center h-100">
                  <div className="spinner-border text-primary"></div>
                </div>
              ) : (
                <Suspense fallback={<div className="d-flex justify-content-center align-items-center h-100 text-white-50"><div className="spinner-border text-primary"></div></div>}>
                  <BalanceTowers3D
                    values={{ activo: stats.totalAssets, pasivo: stats.totalLiabilities, patrimonio: stats.totalEquity }}
                    format={formatCurrency}
                  />
                </Suspense>
              )}
            </div>
          </motion.div>

        </motion.div>
      </AnimatePresence>
    </div>
  );
}
