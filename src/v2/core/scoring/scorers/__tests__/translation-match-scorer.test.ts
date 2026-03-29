import { TranslationMatchScorer } from '@v2/core/scoring/scorers/translation-match-scorer';
import { IScorerContext } from '@v2/types';

describe('TranslationMatchScorer', () => {
  let scorer: TranslationMatchScorer;
  let mockContext: Partial<IScorerContext>;

  beforeEach(() => {
    scorer = new TranslationMatchScorer();
    const mockTranslationIndex = {
      textToKeys: new Map([
        ['Sign In', ['login.submitButton']],
        ['Welcome', ['home.welcomeMessage']],
      ]),
      dynamicKeys: new Set(['home.welcomeMessage']),
      keyToText: new Map(),
      keyToFiles: new Map(),
      keyToStaticText: new Map(),
    };

    mockContext = {
      registry: {
        getTranslationIndex: () => mockTranslationIndex,
      } as any,
      testFile: {
        cypress: {
          containsText: ['Sign In'],
        },
      } as any,
      changedFile: {
        translationKeys: ['login.submitButton'],
      } as any,
    };
  });

  /**
   * @description Verifies that a test containing text that maps to a translation key used in a source file is correctly identified.
   *
   * @example
   * testContainsText: ["Sign In"]
   * mapping: "Sign In" -> ["login.submitButton"]
   * sourceKeys: ["login.submitButton"]
   *
   * @expected Matched signal should be returned with a clear explanation.
   */
  test('evaluate(): should detect exact static mapping', () => {
    const signals = scorer.evaluate(
      'src/Login.tsx',
      'src/Login.test.ts',
      mockContext as IScorerContext,
    );
    expect(signals[0].matched).toBe(true);
    expect(signals[0].reason).toContain('maps to key "login.submitButton"');
    expect(signals[0].weight).toBe(0.85);
  });

  /**
   * @description Validates detection of dynamic (interpolated) translation keys.
   *
   * @example
   * testContainsText: ["Welcome"]
   * mapping: "Welcome" -> ["home.welcomeMessage"]
   * sourceKeys: ["home.welcomeMessage"]
   * isDynamic: true
   *
   * @expected Matched signal should indicate a partial match on a dynamic key.
   */
  test('evaluate(): should detect dynamic mapping', () => {
    mockContext.testFile!.cypress!.containsText = ['Welcome'];
    mockContext.changedFile!.translationKeys = ['home.welcomeMessage'];

    const signals = scorer.evaluate(
      'src/Home.tsx',
      'src/Home.test.ts',
      mockContext as IScorerContext,
    );
    expect(signals[0].matched).toBe(true);
    expect(signals[0].reason).toContain('partially matches dynamic key "home.welcomeMessage"');
  });

  /**
   * @description Ensures the scorer handles negative cases where no relationship exists.
   *
   * @example
   * testContainsText: ["Random Text"]
   * sourceKeys: ["other.key"]
   *
   * @expected Unmatched signal should be returned.
   */
  test('evaluate(): should handle no matches correctly', () => {
    mockContext.testFile!.cypress!.containsText = ['Random Text'];
    mockContext.changedFile!.translationKeys = ['other.key'];

    const signals = scorer.evaluate(
      'src/File.tsx',
      'src/File.test.ts',
      mockContext as IScorerContext,
    );
    expect(signals[0].matched).toBe(false);
    expect(signals[0].reason).toContain('No translation matches found');
  });

  /**
   * @description Verifies that the scorer returns early if basic requirements are not met.
   */
  test('evaluate(): should handle missing breadcrumbs', () => {
    mockContext.testFile!.cypress!.containsText = [];
    const signals = scorer.evaluate(
      'src/File.tsx',
      'src/File.test.ts',
      mockContext as IScorerContext,
    );
    expect(signals[0].matched).toBe(false);
    expect(signals[0].reason).toContain('does not contain any detected text assertions');
  });
});
