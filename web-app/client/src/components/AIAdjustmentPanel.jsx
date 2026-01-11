import React, { useState, useEffect } from 'react';
import aiAdjustmentService from '../services/aiAdjustmentService';
import { ARS_CONTEXT_PROFILE } from '../utils/adjustmentProfilesV3';

export default function AIAdjustmentPanel({ companyId, accounts, onAdjustmentsGenerated }) {
  const [loading, setLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState('unknown');
  const [adjustments, setAdjustments] = useState(null);
  const [parameters, setParameters] = useState({
    ufv_initial: 2.45,
    ufv_final: 2.50,
    method: 'UFV',
    confidence_threshold: 0.75
  });
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    checkAIStatus();
    loadProfile();
  }, []);

  const checkAIStatus = async () => {
    try {
      const isHealthy = await aiAdjustmentService.healthCheck();
      setAiStatus(isHealthy ? 'healthy' : 'unhealthy');
    } catch (error) {
      setAiStatus('unhealthy');
    }
  };

  const loadProfile = () => {
    const adjustmentProfile = ARS_CONTEXT_PROFILE;
    setProfile(adjustmentProfile);
  };

  const generateAdjustments = async () => {
    setLoading(true);
    try {
      const result = await aiAdjustmentService.generateAdjustments(
        companyId,
        accounts.filter(acc => acc.balance > 0),
        parameters
      );

      setAdjustments(result);
      if (onAdjustmentsGenerated) {
        onAdjustmentsGenerated(result);
      }
    } catch (error) {
      console.error('Error generating adjustments:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = () => {
    switch (aiStatus) {
      case 'healthy': return 'text-green-600';
      case 'unhealthy': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusText = () => {
    switch (aiStatus) {
      case 'healthy': return 'AI Engine Online';
      case 'unhealthy': return 'AI Engine Offline';
      default: return 'Checking...';
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Mahoraga Cognitive Engine V6.0</h3>
        <span className={`text-sm font-medium ${getStatusColor()}`}>
          {getStatusText()}
        </span>
      </div>

      {profile && (
        <div className="mb-4 p-3 bg-gray-50 rounded">
          <h4 className="text-sm font-medium mb-2">Profile Configuration</h4>
          <div className="text-xs text-gray-600">
            <p>Confidence Threshold: {profile.reasoning_config.confidence_threshold}</p>
            <p>ARS Enabled: Yes</p>
            <p>Engine Version: ARS-DSPy</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            UFV Inicial
          </label>
          <input
            type="number"
            value={parameters.ufv_initial}
            onChange={(e) => setParameters({ ...parameters, ufv_initial: parseFloat(e.target.value) })}
            className="w-full p-2 border rounded"
            step="0.01"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            UFV Final
          </label>
          <input
            type="number"
            value={parameters.ufv_final}
            onChange={(e) => setParameters({ ...parameters, ufv_final: parseFloat(e.target.value) })}
            className="w-full p-2 border rounded"
            step="0.01"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Método
          </label>
          <select
            value={parameters.method}
            onChange={(e) => setParameters({ ...parameters, method: e.target.value })}
            className="w-full p-2 border rounded"
          >
            <option value="UFV">UFV</option>
            <option value="TC">Tipo de Cambio</option>
          </select>
        </div>

        <button
          onClick={generateAdjustments}
          disabled={loading || aiStatus !== 'healthy'}
          className="w-full bg-blue-600 text-white p-3 rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          {loading ? 'Generando Ajustes...' : 'Generar Ajustes con IA'}
        </button>
      </div>

      {adjustments && (
        <div className="mt-6 p-4 bg-gray-50 rounded">
          <h4 className="font-medium mb-2">Resultados</h4>
          <div className="text-sm space-y-2">
            <p><strong>Éxito:</strong> {adjustments.success ? 'Sí' : 'No'}</p>
            <p><strong>Transacciones:</strong> {adjustments.proposedTransactions?.length || 0}</p>
            <p><strong>Confianza Agregada:</strong> {(adjustments.aggregate_confidence * 100).toFixed(1)}%</p>
            <p><strong>Requiere Revisión:</strong> {adjustments.review_needed ? 'Sí' : 'No'}</p>
            <p><strong>Razonamiento:</strong> {adjustments.reasoning}</p>

            {adjustments.processing_stats && (
              <div className="mt-2 p-2 bg-white rounded">
                <p className="font-medium">Estadísticas:</p>
                <ul className="text-xs text-gray-600">
                  <li>Cuentas procesadas: {adjustments.processing_stats.accounts_processed}</li>
                  <li>Depreciación generada: {adjustments.processing_stats.depreciation_generated}</li>
                  <li>AITB generado: {adjustments.processing_stats.aitb_generated}</li>
                  <li>Provisión generada: {adjustments.processing_stats.provision_generated}</li>
                  <li>Ajustes suprimidos: {adjustments.processing_stats.suppressed_adjustments}</li>
                  <li>Tiempo procesamiento: {adjustments.processing_stats.processing_time_seconds}s</li>
                </ul>
              </div>
            )}

            {adjustments.warnings?.length > 0 && (
              <div className="mt-2 p-2 bg-yellow-50 rounded">
                <p className="font-medium text-yellow-800">Advertencias:</p>
                <ul className="text-xs text-yellow-700">
                  {adjustments.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
