import { ScoringEngine } from "./scoring-engine";
import { DirectImportScorer } from "./scorers/direct-import-scorer";
import { ISuggestorConfig, IRegistry, IFileEntry } from "../../types";

describe("ScoringEngine", () => {
  let engine: ScoringEngine;
  let mockRegistry: Partial<IRegistry>;
  let mockConfig: ISuggestorConfig;

  beforeEach(() => {
    mockConfig = {
      scoring: {
        enabledScorers: ["direct-import"],
        ubiquityThreshold: 0.7,
        minConfidence: 0.4,
        highConfidence: 0.8
      }
    };

    mockRegistry = {
      getFile: jest.fn(),
      getDependents: jest.fn().mockReturnValue(new Set()),
      getFilesByType: jest.fn().mockReturnValue([])
    };

    engine = new ScoringEngine(mockConfig as any, mockRegistry as any);
    engine.register(new DirectImportScorer());
  });

  /**
   * @description Verifies that a single strong signal (direct import) results in a high score and 'high' confidence.
   * 
   * @example
   * changedFile: "src/Button.tsx"
   * testFile: "src/__tests__/Button.test.tsx" (imports Button.tsx)
   * 
   * @expected Score >= 0.95, Confidence: 'high'
   */
  test("evaluateTests(): should score a direct import match highly", () => {
    const changedFile = "src/Button.tsx";
    const testFile = "src/__tests__/Button.test.tsx";

    (mockRegistry.getFile as jest.Mock).mockImplementation((path: string) => {
      if (path === changedFile) return { path: changedFile, type: "source" } as IFileEntry;
      if (path === testFile) return { path: testFile, type: "test", imports: [changedFile] } as IFileEntry;
      return undefined;
    });

    (mockRegistry.getDependents as jest.Mock).mockReturnValue(new Set(["some-other-file"]));
    (mockRegistry.getFilesByType as jest.Mock).mockReturnValue([{ path: "file1" }, { path: "file2" }]);

    const results = engine.evaluateTests(changedFile, [testFile]);

    expect(results.length).toBe(1);
    expect(results[0].score).toBeGreaterThanOrEqual(0.95);
    expect(results[0].confidence).toBe("high");
    expect(results[0].signals[0].matched).toBe(true);
  });

  /**
   * @description Validates the ubiquity dampener. If a file is imported by > ubiquityThreshold of source files, its signal weight is significantly reduced.
   * 
   * @example
   * changedFile: "src/utils.ts" (imported by 90% of files)
   * threshold: 0.7
   * 
   * @expected Original weight 0.95 dampened to 0.285 (0.95 * 0.3), Confidence: 'low'
   */
  test("evaluateTests(): should dampen scores for ubiquitous files", () => {
    const changedFile = "src/utils.ts";
    const testFile = "src/__tests__/utils.test.ts";

    (mockRegistry.getFile as jest.Mock).mockImplementation((path: string) => {
      if (path === changedFile) return { path: changedFile, type: "source" } as IFileEntry;
      if (path === testFile) return { path: testFile, type: "test", imports: [changedFile] } as IFileEntry;
      return undefined;
    });

    // Ubiquity: 9/10 = 0.9 > 0.7
    (mockRegistry.getDependents as jest.Mock).mockReturnValue(new Set(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"]));
    (mockRegistry.getFilesByType as jest.Mock).mockReturnValue(new Array(10).fill({}));

    const results = engine.evaluateTests(changedFile, [testFile]);

    expect(results[0].score).toBeLessThan(0.4); 
    expect(results[0].confidence).toBe("low");
    expect(results[0].signals[0].reason).toContain("ubiquitous component");
  });

  /**
   * @description Tests the max-signal dominance formula with tiebreaker.
   * When multiple signals match, the highest signal dominates, and 10% of other matches (capped at 0.05) are added as a tiebreaker.
   * 
   * @example
   * Signal 1: 0.8
   * Signal 2: 0.4
   * 
   * @expected finalScore = 0.8 + min(0.4 * 0.1, 0.05) = 0.84
   */
  test("calculateScore(): should apply max-signal dominance with tiebreaker", () => {
    const signals = [
      { source: "s1", type: "t1", weight: 0.8, matched: true },
      { source: "s2", type: "t2", weight: 0.4, matched: true }
    ];
    
    // @ts-ignore - reaching into private method for test
    const score = engine.calculateScore(signals);
    expect(score).toBeCloseTo(0.84);
  });

  /**
   * @description Ensures the engine respects the enabledScorers configuration.
   * 
   * @expected Only signals from 'direct-import' should be present even if others are registered.
   */
  test("evaluateTests(): should only use enabled scorers from config", () => {
    mockConfig.scoring.enabledScorers = []; // Disable all
    
    const changedFile = "src/Button.tsx";
    const testFile = "src/__tests__/Button.test.tsx";

    (mockRegistry.getFile as jest.Mock).mockImplementation((path: string) => {
      if (path === changedFile) return { path: changedFile, type: "source" } as IFileEntry;
      if (path === testFile) return { path: testFile, type: "test", imports: [changedFile] } as IFileEntry;
      return undefined;
    });

    const results = engine.evaluateTests(changedFile, [testFile]);
    expect(results[0].signals).toHaveLength(0);
    expect(results[0].score).toBe(0);
  });
});
