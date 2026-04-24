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

describe('loadProjectConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns default config when file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const config = await loadProjectConfig();
    expect(config.sourceDirs).toEqual(['src']);
    expect(config.scoring.minConfidence).toBe(0.4);
    expect(config.scoring.ubiquityThreshold).toBe(0.7);
    expect(config.scoring.highConfidence).toBe(0.8);
  });

  it('returns default config when file has invalid JSON', async () => {
    mockReadFile.mockRejectedValue(new SyntaxError('Unexpected token'));
    const config = await loadProjectConfig();
    expect(config.sourceDirs).toEqual(['src']);
  });

  it('merges user config with defaults', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        sourceDirs: ['lib'],
        scoring: { minConfidence: 0.6 },
      }),
    );
    const config = await loadProjectConfig();
    expect(config.sourceDirs).toEqual(['lib']);
    expect(config.scoring.minConfidence).toBe(0.6);
    // Defaults preserved for unspecified fields
    expect(config.scoring.ubiquityThreshold).toBe(0.7);
    expect(config.analyzers.sourceExtractor.enabled).toBe(true);
  });

  it('deep merges analyzer config preserving defaults', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        analyzers: {
          reduxChain: { enabled: true, storeDirs: ['src/store'] },
        },
      }),
    );
    const config = await loadProjectConfig();
    expect(config.analyzers.reduxChain.enabled).toBe(true);
    expect(config.analyzers.reduxChain.storeDirs).toEqual(['src/store']);
    // Other analyzers untouched
    expect(config.analyzers.sourceExtractor.enabled).toBe(true);
    expect(config.analyzers.cypressExtractor.enabled).toBe(true);
  });

  it('loads from custom path when configPath provided', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sourceDirs: ['custom'] }));
    const config = await loadProjectConfig('/custom/path.json');
    expect(mockReadFile).toHaveBeenCalledWith('/custom/path.json', 'utf-8');
    expect(config.sourceDirs).toEqual(['custom']);
  });

  it('merges testPatterns from user config', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ testPatterns: ['**/*.spec.ts'] }));
    const config = await loadProjectConfig();
    expect(config.testPatterns).toEqual(['**/*.spec.ts']);
  });

  it('merges ignorePatterns from user config', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ ignorePatterns: ['node_modules', 'build'] }));
    const config = await loadProjectConfig();
    expect(config.ignorePatterns).toEqual(['node_modules', 'build']);
  });

  it('preserves default testPatterns when not provided by user', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sourceDirs: ['app'] }));
    const config = await loadProjectConfig();
    expect(config.testPatterns).toContain('**/*.cy.ts');
    expect(config.testPatterns).toContain('**/*.cy.tsx');
    expect(config.testPatterns).toContain('**/*.spec.ts');
  });

  it('merges scoring scorerWeights when provided', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        scoring: {
          scorerWeights: { 'direct-import': 1.5 },
        },
      }),
    );
    const config = await loadProjectConfig();
    expect(config.scoring.scorerWeights).toEqual({ 'direct-import': 1.5 });
    // Other scoring fields preserved
    expect(config.scoring.minConfidence).toBe(0.4);
  });
});

describe('toScoringConfig', () => {
  it('extracts ISuggestorConfig from IProjectConfig', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const projectConfig = await loadProjectConfig();
    const scoringConfig = toScoringConfig(projectConfig);

    expect(scoringConfig).toEqual({
      scoring: projectConfig.scoring,
    });
    // Should not contain sourceDirs, analyzers, etc.
    const raw = scoringConfig as unknown as Record<string, unknown>;
    expect(raw.sourceDirs).toBeUndefined();
    expect(raw.analyzers).toBeUndefined();
  });

  it('returns correct enabledScorers from project config', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const projectConfig = await loadProjectConfig();
    const scoringConfig = toScoringConfig(projectConfig);

    expect(scoringConfig.scoring.enabledScorers).toContain('direct-import');
    expect(scoringConfig.scoring.enabledScorers).toContain('transitive-import');
  });

  it('preserves scorerWeights when present', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        scoring: { scorerWeights: { 'selector-match': 0.9 } },
      }),
    );
    const projectConfig = await loadProjectConfig();
    const scoringConfig = toScoringConfig(projectConfig);
    expect(scoringConfig.scoring.scorerWeights).toEqual({ 'selector-match': 0.9 });
  });
});
