import * as path from 'path';

/**
 * Normalize a file path to a consistent relative form from the project root.
 *
 * Rules:
 * 1. If the path is absolute, make it relative to the project root.
 * 2. Remove any leading "./"
 * 3. Normalize path separators to forward slashes (Windows safety).
 * 4. Resolve any ".." segments.
 *
 * All paths stored in the registry go through this function.
 * All lookups into the registry go through this function.
 *
 * @param filePath - The raw path from an analyzer or file system call.
 * @param projectRoot - The absolute path to the project root. Defaults to process.cwd().
 */
export function normalizePath(filePath: string, projectRoot: string = process.cwd()): string {
  let normalized: string;

  if (path.isAbsolute(filePath)) {
    // Convert absolute path to relative from project root
    normalized = path.relative(projectRoot, filePath);
  } else {
    // Resolve ".." etc. relative to project root, then make relative again
    normalized = path.relative(projectRoot, path.resolve(projectRoot, filePath));
  }

  // Normalize separators to forward slashes (handles Windows paths)
  return normalized.split(/[\\/]/).join('/');
}
