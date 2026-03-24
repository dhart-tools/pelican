import * as ts from 'typescript';
import { BaseAnalyzer } from '../base';
import {
  ICypressExtractionResult,
  ICypressSelector,
  IAPIIntercept,
  IURLAssertion
} from '../../../types/cypress-extractor';

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

export class CypressExtractorAnalyzer extends BaseAnalyzer<{ filePath: string; sourceCode: string }, ICypressExtractionResult> {
  name = 'cypress-extractor';
  version = '1.0.0';
  dependencies = [];

  index(output: ICypressExtractionResult): void {
    // Placeholder implementation for indexing
  }

  async extract(input: {
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
    // node is cy.url()
    // node.parent is the .should (PropertyAccessExpression)
    // node.parent.parent is the call expression .should(...)
    const grandparent = node.parent.parent;
    if (
      grandparent &&
      ts.isCallExpression(grandparent)
    ) {
      const callExpr = grandparent;
      // Ensure the expression is the property access '.should'
      if (ts.isPropertyAccessExpression(callExpr.expression) && callExpr.expression.name.text === 'should') {
        const shouldArgs = callExpr.arguments;
        if (shouldArgs.length > 0) {
          const firstArg = shouldArgs[0];
          if (ts.isStringLiteral(firstArg)) {
            const operator = firstArg.text;

            let expectedValue = '';
            if (shouldArgs.length > 1 && ts.isStringLiteral(shouldArgs[1])) {
              expectedValue = shouldArgs[1].text;
            }

            if (expectedValue) {
              result.urlAssertions.push({ operator, expectedValue });
            }
          }
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
