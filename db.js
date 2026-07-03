'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

/**
 * Opens (and lazily migrates) a SQLite-backed link store.
 *
 * @param {string} dbPath Absolute or relative path to the SQLite file, or ':memory:'.
 * @returns {LinkStore}
 */
function createDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      url        TEXT    NOT NULL,
      title      TEXT    NOT NULL,
      favourite  INTEGER NOT NULL DEFAULT 0,
      saved_at   TEXT    NOT NULL
    );
  `);

  const statements = {
    insert: db.prepare(
      'INSERT INTO links (url, title, favourite, saved_at) VALUES (?, ?, 0, ?)'
    ),
    listAll: db.prepare('SELECT * FROM links ORDER BY saved_at DESC, id DESC'),
    listFavourites: db.prepare(
      'SELECT * FROM links WHERE favourite = 1 ORDER BY saved_at DESC, id DESC'
    ),
    getById: db.prepare('SELECT * FROM links WHERE id = ?'),
    remove: db.prepare('DELETE FROM links WHERE id = ?'),
    setFavourite: db.prepare('UPDATE links SET favourite = ? WHERE id = ?'),
  };

  /** @param {any} row */
  function toLink(row) {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      favourite: row.favourite === 1,
      savedAt: row.saved_at,
    };
  }

  return {
    /**
     * @param {{ url: string, title: string, savedAt: string }} link
     * @returns {object} The stored link with its generated id.
     */
    add({ url, title, savedAt }) {
      const info = statements.insert.run(url, title, savedAt);
      const link = toLink(statements.getById.get(info.lastInsertRowid));
      if (!link) {
        throw new Error('Failed to read back the inserted link');
      }
      return link;
    },

    /**
     * @param {{ favourite?: boolean }} [filter]
     * @returns {object[]}
     */
    list({ favourite = false } = {}) {
      const rows = favourite
        ? statements.listFavourites.all()
        : statements.listAll.all();
      return rows.map(toLink);
    },

    /** @param {number} id */
    get(id) {
      return toLink(statements.getById.get(id));
    },

    /**
     * @param {number} id
     * @returns {boolean} True when a row was deleted.
     */
    remove(id) {
      return statements.remove.run(id).changes > 0;
    },

    /**
     * @param {number} id
     * @param {boolean} favourite
     * @returns {object|null} The updated link, or null when not found.
     */
    setFavourite(id, favourite) {
      const changed = statements.setFavourite.run(favourite ? 1 : 0, id).changes > 0;
      return changed ? this.get(id) : null;
    },

    close() {
      db.close();
    },
  };
}

/**
 * @typedef {ReturnType<typeof createDb>} LinkStore
 */

module.exports = { createDb };
