import { defineConfig } from 'tsup';

export default defineConfig({
  // Each entry is a separately consumable artifact:
  //   index    - the public library surface (types, citations, respond, safety)
  //   server/stdio    - bin: stdio MCP transport
  //   server/http-bin - bin: streamable HTTP MCP server (Node listener)
  //   server/worker   - Cloudflare Workers entry (bundled by tsup so build
  //                     errors surface in CI; wrangler reads source directly)
  //   cli/index       - bin: developer CLI
  // splitting:false keeps each entry self-contained so bin scripts don't
  // need to load shared chunks at startup.
  entry: [
    'src/index.ts',
    'src/server/stdio.ts',
    'src/server/http-bin.ts',
    'src/server/worker.ts',
    'src/cli/index.ts',
  ],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  splitting: false,
  treeshake: true,
});
