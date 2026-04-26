/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { rxNorm } from './rxnorm';
import type { MatchCandidate } from './rxnorm';
import type { AmbiguousMatch, ToolError } from './types';

const MAX_INPUT_LENGTH = 200;
const APPROXIMATE_MAX_ENTRIES = 5;

// Heuristic for promoting an approximate match to a confident resolution.
// Both must hold:
//   1. The top score is at least DECISIVE_SCORE (RxNav's typical "exact"
//      band; e.g. spelling variations of the same ingredient land here).
//   2. The top beats the runner-up by at least DECISIVE_GAP, which keeps
//      pairs like ("Drug A" 95, "Drug B" 93) — distinct concepts that
//      both score high — in the ambiguous bucket where the LLM must ask
//      the user to disambiguate.
// Borderline cases are intentionally surfaced as AMBIGUOUS_QUERY so we
// never silently pick the wrong drug.
const DECISIVE_SCORE = 90;
const DECISIVE_GAP = 5;

const NUMERIC_RE = /^\d+$/;

export type NormalizeResult =
  | {
      kind: 'resolved';
      rxcui: string;
      name: string;
      source: 'rxcui' | 'exact' | 'approximate';
    }
  | { kind: 'ambiguous'; candidates: AmbiguousMatch[] }
  | { kind: 'not_found' }
  | { kind: 'error'; error: ToolError };

export async function normalizeDrugName(
  input: string,
): Promise<NormalizeResult> {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return invalid('Drug name cannot be empty');
  }
  if (trimmed.length > MAX_INPUT_LENGTH) {
    return invalid(`Drug name cannot exceed ${MAX_INPUT_LENGTH} characters`);
  }

  if (NUMERIC_RE.test(trimmed)) {
    const props = await rxNorm.getProperties(trimmed);
    if (props.ok) {
      return {
        kind: 'resolved',
        rxcui: props.data.rxcui,
        name: props.data.name,
        source: 'rxcui',
      };
    }
    // Only fall through for "no such RxCUI" — anything else is a real error
    // we shouldn't paper over with a text search.
    if (props.error.code !== 'DATA_NOT_FOUND') {
      return { kind: 'error', error: props.error };
    }
  }

  const approx = await rxNorm.approximateMatch(trimmed, APPROXIMATE_MAX_ENTRIES);
  if (!approx.ok) {
    return { kind: 'error', error: approx.error };
  }

  const candidates = approx.data;
  if (candidates.length === 0) {
    return { kind: 'not_found' };
  }

  const top = candidates[0];
  if (!top) return { kind: 'not_found' };

  if (candidates.length === 1) {
    return {
      kind: 'resolved',
      rxcui: top.rxcui,
      name: top.name,
      source: 'approximate',
    };
  }

  const runnerUp = candidates[1];
  if (
    runnerUp &&
    top.score >= DECISIVE_SCORE &&
    top.score - runnerUp.score >= DECISIVE_GAP
  ) {
    return {
      kind: 'resolved',
      rxcui: top.rxcui,
      name: top.name,
      source: 'exact',
    };
  }

  return {
    kind: 'ambiguous',
    candidates: candidates.map(toAmbiguousMatch),
  };
}

function toAmbiguousMatch(c: MatchCandidate): AmbiguousMatch {
  return {
    rxcui: c.rxcui,
    name: c.name,
    reason: `approximate match (score ${c.score}, rank ${c.rank})`,
  };
}

function invalid(message: string): NormalizeResult {
  return { kind: 'error', error: { code: 'INVALID_INPUT', message } };
}
