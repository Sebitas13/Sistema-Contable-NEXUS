import React, { useState, useEffect } from 'react';
import { useCompany } from '../context/CompanyContext';
import axios from 'axios';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { FinancialStatementEngine } from '../utils/FinancialStatementEngine';
import { generarEstadoResultadosDesdeWorksheet } from '../utils/IncomeStatementEngine';

export default function Dashboard() {
  const { selectedCompany } = useCompany();
  const [stats, setStats] = useState({
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    totalTransactions: 0,
  });
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (selectedCompany) {
      fetchDashboardData();
    } else {
      setLoading(false);
      setStats({ totalAssets: 0, totalLiabilities: 0, totalEquity: 0, totalTransactions: 0 });
      setRecentTransactions([]);
    }
  }, [selectedCompany]);

  const fetchDashboardData = async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const companyId = selectedCompany.id;

      // 1. Obtener TODOS los catálogos y movimientos como hace el Balance General
      const [accountsRes, bcRes, adjRes, statsRes, transRes] = await Promise.all([
        axios.get(`/api/accounts`, { params: { companyId } }),
        axios.get(`/api/reports/ledger`, { params: { companyId, excludeAdjustments: true, excludeClosing: true } }),
        axios.get(`/api/reports/ledger`, { params: { companyId, adjustmentsOnly: true, excludeClosing: true } }),
        axios.get(`/api/companies/${companyId}/stats`),
        axios.get(`/api/transactions`, { params: { companyId } })
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
      const balanceGeneral = engine.generarBalanceGeneral();

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

      setRecentTransactions((transRes.data.data || []).slice(0, 5));
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value) => {
    return `Bs ${(value || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="fade-in">
      <div className="mb-4">
        <h2 className="mb-2"><i className="bi bi-grid-3x3-gap-fill me-2 text-primary"></i>Dashboard</h2>
        <p className="text-muted">Bienvenido al Sistema Contable - Resumen Ejecutivo</p>
      </div>

      <div className="row g-4 mb-4">
        <div className="col-md-3">
          <div className="card shadow-sm h-100 border-0" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
            <div className="card-body text-white">
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <h6 className="mb-1 opacity-75">Total Activos</h6>
                  <h2 className="mb-0 fw-bold">{loading ? '...' : formatCurrency(stats.totalAssets)}</h2>
                  <small className="opacity-75"><i className="bi bi-plus me-1"></i>Bienes y derechos</small>
                </div>
                <div className="bg-white bg-opacity-25 p-3 rounded-3">
                  <i className="bi bi-wallet2" style={{ fontSize: '2rem' }}></i>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-3">
          <div className="card shadow-sm h-100 border-0" style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}>
            <div className="card-body text-white">
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <h6 className="mb-1 opacity-75">Total Pasivos</h6>
                  <h2 className="mb-0 fw-bold">{loading ? '...' : formatCurrency(stats.totalLiabilities)}</h2>
                  <small className="opacity-75"><i className="bi bi-dash me-1"></i>Obligaciones</small>
                </div>
                <div className="bg-white bg-opacity-25 p-3 rounded-3">
                  <i className="bi bi-credit-card" style={{ fontSize: '2rem' }}></i>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-3">
          <div className="card shadow-sm h-100 border-0" style={{ background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' }}>
            <div className="card-body text-white">
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <h6 className="mb-1 opacity-75">Patrimonio</h6>
                  <h2 className="mb-0 fw-bold">{loading ? '...' : formatCurrency(stats.totalEquity)}</h2>
                  <small className="opacity-75"><i className="bi bi-graph-up me-1"></i>Capital + Resultados</small>
                </div>
                <div className="bg-white bg-opacity-25 p-3 rounded-3">
                  <i className="bi bi-piggy-bank" style={{ fontSize: '2rem' }}></i>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-3">
          <div className="card shadow-sm h-100 border-0" style={{ background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' }}>
            <div className="card-body text-white">
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <h6 className="mb-1 opacity-75">Transacciones</h6>
                  <h2 className="mb-0 fw-bold">{loading ? '...' : stats.totalTransactions}</h2>
                  <small className="opacity-75"><i className="bi bi-calendar-check me-1"></i>Registros totales</small>
                </div>
                <div className="bg-white bg-opacity-25 p-3 rounded-3">
                  <i className="bi bi-receipt" style={{ fontSize: '2rem' }}></i>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-md-8">
          <div className="card shadow-sm border-0 rounded-4">
            <div className="card-header bg-white border-bottom d-flex justify-content-between align-items-center py-3">
              <h5 className="mb-0 fw-bold"><i className="bi bi-clock-history me-2 text-primary"></i>Actividad Reciente</h5>
              <button className="btn btn-sm btn-outline-primary rounded-pill px-3" onClick={fetchDashboardData} disabled={loading}>
                <i className="bi bi-arrow-clockwise me-1"></i>Actualizar
              </button>
            </div>
            <div className="card-body">
              {loading ? (
                <div className="text-center py-5"><div className="spinner-border text-primary"></div></div>
              ) : recentTransactions.length > 0 ? (
                <ul className="list-group list-group-flush">
                  {recentTransactions.map(tx => (
                    <li key={tx.id} className="list-group-item d-flex justify-content-between align-items-center px-0 py-3">
                      <div>
                        <small className="d-block text-muted fw-semibold">{format(new Date(tx.date + 'T00:00:00'), 'dd MMM yyyy', { locale: es })}</small>
                        <strong className="text-dark d-block mt-1">{tx.gloss}</strong>
                      </div>
                      <span className={`badge rounded-pill bg-${tx.type === 'Ingreso' ? 'success' : tx.type === 'Egreso' ? 'danger' : 'info'} px-3`}>{tx.type}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-inbox" style={{ fontSize: '3rem', opacity: 0.3 }}></i>
                  <p className="mt-3 mb-0">No hay transacciones recientes.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-md-4">
          <div className="card shadow-sm border-0 mb-4 rounded-4 overflow-hidden">
            <div className="card-header bg-white border-bottom py-3">
              <h5 className="mb-0 fw-bold d-flex align-items-center">
                <i className="bi bi-pie-chart-fill me-2 text-primary"></i>
                Salud Financiera
              </h5>
            </div>
            <div className="card-body">
              <div className="mb-4">
                {(() => {
                  const ratioValue = stats.totalAssets > 0 ? (stats.totalEquity / stats.totalAssets) : 0;
                  let status = { label: 'Indefinido', color: '#6B7280' };

                  if (ratioValue < 0.4) status = { label: 'Riesgo Bajo', color: '#EF4444' };
                  else if (ratioValue <= 0.6) status = { label: 'Óptimo', color: '#10B981' };
                  else if (ratioValue <= 0.8) status = { label: 'Sólido', color: '#3B82F6' };
                  else status = { label: 'Exceso', color: '#6B7280' };

                  return (
                    <>
                      <div className="d-flex justify-content-between align-items-end mb-1">
                        <span className="small fw-semibold text-muted">Ratio de autonomía financiera</span>
                        <span className="fw-bold fs-5" style={{ color: status.color, lineHeight: 1 }}>
                          {loading ? '...' : `${(ratioValue * 100).toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="progress mb-1" style={{ height: '6px' }}>
                        <div className="progress-bar" role="progressbar"
                          style={{ width: `${Math.min(100, ratioValue * 100)}%`, backgroundColor: status.color }}></div>
                      </div>
                      <div className="d-flex justify-content-between align-items-center">
                        <span className="badge rounded-pill px-2 py-1" style={{ backgroundColor: status.color, fontSize: '0.6rem' }}>
                          {status.label}
                        </span>
                        <small className="text-muted" style={{ fontSize: '0.65rem' }}>Activos fin. con Patrimonio</small>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="mb-4">
                {(() => {
                  const ratioValue = stats.totalAssets > 0 ? (stats.totalLiabilities / stats.totalAssets) : 0;
                  let status = { label: 'Indefinido', color: '#6B7280' };

                  if (ratioValue < 0.4) status = { label: 'Conservador', color: '#6366F1' };
                  else if (ratioValue <= 0.6) status = { label: 'Equilibrado', color: '#10B981' };
                  else if (ratioValue <= 0.8) status = { label: 'Apalancado', color: '#F59E0B' };
                  else status = { label: 'Crítico', color: '#B91C1C' };

                  return (
                    <>
                      <div className="d-flex justify-content-between align-items-end mb-1">
                        <span className="small fw-semibold text-muted">Ratio de Endeudamiento</span>
                        <span className="fw-bold fs-5" style={{ color: status.color, lineHeight: 1 }}>
                          {loading ? '...' : `${(ratioValue * 100).toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="progress mb-1" style={{ height: '6px' }}>
                        <div className="progress-bar" role="progressbar"
                          style={{ width: `${Math.min(100, ratioValue * 100)}%`, backgroundColor: status.color }}></div>
                      </div>
                      <div className="d-flex justify-content-between align-items-center">
                        <span className="badge rounded-pill px-2 py-1" style={{ backgroundColor: status.color, fontSize: '0.6rem' }}>
                          {status.label}
                        </span>
                        <small className="text-muted" style={{ fontSize: '0.65rem' }}>Activos fin. con Deuda</small>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="p-3 bg-light rounded-3">
                <div className="d-flex align-items-center mb-2">
                  <i className="bi bi-calendar-event text-primary me-2"></i>
                  <span className="small fw-bold">Periodo Contable</span>
                </div>
                <p className="small text-dark mb-1 fw-semibold">{selectedCompany?.name || 'Empresa'}</p>
                <div className="d-flex flex-column mb-2">
                  <span className="small text-primary fw-bold">Gestión {selectedCompany?.current_year || new Date().getFullYear()}</span>
                  <small className="text-muted" style={{ fontSize: '0.7em' }}>
                    {(() => {
                      if (!selectedCompany) return '';
                      const activeYear = parseInt(selectedCompany.current_year) || new Date().getFullYear();
                      const type = selectedCompany.activity_type || 'Comercial';
                      let startStr, endStr;

                      if (type === 'Comercial') {
                        startStr = `01 Ene ${activeYear}`;
                        endStr = `31 Dic ${activeYear}`;
                      } else if (type === 'Industrial') {
                        startStr = `01 Abr ${activeYear - 1}`;
                        endStr = `31 Mar ${activeYear}`;
                      } else if (type === 'Agroindustrial') {
                        startStr = `01 Jul ${activeYear - 1}`;
                        endStr = `30 Jun ${activeYear}`;
                      } else if (type === 'Minera') {
                        startStr = `01 Oct ${activeYear - 1}`;
                        endStr = `30 Sep ${activeYear}`;
                      } else {
                        startStr = `01 Ene ${activeYear}`;
                        endStr = `31 Dic ${activeYear}`;
                      }

                      // Check for specific operation start date
                      if (selectedCompany.operation_start_date) {
                        try {
                          const [opY, opM, opD] = selectedCompany.operation_start_date.split('-').map(Number);
                          const opDate = new Date(opY, opM - 1, opD); // Month is 0-indexed

                          const monthsMap = { 'Ene': 0, 'Feb': 1, 'Mar': 2, 'Abr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Ago': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dic': 11 };

                          const [sd, sm, sy] = startStr.split(' ');
                          const stdStartDate = new Date(parseInt(sy), monthsMap[sm], parseInt(sd));

                          const [ed, em, ey] = endStr.split(' ');
                          const stdEndDate = new Date(parseInt(ey), monthsMap[em], parseInt(ed));

                          if (opDate > stdStartDate && opDate <= stdEndDate) {
                            const dayStr = opD.toString().padStart(2, '0');
                            const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
                            startStr = `${dayStr} ${monthNames[opDate.getMonth()]} ${opY}`;
                          }
                        } catch (e) { console.warn("Date parsing error", e); }
                      }

                      return `${startStr} - ${endStr}`;
                    })()}
                  </small>
                </div>
                <div className="d-flex gap-2">
                  <span className={`badge border ${stats.isClosed ? 'text-danger border-danger' : 'text-success border-success'}`}>
                    {stats.isClosed ? 'Cerrado' : 'Abierto'}
                  </span>
                  <span className="badge border text-secondary border-secondary">Auditado: No</span>
                </div>
              </div>
            </div>
          </div>

          <div className="card shadow-sm border-0 rounded-4 overflow-hidden">
            <div className="card-header bg-white border-bottom py-3">
              <h5 className="mb-0 fw-bold"><i className="bi bi-info-circle-fill me-2 text-info"></i>Estado del Sistema</h5>
            </div>
            <div className="card-body p-0">
              <div className="list-group list-group-flush">
                <div className="list-group-item d-flex justify-content-between align-items-center border-0 py-3">
                  <small className="text-muted fw-semibold uppercase">Base de Datos</small>
                  <span className="badge bg-success bg-opacity-10 text-success rounded-pill px-3">
                    <i className="bi bi-check-circle-fill me-1"></i>Conectado
                  </span>
                </div>
                <div className="list-group-item d-flex justify-content-between align-items-center border-0 py-3 pt-0">
                  <small className="text-muted fw-semibold">Último Cierre</small>
                  <span className="text-dark small fw-bold">{stats.isClosed ? 'Aplicado' : 'Pendiente'}</span>
                </div>
                <div className="list-group-item d-flex justify-content-between align-items-center border-0 py-3 pt-0">
                  <small className="text-muted fw-semibold">Versión</small>
                  <span className="text-primary small fw-bold">v1.2.0</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
