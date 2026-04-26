# @shaddyt/clinical-reference-mcp

> _Drug, prescription, and pharmacology reference tools for AI engineers, sourced from openFDA and RxNorm/RxNav._

[![npm version](https://img.shields.io/npm/v/@shaddyt/clinical-reference-mcp?style=flat)](https://www.npmjs.com/package/@shaddyt/clinical-reference-mcp)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue?style=flat)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen?style=flat)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/shaddyt/clinical-reference-mcp/ci.yml?branch=main&label=CI&style=flat)](https://github.com/shaddyt/clinical-reference-mcp/actions/workflows/ci.yml)
[![MCP Server](https://img.shields.io/badge/MCP-Server-0e7490?style=flat)](https://modelcontextprotocol.io)

An MCP (Model Context Protocol) server that gives AI agents and command-line callers a small, citable set of drug-reference tools backed by U.S. regulator data: openFDA for FDA-approved labels and adverse-event reports, and RxNorm/RxNav for drug naming and therapeutic-class lookups. It is built for AI engineers who want their healthcare-adjacent features grounded in authoritative sources rather than improvised by a language model. It is **not** clinical decision support, **not** an FDA-cleared device, and **not** for patient-facing use. The project exists because there is a real gap in safe, citable healthcare tooling for AI builders, and because someone with both a medical degree and a production engineering background is well placed to draw the line between "useful reference" and "irresponsible advice."

## Try it without installing

A live HTTP MCP endpoint runs at **<https://clinical-reference.shaddyt.space>**. Visit the URL in a browser for a one-page connection guide, or point any MCP client that speaks Streamable HTTP at `https://clinical-reference.shaddyt.space/mcp`.

## Safety & scope

> **Returns regulator-published data only. Not for clinical use - for developer reference.**

(Verbatim from [`src/lib/safety.ts`](src/lib/safety.ts) — the same disclaimer text appears in every response payload, every HTTP response header, every CLI footer, and every MCP tool description.)

This server is:

- **Not clinical decision support.** It does not synthesize diagnoses, treatment plans, or prescribing recommendations. Tools return structured slices of regulator-published documents.
- **Not FDA-cleared.** No part of this software has been reviewed or approved by any regulatory body.
- **Not for patient-facing use.** No tool accepts patient identifiers, and no response should be shown directly to a patient as medical guidance.

Security reports go to the maintainer per [SECURITY.md](SECURITY.md).

## Quickstart

Three paths, each working from a clean install with no API keys or configuration.

### Use with Claude Code

Add this to your Claude Code MCP configuration:

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

Restart Claude Code. The six tools become available to the agent.

### Use with Claude Desktop

Add the same block to `claude_desktop_config.json` (locations: `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

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

Restart Claude Desktop. The six tools become available in the conversation.

### Use as a CLI

Every tool is also exposed as a subcommand of a standalone CLI, useful for shell scripting, manual lookups, or piping into `jq`:

```bash
npx -p @shaddyt/clinical-reference-mcp clinical-reference lookup-drug aspirin
npx -p @shaddyt/clinical-reference-mcp clinical-reference get-drug-label aspirin --sections warnings
npx -p @shaddyt/clinical-reference-mcp clinical-reference check-interactions warfarin aspirin
```

Add `--json` for the raw response envelope; add `--no-disclaimer` to suppress the human-readable footer (the JSON envelope still carries the disclaimer field).

## Available tools

| Tool                    | Purpose                                          | Source         |
| ----------------------- | ------------------------------------------------ | -------------- |
| `lookup_drug`           | Resolve a name to RxNorm canonical data          | RxNorm         |
| `get_drug_label`        | Fetch FDA-approved label sections                | openFDA        |
| `check_interactions`    | Surface label warnings mentioning multiple drugs | openFDA        |
| `find_alternatives`     | List other drugs in the same therapeutic class   | RxNorm RxClass |
| `lookup_adverse_events` | Top reported adverse events from FAERS           | openFDA        |
| `get_dosing_reference`  | Published dosing text from FDA labels            | openFDA        |

Every successful response carries the disclaimer text plus a citation block listing the upstream sources used to produce it.

## Architecture

The codebase is layered. Outbound HTTP funnels through one chokepoint at [`src/lib/http.ts`](src/lib/http.ts), which is the only place in the project that calls `fetch`. Above that sit per-source clients (`openfda.ts`, `rxnorm.ts`), then normalization (`normalize.ts`), then pure tool handlers under [`src/server/tools/`](src/server/tools/), then the transport-agnostic MCP server factory in [`src/server/server.ts`](src/server/server.ts), and finally three entry points: stdio, Streamable HTTP, and the CLI.

```
              ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
              │ stdio bin    │  │ HTTP bin     │  │ CLI          │
              └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                     │                 │                 │
                     └────── server.ts (registry + dispatch) ──────┘
                                         │
                          tools/ (pure handler functions)
                                         │
                       lib/ (clients, normalize, respond, safety)
                                         │
                              http.ts (single fetch chokepoint)
```

[CONTRIBUTING.md](CONTRIBUTING.md) walks through the structure in more detail.

## Data sources & attribution

- **openFDA** — the U.S. Food and Drug Administration's public API for FDA-approved drug labels and FAERS adverse-event reports. Public domain, freely redistributable.
- **RxNorm** — the U.S. National Library of Medicine's normalized vocabulary for clinical drug names. Public domain, freely redistributable.
- **RxNav** — NLM's API surface over RxNorm and RxClass (therapeutic-class lookups). Same terms.

Formal attribution lives in [NOTICE](NOTICE). This project is independent of, and not endorsed by, the FDA or NLM.

## Versioning & stability

Semantic Versioning. Currently **0.1.0**.

Tool names, tool input schemas, and response envelope shapes are stable from 0.1 forward — breaking changes here will land in a major version. Internal modules under `src/lib/` are **not** part of the public API and may change in any release; the public library export is intentionally narrow (safety constants, citation builders, response helpers, types). See [`src/index.ts`](src/index.ts) for the full public surface.

## Contributing

Issues and PRs welcome. One scope rule worth flagging up front: **PRs that introduce clinical reasoning, treatment recommendations, allergy logic, or prescription validation will be declined.** This server wraps regulator-published data; it does not synthesize clinical decisions. Full process notes in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE). Attribution and third-party notices in [NOTICE](NOTICE).

## About the author

Dr. Shadrack Omary is a Medical Doctor and Senior Full Stack Engineer based in Tanzania. He is Co-Founder & CTO at Hisa Hub, an AI-driven market intelligence platform, and Engineering Lead at Zandbox. The combination of clinical training and production engineering shaped this project: tools for healthcare AI builders, designed by someone who has both modeled clinical workflows in the EHR and shipped TypeScript at scale.

More work at [shaddyt.space](https://shaddyt.space).
