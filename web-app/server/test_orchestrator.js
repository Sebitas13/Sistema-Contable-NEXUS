/**
 * test_adjustment_flow.js
 * Integration test for the end-to-end AI adjustment workflow.
 * This script validates two key functionalities:
 * 1. The Mahoraga security controller correctly blocks/allows operations.
 * 2. A complete adjustment proposal can be generated and then saved to the database.
 * 
 * Run with: node web-app/server/test_orchestrator.js
 */

const axios = require('axios');
const mahoragaController = require('./services/mahoragaController');

const API_BASE_URL = 'http://localhost:3001/api/ai/adjustments';
const TEST_COMPANY_ID = '1'; // Assuming company with ID 1 exists for testing

// Helper to format console output
const log = (message, color = '\x1b[0m') => console.log(`${color}${message}\x1b[0m`);
const green = (msg) => log(msg, '\x1b[32m');
const red = (msg) => log(msg, '\x1b[31m');
const yellow = (msg) => log(msg, '\x1b[33m');

async function runAdjustmentIntegrationTest() {
  log('🚀 ===== Starting AI Adjustment Workflow Integration Test ===== 🚀');

  // --- Test Case 1: Verify Mahoraga Security Layer ---
  log('\n[TEST CASE 1] Verifying Mahoraga Security Layer...');
  
  // Step 1.1: Set mode to MANUAL and expect failure
  mahoragaController.changeMode(mahoragaController.modes.MANUAL, 'test_suite', 'Setting up for security test');
  yellow(`  > Mahoraga mode set to: ${mahoragaController.currentMode}`);
  
  const generatePayload = {
    company_id: TEST_COMPANY_ID,
    parameters: {
      ufv_initial: 2.5,
      ufv_final: 2.6,
      method: 'UFV'
    }
  };

  try {
    await axios.post(`${API_BASE_URL}/generate-from-ledger`, generatePayload);
    red('  [FAIL] ❌ Test 1.1: Adjustment generation was NOT blocked in MANUAL mode.');
  } catch (error) {
    if (error.response && error.response.status === 403) {
      green('  [SUCCESS] ✅ Test 1.1: Adjustment generation correctly blocked in MANUAL mode.');
    } else {
      red(`  [FAIL] ❌ Test 1.1: An unexpected error occurred. Status: ${error.response?.status}. Message: ${error.message}`);
    }
  }

  // --- Test Case 2: Verify End-to-End Success Flow ---
  log('\n[TEST CASE 2] Verifying End-to-End Success Flow...');

  // Step 2.1: Set mode to ASSISTED to allow operation
  mahoragaController.changeMode(mahoragaController.modes.ASSISTED, 'test_suite', 'Setting up for E2E test');
  yellow(`  > Mahoraga mode set to: ${mahoragaController.currentMode}`);

  let proposal;
  try {
    const response = await axios.post(`${API_BASE_URL}/generate-from-ledger`, generatePayload);
    if (response.data && response.data.success) {
      green('  [SUCCESS] ✅ Test 2.1: Successfully generated adjustment proposal.');
      proposal = response.data;
      log(`    - Proposal contains ${proposal.proposedTransactions.length} transactions.`);
    } else {
      red('  [FAIL] ❌ Test 2.1: API call succeeded but did not return a successful proposal.');
      log(proposal.error || 'No error message provided.');
      return; // Stop test if proposal fails
    }
  } catch (error) {
    red(`  [FAIL] ❌ Test 2.1: Failed to generate adjustment proposal. Status: ${error.response?.status}.`);
    log(error.response?.data?.error || error.message);
    return; // Stop test if proposal fails
  }

  // Step 2.2: Confirm and Save the generated adjustments
  if (!proposal || proposal.proposedTransactions.length === 0) {
    yellow('  > Skipping confirmation test as no transactions were proposed.');
    log('🏁 ===== Test Finished ===== 🏁');
    return;
  }
  
  const confirmPayload = {
    companyId: TEST_COMPANY_ID,
    transactions: proposal.proposedTransactions,
    endDate: new Date().toISOString().split('T')[0], // Use today's date for test
    batchId: proposal.batchId || `test_${Date.now()}`
  };

  try {
    const confirmResponse = await axios.post(`${API_BASE_URL}/confirm`, confirmPayload);
    if (confirmResponse.data && confirmResponse.data.success) {
      green('  [SUCCESS] ✅ Test 2.2: Successfully confirmed and saved adjustments to the database.');
    } else {
      red('  [FAIL] ❌ Test 2.2: The confirmation endpoint returned a failure response.');
      log(confirmResponse.data.error || 'No error message provided.');
    }
  } catch (error) {
    red(`  [FAIL] ❌ Test 2.2: Failed to confirm adjustments. Status: ${error.response?.status}.`);
    log(error.response?.data?.details || error.response?.data?.error || error.message);
  }

  log('\n🏁 ===== Test Finished ===== 🏁');
}

// Run the test
runAdjustmentIntegrationTest();