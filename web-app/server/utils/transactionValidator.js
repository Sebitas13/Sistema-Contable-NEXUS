/**
 * Validación contable compartida para POST /api/transactions y POST /api/transactions/batch.
 *
 * Regla de oro de un sistema contable: NINGÚN asiento descuadrado entra a la DB,
 * y ninguna partida puede referenciar cuentas de otra empresa (multi-tenant).
 *
 * Compatibilidad crítica: el flujo del motor de ajustes (routes/ai.js
 * POST /api/ai/adjustments/confirm) envía entries cuyo accountId puede ser un
 * ID numérico O un código de cuenta (account_code/accountCode). Este validador
 * resuelve códigos → IDs dentro del ámbito de la empresa antes de insertar.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BALANCE_TOLERANCE = 0.01; // absorbe redondeos de punto flotante, no descuadres reales
const MAX_BATCH_TRANSACTIONS = 100;
const MAX_ENTRIES_PER_TRANSACTION = 200;

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.status = 400;
    }
}

/** Normaliza 'YYYY-MM-DD' o ISO datetime → 'YYYY-MM-DD'. null si inválida. */
function normalizeDate(value) {
    if (typeof value !== 'string') return null;
    const date = value.includes('T') ? value.slice(0, 10) : value;
    return DATE_RE.test(date) ? date : null;
}

/** Monto contable: número finito ≥ 0. null si no sirve. */
function parseAmount(value) {
    const n = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
}

/** db.all promisificado (el wrapper de db.js es estilo callback). */
function queryAll(db, sql, params) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

/**
 * Resuelve los accountIds de las partidas contra el plan de cuentas de la empresa.
 * Acepta entry.accountId (id numérico) o entry.account_code / entry.accountCode (código).
 * Devuelve una copia de las partidas con accountId numérico resuelto.
 */
async function resolveEntryAccounts(db, entries, companyId) {
    const refs = entries.map(e => {
        const raw = e.accountId !== undefined && e.accountId !== null && e.accountId !== ''
            ? e.accountId
            : (e.account_code || e.accountCode);
        return { raw, entry: e };
    });

    const missing = refs.find(r => r.raw === undefined || r.raw === null || r.raw === '');
    if (missing) {
        throw new ValidationError('Toda partida necesita accountId o account_code.');
    }

    const ids = [];
    const codes = [];
    for (const r of refs) {
        const asNum = Number(r.raw);
        if (Number.isInteger(asNum) && String(asNum) === String(r.raw).trim()) {
            ids.push(asNum);
        } else {
            codes.push(String(r.raw).trim());
        }
    }

    const foundIds = new Map(); // id -> id
    const foundCodes = new Map(); // code -> id

    if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const rows = await queryAll(
            db,
            `SELECT id FROM accounts WHERE company_id = ? AND id IN (${placeholders})`,
            [companyId, ...ids]
        );
        for (const row of rows) foundIds.set(Number(row.id), Number(row.id));
    }

    if (codes.length > 0) {
        const placeholders = codes.map(() => '?').join(',');
        const rows = await queryAll(
            db,
            `SELECT id, code FROM accounts WHERE company_id = ? AND code IN (${placeholders})`,
            [companyId, ...codes]
        );
        for (const row of rows) foundCodes.set(String(row.code), Number(row.id));
    }

    return refs.map(r => {
        const asNum = Number(r.raw);
        let resolved = null;
        if (Number.isInteger(asNum) && String(asNum) === String(r.raw).trim()) {
            resolved = foundIds.get(asNum) || null;
        } else {
            resolved = foundCodes.get(String(r.raw).trim()) || null;
        }
        if (!resolved) {
            throw new ValidationError(
                `La cuenta "${r.raw}" no existe en el plan de cuentas de esta empresa.`
            );
        }
        return { ...r.entry, accountId: resolved };
    });
}

/**
 * Valida y normaliza UNA transacción completa.
 * Devuelve { date, gloss, type, entries: [{ accountId, debit, credit, gloss }] }.
 * Lanza ValidationError con mensaje apto para el cliente.
 */
async function validateTransaction(db, { date, gloss, type, entries }, companyId, { label = '' } = {}) {
    const prefix = label ? `Transacción "${label}": ` : '';

    if (!Array.isArray(entries) || entries.length === 0) {
        throw new ValidationError(prefix + 'debe incluir al menos una partida (entry).');
    }
    if (entries.length > MAX_ENTRIES_PER_TRANSACTION) {
        throw new ValidationError(prefix + `máximo ${MAX_ENTRIES_PER_TRANSACTION} partidas por asiento.`);
    }

    const normDate = normalizeDate(date);
    if (!normDate) {
        throw new ValidationError(prefix + 'la fecha debe tener formato YYYY-MM-DD.');
    }
    if (!type || typeof type !== 'string' || !type.trim()) {
        throw new ValidationError(prefix + 'el tipo de asiento es obligatorio.');
    }

    const normEntries = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (const e of entries) {
        const debit = parseAmount(e.debit);
        const credit = parseAmount(e.credit);
        if (debit === null || credit === null) {
            throw new ValidationError(prefix + 'los montos deben ser números ≥ 0.');
        }
        if (debit === 0 && credit === 0) {
            throw new ValidationError(prefix + 'ninguna partida puede tener debe y haber en cero.');
        }
        totalDebit += debit;
        totalCredit += credit;
        normEntries.push({
            accountId: e.accountId,
            account_code: e.account_code,
            accountCode: e.accountCode,
            debit,
            credit,
            gloss: typeof e.gloss === 'string' ? e.gloss : ''
        });
    }

    if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
        throw new ValidationError(
            prefix + `asiento descuadrado: debe ${totalDebit.toFixed(2)} vs haber ${totalCredit.toFixed(2)}.`
        );
    }

    const resolved = await resolveEntryAccounts(db, normEntries, companyId);

    return {
        date: normDate,
        gloss: (typeof gloss === 'string' && gloss.trim()) ? gloss.trim() : (gloss || ''),
        type: type.trim(),
        entries: resolved.map(e => ({
            accountId: e.accountId,
            debit: e.debit,
            credit: e.credit,
            gloss: e.gloss
        }))
    };
}

module.exports = {
    ValidationError,
    normalizeDate,
    parseAmount,
    resolveEntryAccounts,
    validateTransaction,
    MAX_BATCH_TRANSACTIONS,
    MAX_ENTRIES_PER_TRANSACTION
};
