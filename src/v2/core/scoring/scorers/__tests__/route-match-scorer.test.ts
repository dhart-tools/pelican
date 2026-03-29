import { RouteMatchScorer } from '@v2/core/scoring/scorers/route-match-scorer';
import { IScorerContext, IRegistry } from '@v2/types';

describe('RouteMatchScorer', () => {
  let scorer: RouteMatchScorer;
  let mockRegistry: Partial<IRegistry>;
  let mockContext: Partial<IScorerContext>;

  beforeEach(() => {
    scorer = new RouteMatchScorer();
    mockRegistry = {
      getRouteMap: jest.fn(),
      getDependencies: jest.fn(),
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
