# Releases

## v0.1.0 — 2026-04-26

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
