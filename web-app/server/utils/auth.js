/**
 * Autenticación por contraseña única compartida.
 *
 * Modelo: una sola variable de entorno APP_PASSWORD.
 *  - El "token" que usa el cliente = sha256(APP_PASSWORD) en hex.
 *    Así la contraseña humana nunca se guarda en el navegador y rotar = cambiar APP_PASSWORD.
 *  - El mismo token sirve de "token interno" para que el motor Python pueda llamar de vuelta
 *    al backend (callback /api/reports/ledger).
 *
 * Rollout graceful: si APP_PASSWORD NO está definida, la auth queda DESACTIVADA y la app
 * funciona como antes (abierta). En cuanto se define APP_PASSWORD, la protección se activa.
 * El frontend consulta GET /api/auth/config para saber si debe pedir login.
 */

const crypto = require('crypto');

function getAppPassword() {
    const pw = process.env.APP_PASSWORD;
    return typeof pw === 'string' && pw.length > 0 ? pw : null;
}

/** ¿Está la autenticación activa? (true solo si hay APP_PASSWORD configurada) */
function isAuthRequired() {
    return getAppPassword() !== null;
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** Token esperado (= sha256 de APP_PASSWORD) o null si la auth está desactivada. */
function getExpectedToken() {
    const pw = getAppPassword();
    return pw === null ? null : sha256Hex(pw);
}

/** Comparación en tiempo constante, tolerante a longitudes distintas. */
function safeEqual(a, b) {
    const bufA = Buffer.from(String(a), 'utf8');
    const bufB = Buffer.from(String(b), 'utf8');
    if (bufA.length !== bufB.length) {
        // Comparar contra sí mismo para no filtrar la diferencia de longitud por timing.
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

/** Valida la contraseña enviada en el login. */
function verifyPassword(password) {
    const pw = getAppPassword();
    if (pw === null) return false;
    return safeEqual(password == null ? '' : password, pw);
}

/** Valida el bearer token de un request. */
function verifyToken(token) {
    const expected = getExpectedToken();
    if (expected === null) return false;
    return safeEqual(token == null ? '' : token, expected);
}

/** Extrae el token de la cabecera Authorization: Bearer <token>. */
function extractBearer(req) {
    const header = req.headers['authorization'] || req.headers['Authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
    return match ? match[1].trim() : '';
}

/**
 * Middleware: exige un bearer token válido.
 * - OPTIONS (preflight CORS) siempre pasa.
 * - Si la auth está desactivada (sin APP_PASSWORD) deja pasar todo (rollout graceful).
 */
function requireAuth(req, res, next) {
    if (req.method === 'OPTIONS') return next();
    if (!isAuthRequired()) return next();

    const token = extractBearer(req);
    if (token && verifyToken(token)) return next();

    return res.status(401).json({ success: false, error: 'No autorizado. Inicia sesión.' });
}

module.exports = {
    isAuthRequired,
    getExpectedToken,
    verifyPassword,
    verifyToken,
    requireAuth,
};
