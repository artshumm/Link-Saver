# Part B — Code Review

Review of the provided `server.js` snippet. I treated it as a code review (didn't run it) and
grouped findings by severity. The corrected code is at the bottom.

## Original snippet

```js
const express = require('express');
const fs = require('fs');
const app = express();
app.use(express.json());
let links = JSON.parse(fs.readFileSync('links.json'));

app.post('/links', async (req, res) => {
  const { url } = req.body;
  const html = await fetch(url).then(r => r.text());
  const title = html.match(/<title>(.*)<\/title>/)[1];
  const link = { id: Date.now(), url, title, savedAt: new Date() };
  links.push(link);
  fs.writeFileSync('links.json', JSON.stringify(links));
  res.json(link);
});

app.delete('/links/:id', (req, res) => {
  links = links.filter(l => l.id === req.params.id);
  fs.writeFileSync('links.json', JSON.stringify(links));
  res.sendStatus(200);
});

app.listen(3000);
```

## Findings

### 🔴 CRITICAL — DELETE wipes the entire database

```js
links = links.filter(l => l.id === req.params.id);
```

Two bugs compound into data loss:

1. **Inverted predicate.** `filter` *keeps* the items that match. To delete one link you must
   keep the ones that *don't* match, i.e. `l.id !== id`. As written, it keeps only the matching
   link and drops everything else.
2. **Type mismatch.** `l.id` is a number (`Date.now()`), `req.params.id` is always a string, and
   `===` does no coercion. So the predicate is `false` for **every** row.

**Combined effect:** every `DELETE /links/:id` reduces `links` to `[]` and writes the empty array
to disk — a full, irreversible wipe on *any* delete, even with a non-existent id.

**Input that breaks it:** `DELETE /links/123` (any id at all).

**Fix:** invert the comparison and compare the same types; also report 404 when nothing matched.

### 🟠 HIGH — Server crashes on startup if `links.json` is missing or malformed

```js
let links = JSON.parse(fs.readFileSync('links.json'));
```

On a fresh checkout there is no `links.json`, so `readFileSync` throws `ENOENT` and the process
dies before `listen`. A truncated/invalid file throws a `SyntaxError` with the same result. The app
can't start from the README as written.

**Input that breaks it:** first run (no file), or any corrupted file.

**Fix:** read defensively and default to `[]`.

### 🟠 HIGH — Unhandled fetch rejection hangs the request (and can crash the process)

```js
const html = await fetch(url).then(r => r.text());
```

There's no `try/catch` and no URL validation. In Express 4 a rejected promise in an async handler
is **not** routed to the error handler, so:

- a bad/unreachable URL (`fetch` rejects) leaves the request hanging with no response and triggers
  an `unhandledRejection`;
- there is no timeout, so a slow host holds the socket open indefinitely.

**Input that breaks it:** `POST /links {"url":"not-a-url"}`, `{"url":"https://does-not-exist.invalid"}`,
or a missing `url` (then `fetch(undefined)`).

**Fix:** validate the URL, wrap the fetch in `try/catch`, add an `AbortController` timeout, and
return a 4xx/5xx instead of hanging.

### 🟠 HIGH — Title extraction throws when there is no `<title>`

```js
const title = html.match(/<title>(.*)<\/title>/)[1];
```

`String.prototype.match` returns `null` when there's no match, and `null[1]` throws
`TypeError: Cannot read properties of null`. Any page without a `<title>` (redirects, PDFs,
API responses, error pages) crashes the handler → 500.

**Input that breaks it:** any URL whose response has no `<title>` tag.

**Fix:** guard the null and fall back (e.g. to the hostname).

### 🟡 MEDIUM — Title regex misses valid titles (cosmetic-ish, but wrong output)

The same regex is case-sensitive and single-line:

- `<TITLE>` / `<Title>` (uppercase) won't match.
- `.` doesn't cross newlines, so a title split across lines is missed.
- `(.*)` is greedy; with two `<title>` tags it spans from the first `<title>` to the last
  `</title>`.
- HTML entities (`&amp;`, `&#39;`) are stored raw.

**Fix:** case-insensitive, non-greedy, newline-tolerant match; trim and decode entities.

### 🟡 MEDIUM — Read-modify-write race on concurrent POSTs

Each POST mutates the shared `links` array and rewrites the whole file. Two overlapping requests
can interleave and lose one of the writes (last-writer-wins). `writeFileSync` is also non-atomic, so
a crash mid-write can corrupt `links.json`.

**Fix:** serialize writes, or move to a store that handles concurrency (a DB). At minimum, write to
a temp file and `rename` for atomicity.

### 🟢 LOW — Minor correctness/consistency nits

- `id: Date.now()` collides if two links are saved within the same millisecond.
- `savedAt: new Date()` is a `Date` in memory but a string after reload — inconsistent types.
- `express.json()` isn't guarded, so a non-JSON body triggers a 400 from the parser with no shape.
- No `Content-Type`/status conventions (`res.json(link)` returns 200 for a creation; 201 is nicer).

## Severity ranking (most to least serious)

1. **CRITICAL** — DELETE wipes all data (inverted filter + type mismatch).
2. **HIGH** — startup crash on missing/invalid `links.json`.
3. **HIGH** — unhandled fetch rejection: hung request / process crash on bad URL, no timeout.
4. **HIGH** — `match(...)[1]` throws when a page has no `<title>`.
5. **MEDIUM** — title regex misses case/multiline/entities.
6. **MEDIUM** — concurrent-write race and non-atomic file write.
7. **LOW** — id collisions, `savedAt` type drift, status-code niceties.

## Corrected code

Kept faithful to the snippet's design (Express + a JSON file) so the diff is reviewable, while
fixing the real bugs. (The actual app in this repo uses SQLite — see the README.)

> **A note on the fix for the concurrency bug.** Serializing only the *write* is not enough: two
> concurrent POSTs can both `loadLinks()` the same stale array, each push their own link, and the
> second write clobbers the first (one link silently lost). The unit that must be serialized is the
> whole **load → modify → persist** cycle. Below, every mutation runs through a single `mutate()`
> queue, so reads always see the previous mutation's result. Errors reject the caller's promise but
> do **not** poison the queue for later requests.

```js
const express = require('express');
const fs = require('fs/promises');
const app = express();
app.use(express.json());

const DB_FILE = 'links.json';
const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 512 * 1024; // cap the response we read (DoS guard)

async function loadLinks() {
  try {
    return JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return []; // fresh start
    throw err; // surface genuinely corrupt files
  }
}

async function persist(links) {
  // Write to a temp file then rename for atomicity (a crash can't leave a half file).
  const tmp = `${DB_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(links, null, 2));
  await fs.rename(tmp, DB_FILE);
}

// Serialize the FULL load-modify-write so concurrent requests can't lose each other's writes.
// The tail is only advanced past errors, so one failed mutation doesn't poison the queue.
let mutationQueue = Promise.resolve();
function mutate(mutator) {
  const run = mutationQueue.then(async () => {
    const links = await loadLinks();
    const result = await mutator(links); // may return { links, value } to persist + return
    if (result && result.links) await persist(result.links);
    return result ? result.value : undefined;
  });
  mutationQueue = run.catch(() => {}); // keep the chain alive after failures
  return run; // caller still sees the real error
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function extractTitle(html, fallback) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return fallback;
  const title = m[1]
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);
  return title || fallback;
}

async function fetchTitle(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const buf = await res.arrayBuffer(); // read once
    const html = Buffer.from(buf).slice(0, MAX_HTML_BYTES).toString('utf8');
    return extractTitle(html, new URL(url).hostname);
  } finally {
    clearTimeout(timer);
  }
}

app.post('/links', async (req, res) => {
  const { url } = req.body ?? {};

  let parsed;
  try {
    parsed = new URL(String(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    return res.status(400).json({ error: 'A valid http(s) URL is required' });
  }

  let title;
  try {
    title = await fetchTitle(parsed.href);
  } catch (err) {
    return res.status(502).json({ error: `Could not fetch page: ${err.message}` });
  }

  const link = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, // collision-resistant
    url: parsed.href,
    title,
    savedAt: new Date().toISOString(), // stable string type
  };

  try {
    await mutate((links) => ({ links: [...links, link], value: link }));
  } catch {
    return res.status(500).json({ error: 'Could not save link' });
  }

  res.status(201).json(link);
});

app.delete('/links/:id', async (req, res) => {
  let removed;
  try {
    removed = await mutate((links) => {
      const next = links.filter((l) => String(l.id) !== req.params.id); // keep non-matching
      return { links: next, value: next.length !== links.length };
    });
  } catch {
    return res.status(500).json({ error: 'Could not delete link' });
  }

  if (!removed) return res.status(404).json({ error: 'Link not found' });
  res.sendStatus(204);
});

app.listen(3000);
```

## Known limitations of the corrected snippet

To keep the fix scoped to the reported bugs (and reviewable against the original), a couple of
production concerns are called out rather than fully solved here — the SQLite app in this repo
addresses them:

- **SSRF.** `fetch(url)` still lets a caller point the server at internal hosts
  (`http://169.254.169.254/`, `http://localhost:…`). A hardened version resolves the host and
  rejects private/loopback/link-local addresses before connecting. The main app does this in
  `lib/fetchTitle.js`.
- **Persistence model.** A rewrite-the-whole-file JSON store is fine for a small take-home but
  won't scale (whole-file writes, no indexing, coarse-grained serialization). The real app uses
  SQLite with parameterized statements.
