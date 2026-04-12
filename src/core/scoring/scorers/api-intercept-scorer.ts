import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

export class APIInterceptScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.API_INTERCEPT));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry } = context;

    const interceptedAPIs = testEntry.cypress?.interceptedAPIs || [];

    if (!this.isAPIFile(changedFile)) {
      return [
        this.createSignal(false, 'Not an API file', {
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
      this.createSignal(false, 'No API intercept match', {
        changedFile,
        testFile,
      }),
    ];
  }

  private isAPIFile(filePath: string): boolean {
    return (
      filePath.includes('/api/') || filePath.includes('/routes/') || filePath.includes('/handlers/')
    );
  }

  private apiMatchesFile(urlPattern: string, filePath: string): boolean {
    const routeSegment = urlPattern
      .replace(/^\/api\//, '')
      .replace(/\*/g, '')
      .replace(/\/$/, '');
    const normalizedPath = filePath.replace(/\.[jt]sx?$/, '');

    // Exact suffix match: src/api/auth/login → /api/auth/login
    if (normalizedPath.endsWith(routeSegment)) return true;

    // Resource-level match: src/api/auth → /api/auth/login
    // Walk progressively shorter prefixes of the route segment
    const segments = routeSegment.split('/').filter(Boolean);
    for (let len = segments.length - 1; len >= 1; len--) {
      const prefix = segments.slice(0, len).join('/');
      if (normalizedPath.endsWith(prefix)) return true;
    }

    return false;
  }
}
