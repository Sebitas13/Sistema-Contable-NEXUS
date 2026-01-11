// Test Ledger Integration - Generate adjustments from middleware
const axios = require('axios');

const AI_BASE_URL = 'http://localhost:3001/api/ai';

async function testLedgerIntegration() {
  console.log('Testing Ledger Integration...');
  try {
    const ledgerRequest = {
      company_id: 'TEST-001',
      parameters: {
        ufv_initial: 1000,
        ufv_final: 1050,
        method: 'UFV',
        confidence_threshold: 0.95
      }
    };

    const response = await axios.post(`${AI_BASE_URL}/adjustments/generate-from-ledger`, ledgerRequest);
    console.log('Ledger Integration Result:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('Ledger Integration Error:', error.message);
    if (error.response) {
      console.error('Error Response:', error.response.data);
    }
  }
}

testLedgerIntegration().catch(console.error);
