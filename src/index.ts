/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

// v0.1 public library surface — *contract* only. Anything load-bearing for
// extending, wrapping, or validating against this server lives here.
//
// Internals (HTTP fetch wrapper, cache, rate limiter, RxNorm/openFDA
// clients, name normalizer) are intentionally not exported. Consumers
// who need drug data should call the MCP tool handlers (over stdio /
// streamable HTTP) or the upstream APIs directly.

export * from './lib/safety';
export * from './lib/citations';

// Tool envelope helpers — used by anyone composing custom tools that need
// to return the same { ok, data } | { ok: false, error, disclaimer } shape.
export { respond, respondError } from './lib/respond';
export type {
  ToolFailure,
  ToolResponse,
  ToolSuccess,
} from './lib/respond';

// Type-only re-export means consumers' bundlers can tree-shake these
// completely from runtime — the Zod schemas in ./lib/types stay internal
// while their inferred types reach the public surface.
export type * from './lib/types';
