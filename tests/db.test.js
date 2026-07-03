'use strict';

const { createDb } = require('../db');

function makeStore() {
  return createDb(':memory:');
}

describe('link store', () => {
  let store;

  beforeEach(() => {
    store = makeStore();
  });

  afterEach(() => {
    store.close();
  });

  test('add returns the stored link with a generated id and favourite=false', () => {
    const link = store.add({
      url: 'https://example.com',
      title: 'Example',
      savedAt: '2026-07-03T10:00:00.000Z',
    });

    expect(link.id).toEqual(expect.any(Number));
    expect(link.url).toBe('https://example.com');
    expect(link.title).toBe('Example');
    expect(link.favourite).toBe(false);
    expect(link.savedAt).toBe('2026-07-03T10:00:00.000Z');
  });

  test('list returns newest first', () => {
    store.add({ url: 'https://a.com', title: 'A', savedAt: '2026-07-03T10:00:00.000Z' });
    store.add({ url: 'https://b.com', title: 'B', savedAt: '2026-07-03T11:00:00.000Z' });

    const titles = store.list().map((l) => l.title);
    expect(titles).toEqual(['B', 'A']);
  });

  test('list favourite filter returns only favourites', () => {
    const a = store.add({ url: 'https://a.com', title: 'A', savedAt: '2026-07-03T10:00:00.000Z' });
    store.add({ url: 'https://b.com', title: 'B', savedAt: '2026-07-03T11:00:00.000Z' });
    store.setFavourite(a.id, true);

    const favourites = store.list({ favourite: true });
    expect(favourites).toHaveLength(1);
    expect(favourites[0].title).toBe('A');
  });

  test('remove deletes only the matching id and reports success', () => {
    const a = store.add({ url: 'https://a.com', title: 'A', savedAt: '2026-07-03T10:00:00.000Z' });
    const b = store.add({ url: 'https://b.com', title: 'B', savedAt: '2026-07-03T11:00:00.000Z' });

    expect(store.remove(a.id)).toBe(true);
    expect(store.list().map((l) => l.id)).toEqual([b.id]);
  });

  test('remove returns false when id does not exist', () => {
    expect(store.remove(999)).toBe(false);
  });

  test('setFavourite toggles the flag and returns the updated link', () => {
    const a = store.add({ url: 'https://a.com', title: 'A', savedAt: '2026-07-03T10:00:00.000Z' });

    expect(store.setFavourite(a.id, true).favourite).toBe(true);
    expect(store.setFavourite(a.id, false).favourite).toBe(false);
  });

  test('setFavourite returns null for a missing id', () => {
    expect(store.setFavourite(999, true)).toBeNull();
  });

  test('data survives reopening the same database file', () => {
    const path = require('node:path');
    const os = require('node:os');
    const fs = require('node:fs');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-')), 'links.db');

    const first = createDb(file);
    first.add({ url: 'https://persist.com', title: 'Persist', savedAt: '2026-07-03T10:00:00.000Z' });
    first.close();

    const second = createDb(file);
    expect(second.list()).toHaveLength(1);
    expect(second.list()[0].url).toBe('https://persist.com');
    second.close();
  });
});
