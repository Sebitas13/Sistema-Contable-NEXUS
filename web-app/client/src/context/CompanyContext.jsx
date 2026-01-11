import React, { createContext, useContext, useState, useEffect } from 'react';
import API_URL from '../api';

const CompanyContext = createContext();

export const useCompany = () => {
    const context = useContext(CompanyContext);
    if (!context) {
        throw new Error('useCompany must be used within a CompanyProvider');
    }
    return context;
};

export const CompanyProvider = ({ children }) => {
    const [selectedCompany, setSelectedCompany] = useState(null);
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);

    // Load selected company from localStorage on mount
    useEffect(() => {
        const savedCompanyId = localStorage.getItem('selectedCompanyId');
        if (savedCompanyId) {
            fetchCompanyById(savedCompanyId);
        } else {
            setLoading(false);
        }
        fetchCompanies();
    }, []);

    // Fetch all companies
    const fetchCompanies = async () => {
        try {
            const response = await fetch(`${API_URL}/api/companies`);
            const data = await response.json();
            if (data.success) {
                setCompanies(data.data);
            }
        } catch (error) {
            console.error('Error fetching companies:', error);
        }
    };

    // Fetch company by ID
    const fetchCompanyById = async (id) => {
        try {
            const response = await fetch(`${API_URL}/api/companies/${id}`);
            const data = await response.json();
            if (data.success) {
                setSelectedCompany(data.data);
            }
        } catch (error) {
            console.error('Error fetching company:', error);
        } finally {
            setLoading(false);
        }
    };

    // Select a company
    const selectCompany = async (companyId) => {
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/api/companies/${companyId}`);
            const data = await response.json();
            if (data.success) {
                setSelectedCompany(data.data);
                localStorage.setItem('selectedCompanyId', companyId);
            }
        } catch (error) {
            console.error('Error selecting company:', error);
        } finally {
            setLoading(false);
        }
    };

    // Clear selected company
    const clearCompany = () => {
        setSelectedCompany(null);
        localStorage.removeItem('selectedCompanyId');
    };

    // Create new company
    const createCompany = async (companyData) => {
        try {
            const response = await fetch(`${API_URL}/api/companies`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(companyData),
            });
            const data = await response.json();
            if (data.success) {
                await fetchCompanies();
                return { success: true, data: data.data };
            } else {
                return { success: false, error: data.error };
            }
        } catch (error) {
            console.error('Error creating company:', error);
            return { success: false, error: error.message };
        }
    };

    // Update company
    const updateCompany = async (companyId, companyData) => {
        try {
            const response = await fetch(`${API_URL}/api/companies/${companyId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(companyData),
            });
            const data = await response.json();
            if (data.success) {
                await fetchCompanies();
                if (selectedCompany?.id === companyId) {
                    setSelectedCompany(data.data);
                }
                return { success: true, data: data.data };
            } else {
                return { success: false, error: data.error };
            }
        } catch (error) {
            console.error('Error updating company:', error);
            return { success: false, error: error.message };
        }
    };

    // Delete company
    const deleteCompany = async (companyId) => {
        try {
            const response = await fetch(`${API_URL}/api/companies/${companyId}`, {
                method: 'DELETE',
            });
            const data = await response.json();
            if (data.success) {
                await fetchCompanies();
                if (selectedCompany?.id === companyId) {
                    clearCompany();
                }
                return { success: true };
            } else {
                return { success: false, error: data.error };
            }
        } catch (error) {
            console.error('Error deleting company:', error);
            return { success: false, error: error.message };
        }
    };

    const value = {
        selectedCompany,
        companies,
        loading,
        selectCompany,
        clearCompany,
        createCompany,
        updateCompany,
        deleteCompany,
        refreshCompanies: fetchCompanies,
    };

    return (
        <CompanyContext.Provider value={value}>
            {children}
        </CompanyContext.Provider>
    );
};
