import React, { useState } from 'react';
import axios from 'axios';
import API_URL from '../api';
import { useCompany } from '../context/CompanyContext';

export default function BackupManager() {
    const { selectedCompany } = useCompany();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);

    const handleExport = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        setError(null);
        setSuccess(false);
        try {
            const baseUrl = API_URL || '';
            const response = await axios({
                url: `${baseUrl}/api/backup/export/${selectedCompany.id}`,
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
            window.URL.revokeObjectURL(url);
            setSuccess(true);
            setTimeout(() => setSuccess(false), 4000);
        } catch (err) {
            console.error('Export error:', err);
            setError('Error al generar el backup. Intente de nuevo.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="card glass-panel border-secondary shadow-sm">
            <div className="card-header border-secondary d-flex align-items-center gap-3" style={{ backgroundColor: 'rgba(59, 130, 246, 0.08)' }}>
                <div className="rounded-circle d-flex align-items-center justify-content-center"
                    style={{ width: '40px', height: '40px', background: 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(37,99,235,0.1))', border: '1px solid rgba(59,130,246,0.3)' }}>
                    <i className="bi bi-cloud-arrow-down text-primary fs-5"></i>
                </div>
                <div>
                    <h5 className="mb-0 text-white fw-bold">Exportar Backup</h5>
                    <small className="text-white-50">Descarga una copia de seguridad de esta empresa</small>
                </div>
            </div>
            <div className="card-body p-4">
                <div className="d-flex align-items-start gap-3 mb-4">
                    <i className="bi bi-shield-check text-success fs-4 mt-1"></i>
                    <div>
                        <p className="text-white-50 small mb-1">
                            Genera un archivo <code className="text-info">.ZIP</code> con toda la información de <strong className="text-white">{selectedCompany?.name || 'la empresa'}</strong>.
                        </p>
                        <p className="text-white-50 small mb-0">
                            Incluye: empresa, cuentas, asientos, detalles, inventario, activos fijos, UFV, tipos de cambio y perfiles/eventos de IA con validación de integridad.
                        </p>
                    </div>
                </div>

                {error && (
                    <div className="alert alert-danger border-danger bg-danger bg-opacity-10 text-danger d-flex align-items-center mb-3 small">
                        <i className="bi bi-exclamation-octagon-fill me-2 fs-5"></i>
                        {error}
                    </div>
                )}

                {success && (
                    <div className="alert alert-success border-success bg-success bg-opacity-10 text-success d-flex align-items-center mb-3 small animate__animated animate__fadeIn">
                        <i className="bi bi-check-circle-fill me-2 fs-5"></i>
                        ¡Backup descargado exitosamente!
                    </div>
                )}

                <button
                    className="btn btn-premium w-100 py-2"
                    onClick={handleExport}
                    disabled={loading || !selectedCompany}
                >
                    {loading ? (
                        <span><span className="spinner-border spinner-border-sm me-2"></span>Generando backup...</span>
                    ) : (
                        <span><i className="bi bi-download me-2"></i>Generar Backup Seguro</span>
                    )}
                </button>

                <div className="mt-3 text-center">
                    <small className="text-white-50">
                        <i className="bi bi-info-circle me-1"></i>
                        Para restaurar un backup, usa la opción <strong className="text-info">"Cargar Backup"</strong> en la pantalla de selección de empresas.
                    </small>
                </div>
            </div>
        </div>
    );
}
