import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';

import { createRegistry } from '@v2/core/registry/registry';
import { loadRegistryCache, saveRegistryCache } from '../registry-cache';

jest.mock('fs/promises');
jest.mock('glob');

describe('Registry Caching', () => {
  const mockProjectRoot = '/mock/project';
  const mockCachePath = '/mock/project/.suggestor/registry.json';

  beforeEach(() => {
    jest.resetAllMocks();
    // Default mocks for standard environment
    (glob as unknown as jest.Mock).mockResolvedValue(['/mock/project/src/index.ts']);
    (fs.stat as jest.Mock).mockResolvedValue({ mtimeMs: 1000 });
  });

  /**
   * @description Verifies that the registry is correctly serialized and saved with metadata.
   *
   * @example
   * // Saving a registry to a mock path.
   *
   * @expected Expects the cache file to contain the correct tool version and file count.
   */
  test('saveRegistryCache(): should save registry with content-hash metadata', async () => {
    const registry = createRegistry();
    const config = { sourceDirs: ['src'] } as any;

    await saveRegistryCache(registry, mockCachePath, config, mockProjectRoot);

    expect(fs.mkdir).toHaveBeenCalledWith('/mock/project/.suggestor', { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      mockCachePath,
      expect.stringContaining('"version": "1.0.0"'),
      'utf-8',
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      mockCachePath,
      expect.stringContaining('"fileCount": 1'),
      'utf-8',
    );
  });

  /**
   * @description Ensures the registry is successfully loaded when hashes and tool version match.
   *
   * @example
   * // Loading from a valid cache file.
   *
   * @expected Expects the loadRegistryCache to return a valid registry and no invalidation reason.
   */
  test('loadRegistryCache(): should load cache if hash matches', async () => {
    const registry = createRegistry();
    const config = { sourceDirs: ['src'] } as any;

    const filePath = path.resolve(mockProjectRoot, 'src/index.ts');
    const expectedHash = crypto.createHash('sha256').update(`${filePath}:1000`).digest('hex');

    const mockCachedData = {
      metadata: {
        builtAt: new Date().toISOString(),
        fileHash: expectedHash,
        fileCount: 1,
        version: '1.0.0',
      },
      data: registry.serialize(),
    };

    (glob as unknown as jest.Mock).mockResolvedValue([filePath]);
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockCachedData));
    (fs.stat as jest.Mock).mockResolvedValue({ mtimeMs: 1000 });

    const result = await loadRegistryCache(mockCachePath, config, mockProjectRoot, registry);

    expect(result.registry).not.toBeNull();
  });

  /**
   * @description Validates that the cache is invalidated if the tool version has changed.
   *
   * @expected Expects a 'version-mismatch' reason.
   */
  test('loadRegistryCache(): should invalidate on version mismatch', async () => {
    const registry = createRegistry();
    const mockCachedData = {
      metadata: { version: '0.0.1', fileHash: 'mock-hash', builtAt: new Date().toISOString() },
      data: '{}',
    };

    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockCachedData));

    const result = await loadRegistryCache(mockCachePath, {} as any, mockProjectRoot, registry);

    expect(result.registry).toBeNull();
    expect(result.reason).toBe('version-mismatch');
  });

  /**
   * @description Validates that the cache is invalidated if the project files have changed (mtime update).
   *
   * @expected Expects a 'stale-files' reason.
   */
  test('loadRegistryCache(): should invalidate if file content-hash changes', async () => {
    const registry = createRegistry();
    const config = { sourceDirs: ['src'] } as any;

    const mockCachedData = {
      metadata: {
        builtAt: new Date().toISOString(),
        fileHash: 'old-hash',
        version: '1.0.0',
      },
      data: '{}',
    };

    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockCachedData));

    // Return new stat mtime to trigger hash change
    (fs.stat as jest.Mock).mockImplementation((p) => {
      if (p.includes('index.ts')) return { mtimeMs: 2000 };
      return { mtimeMs: 1000 };
    });

    const result = await loadRegistryCache(mockCachePath, config, mockProjectRoot, registry);

    expect(result.registry).toBeNull();
    expect(result.reason).toBe('stale-files');
  });

  /**
   * @description Ensures the cache is invalidated if it is older than the 24-hour expiration threshold.
   *
   * @expected Expects an 'expired' reason.
   */
  test('loadRegistryCache(): should invalidate if cache is expired', async () => {
    const registry = createRegistry();
    const oldDate = new Date();
    oldDate.setHours(oldDate.getHours() - 30); // 30h ago

    const mockCachedData = {
      metadata: { builtAt: oldDate.toISOString(), version: '1.0.0', fileHash: 'mock-hash' },
      data: '{}',
    };

    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockCachedData));

    const result = await loadRegistryCache(mockCachePath, {} as any, mockProjectRoot, registry);

    expect(result.registry).toBeNull();
    expect(result.reason).toBe('expired');
  });
});
