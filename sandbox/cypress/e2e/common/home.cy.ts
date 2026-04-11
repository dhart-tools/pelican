// ============================================================
// SCORER COVERAGE for src/pages/HomePage.tsx
// ============================================================
// HIGH confidence expected:
//   RouteMatchScorer       — cy.visit('/') → App.tsx route "/" → HomePage
//   SelectorMatchScorer    — cy.get('[data-testid="home-page"]'), "go-to-products", "go-to-login"
//   TranslationMatchScorer — cy.contains('Home'), cy.contains('Sign In')
//   FilenameConventionScorer — home.cy.ts ↔ HomePage.tsx (normalized: "home" == "homepage" — partial)
// ============================================================

describe('Home page', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('renders the home page', () => {
    cy.get('[data-testid="home-page"]').should('exist');
    cy.contains('Home');
  });

  it('links to products', () => {
    cy.get('[data-testid="go-to-products"]').click();
    cy.url().should('include', '/products');
  });

  it('links to login', () => {
    cy.get('[data-testid="go-to-login"]').click();
    cy.url().should('include', '/login');
    cy.contains('Sign In');
  });
});
