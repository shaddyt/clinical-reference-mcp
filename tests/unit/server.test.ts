/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as LookupDrugModule from '../../src/server/tools/lookup-drug';
import type * as GetDrugLabelModule from '../../src/server/tools/get-drug-label';
import type * as CheckInteractionsModule from '../../src/server/tools/check-interactions';
import type * as FindAlternativesModule from '../../src/server/tools/find-alternatives';
import type * as LookupAdverseEventsModule from '../../src/server/tools/lookup-adverse-events';
import type * as GetDosingReferenceModule from '../../src/server/tools/get-dosing-reference';

// Each tool module is partially mocked: the *handler* export is a vi.fn so we
// can assert dispatch and craft fake responses; the *definition* export is
// kept real so the tool's MCP-facing metadata (name, description, schema) is
// what gets registered with the server.

vi.mock('../../src/server/tools/lookup-drug', async () => {
  const actual = await vi.importActual<typeof LookupDrugModule>(
    '../../src/server/tools/lookup-drug',
  );
  return { ...actual, lookupDrugHandler: vi.fn() };
});
vi.mock('../../src/server/tools/get-drug-label', async () => {
  const actual = await vi.importActual<typeof GetDrugLabelModule>(
    '../../src/server/tools/get-drug-label',
  );
  return { ...actual, getDrugLabelHandler: vi.fn() };
});
vi.mock('../../src/server/tools/check-interactions', async () => {
  const actual = await vi.importActual<typeof CheckInteractionsModule>(
    '../../src/server/tools/check-interactions',
  );
  return { ...actual, checkInteractionsHandler: vi.fn() };
});
vi.mock('../../src/server/tools/find-alternatives', async () => {
  const actual = await vi.importActual<typeof FindAlternativesModule>(
    '../../src/server/tools/find-alternatives',
  );
  return { ...actual, findAlternativesHandler: vi.fn() };
});
vi.mock('../../src/server/tools/lookup-adverse-events', async () => {
  const actual = await vi.importActual<typeof LookupAdverseEventsModule>(
    '../../src/server/tools/lookup-adverse-events',
  );
  return { ...actual, lookupAdverseEventsHandler: vi.fn() };
});
vi.mock('../../src/server/tools/get-dosing-reference', async () => {
  const actual = await vi.importActual<typeof GetDosingReferenceModule>(
    '../../src/server/tools/get-dosing-reference',
  );
  return { ...actual, getDosingReferenceHandler: vi.fn() };
});

import { checkInteractionsHandler } from '../../src/server/tools/check-interactions';
import { findAlternativesHandler } from '../../src/server/tools/find-alternatives';
import { getDosingReferenceHandler } from '../../src/server/tools/get-dosing-reference';
import { getDrugLabelHandler } from '../../src/server/tools/get-drug-label';
import { lookupAdverseEventsHandler } from '../../src/server/tools/lookup-adverse-events';
import { lookupDrugHandler } from '../../src/server/tools/lookup-drug';
import { buildServer } from '../../src/server/server';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../src/lib/safety';
import type { LookupDrugOutput, ToolError } from '../../src/lib/types';

const lookupDrugMock = vi.mocked(lookupDrugHandler);
const getDrugLabelMock = vi.mocked(getDrugLabelHandler);
const checkInteractionsMock = vi.mocked(checkInteractionsHandler);
const findAlternativesMock = vi.mocked(findAlternativesHandler);
const lookupAdverseEventsMock = vi.mocked(lookupAdverseEventsHandler);
const getDosingReferenceMock = vi.mocked(getDosingReferenceHandler);

const SPEC_ORDER = [
  'lookup_drug',
  'get_drug_label',
  'check_interactions',
  'find_alternatives',
  'lookup_adverse_events',
  'get_dosing_reference',
] as const;

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

interface Wired {
  client: Client;
  server: Server;
  close: () => Promise<void>;
}

async function wireServerToClient(): Promise<Wired> {
  const server = buildServer();
  const client = new Client(
    { name: 'test-client', version: '0.0.0' },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

beforeEach(() => {
  lookupDrugMock.mockReset();
  getDrugLabelMock.mockReset();
  checkInteractionsMock.mockReset();
  findAlternativesMock.mockReset();
  lookupAdverseEventsMock.mockReset();
  getDosingReferenceMock.mockReset();
});

describe('buildServer', () => {
  let wired: Wired;
  afterEach(async () => {
    await wired.close();
  });

  it('returns a Server instance', async () => {
    wired = await wireServerToClient();
    expect(wired.server).toBeInstanceOf(Server);
  });

  it('lists 6 tools in spec order', async () => {
    wired = await wireServerToClient();
    const result = await wired.client.listTools();
    expect(result.tools).toHaveLength(6);
    expect(result.tools.map((t) => t.name)).toEqual([...SPEC_ORDER]);
  });

  it('registers each tool with description ending in TOOL_DESCRIPTION_SUFFIX', async () => {
    wired = await wireServerToClient();
    const result = await wired.client.listTools();
    for (const tool of result.tools) {
      expect(tool.description).toBeDefined();
      expect(tool.description?.endsWith(TOOL_DESCRIPTION_SUFFIX)).toBe(true);
      // Empty string would also "end with" the suffix, so guard against that.
      expect((tool.description?.length ?? 0) > TOOL_DESCRIPTION_SUFFIX.length).toBe(
        true,
      );
    }
  });

  it('exposes each tool with an object-typed JSON schema', async () => {
    wired = await wireServerToClient();
    const result = await wired.client.listTools();
    for (const tool of result.tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('dispatches CallTool to the matching handler by name', async () => {
    wired = await wireServerToClient();
    lookupDrugMock.mockResolvedValueOnce({
      ok: true,
      data: FAKE_LOOKUP_DRUG_DATA,
    });
    await wired.client.callTool({
      name: 'lookup_drug',
      arguments: { name: 'aspirin' },
    });
    expect(lookupDrugMock).toHaveBeenCalledTimes(1);
    expect(lookupDrugMock).toHaveBeenCalledWith({ name: 'aspirin' });
    expect(getDrugLabelMock).not.toHaveBeenCalled();
    expect(checkInteractionsMock).not.toHaveBeenCalled();
    expect(findAlternativesMock).not.toHaveBeenCalled();
    expect(lookupAdverseEventsMock).not.toHaveBeenCalled();
    expect(getDosingReferenceMock).not.toHaveBeenCalled();
  });

  it('wraps a successful handler result as JSON content with no error flag', async () => {
    wired = await wireServerToClient();
    lookupDrugMock.mockResolvedValueOnce({
      ok: true,
      data: FAKE_LOOKUP_DRUG_DATA,
    });
    const result = await wired.client.callTool({
      name: 'lookup_drug',
      arguments: { name: 'aspirin' },
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(FAKE_LOOKUP_DRUG_DATA) },
    ]);
  });

  it('rejects with MCP MethodNotFound for an unknown tool name', async () => {
    wired = await wireServerToClient();
    await expect(
      wired.client.callTool({ name: 'no_such_tool', arguments: {} }),
    ).rejects.toThrow(/Unknown tool: no_such_tool/);
  });
});

describe('CallTool error mapping', () => {
  let wired: Wired;
  afterEach(async () => {
    await wired.close();
  });

  // Each ToolError code becomes isError:true content carrying the original
  // error envelope (code, message, optional candidates / retryable). The
  // handler never throws — clients see a structured error result so they can
  // surface candidates or trigger retries without parsing exception text.
  const errorCases: Array<{ label: string; error: ToolError }> = [
    {
      label: 'INVALID_INPUT',
      error: { code: 'INVALID_INPUT', message: 'bad input' },
    },
    {
      label: 'DATA_NOT_FOUND',
      error: { code: 'DATA_NOT_FOUND', message: 'no match' },
    },
    {
      label: 'AMBIGUOUS_QUERY',
      error: {
        code: 'AMBIGUOUS_QUERY',
        message: 'multiple matches',
        candidates: [{ rxcui: '1', name: 'a', reason: 'r' }],
      },
    },
    {
      label: 'UPSTREAM_ERROR',
      error: {
        code: 'UPSTREAM_ERROR',
        message: 'openFDA timeout',
        retryable: true,
      },
    },
  ];

  for (const { label, error } of errorCases) {
    it(`wraps ${label} as isError content without throwing`, async () => {
      wired = await wireServerToClient();
      lookupDrugMock.mockResolvedValueOnce({
        ok: false,
        error,
        disclaimer: DISCLAIMER,
      });
      const result = await wired.client.callTool({
        name: 'lookup_drug',
        arguments: { name: 'aspirin' },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content).toHaveLength(1);
      expect(content[0]?.type).toBe('text');
      const parsed = JSON.parse(content[0]?.text ?? '');
      expect(parsed).toEqual({ error, disclaimer: DISCLAIMER });
    });
  }
});
