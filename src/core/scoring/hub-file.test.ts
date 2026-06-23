import { EHubRole, getHubRole, isHubFile } from '@/core/scoring/hub-file';
import { IFileEntry } from '@/types';

function entry(partial: Partial<IFileEntry>): IFileEntry {
  return {
    name: 'x.ts',
    type: 'source',
    path: 'src/x.ts',
    exports: [],
    imports: [],
    classes: [],
    functions: [],
    interfaces: [],
    keywords: [],
    ...partial,
  };
}

describe('hub-file', () => {
  it('classifies a wide re-export index as a BARREL', () => {
    const barrel = entry({
      name: 'index.ts',
      path: 'src/dm/components/index.ts',
      exports: Array.from({ length: 12 }, (_, i) => `C${i}`),
      imports: Array.from({ length: 23 }, (_, i) => `src/dm/components/C${i}/index.ts`),
    });
    expect(getHubRole(barrel)).toBe(EHubRole.BARREL);
    expect(isHubFile(barrel)).toBe(true);
  });

  it('does NOT classify a leaf component index (few exports) as a barrel', () => {
    const leaf = entry({
      name: 'index.ts',
      path: 'src/dm/components/StartProvisioningWizard/index.ts',
      exports: ['StartProvisioningWizard'],
      imports: ['./StartProvisioningWizard'],
    });
    expect(getHubRole(leaf)).toBeUndefined();
  });

  it('does NOT classify an index with many exports but little re-export as a barrel', () => {
    // Hand-written index with real logic: lots of exports, few imports.
    const logicIndex = entry({
      name: 'index.ts',
      exports: Array.from({ length: 12 }, (_, i) => `fn${i}`),
      imports: ['react'],
    });
    expect(getHubRole(logicIndex)).toBeUndefined();
  });

  it('classifies Router.tsx by filename', () => {
    expect(getHubRole(entry({ name: 'Router.tsx', path: 'src/dm/Router.tsx' }))).toBe(
      EHubRole.ROUTER,
    );
  });

  it('classifies a file owning a large route table as ROUTER', () => {
    const router = entry({
      name: 'AppRoutes.tsx',
      // Only `.length` is read by the classifier; minimal stubs cast to the type.
      routesDefined: Array.from({ length: 6 }, (_, i) => ({
        path: `/p${i}`,
      })) as unknown as IFileEntry['routesDefined'],
    });
    expect(getHubRole(router)).toBe(EHubRole.ROUTER);
  });

  it('never classifies a test file as a hub', () => {
    const testBarrel = entry({
      name: 'index.ts',
      type: 'test',
      exports: Array.from({ length: 12 }, (_, i) => `C${i}`),
      imports: Array.from({ length: 23 }, (_, i) => `m${i}`),
    });
    expect(isHubFile(testBarrel)).toBe(false);
  });

  it('respects custom thresholds', () => {
    const smallBarrel = entry({
      name: 'index.ts',
      exports: ['a', 'b', 'c'],
      imports: ['./a', './b', './c'],
    });
    expect(getHubRole(smallBarrel)).toBeUndefined();
    expect(getHubRole(smallBarrel, { barrelMinExports: 3, routerMinRoutes: 5 })).toBe(
      EHubRole.BARREL,
    );
  });

  it('does not classify an ordinary component as a hub', () => {
    const cmp = entry({
      name: 'MoveDevices.tsx',
      path: 'src/dm/components/MoveDevices/MoveDevices.tsx',
      exports: ['MoveDevices'],
      imports: ['react', './styles'],
    });
    expect(isHubFile(cmp)).toBe(false);
  });
});
