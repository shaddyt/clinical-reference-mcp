/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';

import { respond, respondError } from '../../src/lib/respond';
import { DISCLAIMER } from '../../src/lib/safety';
import type { ToolError } from '../../src/lib/types';

describe('respond', () => {
  it('wraps the data with an ok:true discriminant', () => {
    const out = respond({ rxcui: '1191' });
    expect(out).toEqual({ ok: true, data: { rxcui: '1191' } });
  });

  it('does not modify the data object identity', () => {
    const data = { foo: 'bar' };
    const out = respond(data);
    expect(out.data).toBe(data);
  });

  it('does not inject disclaimer or citation at the envelope level on success', () => {
    // Disclaimer/citation live inside the schema-typed `data` payload;
    // duplicating them at the envelope level would invite drift between
    // the two copies.
    const out = respond({ disclaimer: 'inner', citation: 'inner' });
    expect(Object.keys(out)).toEqual(['ok', 'data']);
  });

  it('preserves the generic type through the envelope', () => {
    interface Payload {
      rxcui: string;
      brandNames: string[];
    }
    const data: Payload = { rxcui: '1191', brandNames: ['Aspirin'] };
    const out = respond<Payload>(data);
    expect(out.data.rxcui).toBe('1191');
    expect(out.data.brandNames).toEqual(['Aspirin']);
  });
});

describe('respondError', () => {
  const sampleError: ToolError = {
    code: 'DATA_NOT_FOUND',
    message: 'Drug not found in RxNorm: zzznotadrug',
  };

  it('wraps the error with an ok:false discriminant and disclaimer', () => {
    const out = respondError(sampleError);
    expect(out).toEqual({
      ok: false,
      error: sampleError,
      disclaimer: DISCLAIMER,
    });
  });

  it('attaches the canonical disclaimer string verbatim', () => {
    const out = respondError(sampleError);
    expect(out.disclaimer).toBe(DISCLAIMER);
  });

  it('does not modify the error object identity', () => {
    const out = respondError(sampleError);
    expect(out.error).toBe(sampleError);
  });

  it('preserves optional ToolError fields (candidates, retryable)', () => {
    const richError: ToolError = {
      code: 'AMBIGUOUS_QUERY',
      message: 'multiple matches',
      candidates: [{ rxcui: '1', name: 'A', reason: 'score 90' }],
      retryable: false,
    };
    const out = respondError(richError);
    expect(out.error.candidates).toHaveLength(1);
    expect(out.error.retryable).toBe(false);
  });

  it('produces output shape compatible with all four error codes', () => {
    const codes = [
      'DATA_NOT_FOUND',
      'AMBIGUOUS_QUERY',
      'UPSTREAM_ERROR',
      'INVALID_INPUT',
    ] as const;
    for (const code of codes) {
      const out = respondError({ code, message: 'x' });
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe(code);
      expect(out.disclaimer).toBe(DISCLAIMER);
    }
  });
});
