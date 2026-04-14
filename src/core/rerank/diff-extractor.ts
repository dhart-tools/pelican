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

function truncate(s: string): string {
  if (s.length <= MAX_DIFF_CHARS) return s;
  return s.slice(0, MAX_DIFF_CHARS);
}
