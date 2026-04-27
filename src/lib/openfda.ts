/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

import { openFdaCache } from './cache';
import { fetchJson } from './http';
import { openFdaLimiter } from './ratelimit';
import type { Result } from './types';

const BASE = 'https://api.fda.gov';

// openFDA's default reaction-term field. Exposed as a default so callers
// don't have to know the FAERS path; advanced callers can still override.
const DEFAULT_REACTION_FIELD = 'patient.reaction.reactionmeddrapt.exact';

// openFDA's documented `limit` ceiling for non-count requests.
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;
const LIMIT_DEFAULT = 5;

// ---------- Boundary schemas ----------
//
// openFDA payloads are external untrusted input. We validate the fields we
// rely on and ignore the rest — partial coverage is intentional. Adding
// more fields here is the right way to widen what the client surfaces.

const LabelOpenFdaSchema = z
  .object({
    brand_name: z.array(z.string()).optional(),
    generic_name: z.array(z.string()).optional(),
    rxcui: z.array(z.string()).optional(),
    spl_set_id: z.array(z.string()).optional(),
  })
  .optional();

const LabelResultSchema = z.object({
  indications_and_usage: z.array(z.string()).optional(),
  dosage_and_administration: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  contraindications: z.array(z.string()).optional(),
  adverse_reactions: z.array(z.string()).optional(),
  mechanism_of_action: z.array(z.string()).optional(),
  drug_interactions: z.array(z.string()).optional(),
  openfda: LabelOpenFdaSchema,
});

const LabelResponseSchema = z.object({
  results: z.array(LabelResultSchema),
});

const EventResponseSchema = z.object({
  results: z.array(
    z.object({
      term: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
});

// ---------- Public types ----------

export interface SearchLabelsOptions {
  field: 'openfda.brand_name' | 'openfda.generic_name' | 'openfda.rxcui';
  value: string;
  limit?: number;
}

export interface TopAdverseEventsOptions {
  field:
    | 'patient.drug.openfda.rxcui'
    | 'patient.drug.openfda.generic_name'
    | 'patient.drug.openfda.brand_name';
  value: string;
  countField?: string;
  limit?: number;
}

export interface LabelHit {
  setId?: string;
  brandName?: string[];
  genericName?: string[];
  rxcui?: string[];
  indications?: string;
  dosage?: string;
  warnings?: string;
  contraindications?: string;
  adverseReactions?: string;
  mechanism?: string;
  drugInteractions?: string;
  raw: unknown;
}

export interface AdverseEventCount {
  term: string;
  count: number;
}

export interface FindLabelByDrugOptions {
  rxcui: string;
  genericName: string;
  limit?: number;
}

export interface FindAdverseEventsByDrugOptions {
  rxcui: string;
  genericName: string;
  countField?: string;
  limit?: number;
}

export interface OpenFdaClient {
  searchLabels(opts: SearchLabelsOptions): Promise<Result<LabelHit[]>>;
  topAdverseEvents(
    opts: TopAdverseEventsOptions,
  ): Promise<Result<AdverseEventCount[]>>;
  // Higher-level "find a label / events for this drug" with fallback.
  // openFDA's `openfda.rxcui` field is populated reliably for prescription
  // drugs but inconsistently for OTC monograph drugs (aspirin, ibuprofen,
  // acetaminophen, etc.) — those labels exist in the dataset but are only
  // discoverable via name fields. Try RxCUI first (most precise), fall
  // back to generic_name when the RxCUI search returns zero hits.
  findLabelByDrug(opts: FindLabelByDrugOptions): Promise<Result<LabelHit[]>>;
  findAdverseEventsByDrug(
    opts: FindAdverseEventsByDrugOptions,
  ): Promise<Result<AdverseEventCount[]>>;
}

// ---------- URL building ----------

function escapeLuceneValue(value: string): string {
  // openFDA accepts a Lucene-flavored query language. Quoting handles spaces
  // and most punctuation; backslashes and embedded quotes still need to be
  // escaped to avoid breaking out of the quoted phrase.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return LIMIT_DEFAULT;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.trunc(value)));
}

function buildLabelsUrl(opts: SearchLabelsOptions): string {
  const params = new URLSearchParams();
  params.set('search', `${opts.field}:"${escapeLuceneValue(opts.value)}"`);
  params.set('limit', String(clampLimit(opts.limit)));
  return `${BASE}/drug/label.json?${params.toString()}`;
}

function buildEventsUrl(opts: TopAdverseEventsOptions): string {
  const params = new URLSearchParams();
  params.set('search', `${opts.field}:"${escapeLuceneValue(opts.value)}"`);
  params.set('count', opts.countField ?? DEFAULT_REACTION_FIELD);
  if (opts.limit !== undefined) {
    params.set('limit', String(clampLimit(opts.limit)));
  }
  return `${BASE}/drug/event.json?${params.toString()}`;
}

// Lucene OR-clause covering both the RxCUI-indexed and generic_name-indexed
// records for the same drug. Why an OR (not sequential fallback): openFDA
// stores RxCUIs at the clinical-product level (SCD/SBD), e.g. warfarin's
// labels carry RxCUIs like 855288, NOT the IN-level 11289 our RxNorm
// normalizer returns. Many FAERS reports also predate RxCUI annotation.
// A single OR-search returns the union of both indices in one round trip;
// a sequential fallback would either short-circuit on the first index's
// 404 (openFDA returns 404 for zero hits) or undercount when one index is
// partially populated. Lowercasing the generic name is the safest default
// for case-folded indexing.
//
// Encoding note: the literal space between clauses is intentional --
// URLSearchParams encodes it to '+' on the wire, producing ' OR '. A
// literal '+' here would encode to '%2B' and break the openFDA query
// parser (the same v0.1.3 RxNav '+' bug class).
function buildOrClause(
  rxcuiField: string,
  genericNameField: string,
  rxcui: string,
  genericName: string,
): string {
  const r = escapeLuceneValue(rxcui);
  const g = escapeLuceneValue(genericName.toLowerCase());
  return `${rxcuiField}:"${r}" OR ${genericNameField}:"${g}"`;
}

function buildLabelsOrUrl(opts: FindLabelByDrugOptions): string {
  const params = new URLSearchParams();
  params.set(
    'search',
    buildOrClause('openfda.rxcui', 'openfda.generic_name', opts.rxcui, opts.genericName),
  );
  params.set('limit', String(clampLimit(opts.limit)));
  return `${BASE}/drug/label.json?${params.toString()}`;
}

function buildEventsOrUrl(opts: FindAdverseEventsByDrugOptions): string {
  const params = new URLSearchParams();
  params.set(
    'search',
    buildOrClause(
      'patient.drug.openfda.rxcui',
      'patient.drug.openfda.generic_name',
      opts.rxcui,
      opts.genericName,
    ),
  );
  params.set('count', opts.countField ?? DEFAULT_REACTION_FIELD);
  if (opts.limit !== undefined) {
    params.set('limit', String(clampLimit(opts.limit)));
  }
  return `${BASE}/drug/event.json?${params.toString()}`;
}

// Stable cache key: sort query params so equivalent requests hit the same
// entry regardless of the order callers happened to construct them.
function canonicalize(url: string): string {
  const u = new URL(url);
  const sorted = [...u.searchParams.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const fresh = new URLSearchParams();
  for (const [k, v] of sorted) fresh.append(k, v);
  return `${u.origin}${u.pathname}?${fresh.toString()}`;
}

// ---------- Field normalization ----------

function stripMarkup(text: string): string {
  // FDA SPL-derived labels frequently contain leftover SGML/HTML tags. The
  // tags are layout artifacts, not content, and confuse downstream LLM
  // formatting — strip them and collapse runs of whitespace.
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function joinAndStrip(parts: string[] | undefined): string | undefined {
  if (!parts || parts.length === 0) return undefined;
  return stripMarkup(parts.join('\n\n'));
}

function normalizeLabel(raw: z.infer<typeof LabelResultSchema>): LabelHit {
  const hit: LabelHit = { raw };
  const ofda = raw.openfda;
  if (ofda?.spl_set_id?.[0] !== undefined) hit.setId = ofda.spl_set_id[0];
  if (ofda?.brand_name) hit.brandName = ofda.brand_name;
  if (ofda?.generic_name) hit.genericName = ofda.generic_name;
  if (ofda?.rxcui) hit.rxcui = ofda.rxcui;

  const indications = joinAndStrip(raw.indications_and_usage);
  const dosage = joinAndStrip(raw.dosage_and_administration);
  const warnings = joinAndStrip(raw.warnings);
  const contraindications = joinAndStrip(raw.contraindications);
  const adverseReactions = joinAndStrip(raw.adverse_reactions);
  const mechanism = joinAndStrip(raw.mechanism_of_action);
  const drugInteractions = joinAndStrip(raw.drug_interactions);

  if (indications !== undefined) hit.indications = indications;
  if (dosage !== undefined) hit.dosage = dosage;
  if (warnings !== undefined) hit.warnings = warnings;
  if (contraindications !== undefined) hit.contraindications = contraindications;
  if (adverseReactions !== undefined) hit.adverseReactions = adverseReactions;
  if (mechanism !== undefined) hit.mechanism = mechanism;
  if (drugInteractions !== undefined) hit.drugInteractions = drugInteractions;

  return hit;
}

// ---------- Client implementation ----------

function upstreamShapeError(detail: string): Result<never> {
  return {
    ok: false,
    error: {
      code: 'UPSTREAM_ERROR',
      message: detail,
      retryable: false,
    },
  };
}

// Shared cache+rate+fetch+parse chain for label requests. Both the
// single-field searchLabels and the OR-query findLabelByDrug funnel through
// here so the cache key, rate limiter, and shape validation stay uniform.
async function executeLabelFetch(url: string): Promise<Result<LabelHit[]>> {
  const cacheKey = canonicalize(url);
  const cached = openFdaCache.get(cacheKey) as Result<LabelHit[]> | undefined;
  if (cached !== undefined) return cached;

  await openFdaLimiter.acquire();
  const http = await fetchJson(url);
  if (!http.ok) return { ok: false, error: http.error };

  const parsed = LabelResponseSchema.safeParse(http.data);
  if (!parsed.success) {
    return upstreamShapeError(
      'OpenFDA label response did not match expected shape',
    );
  }

  const hits = parsed.data.results.map(normalizeLabel);
  const result: Result<LabelHit[]> = { ok: true, data: hits };
  openFdaCache.set(cacheKey, result);
  return result;
}

async function executeEventsFetch(
  url: string,
): Promise<Result<AdverseEventCount[]>> {
  const cacheKey = canonicalize(url);
  const cached = openFdaCache.get(cacheKey) as
    | Result<AdverseEventCount[]>
    | undefined;
  if (cached !== undefined) return cached;

  await openFdaLimiter.acquire();
  const http = await fetchJson(url);
  if (!http.ok) return { ok: false, error: http.error };

  const parsed = EventResponseSchema.safeParse(http.data);
  if (!parsed.success) {
    return upstreamShapeError(
      'OpenFDA event response did not match expected shape',
    );
  }

  const result: Result<AdverseEventCount[]> = {
    ok: true,
    data: parsed.data.results,
  };
  openFdaCache.set(cacheKey, result);
  return result;
}

class DefaultOpenFdaClient implements OpenFdaClient {
  searchLabels(opts: SearchLabelsOptions): Promise<Result<LabelHit[]>> {
    return executeLabelFetch(buildLabelsUrl(opts));
  }

  topAdverseEvents(
    opts: TopAdverseEventsOptions,
  ): Promise<Result<AdverseEventCount[]>> {
    return executeEventsFetch(buildEventsUrl(opts));
  }

  findLabelByDrug(opts: FindLabelByDrugOptions): Promise<Result<LabelHit[]>> {
    // Single OR-query: rxcui OR generic_name in one round trip. See
    // buildOrClause for why this beats sequential fallback (openFDA's
    // 404-as-zero-hits, missing IN-level RxCUIs in openfda.rxcui arrays).
    return executeLabelFetch(buildLabelsOrUrl(opts));
  }

  findAdverseEventsByDrug(
    opts: FindAdverseEventsByDrugOptions,
  ): Promise<Result<AdverseEventCount[]>> {
    return executeEventsFetch(buildEventsOrUrl(opts));
  }
}

export const openFda: OpenFdaClient = new DefaultOpenFdaClient();
