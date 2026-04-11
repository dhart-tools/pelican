// ============================================================
// SCORER COVERAGE for src/components/auth/LoginForm.tsx
// ============================================================
// HIGH confidence expected:
//   DirectImportScorer    — this test imports LoginForm directly (would be direct-import)
//   SelectorMatchScorer   — cy.get('[data-testid="login-submit"]') matches LoginForm selectors
//   SelectorIdMatchScorer — cy.get('#login-form') matches id="login-form" in LoginForm
//   TranslationMatchScorer — cy.contains('Sign In') matches t('auth.signIn') key
//   APIInterceptScorer    — cy.intercept('POST', '/api/auth/*') matches src/api/auth.ts
//   RouteMatchScorer      — cy.visit('/login') → LoginPage → LoginForm (chain)
//
// MEDIUM confidence expected (for indirect files):
//   FilenameConventionScorer — "login" matches LoginForm partially (LOW if normalized diverges)
// ============================================================

describe('Login flow', () => {
  beforeEach(() => {
    cy.intercept('POST', '/api/auth/login', {
      statusCode: 200,
      body: { id: '1', email: 'test@example.com', name: 'Test User', token: 'tok123' },
    }).as('loginRequest');

    cy.intercept('POST', '/api/auth/logout', { statusCode: 200 }).as('logoutRequest');

    cy.visit('/login');
  });

  it('renders the login form with all elements', () => {
    cy.get('[data-testid="email-input"]').should('exist');
    cy.get('[data-testid="password-input"]').should('exist');
    cy.get('[data-testid="login-submit"]').should('exist');
    cy.contains('Sign In');
  });

  it('logs in with valid credentials', () => {
    cy.get('[data-testid="email-input"]').type('user@example.com');
    cy.get('[data-testid="password-input"]').type('secret');
    cy.get('[data-testid="login-submit"]').click();
    cy.wait('@loginRequest');
    cy.url().should('include', '/products');
  });

  it('shows error on invalid credentials', () => {
    cy.intercept('POST', '/api/auth/login', { statusCode: 401 }).as('loginFail');
    cy.get('[data-testid="email-input"]').type('bad@example.com');
    cy.get('[data-testid="password-input"]').type('wrong');
    cy.get('[data-testid="login-submit"]').click();
    cy.wait('@loginFail');
    cy.contains('Invalid credentials');
  });

  it('selects form by id', () => {
    cy.get('#login-form').should('exist');
  });

  it('navigates to register page from login', () => {
    cy.contains("Don't have an account?").click();
    cy.url().should('include', '/register');
  });
});
