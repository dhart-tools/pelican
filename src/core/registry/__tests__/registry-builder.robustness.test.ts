import * as fs from 'fs/promises';

import { glob } from 'glob';

import { RegistryBuilder } from '@/core/registry/registry-builder';

// Mocking the dependencies
jest.mock('fs/promises');
jest.mock('glob', () => ({
  glob: jest.fn(),
}));

// Mock the analyzers
jest.mock('@/core/analyzers/source-extractor/source-extractor', () => ({
  SourceExtractorAnalyzer: jest.fn(() => ({
    extract: jest.fn().mockResolvedValue({
      filePath: 'src/file.ts',
      exports: ['foo'],
      imports: ['bar'],
      classes: [],
      functions: [],
      interfaces: [],
      keywords: [],
      selectors: [],
      jsxTextContent: [],
      translationKeys: [],
      routesDefined: [],
      reduxUsage: { selectorsUsed: [], actionsDispatched: [], slicesDefined: [] },
    }),
  })),
}));
jest.mock('@/core/analyzers/cypress-extractor/cypress-extractor', () => ({
  CypressExtractorAnalyzer: jest.fn(() => ({
    extract: jest.fn().mockResolvedValue({
      filePath: 'test/file.cy.ts',
      describeBlocks: ['test'],
      itBlocks: ['test'],
      visitedRoutes: [],
      selectors: [],
      containsText: [],
      interceptedAPIs: [],
      urlAssertions: [],
      customCommandsUsed: [],
    }),
  })),
}));

describe('RegistryBuilder Robustness', () => {
  let builder: RegistryBuilder;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    builder = new RegistryBuilder();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('should handle file system errors gracefully during build', async () => {
    (glob as unknown as jest.Mock).mockResolvedValue(['src/file.ts']);
    (fs.readFile as jest.Mock).mockRejectedValue(new Error('Permission Denied'));

    const registry = await builder.buildFromDirectories({
      sourceDirs: ['src'],
      testPatterns: ['test/**/*.cy.ts'],
      sourceRoot: process.cwd(),
      testRoot: process.cwd(),
    });

    // Registry should still build, but file should be missing
    expect(registry.getFile('src/file.ts')).toBeUndefined();
  });

  it('should handle empty directory scanning', async () => {
    (glob as unknown as jest.Mock).mockResolvedValue([]);

    const registry = await builder.buildFromDirectories({
      sourceDirs: ['src'],
      testPatterns: ['test/**/*.cy.ts'],
      sourceRoot: process.cwd(),
      testRoot: process.cwd(),
    });

    expect(registry.files.size).toBe(0);
  });

  it('should handle malformed file paths from glob', async () => {
    // Glob returns weird path with leading/trailing slash
    (glob as unknown as jest.Mock).mockResolvedValue(['src/file.ts/']);
    (fs.readFile as jest.Mock).mockResolvedValue('// content');

    const registry = await builder.buildFromDirectories({
      sourceDirs: ['src'],
      testPatterns: [],
      sourceRoot: process.cwd(),
      testRoot: process.cwd(),
    });

    // Should be normalized to src/file.ts
    // The issue might be that normalization makes it 'src/file.ts'
    // but the test expects to find it via getFile('src/file.ts')
    expect(registry.getFile('src/file.ts')).toBeDefined();
  });

  it('should filter ignored directories correctly', async () => {
    const globMock = glob as unknown as jest.Mock;
    globMock.mockResolvedValue(['src/file.ts']);

    await builder.buildFromDirectories({
      sourceDirs: ['src'],
      testPatterns: [],
      ignoreDirs: ['ignored'],
      sourceRoot: process.cwd(),
      testRoot: process.cwd(),
    });

    expect(globMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ignore: expect.arrayContaining(['**/ignored/**']),
      }),
    );
  });
});
