import { CypressExtractorAnalyzer } from '@/core/analyzers/cypress-extractor/cypress-extractor';
import { ICypressSelector, IAPIIntercept, IURLAssertion } from '@/types/analyzers';
import { EHttpMethod, ESelectorAttr } from '@/utils/enums';

describe('CypressExtractorAnalyzer', () => {
  const extractor = new CypressExtractorAnalyzer();

  /**
   * @description Verifies the extraction of semantic data from a complete Cypress E2E test file,
   * including suites, tests, visits, interceptors, selectors, text content, and URL assertions.
   *
   * @example
   * // Input source code includes:
   * describe('Login Flow', ...);
   * cy.visit('/login');
   * cy.intercept('POST', '/api/login')...
   * cy.get('[data-testid="username-input"]')...
   * cy.contains('Welcome, testuser');
   * cy.url().should('include', '/dashboard');
   *
   * @expected Expects all elements of the ICypressExtractionResult to be correctly populated.
   */
  test('extract(): should process a complete login flow', async () => {
    const sourceCode = `
      describe('Login Flow', () => {
        it('should successfully login with valid credentials', () => {
          cy.visit('/login');
          cy.intercept('POST', '/api/login').as('loginRequest');
      
          cy.get('[data-testid="username-input"]').type('testuser');
          cy.get('[data-testid="password-input"]').type('password123');
          cy.get('[data-testid="submit-btn"]').click();
      
          cy.contains('Welcome, testuser');
          cy.url().should('include', '/dashboard');
        });
      });
    `;
    const result = await extractor.extract({ filePath: 'login.cy.ts', sourceCode });

    expect(result.filePath).toBe('login.cy.ts');
    expect(result.describeBlocks).toEqual(['Login Flow']);
    expect(result.itBlocks).toEqual(['should successfully login with valid credentials']);
    expect(result.visitedRoutes).toContain('/login');
    expect(result.selectors.length).toBe(3);
    expect(result.selectors.some((s: ICypressSelector) => s.value === 'username-input')).toBe(true);
    expect(
      result.interceptedAPIs.some(
        (i: IAPIIntercept) => i.method === 'POST' && i.urlPattern === '/api/login',
      ),
    ).toBe(true);
    expect(result.containsText).toContain('Welcome, testuser');
    expect(
      result.urlAssertions.some(
        (a: IURLAssertion) => a.operator === 'include' && a.expectedValue === '/dashboard',
      ),
    ).toBe(true);
  });

  /**
   * @description Validates the hierarchical extraction of Cypress test structures.
   *
   * @example
   * describe('Suite A', () => {
   *   context('Context B', () => {
   *     it('Test C', () => {});
   *   });
   * });
   *
   * @expected Expects both 'Suite A' and 'Context B' to be in describeBlocks, and 'Test C' in itBlocks.
   */
  test('extractStructure(): should extract describe, context and it blocks', async () => {
    const sourceCode = `
      describe('Suite A', () => {
        context('Context B', () => {
          it('Test C', () => {});
        });
      });
    `;
    const result = await extractor.extract({ filePath: 'structure.cy.ts', sourceCode });
    expect(result.describeBlocks).toContain('Suite A');
    expect(result.describeBlocks).toContain('Context B');
    expect(result.itBlocks).toContain('Test C');
  });

  /**
   * @description Checks the selector parser's ability to identify different CSS selector types.
   *
   * @example
   * cy.get('[data-testid="test-id"]');
   * cy.get('[data-cy="cy-id"]');
   * cy.get('#my-id');
   * cy.get('.my-class');
   * cy.find('div > p');
   *
   * @expected Expects 5 selectors of types 'testid', 'data-cy', 'id', 'class', and 'complex'.
   */
  test('extractSelectors(): should handle various selector types', async () => {
    const sourceCode = `
      cy.get('[data-testid="test-id"]');
      cy.get('[data-cy="cy-id"]');
      cy.get('#my-id');
      cy.get('.my-class');
      cy.find('div > p');
    `;
    const result = await extractor.extract({ filePath: 'selectors.cy.ts', sourceCode });
    expect(result.selectors.length).toBe(5);
    expect(
      result.selectors.some(
        (s: ICypressSelector) => s.type === ESelectorAttr.TEST_ID && s.value === 'test-id',
      ),
    ).toBe(true);
    expect(
      result.selectors.some(
        (s: ICypressSelector) => s.type === ESelectorAttr.DATA_CY && s.value === 'cy-id',
      ),
    ).toBe(true);
    expect(
      result.selectors.some(
        (s: ICypressSelector) => s.type === ESelectorAttr.ID && s.value === 'my-id',
      ),
    ).toBe(true);
    expect(
      result.selectors.some(
        (s: ICypressSelector) => s.type === ESelectorAttr.CLASS && s.value === 'my-class',
      ),
    ).toBe(true);
    expect(
      result.selectors.some(
        (s: ICypressSelector) => s.type === ESelectorAttr.COMPLEX && s.value === 'div > p',
      ),
    ).toBe(true);
  });

  /**
   * @description Validates support for different argument signatures of `cy.intercept()`.
   *
   * @example
   * cy.intercept('/api/simple'); // Should default to GET
   * cy.intercept('POST', '/api/complex');
   *
   * @expected Expects two intercepted APIs with correct methods ('GET', 'POST') and URL patterns.
   */
  test('extractIntercept(): should handle different intercept signatures', async () => {
    const sourceCode = `
      cy.intercept('/api/simple');
      cy.intercept('POST', '/api/complex');
    `;
    const result = await extractor.extract({ filePath: 'intercept.cy.ts', sourceCode });
    expect(result.interceptedAPIs.length).toBe(2);
    expect(
      result.interceptedAPIs.some(
        (i: IAPIIntercept) => i.method === EHttpMethod.GET && i.urlPattern === '/api/simple',
      ),
    ).toBe(true);
    expect(
      result.interceptedAPIs.some(
        (i: IAPIIntercept) => i.method === EHttpMethod.POST && i.urlPattern === '/api/complex',
      ),
    ).toBe(true);
  });

  /**
   * @description Tests the identification of custom Cypress commands.
   *
   * @example
   * cy.login('user', 'pass');
   * cy.logout();
   *
   * @expected Expects 'login' and 'logout' to be identified as custom commands.
   */
  test('extractCustomCommands(): should identify non-builtin commands', async () => {
    const sourceCode = `
      cy.login('user', 'pass');
      cy.logout();
    `;
    const result = await extractor.extract({ filePath: 'custom.cy.ts', sourceCode });
    expect(result.customCommandsUsed).toContain('login');
    expect(result.customCommandsUsed).toContain('logout');
  });
});
