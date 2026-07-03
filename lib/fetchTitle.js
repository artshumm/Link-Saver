'use strict';

const dns = require('node:dns').promises;
const { isPrivateAddress } = require('./url');

/** Thrown when a page title cannot be retrieved (network, SSRF, or timeout). */
class FetchTitleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FetchTitleError';
  }
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 512 * 1024; // Only the <head> matters; cap the read.

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * Extracts and cleans the <title> text from an HTML string.
 *
 * @param {string} html
 * @returns {string|null} The trimmed title, or null when absent/empty.
 */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return null;
  }

  const decoded = match[1]
    .replace(/&#(\d+);/g, (m, code) => codePoint(Number(code), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, code) => codePoint(parseInt(code, 16), m))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/gi, (m) => ENTITIES[m.toLowerCase()] ?? ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();

  return decoded === '' ? null : decoded;
}

/**
 * Safely converts a numeric character reference to a string, leaving the raw
 * entity in place when the code point is out of range.
 *
 * @param {number} code
 * @param {string} raw The original entity, returned verbatim on failure.
 * @returns {string}
 */
function codePoint(code, raw) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return raw;
  }
}

/**
 * Ensures none of a hostname's resolved addresses point at a private range.
 *
 * @param {string} hostname
 * @param {typeof dns.lookup} [lookup]
 */
async function assertPublicHost(hostname, lookup = dns.lookup) {
  let records;
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new FetchTitleError(`Could not resolve host: ${hostname}`);
  }

  if (records.some((r) => isPrivateAddress(r.address))) {
    throw new FetchTitleError('Refusing to fetch a private or local address');
  }
}

/**
 * Fetches a page and returns its title, falling back to the hostname when the
 * page has no usable <title>.
 *
 * @param {URL} url A URL already validated by validateUrl().
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch, lookup?: typeof dns.lookup }} [options]
 * @returns {Promise<string>}
 * @throws {FetchTitleError}
 */
async function fetchTitle(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
    lookup = dns.lookup,
  } = options;

  await assertPublicHost(url.hostname, lookup);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url.href, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'LinkSaver/1.0 (+title-fetch)' },
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return url.hostname;
    }

    const html = await readCapped(res, MAX_HTML_BYTES);
    return extractTitle(html) ?? url.hostname;
  } catch (error) {
    if (error instanceof FetchTitleError) {
      throw error;
    }
    if (error.name === 'AbortError') {
      throw new FetchTitleError(`Timed out fetching ${url.hostname}`);
    }
    throw new FetchTitleError(`Could not fetch ${url.hostname}: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads a fetch Response body up to a byte cap, decoding as UTF-8.
 *
 * @param {Response} res
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
async function readCapped(res, maxBytes) {
  if (!res.body) {
    return '';
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {}); // best-effort; body already consumed
  }

  return Buffer.concat(chunks).toString('utf8');
}

module.exports = { fetchTitle, extractTitle, FetchTitleError };
