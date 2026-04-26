/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

import { rxNormCache } from './cache';
import { fetchJson } from './http';
import { rxNavLimiter } from './ratelimit';
import type { Result, ToolError } from './types';

const BASE = 'https://rxnav.nlm.nih.gov/REST';

const APPROXIMATE_DEFAULT_MAX = 5;

// RxNav classification queries default to ATC because that's the only
// vocabulary RxNav exposes consistently for non-US drugs and is what the
// `find_alternatives` MCP tool downstream is shaped around.
const RELA_SOURCE_ATC = 'ATC';

// Default term type when listing class members. IN ("ingredient") gives the
// most useful denominator for "other drugs in this class" — it's the level
// at which therapeutic equivalence is meaningful.
const DEFAULT_CLASS_MEMBER_TTY = 'IN';

// ---------- Public types ----------

export type RelatedTty = 'IN' | 'BN' | 'SCD' | 'SBD';

export interface MatchCandidate {
  rxcui: string;
  name: string;
  score: number;
  rank: number;
  source: string;
}

export interface DrugProperties {
  rxcui: string;
  name: string;
  synonym?: string;
  tty: string;
  language?: string;
}

export interface RelatedConcept {
  rxcui: string;
  name: string;
  tty: string;
}

export interface DrugClass {
  classId: string;
  className: string;
  classType: string;
  relaSource: string;
}

export interface ClassMember {
  rxcui: string;
  name: string;
  tty: string;
}

export interface RxNormClient {
  approximateMatch(
    name: string,
    maxEntries?: number,
  ): Promise<Result<MatchCandidate[]>>;
  getProperties(rxcui: string): Promise<Result<DrugProperties>>;
  getRelated(
    rxcui: string,
    relationships: RelatedTty[],
  ): Promise<Result<RelatedConcept[]>>;
  getClasses(rxcui: string): Promise<Result<DrugClass[]>>;
  getClassMembers(
    classId: string,
    ttys?: string[],
  ): Promise<Result<ClassMember[]>>;
}

// ---------- Boundary schemas ----------
//
// RxNav is famously inconsistent: missing keys, null instead of [], strings
// where numbers should be. We coerce at the boundary and normalize to clean
// shapes for callers; everything downstream can assume well-formed data.

const ApproximateCandidateSchema = z.object({
  rxcui: z.string(),
  name: z.string(),
  score: z.coerce.number(),
  rank: z.coerce.number(),
  source: z.string(),
});

const ApproximateResponseSchema = z.object({
  approximateGroup: z.object({
    candidate: z.array(ApproximateCandidateSchema).nullish(),
  }),
});

const PropertiesPayloadSchema = z.object({
  rxcui: z.string(),
  name: z.string(),
  synonym: z.string().optional(),
  tty: z.string(),
  language: z.string().optional(),
});

const PropertiesResponseSchema = z.object({
  properties: PropertiesPayloadSchema.nullish(),
});

const ConceptPropertySchema = z.object({
  rxcui: z.string(),
  name: z.string(),
  tty: z.string(),
});

const ConceptGroupSchema = z.object({
  tty: z.string().optional(),
  conceptProperties: z.array(ConceptPropertySchema).nullish(),
});

const RelatedResponseSchema = z.object({
  relatedGroup: z.object({
    conceptGroup: z.array(ConceptGroupSchema).nullish(),
  }),
});

const RxClassMinConceptItemSchema = z.object({
  classId: z.string(),
  className: z.string(),
  classType: z.string(),
});

const RxClassDrugInfoSchema = z.object({
  rxclassMinConceptItem: RxClassMinConceptItemSchema,
  relaSource: z.string(),
});

const ClassesResponseSchema = z.object({
  rxclassDrugInfoList: z
    .object({
      rxclassDrugInfo: z.array(RxClassDrugInfoSchema).nullish(),
    })
    .nullish(),
});

const ClassMemberSchema = z.object({
  minConcept: ConceptPropertySchema,
});

const ClassMembersResponseSchema = z.object({
  drugMemberGroup: z
    .object({
      drugMember: z.array(ClassMemberSchema).nullish(),
    })
    .nullish(),
});

// ---------- URL builders ----------

function buildApproximateUrl(name: string, maxEntries: number): string {
  const params = new URLSearchParams();
  params.set('term', name);
  params.set('maxEntries', String(maxEntries));
  return `${BASE}/approximateTerm.json?${params.toString()}`;
}

function buildPropertiesUrl(rxcui: string): string {
  return `${BASE}/rxcui/${encodeURIComponent(rxcui)}/properties.json`;
}

function buildRelatedUrl(rxcui: string, relationships: RelatedTty[]): string {
  const params = new URLSearchParams();
  params.set('tty', relationships.join('+'));
  return `${BASE}/rxcui/${encodeURIComponent(rxcui)}/related.json?${params.toString()}`;
}

function buildClassesUrl(rxcui: string): string {
  const params = new URLSearchParams();
  params.set('rxcui', rxcui);
  params.set('relaSource', RELA_SOURCE_ATC);
  return `${BASE}/rxclass/class/byRxcui.json?${params.toString()}`;
}

function buildClassMembersUrl(classId: string, ttys: string[]): string {
  const params = new URLSearchParams();
  params.set('classId', classId);
  params.set('relaSource', RELA_SOURCE_ATC);
  params.set('ttys', ttys.join('+'));
  return `${BASE}/rxclass/classMembers.json?${params.toString()}`;
}

// ---------- Helpers ----------

function shapeError(detail: string): ToolError {
  return {
    code: 'UPSTREAM_ERROR',
    message: detail,
    retryable: false,
  };
}

function notFoundError(detail: string): ToolError {
  return { code: 'DATA_NOT_FOUND', message: detail };
}

async function fetchAndCache<T extends NonNullable<unknown>>(
  url: string,
  parse: (data: unknown) => Result<T>,
): Promise<Result<T>> {
  const cached = rxNormCache.get(url) as Result<T> | undefined;
  if (cached !== undefined) return cached;

  await rxNavLimiter.acquire();
  const http = await fetchJson(url);
  if (!http.ok) return { ok: false, error: http.error };

  const result = parse(http.data);
  rxNormCache.set(url, result);
  return result;
}

// ---------- Client ----------

class DefaultRxNormClient implements RxNormClient {
  approximateMatch(
    name: string,
    maxEntries: number = APPROXIMATE_DEFAULT_MAX,
  ): Promise<Result<MatchCandidate[]>> {
    const url = buildApproximateUrl(name, maxEntries);
    return fetchAndCache(url, (data) => {
      const parsed = ApproximateResponseSchema.safeParse(data);
      if (!parsed.success) {
        return {
          ok: false,
          error: shapeError(
            'RxNav approximateTerm response did not match expected shape',
          ),
        };
      }
      const candidates = parsed.data.approximateGroup.candidate ?? [];
      return { ok: true, data: candidates };
    });
  }

  getProperties(rxcui: string): Promise<Result<DrugProperties>> {
    const url = buildPropertiesUrl(rxcui);
    return fetchAndCache(url, (data) => {
      const parsed = PropertiesResponseSchema.safeParse(data);
      if (!parsed.success) {
        return {
          ok: false,
          error: shapeError(
            'RxNav properties response did not match expected shape',
          ),
        };
      }
      const props = parsed.data.properties;
      if (!props) {
        return {
          ok: false,
          error: notFoundError(`No RxNorm properties for rxcui ${rxcui}`),
        };
      }
      const drug: DrugProperties = {
        rxcui: props.rxcui,
        name: props.name,
        tty: props.tty,
      };
      if (props.synonym !== undefined) drug.synonym = props.synonym;
      if (props.language !== undefined) drug.language = props.language;
      return { ok: true, data: drug };
    });
  }

  getRelated(
    rxcui: string,
    relationships: RelatedTty[],
  ): Promise<Result<RelatedConcept[]>> {
    const url = buildRelatedUrl(rxcui, relationships);
    return fetchAndCache(url, (data) => {
      const parsed = RelatedResponseSchema.safeParse(data);
      if (!parsed.success) {
        return {
          ok: false,
          error: shapeError(
            'RxNav related response did not match expected shape',
          ),
        };
      }
      const groups = parsed.data.relatedGroup.conceptGroup ?? [];
      const concepts: RelatedConcept[] = [];
      for (const group of groups) {
        for (const c of group.conceptProperties ?? []) {
          concepts.push({ rxcui: c.rxcui, name: c.name, tty: c.tty });
        }
      }
      return { ok: true, data: concepts };
    });
  }

  getClasses(rxcui: string): Promise<Result<DrugClass[]>> {
    const url = buildClassesUrl(rxcui);
    return fetchAndCache(url, (data) => {
      const parsed = ClassesResponseSchema.safeParse(data);
      if (!parsed.success) {
        return {
          ok: false,
          error: shapeError(
            'RxNav byRxcui response did not match expected shape',
          ),
        };
      }
      const list = parsed.data.rxclassDrugInfoList?.rxclassDrugInfo ?? [];
      const classes = list.map<DrugClass>((entry) => ({
        classId: entry.rxclassMinConceptItem.classId,
        className: entry.rxclassMinConceptItem.className,
        classType: entry.rxclassMinConceptItem.classType,
        relaSource: entry.relaSource,
      }));
      return { ok: true, data: classes };
    });
  }

  getClassMembers(
    classId: string,
    ttys: string[] = [DEFAULT_CLASS_MEMBER_TTY],
  ): Promise<Result<ClassMember[]>> {
    const url = buildClassMembersUrl(classId, ttys);
    return fetchAndCache(url, (data) => {
      const parsed = ClassMembersResponseSchema.safeParse(data);
      if (!parsed.success) {
        return {
          ok: false,
          error: shapeError(
            'RxNav classMembers response did not match expected shape',
          ),
        };
      }
      const members = parsed.data.drugMemberGroup?.drugMember ?? [];
      const flat = members.map<ClassMember>((m) => ({
        rxcui: m.minConcept.rxcui,
        name: m.minConcept.name,
        tty: m.minConcept.tty,
      }));
      return { ok: true, data: flat };
    });
  }
}

export const rxNorm: RxNormClient = new DefaultRxNormClient();
