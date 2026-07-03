'use strict';

const { validateUrl, isPrivateAddress, BadUrlError } = require('../lib/url');

describe('validateUrl', () => {
  test('accepts a normal http(s) url and returns a URL object', () => {
    const url = validateUrl('https://example.com/page');
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe('example.com');
  });

  test('trims surrounding whitespace', () => {
    expect(validateUrl('  https://example.com  ').href).toBe('https://example.com/');
  });

  test.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['not a url', 'not a url'],
    ['missing scheme', 'example.com'],
    ['ftp scheme', 'ftp://example.com'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['file scheme', 'file:///etc/passwd'],
    ['overly long url', `https://example.com/${'a'.repeat(2100)}`],
  ])('rejects %s with BadUrlError', (_label, input) => {
    expect(() => validateUrl(input)).toThrow(BadUrlError);
  });
});

describe('isPrivateAddress', () => {
  test.each([
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
  ])('flags %s as private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  test.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2001:4860:4860::8888'])(
    'treats %s as public',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  );

  test('flags an IPv4-mapped private address', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
  });

  test('treats a non-IP string as unsafe', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});
