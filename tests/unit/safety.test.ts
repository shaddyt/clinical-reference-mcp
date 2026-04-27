/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  DISCLAIMER,
  FAERS_LIMITATIONS,
  TOOL_DESCRIPTION_SUFFIX,
  HTTP_DISCLAIMER_HEADER,
} from '../../src/lib/safety';

describe('safety constants', () => {
  it('DISCLAIMER mentions "Not for clinical use"', () => {
    expect(DISCLAIMER).toMatch(/Not for clinical use/i);
  });

  it('DISCLAIMER mentions "developer reference"', () => {
    expect(DISCLAIMER).toMatch(/developer reference/i);
  });

  it('TOOL_DESCRIPTION_SUFFIX contains the full disclaimer', () => {
    expect(TOOL_DESCRIPTION_SUFFIX).toContain(DISCLAIMER);
  });

  it('TOOL_DESCRIPTION_SUFFIX starts with whitespace so it can be appended', () => {
    expect(TOOL_DESCRIPTION_SUFFIX.startsWith(' ')).toBe(true);
  });

  it('HTTP_DISCLAIMER_HEADER follows the X- vendor prefix convention', () => {
    expect(HTTP_DISCLAIMER_HEADER).toMatch(/^X-/);
  });

  it('FAERS_LIMITATIONS names voluntary reporting and lack of causation', () => {
    // The two specific quantitative interpretation hazards FAERS counts
    // can mask: "voluntary" (selection bias) and "causation" (correlation
    // /= cause). If these words leave the constant, the safety framing
    // weakens silently.
    expect(FAERS_LIMITATIONS).toMatch(/voluntary/i);
    expect(FAERS_LIMITATIONS).toMatch(/causation/i);
  });

  it('FAERS_LIMITATIONS is plain ASCII (header-safe, no smart punctuation)', () => {
    // eslint-disable-next-line no-control-regex
    expect(FAERS_LIMITATIONS).not.toMatch(/[^\x00-\x7F]/);
  });
});
