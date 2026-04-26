/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolError } from './types';
import { VERSION } from './version';

// All upstream traffic flows through this single chokepoint. Centralizing
// fetch keeps mocking trivial in tests, makes the User-Agent identifiable
// to upstream operators (openFDA, NLM), and ensures retries and timeouts
// are applied uniformly across every client.
const USER_AGENT = `clinical-reference-mcp/${VERSION} (+https://github.com/shaddyt/clinical-reference-mcp)`;

// 10s caps the worst-case wait per attempt. With 4 attempts and worst-case
// backoffs (250 + 500 + 1000), a fully-failed call is bounded at ~41.75s.
const DEFAULT_TIMEOUT_MS = 10_000;

// Exponential backoff between retries. Three backoff values means up to
// three retries (four attempts total). Chosen to be aggressive enough to
// recover from transient blips without amplifying upstream load.
const BACKOFFS_MS: readonly number[] = [250, 500, 1000];

export interface FetchJsonOptions extends RequestInit {
  timeoutMs?: number;
}

export interface HttpSuccess {
  ok: true;
  data: unknown;
  status: number;
  headers: Headers;
}

export interface HttpFailure {
  ok: false;
  error: ToolError;
}

export type HttpResult = HttpSuccess | HttpFailure;

export async function fetchJson(
  url: string,
  options?: FetchJsonOptions,
): Promise<HttpResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastFailure: HttpFailure = networkFailure(
    'Upstream call exhausted retries',
  );

  for (let attempt = 0; attempt <= BACKOFFS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = BACKOFFS_MS[attempt - 1];
      if (delay === undefined) break;
      await sleep(delay);
    }

    const outcome = await attemptOnce(url, options, timeoutMs);

    if (outcome.kind === 'success') return outcome.envelope;
    if (outcome.kind === 'terminal') return outcome.envelope;

    lastFailure = outcome.envelope;
  }

  return lastFailure;
}

type Outcome =
  | { kind: 'success'; envelope: HttpSuccess }
  | { kind: 'terminal'; envelope: HttpFailure }
  | { kind: 'transient'; envelope: HttpFailure };

async function attemptOnce(
  url: string,
  options: FetchJsonOptions | undefined,
  timeoutMs: number,
): Promise<Outcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const headers = new Headers(options?.headers);
  // Always set our UA last so a caller cannot suppress identification.
  headers.set('User-Agent', USER_AGENT);

  let resp: Response;
  try {
    resp = await fetch(url, {
      ...options,
      headers,
      signal: ctrl.signal,
    });
  } catch {
    clearTimeout(timer);
    return {
      kind: 'transient',
      envelope: networkFailure('Network error or timeout reaching upstream'),
    };
  }
  clearTimeout(timer);

  if (resp.status === 404) {
    return {
      kind: 'terminal',
      envelope: {
        ok: false,
        error: { code: 'DATA_NOT_FOUND', message: `Not found at ${url}` },
      },
    };
  }

  if (resp.status === 429) {
    return {
      kind: 'terminal',
      envelope: {
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: 'Upstream rate-limited the request (429)',
          retryable: true,
        },
      },
    };
  }

  if (resp.status >= 400 && resp.status < 500) {
    return {
      kind: 'terminal',
      envelope: {
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: `Upstream rejected the request with ${resp.status}`,
          retryable: false,
        },
      },
    };
  }

  if (resp.status >= 500) {
    return {
      kind: 'transient',
      envelope: {
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: `Upstream returned ${resp.status}`,
          retryable: true,
        },
      },
    };
  }

  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    return {
      kind: 'terminal',
      envelope: {
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: 'Upstream returned malformed JSON',
          retryable: false,
        },
      },
    };
  }

  return {
    kind: 'success',
    envelope: { ok: true, data, status: resp.status, headers: resp.headers },
  };
}

function networkFailure(message: string): HttpFailure {
  return {
    ok: false,
    error: { code: 'UPSTREAM_ERROR', message, retryable: true },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
