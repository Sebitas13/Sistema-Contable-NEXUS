import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useCompany } from '../context/CompanyContext';

const MahoragaInsightsBanner = ({ context }) => {
    const { selectedCompany } = useCompany();
    const [insights, setInsights] = useState([]);
    const [mahoragaMode, setMahoragaMode] = useState('manual');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (selectedCompany) {
            fetchStatus();
        }
    }, [selectedCompany]);

    const fetchStatus = async () => {
        try {
            const res = await axios.get('/api/ai/mahoraga/status');
            setMahoragaMode(res.data.mahoraga?.currentMode || 'manual');

            // Si está en asistido o manual con contexto, buscar insights
            if (res.data.mahoraga?.currentMode !== 'disabled') {
                fetchInsights();
            }
        } catch (e) {
            console.error(e);
        }
    };

    const fetchInsights = async () => {
        try {
            setLoading(true);
            const res = await axios.get(`/api/ai/mahoraga/insights?companyId=${selectedCompany.id}`);
            if (res.data.success) {
                setInsights(res.data.insights);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (insights.length === 0 || mahoragaMode === 'disabled') return null;

    return (
        <div className="card border-0 shadow-sm mb-4" style={{
            background: 'linear-gradient(90deg, #1a1a2e 0%, #16213e 100%)',
            color: 'white',
            borderRadius: '12px'
        }}>
            <div className="card-body py-3 d-flex align-items-center justify-content-between">
                <div className="d-flex align-items-center">
                    <div className="mahoraga-mini-wheel me-3">
                        <div className="spinner-grow spinner-grow-sm text-primary" role="status"></div>
                    </div>
                    <div>
                        <h6 className="mb-0 fw-bold">
                            <i className="bi bi-robot me-2 text-primary"></i>
                            MAHORAGA V6.0 INSIGHTS
                        </h6>
                        <p className="small mb-0 opacity-75">
                            {insights.length === 1
                                ? insights[0].message
                                : `Mahoraga ha detectado ${insights.length} puntos de atención en este módulo.`}
                        </p>
                    </div>
                </div>
                <button
                    className="btn btn-sm btn-light text-primary fw-bold"
                    onClick={() => window.location.href = '/mahoraga-dashboard'}
                >
                    Expandir Sugerencias
                </button>
            </div>
        </div>
    );
};

export default MahoragaInsightsBanner;
