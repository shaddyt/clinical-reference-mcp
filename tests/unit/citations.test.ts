/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  openFdaLabelCitation,
  openFdaAdverseEventCitation,
  rxNormConceptCitation,
  rxNavRelatedCitation,
  rxClassByRxCuiCitation,
  SOURCE_HOMEPAGES,
} from '../../src/lib/citations';

describe('citation builders', () => {
  it('openFdaLabelCitation builds a label search URL with set_id', () => {
    const c = openFdaLabelCitation('abc-123');
    expect(c.source).toBe('openFda');
    expect(c.url).toContain('api.fda.gov/drug/label.json');
    expect(c.url).toContain('set_id:abc-123');
  });

  it('encodes set_id components that need escaping', () => {
    const c = openFdaLabelCitation('a b/c');
    expect(c.url).toContain(encodeURIComponent('a b/c'));
  });

  it('openFdaAdverseEventCitation targets the event endpoint with rxcui', () => {
    const c = openFdaAdverseEventCitation('1191');
    expect(c.source).toBe('openFda');
    expect(c.url).toContain('api.fda.gov/drug/event.json');
    expect(c.url).toContain('rxcui:1191');
  });

  it('rxNormConceptCitation points at properties.json with the rxcui', () => {
    const c = rxNormConceptCitation('1191');
    expect(c.source).toBe('rxnorm');
    expect(c.url).toContain('rxnav.nlm.nih.gov/REST/rxcui/1191/properties.json');
  });

  it('rxNavRelatedCitation includes the relation parameter', () => {
    const c = rxNavRelatedCitation('1191', 'has_ingredient');
    expect(c.source).toBe('rxnav');
    expect(c.url).toContain('related.json');
    expect(c.url).toContain('rela=has_ingredient');
  });

  it('rxClassByRxCuiCitation builds the rxclass byRxcui URL', () => {
    const c = rxClassByRxCuiCitation('1191');
    expect(c.source).toBe('rxnav');
    expect(c.url).toContain('rxclass/class/byRxcui.json');
    expect(c.url).toContain('rxcui=1191');
  });

  it('every citation includes a parseable ISO retrievedAt', () => {
    const c = rxNormConceptCitation('1191');
    expect(new Date(c.retrievedAt).toISOString()).toBe(c.retrievedAt);
  });

  it('exposes homepages for the three sources', () => {
    expect(SOURCE_HOMEPAGES.openFda).toMatch(/^https:\/\//);
    expect(SOURCE_HOMEPAGES.rxnorm).toMatch(/^https:\/\//);
    expect(SOURCE_HOMEPAGES.rxnav).toMatch(/^https:\/\//);
  });
});
