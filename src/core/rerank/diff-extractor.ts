import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import { promisify } from 'util';

const execFileP = promisify(execFile);

const MAX_DIFF_CHARS = 4000;

export interface IDiffPayload {
  file: string;
  /** Unified diff text, or file content fallback. Truncated to MAX_DIFF_CHARS. */
  text: string;
  /** True if fell back to full file content (no git diff available). */
  fallback: boolean;
}

/**
 * Extracts a compact text payload describing what changed in a file.
 *
 * Strategy:
 * 1. Try `git diff base..target -- file` with small context.
 * 2. If empty or git unavailable, read the full file as fallback.
 * 3. Truncate to MAX_DIFF_CHARS (embedding models have token limits anyway).
 */
export async function extractDiffPayload(
  file: string,
  base?: string,
  target?: string,
  cwd: string = process.cwd(),
): Promise<IDiffPayload> {
  const baseRef = base ?? 'HEAD~1';
  const targetRef = target ?? 'HEAD';

  try {
    const { stdout } = await execFileP(
      'git',
      ['diff', '--unified=1', `${baseRef}..${targetRef}`, '--', file],
      { cwd, maxBuffer: 1024 * 1024 },
    );
    if (stdout.trim().length > 0) {
      return { file, text: truncate(stdout), fallback: false };
    }
  } catch {
    // fall through to content fallback
  }

  try {
    const content = await fs.readFile(file, 'utf-8');
    return { file, text: truncate(content), fallback: true };
  } catch {
    return { file, text: file, fallback: true };
  }
}

/**
 * Detects changed files from git diff.
 *
 * When explicit base/target refs are given, uses `git diff --name-only base..target`.
 * Otherwise:
 *   1. Checks working tree (staged + unstaged vs HEAD) — you're mid-development.
 *   2. Falls back to last commit (HEAD~1..HEAD) — you just committed.
 *
 * Returns deduplicated, non-empty file paths.
 */
export async function getChangedFiles(
  base?: string,
  target?: string,
  cwd: string = process.cwd(),
): Promise<string[]> {
  // Explicit refs — use them directly
  if (base || target) {
    const baseRef = base ?? 'HEAD~1';
    const targetRef = target ?? 'HEAD';
    try {
      const { stdout } = await execFileP(
        'git',
        ['diff', '--name-only', `${baseRef}..${targetRef}`],
        { cwd, maxBuffer: 1024 * 1024 },
      );
      return dedup(stdout);
    } catch {
      return [];
    }
  }

  // Default: staged + unstaged changes vs HEAD
  try {
    const { stdout } = await execFileP('git', ['diff', '--name-only', 'HEAD'], {
      cwd,
      maxBuffer: 1024 * 1024,
    });
    const files = dedup(stdout);
    if (files.length > 0) return files;
  } catch {
    // fall through
  }

  // No working-tree changes — use last commit
  try {
    const { stdout } = await execFileP('git', ['diff', '--name-only', 'HEAD~1..HEAD'], {
      cwd,
      maxBuffer: 1024 * 1024,
    });
    return dedup(stdout);
  } catch {
    return [];
  }
}

function dedup(stdout: string): string[] {
  return [...new Set(stdout.trim().split('\n').filter(Boolean))];
}

function truncate(s: string): string {
  if (s.length <= MAX_DIFF_CHARS) return s;
  return s.slice(0, MAX_DIFF_CHARS);
}
