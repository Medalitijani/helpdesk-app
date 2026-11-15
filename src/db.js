const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbFile = path.join(__dirname, '..', 'helpdesk.db');
const db = new Database(dbFile);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create the tables on first run (the script is safe to run every time).
db.exec(fs.readFileSync(path.join(__dirname, 'sql', 'schema.sql'), 'utf8'));

module.exports = db;
