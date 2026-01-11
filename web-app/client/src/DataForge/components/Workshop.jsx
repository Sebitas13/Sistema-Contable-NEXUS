import React, { useState } from 'react';

const Workshop = ({ data, asfiSettings }) => {
    const [activeTool, setActiveTool] = useState('script');
    const [customScript, setCustomScript] = useState(`// Taller Avanzado de Data Forge
// Aquí puedes escribir código JavaScript personalizado para transformaciones complejas

// Los datos cargados están disponibles en la variable 'data'
// Ejemplo de uso:

function processData(inputData) {
    if (!inputData || !Array.isArray(inputData)) {
        return [];
    }

    // Tu lógica de procesamiento aquí
    console.log('Procesando', inputData.length, 'registros');

    // Ejemplo: Filtrar y transformar
    const result = inputData
        .filter(row => row.activo === 'SÍ') // Filtrar activos
        .map(row => ({
            ...row,
            total: (row.precio || 0) * (row.cantidad || 1),
            fecha_formateada: row.fecha ? new Date(row.fecha).toLocaleDateString('es-ES') : null
        }));

    console.log('Resultado:', result.length, 'registros procesados');
    return result;
}

// Para usar con datos del Canvas, llama:
// processData(data);

return []; // Retorna los datos procesados`);
    const [apiConnections, setApiConnections] = useState([]);
    const [showApiModal, setShowApiModal] = useState(false);
    const [executionResult, setExecutionResult] = useState(null);
    const [executionError, setExecutionError] = useState(null);

    // Available advanced tools
    const workshopTools = [
        { id: 'script', name: 'Script Avanzado', icon: 'bi-code-square', description: 'JavaScript personalizado para lógica compleja' },
        { id: 'api', name: 'APIs Externas', icon: 'bi-cloud-arrow-up', description: 'Conectar con servicios web' },
        { id: 'automation', name: 'Automatización', icon: 'bi-gear-wide-connected', description: 'Flujos de trabajo automatizados' },
        { id: 'analysis', name: 'Análisis Avanzado', icon: 'bi-graph-up-arrow', description: 'Estadísticas y machine learning' }
    ];

    const executeScript = () => {
        try {
            setExecutionError(null);

            // Create a safe execution context
            const executeInContext = new Function('data', `
                "use strict";
                ${customScript}
            `);

            const result = executeInContext(data);
            setExecutionResult(result);

            console.log('Script ejecutado exitosamente:', result);
        } catch (error) {
            setExecutionError(error.message);
            console.error('Error ejecutando script:', error);
        }
    };

    const clearResults = () => {
        setExecutionResult(null);
        setExecutionError(null);
    };

    if (!data) {
        return (
            <div className="p-5 text-center text-muted">
                <i className="bi bi-rocket display-1 mb-3"></i>
                <h3>Taller Avanzado</h3>
                <p>Carga datos desde el Explorador para usar herramientas avanzadas.</p>
            </div>
        );
    }

    return (
        <div className="d-flex h-100">
            {/* Tools Panel */}
            <div className="w-25 border-end bg-light p-3 d-flex flex-column">
                <h5 className="fw-bold mb-3">
                    <i className="bi bi-rocket me-2"></i>Taller Avanzado
                </h5>

                {/* Tool Selection */}
                <div className="mb-3">
                    <h6 className="small fw-bold text-muted mb-2">HERRAMIENTAS</h6>
                    <div className="d-grid gap-2">
                        {workshopTools.map(tool => (
                            <button
                                key={tool.id}
                                className={`btn ${activeTool === tool.id ? 'btn-primary' : 'btn-outline-primary'} btn-sm text-start`}
                                onClick={() => setActiveTool(tool.id)}
                                title={tool.description}
                            >
                                <i className={`bi ${tool.icon} me-1`}></i>
                                <small>{tool.name}</small>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Data Info */}
                <div className="mb-3 p-2 bg-light rounded small">
                    <div className="fw-bold mb-1">Datos Cargados</div>
                    <div className="text-muted small">
                        {data && data.fileName ? `Archivo: ${data.fileName}` : 'Sin datos cargados'}
                    </div>
                    <div className="text-muted small">
                        {data && data.rowCount ? `${data.rowCount} filas` : ''}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-auto">
                    <div className="d-grid gap-2">
                        <button
                            className="btn btn-outline-info btn-sm"
                            onClick={() => setShowApiModal(true)}
                        >
                            <i className="bi bi-cloud me-1"></i>APIs
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-grow-1 d-flex flex-column">
                {activeTool === 'script' && (
                    <div className="p-4 h-100 d-flex flex-column">
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h5 className="mb-0">
                                <i className="bi bi-code-square me-2"></i>
                                Script Avanzado
                            </h5>
                            <div className="d-flex gap-2">
                                <button
                                    className="btn btn-success btn-sm"
                                    onClick={executeScript}
                                >
                                    <i className="bi bi-play-fill me-1"></i>Ejecutar
                                </button>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={clearResults}
                                >
                                    <i className="bi bi-x-circle me-1"></i>Limpiar
                                </button>
                            </div>
                        </div>

                        <div className="flex-grow-1 d-flex">
                            {/* Script Editor */}
                            <div className="flex-grow-1 me-3">
                                <div className="card h-100">
                                    <div className="card-header py-2">
                                        <small className="fw-bold">Editor de Código</small>
                                    </div>
                                    <div className="card-body p-0">
                                        <textarea
                                            className="form-control h-100 border-0 rounded-0"
                                            style={{fontFamily: 'monospace', fontSize: '14px'}}
                                            value={customScript}
                                            onChange={(e) => setCustomScript(e.target.value)}
                                            placeholder="Escribe tu código JavaScript aquí..."
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Results Panel */}
                            <div className="w-50">
                                <div className="card h-100">
                                    <div className="card-header py-2 d-flex justify-content-between">
                                        <small className="fw-bold">Resultado</small>
                                        {executionResult && (
                                            <small className="text-success">
                                                {Array.isArray(executionResult) ? `${executionResult.length} elementos` : 'Completado'}
                                            </small>
                                        )}
                                    </div>
                                    <div className="card-body p-2">
                                        {executionError && (
                                            <div className="alert alert-danger small mb-2">
                                                <strong>Error:</strong> {executionError}
                                            </div>
                                        )}

                                        {executionResult && (
                                            <div className="small">
                                                <pre className="bg-light p-2 rounded" style={{fontSize: '12px', maxHeight: '400px', overflow: 'auto'}}>
                                                    {JSON.stringify(executionResult, null, 2)}
                                                </pre>
                                            </div>
                                        )}

                                        {!executionResult && !executionError && (
                                            <div className="text-center text-muted py-4">
                                                <i className="bi bi-play-circle display-4 mb-3 opacity-25"></i>
                                                <p>Ejecuta el script para ver los resultados</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTool === 'api' && (
                    <div className="p-4 h-100 d-flex flex-column">
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h5 className="mb-0">
                                <i className="bi bi-cloud-arrow-up me-2"></i>
                                Conexiones API
                            </h5>
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={() => setShowApiModal(true)}
                            >
                                <i className="bi bi-plus me-1"></i>Nueva Conexión
                            </button>
                        </div>

                        <div className="flex-grow-1 d-flex justify-content-center align-items-center">
                            <div className="text-center text-muted">
                                <i className="bi bi-cloud display-4 mb-3 opacity-25"></i>
                                <h4>Conexiones API</h4>
                                <p>Funcionalidad en desarrollo</p>
                                <small className="text-muted">
                                    Próximamente: Conecta con REST APIs, GraphQL, bases de datos externas
                                </small>
                            </div>
                        </div>
                    </div>
                )}

                {activeTool === 'automation' && (
                    <div className="p-4 h-100 d-flex flex-column">
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h5 className="mb-0">
                                <i className="bi bi-gear-wide-connected me-2"></i>
                                Automatización
                            </h5>
                        </div>

                        <div className="flex-grow-1 d-flex justify-content-center align-items-center">
                            <div className="text-center text-muted">
                                <i className="bi bi-gear-wide-connected display-4 mb-3 opacity-25"></i>
                                <h4>Automatización de Flujos</h4>
                                <p>Funcionalidad en desarrollo</p>
                                <small className="text-muted">
                                    Próximamente: Triggers automáticos, scheduling, webhooks
                                </small>
                            </div>
                        </div>
                    </div>
                )}

                {activeTool === 'analysis' && (
                    <div className="p-4 h-100 d-flex flex-column">
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h5 className="mb-0">
                                <i className="bi bi-graph-up-arrow me-2"></i>
                                Análisis Avanzado
                            </h5>
                        </div>

                        <div className="flex-grow-1 d-flex justify-content-center align-items-center">
                            <div className="text-center text-muted">
                                <i className="bi bi-graph-up-arrow display-4 mb-3 opacity-25"></i>
                                <h4>Análisis Avanzado</h4>
                                <p>Funcionalidad en desarrollo</p>
                                <small className="text-muted">
                                    Próximamente: Machine Learning, estadísticas avanzadas, predicciones
                                </small>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* API Modal */}
            {showApiModal && (
                <div className="modal show d-block" style={{backgroundColor: 'rgba(0,0,0,0.5)'}}>
                    <div className="modal-dialog">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">Conexiones API</h5>
                                <button type="button" className="btn-close" onClick={() => setShowApiModal(false)}></button>
                            </div>
                            <div className="modal-body">
                                <p className="text-muted small">Esta funcionalidad estará disponible en futuras versiones.</p>
                                <div className="text-center py-3">
                                    <i className="bi bi-cloud display-4 text-muted"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Workshop;
