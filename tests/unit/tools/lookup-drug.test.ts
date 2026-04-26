/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/normalize', () => ({
  normalizeDrugName: vi.fn(),
}));

vi.mock('../../../src/lib/rxnorm', () => ({
  rxNorm: {
    getProperties: vi.fn(),
    getRelated: vi.fn(),
    getClasses: vi.fn(),
    approximateMatch: vi.fn(),
    getClassMembers: vi.fn(),
  },
}));

import {
  lookupDrugDefinition,
  lookupDrugHandler,
} from '../../../src/server/tools/lookup-drug';
import { normalizeDrugName } from '../../../src/lib/normalize';
import { rxNorm } from '../../../src/lib/rxnorm';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../../src/lib/safety';
import { LookupDrugOutputSchema } from '../../../src/lib/types';

const normalizeMock = vi.mocked(normalizeDrugName);
const propertiesMock = vi.mocked(rxNorm.getProperties);
const relatedMock = vi.mocked(rxNorm.getRelated);
const classesMock = vi.mocked(rxNorm.getClasses);

beforeEach(() => {
  normalizeMock.mockReset();
  propertiesMock.mockReset();
  relatedMock.mockReset();
  classesMock.mockReset();
});

function setUpstream(opts: {
  rxcui: string;
  name: string;
  tty?: string;
  related?: Array<{ rxcui: string; name: string; tty: string }>;
  classes?: Array<{
    classId: string;
    className: string;
    classType: string;
    relaSource: string;
  }>;
}) {
  propertiesMock.mockResolvedValue({
    ok: true,
    data: { rxcui: opts.rxcui, name: opts.name, tty: opts.tty ?? 'IN' },
  });
  relatedMock.mockResolvedValue({ ok: true, data: opts.related ?? [] });
  classesMock.mockResolvedValue({ ok: true, data: opts.classes ?? [] });
}

describe('lookup_drug — definition', () => {
  it('exposes snake_case tool name', () => {
    expect(lookupDrugDefinition.name).toBe('lookup_drug');
  });

  it('description ends with the safety suffix', () => {
    expect(lookupDrugDefinition.description.endsWith(TOOL_DESCRIPTION_SUFFIX)).toBe(true);
  });
});

describe('lookup_drug — input validation', () => {
  it('rejects empty string with INVALID_INPUT', async () => {
    const out = await lookupDrugHandler({ name: '' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
    expect(normalizeMock).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only input with INVALID_INPUT', async () => {
    const out = await lookupDrugHandler({ name: '   ' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });

  it('rejects 201-char input with INVALID_INPUT', async () => {
    const out = await lookupDrugHandler({ name: 'a'.repeat(201) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });

  it('rejects missing name field with INVALID_INPUT', async () => {
    const out = await lookupDrugHandler({});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });

  it('rejects non-object input with INVALID_INPUT', async () => {
    const out = await lookupDrugHandler('aspirin');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });
});

describe('lookup_drug — normalize forwarding', () => {
  it('forwards normalize error as respondError', async () => {
    normalizeMock.mockResolvedValueOnce({
      kind: 'error',
      error: { code: 'UPSTREAM_ERROR', message: 'rxnav down', retryable: true },
    });
    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('UPSTREAM_ERROR');
      expect(out.error.retryable).toBe(true);
      expect(out.disclaimer).toBe(DISCLAIMER);
    }
  });

  it('returns DATA_NOT_FOUND when normalize returns not_found', async () => {
    normalizeMock.mockResolvedValueOnce({ kind: 'not_found' });
    const out = await lookupDrugHandler({ name: 'zzznotadrug' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('DATA_NOT_FOUND');
      expect(out.error.message).toContain('zzznotadrug');
    }
  });

  it('returns AMBIGUOUS_QUERY with candidates when normalize is ambiguous', async () => {
    normalizeMock.mockResolvedValueOnce({
      kind: 'ambiguous',
      candidates: [
        { rxcui: '1', name: 'Drug A', reason: 'score 95' },
        { rxcui: '2', name: 'Drug B', reason: 'score 93' },
      ],
    });
    const out = await lookupDrugHandler({ name: 'drug' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('AMBIGUOUS_QUERY');
      expect(out.error.candidates).toHaveLength(2);
    }
  });
});

describe('lookup_drug — upstream forwarding', () => {
  beforeEach(() => {
    normalizeMock.mockResolvedValue({
      kind: 'resolved',
      rxcui: '1191',
      name: 'Aspirin',
      source: 'approximate',
    });
  });

  it('forwards getProperties failure', async () => {
    propertiesMock.mockResolvedValue({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'boom', retryable: true },
    });
    relatedMock.mockResolvedValue({ ok: true, data: [] });
    classesMock.mockResolvedValue({ ok: true, data: [] });

    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('UPSTREAM_ERROR');
  });

  it('forwards getRelated failure', async () => {
    propertiesMock.mockResolvedValue({
      ok: true,
      data: { rxcui: '1191', name: 'Aspirin', tty: 'IN' },
    });
    relatedMock.mockResolvedValue({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'boom', retryable: true },
    });
    classesMock.mockResolvedValue({ ok: true, data: [] });

    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('UPSTREAM_ERROR');
  });

  it('forwards getClasses failure', async () => {
    propertiesMock.mockResolvedValue({
      ok: true,
      data: { rxcui: '1191', name: 'Aspirin', tty: 'IN' },
    });
    relatedMock.mockResolvedValue({ ok: true, data: [] });
    classesMock.mockResolvedValue({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'boom', retryable: true },
    });

    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('UPSTREAM_ERROR');
  });
});

describe('lookup_drug — successful resolution', () => {
  beforeEach(() => {
    normalizeMock.mockResolvedValue({
      kind: 'resolved',
      rxcui: '1191',
      name: 'Aspirin',
      source: 'rxcui',
    });
  });

  it('uses props.name as genericName when tty is IN', async () => {
    setUpstream({
      rxcui: '1191',
      name: 'Aspirin',
      tty: 'IN',
      related: [{ rxcui: '1191', name: 'Aspirin', tty: 'IN' }],
    });

    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.genericName).toBe('Aspirin');
  });

  it('uses first IN-related as genericName when tty is SCD', async () => {
    setUpstream({
      rxcui: '243670',
      name: 'Aspirin 325 MG Oral Tablet',
      tty: 'SCD',
      related: [
        { rxcui: '1191', name: 'Aspirin', tty: 'IN' },
        { rxcui: '5640', name: 'Bayer', tty: 'BN' },
      ],
    });

    const out = await lookupDrugHandler({ name: 'aspirin tablet' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.genericName).toBe('Aspirin');
  });

  it('falls back to props.name when no IN-related concepts exist', async () => {
    setUpstream({ rxcui: '1191', name: 'Aspirin', tty: 'BN', related: [] });

    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.genericName).toBe('Aspirin');
  });

  it('collects BN-related concepts as brandNames', async () => {
    setUpstream({
      rxcui: '1191',
      name: 'Aspirin',
      related: [
        { rxcui: '1', name: 'Bayer', tty: 'BN' },
        { rxcui: '2', name: 'Ecotrin', tty: 'BN' },
        { rxcui: '3', name: 'Aspirin', tty: 'IN' },
      ],
    });

    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.brandNames).toEqual(['Bayer', 'Ecotrin']);
  });

  it('collects IN-related concepts as activeIngredients', async () => {
    setUpstream({
      rxcui: '161',
      name: 'Acetaminophen',
      related: [
        { rxcui: '161', name: 'Acetaminophen', tty: 'IN' },
        { rxcui: '5489', name: 'Caffeine', tty: 'IN' },
        { rxcui: '999', name: 'Tylenol', tty: 'BN' },
      ],
    });

    const out = await lookupDrugHandler({ name: 'acetaminophen' });
    expect(out.ok).toBe(true);
    if (out.ok)
      expect(out.data.activeIngredients).toEqual(['Acetaminophen', 'Caffeine']);
  });

  it('deduplicates repeated concept names', async () => {
    setUpstream({
      rxcui: '1191',
      name: 'Aspirin',
      related: [
        { rxcui: '1', name: 'Bayer', tty: 'BN' },
        { rxcui: '2', name: 'Bayer', tty: 'BN' },
      ],
    });

    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.brandNames).toEqual(['Bayer']);
  });

  it('populates drugClasses from getClasses response', async () => {
    setUpstream({
      rxcui: '1191',
      name: 'Aspirin',
      classes: [
        {
          classId: 'N02BA',
          className: 'SALICYLIC ACID AND DERIVATIVES',
          classType: 'ATC1-4',
          relaSource: 'ATC',
        },
      ],
    });

    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok)
      expect(out.data.drugClasses).toEqual(['SALICYLIC ACID AND DERIVATIVES']);
  });

  it('returns empty drugClasses when drug has no classification', async () => {
    setUpstream({ rxcui: '1191', name: 'Aspirin' });

    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.drugClasses).toEqual([]);
  });

  it('embeds the canonical disclaimer in the success payload', async () => {
    setUpstream({ rxcui: '1191', name: 'Aspirin' });

    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.disclaimer).toBe(DISCLAIMER);
  });

  it('citation points at the RxNorm properties endpoint for the rxcui', async () => {
    setUpstream({ rxcui: '1191', name: 'Aspirin' });

    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.citation.source).toBe('rxnorm');
      expect(out.data.citation.url).toContain('/rxcui/1191/properties.json');
    }
  });

  it('success payload conforms to LookupDrugOutputSchema', async () => {
    setUpstream({
      rxcui: '1191',
      name: 'Aspirin',
      related: [{ rxcui: '5640', name: 'Bayer', tty: 'BN' }],
      classes: [
        {
          classId: 'N02BA',
          className: 'SALICYLIC ACID',
          classType: 'ATC1-4',
          relaSource: 'ATC',
        },
      ],
    });

    const out = await lookupDrugHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const parsed = LookupDrugOutputSchema.safeParse(out.data);
      expect(parsed.success).toBe(true);
    }
  });
});
