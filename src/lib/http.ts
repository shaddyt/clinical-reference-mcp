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

  // Initial sentinel: only ever returned if every attempt produces a
  // transient failure (overwritten below). networkFailure encodes the
  // upstream label from the URL, so the eventual user-facing message
  // names openFDA / RxNav, not raw infrastructure text.
  let lastFailure: HttpFailure = networkFailure(url);

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

// User-facing error messages must NEVER include the raw URL or HTTP
// status. Healthcare AI engineers evaluating the tool see "DATA_NOT_FOUND
// at api.fda.gov/drug/event.json?search=patient.drug.openfda.rxcui%3A..."
// as plumbing leakage, not a clinical-domain message. The URL and status
// move into error.details for engineers debugging; the message stays in
// clinical-domain language.
type UpstreamLabel = 'openFDA' | 'RxNav' | 'unknown';

function upstreamLabel(url: string): UpstreamLabel {
  // Defensive parse: a malformed URL string at this layer means a
  // programmer error elsewhere; default to 'unknown' rather than throwing.
  try {
    const host = new URL(url).host;
    if (host.endsWith('api.fda.gov')) return 'openFDA';
    if (host.endsWith('rxnav.nlm.nih.gov')) return 'RxNav';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function upstreamDetails(
  url: string,
  status: number,
): Record<string, unknown> {
  return {
    upstream: upstreamLabel(url),
    upstreamUrl: url,
    upstreamStatus: status,
  };
}

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
      envelope: networkFailure(url),
    };
  }
  clearTimeout(timer);

  const upstream = upstreamLabel(url);

  if (resp.status === 404) {
    return {
      kind: 'terminal',
      envelope: {
        ok: false,
        error: {
          code: 'DATA_NOT_FOUND',
          message: `No matching records found in ${upstream}`,
          details: upstreamDetails(url, resp.status),
        },
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
          message: `Upstream service ${upstream} rate-limited the request`,
          retryable: true,
          details: upstreamDetails(url, resp.status),
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
          message: `Upstream service ${upstream} rejected the request`,
          retryable: false,
          details: upstreamDetails(url, resp.status),
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
          message: `Upstream service ${upstream} returned an error`,
          retryable: true,
          details: upstreamDetails(url, resp.status),
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
          message: `Upstream service ${upstream} returned malformed JSON`,
          retryable: false,
          details: upstreamDetails(url, resp.status),
        },
      },
    };
  }

  return {
    kind: 'success',
    envelope: { ok: true, data, status: resp.status, headers: resp.headers },
  };
}

function networkFailure(url: string): HttpFailure {
  const upstream = upstreamLabel(url);
  return {
    ok: false,
    error: {
      code: 'UPSTREAM_ERROR',
      message: `Could not reach upstream service ${upstream}`,
      retryable: true,
      // upstreamStatus omitted -- the request never produced one.
      details: { upstream, upstreamUrl: url },
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
