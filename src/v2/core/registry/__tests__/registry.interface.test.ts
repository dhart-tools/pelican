import { createRegistry } from '../registry';
import { IRegistry } from '@v2/types/registry';

describe('Registry — interface compliance', () => {
  it('should satisfy IRegistry interface (files is a public Map)', () => {
    const registry = createRegistry();
    // If `files` were private, accessing it here would be a TypeScript error
    // and registry would not be assignable to IRegistry.
    const typed: IRegistry = registry;
    expect(typed.files).toBeInstanceOf(Map);
  });

  it('should satisfy IRegistry interface (importGraph is a public object)', () => {
    const registry: IRegistry = createRegistry();
    expect(registry.importGraph).toBeDefined();
    expect(registry.importGraph.dependencies).toBeInstanceOf(Map);
    expect(registry.importGraph.dependents).toBeInstanceOf(Map);
  });
});
