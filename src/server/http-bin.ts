#!/usr/bin/env node
/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { startHttpServer } from './http-server';

const port = process.env['PORT'] ? Number.parseInt(process.env['PORT'], 10) : 3000;

async function main(): Promise<void> {
  if (!Number.isFinite(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid PORT: ${process.env['PORT']}`);
  }
  const running = await startHttpServer(port);
  process.stderr.write(
    `[clinical-reference-mcp] http listening on http://localhost:${running.port}\n`,
  );

  // Graceful shutdown so in-flight HTTP requests complete and the process
  // exits 0 in container orchestrators (Docker, k8s) that send SIGTERM
  // before SIGKILL. SIGINT covers ctrl-c during local development.
  const shutdown = (signal: NodeJS.Signals): void => {
    process.stderr.write(`[clinical-reference-mcp] received ${signal}, shutting down\n`);
    running
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        process.stderr.write(`[clinical-reference-mcp] shutdown error: ${String(err)}\n`);
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  process.stderr.write(`[clinical-reference-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
