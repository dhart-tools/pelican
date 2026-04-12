import { APIInterceptScorer } from '@/core/scoring/scorers/api-intercept-scorer';
import { IScorerContext } from '@/types';

describe('APIInterceptScorer', () => {
  let scorer: APIInterceptScorer;

  beforeEach(() => {
    scorer = new APIInterceptScorer();
  });

  test('should return matched=false immediately for non-API files', () => {
    const changedFile = 'src/components/auth/LoginForm.tsx';
    const testFile = 'cypress/e2e/auth/login.cy.ts';

    const context: IScorerContext = {
      changedFile: { path: changedFile } as any,
      testFile: {
        path: testFile,
        cypress: { interceptedAPIs: [{ method: 'POST', urlPattern: '/api/auth/login' }] },
      } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(false);
    expect(signals[0].reason).toBe('Not an API file');
  });

  test('should match when intercepted URL pattern corresponds to the changed API file', () => {
    const changedFile = 'src/api/auth/login.ts';
    const testFile = 'cypress/e2e/auth/login.cy.ts';

    const context: IScorerContext = {
      changedFile: { path: changedFile } as any,
      testFile: {
        path: testFile,
        cypress: { interceptedAPIs: [{ method: 'POST', urlPattern: '/api/auth/login' }] },
      } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(true);
    expect(signals[0].reason).toContain('Test intercepts POST /api/auth/login');
  });

  test('should match resource-level file against specific endpoint intercept', () => {
    // src/api/auth.ts handles all /api/auth/* endpoints (flat file-per-resource structure)
    const changedFile = 'src/api/auth.ts';
    const testFile = 'cypress/e2e/auth/login.cy.ts';

    const context: IScorerContext = {
      changedFile: { path: changedFile } as any,
      testFile: {
        path: testFile,
        cypress: {
          interceptedAPIs: [
            { method: 'POST', urlPattern: '/api/auth/login' },
            { method: 'POST', urlPattern: '/api/auth/logout' },
          ],
        },
      } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(true);
  });

  test('should not match a different resource', () => {
    const changedFile = 'src/api/products.ts';
    const testFile = 'cypress/e2e/auth/login.cy.ts';

    const context: IScorerContext = {
      changedFile: { path: changedFile } as any,
      testFile: {
        path: testFile,
        cypress: {
          interceptedAPIs: [{ method: 'POST', urlPattern: '/api/auth/login' }],
        },
      } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(false);
  });
});
