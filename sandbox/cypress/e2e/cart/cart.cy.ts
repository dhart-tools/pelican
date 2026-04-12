// ============================================================
// SCORER COVERAGE for src/components/cart/CartSummary.tsx
//                  src/components/cart/CartItem.tsx
//                  src/store/cartSlice.ts
//                  src/api/orders.ts
// ============================================================
// HIGH confidence expected:
//   SelectorMatchScorer    — cy.get('[data-testid="cart-summary"]'), "cart-empty",
//                            "checkout-btn", "cart-item-remove", "cart-item-qty"
//   SelectorIdMatchScorer  — cy.get('#cart-checkout-section')
//   TranslationMatchScorer — cy.contains('Your Cart'), cy.contains('Proceed to Checkout'),
//                            cy.contains('Total'), cy.contains('Your cart is empty')
//   RouteMatchScorer       — cy.visit('/cart') → CartPage → CartSummary
//   ReduxConsumerScorer    — CartSummary reads cartSlice; route /cart renders it
//   APIInterceptScorer     — cy.intercept('POST', '/api/orders') matches src/api/orders.ts
//   ReduxChainScorer       — CartItem dispatches removeFromCart from cartSlice
// ============================================================

describe('Cart page', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/products*', {
      statusCode: 200,
      body: {
        items: [
          { id: '1', name: 'Widget Pro', price: 49.99, description: 'desc', imageUrl: '/img/1.png', inStock: true, category: 'tools' },
        ],
        total: 1,
        page: 1,
      },
    });
    cy.visit('/products');
    cy.get('[data-testid="add-to-cart-btn"]').click();
    cy.visit('/cart');
  });

  it('shows cart summary with items', () => {
    cy.get('[data-testid="cart-summary"]').should('exist');
    cy.contains('Your Cart');
    cy.get('[data-testid="cart-item"]').should('have.length', 1);
  });

  it('displays cart total', () => {
    cy.get('[data-testid="cart-total"]').should('contain', '49.99');
    cy.contains('Total');
  });

  it('selects checkout section by id', () => {
    cy.get('#cart-checkout-section').should('exist');
  });

  it('removes item from cart', () => {
    cy.get('[data-testid="cart-item-remove"]').click();
    cy.contains('Your cart is empty');
  });

  it('updates quantity', () => {
    cy.get('[data-testid="cart-item-qty"]').clear().type('3');
    cy.get('[data-testid="cart-total"]').should('contain', '149.97');
  });

  it('places an order via checkout', () => {
    cy.intercept('POST', '/api/orders', {
      statusCode: 201,
      body: { id: 'ord1', userId: '1', items: [], total: 49.99, status: 'pending', createdAt: '' },
    }).as('placeOrder');

    cy.get('[data-testid="checkout-btn"]').click();
    cy.wait('@placeOrder');
    cy.contains('Your cart is empty');
    cy.contains('Proceed to Checkout');
  });

  it('shows empty cart state', () => {
    cy.get('[data-testid="cart-item-remove"]').click();
    cy.get('[data-testid="cart-empty"]').should('exist');
    cy.contains('Your cart is empty');
  });
});
