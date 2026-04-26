# clinical-reference-mcp

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

> **Status: pre-release.** Phase 4 of 5: server, transports, tools, and CLI
> are implemented and tested but the package is not yet published to npm.
> Full documentation lands with v0.1.0.

An MCP (Model Context Protocol) server exposing drug, prescription, and pharmacology
reference tools sourced from authoritative public APIs (openFDA, RxNorm/RxNav).

> **Developer reference, not clinical use.** This server wraps publicly
> published regulator data so AI engineers can ground their tools in
> authoritative sources. It does not give medical advice and must not be
> used for clinical decision-making.

## Quickstart (Phase 4 — pre-release)

### Run the MCP server over stdio

```bash
pnpm install
pnpm build
node dist/server/stdio.js
```

### Run the MCP server over HTTP

```bash
pnpm build
node dist/server/http-bin.js
# Server listens on http://localhost:3000
# MCP endpoint: POST http://localhost:3000/mcp
# Health check: GET http://localhost:3000/health
```

`PORT` overrides the default listen port. Every response carries the
`X-Clinical-Reference-Disclaimer` header.

### Use the CLI

```bash
pnpm build
node dist/cli/index.js lookup-drug aspirin
node dist/cli/index.js get-drug-label aspirin --sections warnings,contraindications
node dist/cli/index.js check-interactions warfarin aspirin
node dist/cli/index.js find-alternatives lisinopril
node dist/cli/index.js lookup-adverse-events ibuprofen --limit 5
node dist/cli/index.js get-dosing-reference metformin
```

Add `--json` for the raw response envelope (pipeable into `jq`); add
`--no-disclaimer` to suppress the human-readable footer (the JSON envelope
still carries the disclaimer field).

> Status: pre-release. Not yet published to npm. Full installation
> instructions land in v0.1.

See [LICENSE](LICENSE) and [NOTICE](NOTICE) for licensing and attribution.
