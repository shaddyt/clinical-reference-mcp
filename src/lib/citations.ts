/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Citation } from './types';

export const SOURCE_HOMEPAGES = {
  openFda: 'https://open.fda.gov',
  rxnorm: 'https://www.nlm.nih.gov/research/umls/rxnorm/',
  rxnav: 'https://rxnav.nlm.nih.gov/',
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

// Use set_id (the stable SPL identifier) over the FDA application number:
// set_id continues to point at the same label revision even after the
// label is superseded, so the citation remains reproducible.
export function openFdaLabelCitation(setId: string): Citation {
  return {
    source: 'openFda',
    url: `https://api.fda.gov/drug/label.json?search=set_id:${encodeURIComponent(setId)}`,
    retrievedAt: nowIso(),
  };
}

export function openFdaAdverseEventCitation(rxcui: string): Citation {
  return {
    source: 'openFda',
    url: `https://api.fda.gov/drug/event.json?search=patient.drug.openfda.rxcui:${encodeURIComponent(rxcui)}`,
    retrievedAt: nowIso(),
  };
}

export function rxNormConceptCitation(rxcui: string): Citation {
  return {
    source: 'rxnorm',
    url: `https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(rxcui)}/properties.json`,
    retrievedAt: nowIso(),
  };
}

export function rxNavRelatedCitation(rxcui: string, rela: string): Citation {
  return {
    source: 'rxnav',
    url: `https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(rxcui)}/related.json?rela=${encodeURIComponent(rela)}`,
    retrievedAt: nowIso(),
  };
}

export function rxClassByRxCuiCitation(rxcui: string): Citation {
  return {
    source: 'rxnav',
    url: `https://rxnav.nlm.nih.gov/REST/rxclass/class/byRxcui.json?rxcui=${encodeURIComponent(rxcui)}`,
    retrievedAt: nowIso(),
  };
}
