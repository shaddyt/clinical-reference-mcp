# Contributing

Thanks for your interest in `clinical-reference-mcp`. Full contributor guidelines
will be published with v0.1.0. Until then, a few principles that won't change:

## Scope discipline

This server **wraps and surfaces** regulator-published data. It does not, and
will not, **synthesize new clinical conclusions**. PRs that introduce clinical
reasoning, treatment recommendations, allergy logic, or prescription validation
will be declined.

If you have an idea that lives near this line, open an issue first — happy to
talk through it.

## Development

Requires Node.js ≥20 and pnpm 10.

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

All four must pass before a PR is merged.

## Licensing

By submitting a contribution, you agree it will be licensed under Apache
License 2.0 (see [LICENSE](LICENSE)). Source files include an SPDX header.

Full process notes (commit conventions, changesets, review flow) land in
Phase 5.
