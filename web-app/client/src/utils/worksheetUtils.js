const worksheetAmountFields = [
    'total_debit',
    'total_credit',
    'adj_debit',
    'adj_credit',
    'ending_debit',
    'ending_credit',
    'closing_debit',
    'closing_credit'
];

export function filterWorksheetAccounts(accounts = []) {
    return accounts.filter(account => worksheetAmountFields.some(field => {
        const value = Number(account[field]);
        return Number.isFinite(value) && Math.round((Math.abs(value) + Number.EPSILON) * 100) !== 0;
    }));
}
