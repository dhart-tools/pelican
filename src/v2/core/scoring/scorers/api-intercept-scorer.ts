import { BaseScorer } from "@v2/core/scoring/scorers/base";
import { getScorerConfig } from "@v2/core/scoring/scoring-config";
import { IScorerContext, ISignal } from "@v2/types";
import { EScorerType } from "@v2/utils/enums";

export class APIInterceptScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.API_INTERCEPT));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry } = context;

    const interceptedAPIs = testEntry.cypress?.interceptedAPIs || [];

    if (!this.isAPIFile(changedFile)) {
      return [
        this.createSignal(false, "Not an API file", {
          changedFile,
          testFile,
        }),
      ];
    }

    for (const api of interceptedAPIs) {
      if (this.apiMatchesFile(api.urlPattern, changedFile)) {
        return [
          this.createSignal(true, `Test intercepts ${api.method} ${api.urlPattern}`, {
            changedFile,
            testFile,
            api,
          }),
        ];
      }
    }

    return [
      this.createSignal(false, "No API intercept match", {
        changedFile,
        testFile,
      }),
    ];
  }

  private isAPIFile(filePath: string): boolean {
    return (
      filePath.includes("/api/") || filePath.includes("/routes/") || filePath.includes("/handlers/")
    );
  }

  private apiMatchesFile(urlPattern: string, filePath: string): boolean {
    const routeSegment = urlPattern.replace(/^\/api\//, "").replace(/\*/g, "");
    return filePath.replace(/\.[jt]sx?$/, "").endsWith(routeSegment);
  }
}
