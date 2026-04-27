# Releases

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
