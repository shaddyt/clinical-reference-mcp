/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { serve } from '@hono/node-server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { DISCLAIMER, HTTP_DISCLAIMER_HEADER } from '../lib/safety';
import { VERSION } from '../lib/version';
import { buildServer } from './server';

const HEALTH_SOURCES = ['openFDA', 'RxNorm', 'RxNav'] as const;

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
      allowHeaders: [
        'Content-Type',
        'mcp-session-id',
        'Last-Event-ID',
        'mcp-protocol-version',
      ],
      exposeHeaders: [
        'mcp-session-id',
        'mcp-protocol-version',
        HTTP_DISCLAIMER_HEADER,
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

export interface RunningHttpServer {
  port: number;
  close: () => Promise<void>;
}

export function startHttpServer(port = 3000): Promise<RunningHttpServer> {
  const app = buildHttpApp();
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      resolve({
        port: info.port,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => {
              if (err) rejectClose(err);
              else resolveClose();
            });
          }),
      });
    });
    server.on('error', reject);
  });
}
