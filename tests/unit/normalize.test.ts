/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/rxnorm', () => ({
  rxNorm: {
    approximateMatch: vi.fn(),
    getProperties: vi.fn(),
    getRelated: vi.fn(),
    getClasses: vi.fn(),
    getClassMembers: vi.fn(),
  },
}));

import { normalizeDrugName } from '../../src/lib/normalize';
import { rxNorm } from '../../src/lib/rxnorm';
import type { MatchCandidate, DrugProperties } from '../../src/lib/rxnorm';

const approximateMock = vi.mocked(rxNorm.approximateMatch);
const propertiesMock = vi.mocked(rxNorm.getProperties);

beforeEach(() => {
  approximateMock.mockReset();
  propertiesMock.mockReset();
});

function candidate(rxcui: string, name: string, score: number, rank = 1): MatchCandidate {
  return { rxcui, name, score, rank, source: 'RXNORM' };
}

function properties(rxcui: string, name: string): DrugProperties {
  return { rxcui, name, tty: 'IN' };
}

describe('normalizeDrugName — input validation', () => {
  it('rejects empty input with INVALID_INPUT', async () => {
    const result = await normalizeDrugName('');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects whitespace-only input with INVALID_INPUT', async () => {
    const result = await normalizeDrugName('   \n\t');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects input over 200 chars with INVALID_INPUT', async () => {
    const result = await normalizeDrugName('a'.repeat(201));
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('does not call upstream for invalid inputs', async () => {
    await normalizeDrugName('');
    expect(approximateMock).not.toHaveBeenCalled();
    expect(propertiesMock).not.toHaveBeenCalled();
  });
});

describe('normalizeDrugName — numeric input (RxCUI lookup)', () => {
  it('treats a pure-numeric input as an RxCUI and resolves on hit', async () => {
    propertiesMock.mockResolvedValueOnce({
      ok: true,
      data: properties('161', 'Acetaminophen'),
    });

    const result = await normalizeDrugName('161');

    expect(result).toEqual({
      kind: 'resolved',
      rxcui: '161',
      name: 'Acetaminophen',
      source: 'rxcui',
    });
    expect(approximateMock).not.toHaveBeenCalled();
  });

  it('falls through to approximateMatch when the RxCUI is not found', async () => {
    propertiesMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'DATA_NOT_FOUND', message: 'not found' },
    });
    approximateMock.mockResolvedValueOnce({
      ok: true,
      data: [candidate('999', '999', 50)],
    });

    const result = await normalizeDrugName('99999');

    expect(propertiesMock).toHaveBeenCalledWith('99999');
    expect(approximateMock).toHaveBeenCalledWith('99999', 5);
    expect(result.kind).toBe('resolved');
  });

  it('propagates a non-not-found error from getProperties as error kind', async () => {
    propertiesMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'boom', retryable: true },
    });

    const result = await normalizeDrugName('123');

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error.code).toBe('UPSTREAM_ERROR');
    }
    expect(approximateMock).not.toHaveBeenCalled();
  });
});

describe('normalizeDrugName — approximate matching', () => {
  it('returns not_found when there are zero candidates', async () => {
    approximateMock.mockResolvedValueOnce({ ok: true, data: [] });

    const result = await normalizeDrugName('zzzznotadrug');

    expect(result.kind).toBe('not_found');
  });

  it('resolves with source=approximate for a single candidate', async () => {
    approximateMock.mockResolvedValueOnce({
      ok: true,
      data: [candidate('161', 'Acetaminophen', 75)],
    });

    const result = await normalizeDrugName('acetaminofen');

    expect(result).toEqual({
      kind: 'resolved',
      rxcui: '161',
      name: 'Acetaminophen',
      source: 'approximate',
    });
  });

  it('resolves with source=exact when top score ≥ 90 and beats runner-up by ≥ 5', async () => {
    approximateMock.mockResolvedValueOnce({
      ok: true,
      data: [candidate('161', 'Acetaminophen', 95, 1), candidate('999', 'Other', 80, 2)],
    });

    const result = await normalizeDrugName('acetaminophen');

    expect(result).toEqual({
      kind: 'resolved',
      rxcui: '161',
      name: 'Acetaminophen',
      source: 'exact',
    });
  });

  it('treats top score = 90 and runner-up = 85 as exact (boundary)', async () => {
    approximateMock.mockResolvedValueOnce({
      ok: true,
      data: [candidate('161', 'Acetaminophen', 90, 1), candidate('999', 'Other', 85, 2)],
    });

    const result = await normalizeDrugName('acetaminophen');
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') expect(result.source).toBe('exact');
  });

  it('returns ambiguous when top score is high but the gap is too small', async () => {
    approximateMock.mockResolvedValueOnce({
      ok: true,
      data: [candidate('1', 'Drug A', 95, 1), candidate('2', 'Drug B', 93, 2)],
    });

    const result = await normalizeDrugName('drug');

    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0]).toMatchObject({
        rxcui: '1',
        name: 'Drug A',
      });
      expect(result.candidates[0]?.reason).toMatch(/score|rank/i);
    }
  });

  it('returns ambiguous when top score is below 90', async () => {
    approximateMock.mockResolvedValueOnce({
      ok: true,
      data: [candidate('1', 'Drug A', 85, 1), candidate('2', 'Drug B', 70, 2)],
    });

    const result = await normalizeDrugName('drug');

    expect(result.kind).toBe('ambiguous');
  });

  // Regression for the v0.1.1 launch bug surfaced by `lookup-drug aspirin`:
  // RxNav returns one row per terminology source for the same drug. When
  // every row collapses to the same RxCUI, the resolver must return
  // resolved (not ambiguous), preferring the RXNORM source's canonical
  // name. This fixture mirrors the live shape from `aspirin`.
  it('collapses multi-source candidates that share an RxCUI to resolved', async () => {
    approximateMock.mockResolvedValueOnce({
      ok: true,
      data: [
        { rxcui: '1191', name: 'Aspirin', score: 10.36, rank: 1, source: 'USP' },
        {
          rxcui: '1191',
          name: 'aspirin',
          score: 10.36,
          rank: 1,
          source: 'RXNORM',
        },
        {
          rxcui: '1191',
          name: 'ASPIRIN',
          score: 10.36,
          rank: 1,
          source: 'VANDF',
        },
      ],
    });

    const result = await normalizeDrugName('aspirin');

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.rxcui).toBe('1191');
      expect(result.name).toBe('aspirin');
      expect(result.source).toBe('approximate');
    }
  });

  it('falls back to the top candidate when no RXNORM-sourced row exists', async () => {
    approximateMock.mockResolvedValueOnce({
      ok: true,
      data: [
        { rxcui: '1191', name: 'Aspirin', score: 10.36, rank: 1, source: 'USP' },
        {
          rxcui: '1191',
          name: 'ASPIRIN',
          score: 10.36,
          rank: 1,
          source: 'VANDF',
        },
      ],
    });

    const result = await normalizeDrugName('aspirin');

    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.rxcui).toBe('1191');
      expect(result.name).toBe('Aspirin');
    }
  });

  it('passes the trimmed query to approximateMatch', async () => {
    approximateMock.mockResolvedValueOnce({ ok: true, data: [] });

    await normalizeDrugName('   tylenol   ');

    expect(approximateMock).toHaveBeenCalledWith('tylenol', 5);
  });

  it('propagates errors from approximateMatch as error kind', async () => {
    approximateMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'rxnav down', retryable: true },
    });

    const result = await normalizeDrugName('aspirin');

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error.code).toBe('UPSTREAM_ERROR');
    }
  });
});
