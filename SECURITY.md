# Security Policy

## Reporting a Vulnerability

If you discover a security issue in `clinical-reference-mcp`, please **do not**
open a public GitHub issue. Instead, email **goldenshaddyt@gmail.com** (subject
prefix: `[SECURITY]`) with:

- A description of the issue and its potential impact
- Steps to reproduce (proof-of-concept code if applicable)
- Your assessment of severity

You should receive an acknowledgement within 72 hours. Coordinated disclosure
timelines and full policy will be published with v0.1.0.

## Scope

This project is **not a medical device** and is **not intended for clinical use**.
Issues that depend on misuse of the project for clinical decision-making are out
of scope as security issues — they are addressed by the safety framing in the
README and tool descriptions.

In-scope examples:

- Vulnerabilities in the MCP server, HTTP transport, or CLI (e.g., injection,
  SSRF, denial-of-service)
- Issues that allow bypass of the safety disclaimer surfaces
- Supply-chain concerns in published artifacts

Full security policy lands in Phase 5.
