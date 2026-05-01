import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const inventoryService = {
    async getItems(companyId) {
        const response = await axios.get(`${API_URL}/inventory/items`, { params: { companyId } });
        return response.data;
    },

    async addMovement(movementData) {
        const response = await axios.post(`${API_URL}/inventory/movements`, movementData);
        return response.data;
    },

    async getCostCenters(companyId) {
        const response = await axios.get(`${API_URL}/inventory/cost-centers`, { params: { companyId } });
        return response.data;
    },

    async createItem(itemData) {
        const response = await axios.post(`${API_URL}/inventory/items`, itemData);
        return response.data;
    },

    // WIP & Production
    async getProductionOrders(companyId) {
        const response = await axios.get(`${API_URL}/inventory/production-orders`, { params: { companyId } });
        return response.data;
    }
};

export default inventoryService;
