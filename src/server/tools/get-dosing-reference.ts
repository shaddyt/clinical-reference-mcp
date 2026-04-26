/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { openFdaLabelCitation } from '../../lib/citations';
import { normalizeDrugName } from '../../lib/normalize';
import { openFda } from '../../lib/openfda';
import { respond, respondError } from '../../lib/respond';
import type { ToolResponse } from '../../lib/respond';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../lib/safety';
import {
  GetDosingReferenceInputSchema,
  type GetDosingReferenceOutput,
} from '../../lib/types';

export const getDosingReferenceDefinition = {
  name: 'get_dosing_reference',
  description:
    'Return the published FDA-label dosing text for a drug verbatim. Surfaces what the label says — does not compute, adjust, or recommend doses, and never reasons about specific patients.' +
    TOOL_DESCRIPTION_SUFFIX,
  inputSchema: GetDosingReferenceInputSchema,
} as const;

const SCOPE_NOTE =
  'Verbatim FDA-label dosing text. This is the published label text, not a dosing recommendation. It is not adjusted for patient-specific factors (age, weight, renal/hepatic function, drug interactions, comorbidities). For actual prescribing, use clinical references and judgment.';

export async function getDosingReferenceHandler(
  rawInput: unknown,
): Promise<ToolResponse<GetDosingReferenceOutput>> {
  const parsed = GetDosingReferenceInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return respondError({
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    });
  }

  const { name } = parsed.data;

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

  const labels = await openFda.searchLabels({
    field: 'openfda.rxcui',
    value: rxcui,
    limit: 1,
  });
  if (!labels.ok) return respondError(labels.error);

  const hit = labels.data[0];
  if (!hit) {
    return respondError({
      code: 'DATA_NOT_FOUND',
      message: `FDA label not found for RxCUI ${rxcui}`,
    });
  }
  if (hit.dosage === undefined) {
    return respondError({
      code: 'DATA_NOT_FOUND',
      message: `FDA label for ${resolvedName} has no dosage_and_administration section`,
    });
  }

  // Single entry with the full dosage text. Splitting into per-population or
  // per-route entries would require parsing the label's prose, which is the
  // kind of inference this tool deliberately avoids — population/route are
  // optional in the schema and we leave them unset rather than guess.
  return respond({
    drugName: resolvedName,
    rxcui,
    entries: [{ text: hit.dosage }],
    scopeNote: SCOPE_NOTE,
    disclaimer: DISCLAIMER,
    citation: openFdaLabelCitation(hit.setId ?? rxcui),
  });
}
