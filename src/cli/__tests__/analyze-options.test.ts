import { filterByResultMode } from '@/cli/result-mode';
import { IScoreResult } from '@/types/scorers';
import { EConfidenceLevel } from '@/utils/enums';

function result(testFile: string, score: number): IScoreResult {
  return {
    testFile,
    score,
    confidence: score >= 0.8 ? EConfidenceLevel.HIGH : EConfidenceLevel.MEDIUM,
    signals: [],
    explanation: '',
  };
}

describe('analyze result mode', () => {
  const mustRun = result('must-run.cy.ts', 0.81);
  const shouldCheck = result('should-check.cy.ts', 0.79);

  it('returns only MUST RUN results by default', () => {
    expect(filterByResultMode([mustRun, shouldCheck], 0.8)).toEqual([mustRun]);
  });

  it('preserves the broader list in extended mode', () => {
    expect(filterByResultMode([mustRun, shouldCheck], 0.8, true)).toEqual([mustRun, shouldCheck]);
  });
});
