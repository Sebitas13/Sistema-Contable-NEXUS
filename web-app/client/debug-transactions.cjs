const axios = require('axios');

async function debugTransactions() {
    try {
        const response = await axios.get('http://localhost:3001/api/transactions?companyId=1');
        const transactions = response.data.data;

        console.log(`Found ${transactions.length} transactions.`);

        if (transactions.length > 0) {
            const t = transactions[0];
            console.log('First Transaction Entries:');
            console.log(JSON.stringify(t.entries, null, 2));

            if (t.entries && t.entries.length > 0) {
                console.log('First Entry Structure:', t.entries[0]);
            } else {
                console.log('Entries array is empty or null');
            }
        }
    } catch (error) {
        console.error('Error fetching transactions:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

debugTransactions();
