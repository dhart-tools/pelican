// ============================================================
// SCORER COVERAGE for src/components/auth/RegisterForm.tsx
// ============================================================
// HIGH confidence expected:
//   SelectorMatchScorer   — cy.get('[data-testid="register-submit"]') etc.
//   APIInterceptScorer    — cy.intercept('POST', '/api/auth/register') matches src/api/auth.ts
//   TranslationMatchScorer — cy.contains('Create Account') maps to t('auth.register')
//   RouteMatchScorer      — cy.visit('/register') → RegisterPage → RegisterForm
// ============================================================

describe('Register flow', () => {
  beforeEach(() => {
    cy.intercept('POST', '/api/auth/register', {
      statusCode: 201,
      body: { id: '2', email: 'new@example.com', name: 'New User', token: 'tok456' },
    }).as('registerRequest');

    cy.visit('/register');
  });

  it('renders the register form', () => {
    cy.get('[data-testid="register-name"]').should('exist');
    cy.get('[data-testid="register-email"]').should('exist');
    cy.get('[data-testid="register-password"]').should('exist');
    cy.get('[data-testid="register-submit"]').should('exist');
    cy.contains('Create Account');
  });

  it('registers a new user', () => {
    cy.get('[data-testid="register-name"]').type('New User');
    cy.get('[data-testid="register-email"]').type('new@example.com');
    cy.get('[data-testid="register-password"]').type('password123');
    cy.get('[data-testid="register-submit"]').click();
    cy.wait('@registerRequest');
    cy.url().should('include', '/login');
  });

  it('shows error on failed registration', () => {
    cy.intercept('POST', '/api/auth/register', { statusCode: 409 }).as('registerFail');
    cy.get('[data-testid="register-name"]').type('Dup User');
    cy.get('[data-testid="register-email"]').type('dup@example.com');
    cy.get('[data-testid="register-password"]').type('pass');
    cy.get('[data-testid="register-submit"]').click();
    cy.wait('@registerFail');
    cy.get('[data-testid="register-error"]').should('contain', 'Something went wrong');
  });
});
