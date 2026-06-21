import { IFileGitHistory } from '@/types/git';

/**
 * Arguments for the single `git log` that feeds {@link parseGitLog}.
 *
 * Format `%x00%ct` prefixes every commit with a NUL byte followed by its
 * committer timestamp. NUL can appear neither in a path nor in a status code,
 * so splitting the output on NUL yields one clean record per commit — no
 * ambiguity between commit headers and `--name-status` lines.
 *
 * - `-M` enables rename detection (so a file's pre-rename history is recovered).
 * - `--no-merges` keeps merge commits from double-counting a change.
 * - `core.quotePath=false` stops git octal-escaping non-ASCII paths.
 */
export const GIT_LOG_ARGS = [
  '-c',
  'core.quotePath=false',
  'log',
  '--no-merges',
  '-M',
  '--name-status',
  '--pretty=format:%x00%ct',
];

/**
 * Parse the output of `git log` (see {@link GIT_LOG_ARGS}) into per-file
 * history. Pure: no IO, no clock — fully determined by its input.
 *
 * Renames are stitched in a single backward pass. git log runs newest→oldest,
 * so when an `R old new` record appears we already know `new`'s later fate;
 * we attribute the rename commit to `new` and map `old → new`, so older events
 * for `old` fold forward into the file's current name.
 */
export function parseGitLog(raw: string): Map<string, IFileGitHistory> {
  // old path → newer path. Following the chain gives a file's current name.
  const renameTo = new Map<string, string>();
  const canonical = (p: string): string => {
    let cur = p;
    const seen = new Set<string>();
    while (renameTo.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = renameTo.get(cur)!;
    }
    return cur;
  };

  const times = new Map<string, number[]>();
  const record = (p: string, ts: number) => {
    const key = canonical(p);
    const arr = times.get(key);
    if (arr) arr.push(ts);
    else times.set(key, [ts]);
  };

  for (const block of raw.split('\0')) {
    if (!block.trim()) continue; // leading empty chunk before the first NUL
    const lines = block.split('\n');
    const ts = parseInt(lines[0], 10);
    if (!Number.isFinite(ts)) continue;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const parts = line.split('\t');
      const code = parts[0]?.[0];
      if (!code) continue;

      if (code === 'R' && parts.length >= 3) {
        // R<score>\t<old>\t<new>
        record(parts[2], ts);
        if (!renameTo.has(parts[1])) renameTo.set(parts[1], parts[2]);
      } else if (code === 'C' && parts.length >= 3) {
        // C<score>\t<src>\t<dst> — copy creates a new file; src lives on
        record(parts[2], ts);
      } else if (code === 'D') {
        // deleted — not a current file, no entry to attribute it to
      } else if (parts.length >= 2) {
        // A, M, T, … \t<path>
        record(parts[1], ts);
      }
    }
  }

  const out = new Map<string, IFileGitHistory>();
  for (const [path, ts] of times) {
    ts.sort((a, b) => b - a); // newest first
    out.set(path, {
      createdAt: ts[ts.length - 1],
      updatedAt: ts[0],
      commitTimes: ts,
    });
  }
  return out;
}
