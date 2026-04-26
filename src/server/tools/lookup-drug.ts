/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { rxNormConceptCitation } from '../../lib/citations';
import { normalizeDrugName } from '../../lib/normalize';
import { respond, respondError } from '../../lib/respond';
import type { ToolResponse } from '../../lib/respond';
import { rxNorm } from '../../lib/rxnorm';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../lib/safety';
import {
  LookupDrugInputSchema,
  type LookupDrugOutput,
} from '../../lib/types';

export const lookupDrugDefinition = {
  name: 'lookup_drug',
  description:
    'Resolve a free-text drug name (e.g. "tylenol") to canonical RxNorm data: RxCUI, generic name, brand names, active ingredients, and ATC drug classes.' +
    TOOL_DESCRIPTION_SUFFIX,
  inputSchema: LookupDrugInputSchema,
} as const;

// RxNorm term-types that already represent a generic concept directly. For
// these, the resolved RxCUI's `name` IS the generic name. For everything
// else (BN, SCD, SBD, packs) we project to the first IN-related concept.
const GENERIC_TERM_TYPES = new Set(['IN', 'MIN', 'PIN']);

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

export async function lookupDrugHandler(
  rawInput: unknown,
): Promise<ToolResponse<LookupDrugOutput>> {
  const parsed = LookupDrugInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return respondError({
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    });
  }

  const normalized = await normalizeDrugName(parsed.data.name);

  if (normalized.kind === 'error') {
    return respondError(normalized.error);
  }
  if (normalized.kind === 'not_found') {
    return respondError({
      code: 'DATA_NOT_FOUND',
      message: `Drug not found in RxNorm: ${parsed.data.name}`,
    });
  }
  if (normalized.kind === 'ambiguous') {
    return respondError({
      code: 'AMBIGUOUS_QUERY',
      message: `Multiple RxNorm matches for "${parsed.data.name}". Pick one of the candidates and try again.`,
      candidates: normalized.candidates,
    });
  }

  const { rxcui } = normalized;

  const [propsResult, relatedResult, classesResult] = await Promise.all([
    rxNorm.getProperties(rxcui),
    rxNorm.getRelated(rxcui, ['IN', 'BN']),
    rxNorm.getClasses(rxcui),
  ]);

  if (!propsResult.ok) return respondError(propsResult.error);
  if (!relatedResult.ok) return respondError(relatedResult.error);
  if (!classesResult.ok) return respondError(classesResult.error);

  const props = propsResult.data;
  const related = relatedResult.data;

  const activeIngredients = dedupe(
    related.filter((r) => r.tty === 'IN').map((r) => r.name),
  );
  const brandNames = dedupe(
    related.filter((r) => r.tty === 'BN').map((r) => r.name),
  );

  const genericName = GENERIC_TERM_TYPES.has(props.tty)
    ? props.name
    : (activeIngredients[0] ?? props.name);

  const drugClasses = dedupe(classesResult.data.map((c) => c.className));

  return respond({
    rxcui,
    genericName,
    brandNames,
    activeIngredients,
    drugClasses,
    disclaimer: DISCLAIMER,
    citation: rxNormConceptCitation(rxcui),
  });
}
