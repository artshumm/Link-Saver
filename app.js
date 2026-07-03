'use strict';

const path = require('node:path');
const express = require('express');
const { validateUrl, BadUrlError } = require('./lib/url');
const { FetchTitleError } = require('./lib/fetchTitle');

/**
 * Builds the Express app. Dependencies are injected so tests can supply an
 * in-memory store and a stub title fetcher.
 *
 * @param {{ db: import('./db').LinkStore, fetchTitle: (url: URL) => Promise<string> }} deps
 * @returns {import('express').Express}
 */
function createApp({ db, fetchTitle }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.post('/links', async (req, res, next) => {
    let url;
    try {
      url = validateUrl(req.body?.url);
    } catch (error) {
      if (error instanceof BadUrlError) {
        return fail(res, 400, error.message);
      }
      return next(error);
    }

    try {
      const title = await fetchTitle(url);
      const link = db.add({
        url: url.href,
        title,
        savedAt: new Date().toISOString(),
      });
      return res.status(201).json({ success: true, data: link });
    } catch (error) {
      if (error instanceof FetchTitleError) {
        return fail(res, 502, error.message);
      }
      return next(error);
    }
  });

  app.get('/links', (req, res) => {
    const favourite = req.query.favourite === '1' || req.query.favourite === 'true';
    return res.json({ success: true, data: db.list({ favourite }) });
  });

  app.delete('/links/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return fail(res, 400, 'Invalid id');
    }
    if (!db.remove(id)) {
      return fail(res, 404, 'Link not found');
    }
    return res.sendStatus(204);
  });

  app.patch('/links/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return fail(res, 400, 'Invalid id');
    }
    if (typeof req.body?.favourite !== 'boolean') {
      return fail(res, 400, 'favourite must be a boolean');
    }
    const link = db.setFavourite(id, req.body.favourite);
    if (!link) {
      return fail(res, 404, 'Link not found');
    }
    return res.json({ success: true, data: link });
  });

  // Centralised error handler for anything unexpected.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, _next) => {
    console.error('Unhandled error:', error);
    fail(res, 500, 'Internal server error');
  });

  return app;
}

/**
 * @param {string} raw
 * @returns {number|null}
 */
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} message
 */
function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

module.exports = { createApp };
