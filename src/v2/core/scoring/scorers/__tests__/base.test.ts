import { BaseScorer } from "@v2/core/scoring/scorers/base";

class TestScorer extends BaseScorer {
  constructor() {
    super({
      name: "test-scorer",
      version: "1.0.0",
      description: "Test description",
      type: "test-type",
      weight: 0.5
    });
  }

  evaluate() { return []; }

  public testCreateSignal(matched: boolean, reason?: string) {
    return this.createSignal(matched, reason);
  }
}

describe("BaseScorer", () => {
  let scorer: TestScorer;

  beforeEach(() => {
    scorer = new TestScorer();
  });

  /**
   * @description Verifies that the base scorer correctly populates signal metadata from its own configuration.
   * 
   * @expected Signals should have name, type, and weight from the scorer.
   */
  test("createSignal(): should populate basic signal fields", () => {
    const signal = scorer.testCreateSignal(true, "match found");

    expect(signal.source).toBe("test-scorer");
    expect(signal.type).toBe("test-type");
    expect(signal.weight).toBe(0.5);
    expect(signal.matched).toBe(true);
    expect(signal.reason).toBe("match found");
  });

  /**
   * @description Validates config weight override injection.
   * 
   * @expected If __effectiveWeight is set (by the ScoringEngine), createSignal should use it instead of the default weight.
   */
  test("createSignal(): should respect effective weight override", () => {
    (scorer as any).__effectiveWeight = 0.9;
    const signal = scorer.testCreateSignal(true);
    expect(signal.weight).toBe(0.9);
  });
});
