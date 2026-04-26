import { defineConfig } from 'tsup';

export default defineConfig({
  // Each entry is a separately consumable artifact:
  //   index    - the public library surface (types, citations, respond, safety)
  //   server/stdio    - bin: stdio MCP transport
  //   server/http-bin - bin: streamable HTTP MCP server (also used by the
  //                     hosted demo deployment; not wired as a `bin` in v0.1)
  //   cli/index       - bin: developer CLI
  // splitting:false keeps each entry self-contained so bin scripts don't
  // need to load shared chunks at startup.
  entry: [
    'src/index.ts',
    'src/server/stdio.ts',
    'src/server/http-bin.ts',
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
