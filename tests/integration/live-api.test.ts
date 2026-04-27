/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { checkInteractionsHandler } from '../../src/server/tools/check-interactions';
import { findAlternativesHandler } from '../../src/server/tools/find-alternatives';
import { getDosingReferenceHandler } from '../../src/server/tools/get-dosing-reference';
import { getDrugLabelHandler } from '../../src/server/tools/get-drug-label';
import { lookupAdverseEventsHandler } from '../../src/server/tools/lookup-adverse-events';
import { lookupDrugHandler } from '../../src/server/tools/lookup-drug';

// Live-API smoke. Hits real openFDA + RxNav. Skipped by default so
// `pnpm test` stays fast and offline-capable; opt in via:
//
//   pnpm test:live
//
// Purpose: catch the class of bug surfaced by pre-deploy clinical-quality
// testing -- query construction that passes mocked unit tests but breaks
// against the actual API surface (e.g. RxCUI inconsistency in openFDA
// indices, RxNav '+' vs '%2B' encoding, FAERS rxcui sparseness). Run
// nightly in CI to detect upstream API changes before users hit them.
//
// Each test exercises a real drug name end-to-end through the same
// handler the MCP/HTTP/CLI surfaces use.
const RUN = process.env['RUN_LIVE_TESTS'] === '1';
const desc = RUN ? describe : describe.skip;

// Top common drugs, chosen for: high prescription volume (warfarin,
// metformin, lisinopril, atorvastatin, levothyroxine), OTC reach
// (aspirin, ibuprofen, acetaminophen), and inclusion of antibiotics +
// PPIs (amoxicillin, omeprazole) so the smoke spans drug classes.
const DRUGS = [
  'aspirin',
  'warfarin',
  'metformin',
  'lisinopril',
  'atorvastatin',
  'acetaminophen',
  'ibuprofen',
  'levothyroxine',
  'amoxicillin',
  'omeprazole',
] as const;

// Subset for the slower / heavier label + alternative + dosing fetches.
const LABEL_SUBSET = ['aspirin', 'warfarin', 'metformin'] as const;

// Live API calls hit RxNav and openFDA in sequence; budget per test
// generously so a transient blip doesn't fail the smoke. The handler
// already retries 5xx with backoff under fetchJson.
const TIMEOUT_MS = 30_000;

desc('live API smoke (gated by RUN_LIVE_TESTS=1)', () => {
  it.each(DRUGS)(
    'lookup_drug %s returns ok with a rxcui and generic name',
    async (name) => {
      const result = await lookupDrugHandler({ name });
      expect(result.ok, `lookup_drug ${name} failed: ${JSON.stringify(result)}`).toBe(
        true,
      );
      if (result.ok) {
        expect(result.data.rxcui).toMatch(/^\d+$/);
        expect(result.data.genericName.length).toBeGreaterThan(0);
      }
    },
    TIMEOUT_MS,
  );

  it.each(DRUGS)(
    'lookup_adverse_events %s returns ok with at least 1 event and limitations text',
    async (name) => {
      const result = await lookupAdverseEventsHandler({ name });
      expect(
        result.ok,
        `lookup_adverse_events ${name} failed: ${JSON.stringify(result)}`,
      ).toBe(true);
      if (result.ok) {
        // The OR-query fix: every drug in DRUGS must come back with
        // events. If this fails for any common drug, FAERS coverage
        // regressed.
        expect(result.data.events.length).toBeGreaterThan(0);
        // FAERS_LIMITATIONS must always be present on the success path.
        expect(result.data.limitations).toMatch(/voluntary/i);
        expect(result.data.limitations).toMatch(/causation/i);
      }
    },
    TIMEOUT_MS,
  );

  it.each(LABEL_SUBSET)(
    'get_drug_label %s returns ok with at least 1 section',
    async (name) => {
      const result = await getDrugLabelHandler({ name });
      expect(result.ok, `get_drug_label ${name} failed: ${JSON.stringify(result)}`).toBe(
        true,
      );
      if (result.ok) {
        expect(result.data.sections.length).toBeGreaterThan(0);
      }
    },
    TIMEOUT_MS,
  );

  it.each(LABEL_SUBSET)(
    'find_alternatives %s returns ok with at least 1 alternative',
    async (name) => {
      const result = await findAlternativesHandler({ name });
      expect(
        result.ok,
        `find_alternatives ${name} failed: ${JSON.stringify(result)}`,
      ).toBe(true);
      if (result.ok) {
        expect(result.data.alternatives.length).toBeGreaterThan(0);
      }
    },
    TIMEOUT_MS,
  );

  it.each(LABEL_SUBSET)(
    'get_dosing_reference %s returns ok with at least 1 dosing entry',
    async (name) => {
      const result = await getDosingReferenceHandler({ name });
      expect(
        result.ok,
        `get_dosing_reference ${name} failed: ${JSON.stringify(result)}`,
      ).toBe(true);
      if (result.ok) {
        expect(result.data.entries.length).toBeGreaterThan(0);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'check_interactions warfarin + aspirin returns ok with text for both drugs',
    async () => {
      const result = await checkInteractionsHandler({
        drugs: ['warfarin', 'aspirin'],
      });
      expect(
        result.ok,
        `check_interactions warfarin+aspirin failed: ${JSON.stringify(result)}`,
      ).toBe(true);
      if (result.ok) {
        expect(result.data.drugs).toHaveLength(2);
        // The OR-query fix should populate interactionsText for both
        // (warfarin labels carry drug_interactions sections; aspirin
        // labels at minimum carry warnings as the fallback).
        for (const entry of result.data.drugs) {
          expect(entry.interactionsText).not.toBeNull();
        }
      }
    },
    TIMEOUT_MS,
  );
});
