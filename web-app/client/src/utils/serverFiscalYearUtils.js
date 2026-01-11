// server/utils/serverFiscalYearUtils.js

const ACTIVITY_TYPES_CONFIG = {
    'Comercial': { startMonth: 1, endMonth: 12, endYearOffset: 0, label: 'Comerciales, Servicios, Bancos y Seguros' },
    'Industrial': { startMonth: 4, endMonth: 3, endYearOffset: 1, label: 'Industriales, Constructoras y Petroleras' },
    'Agroindustrial': { startMonth: 7, endMonth: 6, endYearOffset: 1, label: 'Gomeras, Castañeras, Agrícolas y Ganaderas' },
    'Minera': { startMonth: 10, endMonth: 9, endYearOffset: 1, label: 'Mineras' },
};

function getFiscalYearDetails(activityType, gestion) {
    const config = ACTIVITY_TYPES_CONFIG[activityType] || ACTIVITY_TYPES_CONFIG['Comercial'];
    const startYear = parseInt(gestion);

    const startDate = `${startYear}-${String(config.startMonth).padStart(2, '0')}-01`;
    const endYear = startYear + config.endYearOffset;
    
    const lastDayOfEndMonth = new Date(endYear, config.endMonth, 0).getDate();
    const endDate = `${endYear}-${String(config.endMonth).padStart(2, '0')}-${String(lastDayOfEndMonth).padStart(2, '0')}`;

    return { startDate, endDate };
}

module.exports = { getFiscalYearDetails, ACTIVITY_TYPES_CONFIG };