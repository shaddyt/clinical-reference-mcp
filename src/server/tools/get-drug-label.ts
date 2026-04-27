/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { openFdaLabelCitation } from '../../lib/citations';
import { normalizeDrugName } from '../../lib/normalize';
import { openFda } from '../../lib/openfda';
import type { LabelHit } from '../../lib/openfda';
import { respond, respondError } from '../../lib/respond';
import type { ToolResponse } from '../../lib/respond';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../lib/safety';
import {
  GetDrugLabelInputSchema,
  type GetDrugLabelOutput,
} from '../../lib/types';

export const getDrugLabelDefinition = {
  name: 'get_drug_label',
  description:
    'Fetch FDA-approved structured product label sections for a drug. Returns the requested sections (indications, dosage, warnings, contraindications, adverse_reactions, mechanism) verbatim from the openFDA label endpoint.' +
    TOOL_DESCRIPTION_SUFFIX,
  inputSchema: GetDrugLabelInputSchema,
} as const;

// Public section names map to LabelHit fields. The public names use snake_case
// to match openFDA's own label.json field names where possible (`adverse_reactions`,
// `indications_and_usage` shortened to `indications`, etc.) — predictable for
// callers who've read the openFDA docs.
const SECTION_KEYS: ReadonlyArray<{
  name: string;
  field: keyof Pick<
    LabelHit,
    | 'indications'
    | 'dosage'
    | 'warnings'
    | 'contraindications'
    | 'adverseReactions'
    | 'mechanism'
  >;
}> = [
  { name: 'indications', field: 'indications' },
  { name: 'dosage', field: 'dosage' },
  { name: 'warnings', field: 'warnings' },
  { name: 'contraindications', field: 'contraindications' },
  { name: 'adverse_reactions', field: 'adverseReactions' },
  { name: 'mechanism', field: 'mechanism' },
];

export async function getDrugLabelHandler(
  rawInput: unknown,
): Promise<ToolResponse<GetDrugLabelOutput>> {
  const parsed = GetDrugLabelInputSchema.safeParse(rawInput);
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

  const { rxcui, name: resolvedName } = normalized;

  const labels = await openFda.findLabelByDrug({
    rxcui,
    genericName: resolvedName,
    limit: 1,
  });
  if (!labels.ok) return respondError(labels.error);

  const hit = labels.data[0];
  if (!hit) {
    return respondError({
      code: 'DATA_NOT_FOUND',
      message: `FDA label not found for ${resolvedName} (RxCUI ${rxcui})`,
    });
  }

  // An empty `sections` array from the caller is treated the same as omitted —
  // "empty filter = no filter" matches the principle of least surprise; a
  // caller who wanted zero sections back would hardly call this tool.
  const requested =
    parsed.data.sections && parsed.data.sections.length > 0
      ? new Set(parsed.data.sections)
      : null;

  const sections: GetDrugLabelOutput['sections'] = [];
  for (const { name, field } of SECTION_KEYS) {
    if (requested !== null && !requested.has(name)) continue;
    const text = hit[field];
    if (text === undefined) continue;
    sections.push({ name, text });
  }

  // setId is preferred for citation since it's a stable SPL identifier; fall
  // back to the rxcui search URL if the label hit doesn't carry one.
  const citation = openFdaLabelCitation(hit.setId ?? rxcui);

  return respond({
    drugName: resolvedName,
    rxcui,
    sections,
    disclaimer: DISCLAIMER,
    citation,
  });
}
