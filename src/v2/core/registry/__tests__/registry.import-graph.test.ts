import { createRegistry } from '@v2/core/registry/registry';

describe('Registry — import graph', () => {
  const entries = [
    {
      path: 'src/pages/LoginPage.tsx',
      type: 'source' as const,
      name: 'LoginPage.tsx',
      imports: ['src/components/LoginForm.tsx', 'src/services/AuthService.ts'],
      exports: [],
      classes: [],
      functions: [],
      interfaces: [],
      keywords: [],
    },
    {
      path: 'src/components/LoginForm.tsx',
      type: 'source' as const,
      name: 'LoginForm.tsx',
      imports: ['src/services/AuthService.ts'],
      exports: [],
      classes: [],
      functions: [],
      interfaces: [],
      keywords: [],
    },
    {
      path: 'src/services/AuthService.ts',
      type: 'source' as const,
      name: 'AuthService.ts',
      imports: [],
      exports: [],
      classes: [],
      functions: [],
      interfaces: [],
      keywords: [],
    },
  ];

  it('builds forward dependency edges', () => {
    const registry = createRegistry();
    registry.buildFromFileEntries(entries);

    const deps = registry.getDependencies('src/pages/LoginPage.tsx');
    expect(deps.has('src/components/LoginForm.tsx')).toBe(true);
    expect(deps.has('src/services/AuthService.ts')).toBe(true);
  });

  it('builds reverse dependent edges', () => {
    const registry = createRegistry();
    registry.buildFromFileEntries(entries);

    const dependents = registry.getDependents('src/services/AuthService.ts');
    expect(dependents.has('src/pages/LoginPage.tsx')).toBe(true);
    expect(dependents.has('src/components/LoginForm.tsx')).toBe(true);
  });

  it('returns empty Set for a file with no dependents', () => {
    const registry = createRegistry();
    registry.buildFromFileEntries(entries);

    const dependents = registry.getDependents('src/pages/LoginPage.tsx');
    expect(dependents.size).toBe(0);
  });
});
