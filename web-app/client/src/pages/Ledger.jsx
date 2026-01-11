import React, { useState, useEffect, useMemo, useCallback } from 'react';
import MahoragaWheel from '../components/MahoragaWheel';
import axios from 'axios';
import API_URL from '../api';
import DatePicker from 'react-datepicker';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { useCompany } from '../context/CompanyContext';
import { exportToPDF, exportToExcel, generatePDFDoc } from '../utils/exportUtils';
import { getFiscalYearDetails } from '../utils/fiscalYearUtils';
import 'react-datepicker/dist/react-datepicker.css';

export default function Ledger() {
    const { selectedCompany } = useCompany();
    const companyId = selectedCompany?.id;

    // State
    const [accounts, setAccounts] = useState([]);
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [ledgerSummary, setLedgerSummary] = useState([]);
    const [accountDetail, setAccountDetail] = useState(null);
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [expandedRows, setExpandedRows] = useState({});
    const [allExpanded, setAllExpanded] = useState(false);
    const [ledgerDetails, setLedgerDetails] = useState([]);
    const [openingBalances, setOpeningBalances] = useState({});
    const [transactionNumbers, setTransactionNumbers] = useState({});

    // Filters
    const [dateStart, setDateStart] = useState(null);
    const [dateEnd, setDateEnd] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Export Modal State
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportConfig, setExportConfig] = useState({
        format: 'excel',
        fileName: '',
        orientation: 'portrait'
    });
    const [previewUrl, setPreviewUrl] = useState(null);

    // Export Logic
    const handleOpenExport = (format) => {
        const defaultName = accountDetail
            ? `Libro_Mayor_${accountDetail.account.code.replace(/\./g, '')}`
            : 'Libro_Mayor_Resumen';

        setExportConfig({
            format,
            fileName: defaultName,
            orientation: 'portrait'
        });
        setShowExportModal(true);
    };

    const getExportData = useCallback(() => {
        if (accountDetail) {
            const nature = getAccountNature(accountDetail.account.type);
            const adjustBalance = (bal) => nature === 'acreedor' ? -bal : bal;

            const data = accountDetail.movements.map(m => ({
                'Fecha': formatDate(m.date),
                'Referencia': m.reference || (m.transaction_type ? `${m.transaction_type} #${transactionNumbers[m.transaction_id] || m.transaction_id}` : 'S/N'),
                'Glosa': m.entry_glosa || m.glosa,
                'Debe': m.debit ? formatCurrency(m.debit) : '-',
                'Haber': m.credit ? formatCurrency(m.credit) : '-',
                'Saldo': renderBalance(m.running_balance, accountDetail.account.type, accountDetail.account.name).props.children
            }));

            // Add opening balance
            data.unshift({
                'Fecha': 'SALDO INICIAL',
                'Referencia': '',
                'Glosa': '',
                'Debe': '',
                'Haber': '',
                'Saldo': renderBalance(accountDetail.opening_balance, accountDetail.account.type, accountDetail.account.name).props.children
            });

            const columns = [
                { header: 'Fecha', field: 'Fecha' },
                { header: 'Referencia', field: 'Referencia' },
                { header: 'Glosa', field: 'Glosa' },
                { header: 'Debe', field: 'Debe' },
                { header: 'Haber', field: 'Haber' },
                { header: 'Saldo', field: 'Saldo' }
            ];

            // Fiscal period logic
            let subText = '';
            if (dateStart && dateEnd) {
                subText = `Del ${format(dateStart, 'dd/MM/yyyy')} al ${format(dateEnd, 'dd/MM/yyyy')}`;
            } else if (selectedCompany?.current_year && selectedCompany?.activity_type) {
                const fiscal = getFiscalYearDetails(selectedCompany.activity_type, selectedCompany.current_year, selectedCompany.operation_start_date);
                const fStart = new Date(fiscal.startDate + 'T00:00:00');
                const fEnd = new Date(fiscal.endDate + 'T00:00:00');
                const formatSpanish = (d) => format(d, "d 'de' MMMM 'de' yyyy", { locale: es });
                subText = `Del ${formatSpanish(fStart)} al ${formatSpanish(fEnd)}`;
            }

            return {
                data,
                columns,
                title: `Libro Mayor: ${accountDetail.account.name}`,
                subtitle: `${accountDetail.account.code} - ${accountDetail.account.type} (${subText})`
            };
        } else {
            const columns = [
                { header: 'Fecha', field: 'Fecha' },
                { header: 'Ref', field: 'Ref' },
                { header: 'Glosa', field: 'Glosa' },
                { header: 'Debe', field: 'Debe' },
                { header: 'Haber', field: 'Haber' },
                { header: 'Saldo', field: 'Saldo' }
            ];

            const groups = [];
            const accMap = {};
            (accounts || []).forEach(a => accMap[a.id] = a);

            const groupsMap = new Map();

            // 1. Agrupar manteniendo orden
            (ledgerDetails || []).forEach(row => {
                const accId = row.account_id;
                const acc = accMap[accId] || {};
                const code = row.account_code || acc.code || 'S/C';
                const name = row.account_name || acc.name || 'Sin Nombre';
                const type = row.account_type || acc.type || '';

                if (!groupsMap.has(accId)) {
                    groupsMap.set(accId, {
                        code, name, type, id: accId,
                        rows: []
                    });
                }
                groupsMap.get(accId).rows.push(row);
            });


            // 2. Procesar cada grupo para generar filas
            groupsMap.forEach(g => {
                const nature = getAccountNature(g.type || '');
                const rawOpening = openingBalances[g.id] || 0;
                let balance = 0;
                let totalDebit = 0;
                let totalCredit = 0;

                if (nature === 'deudor') balance = rawOpening;
                else balance = -rawOpening;

                const currentGroup = {
                    title: `${g.code} - ${g.name}`,
                    data: []
                };

                // Saldo Inicial
                currentGroup.data.push({
                    'Fecha': '',
                    'Ref': '',
                    'Glosa': 'SALDO ANTERIOR',
                    'Debe': '',
                    'Haber': '',
                    'Saldo': formatCurrency(balance)
                });

                // Movimientos
                g.rows.forEach(row => {
                    const debit = parseFloat(row.debit || 0);
                    const credit = parseFloat(row.credit || 0);
                    totalDebit += debit;
                    totalCredit += credit;

                    if (nature === 'deudor') balance += (debit - credit);
                    else balance += (credit - debit);

                    currentGroup.data.push({
                        'Fecha': formatDate(row.date),
                        'Ref': row.reference || (row.transaction_type ? `${row.transaction_type} #${transactionNumbers[row.transaction_id] || row.transaction_id}` : 'S/N'),
                        'Glosa': row.entry_glosa || row.glosa,
                        'Debe': debit !== 0 ? formatCurrency(debit) : '',
                        'Haber': credit !== 0 ? formatCurrency(credit) : '',
                        'Saldo': formatCurrency(balance)
                    });
                });

                // Totales
                currentGroup.data.push({
                    'Fecha': '',
                    'Ref': '',
                    'Glosa': 'TOTALES',
                    'Debe': formatCurrency(totalDebit),
                    'Haber': formatCurrency(totalCredit),
                    'Saldo': formatCurrency(balance)
                });

                groups.push(currentGroup);
            });
            // Fiscal period logic (General)
            let subText = '';
            if (dateStart && dateEnd) {
                subText = `Del ${format(dateStart, 'dd/MM/yyyy')} al ${format(dateEnd, 'dd/MM/yyyy')}`;
            } else if (selectedCompany?.current_year && selectedCompany?.activity_type) {
                const fiscal = getFiscalYearDetails(selectedCompany.activity_type, selectedCompany.current_year, selectedCompany.operation_start_date);
                const fStart = new Date(fiscal.startDate + 'T00:00:00');
                const fEnd = new Date(fiscal.endDate + 'T00:00:00');
                const formatSpanish = (d) => format(d, "d 'de' MMMM 'de' yyyy", { locale: es });
                subText = `Del ${formatSpanish(fStart)} al ${formatSpanish(fEnd)}`;
            } else {
                subText = `Generado el ${format(new Date(), 'dd/MM/yyyy')}`;
            }

            return {
                data: { isGrouped: true, groups },
                columns,
                title: 'Libro Mayor General - Detallado',
                subtitle: subText
            };
        }
    }, [accountDetail, ledgerDetails, ledgerSummary, openingBalances, accounts]);

    // Generate preview
    useEffect(() => {
        if (!showExportModal) {
            setPreviewUrl(null);
            return;
        }

        const { data, columns, title, subtitle } = getExportData();

        if (exportConfig.format === 'pdf') {
            try {
                const doc = generatePDFDoc(data, columns, title, {
                    ...exportConfig,
                    subtitle,
                    hideDefaultDate: !!(selectedCompany?.current_year)
                });
                const blobUrl = doc.output('bloburl');
                setPreviewUrl(blobUrl);
            } catch (e) {
                console.error("Error generating PDF preview", e);
            }
        }
    }, [showExportModal, exportConfig, getExportData]);

    const executeExport = () => {
        const { data, columns, title, subtitle } = getExportData();
        const fileName = exportConfig.fileName || 'Reporte';

        if (exportConfig.format === 'excel') {
            exportToExcel(data, 'Libro Mayor', fileName);
        } else {
            exportToPDF(data, columns, title, {
                fileName,
                orientation: exportConfig.orientation,
                subtitle,
                hideDefaultDate: !!(selectedCompany?.current_year)
            });
        }
        setShowExportModal(false);
    };

    // Fetch accounts list for selector
    useEffect(() => {
        fetchAccountsList();
    }, [companyId]);

    // Fetch ledger data when filters change
    const [mahoragaActive, setMahoragaActive] = useState(false);

    useEffect(() => {
        if (selectedAccountId) {
            fetchAccountDetail(selectedAccountId);
        } else {
            fetchLedgerSummary();
        }
    }, [companyId, dateStart, dateEnd, selectedAccountId]);

    useEffect(() => {
        if (companyId) {
            checkMahoragaStatus();
        }
    }, [companyId]);

    const checkMahoragaStatus = async () => {
        try {
            const response = await axios.get(`${API_URL}/api/ai/mahoraga/config/${companyId}`);
            if (response.data.success) {
                setMahoragaActive(response.data.active_pages.includes('Ledger'));
            }
        } catch (error) { console.error("Error checking Mahoraga status:", error); }
    };

    const fetchAccountsList = async () => {
        try {
            const response = await axios.get(`${API_URL}/api/reports/accounts-list`, {
                params: { companyId }
            });
            setAccounts(response.data.data || []);
        } catch (error) {
            console.error('Error fetching accounts list:', error);
        }
    };

    const fetchLedgerSummary = async () => {
        setLoading(true);
        try {
            const params = { companyId, _t: Date.now() };

            const periodParams = { ...params, _t: Date.now() };
            if (dateStart) periodParams.startDate = format(dateStart, 'yyyy-MM-dd');
            if (dateEnd) periodParams.endDate = format(dateEnd, 'yyyy-MM-dd');

            let openingPromise = Promise.resolve({ data: { data: [] } });
            if (dateStart) {
                const prevDate = subDays(dateStart, 1);
                const openingParams = { ...params, endDate: format(prevDate, 'yyyy-MM-dd') };
                openingPromise = axios.get(`${API_URL}/api/reports/ledger`, { params: openingParams });
            }

            const [summaryRes, detailsRes, openingRes] = await Promise.all([
                axios.get(`${API_URL}/api/reports/ledger`, { params: periodParams }),
                axios.get(`${API_URL}/api/reports/ledger-details`, { params: periodParams }),
                openingRes
            ]);

            setLedgerSummary(summaryRes.data.data || []);
            const details = detailsRes.data.data || [];
            setLedgerDetails(details);

            // Compute transaction numbering per type (Ingreso/Egreso/Traspaso/Ajuste)
            try {
                const txMap = new Map();
                details.forEach(d => {
                    if (!txMap.has(d.transaction_id)) txMap.set(d.transaction_id, { id: d.transaction_id, date: d.date, type: d.transaction_type });
                });
                const txList = Array.from(txMap.values()).sort((a, b) => new Date(a.date) - new Date(b.date) || a.id - b.id);
                const counts = {};
                const nums = {};
                txList.forEach(t => {
                    const typ = t.type || 'Otros';
                    counts[typ] = (counts[typ] || 0) + 1;
                    nums[t.id] = counts[typ];
                });
                setTransactionNumbers(nums);
            } catch (e) {
                setTransactionNumbers({});
            }

            const opMap = {};
            (openingRes.data.data || []).forEach(acc => {
                opMap[acc.id] = acc.balance;
            });
            setOpeningBalances(opMap);

            setAccountDetail(null);
        } catch (error) {
            console.error('Error fetching ledger summary:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchAccountDetail = async (accountId) => {
        setDetailLoading(true);
        try {
            const params = { companyId };
            if (dateStart) params.startDate = format(dateStart, 'yyyy-MM-dd');
            if (dateEnd) params.endDate = format(dateEnd, 'yyyy-MM-dd');

            const response = await axios.get(
                `${API_URL}/api/reports/ledger/account/${accountId}`,
                { params }
            );
            setAccountDetail(response.data.data);
        } catch (error) {
            console.error('Error fetching account detail:', error);
        } finally {
            setDetailLoading(false);
        }
    };

    // Combine summary with details for expandable view
    const ledgerWithDetails = useMemo(() => {
        return ledgerSummary.map(account => ({
            ...account,
            details: ledgerDetails.filter(d => d.account_id === account.id)
        }));
    }, [ledgerSummary, ledgerDetails]);

    // Filter by search term
    const filteredLedger = useMemo(() => {
        if (!searchTerm) return ledgerWithDetails;
        const term = searchTerm.toLowerCase();
        return ledgerWithDetails.filter(a =>
            a.code.toLowerCase().includes(term) ||
            a.name.toLowerCase().includes(term)
        );
    }, [ledgerWithDetails, searchTerm]);

    // Statistics
    const stats = useMemo(() => {
        const totalDebit = ledgerSummary.reduce((sum, a) => sum + (a.total_debit || 0), 0);
        const totalCredit = ledgerSummary.reduce((sum, a) => sum + (a.total_credit || 0), 0);
        return {
            totalAccounts: ledgerSummary.length,
            totalDebit,
            totalCredit,
            totalMovements: ledgerSummary.reduce((sum, a) => sum + (a.movement_count || 0), 0)
        };
    }, [ledgerSummary]);

    const toggleRow = (accountId) => {
        setExpandedRows(prev => ({
            ...prev,
            [accountId]: !prev[accountId]
        }));
    };

    const toggleAllRows = () => {
        if (allExpanded) {
            setExpandedRows({});
        } else {
            const newExpanded = {};
            filteredLedger.forEach(a => { newExpanded[a.id] = true; });
            setExpandedRows(newExpanded);
        }
        setAllExpanded(!allExpanded);
    };

    const clearFilters = () => {
        setDateStart(null);
        setDateEnd(null);
        setSearchTerm('');
        setSelectedAccountId('');
    };

    const handleAccountSelect = (e) => {
        setSelectedAccountId(e.target.value);
    };

    // Helper to determine account nature
    const getAccountNature = (type) => {
        const lowerType = type ? type.toLowerCase() : '';
        // Cuentas de naturaleza Deudora (Saldo normal = Debe)
        // Activo, Costo, Gasto/Egreso
        if (['activo', 'costo', 'gasto', 'egreso'].some(t => lowerType.includes(t))) {
            return 'deudor';
        }
        // Cuentas de naturaleza Acreedora (Saldo normal = Haber)
        // Pasivo, Patrimonio, Ingreso, Reguladoras
        return 'acreedor';
    };

    // Helper to identify accounts with variable nature (no fixed debit/credit expectation)
    // These accounts' balance sign is determined by the final result, not by convention
    const isVariableNatureAccount = (accountName) => {
        if (!accountName) return false;
        const lowerName = accountName.toLowerCase();

        // Pattern list for variable nature accounts (identified by name, not code)
        const variablePatterns = [
            // Exchange rate differences
            'diferencia de cambio', 'diferencias de cambio', 'tipo de cambio',
            // Inflation adjustments
            'exposicion a la inflacion', 'exposición a la inflación',
            'ajuste por inflacion', 'ajuste por inflación', 'ajuste por inflacion y tenencia de bienes',
            'tenencia de bienes', 'reme', 'resultado monetario', 'resultados por exposicion a la inflacion',
            // Value maintenance
            'mantenimiento de valor', 'mantenimiento del valor',
            // Profit and Loss / Accumulated Results
            'perdidas y ganancias', 'pérdidas y ganancias',

            'resultados de la gestion', 'resultados de la gestión',
            'resultado del ejercicio', 'resultado neto',
            'utilidad o perdida', 'utilidad o pérdida',
            'ganancia o perdida', 'ganancia o pérdida',
            // Other special accounts
            'resultado extraordinario', 'resultados extraordinarios',
            'otros resultados', 'resultado integral'
        ];

        return variablePatterns.some(pattern => lowerName.includes(pattern));
    };

    const formatCurrency = (value) => {
        const numValue = parseFloat(value || 0);
        return `Bs ${numValue.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return format(new Date(dateStr + 'T00:00:00'), 'dd/MM/yyyy', { locale: es });
    };

    // Render helper for amounts based on account nature
    const renderAmount = (amount, type, column) => {
        const nature = getAccountNature(type);
        const val = parseFloat(amount || 0);

        if (val === 0) return '-';

        // Color logic: Green if increases balance, Red if decreases
        let colorClass = '';
        if (nature === 'deudor') {
            // Activo/Gasto: Debe aumenta (Verde), Haber disminuye (Rojo)
            colorClass = column === 'debe' ? 'text-success' : 'text-danger';
        } else {
            // Pasivo/Ingreso: Haber aumenta (Verde), Debe disminuye (Rojo)
            colorClass = column === 'haber' ? 'text-success' : 'text-danger';
        }

        return <span className={colorClass}>{formatCurrency(val)}</span>;
    };

    const renderBalance = (balance, type, accountName = '') => {
        const nature = getAccountNature(type);
        let val = parseFloat(balance || 0);

        // Adjust balance sign based on nature
        // Backend sends (Debe - Haber). 
        // If nature is Acreedor, we want (Haber - Debe), so we negate it.
        if (nature === 'acreedor') {
            val = -val;
        }

        // Variable nature accounts don't have a "normal" balance direction
        // so we don't mark them as abnormal
        const isVariable = isVariableNatureAccount(accountName);

        // Si el saldo es positivo (normal), verde/negro. Si es negativo (anormal), rojo.
        const isNormal = val >= 0;
        // For variable nature accounts, always use normal styling (no red, no (A))
        const colorClass = (isNormal || isVariable) ? 'text-dark fw-bold' : 'text-danger fw-bold';

        // Display always as positive, color indicates abnormality
        const displayValue = Math.abs(val);
        // Only show (A) suffix for fixed-nature accounts with abnormal balance
        const suffix = (!isNormal && !isVariable) ? ' (A)' : '';

        return <span className={colorClass}>{formatCurrency(displayValue)}{suffix}</span>;
    };



    return (
        <div className="container-fluid">
            {/* Header */}
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2 className="mb-1">
                        <i className="bi bi-book me-2 text-primary"></i>
                        Libro Mayor
                    </h2>
                    <p className="text-muted mb-0">
                        {accountDetail
                            ? `Movimientos de: ${accountDetail.account.code} - ${accountDetail.account.name}`
                            : 'Resumen de movimientos por cuenta'}
                    </p>
                </div>
                <div className="d-flex gap-2 align-items-center">
                    {mahoragaActive && <MahoragaWheel size="small" />}
                    {!selectedAccountId && (
                        <button
                            className="btn btn-outline-secondary btn-sm"
                            onClick={toggleAllRows}
                        >
                            <i className={`bi bi-${allExpanded ? 'arrows-collapse' : 'arrows-expand'} me-1`}></i>
                            {allExpanded ? 'Colapsar' : 'Expandir'} Todos
                        </button>
                    )}
                    <button className="btn btn-success btn-sm" onClick={() => handleOpenExport('excel')}>
                        <i className="bi bi-file-earmark-excel me-1"></i> Excel
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleOpenExport('pdf')}>
                        <i className="bi bi-file-earmark-pdf me-1"></i> PDF
                    </button>
                </div>
            </div>

            {/* Statistics Cards */}
            <div className="row g-3 mb-4">
                <div className="col-md-3">
                    <div className="card bg-primary bg-opacity-10 border-0 h-100">
                        <div className="card-body">
                            <div className="d-flex align-items-center">
                                <div className="rounded-circle bg-primary bg-opacity-25 p-3 me-3">
                                    <i className="bi bi-journal-text text-primary fs-4"></i>
                                </div>
                                <div>
                                    <h3 className="mb-0 text-primary">{stats.totalAccounts}</h3>
                                    <small className="text-muted">Cuentas con Movimientos</small>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card bg-success bg-opacity-10 border-0 h-100">
                        <div className="card-body">
                            <div className="d-flex align-items-center">
                                <div className="rounded-circle bg-success bg-opacity-25 p-3 me-3">
                                    <i className="bi bi-arrow-down-circle text-success fs-4"></i>
                                </div>
                                <div>
                                    <h3 className="mb-0 text-success">{formatCurrency(stats.totalDebit)}</h3>
                                    <small className="text-muted">Total Debe</small>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card bg-danger bg-opacity-10 border-0 h-100">
                        <div className="card-body">
                            <div className="d-flex align-items-center">
                                <div className="rounded-circle bg-danger bg-opacity-25 p-3 me-3">
                                    <i className="bi bi-arrow-up-circle text-danger fs-4"></i>
                                </div>
                                <div>
                                    <h3 className="mb-0 text-danger">{formatCurrency(stats.totalCredit)}</h3>
                                    <small className="text-muted">Total Haber</small>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card bg-info bg-opacity-10 border-0 h-100">
                        <div className="card-body">
                            <div className="d-flex align-items-center">
                                <div className="rounded-circle bg-info bg-opacity-25 p-3 me-3">
                                    <i className="bi bi-receipt text-info fs-4"></i>
                                </div>
                                <div>
                                    <h3 className="mb-0 text-info">{stats.totalMovements}</h3>
                                    <small className="text-muted">Total Movimientos</small>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="card shadow-sm mb-4 border-0">
                <div className="card-body">
                    <div className="row g-3 align-items-end">
                        <div className="col-md-4">
                            <label className="form-label small text-muted">
                                <i className="bi bi-wallet2 me-1"></i>Cuenta
                            </label>
                            <select
                                className="form-select"
                                value={selectedAccountId}
                                onChange={handleAccountSelect}
                            >
                                <option value="">Todas las cuentas (Vista resumen)</option>
                                {accounts.map(a => (
                                    <option key={a.id} value={a.id}>
                                        {a.code} - {a.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="col-md-2">
                            <label className="form-label small text-muted">
                                <i className="bi bi-calendar3 me-1"></i>Desde
                            </label>
                            <DatePicker
                                selected={dateStart}
                                onChange={setDateStart}
                                className="form-control"
                                placeholderText="Fecha inicio"
                                dateFormat="dd/MM/yyyy"
                                locale={es}
                                isClearable
                                popperProps={{ strategy: 'fixed' }}
                            />
                        </div>
                        <div className="col-md-2">
                            <label className="form-label small text-muted">
                                <i className="bi bi-calendar3 me-1"></i>Hasta
                            </label>
                            <DatePicker
                                selected={dateEnd}
                                onChange={setDateEnd}
                                className="form-control"
                                placeholderText="Fecha fin"
                                dateFormat="dd/MM/yyyy"
                                locale={es}
                                isClearable
                                minDate={dateStart}
                                popperProps={{ strategy: 'fixed' }}
                            />
                        </div>
                        {!selectedAccountId && (
                            <div className="col-md-3">
                                <label className="form-label small text-muted">
                                    <i className="bi bi-search me-1"></i>Buscar
                                </label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="Código o nombre..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        )}
                        <div className="col-md-1">
                            <button
                                className="btn btn-outline-secondary w-100"
                                onClick={clearFilters}
                                title="Limpiar filtros"
                            >
                                <i className="bi bi-x-circle"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            {loading || detailLoading ? (
                <div className="card shadow-sm border-0">
                    <div className="card-body text-center py-5">
                        <div className="spinner-border text-primary" role="status"></div>
                        <p className="mt-3 text-muted mb-0">Cargando datos...</p>
                    </div>
                </div>
            ) : selectedAccountId && accountDetail ? (
                /* Single Account Detail View */
                <div className="card shadow-sm border-0">
                    <div className="card-header bg-primary bg-opacity-10 border-0">
                        <div className="d-flex justify-content-between align-items-center">
                            <div>
                                <h5 className="mb-0 text-primary">
                                    <i className="bi bi-journal-bookmark me-2"></i>
                                    {accountDetail.account.code} - {accountDetail.account.name}
                                </h5>
                                <small className="text-muted">{accountDetail.movements.length} movimientos</small>
                            </div>
                            <button
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => setSelectedAccountId('')}
                            >
                                <i className="bi bi-arrow-left me-1"></i>Ver todas
                            </button>
                        </div>
                    </div>
                    <div className="card-body p-0">
                        {/* Opening Balance */}
                        {dateStart && (
                            <div className="bg-light px-4 py-3 border-bottom">
                                <div className="d-flex justify-content-between align-items-center">
                                    <span className="text-muted">
                                        <i className="bi bi-clock-history me-2"></i>
                                        Saldo Inicial (antes del {formatDate(format(dateStart, 'yyyy-MM-dd'))})
                                    </span>
                                    {renderBalance(accountDetail.opening_balance, accountDetail.account.type, accountDetail.account.name)}
                                </div>
                            </div>
                        )}

                        {/* Movements Table */}
                        <div className="table-responsive">
                            <table className="table table-hover mb-0">
                                <thead className="table-light">
                                    <tr>
                                        <th style={{ width: '12%' }}>Fecha</th>
                                        <th style={{ width: '10%' }}>Ref.</th>
                                        <th style={{ width: '38%' }}>Glosa</th>
                                        <th className="text-end" style={{ width: '13%' }}>Debe</th>
                                        <th className="text-end" style={{ width: '13%' }}>Haber</th>
                                        <th className="text-end" style={{ width: '14%' }}>Saldo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accountDetail.movements.length === 0 ? (
                                        <tr>
                                            <td colSpan="6" className="text-center py-4 text-muted">
                                                <i className="bi bi-inbox me-2"></i>
                                                No hay movimientos en el período seleccionado
                                            </td>
                                        </tr>
                                    ) : (
                                        accountDetail.movements.map((m, idx) => (
                                            <tr key={idx}>
                                                <td>{formatDate(m.date)}</td>
                                                <td>
                                                    <span className="badge bg-light text-dark border">
                                                        {m.reference || (m.transaction_type ? `${m.transaction_type} #${m.type_number || m.transaction_id}` : 'S/N')}
                                                    </span>
                                                </td>
                                                <td className="text-truncate" style={{ maxWidth: '300px' }}>
                                                    {m.entry_glosa || m.glosa}
                                                </td>
                                                <td className="text-end">
                                                    {renderAmount(m.debit, accountDetail.account.type, 'debe')}
                                                </td>
                                                <td className="text-end">
                                                    {renderAmount(m.credit, accountDetail.account.type, 'haber')}
                                                </td>
                                                <td className="text-end">
                                                    {renderBalance(m.running_balance, accountDetail.account.type, accountDetail.account.name)}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Totals Footer */}
                        <div className="bg-light px-4 py-3 border-top">
                            <div className="row">
                                <div className="col-md-6">
                                    <div className="d-flex gap-4">
                                        <div>
                                            <small className="text-muted d-block">Total Debe</small>
                                            <strong className="text-dark">{formatCurrency(accountDetail.total_debit)}</strong>
                                        </div>
                                        <div>
                                            <small className="text-muted d-block">Total Haber</small>
                                            <strong className="text-dark">{formatCurrency(accountDetail.total_credit)}</strong>
                                        </div>
                                    </div>
                                </div>
                                <div className="col-md-6 text-end">
                                    <small className="text-muted d-block">Saldo Final</small>
                                    <span className="fs-5">
                                        {renderBalance(accountDetail.closing_balance, accountDetail.account.type, accountDetail.account.name)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                /* Summary View (All Accounts) */
                <div className="card shadow-sm border-0">
                    <div className="card-body p-0">
                        <div className="table-responsive">
                            <table className="table table-hover mb-0 align-middle">
                                <thead className="table-light">
                                    <tr>
                                        <th style={{ width: '40px' }}></th>
                                        <th style={{ width: '12%' }}>Código</th>
                                        <th>Nombre de Cuenta</th>
                                        <th className="text-end" style={{ width: '15%' }}>Debe</th>
                                        <th className="text-end" style={{ width: '15%' }}>Haber</th>
                                        <th className="text-end" style={{ width: '15%' }}>Saldo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredLedger.length === 0 ? (
                                        <tr>
                                            <td colSpan="6" className="text-center py-4 text-muted">
                                                <i className="bi bi-inbox me-2"></i>
                                                No hay movimientos registrados
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredLedger.map((account) => (
                                            <React.Fragment key={account.id}>
                                                {/* Account Row */}
                                                <tr
                                                    className="table-light"
                                                    onClick={() => toggleRow(account.id)}
                                                    style={{ cursor: 'pointer' }}
                                                >
                                                    <td className="text-center">
                                                        <i className={`bi bi-chevron-${expandedRows[account.id] ? 'down' : 'right'} text-muted`}></i>
                                                    </td>
                                                    <td>
                                                        <span className="badge bg-primary bg-opacity-10 text-primary">
                                                            {account.code}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <div className="fw-semibold">{account.name}</div>
                                                        <small className="text-muted">{account.type}</small>
                                                    </td>
                                                    <td className="text-end">
                                                        {renderAmount(account.total_debit, account.type, 'debe')}
                                                    </td>
                                                    <td className="text-end">
                                                        {renderAmount(account.total_credit, account.type, 'haber')}
                                                    </td>
                                                    <td className="text-end">
                                                        {renderBalance(account.balance, account.type, account.name)}
                                                    </td>
                                                </tr>

                                                {/* Expanded Details */}
                                                {expandedRows[account.id] && (
                                                    <tr>
                                                        <td colSpan="6" className="p-0 bg-white">
                                                            <div className="p-3 border-bottom bg-light bg-opacity-50">
                                                                <table className="table table-sm table-borderless mb-0 small">
                                                                    <thead className="text-muted border-bottom">
                                                                        <tr>
                                                                            <th style={{ width: '15%' }}>Fecha</th>
                                                                            <th style={{ width: '10%' }}>Ref.</th>
                                                                            <th style={{ width: '45%' }}>Glosa</th>
                                                                            <th className="text-end" style={{ width: '15%' }}>Debe</th>
                                                                            <th className="text-end" style={{ width: '15%' }}>Haber</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {account.details && account.details.length > 0 ? (
                                                                            account.details.map((detail, idx) => (
                                                                                <tr key={idx}>
                                                                                    <td>{formatDate(detail.date)}</td>
                                                                                    <td>
                                                                                        <span className="badge bg-light text-dark border">
                                                                                            {detail.reference || (detail.transaction_type ? `${detail.transaction_type} #${detail.type_number || detail.transaction_id}` : 'S/N')}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td>{detail.entry_glosa || detail.glosa}</td>
                                                                                    <td className="text-end">
                                                                                        {renderAmount(detail.debit, account.type, 'debe')}
                                                                                    </td>
                                                                                    <td className="text-end">
                                                                                        {renderAmount(detail.credit, account.type, 'haber')}
                                                                                    </td>
                                                                                </tr>
                                                                            ))
                                                                        ) : (
                                                                            <tr>
                                                                                <td colSpan="5" className="text-center text-muted fst-italic py-2">
                                                                                    Sin movimientos
                                                                                </td>
                                                                            </tr>
                                                                        )}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        ))
                                    )}
                                </tbody>
                                {/* Totals Footer */}
                                {filteredLedger.length > 0 && (
                                    <tfoot className="table-light border-top-2">
                                        <tr className="fw-bold">
                                            <td colSpan="3" className="text-end">TOTALES:</td>
                                            <td className="text-end text-success">
                                                {formatCurrency(stats.totalDebit)}
                                            </td>
                                            <td className="text-end text-danger">
                                                {formatCurrency(stats.totalCredit)}
                                            </td>
                                            <td className="text-end">
                                                {formatCurrency(stats.totalDebit - stats.totalCredit)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    </div>
                </div>
            )
            }

            {/* Export Modal */}
            {
                showExportModal && (
                    <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
                        <div className="modal-dialog modal-dialog-centered modal-xl">
                            <div className="modal-content shadow" style={{ maxHeight: '90vh' }}>
                                <div className="modal-header">
                                    <h5 className="modal-title">
                                        <i className={`bi bi-file-earmark-${exportConfig.format === 'excel' ? 'excel text-success' : 'pdf text-danger'} me-2`}></i>
                                        Exportar a {exportConfig.format === 'excel' ? 'Excel' : 'PDF'}
                                    </h5>
                                    <button type="button" className="btn-close" onClick={() => setShowExportModal(false)}></button>
                                </div>
                                <div className="modal-body p-0">
                                    <div className="row h-100 g-0">
                                        <div className="col-md-3 border-end p-3 bg-light">
                                            <form onSubmit={(e) => e.preventDefault()}>
                                                <div className="mb-3">
                                                    <label className="form-label fw-bold">Configuración</label>
                                                    <div className="mb-3">
                                                        <label className="form-label small">Nombre del archivo</label>
                                                        <input
                                                            type="text"
                                                            className="form-control"
                                                            value={exportConfig.fileName}
                                                            onChange={(e) => setExportConfig({ ...exportConfig, fileName: e.target.value })}
                                                        />
                                                    </div>
                                                    {exportConfig.format === 'pdf' && (
                                                        <div className="mb-3">
                                                            <label className="form-label small d-block">Orientación</label>
                                                            <div className="btn-group w-100" role="group">
                                                                <input
                                                                    type="radio"
                                                                    className="btn-check"
                                                                    name="orientation"
                                                                    id="portrait"
                                                                    checked={exportConfig.orientation === 'portrait'}
                                                                    onChange={() => setExportConfig({ ...exportConfig, orientation: 'portrait' })}
                                                                />
                                                                <label className="btn btn-outline-secondary btn-sm" htmlFor="portrait">
                                                                    <i className="bi bi-file-earmark me-1"></i>Vertical
                                                                </label>
                                                                <input
                                                                    type="radio"
                                                                    className="btn-check"
                                                                    name="orientation"
                                                                    id="landscape"
                                                                    checked={exportConfig.orientation === 'landscape'}
                                                                    onChange={() => setExportConfig({ ...exportConfig, orientation: 'landscape' })}
                                                                />
                                                                <label className="btn btn-outline-secondary btn-sm" htmlFor="landscape">
                                                                    <i className="bi bi-file-earmark-landscape me-1"></i>Horiz.
                                                                </label>
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div className="alert alert-info py-2 small mb-0">
                                                        <i className="bi bi-info-circle me-2"></i>
                                                        {accountDetail ? accountDetail.movements.length : ledgerSummary.length} registros listos.
                                                    </div>
                                                </div>
                                            </form>
                                        </div>
                                        <div className="col-md-9 p-3 bg-secondary bg-opacity-10 d-flex flex-column">
                                            <h6 className="text-muted mb-2 small text-uppercase fw-bold">Vista Previa</h6>
                                            <div className="flex-grow-1 bg-white shadow-sm border rounded overflow-hidden position-relative" style={{ minHeight: '400px', maxHeight: '60vh', overflowY: 'auto' }}>
                                                {exportConfig.format === 'pdf' ? (
                                                    previewUrl ? (
                                                        <iframe src={previewUrl} title="PDF Preview" style={{ width: '100%', height: '100%', minHeight: '500px', border: 'none' }} />
                                                    ) : (
                                                        <div className="d-flex align-items-center justify-content-center h-100 p-5">
                                                            <div className="spinner-border text-secondary" role="status"></div>
                                                            <span className="ms-2 text-muted">Generando vista previa...</span>
                                                        </div>
                                                    )
                                                ) : (
                                                    <div className="table-responsive">
                                                        {(() => {
                                                            const result = getExportData();
                                                            const { data, columns } = result;

                                                            if (data && data.isGrouped) {
                                                                return (
                                                                    <div className="p-2">
                                                                        {data.groups.slice(0, 5).map((g, gi) => (
                                                                            <div key={gi} className="mb-4">
                                                                                <h6 className="fw-bold border-bottom pb-1 bg-light px-2">{g.title}</h6>
                                                                                <table className="table table-striped table-sm small mb-0">
                                                                                    <thead>
                                                                                        <tr>{columns.map((c, ci) => <th key={ci} className="px-2 py-1">{c.header}</th>)}</tr>
                                                                                    </thead>
                                                                                    <tbody>
                                                                                        {g.data.slice(0, 10).map((r, ri) => (
                                                                                            <tr key={ri}>
                                                                                                {columns.map((c, ci) => <td key={ci} className="px-2 py-1 text-nowrap">{r[c.field]}</td>)}
                                                                                            </tr>
                                                                                        ))}
                                                                                    </tbody>
                                                                                </table>
                                                                            </div>
                                                                        ))}
                                                                        {data.groups.length > 5 && (
                                                                            <div className="text-center text-muted fst-italic mt-2 border-top pt-2">
                                                                                ... y {data.groups.length - 5} cuentas más ...
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            } else {
                                                                return (
                                                                    <>
                                                                        <table className="table table-striped table-bordered table-sm small mb-0">
                                                                            <thead className="table-light sticky-top">
                                                                                <tr>
                                                                                    {columns.map((col, i) => (
                                                                                        <th key={i} className="text-nowrap px-2 py-1">{col.header}</th>
                                                                                    ))}
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {Array.isArray(data) && data.slice(0, 100).map((row, i) => (
                                                                                    <tr key={i}>
                                                                                        {columns.map((col, j) => (
                                                                                            <td key={j} className="text-nowrap px-2 py-1">{row[col.field]}</td>
                                                                                        ))}
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                        {Array.isArray(data) && data.length > 100 && (
                                                                            <div className="text-center p-2 text-muted small bg-light border-top">
                                                                                Mostrando primeros 100 registros...
                                                                            </div>
                                                                        )}
                                                                    </>
                                                                );
                                                            }
                                                        })()}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="modal-footer bg-light">
                                    <button type="button" className="btn btn-outline-secondary" onClick={() => setShowExportModal(false)}>
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        className={`btn btn-${exportConfig.format === 'excel' ? 'success' : 'danger'}`}
                                        onClick={executeExport}
                                    >
                                        <i className="bi bi-download me-2"></i>Descargar Archivo
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

        </div >
    );
}
