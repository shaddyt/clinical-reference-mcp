/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

// Single source of disclaimer text for every surface (LLM tool descriptions,
// response payloads, CLI output, HTTP response headers). Drift between
// surfaces is how safety messaging gets diluted. Kept ASCII-only so the
// string is safe to encode as an HTTP header byte string without escaping.
export const DISCLAIMER =
  'Returns regulator-published data only. Not for clinical use - for developer reference.';

// Suffix appended to every MCP tool description (the field the LLM reads
// when choosing a tool), so the safety framing is in front of the model
// every time it considers a tool call.
export const TOOL_DESCRIPTION_SUFFIX = ` ${DISCLAIMER}`;

// HTTP response header carrying the disclaimer for cross-origin clients
// that don't render the response body (browser dev tools, log processors,
// monitoring agents).
export const HTTP_DISCLAIMER_HEADER = 'X-Clinical-Reference-Disclaimer';
