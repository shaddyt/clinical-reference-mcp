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
  checkInteractionsDefinition,
  checkInteractionsHandler,
} from '../../../src/server/tools/check-interactions';
import { normalizeDrugName } from '../../../src/lib/normalize';
import type { NormalizeResult } from '../../../src/lib/normalize';
import { openFda } from '../../../src/lib/openfda';
import type { LabelHit } from '../../../src/lib/openfda';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../../src/lib/safety';
import { CheckInteractionsOutputSchema } from '../../../src/lib/types';

const normalizeMock = vi.mocked(normalizeDrugName);
const findLabelByDrugMock = vi.mocked(openFda.findLabelByDrug);

beforeEach(() => {
  normalizeMock.mockReset();
  findLabelByDrugMock.mockReset();
});

function resolved(rxcui: string, name: string): NormalizeResult {
  return { kind: 'resolved', rxcui, name, source: 'rxcui' };
}

function labelHit(overrides: Partial<LabelHit> = {}): LabelHit {
  return { setId: 'set-x', raw: {}, ...overrides };
}

describe('check_interactions — definition', () => {
  it('exposes snake_case tool name', () => {
    expect(checkInteractionsDefinition.name).toBe('check_interactions');
  });

  it('description ends with the safety suffix', () => {
    expect(
      checkInteractionsDefinition.description.endsWith(TOOL_DESCRIPTION_SUFFIX),
    ).toBe(true);
  });

  it('description names the tool as label-based, not a DDI verdict', () => {
    expect(checkInteractionsDefinition.description).toMatch(/source material/i);
  });
});

describe('check_interactions — input validation', () => {
  it('rejects single-drug input with INVALID_INPUT', async () => {
    const out = await checkInteractionsHandler({ drugs: ['aspirin'] });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
    expect(normalizeMock).not.toHaveBeenCalled();
  });

  it('rejects 11-drug input with INVALID_INPUT', async () => {
    const out = await checkInteractionsHandler({
      drugs: Array(11).fill('aspirin'),
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });

  it('rejects missing drugs field with INVALID_INPUT', async () => {
    const out = await checkInteractionsHandler({});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });

  it('rejects empty string entries with INVALID_INPUT', async () => {
    const out = await checkInteractionsHandler({ drugs: ['aspirin', ''] });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });
});

describe('check_interactions — normalize forwarding', () => {
  it('returns the first upstream error encountered', async () => {
    normalizeMock.mockImplementation(async (input) => {
      if (input === 'b')
        return {
          kind: 'error',
          error: { code: 'UPSTREAM_ERROR', message: 'rxnav', retryable: true },
        };
      return resolved('1', input);
    });

    const out = await checkInteractionsHandler({ drugs: ['a', 'b', 'c'] });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('UPSTREAM_ERROR');
  });

  it('reports the first ambiguous drug with its candidates', async () => {
    normalizeMock.mockImplementation(async (input) => {
      if (input === 'foo')
        return {
          kind: 'ambiguous',
          candidates: [{ rxcui: '1', name: 'Foo A', reason: 'score 95' }],
        };
      return resolved('2', input);
    });

    const out = await checkInteractionsHandler({
      drugs: ['aspirin', 'foo'],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('AMBIGUOUS_QUERY');
      expect(out.error.message).toContain('foo');
      expect(out.error.candidates).toHaveLength(1);
    }
  });

  it('lists ALL not-found inputs in the DATA_NOT_FOUND message', async () => {
    normalizeMock.mockImplementation(async (input) => {
      if (input === 'aspirin') return resolved('1191', 'Aspirin');
      return { kind: 'not_found' };
    });

    const out = await checkInteractionsHandler({
      drugs: ['aspirin', 'zzznotadrug', 'qqqfakedrug'],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('DATA_NOT_FOUND');
      expect(out.error.message).toContain('zzznotadrug');
      expect(out.error.message).toContain('qqqfakedrug');
    }
  });

  it('error preempts ambiguous when both are present', async () => {
    normalizeMock.mockImplementation(async (input) => {
      if (input === 'a')
        return {
          kind: 'error',
          error: { code: 'UPSTREAM_ERROR', message: 'down', retryable: true },
        };
      return {
        kind: 'ambiguous',
        candidates: [{ rxcui: '1', name: 'X', reason: 'r' }],
      };
    });

    const out = await checkInteractionsHandler({ drugs: ['a', 'b'] });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('UPSTREAM_ERROR');
  });
});

describe('check_interactions — successful resolution', () => {
  beforeEach(() => {
    normalizeMock.mockImplementation(async (input) => {
      if (input === 'aspirin') return resolved('1191', 'Aspirin');
      if (input === 'warfarin') return resolved('11289', 'Warfarin');
      return { kind: 'not_found' };
    });
  });

  it('forwards openFDA upstream errors verbatim', async () => {
    findLabelByDrugMock.mockResolvedValueOnce({ ok: true, data: [labelHit()] });
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'fda down', retryable: true },
    });

    const out = await checkInteractionsHandler({
      drugs: ['aspirin', 'warfarin'],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('UPSTREAM_ERROR');
  });

  it('uses drug_interactions section when present', async () => {
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: true,
      data: [labelHit({ drugInteractions: 'Increases bleeding with warfarin.' })],
    });
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: true,
      data: [labelHit({ drugInteractions: 'Aspirin amplifies anticoagulation.' })],
    });

    const out = await checkInteractionsHandler({
      drugs: ['aspirin', 'warfarin'],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.drugs[0]?.interactionsText).toBe(
        'Increases bleeding with warfarin.',
      );
      expect(out.data.drugs[1]?.interactionsText).toBe(
        'Aspirin amplifies anticoagulation.',
      );
    }
  });

  it('falls back to warnings section when drug_interactions is absent', async () => {
    findLabelByDrugMock.mockResolvedValue({
      ok: true,
      data: [labelHit({ warnings: 'Bleeding risk noted.' })],
    });

    const out = await checkInteractionsHandler({
      drugs: ['aspirin', 'warfarin'],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.drugs[0]?.interactionsText).toBe('Bleeding risk noted.');
    }
  });

  it('interactionsText is null when neither section nor label exists', async () => {
    findLabelByDrugMock.mockResolvedValue({ ok: true, data: [] });

    const out = await checkInteractionsHandler({
      drugs: ['aspirin', 'warfarin'],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.drugs[0]?.interactionsText).toBeNull();
      expect(out.data.drugs[1]?.interactionsText).toBeNull();
    }
  });

  it('interactionsText is null when label has neither drug_interactions nor warnings', async () => {
    findLabelByDrugMock.mockResolvedValue({
      ok: true,
      data: [labelHit({ indications: 'For pain.' })],
    });

    const out = await checkInteractionsHandler({
      drugs: ['aspirin', 'warfarin'],
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.drugs[0]?.interactionsText).toBeNull();
  });

  it('each entry carries its own per-drug citation (not shared)', async () => {
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: true,
      data: [labelHit({ setId: 'set-aspirin' })],
    });
    findLabelByDrugMock.mockResolvedValueOnce({
      ok: true,
      data: [labelHit({ setId: 'set-warfarin' })],
    });

    const out = await checkInteractionsHandler({
      drugs: ['aspirin', 'warfarin'],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.drugs[0]?.citation.url).toContain('set_id:set-aspirin');
      expect(out.data.drugs[1]?.citation.url).toContain('set_id:set-warfarin');
    }
  });

  it('citation falls back to rxcui when label has no setId', async () => {
    const hit = labelHit();
    delete hit.setId;
    findLabelByDrugMock.mockResolvedValue({ ok: true, data: [hit] });

    const out = await checkInteractionsHandler({
      drugs: ['aspirin', 'warfarin'],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.drugs[0]?.citation.url).toContain('set_id:1191');
      expect(out.data.drugs[1]?.citation.url).toContain('set_id:11289');
    }
  });

  it('preserves caller-input order in the entries array', async () => {
    findLabelByDrugMock.mockResolvedValue({ ok: true, data: [labelHit()] });

    const out = await checkInteractionsHandler({
      drugs: ['warfarin', 'aspirin'],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.drugs[0]?.drug).toBe('Warfarin');
      expect(out.data.drugs[1]?.drug).toBe('Aspirin');
    }
  });

  it('embeds the canonical disclaimer and the scope note', async () => {
    findLabelByDrugMock.mockResolvedValue({ ok: true, data: [labelHit()] });

    const out = await checkInteractionsHandler({
      drugs: ['aspirin', 'warfarin'],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.disclaimer).toBe(DISCLAIMER);
      expect(out.data.scopeNote.length).toBeGreaterThan(0);
      expect(out.data.scopeNote).toMatch(/does not synthesize/i);
    }
  });

  it('success payload conforms to CheckInteractionsOutputSchema', async () => {
    findLabelByDrugMock.mockResolvedValue({
      ok: true,
      data: [labelHit({ drugInteractions: 'X interacts with Y.' })],
    });

    const out = await checkInteractionsHandler({
      drugs: ['aspirin', 'warfarin'],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const parsed = CheckInteractionsOutputSchema.safeParse(out.data);
      expect(parsed.success).toBe(true);
    }
  });
});
