// ============================================================
// SCORER COVERAGE for src/components/common/Navbar.tsx
// ============================================================
// HIGH confidence expected:
//   SelectorMatchScorer    — cy.get('[data-testid="navbar"]'), "nav-home", "nav-products",
//                            "nav-cart", "nav-logout"
//   TranslationMatchScorer — cy.contains('Home'), cy.contains('Products')
//   RouteMatchScorer       — cy.visit('/') → HomePage → Navbar (Navbar is on all routes)
//   ReduxConsumerScorer    — Navbar reads cartSlice (selectCartCount); route / renders it
//
// MEDIUM confidence expected:
//   TransitiveImportScorer — Navbar imports from cartSlice and authSlice (indirect)
// ============================================================

describe('Navigation', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('renders the navbar on home page', () => {
    cy.get('[data-testid="navbar"]').should('exist');
    cy.contains('Home');
  });

  it('navigates to products page', () => {
    cy.get('[data-testid="nav-products"]').click();
    cy.url().should('include', '/products');
    cy.contains('Products');
  });

  it('navigates to cart page', () => {
    cy.get('[data-testid="nav-cart"]').click();
    cy.url().should('include', '/cart');
  });

  it('shows cart count badge', () => {
    cy.get('[data-testid="nav-cart"]').should('contain', '0');
  });

  it('shows logout button when authenticated', () => {
    cy.intercept('POST', '/api/auth/login', {
      body: { id: '1', email: 'u@t.com', name: 'U', token: 'tok' },
    }).as('login');
    cy.visit('/login');
    cy.get('[data-testid="email-input"]').type('u@t.com');
    cy.get('[data-testid="password-input"]').type('pass');
    cy.get('[data-testid="login-submit"]').click();
    cy.wait('@login');
    cy.get('[data-testid="nav-logout"]').should('exist');
  });

  it('navigates home from navbar link', () => {
    cy.visit('/products');
    cy.get('[data-testid="nav-home"]').click();
    cy.url().should('eq', Cypress.config('baseUrl') + '/');
  });
});
