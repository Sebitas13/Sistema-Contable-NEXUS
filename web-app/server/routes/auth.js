/**
 * Rutas de autenticación (contraseña única compartida).
 * Estas rutas son públicas (no pasan por requireAuth).
 */

const express = require('express');
const router = express.Router();
const { isAuthRequired, verifyPassword, getExpectedToken } = require('../utils/auth');

// GET /api/auth/config — indica si la app requiere login (para el frontend).
router.get('/config', (req, res) => {
    res.json({ success: true, authRequired: isAuthRequired() });
});

// POST /api/auth/login — valida la contraseña y devuelve el token de sesión.
router.post('/login', (req, res) => {
    if (!isAuthRequired()) {
        // Auth desactivada: no hay contraseña configurada en el servidor.
        return res.status(400).json({
            success: false,
            error: 'La autenticación no está configurada en el servidor.',
        });
    }

    const { password } = req.body || {};
    if (!password || typeof password !== 'string') {
        return res.status(400).json({ success: false, error: 'Contraseña requerida.' });
    }

    if (!verifyPassword(password)) {
        return res.status(401).json({ success: false, error: 'Contraseña incorrecta.' });
    }

    return res.json({ success: true, token: getExpectedToken() });
});

module.exports = router;
