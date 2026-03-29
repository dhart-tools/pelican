import { ReduxChainScorer } from '@v2/core/scoring/scorers/redux-chain-scorer';
import { IScorerContext } from '@v2/types';
import { ESelectorAttr } from '@v2/utils/enums';

describe('ReduxChainScorer', () => {
  let scorer: ReduxChainScorer;
  let mockRegistry: any;

  beforeEach(() => {
    scorer = new ReduxChainScorer();
    mockRegistry = {
      getReduxChains: jest.fn(),
      getDependencies: jest.fn(),
      getFile: jest.fn(),
      getSelectorIndex: jest.fn(),
    };
  });

  test('should match when both files are in the same Redux chain', () => {
    const changedFile = 'src/store/auth/authSlice.ts';
    const testFile = 'src/store/auth/authSelectors.test.ts';

    mockRegistry.getReduxChains.mockReturnValue(
      new Map([
        [
          'auth',
          {
            files: { slice: changedFile, selectors: 'src/store/auth/authSelectors.ts' },
            consumers: [],
          },
        ],
      ]),
    );
    mockRegistry.getDependencies.mockReturnValue(new Set(['src/store/auth/authSelectors.ts']));

    const context: IScorerContext = {
      registry: mockRegistry,
      changedFile: { path: changedFile } as any,
      testFile: { path: testFile, imports: ['src/store/auth/authSelectors.ts'] } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(true);
    expect(signals[0].reason).toContain('Both files are in Redux chain "auth"');
  });

  test('should match when tested file is a chain consumer', () => {
    const changedFile = 'src/store/auth/authSlice.ts';
    const testFile = 'src/pages/LoginPage.test.ts';
    const consumerFile = 'src/pages/LoginPage.tsx';

    mockRegistry.getReduxChains.mockReturnValue(
      new Map([
        [
          'auth',
          {
            files: { slice: changedFile },
            consumers: [consumerFile],
          },
        ],
      ]),
    );
    mockRegistry.getDependencies.mockReturnValue(new Set([consumerFile]));

    const context: IScorerContext = {
      registry: mockRegistry,
      changedFile: { path: changedFile } as any,
      testFile: { path: testFile, imports: [consumerFile] } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(true);
    expect(signals[0].reason).toContain('Tested file uses Redux chain "auth"');
  });

  test('should match via E2E selector fallback', () => {
    const changedFile = 'src/store/auth/authSlice.ts';
    const testFile = 'cypress/e2e/auth/login.cy.ts';
    const consumerFile = 'src/pages/LoginPage.tsx';
    const selectorValue = 'login-submit-btn';

    mockRegistry.getReduxChains.mockReturnValue(
      new Map([
        [
          'auth',
          {
            files: { slice: changedFile },
            consumers: [consumerFile],
          },
        ],
      ]),
    );
    mockRegistry.getDependencies.mockReturnValue(new Set([]));
    mockRegistry.getFile.mockReturnValue({
      cypress: {
        selectors: [{ type: ESelectorAttr.TEST_ID, value: selectorValue, raw: '...' }],
      },
    });
    mockRegistry.getSelectorIndex.mockReturnValue(
      new Map([[selectorValue, new Set([consumerFile])]]),
    );

    const context: IScorerContext = {
      registry: mockRegistry,
      changedFile: { path: changedFile } as any,
      testFile: { path: testFile } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(true);
    expect(signals[0].reason).toContain(`E2E test uses selector '${selectorValue}'`);
  });
});
