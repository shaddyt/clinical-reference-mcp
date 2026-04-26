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
    getClassMembers: vi.fn(),
    approximateMatch: vi.fn(),
  },
}));

import {
  findAlternativesDefinition,
  findAlternativesHandler,
} from '../../../src/server/tools/find-alternatives';
import { normalizeDrugName } from '../../../src/lib/normalize';
import { rxNorm } from '../../../src/lib/rxnorm';
import type { DrugClass, ClassMember } from '../../../src/lib/rxnorm';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../../src/lib/safety';
import { FindAlternativesOutputSchema } from '../../../src/lib/types';

const normalizeMock = vi.mocked(normalizeDrugName);
const getClassesMock = vi.mocked(rxNorm.getClasses);
const getClassMembersMock = vi.mocked(rxNorm.getClassMembers);

beforeEach(() => {
  normalizeMock.mockReset();
  getClassesMock.mockReset();
  getClassMembersMock.mockReset();
});

function cls(classId: string, className: string): DrugClass {
  return { classId, className, classType: 'ATC1-4', relaSource: 'ATC' };
}

function member(rxcui: string, name: string): ClassMember {
  return { rxcui, name, tty: 'IN' };
}

describe('find_alternatives — definition', () => {
  it('exposes snake_case tool name', () => {
    expect(findAlternativesDefinition.name).toBe('find_alternatives');
  });

  it('description ends with the safety suffix', () => {
    expect(
      findAlternativesDefinition.description.endsWith(TOOL_DESCRIPTION_SUFFIX),
    ).toBe(true);
  });
});

describe('find_alternatives — input validation', () => {
  it('rejects empty name with INVALID_INPUT', async () => {
    const out = await findAlternativesHandler({ name: '' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
    expect(normalizeMock).not.toHaveBeenCalled();
  });

  it('rejects 201-char input with INVALID_INPUT', async () => {
    const out = await findAlternativesHandler({ name: 'a'.repeat(201) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });
});

describe('find_alternatives — normalize forwarding', () => {
  it('returns DATA_NOT_FOUND when normalize is not_found', async () => {
    normalizeMock.mockResolvedValueOnce({ kind: 'not_found' });
    const out = await findAlternativesHandler({ name: 'zzznotadrug' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('DATA_NOT_FOUND');
  });

  it('returns AMBIGUOUS_QUERY with candidates', async () => {
    normalizeMock.mockResolvedValueOnce({
      kind: 'ambiguous',
      candidates: [{ rxcui: '1', name: 'A', reason: 'r' }],
    });
    const out = await findAlternativesHandler({ name: 'foo' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('AMBIGUOUS_QUERY');
  });

  it('forwards normalize upstream error', async () => {
    normalizeMock.mockResolvedValueOnce({
      kind: 'error',
      error: { code: 'UPSTREAM_ERROR', message: 'down', retryable: true },
    });
    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('UPSTREAM_ERROR');
      expect(out.disclaimer).toBe(DISCLAIMER);
    }
  });
});

describe('find_alternatives — classification & members', () => {
  beforeEach(() => {
    normalizeMock.mockResolvedValue({
      kind: 'resolved',
      rxcui: '1191',
      name: 'Aspirin',
      source: 'rxcui',
    });
  });

  it('returns DATA_NOT_FOUND when drug has no ATC classification', async () => {
    getClassesMock.mockResolvedValueOnce({ ok: true, data: [] });

    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('DATA_NOT_FOUND');
      expect(out.error.message).toMatch(/ATC classification/i);
    }
  });

  it('forwards getClasses upstream error', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'down', retryable: true },
    });
    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('UPSTREAM_ERROR');
  });

  it('forwards getClassMembers upstream error', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: true,
      data: [cls('N02BA', 'Salicylic acid derivatives')],
    });
    getClassMembersMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'down', retryable: true },
    });
    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('UPSTREAM_ERROR');
  });

  it('returns DATA_NOT_FOUND when no class has alternatives beyond the input', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: true,
      data: [cls('N02BA01', 'Acetylsalicylic acid')],
    });
    getClassMembersMock.mockResolvedValueOnce({
      ok: true,
      data: [member('1191', 'Aspirin')],
    });

    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('DATA_NOT_FOUND');
      expect(out.error.message).toMatch(/no alternatives/i);
    }
  });

  it('uses the most-specific class (longest classId) when it has siblings', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: true,
      data: [
        cls('N', 'Nervous system'),
        cls('N02BA', 'Salicylic acid derivatives'),
        cls('N02', 'Analgesics'),
      ],
    });
    // The longest classId is N02BA — fetched first.
    getClassMembersMock.mockResolvedValueOnce({
      ok: true,
      data: [
        member('1191', 'Aspirin'),
        member('3008', 'Diflunisal'),
        member('9524', 'Salsalate'),
      ],
    });

    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(getClassMembersMock).toHaveBeenCalledTimes(1);
      expect(getClassMembersMock).toHaveBeenCalledWith('N02BA', ['IN']);
      expect(out.data.alternatives.map((a) => a.name)).toEqual([
        'Diflunisal',
        'Salsalate',
      ]);
      expect(out.data.alternatives[0]?.sharedClass).toBe(
        'Salicylic acid derivatives',
      );
    }
  });

  it('falls back to broader class when most-specific class has only the input drug', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: true,
      data: [
        cls('N02BA01', 'Acetylsalicylic acid'),
        cls('N02BA', 'Salicylic acid derivatives'),
      ],
    });
    getClassMembersMock.mockResolvedValueOnce({
      ok: true,
      data: [member('1191', 'Aspirin')],
    });
    getClassMembersMock.mockResolvedValueOnce({
      ok: true,
      data: [member('1191', 'Aspirin'), member('3008', 'Diflunisal')],
    });

    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(getClassMembersMock).toHaveBeenCalledTimes(2);
      expect(out.data.alternatives).toHaveLength(1);
      expect(out.data.alternatives[0]?.sharedClass).toBe(
        'Salicylic acid derivatives',
      );
    }
  });

  it('filters the input drug out of the alternatives list', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: true,
      data: [cls('N02BA', 'Salicylic acid derivatives')],
    });
    getClassMembersMock.mockResolvedValueOnce({
      ok: true,
      data: [
        member('1191', 'Aspirin'),
        member('3008', 'Diflunisal'),
      ],
    });

    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.alternatives.map((a) => a.rxcui)).not.toContain('1191');
    }
  });

  it('caps alternatives at 20 even when class has more', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: true,
      data: [cls('N02BA', 'Salicylic acid derivatives')],
    });
    const many: ClassMember[] = Array.from({ length: 30 }, (_, i) =>
      member(String(i + 1), `Drug${i + 1}`),
    );
    getClassMembersMock.mockResolvedValueOnce({ ok: true, data: many });

    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.alternatives).toHaveLength(20);
  });

  it('deduplicates members appearing multiple times within a class', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: true,
      data: [cls('N02BA', 'Salicylic acid derivatives')],
    });
    getClassMembersMock.mockResolvedValueOnce({
      ok: true,
      data: [
        member('3008', 'Diflunisal'),
        member('3008', 'Diflunisal'),
        member('9524', 'Salsalate'),
      ],
    });

    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.alternatives.map((a) => a.rxcui)).toEqual(['3008', '9524']);
    }
  });

  it('drugClasses field lists every class the input belongs to (deduped)', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: true,
      data: [
        cls('N', 'Nervous system'),
        cls('N02', 'Analgesics'),
        cls('N02B', 'Other analgesics'),
        cls('N02BA', 'Salicylic acid derivatives'),
      ],
    });
    getClassMembersMock.mockResolvedValueOnce({
      ok: true,
      data: [member('3008', 'Diflunisal')],
    });

    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.drugClasses).toEqual([
        'Nervous system',
        'Analgesics',
        'Other analgesics',
        'Salicylic acid derivatives',
      ]);
    }
  });

  it('citation points to the RxClass byRxcui endpoint for the input drug', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: true,
      data: [cls('N02BA', 'Salicylic acid derivatives')],
    });
    getClassMembersMock.mockResolvedValueOnce({
      ok: true,
      data: [member('3008', 'Diflunisal')],
    });

    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.citation.source).toBe('rxnav');
      expect(out.data.citation.url).toContain('rxclass/class/byRxcui.json');
      expect(out.data.citation.url).toContain('rxcui=1191');
    }
  });

  it('embeds the canonical disclaimer and a scope note', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: true,
      data: [cls('N02BA', 'Salicylic acid derivatives')],
    });
    getClassMembersMock.mockResolvedValueOnce({
      ok: true,
      data: [member('3008', 'Diflunisal')],
    });

    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.disclaimer).toBe(DISCLAIMER);
      expect(out.data.scopeNote).toMatch(/therapeutic equivalence/i);
    }
  });

  it('echoes the original query string', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: true,
      data: [cls('N02BA', 'Salicylic acid derivatives')],
    });
    getClassMembersMock.mockResolvedValueOnce({
      ok: true,
      data: [member('3008', 'Diflunisal')],
    });

    const out = await findAlternativesHandler({ name: 'asprin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.query).toBe('asprin');
  });

  it('success payload conforms to FindAlternativesOutputSchema', async () => {
    getClassesMock.mockResolvedValueOnce({
      ok: true,
      data: [cls('N02BA', 'Salicylic acid derivatives')],
    });
    getClassMembersMock.mockResolvedValueOnce({
      ok: true,
      data: [member('3008', 'Diflunisal')],
    });

    const out = await findAlternativesHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const parsed = FindAlternativesOutputSchema.safeParse(out.data);
      expect(parsed.success).toBe(true);
    }
  });
});
