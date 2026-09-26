import assert from 'node:assert/strict';
import { filterWorksheetAccounts } from './src/utils/worksheetUtils.js';

const visible = filterWorksheetAccounts([
    { id: 'unused', total_debit: 0, total_credit: 0, ending_debit: 0, ending_credit: 0 },
    { id: 'turnover', total_debit: 25, total_credit: 25 },
    { id: 'adjustment', adj_credit: 10 },
    { id: 'prior-balance', ending_debit: 125 },
    { id: 'closing-only', closing_credit: 5 },
    { id: 'sub-cent-noise', ending_debit: 0.004 }
]);

assert.deepEqual(visible.map(account => account.id), [
    'turnover',
    'adjustment',
    'prior-balance',
    'closing-only'
]);

console.log('worksheet account filter assertions passed');
