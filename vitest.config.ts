import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Bin entry points are spawned as subprocesses by integration tests;
      // their coverage lives in the child process and isn't visible to v8
      // here. Excluding them keeps the threshold honest.
      exclude: [
        // The library barrel re-exports only; nothing of substance to cover.
        'src/index.ts',
        // Bin entry points are spawned as subprocesses by integration tests;
        // their coverage lives in the child process and isn't visible to v8
        // here. Excluding them keeps the threshold honest.
        'src/server/stdio.ts',
        'src/server/http-bin.ts',
      ],
      thresholds: {
        lines: 96,
        functions: 96,
        branches: 91,
        statements: 96,
      },
    },
  },
});
