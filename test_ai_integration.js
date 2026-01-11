// AI Integration Test - Full System Verification
const axios = require('axios');

const AI_BASE_URL = 'http://localhost:3001/api/ai';

async function testAIIntegration() {
  console.log('Starting AI Integration Test...');
  try {
    // 1. Health Check
    const healthResponse = await axios.get(`${AI_BASE_URL}/health`);
    console.log('Health Check:', healthResponse.data);

    // 2. Test Adjustment Generation
    const testAccounts = [
      { code: '110000', name: 'Edificio Principal', balance: 100000, type: 'activo' },
      { code: '120000', name: 'Vehiculos', balance: 50000, type: 'activo' }
    ];

    const adjustmentRequest = {
      company_id: 'TEST-001',
      accounts: testAccounts,
      parameters: {
        ufv_initial: 1000,
        ufv_final: 1050,
        method: 'UFV',
        confidence_threshold: 0.95
      }
    };

    const adjustmentResponse = await axios.post(`${AI_BASE_URL}/adjustments/generate`, adjustmentRequest);
    console.log('Adjustments Generated:', JSON.stringify(adjustmentResponse.data, null, 2));

    // 3. Test Validation
    if (adjustmentResponse.data.proposedTransactions && adjustmentResponse.data.proposedTransactions.length > 0) {
      const validationResponse = await axios.post(`${AI_BASE_URL}/adjustments/batch-validate`, adjustmentResponse.data.proposedTransactions);
      console.log('Validation Results:', JSON.stringify(validationResponse.data, null, 2));
    }

    // 4. Test Explanation
    const explanationResponse = await axios.post(`${AI_BASE_URL}/adjustments/explain`, {
      account: {
        code: '110000',
        name: 'Edificio Principal',
        balance: 100000,
        type: 'activo'
      },
      params: { ufv_initial: 1000, ufv_final: 1050, method: 'UFV', confidence_threshold: 0.95 }
    });
    console.log('AI Explanation:', JSON.stringify(explanationResponse.data, null, 2));

    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Test failed:', error.message);
    if (error.response) {
      console.error('Error Response:', error.response.data);
    }
  }
}

testAIIntegration().catch(console.error);
