# Link Saver

Paste a URL, and the app fetches the page's real `<title>` for you, timestamps it, and stores it.
List, favourite, filter, and delete saved links. Data is persisted in SQLite, so it survives a
restart.

## Stack & why

- **Node + Express** for a tiny REST API — zero ceremony, and the brief's Part B is Express, so it
  keeps both parts in one mental model.
- **SQLite via the built-in `node:sqlite`** for persistence. I wanted a real database (durable,
  queryable, handles concurrent writes) without the file-race problems of the JSON-file approach in
  Part B. I originally reached for `better-sqlite3`, but this environment has no C toolchain to
  compile the native addon, so I switched to Node 22.5+'s built-in `node:sqlite` — same synchronous
  prepared-statement API, **no build step, no extra dependency**.
- **Vanilla HTML/CSS/JS** frontend — a single page doesn't need a framework, and it keeps the
  payload tiny.

**If it had to grow:** I'd extract the store behind a repository interface (swap SQLite for Postgres
without touching routes), add a validation layer (e.g. Zod) at the HTTP boundary, split routes into
their own module, and put the title-fetching behind a job/queue so slow pages don't block requests.

## Requirements

- **Node 22.5 or newer** (needs the built-in `node:sqlite` module). Tested on Node 24.

## Run it

```bash
npm install          # installs express, jest, supertest (no native builds)
npm start            # serves http://localhost:3000
```

Then open <http://localhost:3000>, paste a URL, and hit **Save**.

Config via env vars (all optional — see `.env.example`):

| Var                | Default             | Purpose                          |
| ------------------ | ------------------- | -------------------------------- |
| `PORT`             | `3000`              | HTTP port                        |
| `DB_PATH`          | `./data/links.db`   | SQLite file location             |
| `FETCH_TIMEOUT_MS` | `5000`              | Title-fetch timeout              |

## Test

```bash
npm test             # jest, run in-band
```

55 tests across the store, URL validation, title extraction, and the HTTP API. Coverage thresholds
are enforced at 80% (statements/lines/functions/branches) in `package.json`.

## API

| Method   | Path                 | Body                  | Notes                                    |
| -------- | -------------------- | --------------------- | ---------------------------------------- |
| `POST`   | `/links`             | `{ "url": "..." }`    | Fetches title, saves. `400` bad URL, `502` unfetchable |
| `GET`    | `/links`             | —                     | `?favourite=1` filters to favourites     |
| `DELETE` | `/links/:id`         | —                     | `204` on success, `404` if missing       |
| `PATCH`  | `/links/:id`         | `{ "favourite": bool }` | Toggle favourite; `404` if missing     |

Responses use a consistent envelope: `{ success, data }` or `{ success: false, error }`.

## The favourite feature — files touched

Marking a link as a favourite and filtering to favourites-only touched:

- **`db.js`** — `favourite` column (default 0), `setFavourite()`, and a `list({ favourite })` filter.
- **`app.js`** — `PATCH /links/:id` route and the `?favourite=1` query on `GET /links`.
- **`public/index.html`** — the "Favourites only" checkbox and per-row star button markup.
- **`public/app.js`** — star toggle (`toggleFavourite`) and wiring the filter checkbox to reload.
- **`public/styles.css`** — star + filter styling.
- **`tests/api.test.js`, `tests/db.test.js`** — coverage for the toggle and filter.

## Assumptions & decisions

- **Title on the server, not the client.** The user never types a title; the server fetches the page
  and parses `<title>`. If a page has no usable title (missing tag, non-HTML content), it falls back
  to the hostname rather than failing the save.
- **SSRF guard.** Since the server fetches arbitrary user-supplied URLs, I resolve the hostname and
  refuse private/loopback/link-local addresses (e.g. `http://127.0.0.1`, `169.254.169.254`). Only
  `http`/`https` schemes are accepted. Bad URLs → `400`, unfetchable/blocked → `502`.
- **URL normalization.** Stored as the parsed `href` (so `example.com` is rejected — scheme
  required — and `https://example.com` normalizes to `https://example.com/`).
- **Newest-first ordering** by saved time.

## Deliberately left out (and why)

- **No auth / multi-user.** Single-user local tool; out of scope for the timebox.
- **No edit endpoint.** The brief only asks for save/list/delete/favourite.
- **Redirect re-validation.** The SSRF check runs on the initial host; a server that redirects to a
  private address after the first hop isn't re-checked. Noted as a known gap — I'd re-validate each
  hop (or use a custom agent) if this were exposed publicly.
- **No pagination.** Fine for a personal list; I'd add `LIMIT/OFFSET` before it grows large.
- **Browser click-through not automated.** The API is covered end-to-end and I smoke-tested the
  running server with curl (real title fetch, bad URL, SSRF, list). I did **not** run an automated
  browser test of the UI in this environment.

## What I'd improve with more time

- Repository interface + Zod validation at the boundary.
- Playwright E2E for the UI (save → appears → favourite → filter → delete).
- Optimistic UI updates instead of a full reload after each mutation.
- Per-hop SSRF re-validation and a response-size cap already in place made stricter.

## Key AI prompts

The 2–3 prompts that did the most work:

1. *"Build a Link Saver: Express + SQLite. `POST /links` validates the URL, fetches the page title
   server-side with a timeout and an SSRF guard (block private/loopback IPs, http/https only),
   falls back to hostname when there's no `<title>`. Plus `GET /links?favourite=1`,
   `DELETE /links/:id`, `PATCH /links/:id`. Inject the db and the title-fetcher so I can unit-test
   without hitting the network."*
2. *"Write Jest + supertest tests first (TDD). Cover the happy path, a missing/bad URL, an
   unfetchable page, the favourite toggle and filter, delete-missing → 404. Add unit tests for the
   SSRF IP classifier and the `<title>` extractor (entities, uppercase, no-title fallback)."*
3. *"Review this hand-written `server.js` as a code review. Find the destructive bugs first, explain
   what input breaks each and rank by severity, then give corrected code that stays faithful to the
   Express-plus-JSON-file design."* (Part B / `REVIEW.md`.)

## If I could have asked you questions first

I'd have asked: (1) should the SSRF/private-URL guard be in scope, or is this a trusted local tool
where fetching `localhost` is fine? (2) Is a favourite a per-link boolean (what I built) or a
separate collection? (3) Do you want the title re-fetched/refreshed over time, or captured once at
save? (4) Any expectation around auth or multi-user, or is single-user assumed?
