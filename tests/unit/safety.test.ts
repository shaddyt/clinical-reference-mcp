/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  DISCLAIMER,
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
});
