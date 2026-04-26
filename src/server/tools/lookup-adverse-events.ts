/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { openFdaAdverseEventCitation } from '../../lib/citations';
import { normalizeDrugName } from '../../lib/normalize';
import { openFda } from '../../lib/openfda';
import { respond, respondError } from '../../lib/respond';
import type { ToolResponse } from '../../lib/respond';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../lib/safety';
import {
  LookupAdverseEventsInputSchema,
  type LookupAdverseEventsOutput,
} from '../../lib/types';

export const lookupAdverseEventsDefinition = {
  name: 'lookup_adverse_events',
  description:
    'Top reported adverse-reaction terms for a drug from FDA FAERS, with counts. FAERS is voluntary post-market reporting — counts indicate report frequency, not incidence rates, and do not establish causation.' +
    TOOL_DESCRIPTION_SUFFIX,
  inputSchema: LookupAdverseEventsInputSchema,
} as const;

export async function lookupAdverseEventsHandler(
  rawInput: unknown,
): Promise<ToolResponse<LookupAdverseEventsOutput>> {
  const parsed = LookupAdverseEventsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return respondError({
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    });
  }

  const { name, limit } = parsed.data;

  const normalized = await normalizeDrugName(name);
  if (normalized.kind === 'error') return respondError(normalized.error);
  if (normalized.kind === 'not_found') {
    return respondError({
      code: 'DATA_NOT_FOUND',
      message: `Drug not found in RxNorm: ${name}`,
    });
  }
  if (normalized.kind === 'ambiguous') {
    return respondError({
      code: 'AMBIGUOUS_QUERY',
      message: `Multiple RxNorm matches for "${name}". Pick one of the candidates and try again.`,
      candidates: normalized.candidates,
    });
  }

  const { rxcui, name: resolvedName } = normalized;

  const events = await openFda.topAdverseEvents({
    field: 'patient.drug.openfda.rxcui',
    value: rxcui,
    limit,
  });
  if (!events.ok) return respondError(events.error);

  if (events.data.length === 0) {
    return respondError({
      code: 'DATA_NOT_FOUND',
      message: `No FAERS reports found for ${resolvedName}`,
    });
  }

  // openFDA's count query already returns descending by count, but sorting
  // defensively makes the contract independent of upstream behavior — a
  // future change there would be silent without this.
  const sorted = [...events.data].sort((a, b) => b.count - a.count);

  // totalReports is the sum of report-mentions across the top-N terms
  // returned (a single FAERS report can carry multiple reaction terms, so
  // this is not a unique-report count). It bounds the magnitude of what the
  // events list represents — useful as a back-of-envelope signal of how
  // much data the top-N is summarizing.
  const totalReports = sorted.reduce((acc, e) => acc + e.count, 0);

  return respond({
    drugName: resolvedName,
    rxcui,
    totalReports,
    events: sorted,
    disclaimer: DISCLAIMER,
    citation: openFdaAdverseEventCitation(rxcui),
  });
}
