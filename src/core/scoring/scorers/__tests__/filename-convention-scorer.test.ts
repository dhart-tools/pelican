import { createRegistry } from '@/core/registry/registry';
import { FilenameConventionScorer } from '@/core/scoring/scorers/filename-convention-scorer';
import { ISuggestorConfig } from '@/types/config';
import { IFileEntry, IRegistry } from '@/types/registry';
import { IScorerContext } from '@/types/scorers';

describe('FilenameConventionScorer', () => {
  let scorer: FilenameConventionScorer;

  beforeEach(() => {
    scorer = new FilenameConventionScorer();
  });

  const evaluate = (changed: string, test: string) =>
    scorer.evaluate(changed, test, {} as never)[0];

  test('matches PascalCase source to kebab-case .cy.ts test', () => {
    const s = evaluate('src/pages/LoginPage.tsx', 'cypress/e2e/login-page.cy.ts');
    expect(s.matched).toBe(true);
    expect(s.reason).toMatch(/Identical basename|Filename convention match/);
  });

  test('does not match unrelated filenames even when parent dir matches', () => {
    const s = evaluate('src/components/auth/PasswordInput.tsx', 'cypress/e2e/auth/login.cy.ts');
    expect(s.matched).toBe(false);
  });

  test('strips "test" prefix on cypress test (testFileManager.cy.ts ↔ FileManager.tsx)', () => {
    const s = evaluate('src/FileManager.tsx', 'cypress/e2e/testFileManager.cy.ts');
    expect(s.matched).toBe(true);
  });

  test('resolves index.ts to parent-dir name (fileManager/index.ts ↔ fileManager/fileManager.test.ts)', () => {
    const s = evaluate('src/fileManager/index.ts', 'src/fileManager/fileManager.test.ts');
    expect(s.matched).toBe(true);
  });

  test('handles colocated .test.ts suffix (Foo.tsx ↔ Foo.test.tsx)', () => {
    const s = evaluate('src/foo/Bar.tsx', 'src/foo/Bar.test.tsx');
    expect(s.matched).toBe(true);
  });

  test('handles kebab source with camel test (user-profile.tsx ↔ UserProfile.cy.ts)', () => {
    const s = evaluate('src/user-profile.tsx', 'cypress/e2e/UserProfile.cy.ts');
    expect(s.matched).toBe(true);
  });

  test('plural/singular token overlap (products.cy.ts partially matches Product.tsx)', () => {
    const s = evaluate('src/Product.tsx', 'cypress/e2e/product.cy.ts');
    expect(s.matched).toBe(true);
  });

  describe('ambiguous-token demotion (corpus IDF)', () => {
    // Corpus where `devices`/`list` are ubiquitous (>10% of files) but
    // `provisioning` is rare (<10%) — the exact dm-web shape.
    const sourceEntry = (p: string): IFileEntry => ({
      name: p.split('/').pop()!,
      type: 'source',
      path: p,
      exports: [],
      imports: [],
      classes: [],
      functions: [],
      interfaces: [],
      keywords: [],
    });

    const buildRegistry = (): IRegistry => {
      const reg = createRegistry();
      const devicesList = [
        'DevicesList',
        'DevicesListItem',
        'DevicesListHeader',
        'DevicesListFooter',
        'DevicesListRow',
        'MoveDevicesList',
        'ZoneDevicesList',
        'DevicesListSearch',
        'DevicesListPage',
        'DevicesListView',
      ].map((n) => sourceEntry(`src/dm/${n}.tsx`));
      const distinct = [
        'Login',
        'Cart',
        'Checkout',
        'Settings',
        'Profile',
        'Dashboard',
        'Sidebar',
        'Header',
        'Footer',
      ].map((n) => sourceEntry(`src/dm/${n}.tsx`));
      reg.buildFromFileEntries([
        ...devicesList,
        sourceEntry('src/dm/Provisioning.tsx'),
        ...distinct,
      ]);
      return reg; // 20 files: devices/list in 10, provisioning in 1
    };

    const ctx = (): IScorerContext =>
      ({
        registry: buildRegistry(),
        config: {
          scoring: {
            ubiquityThreshold: 0.7,
            minConfidence: 0.4,
            highConfidence: 0.8,
            filenameAmbiguityShare: 0.1,
          },
        } as ISuggestorConfig,
      }) as IScorerContext;

    test('ambiguous-only overlap stays matched but loses anchor status', () => {
      const s = scorer.evaluate(
        'src/dm/ZoneDevicesList.tsx',
        'cypress/e2e/sortDeviceList.cy.ts',
        ctx(),
      )[0];
      expect(s.matched).toBe(true); // still a match…
      expect(s.anchorEligible).toBe(false); // …but cannot stand alone (needs a co-signal)
    });

    test('a distinctive token keeps the match anchored', () => {
      const s = scorer.evaluate(
        'src/dm/Provisioning.tsx',
        'cypress/e2e/startProvisionSession.cy.ts',
        ctx(),
      )[0];
      expect(s.matched).toBe(true);
      expect(s.anchorEligible).not.toBe(false); // distinctive → still an anchor
    });

    test('no registry in context → no demotion (recall-safe fallback)', () => {
      const s = evaluate('src/dm/ZoneDevicesList.tsx', 'cypress/e2e/sortDeviceList.cy.ts');
      expect(s.matched).toBe(true);
      expect(s.anchorEligible).not.toBe(false);
    });
  });
});
