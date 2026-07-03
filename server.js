'use strict';

const path = require('node:path');
const { createApp } = require('./app');
const { createDb } = require('./db');
const { fetchTitle } = require('./lib/fetchTitle');

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'links.db');
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 5000;

const db = createDb(DB_PATH);
const app = createApp({
  db,
  fetchTitle: (url) => fetchTitle(url, { timeoutMs: FETCH_TIMEOUT_MS }),
});

const server = app.listen(PORT, () => {
  console.log(`Link Saver listening on http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
