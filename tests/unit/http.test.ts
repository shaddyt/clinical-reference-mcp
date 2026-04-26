/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchJson } from '../../src/lib/http';
import { VERSION } from '../../src/lib/version';

const URL = 'https://api.example.com/thing';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchJson — success paths', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns parsed JSON, status, and headers on 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { hello: 'world' }));

    const result = await fetchJson(URL);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ hello: 'world' });
      expect(result.status).toBe(200);
      expect(result.headers).toBeInstanceOf(Headers);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sets a project-identifying User-Agent header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

    await fetchJson(URL);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    const ua = headers.get('user-agent');
    expect(ua).toContain('clinical-reference-mcp');
    expect(ua).toContain(VERSION);
    expect(ua).toContain('https://github.com/shaddyt/clinical-reference-mcp');
  });

  it('preserves caller-supplied headers but never overrides User-Agent', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

    await fetchJson(URL, {
      headers: {
        'X-Custom': 'yes',
        'User-Agent': 'evil-overwrite/0',
      },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get('x-custom')).toBe('yes');
    expect(headers.get('user-agent')).toContain('clinical-reference-mcp');
    expect(headers.get('user-agent')).not.toContain('evil-overwrite');
  });
});

describe('fetchJson — client error mapping (no retry)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('maps 404 to DATA_NOT_FOUND without retrying', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'nope' }));

    const result = await fetchJson(URL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DATA_NOT_FOUND');
      expect(result.error.retryable).toBeFalsy();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 429 to UPSTREAM_ERROR with retryable:true and does not retry internally', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, {}));

    const result = await fetchJson(URL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UPSTREAM_ERROR');
      expect(result.error.retryable).toBe(true);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps other 4xx to UPSTREAM_ERROR with retryable:false', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, {}));

    const result = await fetchJson(URL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UPSTREAM_ERROR');
      expect(result.error.retryable).toBe(false);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchJson — server error retries', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('retries 5xx three times then returns retryable upstream error', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(500, {}));

    const promise = fetchJson(URL);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UPSTREAM_ERROR');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('retries 503 and succeeds when an attempt finally returns 200', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 1 }));

    const promise = fetchJson(URL);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ ok: 1 });
  });

  it('uses exponential backoff between attempts (250ms, 500ms, 1000ms)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));

    const promise = fetchJson(URL);

    // Attempt 1 happens synchronously.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 250ms before attempt 2.
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 500ms before attempt 3.
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // 1000ms before attempt 4.
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await vi.runAllTimersAsync();
    await promise;
  });
});

describe('fetchJson — network failures', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('retries on network errors and returns retryable error after exhaustion', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const promise = fetchJson(URL);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UPSTREAM_ERROR');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('aborts on the configured timeout and reports a retryable error', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });

    const promise = fetchJson(URL, { timeoutMs: 5000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UPSTREAM_ERROR');
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe('fetchJson — malformed JSON', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('treats unparseable 200 bodies as upstream errors', async () => {
    fetchMock.mockResolvedValue(
      new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const promise = fetchJson(URL);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UPSTREAM_ERROR');
  });
});
