const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Esto asegura que busque el archivo en la misma carpeta donde está db.js
const dbPath = path.join(__dirname, 'accounting.db');

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database at:', dbPath);
        db.configure('busyTimeout', 5000);
    }
});

module.exports = db;
