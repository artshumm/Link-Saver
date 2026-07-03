'use strict';

const request = require('supertest');
const { createApp } = require('../app');
const { createDb } = require('../db');
const { BadUrlError } = require('../lib/url');
const { FetchTitleError } = require('../lib/fetchTitle');

function makeApp(fetchTitle) {
  const db = createDb(':memory:');
  const app = createApp({ db, fetchTitle });
  return { app, db };
}

describe('POST /links', () => {
  test('saves a link with the fetched title and returns 201', async () => {
    const { app } = makeApp(async () => 'Fetched Title');

    const res = await request(app).post('/links').send({ url: 'https://example.com' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      url: 'https://example.com/',
      title: 'Fetched Title',
      favourite: false,
    });
    expect(res.body.data.savedAt).toEqual(expect.any(String));
  });

  test('rejects a missing url with 400', async () => {
    const { app } = makeApp(async () => 'x');
    const res = await request(app).post('/links').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejects a malformed url with 400 and does not save', async () => {
    const { app, db } = makeApp(async () => {
      throw new BadUrlError('bad');
    });
    const res = await request(app).post('/links').send({ url: 'not a url' });
    expect(res.status).toBe(400);
    expect(db.list()).toHaveLength(0);
  });

  test('returns 502 when the page cannot be fetched and does not save', async () => {
    const { app, db } = makeApp(async () => {
      throw new FetchTitleError('unreachable');
    });
    const res = await request(app).post('/links').send({ url: 'https://down.example' });
    expect(res.status).toBe(502);
    expect(db.list()).toHaveLength(0);
  });
});

describe('GET /links', () => {
  test('lists saved links and filters favourites', async () => {
    const { app, db } = makeApp(async () => 'T');
    const a = db.add({ url: 'https://a.com', title: 'A', savedAt: '2026-07-03T10:00:00.000Z' });
    db.add({ url: 'https://b.com', title: 'B', savedAt: '2026-07-03T11:00:00.000Z' });
    db.setFavourite(a.id, true);

    const all = await request(app).get('/links');
    expect(all.body.data).toHaveLength(2);

    const favs = await request(app).get('/links?favourite=1');
    expect(favs.body.data).toHaveLength(1);
    expect(favs.body.data[0].title).toBe('A');
  });
});

describe('DELETE /links/:id', () => {
  test('deletes an existing link and returns 204', async () => {
    const { app, db } = makeApp(async () => 'T');
    const a = db.add({ url: 'https://a.com', title: 'A', savedAt: '2026-07-03T10:00:00.000Z' });

    const res = await request(app).delete(`/links/${a.id}`);
    expect(res.status).toBe(204);
    expect(db.list()).toHaveLength(0);
  });

  test('returns 404 for a missing link', async () => {
    const { app } = makeApp(async () => 'T');
    const res = await request(app).delete('/links/999');
    expect(res.status).toBe(404);
  });

  test('returns 400 for a non-numeric id', async () => {
    const { app } = makeApp(async () => 'T');
    const res = await request(app).delete('/links/abc');
    expect(res.status).toBe(400);
  });
});

describe('PATCH /links/:id', () => {
  test('toggles favourite and returns the updated link', async () => {
    const { app, db } = makeApp(async () => 'T');
    const a = db.add({ url: 'https://a.com', title: 'A', savedAt: '2026-07-03T10:00:00.000Z' });

    const on = await request(app).patch(`/links/${a.id}`).send({ favourite: true });
    expect(on.status).toBe(200);
    expect(on.body.data.favourite).toBe(true);

    const off = await request(app).patch(`/links/${a.id}`).send({ favourite: false });
    expect(off.body.data.favourite).toBe(false);
  });

  test('rejects a non-boolean favourite with 400', async () => {
    const { app, db } = makeApp(async () => 'T');
    const a = db.add({ url: 'https://a.com', title: 'A', savedAt: '2026-07-03T10:00:00.000Z' });
    const res = await request(app).patch(`/links/${a.id}`).send({ favourite: 'yes' });
    expect(res.status).toBe(400);
  });

  test('returns 404 for a missing link', async () => {
    const { app } = makeApp(async () => 'T');
    const res = await request(app).patch('/links/999').send({ favourite: true });
    expect(res.status).toBe(404);
  });

  test('returns 400 for a non-numeric id', async () => {
    const { app } = makeApp(async () => 'T');
    const res = await request(app).patch('/links/abc').send({ favourite: true });
    expect(res.status).toBe(400);
  });
});
