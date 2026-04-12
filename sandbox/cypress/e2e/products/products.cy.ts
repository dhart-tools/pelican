// ============================================================
// SCORER COVERAGE for src/components/products/ProductList.tsx
//                  src/components/products/ProductCard.tsx
//                  src/store/productSlice.ts
//                  src/api/products.ts
// ============================================================
// HIGH confidence expected:
//   SelectorMatchScorer    — cy.get('[data-testid="product-list"]'), "product-card", "add-to-cart-btn"
//   TranslationMatchScorer — cy.contains('Products'), cy.contains('Add to Cart')
//   RouteMatchScorer       — cy.visit('/products') → ProductsPage → ProductList
//   APIInterceptScorer     — cy.intercept('GET', '/api/products') matches src/api/products.ts
//   ReduxConsumerScorer    — ProductList reads productSlice; route /products renders it
//
// MEDIUM confidence expected:
//   TransitiveImportScorer — this file ← ProductList ← ProductCard (import chain)
// ============================================================

const mockProducts = [
  { id: '1', name: 'Widget Pro', price: 49.99, description: 'A widget', imageUrl: '/img/1.png', inStock: true, category: 'tools' },
  { id: '2', name: 'Gadget Plus', price: 29.99, description: 'A gadget', imageUrl: '/img/2.png', inStock: false, category: 'gadgets' },
];

describe('Products page', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/products*', {
      statusCode: 200,
      body: { items: mockProducts, total: 2, page: 1 },
    }).as('getProducts');

    cy.visit('/products');
    cy.wait('@getProducts');
  });

  it('shows the product list', () => {
    cy.get('[data-testid="product-list"]').should('exist');
    cy.contains('Products');
    cy.get('[data-testid="product-card"]').should('have.length', 2);
  });

  it('shows prices', () => {
    cy.get('[data-testid="product-price"]').first().should('contain', '49.99');
  });

  it('shows Add to Cart for in-stock products', () => {
    cy.get('[data-testid="add-to-cart-btn"]').should('have.length', 1);
    cy.contains('Add to Cart');
  });

  it('shows Out of Stock for unavailable products', () => {
    cy.get('[data-testid="out-of-stock"]').should('have.length', 1);
    cy.contains('Out of Stock');
  });

  it('adds a product to cart', () => {
    cy.get('[data-testid="add-to-cart-btn"]').first().click();
    cy.get('[data-testid="nav-cart"]').should('contain', '1');
  });

  it('shows loading state before products arrive', () => {
    cy.intercept('GET', '/api/products*', (req) => {
      req.reply({ delay: 200, body: { items: [], total: 0, page: 1 } });
    }).as('slowProducts');
    cy.visit('/products');
    cy.contains('Loading...');
    cy.wait('@slowProducts');
  });

  it('shows empty state when no products', () => {
    cy.intercept('GET', '/api/products*', { body: { items: [], total: 0, page: 1 } }).as('empty');
    cy.visit('/products');
    cy.wait('@empty');
    cy.contains('No products found');
  });
});
