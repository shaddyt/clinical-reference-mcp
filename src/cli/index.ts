#!/usr/bin/env node
/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import chalk, { type ChalkInstance } from 'chalk';
import { Command } from 'commander';

import type { ToolResponse } from '../lib/respond';
import { VERSION } from '../lib/version';
import { checkInteractionsHandler } from '../server/tools/check-interactions';
import { findAlternativesHandler } from '../server/tools/find-alternatives';
import { getDosingReferenceHandler } from '../server/tools/get-dosing-reference';
import { getDrugLabelHandler } from '../server/tools/get-drug-label';
import { lookupAdverseEventsHandler } from '../server/tools/lookup-adverse-events';
import { lookupDrugHandler } from '../server/tools/lookup-drug';

interface OutputOptions {
  json: boolean;
  disclaimer: boolean;
}

// ---------- color / TTY ----------

function shouldUseColor(): boolean {
  // NO_COLOR convention: any non-empty value disables color (no-color.org).
  // Pipe detection prevents ANSI escape codes from polluting JSON / log
  // ingestion that consumes stdout.
  if (process.env['NO_COLOR']) return false;
  return process.stdout.isTTY === true;
}

function paint(style: (s: string) => string, text: string): string {
  return shouldUseColor() ? style(text) : text;
}

const c: Record<'bold' | 'dim' | 'red' | 'yellow' | 'cyan', ChalkInstance> = {
  bold: chalk.bold,
  dim: chalk.dim,
  red: chalk.red,
  yellow: chalk.yellow,
  cyan: chalk.cyan,
};

// ---------- formatting ----------

const WARNING_FIELD_RE = /warning|contraindication|advers|interaction/i;

function isPrimitive(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function formatStringArray(values: readonly string[]): string {
  return values.length === 0 ? paint(c.dim, '(none)') : values.join(', ');
}

function formatLabel(label: string): string {
  const heading = `${label}:`;
  if (WARNING_FIELD_RE.test(label)) {
    return paint(c.yellow, paint(c.bold, heading));
  }
  return paint(c.bold, heading);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function formatSuccess(
  data: Record<string, unknown>,
  opts: OutputOptions,
): string {
  const lines: string[] = [];
  const citation = data['citation'];
  const disclaimer = data['disclaimer'];
  const limitations = data['limitations'];
  const scopeNote = data['scopeNote'];

  // Interpretation guardrails (FAERS limitations, scopeNote) print BEFORE
  // the data so the reader sees the caveat in front of the numbers, not
  // after. Bracketed by separator lines for visual prominence -- equivalent
  // to the demo's yellow callout above the events list.
  if (typeof limitations === 'string' && limitations.length > 0) {
    lines.push(paint(c.bold, 'Limitations:'));
    lines.push(limitations);
    lines.push('');
  }
  if (typeof scopeNote === 'string' && scopeNote.length > 0) {
    lines.push(paint(c.bold, 'Scope note:'));
    lines.push(scopeNote);
    lines.push('');
  }

  for (const [key, value] of Object.entries(data)) {
    if (
      key === 'citation' ||
      key === 'disclaimer' ||
      key === 'limitations' ||
      key === 'scopeNote'
    ) {
      continue;
    }
    if (isPrimitive(value)) {
      lines.push(`${formatLabel(key)} ${String(value)}`);
    } else if (isStringArray(value)) {
      lines.push(`${formatLabel(key)} ${formatStringArray(value)}`);
    } else if (Array.isArray(value)) {
      lines.push(formatLabel(key));
      for (const item of value) {
        lines.push(`  ${formatItem(item)}`);
      }
    } else if (value === null || value === undefined) {
      lines.push(`${formatLabel(key)} ${paint(c.dim, '(none)')}`);
    } else {
      lines.push(`${formatLabel(key)} ${JSON.stringify(value)}`);
    }
  }

  if (
    citation !== undefined &&
    typeof citation === 'object' &&
    citation !== null &&
    'url' in citation &&
    typeof citation.url === 'string'
  ) {
    lines.push('');
    lines.push(paint(c.dim, `Source: ${citation.url}`));
  }
  if (opts.disclaimer && typeof disclaimer === 'string') {
    lines.push(paint(c.dim, disclaimer));
  }
  return lines.join('\n');
}

function formatItem(item: unknown): string {
  if (isPrimitive(item)) return String(item);
  if (item === null) return '(null)';
  if (typeof item !== 'object') return JSON.stringify(item);
  // Single-line summary for objects: prefer name/term/drug/population, then
  // include the rest as compact JSON. Each tool's array-of-objects has a
  // natural "label" key that's far more useful than a raw JSON dump.
  const obj = item as Record<string, unknown>;
  const label =
    pickString(obj, 'name') ??
    pickString(obj, 'term') ??
    pickString(obj, 'drug') ??
    pickString(obj, 'population') ??
    pickString(obj, 'rxcui');
  const rest = { ...obj };
  if (label !== undefined) {
    delete rest['name'];
    delete rest['term'];
    delete rest['drug'];
    delete rest['population'];
    delete rest['rxcui'];
  }
  const restStr =
    Object.keys(rest).length > 0
      ? ` ${paint(c.dim, JSON.stringify(rest))}`
      : '';
  return `${label ?? JSON.stringify(item)}${restStr}`;
}

function pickString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

function formatError(
  envelope: Extract<ToolResponse<unknown>, { ok: false }>,
  opts: OutputOptions,
): string {
  const { error, disclaimer } = envelope;
  const lines: string[] = [];
  lines.push(paint(c.red, paint(c.bold, `ERROR (${error.code})`)));
  lines.push(paint(c.red, error.message));
  if (error.candidates && error.candidates.length > 0) {
    lines.push('');
    lines.push(paint(c.bold, 'Candidates:'));
    for (const candidate of error.candidates) {
      lines.push(`  ${candidate.rxcui} ${candidate.name} (${candidate.reason})`);
    }
  }
  if (error.retryable === true) {
    lines.push('');
    lines.push(paint(c.yellow, 'This error is retryable.'));
  }
  if (opts.disclaimer) {
    lines.push('');
    lines.push(paint(c.dim, disclaimer));
  }
  return lines.join('\n');
}

// ---------- output ----------

function emit(
  result: ToolResponse<unknown>,
  opts: OutputOptions,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
): number {
  if (opts.json) {
    // JSON mode: the envelope (including the disclaimer) goes to stdout
    // verbatim so that consumers can pipe directly into jq, etc. Errors
    // still exit non-zero so shell pipelines fail loudly.
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }
  if (result.ok) {
    stdout.write(
      `${formatSuccess(result.data as Record<string, unknown>, opts)}\n`,
    );
    return 0;
  }
  stderr.write(`${formatError(result, opts)}\n`);
  return 1;
}

// ---------- subcommand wiring ----------

interface CliDeps {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  exit: (code: number) => void;
}

function defaultDeps(): CliDeps {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    exit: (code) => process.exit(code),
  };
}

function readGlobalOptions(program: Command): OutputOptions {
  const opts = program.opts<{ json?: boolean; disclaimer?: boolean }>();
  return {
    json: opts.json === true,
    // commander's --no-disclaimer flips a default-true `disclaimer` boolean
    // off, so the option lives on `disclaimer`, not `noDisclaimer`.
    disclaimer: opts.disclaimer !== false,
  };
}

async function runSubcommand(
  program: Command,
  deps: CliDeps,
  call: () => Promise<ToolResponse<unknown>>,
): Promise<void> {
  const opts = readGlobalOptions(program);
  const result = await call();
  const code = emit(result, opts, deps.stdout, deps.stderr);
  deps.exit(code);
}

export function buildProgram(deps: CliDeps = defaultDeps()): Command {
  const program = new Command();
  program
    .name('clinical-reference')
    .description(
      'Drug, prescription, and pharmacology reference CLI. Returns regulator-published data only. Not for clinical use.',
    )
    .version(VERSION)
    .option('--json', 'output the raw response envelope as JSON')
    .option('--no-disclaimer', 'suppress the human-readable disclaimer footer');

  program
    .command('lookup-drug')
    .description('Resolve a free-text drug name to canonical RxNorm data.')
    .argument('<name>', 'drug name (e.g. aspirin, tylenol)')
    .action(async (name: string) => {
      await runSubcommand(program, deps, () => lookupDrugHandler({ name }));
    });

  program
    .command('get-drug-label')
    .description('Fetch FDA-approved structured product label sections.')
    .argument('<name>', 'drug name')
    .option(
      '--sections <list>',
      'comma-separated section names (indications, dosage, warnings, contraindications, adverse_reactions, mechanism)',
    )
    .action(async (name: string, cmdOpts: { sections?: string }) => {
      const sections = cmdOpts.sections
        ?.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const input =
        sections && sections.length > 0 ? { name, sections } : { name };
      await runSubcommand(program, deps, () => getDrugLabelHandler(input));
    });

  program
    .command('check-interactions')
    .description(
      'Return per-drug FDA label interaction text verbatim (not a synthesized verdict).',
    )
    .argument('<drugs...>', 'two or more drug names')
    .action(async (drugs: string[]) => {
      await runSubcommand(program, deps, () =>
        checkInteractionsHandler({ drugs }),
      );
    });

  program
    .command('find-alternatives')
    .description(
      'List RxNorm ingredient-level co-members of the most-specific shared ATC class.',
    )
    .argument('<name>', 'drug name')
    .action(async (name: string) => {
      await runSubcommand(program, deps, () =>
        findAlternativesHandler({ name }),
      );
    });

  program
    .command('lookup-adverse-events')
    .description('Top adverse event terms reported to FDA FAERS for a drug.')
    .argument('<name>', 'drug name')
    .option('--limit <n>', 'maximum number of events (default 10)', (v) =>
      Number.parseInt(v, 10),
    )
    .action(async (name: string, cmdOpts: { limit?: number }) => {
      const input =
        cmdOpts.limit !== undefined
          ? { name, limit: cmdOpts.limit }
          : { name };
      await runSubcommand(program, deps, () =>
        lookupAdverseEventsHandler(input),
      );
    });

  program
    .command('get-dosing-reference')
    .description(
      'Verbatim FDA-label dosing prose for a drug (no patient-specific reasoning).',
    )
    .argument('<name>', 'drug name')
    .action(async (name: string) => {
      await runSubcommand(program, deps, () =>
        getDosingReferenceHandler({ name }),
      );
    });

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

// Only invoke main() when this file is the script entry point - not when
// it's imported by tests. We compare realpath(argv[1]) to the module's
// own filesystem path because import.meta.url always points at the
// canonical path (Node resolves symlinks during module load), while
// argv[1] preserves whatever path the user / package manager passed
// in. On macOS those diverge whenever the path contains a symlinked
// segment (e.g. /tmp -> /private/tmp), and on Linux they diverge under
// pnpm's content-addressable node_modules. realpathSync collapses the
// difference; the try/catch handles the rare case where argv[1] points
// at something that no longer exists on disk.
function isModuleEntryPoint(): boolean {
  const entryArg = process.argv[1];
  if (entryArg === undefined) return false;
  try {
    return realpathSync(entryArg) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isModuleEntryPoint()) {
  main().catch((err: unknown) => {
    process.stderr.write(`[clinical-reference] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
