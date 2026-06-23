import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

import { IGitProbe, IGitRunner, IRepoGitHistory } from '@/types/git';

import { GIT_LOG_ARGS, parseGitLog } from './git-log-parser';

const execFileP = promisify(execFile);

// `git log --name-status` over full history can be large on a big repo; lift the
// default 1MB stdout cap so the mine doesn't truncate (and silently lose tail
// history). 256MB is far beyond any real single-repo log.
const MAX_BUFFER = 256 * 1024 * 1024;

/** Real git, via subprocess. Mirrors the execFile style in diff-extractor.ts. */
export const defaultGitRunner: IGitRunner = {
  async probe(repoRoot: string): Promise<IGitProbe> {
    try {
      const { stdout } = await execFileP(
        'git',
        ['rev-parse', '--is-inside-work-tree', '--is-shallow-repository'],
        { cwd: repoRoot },
      );
      const [work, shallow] = stdout.split('\n').map((s) => s.trim());
      return { isRepo: work === 'true', isShallow: shallow === 'true' };
    } catch {
      return { isRepo: false, isShallow: false };
    }
  },

  async logRaw(repoRoot: string): Promise<string> {
    const { stdout } = await execFileP('git', GIT_LOG_ARGS, {
      cwd: repoRoot,
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  },
};

const empty = (repoRoot: string): IRepoGitHistory => ({
  repoRoot,
  available: false,
  files: new Map(),
});

/**
 * Mines and caches per-repo git history. One instance can serve both the source
 * and test repos; each repoRoot is mined once and memoized.
 *
 * Degrades to an unavailable result (never throws) on a non-repo, a shallow
 * clone, or a failed log — the temporal scorer treats that as "no signal",
 * keeping it recall-safe.
 */
export class GitHistoryProvider {
  private readonly cache = new Map<string, IRepoGitHistory>();

  constructor(
    private readonly runner: IGitRunner = defaultGitRunner,
    private readonly debug?: (msg: string) => void,
  ) {}

  async getHistory(repoRoot: string): Promise<IRepoGitHistory> {
    const key = path.resolve(repoRoot);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const result = await this.mine(key);
    this.cache.set(key, result);
    return result;
  }

  private async mine(repoRoot: string): Promise<IRepoGitHistory> {
    const probe = await this.runner.probe(repoRoot).catch(() => ({
      isRepo: false,
      isShallow: false,
    }));

    if (!probe.isRepo) {
      this.debug?.(`git-history: ${repoRoot} is not a git repo → no signal`);
      return empty(repoRoot);
    }
    if (probe.isShallow) {
      this.debug?.(`git-history: ${repoRoot} is a shallow clone → no signal (history unreliable)`);
      return empty(repoRoot);
    }

    try {
      const raw = await this.runner.logRaw(repoRoot);
      const files = parseGitLog(raw);
      this.debug?.(`git-history: ${repoRoot} → ${files.size} files mined`);
      return { repoRoot, available: files.size > 0, files };
    } catch (err) {
      this.debug?.(`git-history: ${repoRoot} log failed (${err}) → no signal`);
      return empty(repoRoot);
    }
  }
}
