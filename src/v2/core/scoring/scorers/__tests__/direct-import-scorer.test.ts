import { DirectImportScorer } from "@v2/core/scoring/scorers/direct-import-scorer";
import { IScorerContext } from "@v2/types";

describe("DirectImportScorer", () => {
  let scorer: DirectImportScorer;
  let mockContext: Partial<IScorerContext>;

  beforeEach(() => {
    scorer = new DirectImportScorer();
    mockContext = {
      testFile: {
        imports: ["src/Button.tsx", "src/utils.ts"]
      } as any
    };
  });

  /**
   * @description Verifies that a direct import from the test file to the changed file is identified.
   * 
   * @example
   * changedFile: "src/Button.tsx"
   * testImports: ["src/Button.tsx", "src/utils.ts"]
   * 
   * @expected Matched signal should be returned with weight 0.95.
   */
  test("evaluate(): should detect direct import matches", () => {
    const changedFile = "src/Button.tsx";
    const testFile = "src/__tests__/Button.test.tsx";

    const signals = scorer.evaluate(changedFile, testFile, mockContext as IScorerContext);

    expect(signals[0].matched).toBe(true);
    expect(signals[0].weight).toBe(0.95);
    expect(signals[0].reason).toContain("directly imports");
  });

  /**
   * @description Validates detection of no match when the test file does not import the changed file.
   * 
   * @example
   * changedFile: "src/NotImported.tsx"
   * testImports: ["src/Button.tsx"]
   * 
   * @expected Unmatched signal should be returned with a clear reason.
   */
  test("evaluate(): should report no match when import is missing", () => {
    const changedFile = "src/NotImported.tsx";
    const testFile = "src/__tests__/Button.test.tsx";

    const signals = scorer.evaluate(changedFile, testFile, mockContext as IScorerContext);

    expect(signals[0].matched).toBe(false);
    expect(signals[0].reason).toContain("does not directly import");
  });
});
