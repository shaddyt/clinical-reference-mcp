# Security Policy

`clinical-reference-mcp` exposes drug, prescription, and pharmacology reference
data to AI agents and command-line callers. The data is public-domain and the
package never processes patient information, but it sits adjacent to healthcare
workflows — a vulnerability here can mislead a downstream tool that an engineer
trusted to behave safely. Security reports are taken seriously and triaged
quickly.

## Reporting a Vulnerability

Email **goldenshaddyt@gmail.com** with the subject prefix `[security]`. Please
include:

- A description of the issue and its potential impact
- Steps to reproduce, with proof-of-concept code where applicable
- Your assessment of severity and any suggested remediation
- Whether you intend to disclose publicly, and on what timeline

You will receive an acknowledgement within **5 business days**. From there:

| Stage             | Target                                   |
| ----------------- | ---------------------------------------- |
| Initial triage    | 5 business days from report              |
| Fix or mitigation | Coordinated within the disclosure window |
| Public disclosure | 90 days from initial report (default)    |

If a vulnerability is being actively exploited, the disclosure window may
shorten by mutual agreement. If a fix requires more than 90 days, an extension
will be requested in writing with a justification.

A PGP key for encrypted reports is **not yet published**. One will be added in
v0.2. Until then, transport-level email security (TLS) is the floor; if a
report contains exploit detail you do not want sitting in plaintext mail,
contact the maintainer first to arrange a private channel.

## Scope

**In scope:**

- The published npm package (`@shaddyt/clinical-reference-mcp`) and any of its
  bundled artifacts (CLI, stdio server, HTTP server, Cloudflare Worker entry)
- The hosted demo at `clinical-reference.shaddyt.space`
- The CI workflows under `.github/workflows/` that produce release artifacts
- Bypasses of the safety disclaimer surfaces (response payloads, HTTP headers,
  CLI footer, MCP tool descriptions)
- Supply-chain concerns affecting the published tarball (e.g., unexpected
  files, malicious post-install scripts, prototype pollution in dependencies)

**Out of scope:**

- The upstream openFDA, RxNorm, and RxNav infrastructure operated by the U.S.
  Food and Drug Administration and the U.S. National Library of Medicine.
  Vulnerabilities in those services should be reported to those agencies.
- Issues that depend on misuse of this package for clinical decision-making.
  See the threat-model notes below.
- Denial-of-service via legitimate high-volume queries against upstream APIs;
  upstream rate limits are the relevant control, and this package honors them.

## Threat-model notes

Two notes that often arise and are worth stating directly:

1. **This package surfaces public-domain data. PHI is never processed.** No
   request body or response payload originates from a patient record, and no
   tool accepts patient identifiers as input. A "leak" of upstream data is
   not a leak — the data is published by the relevant U.S. federal agency.

2. **This package is not for clinical use.** Reports about clinical advice
   quality, dosing recommendations being incomplete, or interaction lookups
   missing edge cases should reference the safety disclaimer rather than be
   filed as security issues. The disclaimer is the contract: this is developer
   reference, not decision support.

## Disclosure policy

Coordinated disclosure on a 90-day window from the date of the initial report.
Reporters who follow this policy will be credited (with permission) in the
acknowledgements section below.

## Acknowledgements

No vulnerabilities have been reported to date. Reporters who follow the
coordinated disclosure policy will be credited here.

<!-- Format for future entries:
- YYYY-MM-DD — Reporter Name (affiliation, optional) — short description
-->
