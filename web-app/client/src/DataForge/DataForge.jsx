import React, { useState } from 'react';
import Explorer from './components/Explorer';
import Canvas from './components/Canvas';
import Workshop from './components/Workshop';

const DataForge = () => {
    const [view, setView] = useState('explorer'); // explorer, canvas, workshop
    const [sourceData, setSourceData] = useState(null);
    const [asfiSettings, setAsfiSettings] = useState(null);

    return (
        <div className="container-fluid p-4 bg-light min-vh-100">
            <header className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h1 className="h3 mb-0 text-primary fw-bold">
                        <i className="bi bi-lightning-charge-fill me-2"></i>Data Forge
                    </h1>
                    <p className="text-muted mb-0">Plataforma de Transformación de Datos Inteligente</p>
                </div>
                <div className="d-flex align-items-center gap-3">
                    <div className="btn-group">
                        <button
                            className={`btn ${view === 'explorer' ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={() => setView('explorer')}
                        >
                            <i className="bi bi-table me-2"></i>Explorador
                        </button>
                        <button
                            className={`btn ${view === 'canvas' ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={() => setView('canvas')}
                            disabled={!sourceData}
                        >
                            <i className="bi bi-diagram-3 me-2"></i>Canvas
                        </button>
                        <button
                            className={`btn ${view === 'workshop' ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={() => setView('workshop')}
                            disabled={!sourceData}
                        >
                            <i className="bi bi-tools me-2"></i>Taller
                        </button>
                    </div>

                    {sourceData && (
                        <div className="d-flex align-items-center gap-2">
                            <span className="badge bg-success">
                                <i className="bi bi-check-circle-fill me-1"></i>
                                {sourceData.fileName}
                            </span>
                            <span className="badge bg-info text-dark">
                                {sourceData.rowCount} filas
                            </span>
                            {sourceData.isASFICombined && (
                                <span className="badge bg-warning text-dark">
                                    <i className="bi bi-layers-fill me-1"></i>
                                    ASFI Combinado
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </header>

            <div className="card shadow-sm border-0">
                <div className="card-body p-0">
                    {view === 'explorer' && (
                        <Explorer
                            onDataLoaded={(data) => {
                                setSourceData(data);
                                setView('canvas');
                            }}
                        />
                    )}
                    {view === 'canvas' && (
                        <Canvas data={sourceData} />
                    )}
                    {view === 'workshop' && (
                        <Workshop data={sourceData} asfiSettings={asfiSettings} />
                    )}
                </div>
            </div>
        </div>
    );
};

export default DataForge;
