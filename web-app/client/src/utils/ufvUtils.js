// Utilidades para obtener tasas UFV desde el sistema UFV.jsx

import API_URL from '../api';

export const getUFVValue = async (date, companyId) => {
    try {
        const year = new Date(date).getFullYear();
        const response = await fetch(`${API_URL}/api/ufv?year=${year}&companyId=${companyId}`);
        const data = await response.json();

        if (data.data && Array.isArray(data.data)) {
            const ufvRecord = data.data.find(item => item.date === date);
            return ufvRecord ? parseFloat(ufvRecord.value) : null;
        }
        return null;
    } catch (error) {
        console.error('Error fetching UFV value:', error);
        return null;
    }
};

export const getUFVRange = async (startDate, endDate, companyId) => {
    try {
        const startYear = new Date(startDate).getFullYear();
        const endYear = new Date(endDate).getFullYear();

        // Obtener datos para todos los años necesarios
        const years = [];
        for (let year = startYear; year <= endYear; year++) {
            years.push(year);
        }

        const promises = years.map(year =>
            fetch(`${API_URL}/api/ufv?year=${year}&companyId=${companyId}`)
                .then(res => res.json())
                .then(data => data.data || [])
        );

        const allData = await Promise.all(promises);
        const ufvData = allData.flat();

        // Encontrar UFV al inicio y fin del período
        const startUFV = ufvData.find(item => item.date === startDate);
        const endUFV = ufvData.find(item => item.date === endDate);

        return {
            startUFV: startUFV ? parseFloat(startUFV.value) : null,
            endUFV: endUFV ? parseFloat(endUFV.value) : null,
            availableDates: ufvData.map(item => item.date)
        };
    } catch (error) {
        console.error('Error fetching UFV range:', error);
        return {
            startUFV: null,
            endUFV: null,
            availableDates: []
        };
    }
};

// Función para obtener UFV más cercana a una fecha (si no existe exacta)
export const getClosestUFV = async (targetDate, companyId) => {
    try {
        const year = new Date(targetDate).getFullYear();
        const response = await fetch(`${API_URL}/api/ufv?year=${year}&companyId=${companyId}`);
        const data = await response.json();

        if (data.data && Array.isArray(data.data)) {
            const ufvData = data.data;

            // Buscar fecha exacta
            const exactMatch = ufvData.find(item => item.date === targetDate);
            if (exactMatch) {
                return parseFloat(exactMatch.value);
            }

            // Si no hay exacta, buscar la más cercana anterior
            const target = new Date(targetDate);
            const previousDates = ufvData
                .filter(item => new Date(item.date) <= target)
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            if (previousDates.length > 0) {
                return parseFloat(previousDates[0].value);
            }
        }
        return null;
    } catch (error) {
        console.error('Error fetching closest UFV:', error);
        return null;
    }
};

// Función para obtener T/C más cercano a una fecha
export const getExchangeRateValue = async (targetDate, companyId, currency = 'USD') => {
    try {
        const response = await fetch(`${API_URL}/api/exchange-rates?companyId=${companyId}&startDate=${targetDate}&endDate=${targetDate}&currency=${currency}`);
        const data = await response.json();

        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            // Find specific date if multiple returned or just take first
            const match = data.data.find(item => item.date === targetDate);
            return match ? parseFloat(match.sell_rate) : parseFloat(data.data[0].sell_rate);
        }

        // If not found for specific date, we could try a "closest" logic similar to UFV
        const year = new Date(targetDate).getFullYear();
        const fullYearResponse = await fetch(`${API_URL}/api/exchange-rates?companyId=${companyId}&startDate=${year}-01-01&endDate=${year}-12-31&currency=${currency}`);
        const fullData = await fullYearResponse.json();

        if (fullData.data && Array.isArray(fullData.data)) {
            const target = new Date(targetDate);
            const previousDates = fullData.data
                .filter(item => new Date(item.date) <= target)
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            if (previousDates.length > 0) {
                return parseFloat(previousDates[0].sell_rate);
            }
        }

        return null;
    } catch (error) {
        console.error('Error fetching exchange rate value:', error);
        return null;
    }
};
