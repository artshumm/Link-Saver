'use strict';

const net = require('node:net');

/** Thrown when user-supplied input is not a usable http(s) URL. */
class BadUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadUrlError';
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_URL_LENGTH = 2048; // RFC 3986 practical limit; bounds resource use.

/**
 * Parses and validates a user-supplied URL.
 *
 * @param {unknown} raw
 * @returns {URL}
 * @throws {BadUrlError} when the value is not a parseable http(s) URL.
 */
function validateUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BadUrlError('URL is required');
  }

  const trimmed = raw.trim();
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new BadUrlError('URL is too long');
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BadUrlError('URL is not valid');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BadUrlError('Only http and https URLs are supported');
  }

  return url;
}

/**
 * Reports whether an IP address is loopback, private, link-local, or otherwise
 * not safe to fetch (SSRF guard). Unknown/invalid input is treated as unsafe.
 *
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateAddress(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    return isPrivateIPv4(ip);
  }
  if (kind === 6) {
    return isPrivateIPv6(ip);
  }
  return true;
}

/** @param {string} ip */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  const [a, b] = parts;

  if (a === 0) return true; // 0.0.0.0/8 (includes unspecified)
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/** @param {string} ip */
function isPrivateIPv6(ip) {
  const addr = ip.toLowerCase();

  // IPv4-mapped (::ffff:1.2.3.4) — defer to the embedded IPv4 check.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return isPrivateIPv4(mapped[1]);
  }

  if (addr === '::' || addr === '::1') return true; // unspecified / loopback
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // fc00::/7 ULA
  if (addr.startsWith('fe8') || addr.startsWith('fe9') ||
      addr.startsWith('fea') || addr.startsWith('feb')) return true; // fe80::/10 link-local
  if (addr.startsWith('fec') || addr.startsWith('fed') ||
      addr.startsWith('fee') || addr.startsWith('fef')) return true; // fec0::/10 site-local (deprecated)
  if (addr.startsWith('ff')) return true; // ff00::/8 multicast
  return false;
}

module.exports = { validateUrl, isPrivateAddress, BadUrlError };
