import { createRegistry } from '@v2/core/registry/registry';

describe('Registry — file entry management', () => {
  it('returns undefined for a file not in the registry', () => {
    const registry = createRegistry();
    expect(registry.getFile('src/pages/DoesNotExist.tsx')).toBeUndefined();
  });

  it('getFilesByType returns only source files when type is "source"', () => {
    const registry = createRegistry();
    registry.buildFromFileEntries([
      {
        path: 'src/pages/Login.tsx',
        type: 'source',
        name: 'Login.tsx',
        imports: [],
        exports: [],
        classes: [],
        functions: [],
        interfaces: [],
        keywords: [],
      },
      {
        path: 'cypress/e2e/login.cy.ts',
        type: 'test',
        name: 'login.cy.ts',
        imports: [],
        exports: [],
        classes: [],
        functions: [],
        interfaces: [],
        keywords: [],
      },
    ]);
    const sources = registry.getFilesByType('source');
    expect(sources).toHaveLength(1);
    expect(sources[0].path).toBe('src/pages/Login.tsx');
  });

  it('getFilesByType returns only test files when type is "test"', () => {
    const registry = createRegistry();
    registry.buildFromFileEntries([
      {
        path: 'src/pages/Login.tsx',
        type: 'source',
        name: 'Login.tsx',
        imports: [],
        exports: [],
        classes: [],
        functions: [],
        interfaces: [],
        keywords: [],
      },
      {
        path: 'cypress/e2e/login.cy.ts',
        type: 'test',
        name: 'login.cy.ts',
        imports: [],
        exports: [],
        classes: [],
        functions: [],
        interfaces: [],
        keywords: [],
      },
    ]);
    const tests = registry.getFilesByType('test');
    expect(tests).toHaveLength(1);
    expect(tests[0].path).toBe('cypress/e2e/login.cy.ts');
  });
});
