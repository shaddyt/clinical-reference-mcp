/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HTTP_DISCLAIMER_HEADER } from '../../src/lib/safety';
import { VERSION } from '../../src/lib/version';
import {
  buildHttpApp,
  startHttpServer,
  type RunningHttpServer,
} from '../../src/server/http';

describe('buildHttpApp', () => {
  it('returns a Hono instance', () => {
    expect(buildHttpApp()).toBeInstanceOf(Hono);
  });

  it('serves the landing page as HTML on GET /', async () => {
    const app = buildHttpApp();
    const response = await app.fetch(new Request('http://test/'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    const body = await response.text();
    expect(body).toContain('clinical-reference-mcp');
    expect(body).toContain('POST /mcp');
    expect(body).toContain('GET /health');
  });

  it('serves /health with the expected JSON shape', async () => {
    const app = buildHttpApp();
    const response = await app.fetch(new Request('http://test/health'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      version: VERSION,
      sources: ['openFDA', 'RxNorm', 'RxNav'],
    });
  });

  it('attaches the disclaimer header to /health responses', async () => {
    const app = buildHttpApp();
    const response = await app.fetch(new Request('http://test/health'));
    expect(response.headers.get(HTTP_DISCLAIMER_HEADER)).toMatch(
      /Not for clinical use/,
    );
  });

  it('attaches the disclaimer header to / responses', async () => {
    const app = buildHttpApp();
    const response = await app.fetch(new Request('http://test/'));
    expect(response.headers.get(HTTP_DISCLAIMER_HEADER)).toMatch(
      /Not for clinical use/,
    );
  });

  it('responds to CORS preflight on /mcp', async () => {
    const app = buildHttpApp();
    const response = await app.fetch(
      new Request('http://test/mcp', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      }),
    );
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toMatch(
      /POST/,
    );
  });

  it('exposes the disclaimer header in CORS exposeHeaders', async () => {
    const app = buildHttpApp();
    const response = await app.fetch(
      new Request('http://test/health', {
        headers: { Origin: 'https://example.com' },
      }),
    );
    expect(
      response.headers.get('access-control-expose-headers')?.toLowerCase(),
    ).toContain(HTTP_DISCLAIMER_HEADER.toLowerCase());
  });
});

describe('startHttpServer + /mcp end-to-end', () => {
  let running: RunningHttpServer;
  let client: Client;

  beforeAll(async () => {
    // Port 0 lets the OS pick a free port — keeps parallel test runs from
    // racing on a shared port.
    running = await startHttpServer(0);
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${running.port}/mcp`),
    );
    client = new Client(
      { name: 'http-integration-test', version: '0.0.0' },
      { capabilities: {} },
    );
    // SDK's StreamableHTTPClientTransport exposes sessionId as a getter
    // typed `string | undefined`, while Transport declares `sessionId?:
    // string`. Under exactOptionalPropertyTypes the shapes diverge even
    // though the SDK's own examples use them interchangeably. A single
    // boundary cast pins the call to the documented Transport contract.
    await client.connect(transport as Transport);
  }, 10_000);

  afterAll(async () => {
    await client.close();
    await running.close();
  });

  it('lists the 6 tools through a real Streamable HTTP roundtrip', async () => {
    const result = await client.listTools();
    expect(result.tools.map((t) => t.name)).toEqual([
      'lookup_drug',
      'get_drug_label',
      'check_interactions',
      'find_alternatives',
      'lookup_adverse_events',
      'get_dosing_reference',
    ]);
  });
});
