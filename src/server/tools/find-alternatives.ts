/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { rxClassByRxCuiCitation } from '../../lib/citations';
import { normalizeDrugName } from '../../lib/normalize';
import { respond, respondError } from '../../lib/respond';
import type { ToolResponse } from '../../lib/respond';
import { rxNorm } from '../../lib/rxnorm';
import type { DrugClass } from '../../lib/rxnorm';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../lib/safety';
import {
  FindAlternativesInputSchema,
  type FindAlternativesOutput,
} from '../../lib/types';

export const findAlternativesDefinition = {
  name: 'find_alternatives',
  description:
    'Find ingredient-level (IN) drugs that share an ATC therapeutic class with the input drug. Returns the most specific class\'s siblings, falling back through broader classes if needed.' +
    TOOL_DESCRIPTION_SUFFIX,
  inputSchema: FindAlternativesInputSchema,
} as const;

// Cap on returned alternatives. ATC class membership at the broader levels
// (e.g. ATC1: "Nervous system") balloons into hundreds of drugs, of which
// only the closest siblings are clinically meaningful. 20 is large enough
// to surface useful coverage and small enough to remain LLM-context-friendly.
const MAX_ALTERNATIVES = 20;

const SCOPE_NOTE =
  'Alternatives are RxNorm ingredient-level (IN) members of the most specific ATC class containing this drug that has additional members. ATC co-membership does not imply therapeutic equivalence — drugs in the same class can differ materially in indication, dosing, side effects, and interactions.';

export async function findAlternativesHandler(
  rawInput: unknown,
): Promise<ToolResponse<FindAlternativesOutput>> {
  const parsed = FindAlternativesInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return respondError({
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    });
  }

  const query = parsed.data.name;
  const normalized = await normalizeDrugName(query);
  if (normalized.kind === 'error') return respondError(normalized.error);
  if (normalized.kind === 'not_found') {
    return respondError({
      code: 'DATA_NOT_FOUND',
      message: `Drug not found in RxNorm: ${query}`,
    });
  }
  if (normalized.kind === 'ambiguous') {
    return respondError({
      code: 'AMBIGUOUS_QUERY',
      message: `Multiple RxNorm matches for "${query}". Pick one of the candidates and try again.`,
      candidates: normalized.candidates,
    });
  }

  const { rxcui, name: resolvedName } = normalized;

  const classesResult = await rxNorm.getClasses(rxcui);
  if (!classesResult.ok) return respondError(classesResult.error);

  const classes = classesResult.data;
  if (classes.length === 0) {
    return respondError({
      code: 'DATA_NOT_FOUND',
      message: `${resolvedName} has no ATC classification in RxNorm`,
    });
  }

  // Algorithm: iterate ATC classes most-specific first, return members of
  // the first class that has siblings beyond the input drug.
  //
  // Why specificity-by-classId-length: ATC codes are hierarchical and
  // strictly nest by length — "N" (group: nervous system) ⊂ "N02"
  // (analgesics) ⊂ "N02B" (other analgesics) ⊂ "N02BA" (salicylic acid
  // derivatives) ⊂ "N02BA01" (acetylsalicylic acid). RxNav's byRxcui
  // returns every level the drug belongs to; the longest classId is always
  // the most specific.
  //
  // Why most-specific-with-siblings: the input's own leaf-level ATC code
  // typically has a single member (itself), so its alternatives list is
  // empty after filtering. The next level up — the smallest enclosing
  // group with sibling drugs — is what a clinician means by "drugs like
  // this one." Broader levels (group, anatomical class) balloon to
  // hundreds of unrelated members and are rarely useful; we never reach
  // them in practice but the loop fall-through covers that case.
  //
  // Why sequential not parallel: cache-friendly (each class fetched at
  // most once), respects RxNav rate limits, and lets us short-circuit as
  // soon as we find a class with siblings — usually after one or two
  // iterations.
  const sortedClasses = [...classes].sort(
    (a, b) => b.classId.length - a.classId.length,
  );

  let chosen: DrugClass | undefined;
  const alternatives: FindAlternativesOutput['alternatives'] = [];

  for (const cls of sortedClasses) {
    const members = await rxNorm.getClassMembers(cls.classId, ['IN']);
    if (!members.ok) return respondError(members.error);

    const seen = new Set<string>();
    const filtered = members.data.filter((m) => {
      if (m.rxcui === rxcui) return false;
      if (seen.has(m.rxcui)) return false;
      seen.add(m.rxcui);
      return true;
    });

    if (filtered.length === 0) continue;

    chosen = cls;
    for (const m of filtered.slice(0, MAX_ALTERNATIVES)) {
      alternatives.push({
        rxcui: m.rxcui,
        name: m.name,
        sharedClass: cls.className,
      });
    }
    break;
  }

  if (!chosen) {
    return respondError({
      code: 'DATA_NOT_FOUND',
      message: `No alternatives found in any ATC class for ${resolvedName}`,
    });
  }

  // Dedupe class names while preserving order — RxNav can return the same
  // human-readable name for sibling levels in pathological cases.
  const drugClassNames = Array.from(new Set(classes.map((c) => c.className)));

  return respond({
    query,
    rxcui,
    drugClasses: drugClassNames,
    alternatives,
    scopeNote: SCOPE_NOTE,
    disclaimer: DISCLAIMER,
    citation: rxClassByRxCuiCitation(rxcui),
  });
}
