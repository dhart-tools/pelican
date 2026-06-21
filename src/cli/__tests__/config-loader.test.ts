import * as path from 'path';

import { jest } from '@jest/globals';

import type {
  loadProjectConfig as LoadProjectConfigFn,
  toScoringConfig as ToScoringConfigFn,
} from '../config-loader';

// ESM-compatible mock for fs/promises
const mockReadFile = jest.fn<() => Promise<string>>();

jest.unstable_mockModule('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  access: jest.fn(),
}));

// Resolved after mock registration via beforeAll — avoids top-level await
let loadProjectConfig: typeof LoadProjectConfigFn;
let toScoringConfig: typeof ToScoringConfigFn;

beforeAll(async () => {
  const mod = await import('../config-loader');
  loadProjectConfig = mod.loadProjectConfig;
  toScoringConfig = mod.toScoringConfig;
});

/** Mock a .pelicanrc.json with the given user config (source.root supplied). */
function mockConfig(user: Record<string, unknown> = {}): void {
  const source = { root: '/repo', ...(user.source as object) };
  mockReadFile.mockResolvedValue(JSON.stringify({ ...user, source }));
}

describe('loadProjectConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('errors when source.root is missing (no config file)', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    await expect(loadProjectConfig()).rejects.toThrow(/source\.root is required/);
  });

  it('errors when source.root is missing (config without it)', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ behaviour: { minConfidence: 0.5 } }));
    await expect(loadProjectConfig()).rejects.toThrow(/source\.root is required/);
  });

  it('errors on invalid JSON', async () => {
    mockReadFile.mockResolvedValue('{ not json');
    await expect(loadProjectConfig()).rejects.toThrow(/not valid JSON/);
  });

  it('resolves source.root to absolute and defaults test.root to it', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ source: { root: 'relrepo' } }));
    const config = await loadProjectConfig();
    expect(path.isAbsolute(config.source.root)).toBe(true);
    expect(config.source.root.endsWith('relrepo')).toBe(true);
    expect(config.test.root).toBe(config.source.root); // defaulted
  });

  it('honors a separate test.root (two-repo) and resolves it absolute', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ source: { root: '/repo/src-app' }, test: { root: '/repo/e2e' } }),
    );
    const config = await loadProjectConfig();
    expect(config.source.root).toBe(path.resolve('/repo/src-app'));
    expect(config.test.root).toBe(path.resolve('/repo/e2e'));
  });

  it('merges user config with defaults (per block)', async () => {
    mockConfig({ source: { dirs: ['lib'] }, behaviour: { minConfidence: 0.6 } });
    const config = await loadProjectConfig();
    expect(config.source.dirs).toEqual(['lib']);
    expect(config.behaviour.minConfidence).toBe(0.6);
    expect(config.behaviour.ubiquityThreshold).toBe(0.7); // default preserved
    expect(config.source.imports).toBe(true);
  });

  it('deep merges nested source analyzers preserving defaults', async () => {
    mockConfig({ source: { redux: { enabled: true, storeDirs: ['src/store'] } } });
    const config = await loadProjectConfig();
    expect(config.source.redux.enabled).toBe(true);
    expect(config.source.redux.storeDirs).toEqual(['src/store']);
    expect(config.source.routes.enabled).toBe(true); // untouched
    expect(config.source.i18n.enabled).toBe(true);
  });

  it('merges test.patterns from user config', async () => {
    mockConfig({ test: { patterns: ['**/*.spec.ts'] } });
    const config = await loadProjectConfig();
    expect(config.test.patterns).toEqual(['**/*.spec.ts']);
  });

  it('preserves default test.patterns when not provided by user', async () => {
    mockConfig({ source: { dirs: ['app'] } });
    const config = await loadProjectConfig();
    expect(config.test.patterns).toContain('**/*.cy.ts');
    expect(config.test.patterns).toContain('**/*.spec.ts');
  });

  it('merges behaviour thresholds when provided', async () => {
    mockConfig({ behaviour: { ubiquitousSelectorThreshold: 0.05 } });
    const config = await loadProjectConfig();
    expect(config.behaviour.ubiquitousSelectorThreshold).toBe(0.05);
    expect(config.behaviour.minConfidence).toBe(0.4); // default preserved
  });
});

describe('toScoringConfig', () => {
  it('extracts the scoring (behaviour) subset from IProjectConfig', async () => {
    mockConfig();
    const projectConfig = await loadProjectConfig();
    const scoringConfig = toScoringConfig(projectConfig);

    expect(scoringConfig.scoring.minConfidence).toBe(projectConfig.behaviour.minConfidence);
    expect(scoringConfig.scoring.ubiquityThreshold).toBe(projectConfig.behaviour.ubiquityThreshold);
    const raw = scoringConfig as unknown as Record<string, unknown>;
    expect(raw.source).toBeUndefined();
    expect(raw.test).toBeUndefined();
  });

  it('carries through behaviour thresholds', async () => {
    mockConfig({ behaviour: { routeTrafficDampingExponent: 2 } });
    const projectConfig = await loadProjectConfig();
    const scoringConfig = toScoringConfig(projectConfig);
    expect(scoringConfig.scoring.routeTrafficDampingExponent).toBe(2);
  });
});
