const axios = require('axios');

async function testPayloads() {
    const url = 'http://localhost:3002/api/accounts';

    const payloads = [
        { name: 'Valid Account', data: { code: '100', name: 'Test Valid', type: 'Activo', level: 1, company_id: 1 } },
        { name: 'Missing Company', data: { code: '101', name: 'Test No Company', type: 'Activo', level: 1 } }, // Should default to 1
        { name: 'Missing Level', data: { code: '102', name: 'Test No Level', type: 'Activo', company_id: 1 } }, // Should FAIL
        { name: 'Level 0', data: { code: '103', name: 'Test Level 0', type: 'Activo', level: 0, company_id: 1 } }, // Should FAIL if check is !level
        { name: 'Missing Type', data: { code: '104', name: 'Test No Type', level: 1, company_id: 1 } }, // Should FAIL
        { name: 'Missing Name', data: { code: '105', type: 'Activo', level: 1, company_id: 1 } }, // Should FAIL
        { name: 'Empty Name', data: { code: '106', name: '', type: 'Activo', level: 1, company_id: 1 } }, // Should FAIL
        { name: 'Null Parent', data: { code: '107', name: 'Test Null Parent', type: 'Activo', level: 1, parent_code: null, company_id: 1 } }, // Should PASS
    ];

    console.log('🚀 Testing API Payloads...\n');

    for (const p of payloads) {
        try {
            await axios.post(url, p.data);
            console.log(`✅ ${p.name}: Success`);
        } catch (error) {
            console.log(`❌ ${p.name}: Failed with ${error.response?.status} - ${JSON.stringify(error.response?.data)}`);
        }
    }
}

testPayloads();
