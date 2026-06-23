import { RouteMatchScorer } from '@/core/scoring/scorers/route-match-scorer';
import { IScorerContext, IRegistry } from '@/types';

describe('RouteMatchScorer', () => {
  let scorer: RouteMatchScorer;
  let mockRegistry: Partial<IRegistry>;
  let mockContext: Partial<IScorerContext>;

  beforeEach(() => {
    scorer = new RouteMatchScorer();
    mockRegistry = {
      getRouteMap: jest.fn(),
      getDependencies: jest.fn(),
      getDependents: jest.fn().mockReturnValue(new Set()),
    };
    mockContext = {
      registry: mockRegistry as IRegistry,
      testFile: {
        cypress: {
          visitedRoutes: ['/login', '/dashboard'],
        },
      } as any,
    };
  });

  /**
   * @description Verifies identification of a direct route match where a test visits a route that explicitly renders the changed component.
   *
   * @example
   * changedFile: "src/pages/Login.tsx"
   * testVisitedRoutes: ["/login"]
   * routeMap: { "/login": "src/pages/Login.tsx" }
   *
   * @expected Matched signal should be returned with weight 0.85.
   */
  test('evaluate(): should detect direct route-to-component matches', () => {
    const changedFile = 'src/pages/Login.tsx';
    const routeMap = new Map([['/login', changedFile]]);
    (mockRegistry.getRouteMap as jest.Mock).mockReturnValue(routeMap);

    const signals = scorer.evaluate(changedFile, 'test.cy.ts', mockContext as IScorerContext);

    expect(signals[0].matched).toBe(true);
    expect(signals[0].weight).toBe(0.85);
    expect(signals[0].reason).toContain('visits /login which renders src/pages/Login.tsx');
  });

  /**
   * @description Validates transitive dependency matching where a test visits a route for a page component, which in turn imports the changed component.
   *
   * @example
   * changedFile: "src/components/LoginForm.tsx"
   * testVisitedRoutes: ["/login"]
   * routeMap: { "/login": "src/pages/LoginPage.tsx" }
   * LoginPage imports LoginForm.
   *
   * @expected Matched signal should be returned with a depth indicator (depth 1).
   */
  test('evaluate(): should detect transitive matches via imports', () => {
    const changedFile = 'src/components/LoginForm.tsx';
    const pageFile = 'src/pages/LoginPage.tsx';

    (mockRegistry.getRouteMap as jest.Mock).mockReturnValue(new Map([['/login', pageFile]]));
    (mockRegistry.getDependencies as jest.Mock).mockImplementation((path: string) => {
      if (path === pageFile) return new Set([changedFile]);
      return new Set();
    });

    const signals = scorer.evaluate(changedFile, 'test.cy.ts', mockContext as IScorerContext);

    expect(signals[0].matched).toBe(true);
    expect(signals[0].reason).toContain(
      'LoginPage.tsx imports src/components/LoginForm.tsx (depth 1)',
    );
  });

  /**
   * @description A transitive match through a heavily-visited route is damped by
   * route traffic: weight scales by (1 - routeShare)^exponent, so a route most
   * specs visit can't anchor a candidate on its own. Direct matches are exempt.
   */
  test('evaluate(): damps transitive matches through high-traffic routes', () => {
    const changedFile = 'src/actions/manageDevices.ts';
    const pageFile = 'src/containers/manageDevices.ts';
    const routeMap = new Map([['/managedevices', pageFile]]);

    // 8 of 10 specs visit /managedevices → 80% traffic.
    const tests = Array.from({ length: 10 }, (_, i) => ({
      type: 'test' as const,
      cypress: { visitedRoutes: i < 8 ? ['/managedevices'] : ['/other'] },
    }));

    mockRegistry.getRouteMap = jest.fn().mockReturnValue(routeMap);
    mockRegistry.getDependencies = jest
      .fn()
      .mockImplementation((p: string) => (p === pageFile ? new Set([changedFile]) : new Set()));
    mockRegistry.getFilesByType = jest.fn().mockReturnValue(tests);
    mockRegistry.getTestFileCount = jest.fn().mockReturnValue(10);
    mockContext.testFile = { cypress: { visitedRoutes: ['/managedevices'] } } as any;

    mockContext.config = { scoring: { routeTrafficDampingExponent: 1 } } as any;
    const damped = scorer.evaluate(changedFile, 'spec.cy.ts', mockContext as IScorerContext);

    mockContext.config = { scoring: { routeTrafficDampingExponent: 0 } } as any; // off
    const undamped = scorer.evaluate(changedFile, 'spec.cy.ts', mockContext as IScorerContext);

    expect(damped[0].matched).toBe(true);
    expect(undamped[0].matched).toBe(true);
    // 80% traffic, exponent 1 → damped to ~20% of the undamped weight.
    expect(damped[0].weight).toBeCloseTo(undamped[0].weight * 0.2, 5);
    expect(damped[0].reason).toContain('route traffic 80%');
  });

  /**
   * @description Ensures no false matches are reported when routesVisited is empty.
   *
   * @expected Unmatched signal with reason "No routes visited".
   */
  test('evaluate(): should report no match when no routes are visited', () => {
    mockContext.testFile!.cypress!.visitedRoutes = [];
    const signals = scorer.evaluate('src/Button.tsx', 'test.cy.ts', mockContext as IScorerContext);
    expect(signals[0].matched).toBe(false);
    expect(signals[0].reason).toBe('No routes visited');
  });
});
