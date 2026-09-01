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

    async updateItem(id, itemData, companyId) {
        const response = await axios.put(`${API_URL}/api/inventory/items/${id}`, { ...itemData, company_id: companyId });
        return response.data;
    },

    async deleteItem(id, companyId) {
        const response = await axios.delete(`${API_URL}/api/inventory/items/${id}`, { params: { companyId } });
        return response.data;
    },

    // ============ MOVEMENTS ============
    async getMovements(itemId, companyId) {
        const response = await axios.get(`${API_URL}/api/inventory/movements/${itemId}`, { params: { companyId } });
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

    async updateCostCenter(id, data, companyId) {
        const response = await axios.put(`${API_URL}/api/inventory/cost-centers/${id}`, { ...data, company_id: companyId });
        return response.data;
    },

    async deleteCostCenter(id, companyId) {
        const response = await axios.delete(`${API_URL}/api/inventory/cost-centers/${id}`, { params: { companyId } });
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

    async deleteDistributionModel(id, companyId) {
        const response = await axios.delete(`${API_URL}/api/inventory/distribution-models/${id}`, { params: { companyId } });
        return response.data;
    }
};

export default inventoryService;
