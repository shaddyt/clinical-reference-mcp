/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

// Package version is read from package.json at build time. resolveJsonModule
// in tsconfig + JSON tree-shaking in esbuild/tsup means only the `version`
// field is bundled into the final artifact, not the full manifest. Avoiding
// a runtime fs read keeps this module zero-IO and bundler-friendly.
import pkg from '../../package.json';

export const VERSION: string = pkg.version;
