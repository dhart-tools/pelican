/* Bundles the CLI with esbuild, injecting the current git commit + build date
 * so the binary can report its own provenance (see src/utils/build-info.ts).
 * Replaces the inline esbuild CLI invocation — Node keeps the git lookup
 * cross-platform (the prior `$(git ...)` shell substitution broke on Windows).
 */
import { execSync } from 'node:child_process';

import { build } from 'esbuild';

function gitCommit() {
  try {
    const opts = { stdio: ['ignore', 'pipe', 'ignore'] };
    const sha = execSync('git rev-parse --short HEAD', opts).toString().trim();
    const dirty = execSync('git status --porcelain', opts).toString().trim() ? '-dirty' : '';
    return sha + dirty;
  } catch {
    return 'unknown';
  }
}

await build({
  entryPoints: ['src/cli/entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  tsconfig: 'tsconfig.json',
  outfile: 'dist/cli/entry.js',
  define: {
    __BUILD_COMMIT__: JSON.stringify(gitCommit()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
});

console.log(`[build] bundled dist/cli/entry.js @ ${gitCommit()}`);
