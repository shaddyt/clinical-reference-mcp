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
  },
}));

import {
  getDrugLabelDefinition,
  getDrugLabelHandler,
} from '../../../src/server/tools/get-drug-label';
import { normalizeDrugName } from '../../../src/lib/normalize';
import { openFda } from '../../../src/lib/openfda';
import type { LabelHit } from '../../../src/lib/openfda';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../../src/lib/safety';
import { GetDrugLabelOutputSchema } from '../../../src/lib/types';

const normalizeMock = vi.mocked(normalizeDrugName);
const searchLabelsMock = vi.mocked(openFda.searchLabels);

beforeEach(() => {
  normalizeMock.mockReset();
  searchLabelsMock.mockReset();
});

function fullLabelHit(overrides: Partial<LabelHit> = {}): LabelHit {
  return {
    setId: 'set-abc',
    rxcui: ['1191'],
    indications: 'For relief of mild pain.',
    dosage: 'Adults: 325 mg every 4 hours.',
    warnings: 'Do not exceed recommended dose.',
    contraindications: 'History of allergy.',
    adverseReactions: 'Nausea, dizziness.',
    mechanism: 'Inhibits cyclooxygenase.',
    raw: {},
    ...overrides,
  };
}

describe('get_drug_label — definition', () => {
  it('exposes snake_case tool name', () => {
    expect(getDrugLabelDefinition.name).toBe('get_drug_label');
  });

  it('description ends with the safety suffix', () => {
    expect(
      getDrugLabelDefinition.description.endsWith(TOOL_DESCRIPTION_SUFFIX),
    ).toBe(true);
  });
});

describe('get_drug_label — input validation', () => {
  it('rejects empty name with INVALID_INPUT', async () => {
    const out = await getDrugLabelHandler({ name: '' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
    expect(normalizeMock).not.toHaveBeenCalled();
  });

  it('rejects non-string name with INVALID_INPUT', async () => {
    const out = await getDrugLabelHandler({ name: 42 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });

  it('rejects non-array sections with INVALID_INPUT', async () => {
    const out = await getDrugLabelHandler({ name: 'aspirin', sections: 'all' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });
});

describe('get_drug_label — normalize forwarding', () => {
  it('returns DATA_NOT_FOUND when normalize is not_found', async () => {
    normalizeMock.mockResolvedValueOnce({ kind: 'not_found' });
    const out = await getDrugLabelHandler({ name: 'zzznotadrug' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('DATA_NOT_FOUND');
      expect(out.error.message).toContain('zzznotadrug');
    }
  });

  it('returns AMBIGUOUS_QUERY with candidates', async () => {
    normalizeMock.mockResolvedValueOnce({
      kind: 'ambiguous',
      candidates: [{ rxcui: '1', name: 'Drug A', reason: 'score 95' }],
    });
    const out = await getDrugLabelHandler({ name: 'drug' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('AMBIGUOUS_QUERY');
      expect(out.error.candidates).toHaveLength(1);
    }
  });

  it('forwards normalize upstream error verbatim', async () => {
    normalizeMock.mockResolvedValueOnce({
      kind: 'error',
      error: { code: 'UPSTREAM_ERROR', message: 'rxnav down', retryable: true },
    });
    const out = await getDrugLabelHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('UPSTREAM_ERROR');
      expect(out.disclaimer).toBe(DISCLAIMER);
    }
  });
});

describe('get_drug_label — label resolution', () => {
  beforeEach(() => {
    normalizeMock.mockResolvedValue({
      kind: 'resolved',
      rxcui: '1191',
      name: 'Aspirin',
      source: 'rxcui',
    });
  });

  it('returns DATA_NOT_FOUND with rxcui when no labels match', async () => {
    searchLabelsMock.mockResolvedValueOnce({ ok: true, data: [] });
    const out = await getDrugLabelHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('DATA_NOT_FOUND');
      expect(out.error.message).toContain('1191');
    }
  });

  it('forwards openFDA upstream error', async () => {
    searchLabelsMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'fda down', retryable: true },
    });
    const out = await getDrugLabelHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('UPSTREAM_ERROR');
  });

  it('queries openFDA by openfda.rxcui with the resolved RxCUI', async () => {
    searchLabelsMock.mockResolvedValueOnce({
      ok: true,
      data: [fullLabelHit()],
    });
    await getDrugLabelHandler({ name: 'aspirin' });
    expect(searchLabelsMock).toHaveBeenCalledWith({
      field: 'openfda.rxcui',
      value: '1191',
      limit: 1,
    });
  });

  it('returns all six sections when sections is omitted', async () => {
    searchLabelsMock.mockResolvedValueOnce({
      ok: true,
      data: [fullLabelHit()],
    });
    const out = await getDrugLabelHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const names = out.data.sections.map((s) => s.name);
      expect(names).toEqual([
        'indications',
        'dosage',
        'warnings',
        'contraindications',
        'adverse_reactions',
        'mechanism',
      ]);
    }
  });

  it('returns only requested sections when sections is provided', async () => {
    searchLabelsMock.mockResolvedValueOnce({
      ok: true,
      data: [fullLabelHit()],
    });
    const out = await getDrugLabelHandler({
      name: 'aspirin',
      sections: ['warnings'],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.sections).toHaveLength(1);
      expect(out.data.sections[0]?.name).toBe('warnings');
    }
  });

  it('treats empty sections array as no filter', async () => {
    searchLabelsMock.mockResolvedValueOnce({
      ok: true,
      data: [fullLabelHit()],
    });
    const out = await getDrugLabelHandler({ name: 'aspirin', sections: [] });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.sections).toHaveLength(6);
  });

  it('omits sections that are absent from the label entirely (no empty strings)', async () => {
    const hit = fullLabelHit();
    delete hit.warnings;
    delete hit.contraindications;
    searchLabelsMock.mockResolvedValueOnce({
      ok: true,
      data: [hit],
    });
    const out = await getDrugLabelHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const names = out.data.sections.map((s) => s.name);
      expect(names).not.toContain('warnings');
      expect(names).not.toContain('contraindications');
      for (const s of out.data.sections) expect(s.text.length).toBeGreaterThan(0);
    }
  });

  it('silently skips unknown section names from input', async () => {
    searchLabelsMock.mockResolvedValueOnce({
      ok: true,
      data: [fullLabelHit()],
    });
    const out = await getDrugLabelHandler({
      name: 'aspirin',
      sections: ['warnings', 'not_a_real_section'],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.sections).toHaveLength(1);
      expect(out.data.sections[0]?.name).toBe('warnings');
    }
  });

  it('citation uses setId when available', async () => {
    searchLabelsMock.mockResolvedValueOnce({
      ok: true,
      data: [fullLabelHit({ setId: 'set-xyz' })],
    });
    const out = await getDrugLabelHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.citation.url).toContain('set_id:set-xyz');
    }
  });

  it('citation falls back to rxcui when setId is missing', async () => {
    const hit = fullLabelHit();
    delete hit.setId;
    searchLabelsMock.mockResolvedValueOnce({ ok: true, data: [hit] });
    const out = await getDrugLabelHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.citation.url).toContain('set_id:1191');
  });

  it('embeds the canonical disclaimer', async () => {
    searchLabelsMock.mockResolvedValueOnce({
      ok: true,
      data: [fullLabelHit()],
    });
    const out = await getDrugLabelHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.disclaimer).toBe(DISCLAIMER);
  });

  it('uses the resolved name (not the raw input) as drugName', async () => {
    searchLabelsMock.mockResolvedValueOnce({
      ok: true,
      data: [fullLabelHit()],
    });
    const out = await getDrugLabelHandler({ name: 'asprin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.drugName).toBe('Aspirin');
  });

  it('success payload conforms to GetDrugLabelOutputSchema', async () => {
    searchLabelsMock.mockResolvedValueOnce({
      ok: true,
      data: [fullLabelHit()],
    });
    const out = await getDrugLabelHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const parsed = GetDrugLabelOutputSchema.safeParse(out.data);
      expect(parsed.success).toBe(true);
    }
  });
});
