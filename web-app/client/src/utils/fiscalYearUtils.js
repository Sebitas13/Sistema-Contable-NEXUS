// fiscalYearUtils.js

export const ACTIVITY_TYPES_CONFIG = {
    'Comercial': { startMonth: 1, endMonth: 12, endYearOffset: 0, label: 'Comerciales, Servicios, Bancos y Seguros' },
    'Industrial': { startMonth: 4, endMonth: 3, endYearOffset: 1, label: 'Industriales, Constructoras y Petroleras' },
    'Agroindustrial': { startMonth: 7, endMonth: 6, endYearOffset: 1, label: 'Gomeras, Castañeras, Agrícolas y Ganaderas' },
    'Minera': { startMonth: 10, endMonth: 9, endYearOffset: 1, label: 'Mineras' },
};

export const MONTH_NAMES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/**
 * Gets fiscal year details for a given activity type and "gestion" year.
 * @param {string} activityType - e.g., 'Industrial', 'Comercial'
 * @param {number} gestion - The starting year of the fiscal period.
 * @param {string} operationStartDate - Optional specific operation start date (YYYY-MM-DD)
 * @returns {{startDate: string, endDate: string, months: Array<{index: number, name: string, year: number}>}}
 */
export function getFiscalYearDetails(activityType, gestion, operationStartDate = null) {
    const config = ACTIVITY_TYPES_CONFIG[activityType] || ACTIVITY_TYPES_CONFIG['Comercial'];
    const startYear = parseInt(gestion);

    let startDate = `${startYear}-${String(config.startMonth).padStart(2, '0')}-01`;
    const endYear = startYear + config.endYearOffset;

    // Last day of endMonth
    const lastDayOfEndMonth = new Date(endYear, config.endMonth, 0).getDate();
    const endDate = `${endYear}-${String(config.endMonth).padStart(2, '0')}-${String(lastDayOfEndMonth).padStart(2, '0')}`;

    // Override startDate if operationStartDate is provided and falls within the period
    if (operationStartDate) {
        const opStart = new Date(operationStartDate);
        const periodStart = new Date(startDate);
        const periodEnd = new Date(endDate);

        if (opStart >= periodStart && opStart <= periodEnd) {
            startDate = operationStartDate;
        }
    }

    const months = [];
    for (let i = 0; i < 12; i++) {
        const monthIndex = (config.startMonth - 1 + i) % 12;
        const currentYear = (config.endYearOffset > 0 && monthIndex < config.startMonth - 1)
            ? startYear + 1
            : startYear;

        months.push({
            index: monthIndex + 1,
            name: MONTH_NAMES_SHORT[monthIndex],
            year: currentYear
        });
    }

    return { startDate, endDate, months };
}