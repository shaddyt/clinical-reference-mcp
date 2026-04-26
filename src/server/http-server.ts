/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { serve } from '@hono/node-server';

import { buildHttpApp } from './http';

export interface RunningHttpServer {
  port: number;
  close: () => Promise<void>;
}

// Node-specific listener for the Hono app. Lives in its own file so
// `http.ts` can be imported by runtimes (Cloudflare Workers, Deno) that
// don't have `@hono/node-server` available.
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
