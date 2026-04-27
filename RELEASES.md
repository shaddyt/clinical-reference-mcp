# Releases

## v0.2.0 — 2026-04-27

The first feature release after launch. The hosted demo at clinical-reference.shaddyt.space is now actually interactive: visitors land on a single page, pick one of the six tools from a dropdown, enter a drug name (the page comes pre-loaded with `lookup_drug aspirin` so the first click works without typing), and see live results from openFDA / RxNorm / RxNav rendered in the browser. No install, no MCP client, no JSON-RPC required.

### What's new

- **Interactive demo at `GET /`.** Tool selector, input field, run button, and a rendered result with a clickable citation link, an inline "Show raw JSON" toggle, and a Copy button for the JSON envelope. The disclaimer remains in a prominent yellow callout above the result. Mobile-responsive; respects `prefers-color-scheme: dark`. Vanilla HTML / CSS / JavaScript served as a single inline string from the Worker — no framework, no external resources, no analytics, no client storage.
- **New endpoint: `POST /api/tool/:name`.** Thin HTTP wrapper around the tool registry that takes JSON input and returns the same `{ ok: true, data } | { ok: false, error, disclaimer }` envelope the MCP CallTool response carries. Backs the in-browser demo. Marked with an `X-API-Note: demo-backend; not-part-of-mcp-spec` response header on every `/api/*` response so anyone discovering the route knows the MCP-compliant entry point remains `POST /mcp`. Unknown tool names return 404 with a structured `details.validTools` array. ([734bafd](https://github.com/shaddyt/clinical-reference-mcp/commit/734bafd))
- **Refactor: shared tool registry in `src/server/tools/registry.ts`.** `TOOL_REGISTRY`, `TOOL_NAMES`, `isToolName`, and a transport-agnostic `dispatchTool(name, input)` now live in one module consumed by both the MCP server (`src/server/server.ts`) and the new HTTP route. A future third invocation surface plugs in without further refactor. ([2e83d96](https://github.com/shaddyt/clinical-reference-mcp/commit/2e83d96))
- **No new runtime dependencies.** The page is vanilla HTML, CSS, and JavaScript served as a single string. Total payload ~20.4 KB (under a self-imposed 25 KB ceiling, locked in by a regression test).

### Pre-release fixes (rolled into v0.2.0)

While preparing v0.2.0 for release, clinical-quality testing through the new interactive demo surfaced critical bugs in the v0.1.x line. Rather than ship the demo against a v0.1.x backend that 404s on common drugs, the fixes are folded into v0.2.0:

- **`lookup_adverse_events`, `get_drug_label`, `check_interactions`, and `get_dosing_reference` query construction.** The v0.1.x line queried openFDA only by RxCUI (e.g. `openfda.rxcui:"11289"` for warfarin, `patient.drug.openfda.rxcui:"11289"` for FAERS). openFDA stores RxCUIs at the SCD/SBD clinical-product level, not the IN-level returned by RxNorm — warfarin's labels carry RxCUIs like 855288, never 11289 — and many older FAERS reports predate RxCUI annotation entirely. The pre-deploy demo screenshots showed `lookup_adverse_events warfarin`, `check_interactions warfarin,aspirin`, `get_drug_label aspirin`, and `get_dosing_reference warfarin` all returning `DATA_NOT_FOUND`. v0.2.0 replaces the single-field search with a single Lucene OR-query covering both indices in one round-trip:

  ```
  openfda.rxcui:"<rxcui>" OR openfda.generic_name:"<lower(name)>"
  ```

  (events use the `patient.drug.openfda.*` prefixed paths.) Verified live: warfarin's FAERS query now returns "INTERNATIONAL NORMALISED RATIO INCREASED" as the top reaction with 10,374 reports. Hardcoded URL encoding avoids the v0.1.3 RxNav `+ → %2B` bug class.

- **Error message sanitization.** v0.1.x returned errors like `"Not found at https://api.fda.gov/drug/event.json?search=patient.drug.openfda.rxcui%3A%2211289%22..."` — raw URL plumbing leaked into the user-facing message. v0.2.0 splits the audience: `error.message` uses clinical-domain language naming the upstream service ("No matching records found in openFDA", "Upstream service RxNav rate-limited the request"); the full URL, status, and upstream label live in `error.details` for engineers debugging.

- **FAERS-limitations rendering.** Successful `lookup_adverse_events` responses now carry a required `limitations` field populated from a central `FAERS_LIMITATIONS` constant in `src/lib/safety.ts`. The demo and CLI render this in a yellow callout *above* the events list — a viewer reads "FAERS counts do not establish causation" before reading "DEATH: 1,339 reports", not after. Shipping FAERS counts without their interpretation guardrails is a safety issue, not a UX nicety. v0.1.x consumers see one new field on the success envelope; backward-compatible.

- **Live-API integration tests.** `tests/integration/live-api.test.ts` (gated behind `RUN_LIVE_TESTS=1`, run via `pnpm test:live`) hits real openFDA + RxNav across the same handlers MCP/HTTP/CLI use, covering 10 common drugs across all 6 tools. Default `pnpm test` stays fast and offline-capable. Future nightly CI runs `pnpm test:live` to detect upstream API drift before users do.

The lesson the v0.1.x line teaches: mock-only unit tests are necessary but not sufficient for boundary code. Query construction has to be validated against the real API surface, not just against assumptions about it. The live-API suite is the structural fix.

### What's not changed

- **All 6 tools and their schemas are unchanged.** v0.1.x consumers can upgrade safely; tool names, input schemas, and response envelopes are byte-for-byte the same.
- **The MCP transport (`POST /mcp`) and stdio transport are unchanged.** Both continue to use the same registry the demo backend dispatches through, so behavior cannot diverge between the two surfaces.
- **The CLI is unchanged.** Same subcommands, same flags, same JSON envelopes.
- **The npm package install path is unchanged.** `npx -y @shaddyt/clinical-reference-mcp` still works the same way. The `bin` entries are unchanged.
- **The 96/91 coverage floor is held; the test count grew from 309 to 335** with the new endpoint, demo-page assertions, and openFDA fallback helper tests.

### Where this sits in the release history

The v0.1.0 → v0.1.3 sequence shipped a working stack on launch weekend, then patched three downstream bugs surfaced by post-launch smoke tests against the live FDA / NIH endpoints (RxNav alias rows, RxCUI deduplication, `+`-encoded query params). v0.1.3 is the stable canonical release the v0.1.x line resolved to. v0.2.0 is the first release that adds new functionality on top of that stable base; it's a minor bump because the public contract surface (tool names, schemas, MCP transport, CLI) is unchanged.

### Acknowledgments

Same upstream sources as prior versions ([NOTICE](NOTICE)). The MCP specification and TypeScript SDK are maintained by Anthropic.

---

## v0.1.3 — 2026-04-27

A third post-launch patch on the same Sunday, completing the chain that began with v0.1.1. After v0.1.2 unblocked the resolver, `lookup_drug aspirin` reached its downstream RxNav calls and immediately failed with `UPSTREAM_ERROR` (HTTP 400) on the `related.json` fetch. The cause was a subtle URL-encoding bug that affected `lookup_drug` and `find_alternatives`. v0.1.3 fixes it.

### Fixed since v0.1.2

- **`lookup_drug` and `find_alternatives` now reach RxNav successfully.** Two URL builders used `URLSearchParams` to set list-valued query params (`tty`, `ttys`), which percent-encoded the literal `+` separator to `%2B`. RxNav requires the bare `+` and rejects `%2B` with 400. The builders now concatenate these specific list params directly so the `+` survives to the wire. TTY values are ASCII alphanumeric, so no encoding is needed. ([8794dd9](https://github.com/shaddyt/clinical-reference-mcp/commit/8794dd9))

The Phase 2 tests for these URLs asserted on the parsed form via `URL.searchParams.get()`, which decodes `%2B` back to `+` — masking the on-the-wire bug for over a year of test runs. The strengthened regression tests now check the raw URL string for `tty=IN+BN` / `ttys=IN+PIN` and assert `%2B` is absent, locking the on-the-wire contract.

### What's in v0.1.3

Same six tools and three transports as prior releases. Public contracts (tool names, input schemas, response envelopes, CLI commands) are unchanged.

### Acknowledgments

Same upstream sources as prior versions ([NOTICE](NOTICE)).

---

## v0.1.2 — 2026-04-27

_Superseded by v0.1.3, which fixes a downstream RxNav URL-encoding bug surfaced by the v0.1.2 smoke test. Install `@shaddyt/clinical-reference-mcp@latest` to get v0.1.3._

A second post-launch patch on the same Sunday, addressing a follow-on bug surfaced by the v0.1.1 smoke test. Once name-less candidates were filtered (v0.1.1), `lookup_drug` for common drugs like `aspirin` started returning `AMBIGUOUS_QUERY` — because RxNav returns one row per terminology source (USP, RXNORM, VANDF, MMSL) for the same drug, all sharing one RxCUI but varying in case-folding of the name. v0.1.2 collapses these to a single resolved match.

### Fixed since v0.1.1

- **`lookup_drug` now resolves common drug names directly instead of asking callers to disambiguate identical RxCUIs.** When every approximate-match candidate points at the same RxCUI, the resolver returns `resolved` with the RXNORM source's canonical name (e.g. `aspirin` rather than `Aspirin`/`ASPIRIN`). True multi-drug ambiguity (distinct RxCUIs) still returns `AMBIGUOUS_QUERY` unchanged. ([fc1f491](https://github.com/shaddyt/clinical-reference-mcp/commit/fc1f491))

Two regression tests in `tests/unit/normalize.test.ts` lock the new behavior — one mirrors the live `aspirin` shape, one covers the fallback path when no RXNORM-sourced row is present.

### What's in v0.1.2

Same six tools and three transports as v0.1.1; no public-contract changes. The package surface, MCP tool names, response envelopes, and CLI commands are unchanged.

### Acknowledgments

Same upstream sources as prior versions ([NOTICE](NOTICE)). The MCP specification and TypeScript SDK are maintained by Anthropic.

---

## v0.1.1 — 2026-04-27

_Superseded by v0.1.2, which fixes a follow-on resolver bug surfaced by the v0.1.1 smoke test. Install `@shaddyt/clinical-reference-mcp@latest` to get v0.1.2._

This was the first version of `@shaddyt/clinical-reference-mcp` recommended for use. v0.1.0 shipped to npm earlier the same weekend but had an unintentional bug in the RxNav boundary parser that prevented `lookup_drug` from resolving most common drug names. v0.1.1 fixed that boundary bug.

### Fixed since v0.1.0

- **`lookup_drug` now correctly handles RxNav approximate-match candidates that omit the `name` field.** RxNav returns alias rows from some terminology sources (Gold Standard, First Databank, MMSL) without a display name; the v0.1.0 boundary parser rejected these, causing common queries like `lookup-drug aspirin` to fail with `UPSTREAM_ERROR`. The boundary now accepts those rows and filters them at parse time so they never reach downstream consumers. Public `MatchCandidate` contract is unchanged — `name: string` is still guaranteed for everything callers see. ([b329a06](https://github.com/shaddyt/clinical-reference-mcp/commit/b329a06))

A regression test in `tests/unit/rxnorm.test.ts` mirrors the live RxNav response shape so the gap that hid this bug in Phase 2 is closed.

### What's in v0.1.1

Six tools, each backed by a public-domain data source and each returning a response envelope that carries the safety disclaimer plus a citation block:

- **`lookup_drug`** — Resolves a free-text drug name to RxNorm canonical data (RxCUI, normalized name, term type).
- **`get_drug_label`** — Fetches FDA-approved label sections (warnings, contraindications, dosage, indications, etc.) from openFDA.
- **`check_interactions`** — Surfaces openFDA label warnings that mention multiple named drugs together. A grounded interaction lookup, not a synthesized prediction.
- **`find_alternatives`** — Lists other drugs in the same therapeutic class via RxNorm RxClass. Useful for "what else is in this category" questions, not for substitution recommendations.
- **`lookup_adverse_events`** — Returns the top reported adverse events for a drug from the FDA's FAERS dataset, with frequency counts.
- **`get_dosing_reference`** — Extracts the dosing-and-administration text from FDA labels.

Three transports ship in the same package:

- **stdio MCP server** (`clinical-reference-mcp` bin) — the standard MCP integration path for Claude Code, Claude Desktop, and other LLM hosts.
- **Streamable HTTP MCP server** — the same server over HTTP, deployable anywhere that runs a Node process or a Cloudflare Worker.
- **CLI** (`clinical-reference` bin) — every tool exposed as a subcommand, with `--json` for machine-readable output and `--no-disclaimer` for human-readable mode.

### How to use it

Three paths, each working from a clean install with no API keys or configuration.

**With Claude Code or Claude Desktop:**

```json
{
  "mcpServers": {
    "clinical-reference": {
      "command": "npx",
      "args": ["-y", "@shaddyt/clinical-reference-mcp"]
    }
  }
}
```

**As a CLI:**

```bash
npx -p @shaddyt/clinical-reference-mcp clinical-reference lookup-drug aspirin
```

**Hosted, no install:**

```
https://clinical-reference.shaddyt.space
```

### What's not in v0.1.1

Stating the boundaries explicitly so callers calibrate expectations:

- **No clinical reasoning.** No tool synthesizes diagnoses, treatment plans, dosing recommendations beyond what an FDA label literally says, or risk assessments. The downstream LLM is responsible for reasoning; this server is responsible for grounding.
- **No PHI handling.** No tool accepts patient identifiers, dates of birth, or any input that could constitute protected health information. All inputs are drug names or generic identifiers.
- **No drug-allergy logic.** Cross-referencing a patient's allergy profile against a drug is a clinical decision; out of scope.
- **No prescription validation.** Checking whether a prescription is appropriate for a given patient is a clinical decision; out of scope.
- **No private datasets.** Only publicly accessible, freely redistributable regulator sources. No commercial drug-pricing data, no proprietary interaction databases, no scraped EHR content.

### Try it

Live demo: <https://clinical-reference.shaddyt.space>

Source and issues: <https://github.com/shaddyt/clinical-reference-mcp>

npm package: <https://www.npmjs.com/package/@shaddyt/clinical-reference-mcp>

### Acknowledgments

This package wraps and surfaces data published by:

- **openFDA** — U.S. Food and Drug Administration
- **RxNorm** and **RxNav** — U.S. National Library of Medicine

Both agencies publish their data under public-domain terms with documented APIs. This software is independent of, and not endorsed by, either agency. Formal attribution lives in [NOTICE](NOTICE).

The Model Context Protocol specification and TypeScript SDK are maintained by Anthropic; this server implements the protocol and depends on the SDK.

---

Built by Dr. Shadrack Omary — Medical Doctor and Senior Full Stack Engineer. More work at [shaddyt.space](https://shaddyt.space).

---

## v0.1.0 — 2026-04-26

_Superseded by v0.1.1, which fixes a launch-day bug in `lookup_drug`. Install `@shaddyt/clinical-reference-mcp@latest` to get v0.1.1._

The first public release of `@shaddyt/clinical-reference-mcp`. This is the initial cut: a small, opinionated MCP server that gives AI agents a citable foothold into U.S. regulator-published drug data, plus a standalone CLI that exposes the same handlers for shell use. It is built for AI engineers who want their healthcare-adjacent features grounded in authoritative sources rather than improvised by a language model. It is not clinical decision support, and it never will be.

### What's in v0.1.0

Six tools, each backed by a public-domain data source and each returning a response envelope that carries the safety disclaimer plus a citation block:

- **`lookup_drug`** — Resolves a free-text drug name to RxNorm canonical data (RxCUI, normalized name, term type).
- **`get_drug_label`** — Fetches FDA-approved label sections (warnings, contraindications, dosage, indications, etc.) from openFDA.
- **`check_interactions`** — Surfaces openFDA label warnings that mention multiple named drugs together. A grounded interaction lookup, not a synthesized prediction.
- **`find_alternatives`** — Lists other drugs in the same therapeutic class via RxNorm RxClass. Useful for "what else is in this category" questions, not for substitution recommendations.
- **`lookup_adverse_events`** — Returns the top reported adverse events for a drug from the FDA's FAERS dataset, with frequency counts.
- **`get_dosing_reference`** — Extracts the dosing-and-administration text from FDA labels.

Three transports ship in the same package:

- **stdio MCP server** (`clinical-reference-mcp` bin) — the standard MCP integration path for Claude Code, Claude Desktop, and other LLM hosts.
- **Streamable HTTP MCP server** (`clinical-reference-mcp-http` via `dist/server/http-bin.js`) — the same server over HTTP, deployable anywhere that runs a Node process or a Cloudflare Worker.
- **CLI** (`clinical-reference` bin) — every tool exposed as a subcommand, with `--json` for machine-readable output and `--no-disclaimer` for human-readable mode.

### How to use it

Three paths, each working from a clean install with no API keys or configuration.

**With Claude Code or Claude Desktop:**

```json
{
  "mcpServers": {
    "clinical-reference": {
      "command": "npx",
      "args": ["-y", "@shaddyt/clinical-reference-mcp"]
    }
  }
}
```

**As a CLI:**

```bash
npx -p @shaddyt/clinical-reference-mcp clinical-reference lookup-drug aspirin
```

**Hosted, no install:**

```
https://clinical-reference.shaddyt.space
```

### What's not in v0.1.0

Stating the boundaries explicitly so callers calibrate expectations:

- **No clinical reasoning.** No tool synthesizes diagnoses, treatment plans, dosing recommendations beyond what an FDA label literally says, or risk assessments. The downstream LLM is responsible for reasoning; this server is responsible for grounding.
- **No PHI handling.** No tool accepts patient identifiers, dates of birth, or any input that could constitute protected health information. All inputs are drug names or generic identifiers.
- **No drug-allergy logic.** Cross-referencing a patient's allergy profile against a drug is a clinical decision; out of scope.
- **No prescription validation.** Checking whether a prescription is appropriate for a given patient is a clinical decision; out of scope.
- **No private datasets.** Only publicly accessible, freely redistributable regulator sources. No commercial drug-pricing data, no proprietary interaction databases, no scraped EHR content.

### Try it

Live demo: <https://clinical-reference.shaddyt.space>

Source and issues: <https://github.com/shaddyt/clinical-reference-mcp>

npm package: <https://www.npmjs.com/package/@shaddyt/clinical-reference-mcp>

### Acknowledgments

This package wraps and surfaces data published by:

- **openFDA** — U.S. Food and Drug Administration
- **RxNorm** and **RxNav** — U.S. National Library of Medicine

Both agencies publish their data under public-domain terms with documented APIs. This software is independent of, and not endorsed by, either agency. Formal attribution lives in [NOTICE](NOTICE).

The Model Context Protocol specification and TypeScript SDK are maintained by Anthropic; this server implements the protocol and depends on the SDK.

---

Built by Dr. Shadrack Omary — Medical Doctor and Senior Full Stack Engineer. More work at [shaddyt.space](https://shaddyt.space).
