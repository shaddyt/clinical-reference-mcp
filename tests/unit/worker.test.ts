/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { HTTP_DISCLAIMER_HEADER } from '../../src/lib/safety';
import worker from '../../src/server/worker';

describe('cloudflare worker entry', () => {
  it('exposes a fetch handler that serves /health with the disclaimer header', async () => {
    const response = await worker.fetch(new Request('http://worker/health'));
    expect(response.status).toBe(200);
    expect(response.headers.get(HTTP_DISCLAIMER_HEADER)).toMatch(/Not for clinical use/);
    expect(await response.json()).toMatchObject({
      ok: true,
      sources: ['openFDA', 'RxNorm', 'RxNav'],
    });
  });

  it('serves the landing page on GET /', async () => {
    const response = await worker.fetch(new Request('http://worker/'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
  });
});
