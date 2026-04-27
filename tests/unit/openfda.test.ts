/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/http');

import { openFdaCache } from '../../src/lib/cache';
import { fetchJson } from '../../src/lib/http';
import { openFda } from '../../src/lib/openfda';
import { openFdaLimiter } from '../../src/lib/ratelimit';

const fetchJsonMock = vi.mocked(fetchJson);

function httpSuccess(data: unknown): Awaited<ReturnType<typeof fetchJson>> {
  return { ok: true, data, status: 200, headers: new Headers() };
}

describe('openFda.searchLabels', () => {
  beforeEach(() => {
    openFdaCache.clear();
    fetchJsonMock.mockReset();
  });

  it('builds the correct openFDA labels URL with default limit of 5', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));

    await openFda.searchLabels({ field: 'openfda.rxcui', value: '12345' });

    const url = fetchJsonMock.mock.calls[0]?.[0] ?? '';
    const u = new URL(url);
    expect(`${u.protocol}//${u.host}${u.pathname}`).toBe(
      'https://api.fda.gov/drug/label.json',
    );
    expect(u.searchParams.get('search')).toBe('openfda.rxcui:"12345"');
    expect(u.searchParams.get('limit')).toBe('5');
  });

  it('clamps limit to the openFDA-supported range [1, 100]', async () => {
    fetchJsonMock.mockResolvedValue(httpSuccess({ results: [] }));

    await openFda.searchLabels({
      field: 'openfda.brand_name',
      value: 'aspirin',
      limit: 999,
    });
    const high = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(high.searchParams.get('limit')).toBe('100');

    await openFda.searchLabels({
      field: 'openfda.brand_name',
      value: 'tylenol',
      limit: 0,
    });
    const low = new URL(fetchJsonMock.mock.calls[1]?.[0] ?? '');
    expect(low.searchParams.get('limit')).toBe('1');
  });

  it('escapes quote and backslash chars in the search value', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));

    await openFda.searchLabels({
      field: 'openfda.brand_name',
      value: 'a"b\\c',
    });

    const u = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(u.searchParams.get('search')).toBe(
      'openfda.brand_name:"a\\"b\\\\c"',
    );
  });

  it('normalizes openFDA label results into LabelHit shape and strips SGML', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        results: [
          {
            indications_and_usage: ['<p>For   pain relief</p>'],
            dosage_and_administration: ['Take 1   tablet  daily'],
            warnings: ['<b>Severe warning</b>'],
            contraindications: ['Hypersensitivity'],
            adverse_reactions: ['Rash'],
            mechanism_of_action: ['Inhibits COX'],
            openfda: {
              brand_name: ['Tylenol'],
              generic_name: ['Acetaminophen'],
              rxcui: ['1234'],
              spl_set_id: ['abc-spl'],
            },
          },
        ],
      }),
    );

    const result = await openFda.searchLabels({
      field: 'openfda.brand_name',
      value: 'Tylenol',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    const hit = result.data[0];
    expect(hit?.setId).toBe('abc-spl');
    expect(hit?.brandName).toEqual(['Tylenol']);
    expect(hit?.genericName).toEqual(['Acetaminophen']);
    expect(hit?.rxcui).toEqual(['1234']);
    expect(hit?.indications).toBe('For pain relief');
    expect(hit?.warnings).toBe('Severe warning');
    expect(hit?.dosage).toBe('Take 1 tablet daily');
    expect(hit?.contraindications).toBe('Hypersensitivity');
    expect(hit?.adverseReactions).toBe('Rash');
    expect(hit?.mechanism).toBe('Inhibits COX');
    expect(hit?.raw).toBeDefined();
  });

  it('surfaces the drug_interactions section as drugInteractions', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        results: [
          {
            drug_interactions: ['<p>Concomitant warfarin increases bleeding risk.</p>'],
            openfda: { rxcui: ['1191'] },
          },
        ],
      }),
    );

    const result = await openFda.searchLabels({
      field: 'openfda.rxcui',
      value: '1191',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]?.drugInteractions).toBe(
      'Concomitant warfarin increases bleeding risk.',
    );
  });

  it('handles missing optional fields without crashing', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [{}] }));

    const result = await openFda.searchLabels({
      field: 'openfda.brand_name',
      value: 'X',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hit = result.data[0];
    expect(hit?.indications).toBeUndefined();
    expect(hit?.brandName).toBeUndefined();
    expect(hit?.setId).toBeUndefined();
    expect(hit?.drugInteractions).toBeUndefined();
  });

  it('returns the cached value on a second identical call without re-fetching', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        results: [{ openfda: { spl_set_id: ['x'] } }],
      }),
    );

    const a = await openFda.searchLabels({
      field: 'openfda.brand_name',
      value: 'aspirin',
    });
    const b = await openFda.searchLabels({
      field: 'openfda.brand_name',
      value: 'aspirin',
    });

    expect(a).toEqual(b);
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });

  it('passes through DATA_NOT_FOUND from the http layer untouched', async () => {
    fetchJsonMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'DATA_NOT_FOUND', message: 'no match' },
    });

    const result = await openFda.searchLabels({
      field: 'openfda.rxcui',
      value: '999',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DATA_NOT_FOUND');
  });

  it('rejects malformed openFDA responses with UPSTREAM_ERROR', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ wrong: 'shape' }));

    const result = await openFda.searchLabels({
      field: 'openfda.rxcui',
      value: '999',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UPSTREAM_ERROR');
  });

  it('acquires a token from the openFDA rate limiter for every miss', async () => {
    const acquireSpy = vi.spyOn(openFdaLimiter, 'acquire');
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));

    await openFda.searchLabels({ field: 'openfda.rxcui', value: '1' });

    expect(acquireSpy).toHaveBeenCalledTimes(1);
    acquireSpy.mockRestore();
  });
});

describe('openFda.topAdverseEvents', () => {
  beforeEach(() => {
    openFdaCache.clear();
    fetchJsonMock.mockReset();
  });

  it('builds the event count URL with the default reaction-term field', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));

    await openFda.topAdverseEvents({
      field: 'patient.drug.openfda.rxcui',
      value: '12345',
    });

    const u = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(u.pathname).toBe('/drug/event.json');
    expect(u.searchParams.get('search')).toBe(
      'patient.drug.openfda.rxcui:"12345"',
    );
    expect(u.searchParams.get('count')).toBe(
      'patient.reaction.reactionmeddrapt.exact',
    );
  });

  it('returns parsed term/count pairs in upstream order', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        results: [
          { term: 'headache', count: 1234 },
          { term: 'nausea', count: 567 },
        ],
      }),
    );

    const result = await openFda.topAdverseEvents({
      field: 'patient.drug.openfda.rxcui',
      value: '12345',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      { term: 'headache', count: 1234 },
      { term: 'nausea', count: 567 },
    ]);
  });

  it('rejects malformed event responses with UPSTREAM_ERROR', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ results: [{ wrong: 'shape' }] }),
    );

    const result = await openFda.topAdverseEvents({
      field: 'patient.drug.openfda.rxcui',
      value: '12345',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UPSTREAM_ERROR');
  });

  it('caches event results across identical calls', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));

    await openFda.topAdverseEvents({
      field: 'patient.drug.openfda.rxcui',
      value: '12345',
    });
    await openFda.topAdverseEvents({
      field: 'patient.drug.openfda.rxcui',
      value: '12345',
    });

    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });
});

describe('openFda.findLabelByDrug (OR-query)', () => {
  beforeEach(() => {
    openFdaCache.clear();
    fetchJsonMock.mockReset();
  });

  it('issues a single OR-query covering rxcui and generic_name', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ results: [{ openfda: { spl_set_id: ['set-x'] } }] }),
    );

    const result = await openFda.findLabelByDrug({
      rxcui: '11289',
      genericName: 'Warfarin',
      limit: 1,
    });

    expect(result.ok).toBe(true);
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(url.pathname).toBe('/drug/label.json');
    expect(url.searchParams.get('search')).toBe(
      'openfda.rxcui:"11289" OR openfda.generic_name:"warfarin"',
    );
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('lowercases the generic name (case-folded indexing in openFDA)', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));
    await openFda.findLabelByDrug({
      rxcui: '1191',
      genericName: 'ASPIRIN',
    });
    const url = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(url.searchParams.get('search')).toContain(
      'openfda.generic_name:"aspirin"',
    );
  });

  it('encodes the OR clause with + between clauses, never literal %2B', async () => {
    // Regression for the v0.1.3 RxNav bug class: putting a literal '+' in
    // the input would encode to '%2B' and break the openFDA query parser.
    // Using a literal space (which URLSearchParams encodes to '+') keeps
    // the wire form ' OR ' intact.
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));
    await openFda.findLabelByDrug({ rxcui: '11289', genericName: 'warfarin' });
    const rawUrl = fetchJsonMock.mock.calls[0]?.[0] ?? '';
    expect(rawUrl).toContain('+OR+');
    expect(rawUrl).not.toContain('%2BOR%2B');
  });

  it('propagates a DATA_NOT_FOUND from openFDA (404) without retrying', async () => {
    // openFDA returns 404 for "no matches"; the http chokepoint maps that
    // to DATA_NOT_FOUND. With OR-query that error means neither index
    // had hits and there is no fallback to attempt.
    fetchJsonMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'DATA_NOT_FOUND', message: 'Not found at <url>' },
    });

    const result = await openFda.findLabelByDrug({
      rxcui: '99999',
      genericName: 'zzznotadrug',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DATA_NOT_FOUND');
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });

  it('escapes Lucene-special chars in the rxcui and generic name', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));
    await openFda.findLabelByDrug({
      rxcui: 'a"b',
      genericName: 'name"with-quotes',
    });
    const url = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    // Embedded quotes are backslash-escaped so they don't terminate the
    // quoted phrase in openFDA's Lucene parser.
    expect(url.searchParams.get('search')).toBe(
      'openfda.rxcui:"a\\"b" OR openfda.generic_name:"name\\"with-quotes"',
    );
  });
});

describe('openFda.findAdverseEventsByDrug (OR-query)', () => {
  beforeEach(() => {
    openFdaCache.clear();
    fetchJsonMock.mockReset();
  });

  it('issues a single OR-query against patient.drug.openfda.* fields', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ results: [{ term: 'INR INCREASED', count: 10374 }] }),
    );

    const result = await openFda.findAdverseEventsByDrug({
      rxcui: '11289',
      genericName: 'Warfarin',
      limit: 10,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]?.count).toBe(10374);
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(url.pathname).toBe('/drug/event.json');
    expect(url.searchParams.get('search')).toBe(
      'patient.drug.openfda.rxcui:"11289" OR patient.drug.openfda.generic_name:"warfarin"',
    );
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('uses the default reaction-term count field when none supplied', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));
    await openFda.findAdverseEventsByDrug({
      rxcui: '11289',
      genericName: 'warfarin',
    });
    const url = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(url.searchParams.get('count')).toBe(
      'patient.reaction.reactionmeddrapt.exact',
    );
  });

  it('passes through a caller-supplied countField verbatim', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));
    await openFda.findAdverseEventsByDrug({
      rxcui: '11289',
      genericName: 'warfarin',
      countField: 'patient.reaction.reactionoutcome',
    });
    const url = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(url.searchParams.get('count')).toBe(
      'patient.reaction.reactionoutcome',
    );
  });

  it('lowercases the generic name and uses + between OR clauses on the wire', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));
    await openFda.findAdverseEventsByDrug({
      rxcui: '11289',
      genericName: 'WARFARIN',
    });
    const rawUrl = fetchJsonMock.mock.calls[0]?.[0] ?? '';
    expect(rawUrl).toContain('+OR+');
    expect(rawUrl).not.toContain('%2BOR%2B');
    expect(rawUrl).toContain('generic_name%3A%22warfarin%22');
  });
});
