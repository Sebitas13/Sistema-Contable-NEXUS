import axios from 'axios';
import API_URL from '../api';

const inventoryService = {
    // ============ ITEMS ============
    async getItems(companyId) {
        const response = await axios.get(`${API_URL}/api/inventory/items`, { params: { companyId } });
        return response.data;
    },

    async createItem(itemData) {
        const response = await axios.post(`${API_URL}/api/inventory/items`, itemData);
        return response.data;
    },

    async updateItem(id, itemData) {
        const response = await axios.put(`${API_URL}/api/inventory/items/${id}`, itemData);
        return response.data;
    },

    async deleteItem(id) {
        const response = await axios.delete(`${API_URL}/api/inventory/items/${id}`);
        return response.data;
    },

    // ============ MOVEMENTS ============
    async getMovements(itemId) {
        const response = await axios.get(`${API_URL}/api/inventory/movements/${itemId}`);
        return response.data;
    },

    async addMovement(movementData) {
        const response = await axios.post(`${API_URL}/api/inventory/movements`, movementData);
        return response.data;
    },

    // ============ COST CENTERS ============
    async getCostCenters(companyId) {
        const response = await axios.get(`${API_URL}/api/inventory/cost-centers`, { params: { companyId } });
        return response.data;
    },

    async createCostCenter(data) {
        const response = await axios.post(`${API_URL}/api/inventory/cost-centers`, data);
        return response.data;
    },

    async updateCostCenter(id, data) {
        const response = await axios.put(`${API_URL}/api/inventory/cost-centers/${id}`, data);
        return response.data;
    },

    async deleteCostCenter(id) {
        const response = await axios.delete(`${API_URL}/api/inventory/cost-centers/${id}`);
        return response.data;
    },

    // ============ DISTRIBUTION MODELS ============
    async getDistributionModels(companyId) {
        const response = await axios.get(`${API_URL}/api/inventory/distribution-models`, { params: { companyId } });
        return response.data;
    },

    async createDistributionModel(data) {
        const response = await axios.post(`${API_URL}/api/inventory/distribution-models`, data);
        return response.data;
    },

    async deleteDistributionModel(id) {
        const response = await axios.delete(`${API_URL}/api/inventory/distribution-models/${id}`);
        return response.data;
    }
};

export default inventoryService;
