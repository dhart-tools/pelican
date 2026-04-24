import * as fs from 'fs/promises';
import * as path from 'path';

export const PELICAN_LOCK_PATH = '.pelican/pelican.lock';
const LOCK_VERSION = 1;

export interface ILockEntry {
  testFile: string;
  reason: string;
  confirmedAt: string;
}

interface ILockFile {
  version: number;
  /** source file path → confirmed test files */
  confirmed: Record<string, ILockEntry[]>;
  /** source file path → test file paths known to be irrelevant */
  rejected: Record<string, string[]>;
}

/**
 * Persistent source→test mapping cache stored in `.pelican/pelican.lock`.
 *
 * The lock accumulates LLM-confirmed and LLM-rejected pairs over the project
 * lifetime. On each analyze run:
 *   - Confirmed pairs are surfaced immediately (no LLM call, with cached reason).
 *   - Rejected pairs are skipped (no LLM call).
 *   - Unknown pairs are sent to the LLM and their outcome written back.
 *
 * The lock should be committed to the repo — teammates benefit from cached
 * mappings without running the LLM themselves.
 */
export class PelicanLock {
  private data: ILockFile = { version: LOCK_VERSION, confirmed: {}, rejected: {} };
  private dirty = false;
  private loaded = false;
  private lockPath: string;

  constructor(lockPath = PELICAN_LOCK_PATH) {
    this.lockPath = lockPath;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.lockPath, 'utf-8');
      const parsed = JSON.parse(raw) as ILockFile;
      if (parsed.version === LOCK_VERSION) {
        this.data = parsed;
      }
    } catch {
      // missing or malformed — start fresh
    }
  }

  getConfirmed(sourceFile: string): ILockEntry[] {
    return this.data.confirmed[sourceFile] ?? [];
  }

  isConfirmed(sourceFile: string, testFile: string): boolean {
    return this.getConfirmed(sourceFile).some((e) => e.testFile === testFile);
  }

  isRejected(sourceFile: string, testFile: string): boolean {
    return (this.data.rejected[sourceFile] ?? []).includes(testFile);
  }

  getReason(sourceFile: string, testFile: string): string | undefined {
    return this.getConfirmed(sourceFile).find((e) => e.testFile === testFile)?.reason;
  }

  confirm(sourceFile: string, testFile: string, reason: string): void {
    if (!this.data.confirmed[sourceFile]) this.data.confirmed[sourceFile] = [];
    const existing = this.data.confirmed[sourceFile].find((e) => e.testFile === testFile);
    const today = new Date().toISOString().slice(0, 10);
    if (existing) {
      existing.reason = reason;
      existing.confirmedAt = today;
    } else {
      this.data.confirmed[sourceFile].push({ testFile, reason, confirmedAt: today });
    }
    // Remove from rejected if it was there
    if (this.data.rejected[sourceFile]) {
      this.data.rejected[sourceFile] = this.data.rejected[sourceFile].filter(
        (t) => t !== testFile,
      );
    }
    this.dirty = true;
  }

  reject(sourceFile: string, testFile: string): void {
    if (!this.data.rejected[sourceFile]) this.data.rejected[sourceFile] = [];
    if (!this.data.rejected[sourceFile].includes(testFile)) {
      this.data.rejected[sourceFile].push(testFile);
    }
    // Remove from confirmed if it was there
    if (this.data.confirmed[sourceFile]) {
      this.data.confirmed[sourceFile] = this.data.confirmed[sourceFile].filter(
        (e) => e.testFile !== testFile,
      );
    }
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    try {
      await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
      await fs.writeFile(this.lockPath, JSON.stringify(this.data, null, 2), 'utf-8');
      this.dirty = false;
    } catch {
      // non-fatal
    }
  }
}
