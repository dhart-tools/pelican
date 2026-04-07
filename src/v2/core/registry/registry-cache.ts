import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { IRegistry } from '@v2/types/registry';
import { ISuggestorConfig } from '@v2/types/config';
import { glob } from 'glob';

export interface IRegistryCacheMetadata {
  builtAt: string; // ISO timestamp
  fileHash: string; // Hash of all source file paths + mtimes
  fileCount: number;
  version: string; // invalidate on tool upgrade
}

export interface ICachedRegistry {
  metadata: IRegistryCacheMetadata;
  data: string; // serialized Registry
}

const TOOL_VERSION = '1.0.0';
const MAX_CACHE_AGE_HOURS = 24;

export type TCacheInvalidationReason =
  | 'stale-files'
  | 'expired'
  | 'version-mismatch'
  | 'not-found'
  | 'corrupt';

export interface ILoadCacheResult {
  registry: IRegistry | null;
  reason?: TCacheInvalidationReason;
  metadata?: IRegistryCacheMetadata;
}

/**
 * Saves the registry to a content-addressed cache file.
 */
export async function saveRegistryCache(
  registry: IRegistry,
  cachePath: string,
  config: ISuggestorConfig,
  projectRoot: string,
): Promise<void> {
  const allFiles = await findAllProjectFiles(config, projectRoot);
  const fileHash = await computeFileHash(allFiles);

  const cached: ICachedRegistry = {
    metadata: {
      builtAt: new Date().toISOString(),
      fileHash,
      fileCount: allFiles.length,
      version: TOOL_VERSION,
    },
    data: registry.serialize(),
  };

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cached, null, 2), 'utf-8');
}

/**
 * Loads the registry from cache if it exists and is still valid.
 * Validates against file content hashes, tool version, and age.
 */
export async function loadRegistryCache(
  cachePath: string,
  config: ISuggestorConfig,
  projectRoot: string,
  registry: IRegistry,
): Promise<ILoadCacheResult> {
  let cached: ICachedRegistry;

  // 1. Try reading the file
  try {
    const raw = await fs.readFile(cachePath, 'utf-8');
    cached = JSON.parse(raw);
  } catch {
    return { registry: null, reason: 'not-found' };
  }

  // 2. Validate structure
  if (!cached.metadata || !cached.data) {
    return { registry: null, reason: 'corrupt' };
  }

  // 3. Check tool version
  if (cached.metadata.version !== TOOL_VERSION) {
    return { registry: null, reason: 'version-mismatch', metadata: cached.metadata };
  }

  // 4. Check age
  const builtAt = new Date(cached.metadata.builtAt);
  const ageHours = (Date.now() - builtAt.getTime()) / (1000 * 60 * 60);
  if (ageHours > MAX_CACHE_AGE_HOURS) {
    return { registry: null, reason: 'expired', metadata: cached.metadata };
  }

  // 5. Check file hash
  const allFiles = await findAllProjectFiles(config, projectRoot);
  const currentHash = await computeFileHash(allFiles);

  if (currentHash !== cached.metadata.fileHash) {
    return { registry: null, reason: 'stale-files', metadata: cached.metadata };
  }

  // 6. All good — deserialize
  try {
    registry.deserialize(cached.data);
    return { registry, metadata: cached.metadata };
  } catch {
    return { registry: null, reason: 'corrupt' };
  }
}

/**
 * Computes a combined hash of all file paths and their last modified times.
 * This is faster than hashing file contents but much more reliable than just timestamps.
 */
async function computeFileHash(filePaths: string[]): Promise<string> {
  const sorted = [...filePaths].sort();
  const parts: string[] = [];

  for (const filePath of sorted) {
    try {
      const stat = await fs.stat(filePath);
      parts.push(`${filePath}:${stat.mtimeMs}`);
    } catch {
      parts.push(`${filePath}:missing`);
    }
  }

  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

/**
 * Helper to get all files that contribute to the registry.
 */
async function findAllProjectFiles(config: ISuggestorConfig, projectRoot: string): Promise<string[]> {
  const sourceDirs = config.sourceDirs ?? ['src'];
  const testPatterns = config.testPatterns ?? ['**/*.cy.ts', '**/*.cy.tsx'];
  const ignorePatterns = config.ignorePatterns ?? ['node_modules', 'dist', '.git'];
  const extensions = ['.ts', '.tsx', '.js', '.jsx'];

  const patterns = [
    ...sourceDirs.map((d) => `${d}/**/*{${extensions.join(',')}}`),
    ...testPatterns,
  ];

  const ignore = ignorePatterns.map((d) => (d.includes('**') ? d : `**/${d}/**`));

  return glob(patterns, {
    cwd: projectRoot,
    ignore,
    absolute: true,
    nodir: true,
  });
}
