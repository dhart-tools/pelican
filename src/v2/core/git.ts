import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Custom error for Git operations.
 */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

/**
 * Finds all changed files in the repository.
 * This includes staged, unstaged, and untracked files.
 * Handles Git renames and CI/CD environment variables.
 */
export async function findChangedFiles(baseRef?: string): Promise<string[]> {
  try {
    const repoRoot = getRepoRoot();
    const effectiveBase = baseRef || getBaseRef();

    const changed = new Set<string>();

    // 1. Committed changes (between base and HEAD)
    // Using ... notation finds the merge base, correct for PRs
    const committed = getDiffFiles(repoRoot, effectiveBase, 'HEAD');
    committed.forEach((f) => changed.add(f));

    // 2. Staged but uncommitted changes
    const staged = getDiffFiles(repoRoot, 'HEAD');
    staged.forEach((f) => changed.add(f));

    // 3. Unstaged changes in tracked files
    const unstaged = getDiffFiles(repoRoot);
    unstaged.forEach((f) => changed.add(f));

    // 4. Untracked new files
    const untracked = getUntrackedFiles(repoRoot);
    untracked.forEach((f) => changed.add(f));

    return Array.from(changed).filter(isSourceFile);
  } catch (error) {
    throw new GitError((error as Error).message);
  }
}

/**
 * Resolves the repository root absolute path.
 */
export function getRepoRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    throw new GitError('Not a git repository');
  }
}

/**
 * Determines the base reference for diffing.
 * Prioritizes GITHUB_BASE_REF for PRs, then falls back to HEAD~1.
 */
function getBaseRef(): string {
  if (process.env.GITHUB_BASE_REF) {
    // In CI, base ref is usually just the branch name, but we need it relative to origin
    return `origin/${process.env.GITHUB_BASE_REF}`;
  }

  try {
    // Check if HEAD~1 exists (not a brand new repo with 1 commit)
    execSync('git rev-parse HEAD~1', { stdio: 'ignore' });
    return 'HEAD~1';
  } catch {
    // Fallback to empty tree SHA for single-commit repos
    return '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  }
}

/**
 * Executes git diff --name-status to identify added, modified, and renamed files.
 * Status codes:
 * M: Modified
 * A: Added
 * D: Deleted
 * R: Renamed
 */
function getDiffFiles(repoRoot: string, from?: string, to?: string): string[] {
  const range = from ? (to ? `${from}...${to}` : `--cached ${from}`) : '';
  const command = `git diff --name-status ${range}`;

  try {
    const output = execSync(command, { encoding: 'utf-8', cwd: repoRoot }).trim();
    if (!output) return [];

    return output
      .split('\n')
      .map((line) => {
        if (!line.trim()) return null;

        const parts = line.split('\t');
        const status = parts[0];
        const altPath = parts[1];
        const newPath = parts[2];

        // Rename status starts with R (e.g. R100)
        if (status.startsWith('R')) {
          return path.resolve(repoRoot, newPath || altPath);
        }
        // Deleted files (D) should be ignored
        if (status === 'D') return null;

        return path.resolve(repoRoot, altPath);
      })
      .filter((f): f is string => !!f);
  } catch {
    return [];
  }
}

/**
 * Finds untracked files that are not ignored.
 */
function getUntrackedFiles(repoRoot: string): string[] {
  try {
    const output = execSync('git ls-files --others --exclude-standard', {
      encoding: 'utf-8',
      cwd: repoRoot,
    }).trim();
    if (!output) return [];
    return output.split('\n').map((f) => path.resolve(repoRoot, f));
  } catch {
    return [];
  }
}

/**
 * Basic filter for source files. Detailed filtering is handled by the RegistryBuilder.
 */
function isSourceFile(filePath: string): boolean {
  return (
    /\.(ts|tsx|js|jsx|json|css|scss|html)$/.test(filePath) &&
    !filePath.includes('node_modules') &&
    !filePath.includes('.git/')
  );
}
