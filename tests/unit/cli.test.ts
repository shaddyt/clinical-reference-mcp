/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommanderError } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as LookupDrugModule from '../../src/server/tools/lookup-drug';
import type * as GetDrugLabelModule from '../../src/server/tools/get-drug-label';
import type * as CheckInteractionsModule from '../../src/server/tools/check-interactions';
import type * as FindAlternativesModule from '../../src/server/tools/find-alternatives';
import type * as LookupAdverseEventsModule from '../../src/server/tools/lookup-adverse-events';
import type * as GetDosingReferenceModule from '../../src/server/tools/get-dosing-reference';

vi.mock('../../src/server/tools/lookup-drug', async () => {
  const actual = await vi.importActual<typeof LookupDrugModule>(
    '../../src/server/tools/lookup-drug',
  );
  return { ...actual, lookupDrugHandler: vi.fn() };
});
vi.mock('../../src/server/tools/get-drug-label', async () => {
  const actual = await vi.importActual<typeof GetDrugLabelModule>(
    '../../src/server/tools/get-drug-label',
  );
  return { ...actual, getDrugLabelHandler: vi.fn() };
});
vi.mock('../../src/server/tools/check-interactions', async () => {
  const actual = await vi.importActual<typeof CheckInteractionsModule>(
    '../../src/server/tools/check-interactions',
  );
  return { ...actual, checkInteractionsHandler: vi.fn() };
});
vi.mock('../../src/server/tools/find-alternatives', async () => {
  const actual = await vi.importActual<typeof FindAlternativesModule>(
    '../../src/server/tools/find-alternatives',
  );
  return { ...actual, findAlternativesHandler: vi.fn() };
});
vi.mock('../../src/server/tools/lookup-adverse-events', async () => {
  const actual = await vi.importActual<typeof LookupAdverseEventsModule>(
    '../../src/server/tools/lookup-adverse-events',
  );
  return { ...actual, lookupAdverseEventsHandler: vi.fn() };
});
vi.mock('../../src/server/tools/get-dosing-reference', async () => {
  const actual = await vi.importActual<typeof GetDosingReferenceModule>(
    '../../src/server/tools/get-dosing-reference',
  );
  return { ...actual, getDosingReferenceHandler: vi.fn() };
});

import { buildProgram } from '../../src/cli/index';
import { DISCLAIMER } from '../../src/lib/safety';
import { VERSION } from '../../src/lib/version';
import { checkInteractionsHandler } from '../../src/server/tools/check-interactions';
import { findAlternativesHandler } from '../../src/server/tools/find-alternatives';
import { getDosingReferenceHandler } from '../../src/server/tools/get-dosing-reference';
import { getDrugLabelHandler } from '../../src/server/tools/get-drug-label';
import { lookupAdverseEventsHandler } from '../../src/server/tools/lookup-adverse-events';
import { lookupDrugHandler } from '../../src/server/tools/lookup-drug';

const lookupDrugMock = vi.mocked(lookupDrugHandler);
const getDrugLabelMock = vi.mocked(getDrugLabelHandler);
const checkInteractionsMock = vi.mocked(checkInteractionsHandler);
const findAlternativesMock = vi.mocked(findAlternativesHandler);
const lookupAdverseEventsMock = vi.mocked(lookupAdverseEventsHandler);
const getDosingReferenceMock = vi.mocked(getDosingReferenceHandler);

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

interface CliRun {
  stdout: string;
  stderr: string;
  code: number;
}

interface RunOptions {
  /** Mock isTTY before the run; reset after. */
  isTTY?: boolean;
  noColorEnv?: boolean;
}

async function runCli(args: string[], runOpts: RunOptions = {}): Promise<CliRun> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let recordedCode = 0;
  const stdout: NodeJS.WritableStream = Object.assign(
    new (class {
      write(chunk: string): boolean {
        stdoutChunks.push(chunk);
        return true;
      }
    })(),
    {},
  ) as NodeJS.WritableStream;
  const stderr: NodeJS.WritableStream = Object.assign(
    new (class {
      write(chunk: string): boolean {
        stderrChunks.push(chunk);
        return true;
      }
    })(),
    {},
  ) as NodeJS.WritableStream;

  const originalIsTTY = process.stdout.isTTY;
  const originalNoColor = process.env['NO_COLOR'];
  if (runOpts.isTTY !== undefined) {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: runOpts.isTTY,
      configurable: true,
    });
  }
  if (runOpts.noColorEnv === true) {
    process.env['NO_COLOR'] = '1';
  } else if (runOpts.noColorEnv === false) {
    delete process.env['NO_COLOR'];
  }

  const program = buildProgram({
    stdout,
    stderr,
    exit: (code: number) => {
      recordedCode = code;
      throw new ExitCalled(code);
    },
  });
  program.exitOverride();
  // commander writes its own help/error text directly; redirect to our mocks
  // so the captured stdout/stderr stays comprehensive.
  program.configureOutput({
    writeOut: (s) => stdout.write(s),
    writeErr: (s) => stderr.write(s),
  });

  try {
    await program.parseAsync(['node', 'clinical-reference', ...args]);
  } catch (err) {
    if (err instanceof ExitCalled) {
      recordedCode = err.code;
    } else if (err instanceof CommanderError) {
      recordedCode = err.exitCode;
    } else {
      throw err;
    }
  } finally {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
    if (originalNoColor === undefined) {
      delete process.env['NO_COLOR'];
    } else {
      process.env['NO_COLOR'] = originalNoColor;
    }
  }

  return {
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    code: recordedCode,
  };
}

// ESC [ ... m - chalk's only ANSI escape pattern. We match the real
// 0x1b byte so legitimate "[NNm" character sequences in JSON output
// don't trigger false positives.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*m/;

beforeEach(() => {
  lookupDrugMock.mockReset();
  getDrugLabelMock.mockReset();
  checkInteractionsMock.mockReset();
  findAlternativesMock.mockReset();
  lookupAdverseEventsMock.mockReset();
  getDosingReferenceMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('clinical-reference --help / --version', () => {
  it('--version prints VERSION and exits 0', async () => {
    const run = await runCli(['--version']);
    expect(run.stdout).toContain(VERSION);
    expect(run.code).toBe(0);
  });

  it('--help prints usage and exits 0', async () => {
    const run = await runCli(['--help']);
    expect(run.stdout).toMatch(/Usage: clinical-reference/);
    expect(run.stdout).toContain('lookup-drug');
    expect(run.stdout).toContain('get-drug-label');
    expect(run.code).toBe(0);
  });

  it('an unknown subcommand exits non-zero with a hint', async () => {
    const run = await runCli(['no-such-thing']);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toMatch(/unknown command|no-such-thing/i);
  });
});

describe('subcommand dispatch', () => {
  const okResponse = {
    ok: true as const,
    data: {
      rxcui: '1191',
      genericName: 'aspirin',
      brandNames: [],
      activeIngredients: ['aspirin'],
      drugClasses: [],
      disclaimer: DISCLAIMER,
      citation: {
        source: 'rxnorm' as const,
        url: 'https://rxnav.nlm.nih.gov/REST/rxcui/1191/properties.json',
        retrievedAt: '2026-04-26T00:00:00.000Z',
      },
    },
  };

  it('lookup-drug calls lookupDrugHandler with the parsed name', async () => {
    lookupDrugMock.mockResolvedValueOnce(okResponse);
    const run = await runCli(['lookup-drug', 'aspirin']);
    expect(lookupDrugMock).toHaveBeenCalledWith({ name: 'aspirin' });
    expect(run.code).toBe(0);
    expect(getDrugLabelMock).not.toHaveBeenCalled();
  });

  it('get-drug-label parses --sections into an array', async () => {
    getDrugLabelMock.mockResolvedValueOnce({
      ok: true,
      data: {
        drugName: 'aspirin',
        sections: [],
        disclaimer: DISCLAIMER,
        citation: {
          source: 'openFda',
          url: 'https://api.fda.gov/drug/label.json',
          retrievedAt: '2026-04-26T00:00:00.000Z',
        },
      },
    });
    await runCli([
      'get-drug-label',
      'aspirin',
      '--sections',
      'warnings,contraindications',
    ]);
    expect(getDrugLabelMock).toHaveBeenCalledWith({
      name: 'aspirin',
      sections: ['warnings', 'contraindications'],
    });
  });

  it('check-interactions forwards a variadic drug list', async () => {
    checkInteractionsMock.mockResolvedValueOnce({
      ok: true,
      data: {
        drugs: [],
        scopeNote: '',
        disclaimer: DISCLAIMER,
      },
    });
    await runCli(['check-interactions', 'warfarin', 'aspirin']);
    expect(checkInteractionsMock).toHaveBeenCalledWith({
      drugs: ['warfarin', 'aspirin'],
    });
  });

  it('lookup-adverse-events parses --limit as an integer', async () => {
    lookupAdverseEventsMock.mockResolvedValueOnce({
      ok: true,
      data: {
        drugName: 'ibuprofen',
        totalReports: 0,
        events: [],
        disclaimer: DISCLAIMER,
        citation: {
          source: 'openFda',
          url: 'https://api.fda.gov/drug/event.json',
          retrievedAt: '2026-04-26T00:00:00.000Z',
        },
      },
    });
    await runCli(['lookup-adverse-events', 'ibuprofen', '--limit', '5']);
    expect(lookupAdverseEventsMock).toHaveBeenCalledWith({
      name: 'ibuprofen',
      limit: 5,
    });
  });
});

describe('output modes', () => {
  const okResponse = {
    ok: true as const,
    data: {
      rxcui: '1191',
      genericName: 'aspirin',
      brandNames: ['Bayer'],
      activeIngredients: ['aspirin'],
      drugClasses: [],
      disclaimer: DISCLAIMER,
      citation: {
        source: 'rxnorm' as const,
        url: 'https://rxnav.nlm.nih.gov/REST/rxcui/1191/properties.json',
        retrievedAt: '2026-04-26T00:00:00.000Z',
      },
    },
  };

  const errorResponse = {
    ok: false as const,
    error: {
      code: 'DATA_NOT_FOUND' as const,
      message: 'Drug not found in RxNorm: zzz',
    },
    disclaimer: DISCLAIMER,
  };

  it('--json prints the raw envelope as parseable JSON on success', async () => {
    lookupDrugMock.mockResolvedValueOnce(okResponse);
    const run = await runCli(['--json', 'lookup-drug', 'aspirin']);
    expect(run.code).toBe(0);
    const parsed = JSON.parse(run.stdout);
    expect(parsed).toEqual(okResponse);
  });

  it('--json on an error prints the envelope and exits 1', async () => {
    lookupDrugMock.mockResolvedValueOnce(errorResponse);
    const run = await runCli(['--json', 'lookup-drug', 'zzz']);
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout)).toEqual(errorResponse);
    expect(run.stderr).toBe('');
  });

  it('default mode on an error writes to stderr and exits 1', async () => {
    lookupDrugMock.mockResolvedValueOnce(errorResponse);
    const run = await runCli(['lookup-drug', 'zzz']);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/DATA_NOT_FOUND/);
    expect(run.stderr).toMatch(/zzz/);
  });

  it('default mode on success prints the disclaimer footer', async () => {
    lookupDrugMock.mockResolvedValueOnce(okResponse);
    const run = await runCli(['lookup-drug', 'aspirin']);
    expect(run.stdout).toContain(DISCLAIMER);
  });

  it('--no-disclaimer suppresses the human-readable footer', async () => {
    lookupDrugMock.mockResolvedValueOnce(okResponse);
    const run = await runCli([
      '--no-disclaimer',
      'lookup-drug',
      'aspirin',
    ]);
    expect(run.stdout).not.toContain(DISCLAIMER);
  });

  it('--no-disclaimer in --json mode keeps the disclaimer in the envelope', async () => {
    lookupDrugMock.mockResolvedValueOnce(okResponse);
    const run = await runCli([
      '--no-disclaimer',
      '--json',
      'lookup-drug',
      'aspirin',
    ]);
    const parsed = JSON.parse(run.stdout);
    // The data still carries `disclaimer` per the schemas in types.ts; the
    // flag only governs the human-readable footer, never the wire payload.
    expect(parsed.data.disclaimer).toBe(DISCLAIMER);
  });
});

describe('text-mode formatter branches', () => {
  it('renders a label section list with warning fields highlighted', async () => {
    getDrugLabelMock.mockResolvedValueOnce({
      ok: true,
      data: {
        drugName: 'aspirin',
        sections: [
          { name: 'warnings', text: 'Do not exceed dose.' },
          { name: 'indications', text: 'Pain relief.' },
        ],
        disclaimer: DISCLAIMER,
        citation: {
          source: 'openFda',
          url: 'https://api.fda.gov/drug/label.json',
          retrievedAt: '2026-04-26T00:00:00.000Z',
        },
      },
    });
    const run = await runCli(['get-drug-label', 'aspirin']);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/sections:/);
    expect(run.stdout).toContain('warnings');
    expect(run.stdout).toContain('indications');
    expect(run.stdout).toContain('https://api.fda.gov/drug/label.json');
  });

  it('renders an adverse-events list of {term, count} objects', async () => {
    lookupAdverseEventsMock.mockResolvedValueOnce({
      ok: true,
      data: {
        drugName: 'ibuprofen',
        totalReports: 100,
        events: [
          { term: 'nausea', count: 42 },
          { term: 'headache', count: 17 },
        ],
        disclaimer: DISCLAIMER,
        citation: {
          source: 'openFda',
          url: 'https://api.fda.gov/drug/event.json',
          retrievedAt: '2026-04-26T00:00:00.000Z',
        },
      },
    });
    const run = await runCli(['lookup-adverse-events', 'ibuprofen']);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('nausea');
    expect(run.stdout).toContain('headache');
    expect(run.stdout).toContain('totalReports:');
  });

  it('formats an error with candidates and a retryable hint', async () => {
    lookupDrugMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'AMBIGUOUS_QUERY',
        message: 'multiple matches',
        candidates: [
          { rxcui: '1191', name: 'aspirin', reason: 'exact match' },
          { rxcui: '101', name: 'aspirin / caffeine', reason: 'partial' },
        ],
        retryable: true,
      },
      disclaimer: DISCLAIMER,
    });
    const run = await runCli(['lookup-drug', 'aspirin']);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('AMBIGUOUS_QUERY');
    expect(run.stderr).toContain('1191');
    expect(run.stderr).toContain('aspirin / caffeine');
    expect(run.stderr).toMatch(/retryable/i);
  });

  it('renders empty arrays as "(none)" in text mode', async () => {
    findAlternativesMock.mockResolvedValueOnce({
      ok: true,
      data: {
        query: 'lisinopril',
        rxcui: '29046',
        drugClasses: [],
        alternatives: [],
        scopeNote: 'no class members',
        disclaimer: DISCLAIMER,
        citation: {
          source: 'rxnorm',
          url: 'https://rxnav.nlm.nih.gov/REST/rxcui/29046/properties.json',
          retrievedAt: '2026-04-26T00:00:00.000Z',
        },
      },
    });
    const run = await runCli(['find-alternatives', 'lisinopril']);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('drugClasses:');
    expect(run.stdout).toContain('(none)');
  });

  it('renders dosing entries (objects with optional fields and population label)', async () => {
    getDosingReferenceMock.mockResolvedValueOnce({
      ok: true,
      data: {
        drugName: 'metformin',
        entries: [{ population: 'adults', text: 'Initial: 500mg BID.' }],
        scopeNote: 'verbatim from label',
        disclaimer: DISCLAIMER,
        citation: {
          source: 'openFda',
          url: 'https://api.fda.gov/drug/label.json',
          retrievedAt: '2026-04-26T00:00:00.000Z',
        },
      },
    });
    const run = await runCli(['get-dosing-reference', 'metformin']);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('adults');
  });
});

describe('color / TTY handling', () => {
  const okResponse = {
    ok: true as const,
    data: {
      rxcui: '1191',
      genericName: 'aspirin',
      brandNames: [],
      activeIngredients: ['aspirin'],
      drugClasses: [],
      disclaimer: DISCLAIMER,
      citation: {
        source: 'rxnorm' as const,
        url: 'https://rxnav.nlm.nih.gov/REST/rxcui/1191/properties.json',
        retrievedAt: '2026-04-26T00:00:00.000Z',
      },
    },
  };

  it('does not emit ANSI escape codes when stdout is not a TTY', async () => {
    lookupDrugMock.mockResolvedValueOnce(okResponse);
    const run = await runCli(['lookup-drug', 'aspirin'], {
      isTTY: false,
      noColorEnv: false,
    });
    expect(ANSI_RE.test(run.stdout)).toBe(false);
  });

  it('respects NO_COLOR even when stdout is a TTY', async () => {
    lookupDrugMock.mockResolvedValueOnce(okResponse);
    const run = await runCli(['lookup-drug', 'aspirin'], {
      isTTY: true,
      noColorEnv: true,
    });
    expect(ANSI_RE.test(run.stdout)).toBe(false);
  });
});
