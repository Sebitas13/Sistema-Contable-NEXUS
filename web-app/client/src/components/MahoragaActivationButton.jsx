/**
 * MahoragaActivationButton - Control de Seguridad para Mahoraga V7.0
 *
 * Botón de activación con icono de la Rueda de Ocho Empuñaduras.
 * Gestiona permisos, confirmaciones y modos de operación seguros.
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import MahoragaWheel from './MahoragaWheel';

const MahoragaActivationButton = ({
  operation = 'ai_analysis',
  context = {},
  userId = 'user',
  onActivationChange,
  size = 'medium',
  showStatus = true
}) => {
  const [mahoragaStatus, setMahoragaStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingActivation, setPendingActivation] = useState(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [activationMessage, setActivationMessage] = useState('');

  // Cargar estado inicial
  useEffect(() => {
    loadMahoragaStatus();
  }, []);

  const loadMahoragaStatus = async () => {
    try {
      const response = await axios.get('/api/ai/mahoraga/status');
      setMahoragaStatus(response.data.mahoraga);
    } catch (error) {
      console.error('Error cargando estado de Mahoraga:', error);
    }
  };

  const checkActivationPermission = async () => {
    try {
      const response = await axios.get('/api/ai/mahoraga/can-activate', {
        params: {
          operation,
          userId,
          accounts: context.accounts || 0
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error verificando permisos:', error);
      return { can_activate: false, message: 'Error de conexión' };
    }
  };

  const handleActivationClick = async () => {
    setLoading(true);

    try {
      // Verificar permisos primero
      const permission = await checkActivationPermission();

      if (!permission.can_activate) {
        setActivationMessage(permission.message);
        setShowConfirmDialog(true);
        setLoading(false);
        return;
      }

      // Si requiere confirmación del usuario, mostrar diálogo
      if (permission.permission.requiresUserAction) {
        setActivationMessage(permission.message);
        setShowConfirmDialog(true);
        setLoading(false);
        return;
      }

      // Activar directamente
      await activateMahoraga();

    } catch (error) {
      console.error('Error en activación:', error);
      setActivationMessage('Error al activar Mahoraga');
      setShowConfirmDialog(true);
    }

    setLoading(false);
  };

  const activateMahoraga = async () => {
    try {
      const response = await axios.post('/api/ai/mahoraga/activate', {
        operation,
        userId,
        context
      });

      const activation = response.data.activation;

      if (activation.status === 'PENDING_USER_CONFIRMATION') {
        setPendingActivation(activation);
        setActivationMessage('¿Confirma la activación de Mahoraga para esta operación?');
        setShowConfirmDialog(true);
      } else {
        // Activación exitosa
        setActivationMessage('Mahoraga activado exitosamente');
        setShowConfirmDialog(true);
        loadMahoragaStatus();

        if (onActivationChange) {
          onActivationChange(true, activation);
        }
      }
    } catch (error) {
      console.error('Error activando Mahoraga:', error);
      setActivationMessage('Error al activar Mahoraga');
      setShowConfirmDialog(true);
    }
  };

  const confirmActivation = async () => {
    if (!pendingActivation) return;

    try {
      await axios.post('/api/ai/mahoraga/confirm', {
        activationId: pendingActivation.id,
        userId
      });

      setActivationMessage('Activación confirmada exitosamente');
      setPendingActivation(null);
      loadMahoragaStatus();

      if (onActivationChange) {
        onActivationChange(true, pendingActivation);
      }
    } catch (error) {
      console.error('Error confirmando activación:', error);
      setActivationMessage('Error al confirmar activación');
    }
  };

  const rejectActivation = async () => {
    if (!pendingActivation) return;

    try {
      await axios.post('/api/ai/mahoraga/reject', {
        activationId: pendingActivation.id,
        userId,
        reason: 'Usuario rechazó la activación'
      });

      setActivationMessage('Activación rechazada');
      setPendingActivation(null);

      if (onActivationChange) {
        onActivationChange(false, null);
      }
    } catch (error) {
      console.error('Error rechazando activación:', error);
    }
  };

  const getButtonColor = () => {
    if (!mahoragaStatus) return 'bg-gray-400';

    switch (mahoragaStatus.currentMode) {
      case 'disabled': return 'bg-red-500 hover:bg-red-600';
      case 'manual': return 'bg-yellow-500 hover:bg-yellow-600';
      case 'assisted': return 'bg-blue-500 hover:bg-blue-600';
      case 'autonomous': return 'bg-green-500 hover:bg-green-600';
      default: return 'bg-gray-500 hover:bg-gray-600';
    }
  };

  const getModeIcon = () => {
    if (!mahoragaStatus) return <i className="bi bi-arrow-repeat animate-spin"></i>;

    switch (mahoragaStatus.currentMode) {
      case 'disabled': return <i className="bi bi-dash-circle"></i>;
      case 'manual': return <i className="bi bi-hand-index-thumb"></i>;
      case 'assisted': return <i className="bi bi-robot"></i>;
      case 'autonomous': return <i className="bi bi-lightning-charge-fill"></i>;
      default: return <i className="bi bi-question-circle"></i>;
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'small': return 24;
      case 'large': return 48;
      default: return 32;
    }
  };

  const containerSize = getSizeClasses();

  return (
    <>
      <div
        className="relative inline-block"
        style={{
          width: `${containerSize}px`,
          height: `${containerSize}px`,
          lineHeight: 0,
          flexShrink: 0 // Prevent being squashed in flexbox
        }}
      >
        {/* Botón principal con componente Rueda */}
        <button
          onClick={handleActivationClick}
          disabled={loading}
          className="p-0 bg-transparent border-0 rounded-full transition-transform duration-300 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center focus:outline-none"
          title={`Mahoraga: ${mahoragaStatus?.currentMode || 'Cargando...'}`}
          style={{ boxShadow: 'none', appearance: 'none' }}
        >
          <MahoragaWheel
            size={getSizeClasses()}
            spinning={loading}
            color="#FFD700"
          />
        </button>

        {/* Indicador de modo */}
        {showStatus && mahoragaStatus && (
          <div
            className="absolute bg-white rounded-full p-0.5 shadow-sm border border-gray-100 flex items-center justify-center"
            style={{
              top: '-4px',
              right: '-4px',
              width: '16px',
              height: '16px',
              zIndex: 10
            }}
          >
            <span className="text-[10px]" title={`Modo: ${mahoragaStatus.currentMode}`}>
              {getModeIcon()}
            </span>
          </div>
        )}

        {/* Indicador de activaciones activas */}
        {mahoragaStatus && mahoragaStatus.activeActivations > 0 && (
          <div
            className="absolute bg-orange-500 text-white rounded-full flex items-center justify-center font-bold text-[10px]"
            style={{
              bottom: '-4px',
              right: '-4px',
              width: '16px',
              height: '16px',
              zIndex: 10
            }}
          >
            {mahoragaStatus.activeActivations}
          </div>
        )}
      </div>

      {/* Diálogo de confirmación */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-40 backdrop-blur-sm flex items-center justify-center z-50 animate__animated animate__fadeIn">
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4 shadow-2xl border-t-4 border-yellow-500 transform transition-all">
            <div className="flex items-center mb-3">
              <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mr-3 shadow-lg border border-yellow-500">
                <MahoragaWheel size={32} spinning={true} color="#FFD700" />
              </div>
              <div>
                <h3 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-yellow-600">
                  Adaptabilidad Activa
                </h3>
              </div>
            </div>

            <p className="text-sm text-gray-600 mb-4">{activationMessage}</p>

            <div className="flex justify-end space-x-3">
              {pendingActivation ? (
                <>
                  <button
                    onClick={() => {
                      setShowConfirmDialog(false);
                      rejectActivation();
                    }}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                  >
                    Rechazar
                  </button>
                  <button
                    onClick={() => {
                      setShowConfirmDialog(false);
                      confirmActivation();
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Confirmar
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setShowConfirmDialog(false);
                    // Inyección de feedback visual efímero
                    const notify = document.createElement('div');
                    notify.className = 'fixed bottom-4 right-4 bg-slate-900 text-yellow-500 px-4 py-2 rounded-lg shadow-2xl z-[100] animate__animated animate__fadeInUp border border-yellow-500 font-bold';
                    notify.innerHTML = '<i class="bi bi-stars me-2"></i>Mahoraga Acondicionado';
                    document.body.appendChild(notify);
                    setTimeout(() => {
                      notify.classList.replace('animate__fadeInUp', 'animate__fadeOutDown');
                      setTimeout(() => notify.remove(), 1000);
                    }, 3000);
                  }}
                  className="px-5 py-2 bg-slate-900 text-yellow-500 text-sm font-bold rounded-lg hover:bg-black transition-all shadow-md active:scale-95"
                >
                  Prosigue
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MahoragaActivationButton;
