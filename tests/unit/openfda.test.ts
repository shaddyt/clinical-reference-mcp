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

describe('openFda.findLabelByDrug', () => {
  beforeEach(() => {
    openFdaCache.clear();
    fetchJsonMock.mockReset();
  });

  it('returns the RxCUI hit when openfda.rxcui search succeeds', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ results: [{ openfda: { spl_set_id: ['set-rx'] } }] }),
    );

    const result = await openFda.findLabelByDrug({
      rxcui: '11289',
      genericName: 'warfarin',
      limit: 1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]?.setId).toBe('set-rx');
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(url.searchParams.get('search')).toBe('openfda.rxcui:"11289"');
  });

  it('falls back to openfda.generic_name when the RxCUI search returns 0 hits', async () => {
    // Regression for the demo bug: aspirin (RxCUI 1191) labels exist in
    // openFDA but are not RxCUI-indexed. Without this fallback,
    // get_drug_label aspirin would return DATA_NOT_FOUND.
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        results: [
          { openfda: { spl_set_id: ['set-aspirin-by-name'], generic_name: ['ASPIRIN'] } },
        ],
      }),
    );

    const result = await openFda.findLabelByDrug({
      rxcui: '1191',
      genericName: 'aspirin',
      limit: 1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]?.setId).toBe('set-aspirin-by-name');
    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
    const fallbackUrl = new URL(fetchJsonMock.mock.calls[1]?.[0] ?? '');
    expect(fallbackUrl.searchParams.get('search')).toBe('openfda.generic_name:"aspirin"');
  });

  it('returns empty data when both RxCUI and generic_name searches miss', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));

    const result = await openFda.findLabelByDrug({
      rxcui: '99999',
      genericName: 'zzznotadrug',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
  });

  it('propagates an upstream error from the RxCUI search without attempting fallback', async () => {
    fetchJsonMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'fda 503', retryable: true },
    });

    const result = await openFda.findLabelByDrug({
      rxcui: '1191',
      genericName: 'aspirin',
    });

    expect(result.ok).toBe(false);
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });
});

describe('openFda.findAdverseEventsByDrug', () => {
  beforeEach(() => {
    openFdaCache.clear();
    fetchJsonMock.mockReset();
  });

  it('returns the RxCUI hits when patient.drug.openfda.rxcui count succeeds', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ results: [{ term: 'nausea', count: 42 }] }),
    );

    const result = await openFda.findAdverseEventsByDrug({
      rxcui: '11289',
      genericName: 'warfarin',
      limit: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]?.count).toBe(42);
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(url.searchParams.get('search')).toBe('patient.drug.openfda.rxcui:"11289"');
  });

  it('falls back to patient.drug.openfda.generic_name when RxCUI count returns 0', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ results: [] }));
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ results: [{ term: 'nausea', count: 7 }] }),
    );

    const result = await openFda.findAdverseEventsByDrug({
      rxcui: '1191',
      genericName: 'aspirin',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]?.term).toBe('nausea');
    const fallbackUrl = new URL(fetchJsonMock.mock.calls[1]?.[0] ?? '');
    expect(fallbackUrl.searchParams.get('search')).toBe(
      'patient.drug.openfda.generic_name:"aspirin"',
    );
  });
});
