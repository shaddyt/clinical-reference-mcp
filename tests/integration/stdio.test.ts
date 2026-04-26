/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Spawns the stdio bin as a child process via tsx (runs the TS source
// directly so we don't need a build step in tests). The MCP Client opens a
// real JSON-RPC channel over the child's stdin/stdout; if the bin ever
// writes anything to stdout outside the protocol, this test breaks.

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/server/stdio.ts'],
    cwd: process.cwd(),
    stderr: 'pipe',
  });
  client = new Client(
    { name: 'stdio-integration-test', version: '0.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
}, 10_000);

afterAll(async () => {
  await client.close();
});

describe('stdio bin', () => {
  it('exposes the 6 tools over a real stdio JSON-RPC channel', async () => {
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
