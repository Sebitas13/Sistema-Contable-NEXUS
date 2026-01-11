const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, 'db', 'accounting.db');

console.log('🗑️  Cleaning database...\n');

// Delete the current database if it exists
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('✅ Old database removed');
} else {
    console.log('ℹ️  No database found to remove');
}

console.log('\n✨ Database cleaned!');
console.log('🚀 Now start the server with: node index.js');
console.log('   The schema will be recreated automatically.\n');
