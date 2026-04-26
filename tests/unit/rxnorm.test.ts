/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/http');

import { rxNormCache } from '../../src/lib/cache';
import { fetchJson } from '../../src/lib/http';
import { rxNorm } from '../../src/lib/rxnorm';
import { rxNavLimiter } from '../../src/lib/ratelimit';

const fetchJsonMock = vi.mocked(fetchJson);

function httpSuccess(data: unknown): Awaited<ReturnType<typeof fetchJson>> {
  return { ok: true, data, status: 200, headers: new Headers() };
}

beforeEach(() => {
  rxNormCache.clear();
  fetchJsonMock.mockReset();
});

// ---------- approximateMatch ----------

describe('rxNorm.approximateMatch', () => {
  it('builds the approximateTerm URL with default maxEntries', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ approximateGroup: { candidate: [] } }),
    );

    await rxNorm.approximateMatch('tylenol');

    const u = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(`${u.protocol}//${u.host}${u.pathname}`).toBe(
      'https://rxnav.nlm.nih.gov/REST/approximateTerm.json',
    );
    expect(u.searchParams.get('term')).toBe('tylenol');
    expect(u.searchParams.get('maxEntries')).toBe('5');
  });

  it('passes a caller-supplied maxEntries through', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ approximateGroup: { candidate: [] } }),
    );

    await rxNorm.approximateMatch('aspirin', 12);

    const u = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(u.searchParams.get('maxEntries')).toBe('12');
  });

  it('parses candidates and coerces score/rank from strings', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        approximateGroup: {
          candidate: [
            {
              rxcui: '202433',
              name: 'tylenol',
              score: '95',
              rank: '1',
              source: 'RXNORM',
            },
            {
              rxcui: '161',
              name: 'acetaminophen',
              score: '78',
              rank: '2',
              source: 'RXNORM',
            },
          ],
        },
      }),
    );

    const result = await rxNorm.approximateMatch('tylenol');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      { rxcui: '202433', name: 'tylenol', score: 95, rank: 1, source: 'RXNORM' },
      {
        rxcui: '161',
        name: 'acetaminophen',
        score: 78,
        rank: 2,
        source: 'RXNORM',
      },
    ]);
  });

  it('preserves upstream ordering (no re-sorting by score)', async () => {
    // Upstream sometimes returns candidates rank-ordered but with quirky
    // scores; we trust their ranking and pass it through unchanged.
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        approximateGroup: {
          candidate: [
            { rxcui: '1', name: 'a', score: '50', rank: '1', source: 'RXNORM' },
            { rxcui: '2', name: 'b', score: '90', rank: '2', source: 'RXNORM' },
          ],
        },
      }),
    );

    const result = await rxNorm.approximateMatch('x');
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.map((c) => c.rxcui)).toEqual(['1', '2']);
  });

  it('returns an empty array when candidate is null', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ approximateGroup: { candidate: null } }),
    );

    const result = await rxNorm.approximateMatch('nonsense');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });

  it('returns an empty array when candidate is missing entirely', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ approximateGroup: {} }),
    );

    const result = await rxNorm.approximateMatch('nonsense');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });

  it('rejects malformed responses with UPSTREAM_ERROR', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ wrong: 'shape' }));
    const result = await rxNorm.approximateMatch('x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UPSTREAM_ERROR');
  });
});

// ---------- getProperties ----------

describe('rxNorm.getProperties', () => {
  it('builds the properties URL with the rxcui in the path', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        properties: { rxcui: '161', name: 'Acetaminophen', tty: 'IN' },
      }),
    );

    await rxNorm.getProperties('161');

    const url = fetchJsonMock.mock.calls[0]?.[0] ?? '';
    expect(url).toBe('https://rxnav.nlm.nih.gov/REST/rxcui/161/properties.json');
  });

  it('returns DrugProperties when the rxcui is known', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        properties: {
          rxcui: '161',
          name: 'Acetaminophen',
          synonym: 'APAP',
          tty: 'IN',
          language: 'ENG',
        },
      }),
    );

    const result = await rxNorm.getProperties('161');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      rxcui: '161',
      name: 'Acetaminophen',
      synonym: 'APAP',
      tty: 'IN',
      language: 'ENG',
    });
  });

  it('returns DATA_NOT_FOUND when properties is null', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ properties: null }));

    const result = await rxNorm.getProperties('99999999');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DATA_NOT_FOUND');
  });

  it('returns DATA_NOT_FOUND when properties is missing entirely', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({}));

    const result = await rxNorm.getProperties('99999999');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DATA_NOT_FOUND');
  });
});

// ---------- getRelated ----------

describe('rxNorm.getRelated', () => {
  it('joins requested term types with "+" in the tty query param', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ relatedGroup: { conceptGroup: [] } }),
    );

    await rxNorm.getRelated('161', ['IN', 'BN']);

    const u = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(u.pathname).toBe('/REST/rxcui/161/related.json');
    expect(u.searchParams.get('tty')).toBe('IN+BN');
  });

  it('flattens conceptGroup → conceptProperties into RelatedConcept[]', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        relatedGroup: {
          conceptGroup: [
            {
              tty: 'IN',
              conceptProperties: [
                { rxcui: '161', name: 'Acetaminophen', tty: 'IN' },
              ],
            },
            {
              tty: 'BN',
              conceptProperties: [
                { rxcui: '202433', name: 'Tylenol', tty: 'BN' },
              ],
            },
          ],
        },
      }),
    );

    const result = await rxNorm.getRelated('161', ['IN', 'BN']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      { rxcui: '161', name: 'Acetaminophen', tty: 'IN' },
      { rxcui: '202433', name: 'Tylenol', tty: 'BN' },
    ]);
  });

  it('returns an empty array when conceptGroup is missing or null', async () => {
    fetchJsonMock.mockResolvedValueOnce(httpSuccess({ relatedGroup: {} }));
    const a = await rxNorm.getRelated('161', ['IN']);
    if (!a.ok) throw new Error('expected ok');
    expect(a.data).toEqual([]);
  });

  it('drops conceptGroup entries with null conceptProperties', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        relatedGroup: {
          conceptGroup: [
            { tty: 'SCD', conceptProperties: null },
            {
              tty: 'IN',
              conceptProperties: [
                { rxcui: '161', name: 'Acetaminophen', tty: 'IN' },
              ],
            },
          ],
        },
      }),
    );

    const result = await rxNorm.getRelated('161', ['IN', 'SCD']);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toEqual([
      { rxcui: '161', name: 'Acetaminophen', tty: 'IN' },
    ]);
  });
});

// ---------- getClasses ----------

describe('rxNorm.getClasses', () => {
  it('builds the byRxcui URL with relaSource=ATC', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ rxclassDrugInfoList: { rxclassDrugInfo: [] } }),
    );

    await rxNorm.getClasses('161');

    const u = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(u.pathname).toBe('/REST/rxclass/class/byRxcui.json');
    expect(u.searchParams.get('rxcui')).toBe('161');
    expect(u.searchParams.get('relaSource')).toBe('ATC');
  });

  it('flattens rxclassDrugInfo into DrugClass[]', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        rxclassDrugInfoList: {
          rxclassDrugInfo: [
            {
              rxclassMinConceptItem: {
                classId: 'N02BE01',
                className: 'paracetamol',
                classType: 'ATC1-4',
              },
              relaSource: 'ATC',
            },
          ],
        },
      }),
    );

    const result = await rxNorm.getClasses('161');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      {
        classId: 'N02BE01',
        className: 'paracetamol',
        classType: 'ATC1-4',
        relaSource: 'ATC',
      },
    ]);
  });

  it('returns [] for an empty rxclassDrugInfoList', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ rxclassDrugInfoList: {} }),
    );
    const result = await rxNorm.getClasses('99999');
    if (!result.ok) throw new Error('expected ok');
    expect(result.data).toEqual([]);
  });
});

// ---------- getClassMembers ----------

describe('rxNorm.getClassMembers', () => {
  it('builds the classMembers URL with default ttys=IN', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ drugMemberGroup: { drugMember: [] } }),
    );

    await rxNorm.getClassMembers('N02BE');

    const u = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(u.pathname).toBe('/REST/rxclass/classMembers.json');
    expect(u.searchParams.get('classId')).toBe('N02BE');
    expect(u.searchParams.get('relaSource')).toBe('ATC');
    expect(u.searchParams.get('ttys')).toBe('IN');
  });

  it('joins multiple ttys with "+"', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ drugMemberGroup: { drugMember: [] } }),
    );

    await rxNorm.getClassMembers('N02BE', ['IN', 'PIN']);

    const u = new URL(fetchJsonMock.mock.calls[0]?.[0] ?? '');
    expect(u.searchParams.get('ttys')).toBe('IN+PIN');
  });

  it('flattens drugMember into ClassMember[]', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        drugMemberGroup: {
          drugMember: [
            {
              minConcept: { rxcui: '161', name: 'Acetaminophen', tty: 'IN' },
            },
            { minConcept: { rxcui: '5640', name: 'Ibuprofen', tty: 'IN' } },
          ],
        },
      }),
    );

    const result = await rxNorm.getClassMembers('N02BE');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      { rxcui: '161', name: 'Acetaminophen', tty: 'IN' },
      { rxcui: '5640', name: 'Ibuprofen', tty: 'IN' },
    ]);
  });
});

// ---------- shared infrastructure ----------

describe('rxNorm — caching and rate limiting', () => {
  it('reuses the cached value on a second identical call', async () => {
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({
        properties: { rxcui: '161', name: 'Acetaminophen', tty: 'IN' },
      }),
    );

    await rxNorm.getProperties('161');
    await rxNorm.getProperties('161');

    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });

  it('acquires a token from the RxNav rate limiter on miss', async () => {
    const acquireSpy = vi.spyOn(rxNavLimiter, 'acquire');
    fetchJsonMock.mockResolvedValueOnce(
      httpSuccess({ approximateGroup: { candidate: [] } }),
    );

    await rxNorm.approximateMatch('x');

    expect(acquireSpy).toHaveBeenCalledTimes(1);
    acquireSpy.mockRestore();
  });
});
