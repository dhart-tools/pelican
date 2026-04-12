import { ReduxConsumerScorer } from '@/core/scoring/scorers/redux-consumer-scorer';
import { IScorerContext } from '@/types';

describe('ReduxConsumerScorer', () => {
  let scorer: ReduxConsumerScorer;
  let mockRegistry: any;

  beforeEach(() => {
    scorer = new ReduxConsumerScorer();
    mockRegistry = {
      getReduxChains: jest.fn(),
      getFile: jest.fn(),
      getRouteMap: jest.fn(),
    };
  });

  test('should match when visited route renders a Redux consumer component', () => {
    const changedFile = 'src/store/cart/cartSlice.ts';
    const testFile = 'cypress/e2e/checkout/checkout.cy.ts';
    const checkoutPage = 'src/pages/CheckoutPage.tsx';

    mockRegistry.getReduxChains.mockReturnValue(
      new Map([
        [
          'cart',
          {
            files: { slice: changedFile },
            consumers: [checkoutPage],
          },
        ],
      ]),
    );
    mockRegistry.getRouteMap.mockReturnValue(new Map([['/checkout', checkoutPage]]));
    mockRegistry.getFile.mockReturnValue({
      cypress: { visitedRoutes: ['/checkout'] },
    });

    const context: IScorerContext = {
      registry: mockRegistry,
      changedFile: { path: changedFile } as any,
      testFile: { path: testFile } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(true);
    expect(signals[0].reason).toContain('component uses Redux chain "cart"');
  });

  test('should return no match when route component is not a consumer', () => {
    const changedFile = 'src/store/cart/cartSlice.ts';
    const testFile = 'cypress/e2e/auth/login.cy.ts';
    const loginPage = 'src/pages/LoginPage.tsx';
    const checkoutPage = 'src/pages/CheckoutPage.tsx';

    mockRegistry.getReduxChains.mockReturnValue(
      new Map([
        [
          'cart',
          {
            files: { slice: changedFile },
            consumers: [checkoutPage],
          },
        ],
      ]),
    );
    mockRegistry.getRouteMap.mockReturnValue(new Map([['/login', loginPage]]));
    mockRegistry.getFile.mockReturnValue({
      cypress: { visitedRoutes: ['/login'] },
    });

    const context: IScorerContext = {
      registry: mockRegistry,
      changedFile: { path: changedFile } as any,
      testFile: { path: testFile } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(false);
  });
});
