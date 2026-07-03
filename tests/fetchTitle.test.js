'use strict';

const { extractTitle, fetchTitle, FetchTitleError } = require('../lib/fetchTitle');

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function htmlResponse(body, contentType = 'text/html; charset=utf-8') {
  return new Response(body, { headers: { 'content-type': contentType } });
}

describe('extractTitle', () => {
  test('extracts the title text', () => {
    expect(extractTitle('<html><head><title>Hello World</title></head></html>')).toBe(
      'Hello World'
    );
  });

  test('is case-insensitive, collapses whitespace, tolerates attributes', () => {
    const html = '<TITLE data-x="1">\n  Spaced  Title \n</TITLE>';
    expect(extractTitle(html)).toBe('Spaced Title');
  });

  test('decodes common HTML entities', () => {
    expect(extractTitle('<title>Tom &amp; Jerry &lt;3</title>')).toBe('Tom & Jerry <3');
  });

  test('leaves an out-of-range numeric entity untouched instead of throwing', () => {
    expect(() => extractTitle('<title>bad &#99999999; ref</title>')).not.toThrow();
    expect(extractTitle('<title>bad &#99999999; ref</title>')).toBe('bad &#99999999; ref');
  });

  test('returns null when there is no title', () => {
    expect(extractTitle('<html><body>no title here</body></html>')).toBeNull();
  });

  test('returns null for an empty title', () => {
    expect(extractTitle('<title>   </title>')).toBeNull();
  });
});

describe('fetchTitle', () => {
  const url = new URL('https://example.com/page');

  test('returns the extracted title on success', async () => {
    const fetchImpl = async () => htmlResponse('<title>Real Title</title>');
    const title = await fetchTitle(url, { fetchImpl, lookup: publicLookup });
    expect(title).toBe('Real Title');
  });

  test('falls back to hostname when the page has no title', async () => {
    const fetchImpl = async () => htmlResponse('<html><body>no title</body></html>');
    const title = await fetchTitle(url, { fetchImpl, lookup: publicLookup });
    expect(title).toBe('example.com');
  });

  test('falls back to hostname for non-html content', async () => {
    const fetchImpl = async () => htmlResponse('{"a":1}', 'application/json');
    const title = await fetchTitle(url, { fetchImpl, lookup: publicLookup });
    expect(title).toBe('example.com');
  });

  test('rejects when the host resolves to a private address (SSRF)', async () => {
    const lookup = async () => [{ address: '127.0.0.1', family: 4 }];
    const fetchImpl = jest.fn();
    await expect(fetchTitle(url, { fetchImpl, lookup })).rejects.toThrow(FetchTitleError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects when DNS resolution fails', async () => {
    const lookup = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(
      fetchTitle(url, { fetchImpl: async () => htmlResponse(''), lookup })
    ).rejects.toThrow(FetchTitleError);
  });

  test('wraps a timeout/abort as FetchTitleError', async () => {
    const fetchImpl = async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };
    await expect(fetchTitle(url, { fetchImpl, lookup: publicLookup })).rejects.toThrow(
      /Timed out/
    );
  });

  test('wraps a generic fetch failure as FetchTitleError', async () => {
    const fetchImpl = async () => {
      throw new Error('connection refused');
    };
    await expect(fetchTitle(url, { fetchImpl, lookup: publicLookup })).rejects.toThrow(
      FetchTitleError
    );
  });
});
