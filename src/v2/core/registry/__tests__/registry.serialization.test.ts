import { createRegistry } from '@v2/core/registry/registry';

describe('Registry — serialization round-trip', () => {
  const buildPopulatedRegistry = () => {
    const registry = createRegistry();
    registry.buildFromFileEntries([
      {
        path: 'src/pages/LoginPage.tsx',
        type: 'source',
        name: 'LoginPage.tsx',
        imports: ['src/components/LoginForm.tsx'],
        selectors: [
          { attr: 'data-testid', value: 'submit-btn' },
          { attr: 'data-testid', value: 'email-input' },
        ],
        jsxTextContent: ['Sign In', 'Forgot password?'],
        exports: [],
        classes: [],
        functions: [],
        interfaces: [],
        keywords: [],
      },
      {
        path: 'src/components/LoginForm.tsx',
        type: 'source',
        name: 'LoginForm.tsx',
        imports: [],
        exports: [],
        classes: [],
        functions: [],
        interfaces: [],
        keywords: [],
      },
    ]);
    return registry;
  };

  it('preserves selectorIndex values as Sets after round-trip', () => {
    const original = buildPopulatedRegistry();
    const json = original.serialize();

    const restored = createRegistry();
    restored.deserialize(json);

    const files = restored.getSelectorIndex().get('submit-btn');
    expect(files).toBeInstanceOf(Set); // ← This fails without the fix
    expect(files!.has('src/pages/LoginPage.tsx')).toBe(true);
  });

  it('preserves importGraph.dependencies as Sets after round-trip', () => {
    const original = buildPopulatedRegistry();
    const json = original.serialize();

    const restored = createRegistry();
    restored.deserialize(json);

    const deps = restored.getDependencies('src/pages/LoginPage.tsx');
    expect(deps).toBeInstanceOf(Set); // ← This fails without the fix
    expect(deps.has('src/components/LoginForm.tsx')).toBe(true);
  });

  it('preserves importGraph.dependents as Sets after round-trip', () => {
    const original = buildPopulatedRegistry();
    const json = original.serialize();

    const restored = createRegistry();
    restored.deserialize(json);

    const dependents = restored.getDependents('src/components/LoginForm.tsx');
    expect(dependents).toBeInstanceOf(Set); // ← This fails without the fix
    expect(dependents.has('src/pages/LoginPage.tsx')).toBe(true);
  });

  it('preserves textIndex values as Sets after round-trip', () => {
    const original = buildPopulatedRegistry();
    const json = original.serialize();

    const restored = createRegistry();
    restored.deserialize(json);

    const files = restored.getTextIndex().get('sign in');
    expect(files).toBeInstanceOf(Set); // ← This fails without the fix
    expect(files!.has('src/pages/LoginPage.tsx')).toBe(true);
  });

  it('allows .has() and .add() on deserialized Set values without throwing', () => {
    const original = buildPopulatedRegistry();
    const restored = createRegistry();
    restored.deserialize(original.serialize());

    const files = restored.getSelectorIndex().get('submit-btn')!;

    // These throw "TypeError: files.has is not a function" if values are Arrays
    expect(() => files.has('src/pages/LoginPage.tsx')).not.toThrow();
    expect(() => files.add('src/pages/SomeOtherPage.tsx')).not.toThrow();
  });

  it('produces identical file entries before and after round-trip', () => {
    const original = buildPopulatedRegistry();
    const json = original.serialize();

    const restored = createRegistry();
    restored.deserialize(json);

    const originalFile = original.getFile('src/pages/LoginPage.tsx');
    const restoredFile = restored.getFile('src/pages/LoginPage.tsx');
    expect(restoredFile).toEqual(originalFile);
  });
});
