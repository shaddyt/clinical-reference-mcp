# Contributing

Thanks for your interest in `clinical-reference-mcp`. The project is small,
opinionated, and built around one rule: **wrap regulator-published data, never
synthesize clinical conclusions.** Contributions that respect that rule are
welcome — bug fixes, documentation improvements, test coverage, performance
work, and new transports all have a clear path. Contributions that cross the
rule will be declined, even if technically excellent.

## Scope discipline (read this first)

PRs that introduce **clinical reasoning, treatment recommendations, allergy
logic, prescription validation, or any feature that synthesizes a clinical
decision will be declined.** This is not a stylistic preference — it is the
project's reason for existing as a thin, citable wrapper around public data.
The downstream LLM is responsible for reasoning; this server is responsible
for grounding that reasoning in regulator-published sources.

PRs that **add new data sources** require evidence that the source is:

- Publicly accessible without authentication that costs money or requires
  institutional credentials
- Free to redistribute (or fetched live with proper attribution; no caching of
  copyrighted commercial datasets)
- Published by a regulator, public health agency, or recognized standards body

If your idea lives near either of these lines, open an issue first. A short
discussion saves both of us a wasted PR.

## Development setup

Requirements: **Node.js ≥20** and **pnpm 10**.

```bash
git clone https://github.com/shaddyt/clinical-reference-mcp.git
cd clinical-reference-mcp
pnpm install
```

The four gates that must pass before any PR is merged:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

A `pnpm test:coverage` run is also required for any PR that adds or changes
runtime code. Coverage thresholds are enforced in `vitest.config.ts` and only
move in one direction: up.

## Project structure

The codebase is layered. Each layer has a single responsibility and a single
direction of dependency.

```
src/
├── lib/              Pure library modules (no MCP, no transport awareness)
│   ├── http.ts       Single fetch chokepoint (every outbound HTTP goes here)
│   ├── cache.ts      LRU cache wrapper
│   ├── ratelimit.ts  Token-bucket limiter for upstream APIs
│   ├── openfda.ts    openFDA client
│   ├── rxnorm.ts     RxNorm/RxNav client
│   ├── normalize.ts  Shared normalization for upstream payload shapes
│   ├── respond.ts    Response envelope helpers (disclaimer + citations)
│   ├── safety.ts     Disclaimer constants (single source of truth)
│   ├── citations.ts  Citation builders
│   ├── types.ts      Shared types
│   └── version.ts    Package version constant
├── server/
│   ├── server.ts     Transport-agnostic factory; tool registry + dispatch
│   ├── stdio.ts      stdio bin entry
│   ├── http.ts       Hono-based Streamable HTTP transport
│   ├── http-bin.ts   Node HTTP bin entry
│   └── tools/        One file per MCP tool — pure handler functions
└── cli/
    └── index.ts      commander-based CLI; reuses the same handlers
```

The arrows go one way: `cli` and `server` depend on `lib`; nothing in `lib`
depends on either. New tools are added under `server/tools/` and registered in
`server/server.ts`. New data sources land in `lib/` as their own client module
with their own tests.

## Testing requirements

- Tests are required for any new runtime code.
- Coverage is enforced in CI; the threshold ratchets up over time and is never
  lowered.
- Prefer hitting `lib/http.ts`'s fetch-injection seam in tests over mocking
  `fetch` globally — the seam is there for exactly this reason.
- Network calls in tests are forbidden. Fixtures live alongside the test files
  that consume them.

## Commit conventions

This project uses **Conventional Commits**. Commit subjects follow the form:

```
<type>(<scope>): <subject>
```

Types in active use:

| Type       | Use for                                                      |
| ---------- | ------------------------------------------------------------ |
| `feat`     | A new tool, transport, CLI command, or other user-facing add |
| `fix`      | A bug fix in shipped behavior                                |
| `docs`     | README, CONTRIBUTING, SECURITY, RELEASES, JSDoc-only changes |
| `chore`    | Tooling, dependencies, CI, build config, version bumps       |
| `refactor` | Internal restructuring with no behavior change               |
| `test`     | Adding or revising tests without runtime changes             |

The scope is the area of the codebase: `tools`, `server`, `cli`, `lib`,
`deploy`, etc. Examples from the project history:

```
feat(tools): get_dosing_reference
feat(server): streamable HTTP transport with Hono
chore: bump coverage threshold to 95/90
```

Automated changelog tooling will be adopted in v0.2. For now the discipline is
manual — `RELEASES.md` is hand-written and curated.

## Pull request process

1. **One logical change per PR.** Refactors, feature work, and dependency
   bumps are separate PRs.
2. **Link an issue or include a rationale paragraph.** "Why this change" is
   more valuable than "what this change does" — the diff already shows the
   what.
3. **Keep diffs focused.** A 50-line PR that does one thing well will be
   reviewed faster than a 500-line PR that does five things.
4. **All four gates green.** A PR with red CI will not be reviewed.
5. **Disclaimer surfaces are non-negotiable.** Any change that touches
   response shapes, tool descriptions, or transport headers must preserve the
   disclaimer. Tests guard this.

## Licensing

This project is licensed under **Apache License 2.0** (see [LICENSE](LICENSE)).
By submitting a contribution, you agree it will be licensed under the same
terms. The Apache 2.0 license includes an implicit grant of patent rights from
contributors; no separate CLA is required, and no DCO sign-off is enforced.

Source files include an SPDX header:

```ts
/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */
```

New files should carry the same header.
