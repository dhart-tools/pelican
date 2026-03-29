import { TransitiveImportScorer } from '@v2/core/scoring/scorers/transitive-import-scorer';
import { IScorerContext } from '@v2/types';

describe('TransitiveImportScorer', () => {
  let scorer: TransitiveImportScorer;
  let mockRegistry: any;

  beforeEach(() => {
    scorer = new TransitiveImportScorer();
    mockRegistry = {
      getDependencies: jest.fn(),
    };
  });

  test('should match at depth 1', () => {
    const changedFile = 'src/components/auth/PasswordInput.tsx';
    const testFile = 'src/components/auth/LoginForm.test.ts';
    const intermediate = 'src/components/auth/LoginForm.tsx';

    mockRegistry.getDependencies.mockReturnValue(new Set([changedFile]));

    const context: IScorerContext = {
      registry: mockRegistry,
      changedFile: { path: changedFile } as any,
      testFile: { path: testFile, imports: [intermediate] } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(true);
    expect(signals[0].reason).toContain(`Test imports ${intermediate}`);
  });

  test('should not match at depth > 1', () => {
    const changedFile = 'src/hooks/useAuth.ts';
    const testFile = 'src/pages/LoginPage.test.ts';
    const intermediate1 = 'src/pages/LoginPage.tsx';
    const intermediate2 = 'src/components/auth/LoginForm.tsx';

    // Depth 1: LoginPage → LoginForm
    // Depth 2: LoginForm → useAuth
    mockRegistry.getDependencies.mockImplementation((path: string) => {
      if (path === intermediate1) return new Set([intermediate2]);
      if (path === intermediate2) return new Set([changedFile]);
      return new Set();
    });

    const context: IScorerContext = {
      registry: mockRegistry,
      changedFile: { path: changedFile } as any,
      testFile: { path: testFile, imports: [intermediate1] } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(false);
  });
});
