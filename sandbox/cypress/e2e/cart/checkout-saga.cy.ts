// SCENARIO 2 test side — references the same UPPER_SNAKE action strings.
// Expected: ActionTypeScorer fires when src/store/orderSaga.ts changes.

describe('Order checkout saga', () => {
  it('emits ORDER_CHECKOUT_REQUESTED then ORDER_CHECKOUT_SUCCEEDED', () => {
    const dispatched: string[] = [];
    cy.window().then((win) => {
      // hypothetical store spy — pelican only cares about the literals
      (win as unknown as { __ACTIONS__?: string[] }).__ACTIONS__ = dispatched;
    });

    cy.visit('/cart');
    cy.get('[data-testid="checkout-btn"]').click();

    cy.wrap(dispatched).should('include', 'order/ORDER_CHECKOUT_REQUESTED');
    cy.wrap(dispatched).should('include', 'order/ORDER_CHECKOUT_SUCCEEDED');
    cy.wrap(dispatched).should('not.include', 'order/ORDER_CHECKOUT_FAILED');
  });
});
