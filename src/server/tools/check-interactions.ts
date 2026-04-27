/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { openFdaLabelCitation } from '../../lib/citations';
import { normalizeDrugName } from '../../lib/normalize';
import type { NormalizeResult } from '../../lib/normalize';
import { openFda } from '../../lib/openfda';
import { respond, respondError } from '../../lib/respond';
import type { ToolResponse } from '../../lib/respond';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../lib/safety';
import {
  CheckInteractionsInputSchema,
  type CheckInteractionsOutput,
} from '../../lib/types';

export const checkInteractionsDefinition = {
  name: 'check_interactions',
  description:
    'For each drug provided, return the FDA label\'s drug_interactions section verbatim (with warnings as a fallback when no dedicated section exists). This surfaces source material — it is not a synthesized pairwise interaction verdict.' +
    TOOL_DESCRIPTION_SUFFIX,
  inputSchema: CheckInteractionsInputSchema,
} as const;

// Constant prose explaining the contract — clients (especially LLMs) need to
// understand that this tool does NOT detect interactions a label fails to
// document, score severity, or do real-time DDI matching. Surfacing the
// limitation alongside every successful response keeps it impossible to
// miss in downstream rendering.
const SCOPE_NOTE =
  'Returns each drug\'s FDA-label drug_interactions section verbatim (or warnings as a fallback). Does not synthesize a pairwise verdict, score severity, or detect interactions absent from the labels. For clinical decision support, use a real-time DDI database (e.g. Lexicomp, Micromedex).';

interface ResolvedPair {
  input: string;
  rxcui: string;
  name: string;
}

export async function checkInteractionsHandler(
  rawInput: unknown,
): Promise<ToolResponse<CheckInteractionsOutput>> {
  const parsed = CheckInteractionsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return respondError({
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    });
  }

  const drugs = parsed.data.drugs;

  const normalized: Array<{ input: string; result: NormalizeResult }> =
    await Promise.all(
      drugs.map(async (input) => ({
        input,
        result: await normalizeDrugName(input),
      })),
    );

  const resolved: ResolvedPair[] = [];
  let firstAmbiguous: { input: string; result: NormalizeResult } | undefined;
  const notFoundInputs: string[] = [];

  for (const { input, result } of normalized) {
    switch (result.kind) {
      case 'error':
        // First upstream error wins — no point processing further.
        return respondError(result.error);
      case 'ambiguous':
        if (!firstAmbiguous) firstAmbiguous = { input, result };
        break;
      case 'not_found':
        notFoundInputs.push(input);
        break;
      case 'resolved':
        resolved.push({ input, rxcui: result.rxcui, name: result.name });
        break;
    }
  }

  // Disambiguation is one input at a time: surface the first ambiguous
  // input's candidates so the caller can pick and re-call. Reporting all
  // ambiguous drugs at once would require a per-drug candidates structure
  // the ToolError schema doesn't carry.
  if (firstAmbiguous && firstAmbiguous.result.kind === 'ambiguous') {
    return respondError({
      code: 'AMBIGUOUS_QUERY',
      message: `Multiple RxNorm matches for "${firstAmbiguous.input}". Disambiguate inputs one at a time.`,
      candidates: firstAmbiguous.result.candidates,
    });
  }

  if (notFoundInputs.length > 0) {
    return respondError({
      code: 'DATA_NOT_FOUND',
      message: `Drug(s) not found in RxNorm: ${notFoundInputs.join(', ')}`,
    });
  }

  // All resolved. Fetch labels in parallel via findLabelByDrug so the
  // RxCUI -> generic_name fallback applies per-drug — otherwise OTC
  // monograph drugs in the input would yield no interaction text even
  // when openFDA does have the label under the generic name.
  const labelPairs = await Promise.all(
    resolved.map(async (pair) => ({
      pair,
      result: await openFda.findLabelByDrug({
        rxcui: pair.rxcui,
        genericName: pair.name,
        limit: 1,
      }),
    })),
  );

  const entries: CheckInteractionsOutput['drugs'] = [];
  for (const { pair, result } of labelPairs) {
    if (!result.ok) return respondError(result.error);

    const hit = result.data[0];
    // drug_interactions is the dedicated section; fall back to warnings if
    // the label lacks it (older labels, or supplements with no DDI section).
    // null distinguishes "we looked and found nothing" from a missing field.
    const interactionsText =
      hit?.drugInteractions ?? hit?.warnings ?? null;
    const citation = openFdaLabelCitation(hit?.setId ?? pair.rxcui);

    entries.push({
      drug: pair.name,
      rxcui: pair.rxcui,
      interactionsText,
      citation,
    });
  }

  return respond({
    drugs: entries,
    scopeNote: SCOPE_NOTE,
    disclaimer: DISCLAIMER,
  });
}
