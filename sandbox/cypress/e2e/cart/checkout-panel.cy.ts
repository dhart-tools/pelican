// SCENARIO 5 test — queries wrapper selector (owned by CheckoutPanel).
// SCENARIO 7 drift — also queries 'confirm-checkout' which no longer exists
// in source. selector-match for that token must miss.

describe('Checkout panel', () => {
  beforeEach(() => {
    cy.visit('/cart');
  });

  it('renders the panel wrapper', () => {
    cy.get('[data-testid="checkout-panel"]').should('exist');
  });

  it('looks for legacy confirm button (drift)', () => {
    cy.get('[data-testid="confirm-checkout"]').should('exist');
  });
});
