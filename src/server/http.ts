/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { DISCLAIMER, HTTP_DISCLAIMER_HEADER } from '../lib/safety';
import { VERSION } from '../lib/version';
import { buildServer } from './server';
import {
  TOOL_NAMES,
  dispatchTool,
  isToolName,
} from './tools/registry';

const HEALTH_SOURCES = ['openFDA', 'RxNorm', 'RxNav'] as const;

// Marker on every /api/tool/:name response so anyone discovering the route
// (curl, Postman, copy-pasted demo URL) knows it isn't part of the MCP spec
// and shouldn't be relied on by MCP clients. The MCP-compliant entry point
// is POST /mcp; this route exists to back the in-browser interactive demo.
export const API_NOTE_HEADER = 'X-API-Note';
export const API_NOTE_VALUE = 'demo-backend; not-part-of-mcp-spec';

// Single-screen developer landing page. Intentionally minimal: explains
// what the service is, how to connect, surfaces the disclaimer, and links
// to the source. No marketing copy, no analytics, no CDN — this page is
// served directly from the same process as the MCP endpoint.
const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>clinical-reference-mcp</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1rem; color: #222; }
  h1 { margin-bottom: 0.25rem; }
  h2 { margin-top: 2rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
  code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
  .disclaimer { background: #fff8e1; border-left: 3px solid #ffb300; padding: 0.75rem 1rem; }
  a { color: #0366d6; }
</style>
</head>
<body>
<h1>clinical-reference-mcp</h1>
<p>MCP server exposing drug, prescription, and pharmacology reference tools sourced from openFDA, RxNorm, and RxNav.</p>
<h2>Connect</h2>
<p>Streamable HTTP MCP endpoint: <code>POST /mcp</code></p>
<p>Health check: <code>GET /health</code></p>
<h2>Disclaimer</h2>
<p class="disclaimer">${DISCLAIMER}</p>
<p><a href="https://github.com/shaddyt/clinical-reference-mcp">github.com/shaddyt/clinical-reference-mcp</a> &middot; v${VERSION}</p>
</body>
</html>`;

export function buildHttpApp(): Hono {
  const app = new Hono();

  // CORS — the entire surface is regulator-published public data behind
  // documented disclaimers, so we permit any origin. The headers list
  // matches what MCP's Streamable HTTP transport sends; exposing the
  // disclaimer header keeps it visible to browser clients reading via
  // fetch().
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'mcp-session-id', 'Last-Event-ID', 'mcp-protocol-version'],
      exposeHeaders: [
        'mcp-session-id', // MCP protocol session continuity
        'mcp-protocol-version', // MCP protocol version negotiation
        HTTP_DISCLAIMER_HEADER, // Disclaimer text on every response
        API_NOTE_HEADER, // Demo-backend signaling on /api/tool routes
      ],
    }),
  );

  // The disclaimer header is added on every response — including responses
  // from the MCP transport. Setting it via c.header() before next() makes
  // Hono merge it into whichever Response the downstream handler returns,
  // even when that handler returns a Response object directly.
  app.use('*', async (c, next) => {
    c.header(HTTP_DISCLAIMER_HEADER, DISCLAIMER);
    await next();
  });

  app.get('/', (c) => c.html(LANDING_HTML));

  app.get('/health', (c) =>
    c.json({
      ok: true,
      version: VERSION,
      sources: HEALTH_SOURCES,
    }),
  );

  // Stamp every /api/* response with the demo-backend marker. Set as a
  // route-prefix middleware (not on the global '*' chain) so MCP clients
  // hitting /mcp don't see a header that doesn't apply to them.
  app.use('/api/*', async (c, next) => {
    c.header(API_NOTE_HEADER, API_NOTE_VALUE);
    await next();
  });

  // POST /api/tool/:name — thin HTTP wrapper around dispatchTool() so the
  // in-browser demo at GET / can invoke tools without speaking JSON-RPC.
  // Not part of the MCP spec; the X-API-Note header announces that on every
  // response. Reuses the same handler registry as /mcp, so behavior never
  // diverges between the two surfaces.
  app.post('/api/tool/:name', async (c) => {
    const name = c.req.param('name');

    if (!isToolName(name)) {
      // Unknown tool names are routing-level INVALID_INPUT — the URL param
      // is technically input, and 404 carries the routing semantic. The
      // structured `details.validTools` list lets a client UI render
      // "did you mean...?" without re-parsing the message string.
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_INPUT' as const,
            message: `Unknown tool name: '${name}'. Valid tools: ${TOOL_NAMES.join(', ')}.`,
            details: { validTools: [...TOOL_NAMES] },
          },
          disclaimer: DISCLAIMER,
        },
        404,
      );
    }

    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_INPUT' as const,
            message:
              'Request body must be a JSON object matching the tool input schema.',
          },
          disclaimer: DISCLAIMER,
        },
        400,
      );
    }

    // Dispatch returns the raw envelope. Tool-level errors (validation
    // failures, DATA_NOT_FOUND, AMBIGUOUS_QUERY, UPSTREAM_ERROR) come back
    // as ok:false with a 200 — the HTTP request itself succeeded; the
    // domain returned a structured error. Mirrors how /mcp wraps tool
    // errors as `isError: true` content rather than HTTP failures.
    const result = await dispatchTool(name, input);
    return c.json(result);
  });

  // Stateless mode — each request gets a fresh transport + server. This is
  // the pattern the SDK's own Hono example documents and lets us redeploy
  // anywhere with no shared in-memory state. The trade-off is that
  // long-running MCP sessions across multiple HTTP calls are not supported
  // here; clients that need them should use the stdio transport.
  app.all('/mcp', async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = buildServer();
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
