import { normalizePath } from '@v2/core/registry/path-utils';
import * as path from 'path';
import { createRegistry } from '@v2/core/registry/registry';

const PROJECT_ROOT = '/project';

describe('normalizePath', () => {
  it('strips leading ./ from relative paths', () => {
    expect(normalizePath('./src/pages/Login.tsx', PROJECT_ROOT))
      .toBe('src/pages/Login.tsx');
  });

  it('converts absolute paths to relative from project root', () => {
    expect(normalizePath('/project/src/pages/Login.tsx', PROJECT_ROOT))
      .toBe('src/pages/Login.tsx');
  });

  it('leaves already-clean relative paths unchanged', () => {
    expect(normalizePath('src/pages/Login.tsx', PROJECT_ROOT))
      .toBe('src/pages/Login.tsx');
  });

  it('resolves .. segments', () => {
    expect(normalizePath('src/pages/../components/Button.tsx', PROJECT_ROOT))
      .toBe('src/components/Button.tsx');
  });

  it('normalizes all three representations of the same file to the same string', () => {
    const representations = [
      'src/pages/Login.tsx',
      './src/pages/Login.tsx',
      '/project/src/pages/Login.tsx'
    ];
    const normalized = representations.map((p) => normalizePath(p, PROJECT_ROOT));
    expect(new Set(normalized).size).toBe(1); // all the same
    expect(normalized[0]).toBe('src/pages/Login.tsx');
  });

  it('handles Windows-style backslash separators', () => {
    // Simulate a path that came through on Windows
    const windowsPath = 'src\\pages\\Login.tsx';
    expect(normalizePath(windowsPath, PROJECT_ROOT)).toBe('src/pages/Login.tsx');
  });
});

describe('Registry — path normalization on file storage and lookup', () => {
  it('stores files under normalized paths and retrieves them regardless of input format', () => {
    const registry = createRegistry();
    registry.buildFromFileEntries([
      {
        path: 'src/pages/LoginPage.tsx',
        type: 'source',
        name: 'LoginPage.tsx',
        imports: [],
        exports: [], classes: [], functions: [], interfaces: [], keywords: []
      }
    ]);

    // All three representations should find the same entry
    expect(registry.getFile('src/pages/LoginPage.tsx')).toBeDefined();
    expect(registry.getFile('./src/pages/LoginPage.tsx')).toBeDefined();
    expect(registry.getFile(path.resolve('src/pages/LoginPage.tsx'))).toBeDefined();
  });
});
