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
  lookupAdverseEventsDefinition,
  lookupAdverseEventsHandler,
} from '../../../src/server/tools/lookup-adverse-events';
import { normalizeDrugName } from '../../../src/lib/normalize';
import { openFda } from '../../../src/lib/openfda';
import { DISCLAIMER, TOOL_DESCRIPTION_SUFFIX } from '../../../src/lib/safety';
import { LookupAdverseEventsOutputSchema } from '../../../src/lib/types';

const normalizeMock = vi.mocked(normalizeDrugName);
const eventsMock = vi.mocked(openFda.findAdverseEventsByDrug);

beforeEach(() => {
  normalizeMock.mockReset();
  eventsMock.mockReset();
});

describe('lookup_adverse_events — definition', () => {
  it('exposes snake_case tool name', () => {
    expect(lookupAdverseEventsDefinition.name).toBe('lookup_adverse_events');
  });

  it('description ends with the safety suffix', () => {
    expect(
      lookupAdverseEventsDefinition.description.endsWith(TOOL_DESCRIPTION_SUFFIX),
    ).toBe(true);
  });

  it('description names FAERS as voluntary post-market reporting', () => {
    expect(lookupAdverseEventsDefinition.description).toMatch(/FAERS/);
    expect(lookupAdverseEventsDefinition.description).toMatch(/not establish causation/i);
  });
});

describe('lookup_adverse_events — input validation', () => {
  it('rejects empty name with INVALID_INPUT', async () => {
    const out = await lookupAdverseEventsHandler({ name: '' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
    expect(normalizeMock).not.toHaveBeenCalled();
  });

  it('rejects limit:0 with INVALID_INPUT', async () => {
    const out = await lookupAdverseEventsHandler({ name: 'aspirin', limit: 0 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });

  it('rejects limit:101 with INVALID_INPUT', async () => {
    const out = await lookupAdverseEventsHandler({
      name: 'aspirin',
      limit: 101,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });

  it('rejects non-integer limit with INVALID_INPUT', async () => {
    const out = await lookupAdverseEventsHandler({
      name: 'aspirin',
      limit: 5.5,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('INVALID_INPUT');
  });

  it('uses the schema default limit (10) when limit is omitted', async () => {
    normalizeMock.mockResolvedValueOnce({
      kind: 'resolved',
      rxcui: '1191',
      name: 'Aspirin',
      source: 'rxcui',
    });
    eventsMock.mockResolvedValueOnce({
      ok: true,
      data: [{ term: 'nausea', count: 1 }],
    });

    await lookupAdverseEventsHandler({ name: 'aspirin' });

    expect(eventsMock).toHaveBeenCalledWith({
      rxcui: '1191',
      genericName: 'Aspirin',
      limit: 10,
    });
  });
});

describe('lookup_adverse_events — normalize forwarding', () => {
  it('returns DATA_NOT_FOUND when normalize is not_found', async () => {
    normalizeMock.mockResolvedValueOnce({ kind: 'not_found' });
    const out = await lookupAdverseEventsHandler({ name: 'zzznotadrug' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('DATA_NOT_FOUND');
  });

  it('returns AMBIGUOUS_QUERY with candidates', async () => {
    normalizeMock.mockResolvedValueOnce({
      kind: 'ambiguous',
      candidates: [{ rxcui: '1', name: 'A', reason: 'r' }],
    });
    const out = await lookupAdverseEventsHandler({ name: 'foo' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('AMBIGUOUS_QUERY');
  });

  it('forwards normalize upstream error verbatim', async () => {
    normalizeMock.mockResolvedValueOnce({
      kind: 'error',
      error: { code: 'UPSTREAM_ERROR', message: 'down', retryable: true },
    });
    const out = await lookupAdverseEventsHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('UPSTREAM_ERROR');
      expect(out.disclaimer).toBe(DISCLAIMER);
    }
  });
});

describe('lookup_adverse_events — successful resolution', () => {
  beforeEach(() => {
    normalizeMock.mockResolvedValue({
      kind: 'resolved',
      rxcui: '1191',
      name: 'Aspirin',
      source: 'rxcui',
    });
  });

  it('forwards openFDA upstream error', async () => {
    eventsMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: 'fda down', retryable: true },
    });
    const out = await lookupAdverseEventsHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('UPSTREAM_ERROR');
  });

  it('returns DATA_NOT_FOUND when no FAERS reports exist', async () => {
    eventsMock.mockResolvedValueOnce({ ok: true, data: [] });
    const out = await lookupAdverseEventsHandler({ name: 'aspirin' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('DATA_NOT_FOUND');
      expect(out.error.message).toMatch(/No FAERS reports/);
    }
  });

  it('totalReports is the sum of returned event counts', async () => {
    eventsMock.mockResolvedValueOnce({
      ok: true,
      data: [
        { term: 'headache', count: 100 },
        { term: 'nausea', count: 50 },
        { term: 'rash', count: 25 },
      ],
    });
    const out = await lookupAdverseEventsHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.totalReports).toBe(175);
  });

  it('sorts events by count descending even if upstream returned unsorted', async () => {
    eventsMock.mockResolvedValueOnce({
      ok: true,
      data: [
        { term: 'rash', count: 25 },
        { term: 'headache', count: 100 },
        { term: 'nausea', count: 50 },
      ],
    });
    const out = await lookupAdverseEventsHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.events.map((e) => e.term)).toEqual([
        'headache',
        'nausea',
        'rash',
      ]);
    }
  });

  it('citation points to openFDA event endpoint with the rxcui', async () => {
    eventsMock.mockResolvedValueOnce({
      ok: true,
      data: [{ term: 'headache', count: 1 }],
    });
    const out = await lookupAdverseEventsHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.citation.source).toBe('openFda');
      expect(out.data.citation.url).toContain('event.json');
      expect(out.data.citation.url).toContain('rxcui:1191');
    }
  });

  it('embeds the canonical disclaimer', async () => {
    eventsMock.mockResolvedValueOnce({
      ok: true,
      data: [{ term: 'nausea', count: 1 }],
    });
    const out = await lookupAdverseEventsHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.disclaimer).toBe(DISCLAIMER);
  });

  it('passes the caller-specified limit to openFDA', async () => {
    eventsMock.mockResolvedValueOnce({
      ok: true,
      data: [{ term: 'nausea', count: 1 }],
    });
    await lookupAdverseEventsHandler({ name: 'aspirin', limit: 25 });
    expect(eventsMock).toHaveBeenCalledWith({
      rxcui: '1191',
      genericName: 'Aspirin',
      limit: 25,
    });
  });

  it('uses resolved name (not raw input) as drugName', async () => {
    eventsMock.mockResolvedValueOnce({
      ok: true,
      data: [{ term: 'nausea', count: 1 }],
    });
    const out = await lookupAdverseEventsHandler({ name: 'asprin' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.drugName).toBe('Aspirin');
  });

  it('success payload conforms to LookupAdverseEventsOutputSchema', async () => {
    eventsMock.mockResolvedValueOnce({
      ok: true,
      data: [{ term: 'headache', count: 100 }],
    });
    const out = await lookupAdverseEventsHandler({ name: 'aspirin' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const parsed = LookupAdverseEventsOutputSchema.safeParse(out.data);
      expect(parsed.success).toBe(true);
    }
  });
});
