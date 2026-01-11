import React, { useState, useRef } from 'react';
import axios from 'axios';
import API_URL from '../api';
import { useCompany } from '../context/CompanyContext';

export default function BackupManager() {
    const { selectedCompany, refreshCompanies } = useCompany();
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [dryRunData, setDryRunData] = useState(null);
    const [error, setError] = useState(null);
    const fileInputRef = useRef(null);

    const handleExport = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        setError(null);
        try {
            // Downloading file via window.location for streaming feel or axios blob
            const response = await axios({
                url: `${API_URL}/api/backup/export/${selectedCompany.id}`,
                method: 'GET',
                responseType: 'blob',
            });

            // Create link and trigger download
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            const contentDisposition = response.headers['content-disposition'];
            let fileName = `Backup_${selectedCompany.name}.zip`;
            if (contentDisposition) {
                const fileNameMatch = contentDisposition.match(/filename=(.+)/);
                if (fileNameMatch.length === 2) fileName = fileNameMatch[1].replace(/"/g, '');
            }
            link.setAttribute('download', fileName);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            console.error('Export error:', err);
            setError('Error al generar el backup. Intente de nuevo.');
        } finally {
            setLoading(false);
        }
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Security: Limit client-side too
        if (file.size > 100 * 1024 * 1024) {
            setError('El archivo excede el límite de 100MB.');
            return;
        }

        setLoading(true);
        setError(null);
        setDryRunData(null);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await axios.post(`${API_URL}/api/backup/dry-run`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setDryRunData(response.data.metadata);
        } catch (err) {
            setError(err.response?.data?.error || 'Error al leer el archivo de backup.');
        } finally {
            setLoading(false);
        }
    };

    const handleImport = async () => {
        if (!fileInputRef.current?.files[0]) return;

        if (!window.confirm('¿Estás seguro de restaurar esta empresa? Se creará una nueva copia con los datos del backup.')) {
            return;
        }

        setLoading(true);
        setProgress(10);
        setError(null);

        const formData = new FormData();
        formData.append('file', fileInputRef.current.files[0]);

        try {
            setProgress(30);
            const response = await axios.post(`${API_URL}/api/backup/import`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (progressEvent) => {
                    const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    setProgress(30 + (percentCompleted * 0.4)); // Subida es el 40% del proceso
                }
            });

            setProgress(90);
            if (response.data.success) {
                setProgress(100);
                alert('¡Restauración completada con éxito!');
                setDryRunData(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
                await refreshCompanies();
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Error durante la restauración.');
        } finally {
            setLoading(false);
            setTimeout(() => setProgress(0), 1000);
        }
    };

    return (
        <div className="card shadow-sm border-primary">
            <div className="card-header bg-primary text-white">
                <h5 className="mb-0"><i className="bi bi-shield-lock-fill me-2"></i>Escudo del General: Backup & Restauración</h5>
            </div>
            <div className="card-body">
                <div className="row g-4">
                    {/* Left side: Export */}
                    <div className="col-md-6 border-end">
                        <div className="d-flex align-items-start mb-3">
                            <div className="bg-primary bg-opacity-10 p-3 rounded-circle me-3">
                                <i className="bi bi-cloud-download text-primary fs-4"></i>
                            </div>
                            <div>
                                <h6 className="fw-bold">Exportar Datos</h6>
                                <p className="text-muted small">Descarga un archivo .ZIP con toda la información de <strong>{selectedCompany?.name}</strong>. Incluye cuentas, transacciones y perfiles de IA.</p>
                            </div>
                        </div>
                        <button
                            className="btn btn-primary w-100"
                            onClick={handleExport}
                            disabled={loading || !selectedCompany}
                        >
                            {loading && !dryRunData ? <span className="spinner-border spinner-border-sm me-2"></span> : <i className="bi bi-download me-2"></i>}
                            Generar Backup Seguro
                        </button>
                    </div>

                    {/* Right side: Import */}
                    <div className="col-md-6">
                        <div className="d-flex align-items-start mb-3">
                            <div className="bg-success bg-opacity-10 p-3 rounded-circle me-3">
                                <i className="bi bi-cloud-upload text-success fs-4"></i>
                            </div>
                            <div>
                                <h6 className="fw-bold">Restaurar Empresa</h6>
                                <p className="text-muted small">Sube un archivo de backup para recrear una empresa con su historial completo y conocimiento de Mahoraga aprendida.</p>
                            </div>
                        </div>
                        <div className="input-group">
                            <input
                                type="file"
                                className="form-control"
                                accept=".zip"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                disabled={loading}
                            />
                        </div>
                        <div className="mt-2">
                            <small className="text-muted"><i className="bi bi-info-circle me-1"></i> Límite máximo: 100MB</small>
                        </div>
                    </div>
                </div>

                {/* Progress Bar */}
                {progress > 0 && (
                    <div className="progress mt-4" style={{ height: '10px' }}>
                        <div
                            className="progress-bar progress-bar-striped progress-bar-animated bg-success"
                            role="progressbar"
                            style={{ width: `${progress}%` }}
                        ></div>
                    </div>
                )}

                {/* Error Display */}
                {error && (
                    <div className="alert alert-danger mt-4 small d-flex align-items-center">
                        <i className="bi bi-exclamation-octagon-fill me-2 fs-5"></i>
                        {error}
                    </div>
                )}

                {/* Dry Run / Preview Card */}
                {dryRunData && (
                    <div className="mt-4 p-3 border rounded bg-light border-success animate__animated animate__fadeIn">
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h6 className="fw-bold text-success mb-0"><i className="bi bi-eye-fill me-2"></i>Previsualización del Backup</h6>
                            <span className="badge bg-success">V {dryRunData.version}</span>
                        </div>
                        <div className="row g-2 small">
                            <div className="col-6">
                                <div className="text-muted">Empresa Origen:</div>
                                <div className="fw-bold">{dryRunData.companyName}</div>
                            </div>
                            <div className="col-6">
                                <div className="text-muted">NIT:</div>
                                <div className="fw-bold">{dryRunData.nit || 'N/A'}</div>
                            </div>
                            <div className="col-6">
                                <div className="text-muted">Cuentas:</div>
                                <div className="fw-bold">{dryRunData.counts?.accounts || 0}</div>
                            </div>
                            <div className="col-6">
                                <div className="text-muted">Asientos:</div>
                                <div className="fw-bold">{dryRunData.counts?.transactions || 0}</div>
                            </div>
                            <div className="col-12 mt-2">
                                <div className="text-muted">Fecha Generación:</div>
                                <div className="fw-bold">{new Date(dryRunData.timestamp).toLocaleString()}</div>
                            </div>
                        </div>
                        <div className="mt-3 d-flex gap-2">
                            <button className="btn btn-success flex-grow-1" onClick={handleImport} disabled={loading}>
                                {loading ? <span className="spinner-border spinner-border-sm me-2"></span> : <i className="bi bi-check-circle me-2"></i>}
                                Confirmar Restauración
                            </button>
                            <button className="btn btn-outline-secondary" onClick={() => { setDryRunData(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} disabled={loading}>
                                Cancelar
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
