#!/usr/bin/env bash
# Pre-publish smoke for the npm tarball.
#
# Verifies the packaged artifact contains exactly what we want to ship and
# nothing we don't, that the bin shebangs and exec bits survived packing,
# and that the local CLI bin runs from a clean install of the tarball.
#
# Run via `pnpm validate:pack` from the repo root after a successful build.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Read the version from package.json so the smoke check tracks releases
# without manual edits. Uses node so we don't depend on jq being installed.
PKG_VERSION="$(node -p "require('./package.json').version")"

echo "==> pnpm pack"
rm -f shaddyt-clinical-reference-mcp-*.tgz
pnpm pack >/dev/null
TARBALL="$(ls -1 shaddyt-clinical-reference-mcp-*.tgz | head -1)"
if [[ -z "$TARBALL" ]]; then
  echo "FAIL: pnpm pack did not produce a tarball" >&2
  exit 1
fi
echo "    produced: $TARBALL ($(du -h "$TARBALL" | cut -f1))"

echo "==> tarball contents"
CONTENTS="$(tar -tzf "$TARBALL")"

# Files that MUST be present.
REQUIRED=(
  "package/package.json"
  "package/README.md"
  "package/LICENSE"
  "package/NOTICE"
  "package/dist/index.js"
  "package/dist/cli/index.js"
  "package/dist/server/stdio.js"
  "package/dist/server/http-bin.js"
)
for path in "${REQUIRED[@]}"; do
  if ! grep -qx "$path" <<<"$CONTENTS"; then
    echo "FAIL: missing required file in tarball: $path" >&2
    exit 1
  fi
done
echo "    required files present"

# Files that MUST NOT be present.
FORBIDDEN_PATTERNS=(
  '^package/src/'
  '^package/tests/'
  '^package/\.github/'
  '^package/\.vscode/'
  '^package/tsconfig\.json'
  '^package/eslint\.config'
  '^package/\.eslintrc'
  '^package/\.prettierrc'
  '^package/wrangler\.toml'
  '^package/vitest\.config'
  '^package/tsup\.config'
  '^package/node_modules/'
)
for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  if grep -qE "$pattern" <<<"$CONTENTS"; then
    echo "FAIL: forbidden path in tarball matched: $pattern" >&2
    grep -E "$pattern" <<<"$CONTENTS" | sed 's/^/      /' >&2
    exit 1
  fi
done
echo "    forbidden paths absent"

# Shebangs and exec bits.
#
# All three transport entries carry a `#!/usr/bin/env node` shebang for
# direct invocation, but only the two declared `bin` targets in
# package.json (cli/index.js, server/stdio.js) get an exec bit set by
# pnpm/npm during pack. http-bin.js is intentionally not a bin in v0.1.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$TARBALL" -C "$WORK"

SHEBANG_FILES=(
  "package/dist/cli/index.js"
  "package/dist/server/stdio.js"
  "package/dist/server/http-bin.js"
)
for path in "${SHEBANG_FILES[@]}"; do
  if [[ "$(head -1 "$WORK/$path")" != "#!/usr/bin/env node" ]]; then
    echo "FAIL: missing shebang on $path" >&2
    exit 1
  fi
done
echo "    transport shebangs present"

EXEC_BINS=(
  "package/dist/cli/index.js"
  "package/dist/server/stdio.js"
)
for bin in "${EXEC_BINS[@]}"; do
  if [[ ! -x "$WORK/$bin" ]]; then
    echo "FAIL: missing exec bit on declared bin $bin" >&2
    exit 1
  fi
done
echo "    declared bin exec bits present"

# Smoke install into a throwaway tree and call the CLI's --version.
SMOKE="$(mktemp -d)"
cp "$TARBALL" "$SMOKE/"
(
  cd "$SMOKE"
  npm init -y >/dev/null 2>&1
  npm install "./$TARBALL" --no-audit --no-fund --silent >/dev/null
  VERSION_OUTPUT="$(npx --no-install clinical-reference --version 2>&1)"
  if [[ "$VERSION_OUTPUT" != "$PKG_VERSION" ]]; then
    echo "FAIL: CLI --version returned '$VERSION_OUTPUT' (expected '$PKG_VERSION')" >&2
    exit 1
  fi
)
rm -rf "$SMOKE"
echo "    CLI --version smoke passed"

echo "==> ok"
echo
echo "Manual follow-ups before publish:"
echo "  1. Run a network-dependent CLI smoke (e.g. clinical-reference lookup-drug aspirin)"
echo "  2. npm publish --dry-run --access public"
echo "  3. Verify the dry-run file list matches expectations"
