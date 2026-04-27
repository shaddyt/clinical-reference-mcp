/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/normalize', () => ({
  normalizeDrugName: vi.fn(),
}));

vi.mock('../../../src/lib/openfda', () => ({
  openFda: {
    searchLabels: vi.fn(),
    topAdverseEvents: vi.fn(),
    findLabelByDrug: vi.fn(),
    findAdverseEventsByDrug: vi.fn(),
  },
}));

import {
  getDosingReferenceDefinition,
  getDosingReferenceHandler,
} from '../../../src/server/tools/get-dosing-reference';
import { normalizeDrugName } from '../../../src/lib/normalize';
import { openFda } from '../../../src/lib/openfda';
import type { LabelHit } from '../../../src/lib/openfda';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../../src/lib/safety';
import { GetDosingReferenceOutputSchema } from '../../../src/lib/types';

const normalizeMock = vi.mocked(normalizeDrugName);
const findLabelByDrugMock = vi.mocked(openFda.findLabelByDrug);

beforeEach(() => {
  normalizeMock.mockReset();
  findLabelByDrugMock.mockReset();
});

function labelHit(overrides: Partial<LabelHit> = {}): LabelHit {
  return {
    setId: 'set-x',
    dosage: 'Adults: 325 mg every 4 hours as needed.',
    raw: {},
    ...overrides,
  };
}

describe('get_dosing_reference — definition', () => {
  it('exposes snake_case tool name', () => {
    expect(getDosingReferenceDefinition.name).toBe('get_dosing_reference');
  });

  it('description ends with the safety suffix', () => {
    expect(
      getDosingReferenceDefinition.description.endsWith(TOOL_DESCRIPTION_SUFFIX),
    ).toBe(true);
  });

  it('description explicitly disclaims dose computation', () => {
    expect(getDosingReferenceDefinition.description).toMatch(
      /does not compute|does not.*recommend/i,
    );
  });
});

describe('get_dosing_reference — input validation', () => {
  it('rejects empty name with INVALID_INPUT', async () => {
    const out = await getDosingReferenceHandler({ name: '' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
    expect(normalizeMock).not.toHaveBeenCalled();
  });

  it('rejects 201-char input with INVALID_INPUT', async () => {
    const out = await getDosingReferenceHandler({ name: 'a'.repeat(201) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });
});

describe('get_dosing_reference — normalize forwarding', () => {
  it('returns DATA_NOT_FOUND when normalize is not_found', async () => {
    normalizeMock.mockResolvedValueOnce({ kind: 'not_found' });
    const out = await getDosingReferenceHandler({ name: 'zzznotadrug' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('DATA_NOT_FOUND');
  });

  it('returns AMBIGUOUS_QUERY with candidates', async () => {
    normalizeMock.mockResolvedValueOnce({
      kind: 'ambiguous',
      candidates: [{ rxcui: '1', name: 'A', reason: 'r' }],
    });
    const out = await getDosingReferenceHandler({ name: 'foo' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('AMBIGUOUS_QUERY');
  });

  it('forwards normalize upstream error verbatim', async () => {
    normalizeMock.mockResolvedValueOnce({
      kind: 'error',
      error: { code: 'UPSTREAM_ERROR', message: 'down', retryable: true },
    });
    const out = await getDosingReferenceHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('UPSTREAM_ERROR');
      expect(out.disclaimer).toBe(DISCLAIMER);
    }
  });
});

describe('get_dosing_reference — label resolution', () => {
  beforeEach(() => {
    normalizeMock.mockResolvedValue({
      kind: 'resolved',
      rxcui: '1191',
      name: 'Aspirin',
      source: 'rxcui',
    });
  });

  it('forwards openFDA upstream error', async () => {
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'fda down', retryable: true },
    });
    const out = await getDosingReferenceHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('UPSTREAM_ERROR');
  });

  it('returns DATA_NOT_FOUND when no FDA label exists', async () => {
    findLabelByDrugMock.mockResolvedValueOnce({ ok: true, data: [] });
    const out = await getDosingReferenceHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('DATA_NOT_FOUND');
      expect(out.error.message).toContain('1191');
    }
  });

  it('returns DATA_NOT_FOUND when label has no dosage section', async () => {
    const hit = labelHit();
    delete hit.dosage;
    findLabelByDrugMock.mockResolvedValueOnce({ ok: true, data: [hit] });

    const out = await getDosingReferenceHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('DATA_NOT_FOUND');
      expect(out.error.message).toMatch(/dosage_and_administration/);
    }
  });

  it('returns the dosage text verbatim as a single entry', async () => {
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: true,
      data: [labelHit({ dosage: 'Adults: 325 mg every 4 hours as needed.' })],
    });

    const out = await getDosingReferenceHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.entries).toHaveLength(1);
      expect(out.data.entries[0]?.text).toBe(
        'Adults: 325 mg every 4 hours as needed.',
      );
    }
  });

  it('does not populate population or route fields (these are not parsed)', async () => {
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: true,
      data: [
        labelHit({
          dosage:
            'Adults: 325 mg every 4 hours. Pediatric (>12 yr): 162 mg. Renal: caution.',
        }),
      ],
    });

    const out = await getDosingReferenceHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.entries[0]?.population).toBeUndefined();
      expect(out.data.entries[0]?.route).toBeUndefined();
    }
  });

  it('citation uses setId when present', async () => {
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: true,
      data: [labelHit({ setId: 'set-aspirin' })],
    });

    const out = await getDosingReferenceHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.citation.url).toContain('set_id:set-aspirin');
  });

  it('citation falls back to rxcui when setId is missing', async () => {
    const hit = labelHit();
    delete hit.setId;
    findLabelByDrugMock.mockResolvedValueOnce({ ok: true, data: [hit] });

    const out = await getDosingReferenceHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.citation.url).toContain('set_id:1191');
  });

  it('embeds the canonical disclaimer', async () => {
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: true,
      data: [labelHit()],
    });
    const out = await getDosingReferenceHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.disclaimer).toBe(DISCLAIMER);
  });

  it('scope note disclaims patient-specific adjustment and prescribing', async () => {
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: true,
      data: [labelHit()],
    });
    const out = await getDosingReferenceHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.scopeNote).toMatch(/not a dosing recommendation/i);
      expect(out.data.scopeNote).toMatch(/patient-specific/i);
    }
  });

  it('uses the resolved name as drugName', async () => {
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: true,
      data: [labelHit()],
    });
    const out = await getDosingReferenceHandler({ name: 'asprin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.drugName).toBe('Aspirin');
  });

  it('success payload conforms to GetDosingReferenceOutputSchema', async () => {
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: true,
      data: [labelHit()],
    });
    const out = await getDosingReferenceHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const parsed = GetDosingReferenceOutputSchema.safeParse(out.data);
      expect(parsed.success).toBe(true);
    }
  });
});
