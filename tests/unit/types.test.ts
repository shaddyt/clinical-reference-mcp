/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  LookupDrugInputSchema,
  GetDrugLabelInputSchema,
  CheckInteractionsInputSchema,
  FindAlternativesInputSchema,
  LookupAdverseEventsInputSchema,
  GetDosingReferenceInputSchema,
  CitationSchema,
  ToolErrorSchema,
} from '../../src/lib/types';

describe('LookupDrugInputSchema', () => {
  it('accepts a non-empty name', () => {
    expect(LookupDrugInputSchema.parse({ name: 'aspirin' })).toEqual({ name: 'aspirin' });
  });
  it('trims surrounding whitespace', () => {
    expect(LookupDrugInputSchema.parse({ name: '  aspirin  ' })).toEqual({ name: 'aspirin' });
  });
  it('rejects empty name', () => {
    expect(() => LookupDrugInputSchema.parse({ name: '' })).toThrow();
  });
  it('rejects whitespace-only name', () => {
    expect(() => LookupDrugInputSchema.parse({ name: '   ' })).toThrow();
  });
  it('rejects names over 200 chars', () => {
    expect(() => LookupDrugInputSchema.parse({ name: 'a'.repeat(201) })).toThrow();
  });
});

describe('GetDrugLabelInputSchema', () => {
  it('makes sections optional', () => {
    expect(GetDrugLabelInputSchema.parse({ name: 'aspirin' })).toEqual({ name: 'aspirin' });
  });
  it('accepts an array of section names', () => {
    expect(
      GetDrugLabelInputSchema.parse({
        name: 'aspirin',
        sections: ['indications', 'warnings'],
      }),
    ).toEqual({ name: 'aspirin', sections: ['indications', 'warnings'] });
  });
  it('rejects empty section strings', () => {
    expect(() =>
      GetDrugLabelInputSchema.parse({ name: 'aspirin', sections: [''] }),
    ).toThrow();
  });
});

describe('CheckInteractionsInputSchema', () => {
  it('requires at least 2 drugs', () => {
    expect(() => CheckInteractionsInputSchema.parse({ drugs: ['aspirin'] })).toThrow();
  });
  it('accepts 2 or more drugs', () => {
    expect(
      CheckInteractionsInputSchema.parse({ drugs: ['aspirin', 'warfarin'] }),
    ).toEqual({ drugs: ['aspirin', 'warfarin'] });
  });
  it('rejects more than 10 drugs', () => {
    expect(() =>
      CheckInteractionsInputSchema.parse({ drugs: Array(11).fill('aspirin') }),
    ).toThrow();
  });
});

describe('FindAlternativesInputSchema', () => {
  it('accepts a single drug name', () => {
    expect(FindAlternativesInputSchema.parse({ name: 'aspirin' })).toEqual({
      name: 'aspirin',
    });
  });
});

describe('LookupAdverseEventsInputSchema', () => {
  it('defaults limit to 10', () => {
    expect(LookupAdverseEventsInputSchema.parse({ name: 'aspirin' })).toEqual({
      name: 'aspirin',
      limit: 10,
    });
  });
  it('rejects limit > 100', () => {
    expect(() =>
      LookupAdverseEventsInputSchema.parse({ name: 'aspirin', limit: 101 }),
    ).toThrow();
  });
  it('rejects non-positive limit', () => {
    expect(() =>
      LookupAdverseEventsInputSchema.parse({ name: 'aspirin', limit: 0 }),
    ).toThrow();
  });
});

describe('GetDosingReferenceInputSchema', () => {
  it('accepts a single drug name', () => {
    expect(GetDosingReferenceInputSchema.parse({ name: 'aspirin' })).toEqual({
      name: 'aspirin',
    });
  });
});

describe('CitationSchema', () => {
  it('validates a well-formed citation', () => {
    expect(
      CitationSchema.parse({
        source: 'openFda',
        url: 'https://api.fda.gov/drug/label.json?search=set_id:abc',
        retrievedAt: '2026-04-26T10:00:00.000Z',
      }),
    ).toBeTruthy();
  });
  it('rejects unknown source', () => {
    expect(() =>
      CitationSchema.parse({
        source: 'pubmed',
        url: 'https://example.com',
        retrievedAt: '2026-04-26T10:00:00.000Z',
      }),
    ).toThrow();
  });
  it('rejects non-URL', () => {
    expect(() =>
      CitationSchema.parse({
        source: 'openFda',
        url: 'not a url',
        retrievedAt: '2026-04-26T10:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('ToolErrorSchema', () => {
  it('accepts a basic error', () => {
    expect(
      ToolErrorSchema.parse({ code: 'DATA_NOT_FOUND', message: 'no match' }),
    ).toBeTruthy();
  });
  it('accepts an ambiguous error with candidates', () => {
    expect(
      ToolErrorSchema.parse({
        code: 'AMBIGUOUS_QUERY',
        message: 'multiple matches',
        candidates: [{ rxcui: '1191', name: 'aspirin', reason: 'exact match' }],
      }),
    ).toBeTruthy();
  });
  it('accepts a retryable upstream error', () => {
    expect(
      ToolErrorSchema.parse({
        code: 'UPSTREAM_ERROR',
        message: 'service unavailable',
        retryable: true,
      }),
    ).toMatchObject({ retryable: true });
  });
  it('treats retryable as optional', () => {
    expect(
      ToolErrorSchema.parse({ code: 'INVALID_INPUT', message: 'bad' }),
    ).not.toHaveProperty('retryable');
  });
});
