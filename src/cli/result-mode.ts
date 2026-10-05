import { IAnalyzeResult } from '@/cli/types';

/** Default to the focused MUST RUN list; --extended preserves the broader list. */
export function filterByResultMode(
  results: IAnalyzeResult['suggestedTests'],
  highConfidence: number,
  extended = false,
): IAnalyzeResult['suggestedTests'] {
  return extended ? results : results.filter((result) => result.score >= highConfidence);
}
