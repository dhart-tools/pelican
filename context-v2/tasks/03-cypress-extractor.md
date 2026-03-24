# Task 03: Cypress Extractor Analyzer

## Overview

Create an analyzer that extracts semantic information from Cypress test files (E2E tests). This analyzer understands Cypress-specific commands and patterns to identify test behaviors, visited routes, and DOM interactions.

## Objectives

1. Parse Cypress test files (`*.cy.ts`, `*.cy.tsx`)
2. Extract `cy.visit()` calls and their URL patterns
3. Extract `cy.get()`, `cy.find()` selectors and parse them
4. Extract `cy.contains()` text content
5. Extract `cy.intercept()` API interception patterns
6. Extract `describe()` and `it()` test block names
7. Extract custom command usage

## Core Types

### Cypress Extraction Result

```typescript
export interface ICypressExtractionResult {
  filePath: string;

  // Test structure
  describeBlocks: string[];
  itBlocks: string[];

  // Cypress commands
  visitedRoutes: string[];
  selectors: ICypressSelector[];
  containsText: string[];
  interceptedAPIs: IAPIIntercept[];
  urlAssertions: IURLAssertion[];

  // Custom commands
  customCommandsUsed: string[];
}

export interface ICypressSelector {
  type: 'testid' | 'data-cy' | 'id' | 'class' | 'attribute' | 'complex';
  value: string;
  raw: string;
}

export interface IAPIIntercept {
  method: string;
  urlPattern: string;
}

export interface IURLAssertion {
  operator: string;
  expectedValue: string;
}
```

## Implementation

### 1. Create Cypress Extractor Analyzer

**File:** `src/analyzers/cypress-extractor.ts`

```typescript
import * as ts from 'typescript';
import { BaseAnalyzer } from './base';
import {
  ICypressExtractionResult,
  ICypressSelector,
  IAPIIntercept,
  IURLAssertion
} from '../core/types';

const BUILTIN_CYPRESS_COMMANDS = new Set([
  'visit', 'get', 'find', 'contains', 'click', 'type', 'submit', 'trigger',
  'check', 'uncheck', 'select', 'deselect', 'scrollIntoView', 'scrollTo',
  'dblclick', 'rightclick', 'hover', 'focus', 'blur', 'clear',
  'selectFile', 'clearFile',
  'intercept', 'request', 'wait', 'as', 'spread', 'wrap', 'within',
  'should', 'and', 'then', 'invoke', 'its', 'spy', 'stub',
  'clock', 'tick', 'viewport',
  'url', 'location', 'hash', 'go', 'reload', 'back', 'forward',
  'document', 'window',
  'log', 'debug', 'pause'
]);

export class CypressExtractorAnalyzer extends BaseAnalyzer {
  constructor() {
    super({
      name: 'cypress-extractor',
      version: '1.0.0',
      description: 'Extracts semantic information from Cypress test files',
      dependencies: []
    });
  }

  async analyze(input: {
    filePath: string;
    sourceCode: string;
  }): Promise<ICypressExtractionResult> {
    const { filePath, sourceCode } = input;

    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    const result: ICypressExtractionResult = {
      filePath,
      describeBlocks: [],
      itBlocks: [],
      visitedRoutes: [],
      selectors: [],
      containsText: [],
      interceptedAPIs: [],
      urlAssertions: [],
      customCommandsUsed: []
    };

    this.visitNode(sourceFile, result);

    return result;
  }

  private visitNode(node: ts.Node, result: ICypressExtractionResult): void {
    // Extract describe blocks
    if (ts.isCallExpression(node)) {
      this.extractCypressCommand(node, result);
      this.extractDescribeOrIt(node, result);
    }

    // Recursively visit children
    ts.forEachChild(node, (child) => this.visitNode(child, result));
  }

  private extractDescribeOrIt(
    node: ts.CallExpression,
    result: ICypressExtractionResult
  ): void {
    const expr = node.expression;

    if (ts.isIdentifier(expr)) {
      const name = expr.text;

      // describe('suite name', () => { ... })
      if (name === 'describe' && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg)) {
          result.describeBlocks.push(firstArg.text);
        }
      }

      // it('test name', () => { ... })
      if (name === 'it' && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg)) {
          result.itBlocks.push(firstArg.text);
        }
      }

      // context('group name', () => { ... })
      if (name === 'context' && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg)) {
          result.describeBlocks.push(firstArg.text);
        }
      }
    }
  }

  private extractCypressCommand(
    node: ts.CallExpression,
    result: ICypressExtractionResult
  ): void {
    if (!this.isCypressCommand(node)) {
      return;
    }

    const commandName = this.getCommandName(node);

    switch (commandName) {
      case 'visit':
        this.extractVisit(node, result);
        break;

      case 'get':
      case 'find':
        this.extractSelector(node, result);
        break;

      case 'contains':
        this.extractContains(node, result);
        break;

      case 'intercept':
        this.extractIntercept(node, result);
        break;

      case 'url':
        this.extractURLAssertion(node, result);
        break;

      default:
        // Check if it's a custom command
        if (!BUILTIN_CYPRESS_COMMANDS.has(commandName)) {
          result.customCommandsUsed.push(commandName);
        }
    }
  }

  private extractVisit(node: ts.CallExpression, result: ICypressExtractionResult): void {
    if (node.arguments.length === 0) return;

    const urlArg = node.arguments[0];

    // cy.visit('/path')
    if (ts.isStringLiteral(urlArg)) {
      result.visitedRoutes.push(urlArg.text);
    }

    // cy.visit('/path/${id}') - extract static prefix
    if (ts.isTemplateExpression(urlArg)) {
      const staticPrefix = urlArg.head.text;
      result.visitedRoutes.push(staticPrefix);
    }
  }

  private extractSelector(node: ts.CallExpression, result: ICypressExtractionResult): void {
    if (node.arguments.length === 0) return;

    const selectorArg = node.arguments[0];

    // cy.get('[data-testid="submit-btn"]')
    if (ts.isStringLiteral(selectorArg)) {
      const selectorString = selectorArg.text;
      const parsed = this.parseCSSSelector(selectorString);

      if (parsed) {
        result.selectors.push(parsed);
      }
    }
  }

  private parseCSSSelector(cssSelector: string): ICypressSelector | null {
    // Parse [data-testid="X"]
    const testidMatch = cssSelector.match(/\[data-testid=(["'])(.*?)\1\]/);
    if (testidMatch) {
      return {
        type: 'testid',
        value: testidMatch[2],
        raw: cssSelector
      };
    }

    // Parse [data-cy="X"]
    const dataCyMatch = cssSelector.match(/\[data-cy=(["'])(.*?)\1\]/);
    if (dataCyMatch) {
      return {
        type: 'data-cy',
        value: dataCyMatch[2],
        raw: cssSelector
      };
    }

    // Parse #id
    if (cssSelector.startsWith('#')) {
      return {
        type: 'id',
        value: cssSelector.substring(1).split(/[.#\[:]|\s+/)[0],
        raw: cssSelector
      };
    }

    // Parse .class
    if (cssSelector.startsWith('.')) {
      return {
        type: 'class',
        value: cssSelector.substring(1).split(/[.#\[:]|\s+/)[0],
        raw: cssSelector
      };
    }

    // Complex selector
    return {
      type: 'complex',
      value: cssSelector,
      raw: cssSelector
    };
  }

  private extractContains(node: ts.CallExpression, result: ICypressExtractionResult): void {
    if (node.arguments.length === 0) return;

    const textArg = node.arguments[0];

    // cy.contains('Sign In')
    if (ts.isStringLiteral(textArg)) {
      result.containsText.push(textArg.text);
    }

    // cy.contains(/pattern/)
    if (ts.isRegularExpressionLiteral(textArg)) {
      result.containsText.push(textArg.text);
    }
  }

  private extractIntercept(node: ts.CallExpression, result: ICypressExtractionResult): void {
    // cy.intercept('GET', '/api/users')
    // cy.intercept('/api/users')

    let method = '';
    let urlPattern = '';

    if (node.arguments.length === 1) {
      // cy.intercept('/api/*')
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg)) {
        urlPattern = arg.text;
        method = 'GET'; // Default
      }
    } else if (node.arguments.length === 2) {
      // cy.intercept('GET', '/api/users')
      const firstArg = node.arguments[0];
      const secondArg = node.arguments[1];

      if (ts.isStringLiteral(firstArg)) {
        if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(firstArg.text)) {
          method = firstArg.text;
          if (ts.isStringLiteral(secondArg)) {
            urlPattern = secondArg.text;
          }
        } else {
          urlPattern = firstArg.text;
          method = 'GET';
        }
      }
    }

    if (urlPattern) {
      result.interceptedAPIs.push({ method, urlPattern });
    }
  }

  private extractURLAssertion(node: ts.CallExpression, result: ICypressExtractionResult): void {
    // cy.url().should('include', '/dashboard')

    // Check if it's chained with .should()
    const parent = node.parent;
    if (
      parent &&
      ts.isCallExpression(parent) &&
      parent.expression === node &&
      parent.arguments.length > 0
    ) {
      const shouldArg = parent.arguments[0];

      if (ts.isStringLiteral(shouldArg)) {
        const operator = shouldArg.text;

        let expectedValue = '';
        if (parent.arguments.length > 1 && ts.isStringLiteral(parent.arguments[1])) {
          expectedValue = parent.arguments[1].text;
        }

        if (expectedValue) {
          result.urlAssertions.push({ operator, expectedValue });
        }
      }
    }
  }

  private isCypressCommand(node: ts.CallExpression): boolean {
    const expr = node.expression;

    // cy.visit()
    if (ts.isPropertyAccessExpression(expr)) {
      const obj = expr.expression;
      if (ts.isIdentifier(obj) && obj.text === 'cy') {
        return true;
      }
    }

    // visit() (if inside cy.$() or similar)
    return false;
  }

  private getCommandName(node: ts.CallExpression): string {
    const expr = node.expression;

    if (ts.isPropertyAccessExpression(expr)) {
      return expr.name.text;
    }

    if (ts.isIdentifier(expr)) {
      return expr.text;
    }

    return '';
  }
}
```

### 2. Update Types File

**File:** `src/core/types.ts` (Add to existing)

```typescript
// Add these interfaces

export interface ICypressExtractionResult {
  filePath: string;
  describeBlocks: string[];
  itBlocks: string[];
  visitedRoutes: string[];
  selectors: ICypressSelector[];
  containsText: string[];
  interceptedAPIs: IAPIIntercept[];
  urlAssertions: IURLAssertion[];
  customCommandsUsed: string[];
}

export interface ICypressSelector {
  type: 'testid' | 'data-cy' | 'id' | 'class' | 'attribute' | 'complex';
  value: string;
  raw: string;
}

export interface IAPIIntercept {
  method: string;
  urlPattern: string;
}

export interface IURLAssertion {
  operator: string;
  expectedValue: string;
}
```

## Usage Example

```typescript
import { CypressExtractorAnalyzer } from './analyzers/cypress-extractor';

const analyzer = new CypressExtractorAnalyzer();
const result = await analyzer.analyze({
  filePath: 'cypress/e2e/login.cy.ts',
  sourceCode: fs.readFileSync('cypress/e2e/login.cy.ts', 'utf-8')
});

console.log(result.visitedRoutes);     // ['/login']
console.log(result.selectors);        // [{ type: 'testid', value: 'username-input' }]
console.log(result.containsText);     // ['Sign In', 'Password']
console.log(result.interceptedAPIs);  // [{ method: 'POST', urlPattern: '/api/login' }]
```

## Example Input/Output

### Input: Login Test

```typescript
// cypress/e2e/login.cy.ts
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
```

### Output: Extraction Result

```typescript
{
  filePath: 'cypress/e2e/login.cy.ts',
  describeBlocks: ['Login Flow'],
  itBlocks: ['should successfully login with valid credentials'],
  visitedRoutes: ['/login'],
  selectors: [
    { type: 'testid', value: 'username-input', raw: '[data-testid="username-input"]' },
    { type: 'testid', value: 'password-input', raw: '[data-testid="password-input"]' },
    { type: 'testid', value: 'submit-btn', raw: '[data-testid="submit-btn"]' }
  ],
  containsText: ['Welcome, testuser'],
  interceptedAPIs: [
    { method: 'POST', urlPattern: '/api/login' }
  ],
  urlAssertions: [
    { operator: 'include', expectedValue: '/dashboard' }
  ],
  customCommandsUsed: []
}
```

## Testing Strategy

### Unit Tests

1. **Command Extraction**
   - Test cy.visit() extraction
   - Test cy.get() selector parsing
   - Test cy.find() selector parsing
   - Test cy.contains() text extraction
   - Test cy.intercept() API extraction

2. **Selector Parsing**
   - Test data-testid parsing
   - Test data-cy parsing
   - Test ID parsing
   - Test class parsing
   - Test complex selector handling

3. **Test Structure**
   - Test describe block extraction
   - Test it block extraction
   - Test context block extraction

### Integration Tests

1. Test extraction from complete Cypress test files
2. Test extraction from multiple test files
3. Test with various Cypress patterns

### Test Data

```
tests/fixtures/cypress-extractor/
  simple-test.cy.ts
  login-flow.cy.ts
  api-testing.cy.ts
  custom-commands.cy.ts
  complex-selector.cy.ts
```

## Dependencies

- `typescript` (peer dependency)
- Base analyzer system (Task 01)

## Performance Considerations

1. Cache parsed test files
2. Use efficient selector parsing (avoid excessive regex)
3. Parallelize test file processing
4. Handle large test files gracefully

## Related Tasks

- Task 01: Base Analyzer System
- Task 02: Source Extractor Analyzer
- Task 05: Scoring Engine
- Task 10: Custom Command Handler

## Notes

- This analyzer is essential for understanding test behavior
- Parsed selectors can be matched against source file selectors
- Custom commands need to be resolved via the custom command registry (separate task)
- URL assertions provide additional mapping to routes