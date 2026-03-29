import { FilenameConventionScorer } from "@v2/core/scoring/scorers/filename-convention-scorer";

describe("FilenameConventionScorer", () => {
  let scorer: FilenameConventionScorer;

  beforeEach(() => {
    scorer = new FilenameConventionScorer();
  });

  test("should match PascalCase source to kebab-case .cy.ts test", () => {
    const changedFile = "src/pages/LoginPage.tsx";
    const testFile = "cypress/e2e/login-page.cy.ts";

    const signals = scorer.evaluate(changedFile, testFile, {} as any);

    expect(signals[0].matched).toBe(true);
    expect(signals[0].reason).toContain("Filename convention match");
  });

  test("should not match unrelated filenames", () => {
    const changedFile = "src/components/auth/PasswordInput.tsx";
    const testFile = "cypress/e2e/auth/login.cy.ts";

    const signals = scorer.evaluate(changedFile, testFile, {} as any);

    expect(signals[0].matched).toBe(false);
  });
});
