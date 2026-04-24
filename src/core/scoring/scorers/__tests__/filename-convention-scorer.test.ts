import { FilenameConventionScorer } from '@/core/scoring/scorers/filename-convention-scorer';

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
});
