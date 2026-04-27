/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import type { ToolResponse } from '../lib/respond';
import { VERSION } from '../lib/version';
import {
  TOOL_REGISTRY,
  dispatchTool,
  isToolName,
  type ToolEntry,
} from './tools/registry';

function describeTool(entry: ToolEntry): Tool {
  // toJsonSchemaCompat returns a generic Record<string, unknown>; for an
  // input that is itself a Zod object schema (which all our tools use) the
  // produced JSON Schema is always object-typed, which is what MCP's Tool.
  // inputSchema requires. The narrow cast documents that contract.
  const jsonSchema = toJsonSchemaCompat(entry.definition.inputSchema);
  return {
    name: entry.definition.name,
    description: entry.definition.description,
    inputSchema: jsonSchema as Tool['inputSchema'],
  };
}

function toCallToolResult(result: ToolResponse<unknown>): CallToolResult {
  if (result.ok) {
    return {
      content: [{ type: 'text', text: JSON.stringify(result.data) }],
    };
  }
  // All four ToolError codes (INVALID_INPUT, DATA_NOT_FOUND, AMBIGUOUS_QUERY,
  // UPSTREAM_ERROR) become MCP `isError: true` content payloads — never thrown.
  // Throwing McpError is reserved for protocol-level failures (unknown tool
  // name, malformed request); domain errors carry candidates / retryable
  // hints that the caller needs to see in the result, not as an exception.
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error: result.error,
          disclaimer: result.disclaimer,
        }),
      },
    ],
  };
}

export function buildServer(): Server {
  const server = new Server(
    { name: '@shaddyt/clinical-reference-mcp', version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: Object.values(TOOL_REGISTRY).map(describeTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!isToolName(name)) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    const result = await dispatchTool(name, args);
    return toCallToolResult(result);
  });

  return server;
}
