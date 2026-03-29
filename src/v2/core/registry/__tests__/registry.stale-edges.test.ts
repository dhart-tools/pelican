import { createRegistry } from '@v2/core/registry/registry';

describe('Registry — stale edge removal on addOrUpdateFile()', () => {
  it('removes old dependency edges when imports change', () => {
    const registry = createRegistry();

    // Initial state: LoginPage imports both AuthService and LoginForm
    registry.buildFromFileEntries([
      {
        path: 'src/pages/LoginPage.tsx',
        type: 'source',
        name: 'LoginPage.tsx',
        imports: ['src/services/AuthService.ts', 'src/components/LoginForm.tsx'],
        exports: [],
        classes: [],
        functions: [],
        interfaces: [],
        keywords: [],
      },
    ]);

    expect(
      registry.getDependencies('src/pages/LoginPage.tsx').has('src/components/LoginForm.tsx'),
    ).toBe(true);
    expect(
      registry.getDependents('src/components/LoginForm.tsx').has('src/pages/LoginPage.tsx'),
    ).toBe(true);

    // Developer removes LoginForm import
    registry.addOrUpdateFile({
      path: 'src/pages/LoginPage.tsx',
      type: 'source',
      name: 'LoginPage.tsx',
      imports: ['src/services/AuthService.ts'], // LoginForm is gone
      exports: [],
      classes: [],
      functions: [],
      interfaces: [],
      keywords: [],
    });

    // LoginForm dependency must be gone
    expect(
      registry.getDependencies('src/pages/LoginPage.tsx').has('src/components/LoginForm.tsx'),
    ).toBe(false);

    // LoginPage must no longer appear in LoginForm's dependents
    expect(
      registry.getDependents('src/components/LoginForm.tsx').has('src/pages/LoginPage.tsx'),
    ).toBe(false);

    // AuthService edge must still be intact
    expect(
      registry.getDependencies('src/pages/LoginPage.tsx').has('src/services/AuthService.ts'),
    ).toBe(true);
    expect(
      registry.getDependents('src/services/AuthService.ts').has('src/pages/LoginPage.tsx'),
    ).toBe(true);
  });

  it('cleans up empty dependents Sets to prevent graph pollution', () => {
    const registry = createRegistry();

    registry.buildFromFileEntries([
      {
        path: 'src/pages/LoginPage.tsx',
        type: 'source',
        name: 'LoginPage.tsx',
        imports: ['src/components/LoginForm.tsx'],
        exports: [],
        classes: [],
        functions: [],
        interfaces: [],
        keywords: [],
      },
    ]);

    // Remove the import
    registry.addOrUpdateFile({
      path: 'src/pages/LoginPage.tsx',
      type: 'source',
      name: 'LoginPage.tsx',
      imports: [],
      exports: [],
      classes: [],
      functions: [],
      interfaces: [],
      keywords: [],
    });

    // The dependents entry for LoginForm should be deleted (not left as an empty Set)
    expect(registry.importGraph.dependents.has('src/components/LoginForm.tsx')).toBe(false);
  });

  it('handles the case where the file was not previously in the registry', () => {
    const registry = createRegistry();

    // addOrUpdateFile on a brand-new file should not throw
    expect(() => {
      registry.addOrUpdateFile({
        path: 'src/pages/NewPage.tsx',
        type: 'source',
        name: 'NewPage.tsx',
        imports: ['src/components/Button.tsx'],
        exports: [],
        classes: [],
        functions: [],
        interfaces: [],
        keywords: [],
      });
    }).not.toThrow();

    expect(registry.getDependencies('src/pages/NewPage.tsx').has('src/components/Button.tsx')).toBe(
      true,
    );
  });
});
