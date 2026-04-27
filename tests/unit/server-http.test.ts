/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DISCLAIMER, HTTP_DISCLAIMER_HEADER } from '../../src/lib/safety';
import { VERSION } from '../../src/lib/version';
import type { LookupDrugOutput } from '../../src/lib/types';
import {
  API_NOTE_HEADER,
  API_NOTE_VALUE,
  buildHttpApp,
} from '../../src/server/http';
import { startHttpServer, type RunningHttpServer } from '../../src/server/http-server';
import type * as LookupDrugModule from '../../src/server/tools/lookup-drug';

// Partial mock pattern matches tests/unit/server.test.ts: the handler is
// stubbed so we can assert dispatch and fixture responses without making
// live RxNorm/openFDA calls; the definition stays real so the tool name
// the route looks up still resolves.
vi.mock('../../src/server/tools/lookup-drug', async () => {
  const actual = await vi.importActual<typeof LookupDrugModule>(
    '../../src/server/tools/lookup-drug',
  );
  return { ...actual, lookupDrugHandler: vi.fn() };
});

import { lookupDrugHandler } from '../../src/server/tools/lookup-drug';

const lookupDrugMock = vi.mocked(lookupDrugHandler);

const FAKE_LOOKUP_DRUG_DATA: LookupDrugOutput = {
  rxcui: '1191',
  genericName: 'aspirin',
  brandNames: [],
  activeIngredients: ['aspirin'],
  drugClasses: [],
  disclaimer: DISCLAIMER,
  citation: {
    source: 'rxnorm',
    url: 'https://rxnav.nlm.nih.gov/REST/rxcui/1191/properties.json',
    retrievedAt: '2026-04-26T00:00:00.000Z',
  },
};

beforeEach(() => {
  lookupDrugMock.mockReset();
});

afterEach(() => {
  lookupDrugMock.mockReset();
});

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
    expect(response.headers.get(HTTP_DISCLAIMER_HEADER)).toMatch(/Not for clinical use/);
  });

  it('attaches the disclaimer header to / responses', async () => {
    const app = buildHttpApp();
    const response = await app.fetch(new Request('http://test/'));
    expect(response.headers.get(HTTP_DISCLAIMER_HEADER)).toMatch(/Not for clinical use/);
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
    expect(response.headers.get('access-control-allow-methods')).toMatch(/POST/);
  });

  it('exposes the disclaimer header in CORS exposeHeaders', async () => {
    const app = buildHttpApp();
    const response = await app.fetch(
      new Request('http://test/health', {
        headers: { Origin: 'https://example.com' },
      }),
    );
    expect(response.headers.get('access-control-expose-headers')?.toLowerCase()).toContain(
      HTTP_DISCLAIMER_HEADER.toLowerCase(),
    );
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
    client = new Client({ name: 'http-integration-test', version: '0.0.0' }, { capabilities: {} });
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

describe('POST /api/tool/:name (demo backend)', () => {
  it('dispatches a valid tool name to the matching handler and returns the envelope', async () => {
    lookupDrugMock.mockResolvedValueOnce({ ok: true, data: FAKE_LOOKUP_DRUG_DATA });
    const app = buildHttpApp();
    const response = await app.fetch(
      new Request('http://test/api/tool/lookup_drug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'aspirin' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(lookupDrugMock).toHaveBeenCalledWith({ name: 'aspirin' });
    const body = await response.json();
    expect(body).toEqual({ ok: true, data: FAKE_LOOKUP_DRUG_DATA });
  });

  it('passes through tool-level INVALID_INPUT as a 200 with ok:false envelope', async () => {
    // Domain-level errors from the handler are not HTTP failures — the
    // request succeeded and got a structured response. Mirrors how /mcp
    // wraps tool errors as `isError: true` content rather than throwing.
    lookupDrugMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'name is required' },
      disclaimer: DISCLAIMER,
    });
    const app = buildHttpApp();
    const response = await app.fetch(
      new Request('http://test/api/tool/lookup_drug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
      disclaimer: DISCLAIMER,
    });
  });

  it('returns 400 + INVALID_INPUT envelope when the body is not valid JSON', async () => {
    const app = buildHttpApp();
    const response = await app.fetch(
      new Request('http://test/api/tool/lookup_drug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json-at-all',
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
      disclaimer: DISCLAIMER,
    });
    expect(lookupDrugMock).not.toHaveBeenCalled();
  });

  it('returns 404 + INVALID_INPUT envelope with validTools details for an unknown tool', async () => {
    const app = buildHttpApp();
    const response = await app.fetch(
      new Request('http://test/api/tool/no_such_tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string; details: { validTools: string[] } };
      disclaimer: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toContain("Unknown tool name: 'no_such_tool'");
    expect(body.error.details.validTools).toEqual([
      'lookup_drug',
      'get_drug_label',
      'check_interactions',
      'find_alternatives',
      'lookup_adverse_events',
      'get_dosing_reference',
    ]);
    expect(body.disclaimer).toBe(DISCLAIMER);
    expect(lookupDrugMock).not.toHaveBeenCalled();
  });

  it('attaches the disclaimer header to /api/tool responses', async () => {
    lookupDrugMock.mockResolvedValueOnce({ ok: true, data: FAKE_LOOKUP_DRUG_DATA });
    const app = buildHttpApp();
    const response = await app.fetch(
      new Request('http://test/api/tool/lookup_drug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'aspirin' }),
      }),
    );
    expect(response.headers.get(HTTP_DISCLAIMER_HEADER)).toMatch(/Not for clinical use/);
  });

  it('attaches the X-API-Note demo-backend header to /api/tool responses', async () => {
    lookupDrugMock.mockResolvedValueOnce({ ok: true, data: FAKE_LOOKUP_DRUG_DATA });
    const app = buildHttpApp();
    const response = await app.fetch(
      new Request('http://test/api/tool/lookup_drug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'aspirin' }),
      }),
    );
    expect(response.headers.get(API_NOTE_HEADER)).toBe(API_NOTE_VALUE);
  });

  it('attaches the X-API-Note header even on the unknown-tool 404', async () => {
    // The header signals "this is the demo backend" and should be visible
    // on every /api/* response — including the routing-level errors.
    const app = buildHttpApp();
    const response = await app.fetch(
      new Request('http://test/api/tool/no_such_tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(response.headers.get(API_NOTE_HEADER)).toBe(API_NOTE_VALUE);
  });

  it('does not attach the X-API-Note header to non-/api routes', async () => {
    // Marker is route-prefix scoped; MCP clients hitting /mcp or /health
    // should not see a header that doesn't apply to them.
    const app = buildHttpApp();
    const response = await app.fetch(new Request('http://test/health'));
    expect(response.headers.get(API_NOTE_HEADER)).toBeNull();
  });

  it('exposes X-API-Note in CORS exposeHeaders', async () => {
    const app = buildHttpApp();
    const response = await app.fetch(
      new Request('http://test/health', {
        headers: { Origin: 'https://example.com' },
      }),
    );
    expect(response.headers.get('access-control-expose-headers')?.toLowerCase()).toContain(
      API_NOTE_HEADER.toLowerCase(),
    );
  });
});
