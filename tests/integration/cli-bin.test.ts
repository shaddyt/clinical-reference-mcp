/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { VERSION } from '../../src/lib/version';

const projectRoot = resolve(fileURLToPath(import.meta.url), '../../..');

// Regression: macOS /tmp is a symlink to /private/tmp, and pnpm's
// content-addressable node_modules also routes through symlinks. When
// argv[1] contains a symlinked segment, Node still resolves
// import.meta.url to the canonical path, which means a naive
// `pathToFileURL(argv[1]) === import.meta.url` check silently fails
// and main() never runs. This test pins the realpath-based guard so a
// reverted fix surfaces immediately.

let sandbox: string;
let linkedCliPath: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'cref-symlink-'));
  const linked = join(sandbox, 'project');
  symlinkSync(projectRoot, linked, 'dir');
  linkedCliPath = join(linked, 'src/cli/index.ts');
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('clinical-reference bin invoked through a symlinked path', () => {
  it('still runs main() and prints --version', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', linkedCliPath, '--version'],
      { encoding: 'utf-8', timeout: 10_000 },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
  });

  it('still runs main() and prints --help', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', linkedCliPath, '--help'],
      { encoding: 'utf-8', timeout: 10_000 },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Usage: clinical-reference/);
  });
});
