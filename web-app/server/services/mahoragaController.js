/**
 * Controlador de Mahoraga - Sistema de Seguridad y Permisos
 * Gestiona la activación controlada de Mahoraga durante fase de pruebas
 */

class MahoragaController {
    constructor() {
        this.modes = {
            DISABLED: 'disabled',       // Mahoraga completamente inactivo
            MANUAL: 'manual',           // Solo activación manual con confirmación
            ASSISTED: 'assisted',       // Sugerencias automáticas pero requiere aprobación
            AUTONOMOUS: 'autonomous'    // Modo completo (solo para producción)
        };

        this.currentMode = process.env.MAHORAGA_MODE || this.modes.MANUAL;
        this.activationHistory = [];
        this.securityFlags = {
            requiresConfirmation: true,
            logAllActions: true,
            emergencyStop: false,
            userOverride: false
        };

        this.loadPermissions();
        this.startSecurityMonitor();
    }

    /**
     * Verifica si Mahoraga puede activarse
     */
    canActivate(operation, context = {}) {
        // Verificar modo de emergencia
        if (this.securityFlags.emergencyStop) {
            return {
                allowed: false,
                reason: 'EMERGENCY_STOP_ACTIVATED',
                message: 'Mahoraga está en modo de seguridad. Contacta al administrador.'
            };
        }

        // Verificar permisos por operación
        switch (this.currentMode) {
            case this.modes.DISABLED:
                return {
                    allowed: false,
                    reason: 'MODE_DISABLED',
                    message: 'Mahoraga está desactivado completamente.'
                };

            case this.modes.MANUAL:
                return {
                    allowed: false, // Requiere activación manual
                    reason: 'REQUIRES_MANUAL_ACTIVATION',
                    message: 'Haz clic en el icono de Mahoraga para activar esta operación.',
                    requiresUserAction: true
                };

            case this.modes.ASSISTED:
                if (operation === 'auto_classification' || operation === 'auto_adjustment') {
                    return {
                        allowed: true,
                        reason: 'ASSISTED_MODE',
                        message: 'Mahoraga generará sugerencias que requieren tu aprobación.',
                        requiresApproval: true
                    };
                }
                return { allowed: true };

            case this.modes.AUTONOMOUS:
                return {
                    allowed: true,
                    reason: 'FULL_AUTONOMY',
                    message: 'Mahoraga opera en modo autónomo completo.'
                };

            default:
                return {
                    allowed: false,
                    reason: 'UNKNOWN_MODE',
                    message: 'Modo de Mahoraga desconocido.'
                };
        }
    }

    /**
     * Activa Mahoraga para una operación específica
     */
    activate(operation, userId, context = {}) {
        const permission = this.canActivate(operation, context);

        if (!permission.allowed && !permission.requiresUserAction) {
            throw new Error(`Activación denegada: ${permission.message}`);
        }

        const activation = {
            id: `ACT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            operation,
            userId,
            timestamp: new Date(),
            mode: this.currentMode,
            context,
            permission,
            status: permission.allowed ? 'ACTIVE' : 'PENDING_USER_CONFIRMATION'
        };

        this.activationHistory.push(activation);

        // Log de seguridad
        console.log(`🧠 MAHORAGA ACTIVATION: ${operation} by ${userId} - Mode: ${this.currentMode}`);

        return activation;
    }

    /**
     * Confirma activación manual por usuario
     */
    confirmActivation(activationId, userId) {
        const activation = this.activationHistory.find(a => a.id === activationId);

        if (!activation) {
            throw new Error('Activación no encontrada');
        }

        if (activation.userId !== userId) {
            throw new Error('Usuario no autorizado para esta activación');
        }

        activation.status = 'CONFIRMED';
        activation.confirmedAt = new Date();
        activation.confirmedBy = userId;

        console.log(`✅ MAHORAGA CONFIRMED: ${activation.operation} by ${userId}`);

        return activation;
    }

    /**
     * Rechaza activación
     */
    rejectActivation(activationId, userId, reason = 'User rejected') {
        const activation = this.activationHistory.find(a => a.id === activationId);

        if (!activation) {
            throw new Error('Activación no encontrada');
        }

        activation.status = 'REJECTED';
        activation.rejectedAt = new Date();
        activation.rejectedBy = userId;
        activation.rejectReason = reason;

        console.log(`❌ MAHORAGA REJECTED: ${activation.operation} by ${userId} - ${reason}`);

        return activation;
    }

    /**
     * Cambia el modo de operación
     */
    changeMode(newMode, userId, reason = '') {
        if (!Object.values(this.modes).includes(newMode)) {
            throw new Error(`Modo inválido: ${newMode}`);
        }

        const oldMode = this.currentMode;
        this.currentMode = newMode;

        // Log de cambio de modo
        console.log(`🔄 MAHORAGA MODE CHANGE: ${oldMode} → ${newMode} by ${userId}`);

        // Actualizar permisos según el nuevo modo
        this.updateSecurityFlags(newMode);

        return {
            oldMode,
            newMode,
            changedBy: userId,
            timestamp: new Date(),
            reason
        };
    }

    /**
     * Actualiza flags de seguridad según el modo
     */
    updateSecurityFlags(mode) {
        switch (mode) {
            case this.modes.DISABLED:
                this.securityFlags = {
                    requiresConfirmation: true,
                    logAllActions: true,
                    emergencyStop: true,
                    userOverride: false
                };
                break;

            case this.modes.MANUAL:
                this.securityFlags = {
                    requiresConfirmation: true,
                    logAllActions: true,
                    emergencyStop: false,
                    userOverride: false
                };
                break;

            case this.modes.ASSISTED:
                this.securityFlags = {
                    requiresConfirmation: false,
                    logAllActions: true,
                    emergencyStop: false,
                    userOverride: true
                };
                break;

            case this.modes.AUTONOMOUS:
                this.securityFlags = {
                    requiresConfirmation: false,
                    logAllActions: false,
                    emergencyStop: false,
                    userOverride: true
                };
                break;
        }
    }

    /**
     * Activa modo de emergencia (detiene todas las operaciones)
     */
    emergencyStop(userId, reason = 'Emergency stop activated') {
        this.securityFlags.emergencyStop = true;
        this.currentMode = this.modes.DISABLED;

        console.log(`🚨 MAHORAGA EMERGENCY STOP: Activated by ${userId} - ${reason}`);

        return {
            activated: true,
            timestamp: new Date(),
            activatedBy: userId,
            reason
        };
    }

    /**
     * Obtiene estado actual de Mahoraga
     */
    getStatus() {
        const activeActivations = this.activationHistory.filter(a =>
            a.status === 'ACTIVE' || a.status === 'CONFIRMED'
        ).length;

        const pendingConfirmations = this.activationHistory.filter(a =>
            a.status === 'PENDING_USER_CONFIRMATION'
        ).length;

        return {
            currentMode: this.currentMode,
            securityFlags: this.securityFlags,
            activeActivations,
            pendingConfirmations,
            totalActivations: this.activationHistory.length,
            modes: this.modes,
            lastActivation: this.activationHistory[this.activationHistory.length - 1] || null
        };
    }

    /**
     * Obtiene historial de activaciones
     */
    getActivationHistory(limit = 50, userId = null) {
        let history = this.activationHistory;

        if (userId) {
            history = history.filter(a => a.userId === userId);
        }

        return history
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Verifica si una operación requiere intervención del usuario
     */
    requiresUserIntervention(operation, context = {}) {
        const permission = this.canActivate(operation, context);
        return permission.requiresUserAction || permission.requiresApproval;
    }

    // Métodos privados
    loadPermissions() {
        // Cargar permisos desde configuración
        console.log('🛡️ Mahoraga Controller initialized in', this.currentMode, 'mode');
    }

    startSecurityMonitor() {
        // Monitoreo continuo de seguridad
        setInterval(() => {
            const status = this.getStatus();
            if (status.activeActivations > 10) {
                console.warn('⚠️ ALTO NÚMERO DE ACTIVACIONES ACTIVAS:', status.activeActivations);
            }
        }, 30000); // Cada 30 segundos
    }
}

module.exports = new MahoragaController();
