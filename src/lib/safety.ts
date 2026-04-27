/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

// Single source of disclaimer text for every surface (LLM tool descriptions,
// response payloads, CLI output, HTTP response headers). Drift between
// surfaces is how safety messaging gets diluted. Kept ASCII-only so the
// string is safe to encode as an HTTP header byte string without escaping.
export const DISCLAIMER =
  'Returns regulator-published data only. Not for clinical use - for developer reference.';

// Suffix appended to every MCP tool description (the field the LLM reads
// when choosing a tool), so the safety framing is in front of the model
// every time it considers a tool call.
export const TOOL_DESCRIPTION_SUFFIX = ` ${DISCLAIMER}`;

// HTTP response header carrying the disclaimer for cross-origin clients
// that don't render the response body (browser dev tools, log processors,
// monitoring agents).
export const HTTP_DISCLAIMER_HEADER = 'X-Clinical-Reference-Disclaimer';

// Quantitative-interpretation guardrails for FAERS-derived data. The base
// DISCLAIMER tells callers "regulator-published, not clinical use"; this
// constant adds the specific reasons FAERS counts cannot be read as risk
// or incidence: voluntary submission, no denominator, confounding by
// concomitant medications, reporting bias for newer drugs. Surfaced
// prominently above the events list in every lookup_adverse_events
// response so a viewer reads the caveat before the data, not after.
// Plain ASCII so it round-trips through HTTP headers and CLI output
// without escaping. No markdown -- consumers render it as plain text or
// embed it in HTML directly.
export const FAERS_LIMITATIONS =
  'FAERS reports are voluntary submissions from patients, providers, and manufacturers. Counts shown are report frequencies, not incidence rates -- they do not establish causation, and a drug may appear in a report as a concomitant medication without being causally linked to the event. Newer or highly publicized drugs receive more reports proportionally. Use these counts as a signal for investigation, not as a measure of risk.';
