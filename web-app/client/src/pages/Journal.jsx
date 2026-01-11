import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import DatePicker from 'react-datepicker';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import { useCompany } from '../context/CompanyContext';
import ClosingWizard from '../pages/ClosingWizard.jsx';
import AdjustmentWizard from '../pages/AdjustmentWizard.jsx';
import { exportToPDF, exportToExcel, generatePDFDoc } from '../utils/exportUtils';
import MahoragaWheel from '../components/MahoragaWheel';
import { getFiscalYearDetails, MONTH_NAMES_SHORT } from '../utils/fiscalYearUtils';
export default function Journal() {
    const { selectedCompany } = useCompany();
    const companyId = selectedCompany?.id;
    const [transactions, setTransactions] = useState([]);
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [showClosingWizard, setShowClosingWizard] = useState(false);
    const [showAdjustmentWizard, setShowAdjustmentWizard] = useState(false);
    const [selectedTransaction, setSelectedTransaction] = useState(null);

    // Estados para filtros
    const [searchTerm, setSearchTerm] = useState('');
    const [filterDateStart, setFilterDateStart] = useState(null);
    const [filterDateEnd, setFilterDateEnd] = useState(null);
    const [filterType, setFilterType] = useState('Todos');

    // Estados para colapsar/expandir
    const [collapsedEntries, setCollapsedEntries] = useState({});
    const [allCollapsed, setAllCollapsed] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        date: new Date(),
        gloss: '',
        type: 'Ingreso',
        entries: []
    });

    // Totals for validation
    const [totals, setTotals] = useState({ debit: 0, credit: 0 });

    const [mahoragaActive, setMahoragaActive] = useState(false);

    useEffect(() => {
        if (companyId) {
            fetchTransactions();
            fetchAccounts();
            checkMahoragaStatus();
        }
    }, [companyId]);

    const checkMahoragaStatus = async () => {
        try {
            const response = await axios.get(`/api/ai/mahoraga/config/${companyId}`);
            if (response.data.success) {
                setMahoragaActive(response.data.active_pages.includes('Journal'));
            }
        } catch (error) { console.error("Error checking Mahoraga status:", error); }
    };

    // Calculate totals whenever entries change
    useEffect(() => {
        const newTotals = formData.entries.reduce((acc, entry) => ({
            debit: acc.debit + (parseFloat(entry.debit) || 0),
            credit: acc.credit + (parseFloat(entry.credit) || 0)
        }), { debit: 0, credit: 0 });
        setTotals(newTotals);
    }, [formData.entries]);

    const fetchTransactions = async () => {
        try {
            const response = await axios.get(`http://localhost:3001/api/transactions?companyId=${companyId}`);
            setTransactions(response.data.data);
            setLoading(false);
        } catch (error) {
            console.error('Error fetching transactions:', error);
            setLoading(false);
        }
    };

    const fetchAccounts = async () => {
        try {
            const response = await axios.get(`http://localhost:3001/api/accounts?companyId=${companyId}`);
            setAccounts(response.data.data);
        } catch (error) {
            console.error('Error fetching accounts:', error);
        }
    };

    const fetchTransactionDetails = async (id) => {
        try {
            const response = await axios.get(`http://localhost:3001/api/transactions/${id}`);
            setSelectedTransaction(response.data.data);
            setShowDetailModal(true);
        } catch (error) {
            console.error('Error fetching transaction details:', error);
            alert('Error al cargar los detalles de la transacción');
        }
    };

    // Funciones de colapso
    const toggleCollapse = (id) => {
        setCollapsedEntries(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    const toggleAllCollapse = () => {
        const newAllCollapsed = !allCollapsed;
        setAllCollapsed(newAllCollapsed);
        const newCollapsedState = {};
        transactions.forEach(t => {
            newCollapsedState[t.id] = newAllCollapsed;
        });
        setCollapsedEntries(newCollapsedState);
    };

    // Cálculos de estadísticas y numeración
    const { stats, transactionNumbers } = useMemo(() => {
        const sorted = [...transactions].sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateA - dateB || a.id - b.id;
        });

        const counts = { Ingreso: 0, Egreso: 0, Traspaso: 0, Ajuste: 0, Cierre: 0 };
        const numbers = {};

        sorted.forEach(t => {
            counts[t.type] = (counts[t.type] || 0) + 1;
            numbers[t.id] = counts[t.type];
        });

        return {
            stats: {
                total: transactions.length,
                ingreso: counts.Ingreso,
                egreso: counts.Egreso,
                traspaso: counts.Traspaso,
                ajuste: counts.Ajuste,
                cierre: counts.Cierre
            },
            transactionNumbers: numbers
        };
    }, [transactions]);

    // Lógica de filtrado
    const filteredTransactions = useMemo(() => {
        return transactions.filter(t => {
            // Filtro por término de búsqueda (glosa, cuenta, código)
            const searchLower = searchTerm.toLowerCase();
            const matchesSearch =
                t.gloss.toLowerCase().includes(searchLower) ||
                (t.entries && t.entries.some(e =>
                    e.account_name.toLowerCase().includes(searchLower) ||
                    e.account_code.toLowerCase().includes(searchLower)
                ));

            // Filtro por fecha
            let matchesDate = true;
            if (filterDateStart || filterDateEnd) {
                const tDate = new Date(t.date + 'T00:00:00');
                if (filterDateStart && tDate < filterDateStart) matchesDate = false;
                if (filterDateEnd) {
                    const endDate = new Date(filterDateEnd);
                    endDate.setHours(23, 59, 59, 999);
                    if (tDate > endDate) matchesDate = false;
                }
            }

            // Filtro por tipo
            const matchesType = filterType === 'Todos' || t.type === filterType;

            return matchesSearch && matchesDate && matchesType;
        });
    }, [transactions, searchTerm, filterDateStart, filterDateEnd, filterType]);

    const handleInputChange = (e) => {
        const { name, type, value, checked } = e.target;
        if (type === 'checkbox') {
            // when marking as adjustment, force type to 'Ajuste'
            const next = { ...formData, [name]: checked };
            if (name === 'isAdjustment' && checked) next.type = 'Ajuste';
            setFormData(next);
            return;
        }
        setFormData({ ...formData, [name]: value });
    };

    const handleDateChange = (date) => {
        setFormData({ ...formData, date: date });
    };

    const addEntry = () => {
        setFormData({
            ...formData,
            entries: [...formData.entries, {
                accountId: '',
                code: '',
                accountName: '',
                gloss: '',
                debit: '',
                credit: ''
            }]
        });
    };

    const removeEntry = (index) => {
        const newEntries = formData.entries.filter((_, i) => i !== index);
        setFormData({ ...formData, entries: newEntries });
    };

    const handleEntryChange = (index, field, value) => {
        const newEntries = [...formData.entries];

        if (field === 'code') {
            const account = accounts.find(a => a.code === value);
            newEntries[index] = {
                ...newEntries[index],
                code: value,
                accountId: account ? account.id : '',
                accountName: account ? account.name : ''
            };
        } else if (field === 'accountName') {
            const account = accounts.find(a => a.name === value);
            newEntries[index] = {
                ...newEntries[index],
                accountName: value,
                accountId: account ? account.id : '',
                code: account ? account.code : ''
            };
        } else {
            newEntries[index] = { ...newEntries[index], [field]: value };
        }

        setFormData({ ...formData, entries: newEntries });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (Math.abs(totals.debit - totals.credit) > 0.01) {
            alert('El asiento no cuadra. El Debe debe ser igual al Haber.');
            return;
        }
        if (formData.entries.length === 0) {
            alert('Debe agregar al menos una cuenta.');
            return;
        }
        if (formData.entries.some(e => !e.accountId)) {
            alert('Todas las líneas deben tener una cuenta válida seleccionada.');
            return;
        }

        try {
            const formattedEntries = formData.entries.map(entry => ({
                accountId: entry.accountId,
                debit: parseFloat(entry.debit) || 0,
                credit: parseFloat(entry.credit) || 0,
                gloss: entry.gloss || ''
            }));

            const formattedData = {
                date: format(formData.date, 'yyyy-MM-dd'),
                gloss: formData.gloss,
                type: formData.type,
                companyId: companyId,
                entries: formattedEntries
            };

            if (selectedTransaction) {
                await axios.put(`http://localhost:3001/api/transactions/${selectedTransaction.id}`, formattedData);
            } else {
                await axios.post('http://localhost:3001/api/transactions', formattedData);
            }

            setShowModal(false);
            setSelectedTransaction(null);
            fetchTransactions();
            setFormData({
                date: new Date(),
                gloss: '',
                type: 'Ingreso',
                entries: []
            });
        } catch (error) {
            console.error('Error saving transaction:', error);
            alert('Error al guardar el asiento');
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Está seguro de eliminar este asiento? Esta acción no se puede deshacer.')) {
            try {
                await axios.delete(`http://localhost:3001/api/transactions/${id}`, {
                    params: { companyId: selectedCompany.id }
                });
                fetchTransactions();
            } catch (error) {
                console.error('Error deleting transaction:', error);
                alert('Error al eliminar el asiento');
            }
        }
    };

    const openNewModal = () => {
        setSelectedTransaction(null);
        setFormData({
            date: new Date(),
            gloss: '',
            type: 'Ingreso',
            isAdjustment: false,
            entries: [
                { accountId: '', code: '', accountName: '', gloss: '', debit: '', credit: '' },
                { accountId: '', code: '', accountName: '', gloss: '', debit: '', credit: '' }
            ]
        });
        setShowModal(true);
    };

    const handleEdit = async (transaction) => {
        try {
            const response = await axios.get(`http://localhost:3001/api/transactions/${transaction.id}`);
            const details = response.data.data;

            setSelectedTransaction(details);
            setFormData({
                date: new Date(details.date + 'T00:00:00'),
                gloss: details.gloss,
                type: details.type,
                isAdjustment: details.type === 'Ajuste',
                entries: details.entries.map(e => ({
                    accountId: e.account_id,
                    code: e.account_code,
                    accountName: e.account_name,
                    gloss: e.gloss || '',
                    debit: e.debit > 0 ? e.debit : '',
                    credit: e.credit > 0 ? e.credit : ''
                }))
            });
            setShowModal(true);
        } catch (error) {
            console.error('Error loading transaction for edit:', error);
            alert('Error al cargar el asiento para editar');
        }
    };

    // Helper para formatear montos (copiado de FinancialStatements)
    const formatearMonto = (monto) => {
        const val = monto || 0;
        const absVal = Math.abs(val);
        const str = absVal.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return val < 0 ? `(${str})` : str;
    };

    // Export Modal State
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportConfig, setExportConfig] = useState({
        format: 'excel',
        fileName: '',
        orientation: 'portrait'
    });
    const [previewUrl, setPreviewUrl] = useState(null);

    const getJournalExportData = useCallback(() => {
        const title = `Libro Diario - ${selectedCompany?.name || 'Empresa'}`;

        let subText = '';
        if (filterDateStart && filterDateEnd) {
            subText = `Del ${format(filterDateStart, 'dd/MM/yyyy')} al ${format(filterDateEnd, 'dd/MM/yyyy')}`;
        } else if (selectedCompany?.current_year && selectedCompany?.activity_type) {
            const fiscal = getFiscalYearDetails(
                selectedCompany.activity_type,
                selectedCompany.current_year,
                selectedCompany.operation_start_date
            );
            // Reformating YYYY-MM-DD to readable spanish date "1 de Enero de 2023"
            const fStart = new Date(fiscal.startDate + 'T00:00:00');
            const fEnd = new Date(fiscal.endDate + 'T00:00:00');
            const formatSpanish = (d) => format(d, "d 'de' MMMM 'de' yyyy", { locale: es });
            subText = `Del ${formatSpanish(fStart)} al ${formatSpanish(fEnd)}`;
        } else {
            subText = `Generado el ${format(new Date(), 'dd/MM/yyyy')}`;
        }

        const subtitle = subText;

        let data = [];
        let excelData = [];
        let totalDebe = 0;
        let totalHaber = 0;

        filteredTransactions.forEach(t => {
            const transactionNum = transactionNumbers[t.id] || 0;
            const transactionType = t.type;
            const transactionDate = t.date ? format(new Date(t.date + 'T00:00:00'), 'dd/MM/yyyy') : '';
            const transactionGloss = t.gloss || '';

            // Fila de encabezado del asiento
            const headerRow = {
                'Fecha': transactionDate,
                'Tipo': `${transactionType} #${transactionNum}`,
                'Cuenta': '',
                'Código': '',
                'Debe': '',
                'Haber': ''
            };

            // Fila de glosa
            const glossRow = {
                'Fecha': '',
                'Tipo': '',
                'Cuenta': `Glosa: ${transactionGloss}`,
                'Código': '',
                'Debe': '',
                'Haber': ''
            };

            data.push(headerRow, glossRow);
            excelData.push(headerRow, glossRow);

            let transactionDebe = 0;
            let transactionHaber = 0;

            // Filas de las cuentas del asiento
            if (t.entries && t.entries.length > 0) {
                t.entries.forEach(e => {
                    const debitAmount = parseFloat(e.debit) || 0;
                    const creditAmount = parseFloat(e.credit) || 0;

                    transactionDebe += debitAmount;
                    transactionHaber += creditAmount;
                    totalDebe += debitAmount;
                    totalHaber += creditAmount;

                    const entryRow = {
                        'Fecha': '',
                        'Tipo': '',
                        'Cuenta': e.account_name || '',
                        'Código': e.account_code || '',
                        'Debe': debitAmount > 0 ? formatearMonto(debitAmount) : '',
                        'Haber': creditAmount > 0 ? formatearMonto(creditAmount) : ''
                    };

                    const entryRowExcel = {
                        'Fecha': '',
                        'Tipo': '',
                        'Cuenta': e.account_name || '',
                        'Código': e.account_code || '',
                        'Debe': debitAmount,
                        'Haber': creditAmount
                    };

                    data.push(entryRow);
                    excelData.push(entryRowExcel);
                });
            }

            // Fila de totales del asiento
            const totalRow = {
                'Fecha': '',
                'Tipo': '',
                'Cuenta': 'TOTALES DEL ASIENTO:',
                'Código': '',
                'Debe': formatearMonto(transactionDebe),
                'Haber': formatearMonto(transactionHaber)
            };

            const totalRowExcel = {
                'Fecha': '',
                'Tipo': '',
                'Cuenta': 'TOTALES DEL ASIENTO:',
                'Código': '',
                'Debe': transactionDebe,
                'Haber': transactionHaber
            };

            data.push(totalRow);
            excelData.push(totalRowExcel);

            // Fila separadora
            const separatorRow = {
                'Fecha': '',
                'Tipo': '',
                'Cuenta': '',
                'Código': '',
                'Debe': '',
                'Haber': ''
            };

            data.push(separatorRow);
            excelData.push(separatorRow);
        });

        // Fila de totales generales
        const grandTotalRow = {
            'Fecha': '',
            'Tipo': '',
            'Cuenta': 'TOTALES GENERALES:',
            'Código': '',
            'Debe': formatearMonto(totalDebe),
            'Haber': formatearMonto(totalHaber)
        };

        const grandTotalRowExcel = {
            'Fecha': '',
            'Tipo': '',
            'Cuenta': 'TOTALES GENERALES:',
            'Código': '',
            'Debe': totalDebe,
            'Haber': totalHaber
        };

        data.push(grandTotalRow);
        excelData.push(grandTotalRowExcel);

        const columns = [
            { header: 'Fecha', field: 'Fecha' },
            { header: 'Tipo', field: 'Tipo' },
            { header: 'Cuenta', field: 'Cuenta' },
            { header: 'Código', field: 'Código' },
            { header: 'Debe', field: 'Debe' },
            { header: 'Haber', field: 'Haber' }
        ];

        return {
            data,
            excelData,
            columns,
            title,
            subtitle
        };
    }, [filteredTransactions, transactionNumbers, selectedCompany, filterDateStart, filterDateEnd]);

    const handleOpenExport = (format) => {
        const defaultName = `Libro_Diario_${selectedCompany?.name.replace(/\s/g, '_') || 'Empresa'}`;

        setExportConfig({
            format,
            fileName: defaultName,
            orientation: 'portrait'
        });
        setShowExportModal(true);
    };

    // Generate preview
    useEffect(() => {
        if (!showExportModal) {
            setPreviewUrl(null);
            return;
        }

        const { data, columns, title, subtitle } = getJournalExportData();

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
    }, [showExportModal, exportConfig, getJournalExportData]);

    const executeExport = () => {
        const { data, excelData, columns, title, subtitle } = getJournalExportData();
        const fileName = exportConfig.fileName || 'Libro_Diario';

        if (exportConfig.format === 'excel') {
            exportToExcel(excelData, title, fileName);
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

    return (
        <div className="container">
            {/* Encabezado Principal */}
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2 className="mb-0">Libro Diario</h2>
                    <p className="text-muted mb-0">Gestión de asientos contables</p>
                </div>
                <div className="d-flex gap-2 align-items-center">
                    {mahoragaActive && <MahoragaWheel size="small" />}
                    <button className="btn btn-outline-secondary" onClick={toggleAllCollapse}>
                        <i className={`bi bi-arrows-${allCollapsed ? 'expand' : 'collapse'} me-2`}></i>
                        {allCollapsed ? 'Expandir Todos' : 'Colapsar Todos'}
                    </button>
                    <button className="btn btn-success" onClick={() => handleOpenExport('excel')}>
                        <i className="bi bi-file-earmark-excel me-2"></i>Exportar Excel
                    </button>
                    <button className="btn btn-danger" onClick={() => handleOpenExport('pdf')}>
                        <i className="bi bi-file-earmark-pdf me-2"></i>Exportar PDF
                    </button>
                    <button className="btn btn-info" onClick={() => setShowAdjustmentWizard(true)}>
                        <i className="bi bi-calculator me-2"></i>Asistente de Ajustes
                    </button>
                    <button className="btn btn-warning" onClick={() => setShowClosingWizard(true)}>
                        <i className="bi bi-archive me-2"></i>Cierre de Gestión
                    </button>
                    <button className="btn btn-primary" onClick={openNewModal}>
                        <i className="bi bi-plus-circle me-2"></i>Nuevo Asiento
                    </button>
                </div>
            </div>


            {/* Tarjetas de Resumen */}
            <div className="row mb-4">
                <div className="col-md-3">
                    <div className="card shadow-sm border-start border-primary border-4">
                        <div className="card-body">
                            <div className="d-flex justify-content-between align-items-center">
                                <div>
                                    <h6 className="text-muted mb-1">Total Asientos</h6>
                                    <h3 className="mb-0">{stats.total}</h3>
                                </div>
                                <div className="bg-primary bg-opacity-10 p-3 rounded-circle">
                                    <i className="bi bi-journal-text text-primary fs-4"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card shadow-sm border-start border-success border-4">
                        <div className="card-body">
                            <div className="d-flex justify-content-between align-items-center">
                                <div>
                                    <h6 className="text-muted mb-1">Ingresos</h6>
                                    <h3 className="mb-0">{stats.ingreso}</h3>
                                </div>
                                <div className="bg-success bg-opacity-10 p-3 rounded-circle">
                                    <i className="bi bi-arrow-down-circle text-success fs-4"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card shadow-sm border-start border-danger border-4">
                        <div className="card-body">
                            <div className="d-flex justify-content-between align-items-center">
                                <div>
                                    <h6 className="text-muted mb-1">Egresos</h6>
                                    <h3 className="mb-0">{stats.egreso}</h3>
                                </div>
                                <div className="bg-danger bg-opacity-10 p-3 rounded-circle">
                                    <i className="bi bi-arrow-up-circle text-danger fs-4"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card shadow-sm border-start border-info border-4">
                        <div className="card-body">
                            <div className="d-flex justify-content-between align-items-center">
                                <div>
                                    <h6 className="text-muted mb-1">Traspasos</h6>
                                    <h3 className="mb-0">{stats.traspaso}</h3>
                                </div>
                                <div className="bg-info bg-opacity-10 p-3 rounded-circle">
                                    <i className="bi bi-arrow-left-right text-info fs-4"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-md-3 col-lg-2">
                    <div className="card shadow-sm border-start border-warning border-4">
                        <div className="card-body">
                            <div className="d-flex justify-content-between align-items-center">
                                <div>
                                    <h6 className="text-muted mb-1">Ajustes</h6>
                                    <h3 className="mb-0">{stats.ajuste}</h3>
                                </div>
                                <div className="bg-warning bg-opacity-10 p-3 rounded-circle">
                                    <i className="bi bi-pencil-square text-warning fs-4"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col">
                    <div className="card shadow-sm border-start border-dark border-4">
                        <div className="card-body">
                            <div className="d-flex justify-content-between align-items-center">
                                <div>
                                    <h6 className="text-muted mb-1">Cierres</h6>
                                    <h3 className="mb-0">{stats.cierre}</h3>
                                </div>
                                <div className="bg-dark bg-opacity-10 p-3 rounded-circle">
                                    <i className="bi bi-safe text-dark fs-4"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Barra de Filtros */}
            <div className="card shadow-sm mb-4">
                <div className="card-body">
                    <div className="row g-3">
                        <div className="col-md-4">
                            <div className="input-group">
                                <span className="input-group-text bg-light"><i className="bi bi-search"></i></span>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="Buscar por glosa, cuenta o código..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="col-md-2">
                            <select
                                className="form-select"
                                value={filterType}
                                onChange={(e) => setFilterType(e.target.value)}
                            >
                                <option value="Todos">Todos los tipos</option>
                                <option value="Ingreso">Ingreso</option>
                                <option value="Egreso">Egreso</option>
                                <option value="Traspaso">Traspaso</option>
                                <option value="Ajuste">Ajuste</option>
                                <option value="Cierre">Cierre</option>
                            </select>
                        </div>
                        <div className="col-md-2">
                            <DatePicker
                                selected={filterDateStart}
                                onChange={(date) => setFilterDateStart(date)}
                                className="form-control"
                                placeholderText="Desde fecha"
                                dateFormat="dd/MM/yyyy"
                                locale={es}
                                isClearable
                                popperProps={{ strategy: 'fixed' }}
                            />
                        </div>
                        <div className="col-md-2">
                            <DatePicker
                                selected={filterDateEnd}
                                onChange={(date) => setFilterDateEnd(date)}
                                className="form-control"
                                placeholderText="Hasta fecha"
                                dateFormat="dd/MM/yyyy"
                                locale={es}
                                isClearable
                                minDate={filterDateStart}
                                popperProps={{ strategy: 'fixed' }}
                            />
                        </div>
                        <div className="col-md-2 d-grid">
                            <button
                                className="btn btn-outline-secondary"
                                onClick={() => {
                                    setSearchTerm('');
                                    setFilterType('Todos');
                                    setFilterDateStart(null);
                                    setFilterDateEnd(null);
                                }}
                            >
                                <i className="bi bi-x-circle me-2"></i>Limpiar
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Lista de Asientos */}
            <div className="d-flex flex-column gap-3">
                {loading ? (
                    <div className="card shadow-sm">
                        <div className="card-body text-center py-4">Cargando...</div>
                    </div>
                ) : filteredTransactions.length === 0 ? (
                    <div className="card shadow-sm">
                        <div className="card-body text-center py-4 text-muted">
                            {transactions.length === 0 ? 'No hay asientos registrados' : 'No se encontraron resultados con los filtros aplicados'}
                        </div>
                    </div>
                ) : (
                    filteredTransactions.map((t) => (
                        <div key={t.id} className="card shadow-sm">
                            {/* Encabezado del asiento */}
                            <div
                                className="card-header d-flex justify-content-between align-items-center"
                                style={{ backgroundColor: '#f8f9fa', cursor: 'pointer' }}
                                onClick={() => toggleCollapse(t.id)}
                            >
                                <div className="d-flex align-items-center gap-3">
                                    <i className={`bi bi-chevron-${collapsedEntries[t.id] ? 'right' : 'down'} text-muted`}></i>
                                    <div>
                                        <i className="bi bi-calendar3 me-2 text-primary"></i>
                                        <strong>{t.date && format(new Date(t.date + 'T00:00:00'), 'dd/MM/yyyy', { locale: es })}</strong>
                                    </div>
                                    <span className={`badge bg-${t.type === 'Ingreso' ? 'success' : t.type === 'Egreso' ? 'danger' : t.type === 'Cierre' ? 'dark' : 'info'}`}>
                                        {t.type} #{transactionNumbers[t.id] || 0}
                                    </span>
                                    <span className="text-muted" style={{ fontSize: '0.9rem', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.gloss}>
                                        <i className="bi bi-chat-left-text me-1"></i>
                                        {t.gloss}
                                    </span>
                                    {/* Mostrar totales cuando está colapsado */}
                                    {collapsedEntries[t.id] && (
                                        <div className="d-flex gap-3 ms-3">
                                            <span className="badge bg-light text-dark border">
                                                <i className="bi bi-arrow-down-circle me-1 text-success"></i>
                                                Debe: {t.total_debit ? parseFloat(t.total_debit).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                                            </span>
                                            <span className="badge bg-light text-dark border">
                                                <i className="bi bi-arrow-up-circle me-1 text-danger"></i>
                                                Haber: {t.total_credit ? parseFloat(t.total_credit).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <div className="btn-group" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        className="btn btn-sm btn-outline-primary"
                                        onClick={() => handleEdit(t)}
                                        title="Editar"
                                    >
                                        <i className="bi bi-pencil"></i>
                                    </button>
                                    <button
                                        className="btn btn-sm btn-outline-secondary"
                                        onClick={() => fetchTransactionDetails(t.id)}
                                        title="Ver Detalles"
                                    >
                                        <i className="bi bi-eye"></i>
                                    </button>
                                    <button
                                        className="btn btn-sm btn-outline-danger"
                                        onClick={() => handleDelete(t.id)}
                                        title="Eliminar"
                                    >
                                        <i className="bi bi-trash"></i>
                                    </button>
                                </div>
                            </div>
                            {/* Tabla de cuentas - solo visible si no está colapsado */}
                            {!collapsedEntries[t.id] && (
                                <div className="card-body p-0">
                                    <table className="table table-sm table-bordered mb-0">
                                        <thead>
                                            <tr style={{ backgroundColor: '#e9ecef' }}>
                                                <th style={{ width: '15%', padding: '8px 12px' }}>Código</th>
                                                <th style={{ width: '45%', padding: '8px 12px' }}>Cuenta</th>
                                                <th style={{ width: '20%', padding: '8px 12px' }} className="text-end">Debe</th>
                                                <th style={{ width: '20%', padding: '8px 12px' }} className="text-end">Haber</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {t.entries && t.entries.map((e, i) => (
                                                <tr key={i}>
                                                    <td style={{ padding: '6px 12px' }} className="text-muted">{e.account_code}</td>
                                                    <td style={{ padding: '6px 12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '300px' }} title={e.account_name}>{e.account_name}</td>
                                                    <td style={{ padding: '6px 12px' }} className="text-end">
                                                        {e.debit > 0
                                                            ? parseFloat(e.debit).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                                            : ''}
                                                    </td>
                                                    <td style={{ padding: '6px 12px' }} className="text-end">
                                                        {e.credit > 0
                                                            ? parseFloat(e.credit).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                                            : ''}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ backgroundColor: '#e9ecef', fontWeight: 'bold' }}>
                                                <td colSpan="2" style={{ padding: '8px 12px' }} className="text-end">TOTALES:</td>
                                                <td style={{ padding: '8px 12px' }} className="text-end text-success">
                                                    {t.total_debit ? parseFloat(t.total_debit).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                                                </td>
                                                <td style={{ padding: '8px 12px' }} className="text-end text-success">
                                                    {t.total_credit ? parseFloat(t.total_credit).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Modal Nuevo/Editar */}
            {showModal && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-xl">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">{selectedTransaction ? 'Editar Asiento Contable' : 'Nuevo Asiento Contable'}</h5>
                                <button type="button" className="btn-close" onClick={() => setShowModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <form onSubmit={handleSubmit}>
                                    {/* Header Info */}
                                    <div className="row mb-3">
                                        <div className="col-md-3">
                                            <label className="form-label">
                                                <i className="bi bi-calendar-event me-2"></i>Fecha
                                            </label>
                                            <DatePicker
                                                selected={formData.date}
                                                onChange={handleDateChange}
                                                dateFormat="dd/MM/yyyy"
                                                locale={es}
                                                className="date-picker-input"
                                                showPopperArrow={false}
                                                showMonthDropdown
                                                showYearDropdown
                                                dropdownMode="select"
                                                placeholderText="Seleccionar fecha"
                                                required
                                            />
                                        </div>
                                        <div className="col-md-3">
                                            <label className="form-label">
                                                <i className="bi bi-tag me-2"></i>Tipo
                                            </label>
                                            <div className="d-flex align-items-center gap-2">
                                                <select className="form-select" name="type" value={formData.type} onChange={handleInputChange} disabled={formData.isAdjustment}>
                                                    <option value="Ingreso">Ingreso</option>
                                                    <option value="Egreso">Egreso</option>
                                                    <option value="Traspaso">Traspaso</option>
                                                </select>
                                                <div className="form-check ms-2">
                                                    <input className="form-check-input" type="checkbox" id="isAdjustment" name="isAdjustment" checked={!!formData.isAdjustment} onChange={handleInputChange} />
                                                    <label className="form-check-label small" htmlFor="isAdjustment">Ajuste</label>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label">
                                                <i className="bi bi-chat-left-text me-2"></i>Glosa General
                                            </label>
                                            <input type="text" className="form-control" name="gloss" value={formData.gloss} onChange={handleInputChange} required placeholder="Descripción general del asiento" />
                                        </div>
                                    </div>

                                    <hr />

                                    {/* Entries Table */}
                                    <div className="table-responsive mb-3">
                                        <table className="table table-sm table-bordered">
                                            <thead className="table-light">
                                                <tr>
                                                    <th style={{ width: '15%' }}>Código</th>
                                                    <th style={{ width: '30%' }}>Cuenta</th>
                                                    <th style={{ width: '25%' }}>Glosa (Opcional)</th>
                                                    <th style={{ width: '12%' }}>Debe</th>
                                                    <th style={{ width: '12%' }}>Haber</th>
                                                    <th style={{ width: '6%' }}></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {formData.entries.map((entry, index) => (
                                                    <tr key={index}>
                                                        <td>
                                                            <input
                                                                type="text"
                                                                className="form-control form-control-sm"
                                                                list="accountCodes"
                                                                value={entry.code}
                                                                onChange={(e) => handleEntryChange(index, 'code', e.target.value)}
                                                                placeholder="Buscar código..."
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="text"
                                                                className="form-control form-control-sm"
                                                                list="accountNames"
                                                                value={entry.accountName}
                                                                onChange={(e) => handleEntryChange(index, 'accountName', e.target.value)}
                                                                placeholder="Buscar cuenta..."
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="text"
                                                                className="form-control form-control-sm"
                                                                value={entry.gloss}
                                                                onChange={(e) => handleEntryChange(index, 'gloss', e.target.value)}
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                className="form-control form-control-sm text-end"
                                                                value={entry.debit}
                                                                onChange={(e) => handleEntryChange(index, 'debit', e.target.value)}
                                                                disabled={entry.credit > 0 && entry.credit !== ''}
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                className="form-control form-control-sm text-end"
                                                                value={entry.credit}
                                                                onChange={(e) => handleEntryChange(index, 'credit', e.target.value)}
                                                                disabled={entry.debit > 0 && entry.debit !== ''}
                                                            />
                                                        </td>
                                                        <td className="text-center">
                                                            <button type="button" className="btn btn-outline-danger btn-sm border-0" onClick={() => removeEntry(index)}>
                                                                <i className="bi bi-trash"></i>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {/* Totals Row */}
                                                <tr className="fw-bold bg-light">
                                                    <td colSpan="3" className="text-end">TOTALES:</td>
                                                    <td className={`text-end ${Math.abs(totals.debit - totals.credit) > 0.01 ? 'text-danger' : 'text-success'}`}>
                                                        {totals.debit.toFixed(2)}
                                                    </td>
                                                    <td className={`text-end ${Math.abs(totals.debit - totals.credit) > 0.01 ? 'text-danger' : 'text-success'}`}>
                                                        {totals.credit.toFixed(2)}
                                                    </td>
                                                    <td></td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>

                                    <button type="button" className="btn btn-outline-primary btn-sm mb-3" onClick={addEntry}>
                                        <i className="bi bi-plus-circle me-1"></i>Agregar Línea
                                    </button>

                                    {/* Datalists for Autocomplete */}
                                    <datalist id="accountCodes">
                                        {accounts.map(acc => (
                                            <option key={acc.id} value={acc.code} />
                                        ))}
                                    </datalist>
                                    <datalist id="accountNames">
                                        {accounts.map(acc => (
                                            <option key={acc.id} value={acc.name} />
                                        ))}
                                    </datalist>

                                    <div className="modal-footer px-0 pb-0">
                                        <div className="me-auto text-muted small">
                                            {Math.abs(totals.debit - totals.credit) > 0.01 && (
                                                <span className="text-danger">
                                                    <i className="bi bi-exclamation-triangle me-1"></i>
                                                    El asiento no cuadra (Diferencia: {Math.abs(totals.debit - totals.credit).toFixed(2)})
                                                </span>
                                            )}
                                        </div>
                                        <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                                        <button type="submit" className="btn btn-primary" disabled={Math.abs(totals.debit - totals.credit) > 0.01}>Guardar Asiento</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Detalles de Transacción */}
            {showDetailModal && selectedTransaction && (
                <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-xl">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">
                                    <i className="bi bi-receipt me-2"></i>
                                    Detalles del Asiento Contable
                                </h5>
                                <button type="button" className="btn-close" onClick={() => {
                                    setShowDetailModal(false);
                                    setSelectedTransaction(null);
                                }}></button>
                            </div>
                            <div className="modal-body">
                                <div className="row mb-3">
                                    <div className="col-md-3">
                                        <strong>Fecha:</strong>
                                        <p>{selectedTransaction.date && format(new Date(selectedTransaction.date + 'T00:00:00'), 'dd/MM/yyyy', { locale: es })}</p>
                                    </div>
                                    <div className="col-md-3">
                                        <strong>Tipo:</strong>
                                        <p>
                                            <span className={`badge bg-${selectedTransaction.type === 'Ingreso' ? 'success' : selectedTransaction.type === 'Egreso' ? 'danger' : selectedTransaction.type === 'Cierre' ? 'dark' : 'info'}`}>
                                                {selectedTransaction.type}
                                            </span>
                                        </p>
                                    </div>
                                    <div className="col-md-6">
                                        <strong>Glosa:</strong>
                                        <p>{selectedTransaction.gloss}</p>
                                    </div>
                                </div>

                                <hr />

                                <h6 className="mb-3">Detalle de Cuentas</h6>
                                <div className="table-responsive">
                                    <table className="table table-sm table-bordered">
                                        <thead className="table-light">
                                            <tr>
                                                <th style={{ width: '15%' }}>Código</th>
                                                <th style={{ width: '35%' }}>Cuenta</th>
                                                <th style={{ width: '25%' }}>Glosa</th>
                                                <th style={{ width: '12%' }} className="text-end">Debe</th>
                                                <th style={{ width: '12%' }} className="text-end">Haber</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedTransaction.entries && selectedTransaction.entries.length > 0 ? (
                                                selectedTransaction.entries.map((entry, index) => (
                                                    <tr key={index}>
                                                        <td><code>{entry.account_code || '-'}</code></td>
                                                        <td>{entry.account_name || '-'}</td>
                                                        <td>{entry.gloss || '-'}</td>
                                                        <td className="text-end">
                                                            {entry.debit > 0 ? parseFloat(entry.debit).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                                        </td>
                                                        <td className="text-end">
                                                            {entry.credit > 0 ? parseFloat(entry.credit).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan="5" className="text-center text-muted">No hay entradas registradas</td>
                                                </tr>
                                            )}
                                            <tr className="fw-bold bg-light">
                                                <td colSpan="3" className="text-end">TOTALES:</td>
                                                <td className="text-end">
                                                    {selectedTransaction.total_debit ? parseFloat(selectedTransaction.total_debit).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                                                </td>
                                                <td className="text-end">
                                                    {selectedTransaction.total_credit ? parseFloat(selectedTransaction.total_credit).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => {
                                    setShowDetailModal(false);
                                    setSelectedTransaction(null);
                                }}>
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Export Modal */}
            {showExportModal && (
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
                                                    Se exportarán los asientos filtrados actualmente.
                                                </div>
                                            </div>
                                        </form>
                                    </div>
                                    <div className="col-md-9">
                                        <div className="d-flex justify-content-between align-items-center p-3 border-bottom">
                                            <h6 className="mb-0">Vista Previa</h6>
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={executeExport}
                                            >
                                                <i className="bi bi-download me-1"></i>
                                                Descargar {exportConfig.format === 'excel' ? 'Excel' : 'PDF'}
                                            </button>
                                        </div>
                                        <div className="p-3" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
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
                                                        const result = getJournalExportData();
                                                        const { data, columns } = result;

                                                        if (data && data.length > 0) {
                                                            return (
                                                                <div className="p-2">
                                                                    <h6 className="fw-bold border-bottom pb-1 bg-light px-2">Vista Previa - Libro Diario</h6>
                                                                    <table className="table table-striped table-sm small mb-0">
                                                                        <thead>
                                                                            <tr>
                                                                                {columns.map(col => (
                                                                                    <th key={col.field} className="text-center">{col.header}</th>
                                                                                ))}
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {data.slice(0, 20).map((row, index) => (
                                                                                <tr key={index}>
                                                                                    {columns.map(col => (
                                                                                        <td key={col.field} className={col.field === 'Debe' || col.field === 'Haber' ? 'text-end' : ''}>
                                                                                            {row[col.field] || ''}
                                                                                        </td>
                                                                                    ))}
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                    {data.length > 20 && (
                                                                        <div className="text-center text-muted mt-2">
                                                                            <small>Mostrando primeros 20 registros de {data.length} totales</small>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        }
                                                        return (
                                                            <div className="alert alert-warning">
                                                                <i className="bi bi-exclamation-triangle me-2"></i>
                                                                No hay datos para exportar
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Adjustment Wizard Modal */}
            {showAdjustmentWizard && (
                <AdjustmentWizard
                    onClose={() => setShowAdjustmentWizard(false)}
                    onSuccess={fetchTransactions}
                />
            )}

            {/* Closing Wizard Modal */}
            {showClosingWizard && (
                <ClosingWizard
                    onClose={() => setShowClosingWizard(false)}
                    onSuccess={fetchTransactions}
                />
            )}
        </div>
    );
}
