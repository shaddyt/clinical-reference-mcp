#!/usr/bin/env node
/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { buildServer } from './server';

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  // stdout is reserved for the JSON-RPC frames the protocol expects; any
  // log line on stdout would corrupt the stream. Errors go to stderr only,
  // and we exit non-zero so the parent process (Claude Desktop, CI, etc.)
  // can surface the failure.
  process.stderr.write(`[clinical-reference-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
