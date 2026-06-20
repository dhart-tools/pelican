import { execSync, type ExecSyncOptions } from 'node:child_process';

/**
 * Build provenance so a binary always reports which commit it was compiled
 * from — independent of the repo state on the machine it now runs on. This is
 * what catches "I rebuilt but nothing changed" (stale binary) confusion.
 *
 * `__BUILD_COMMIT__` / `__BUILD_DATE__` are injected at bundle time by
 * `scripts/build.mjs` via esbuild `define`. In a `tsx`/source run they are
 * undefined, so we fall back to reading the working tree's HEAD live.
 */
declare const __BUILD_COMMIT__: string | undefined;
declare const __BUILD_DATE__: string | undefined;

export interface IBuildInfo {
  commit: string;
  date: string;
  /** 'build' = baked at compile time; 'source' = live git in dev; 'unknown'. */
  source: 'build' | 'source' | 'unknown';
}

let cached: IBuildInfo | undefined;

export function getBuildInfo(): IBuildInfo {
  if (cached) return cached;

  // Built binary: the baked value is authoritative — it reflects the commit
  // this binary was compiled from, NOT whatever HEAD points at now.
  const baked = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : undefined;
  if (baked) {
    cached = {
      commit: baked,
      date: typeof __BUILD_DATE__ !== 'undefined' ? (__BUILD_DATE__ as string) : 'unknown',
      source: 'build',
    };
    return cached;
  }

  // Dev / source run (tsx): read the working tree's HEAD live.
  try {
    const opts: ExecSyncOptions = { stdio: ['ignore', 'pipe', 'ignore'] };
    const sha = execSync('git rev-parse --short HEAD', opts).toString().trim();
    const dirty = execSync('git status --porcelain', opts).toString().trim() ? '-dirty' : '';
    cached = { commit: sha + dirty, date: 'dev', source: 'source' };
  } catch {
    cached = { commit: 'unknown', date: 'unknown', source: 'unknown' };
  }
  return cached;
}

/** One-line stamp for debug headers, e.g. `build: 7e42f1e (build, 2026-06-21…)`. */
export function formatBuildLine(): string {
  const b = getBuildInfo();
  const date = b.date && b.date !== 'unknown' ? `, ${b.date}` : '';
  return `build: ${b.commit} (${b.source}${date})`;
}
