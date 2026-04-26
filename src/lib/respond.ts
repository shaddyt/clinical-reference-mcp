/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { DISCLAIMER } from './safety';
import type { ToolError } from './types';

// Tool success/failure envelope helpers.
//
// Success payloads (typed `T`) are expected to already include `disclaimer`
// and `citation` per the output schemas in types.ts; the schemas guarantee
// safety framing and provenance are present, and the Zod parse on each
// tool's return value is the contract guard. The success envelope only adds
// the discriminant.
//
// Errors don't go through the output schemas, so the disclaimer is attached
// at the envelope level — clients displaying error responses still surface
// the safety framing.

export interface ToolSuccess<T> {
  ok: true;
  data: T;
}

export interface ToolFailure {
  ok: false;
  error: ToolError;
  disclaimer: string;
}

export type ToolResponse<T> = ToolSuccess<T> | ToolFailure;

export function respond<T>(data: T): ToolSuccess<T> {
  return { ok: true, data };
}

export function respondError(error: ToolError): ToolFailure {
  return { ok: false, error, disclaimer: DISCLAIMER };
}
