/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

// ---------- Citations ----------

export const SourceKeySchema = z.enum(['openFda', 'rxnorm', 'rxnav']);

export const CitationSchema = z.object({
  source: SourceKeySchema,
  url: z.string().url(),
  retrievedAt: z.string().datetime(),
});

// ---------- Errors ----------

export const ErrorCodeSchema = z.enum([
  'DATA_NOT_FOUND',
  'AMBIGUOUS_QUERY',
  'UPSTREAM_ERROR',
  'INVALID_INPUT',
]);

export const AmbiguousMatchSchema = z.object({
  rxcui: z.string(),
  name: z.string(),
  reason: z.string(),
});

export const ToolErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  candidates: z.array(AmbiguousMatchSchema).optional(),
  // Hints to a higher-level retry policy that the same call may succeed if
  // tried again later (429s, 5xx after retries exhausted, network failures).
  // Absent or false means the failure is structural and a retry won't help.
  retryable: z.boolean().optional(),
});

// ---------- Shared field validators ----------

const drugNameField = z.string().trim().min(1).max(200);

// ---------- lookup_drug ----------

export const LookupDrugInputSchema = z.object({
  name: drugNameField,
});

export const LookupDrugOutputSchema = z.object({
  rxcui: z.string(),
  genericName: z.string(),
  brandNames: z.array(z.string()),
  activeIngredients: z.array(z.string()),
  drugClasses: z.array(z.string()),
  disclaimer: z.string(),
  citation: CitationSchema,
});

// ---------- get_drug_label ----------

export const LabelSectionSchema = z.object({
  name: z.string(),
  text: z.string(),
});

export const GetDrugLabelInputSchema = z.object({
  name: drugNameField,
  sections: z.array(z.string().min(1)).optional(),
});

export const GetDrugLabelOutputSchema = z.object({
  drugName: z.string(),
  rxcui: z.string().optional(),
  sections: z.array(LabelSectionSchema),
  disclaimer: z.string(),
  citation: CitationSchema,
});

// ---------- check_interactions ----------
//
// Returns each input drug's label-level interaction text verbatim, with a
// per-drug citation. Does not synthesize a structured pairwise verdict —
// FDA-label interaction prose is asymmetric, narrative, and incomplete by
// nature, and a structured verdict would imply a comprehensiveness this
// data does not provide.

export const InteractionLabelEntrySchema = z.object({
  drug: z.string(),
  rxcui: z.string().optional(),
  interactionsText: z.string().nullable(),
  citation: CitationSchema,
});

export const CheckInteractionsInputSchema = z.object({
  drugs: z.array(drugNameField).min(2).max(10),
});

export const CheckInteractionsOutputSchema = z.object({
  drugs: z.array(InteractionLabelEntrySchema),
  scopeNote: z.string(),
  disclaimer: z.string(),
});

// ---------- find_alternatives ----------

export const FindAlternativesInputSchema = z.object({
  name: drugNameField,
});

export const AlternativeEntrySchema = z.object({
  rxcui: z.string(),
  name: z.string(),
  sharedClass: z.string(),
});

export const FindAlternativesOutputSchema = z.object({
  query: z.string(),
  rxcui: z.string(),
  drugClasses: z.array(z.string()),
  alternatives: z.array(AlternativeEntrySchema),
  scopeNote: z.string(),
  disclaimer: z.string(),
  citation: CitationSchema,
});

// ---------- lookup_adverse_events ----------

export const AdverseEventEntrySchema = z.object({
  term: z.string(),
  count: z.number().int().nonnegative(),
});

export const LookupAdverseEventsInputSchema = z.object({
  name: drugNameField,
  limit: z.number().int().positive().max(100).default(10),
});

export const LookupAdverseEventsOutputSchema = z.object({
  drugName: z.string(),
  rxcui: z.string().optional(),
  totalReports: z.number().int().nonnegative(),
  events: z.array(AdverseEventEntrySchema),
  disclaimer: z.string(),
  citation: CitationSchema,
});

// ---------- get_dosing_reference ----------

export const DosingEntrySchema = z.object({
  population: z.string().optional(),
  route: z.string().optional(),
  text: z.string(),
});

export const GetDosingReferenceInputSchema = z.object({
  name: drugNameField,
});

export const GetDosingReferenceOutputSchema = z.object({
  drugName: z.string(),
  rxcui: z.string().optional(),
  entries: z.array(DosingEntrySchema),
  scopeNote: z.string(),
  disclaimer: z.string(),
  citation: CitationSchema,
});

// ---------- Inferred types ----------

export type Citation = z.infer<typeof CitationSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type AmbiguousMatch = z.infer<typeof AmbiguousMatchSchema>;
export type ToolError = z.infer<typeof ToolErrorSchema>;

// Discriminated success/failure envelope used across every client boundary
// (http wrapper, openFDA, RxNorm, normalizer). Errors are always typed with
// our four-code taxonomy — no throwing across the public boundary.
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: ToolError };

export type LookupDrugInput = z.infer<typeof LookupDrugInputSchema>;
export type LookupDrugOutput = z.infer<typeof LookupDrugOutputSchema>;

export type GetDrugLabelInput = z.infer<typeof GetDrugLabelInputSchema>;
export type GetDrugLabelOutput = z.infer<typeof GetDrugLabelOutputSchema>;

export type CheckInteractionsInput = z.infer<typeof CheckInteractionsInputSchema>;
export type CheckInteractionsOutput = z.infer<typeof CheckInteractionsOutputSchema>;

export type FindAlternativesInput = z.infer<typeof FindAlternativesInputSchema>;
export type FindAlternativesOutput = z.infer<typeof FindAlternativesOutputSchema>;

export type LookupAdverseEventsInput = z.infer<typeof LookupAdverseEventsInputSchema>;
export type LookupAdverseEventsOutput = z.infer<typeof LookupAdverseEventsOutputSchema>;

export type GetDosingReferenceInput = z.infer<typeof GetDosingReferenceInputSchema>;
export type GetDosingReferenceOutput = z.infer<typeof GetDosingReferenceOutputSchema>;
