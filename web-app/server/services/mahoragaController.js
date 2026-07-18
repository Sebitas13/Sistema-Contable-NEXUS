/**
 * Controlador de Mahoraga - Sistema de Seguridad y Permisos
 * Gestiona la activación controlada de Mahoraga durante fase de pruebas
 */

const db = require('../db');

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

        this._pageConfigCache = new Map();
        this._hydrated = false;

        this.loadPermissions();
        // Hidratación read-through: la cola serial de db.js garantiza que el schema
        // (y las tablas mahoraga_*) ya existe cuando estas lecturas se ejecutan.
        this._hydrate().catch(err => console.warn('⚠️ Mahoraga hydration falló:', err.message));
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

        this._persistActivation(activation);

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

        this._persistActivationEvent(activation, 'confirm', userId);

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

        this._persistActivationEvent(activation, 'reject', userId);

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

        this._persistMode(newMode);
        this._persistSecurityEvent('change-mode', userId, `${oldMode} -> ${newMode}${reason ? ` (${reason})` : ''}`);

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

        this._persistMode(this.modes.DISABLED);
        this._persistSecurityEvent('emergency-stop', userId, reason);

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

    /**
     * Config de páginas por empresa (read-through desde mahoraga_state).
     * Devuelve null si la empresa no tiene config persistida.
     */
    getPageConfig(companyId) {
        const key = Number(companyId) || 0;
        return this._pageConfigCache.has(key) ? [...this._pageConfigCache.get(key)] : null;
    }

    /**
     * Guarda la config de páginas (write-through: cache + upsert en mahoraga_state).
     * No toca la columna mode si la fila ya existe.
     */
    setPageConfig(companyId, pages = []) {
        const key = Number(companyId) || 0;
        const safePages = Array.isArray(pages) ? [...pages] : [];
        this._pageConfigCache.set(key, safePages);
        this._persist(this._dbRun(
            `INSERT INTO mahoraga_state (company_id, mode, page_config, updated_at) VALUES (?, ?, ?, datetime('now'))
             ON CONFLICT(company_id) DO UPDATE SET page_config = excluded.page_config, updated_at = excluded.updated_at`,
            [key, this.currentMode, JSON.stringify(safePages)]
        ), 'page-config');
    }

    // Métodos privados

    /**
     * Read-through inicial: restaura modo global (company_id = 0), configs de página
     * y el historial de activaciones desde Turso. Se ejecuta en segundo plano;
     * mientras tanto el controlador opera con los defaults en memoria.
     */
    async _hydrate() {
        const stateRows = await this._dbAll('SELECT company_id, mode, page_config FROM mahoraga_state');
        for (const row of stateRows) {
            const companyId = Number(row.company_id) || 0;
            if (companyId === 0 && row.mode && Object.values(this.modes).includes(row.mode)) {
                this.currentMode = row.mode;
                this.updateSecurityFlags(row.mode);
            }
            if (row.page_config) {
                try {
                    this._pageConfigCache.set(companyId, JSON.parse(row.page_config));
                } catch { /* JSON inválido: se ignora esa fila */ }
            }
        }

        const rows = await this._dbAll(
            "SELECT id, company_id, user, action, created_at FROM mahoraga_activations WHERE id LIKE 'ACT_%' ORDER BY created_at ASC, rowid ASC LIMIT 500"
        );
        const restored = new Map();
        for (const row of rows) {
            const hashIndex = row.id.indexOf('#');
            if (hashIndex === -1) {
                restored.set(row.id, {
                    id: row.id,
                    operation: row.action,
                    userId: row.user,
                    timestamp: new Date(row.created_at),
                    mode: this.currentMode,
                    context: { companyId: row.company_id || undefined },
                    permission: { allowed: true, restored: true },
                    status: 'ACTIVE',
                    restoredFromDb: true
                });
            } else {
                const base = restored.get(row.id.slice(0, hashIndex));
                if (!base) continue;
                const kind = row.id.slice(hashIndex + 1);
                if (kind === 'confirm') {
                    base.status = 'CONFIRMED';
                    base.confirmedBy = row.user;
                    base.confirmedAt = new Date(row.created_at);
                } else if (kind === 'reject') {
                    base.status = 'REJECTED';
                    base.rejectedBy = row.user;
                    base.rejectedAt = new Date(row.created_at);
                }
            }
        }
        this.activationHistory = [...restored.values()];
        this._hydrated = true;
        console.log(`🛡️ Mahoraga state hidratado desde DB (modo=${this.currentMode}, activaciones=${this.activationHistory.length})`);
    }

    _persistMode(mode) {
        this._persist(this._dbRun(
            `INSERT INTO mahoraga_state (company_id, mode, updated_at) VALUES (0, ?, datetime('now'))
             ON CONFLICT(company_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`,
            [mode]
        ), 'mode');
    }

    _persistActivation(activation) {
        const companyId = Number(activation.context?.companyId) || 0;
        this._persist(this._dbRun(
            'INSERT OR IGNORE INTO mahoraga_activations (id, company_id, user, action, created_at) VALUES (?, ?, ?, ?, ?)',
            [activation.id, companyId, String(activation.userId ?? ''), activation.operation, activation.timestamp.toISOString()]
        ), 'activate');
    }

    _persistActivationEvent(activation, kind, userId) {
        const companyId = Number(activation.context?.companyId) || 0;
        this._persist(this._dbRun(
            'INSERT OR IGNORE INTO mahoraga_activations (id, company_id, user, action, created_at) VALUES (?, ?, ?, ?, ?)',
            [`${activation.id}#${kind}`, companyId, String(userId ?? ''), kind, new Date().toISOString()]
        ), kind);
    }

    _persistSecurityEvent(action, userId, detail = '') {
        const id = `EVT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this._persist(this._dbRun(
            'INSERT OR IGNORE INTO mahoraga_activations (id, company_id, user, action, created_at) VALUES (?, ?, ?, ?, ?)',
            [id, 0, String(userId ?? ''), detail ? `${action}: ${detail}` : action, new Date().toISOString()]
        ), action);
    }

    _persist(promise, label) {
        Promise.resolve(promise).catch(err => {
            console.warn(`⚠️ Mahoraga persist (${label}) falló:`, err.message);
        });
    }

    _dbRun(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    _dbAll(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
        });
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
