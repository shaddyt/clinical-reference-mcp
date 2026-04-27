/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import type { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';

import type { ToolResponse } from '../../lib/respond';
import {
  checkInteractionsDefinition,
  checkInteractionsHandler,
} from './check-interactions';
import {
  findAlternativesDefinition,
  findAlternativesHandler,
} from './find-alternatives';
import {
  getDosingReferenceDefinition,
  getDosingReferenceHandler,
} from './get-dosing-reference';
import {
  getDrugLabelDefinition,
  getDrugLabelHandler,
} from './get-drug-label';
import {
  lookupAdverseEventsDefinition,
  lookupAdverseEventsHandler,
} from './lookup-adverse-events';
import {
  lookupDrugDefinition,
  lookupDrugHandler,
} from './lookup-drug';

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Parameters<typeof toJsonSchemaCompat>[0];
}

export interface ToolEntry {
  readonly definition: ToolDefinition;
  readonly handler: (input: unknown) => Promise<ToolResponse<unknown>>;
}

// Single source of tool truth, consumed by every transport (MCP over stdio /
// streamable HTTP, and the demo HTTP /api/tool/:name route). Registry order =
// the order tools are advertised over the wire and exercised in tests. Adding
// a tool means one new entry here. The `as const satisfies` keeps the literal
// key set so dispatch can index without widening to `string | undefined`.
export const TOOL_REGISTRY = {
  lookup_drug: {
    definition: lookupDrugDefinition,
    handler: lookupDrugHandler,
  },
  get_drug_label: {
    definition: getDrugLabelDefinition,
    handler: getDrugLabelHandler,
  },
  check_interactions: {
    definition: checkInteractionsDefinition,
    handler: checkInteractionsHandler,
  },
  find_alternatives: {
    definition: findAlternativesDefinition,
    handler: findAlternativesHandler,
  },
  lookup_adverse_events: {
    definition: lookupAdverseEventsDefinition,
    handler: lookupAdverseEventsHandler,
  },
  get_dosing_reference: {
    definition: getDosingReferenceDefinition,
    handler: getDosingReferenceHandler,
  },
} as const satisfies Record<string, ToolEntry>;

export type ToolName = keyof typeof TOOL_REGISTRY;

export const TOOL_NAMES: readonly ToolName[] = Object.keys(
  TOOL_REGISTRY,
) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, name);
}

// Pure dispatch: returns the raw envelope from the handler. MCP-specific
// CallToolResult wrapping (in server.ts) and HTTP status mapping (in http.ts)
// are caller concerns. Keeping this transport-agnostic means a third
// invocation surface can reuse it without further refactor.
export async function dispatchTool(
  name: ToolName,
  input: unknown,
): Promise<ToolResponse<unknown>> {
  return TOOL_REGISTRY[name].handler(input);
}
