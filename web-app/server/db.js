const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database Setup
const dbPath = path.resolve(__dirname, 'db', 'accounting.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // User-recommended configuration for better concurrency handling
        db.configure('busyTimeout', 5000);
    }
});

module.exports = db;
