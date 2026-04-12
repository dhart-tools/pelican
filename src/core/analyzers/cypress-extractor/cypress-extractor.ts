import * as ts from 'typescript';

import { BaseAnalyzer } from '@/core/analyzers/base';
import { ICypressExtractionResult, ICypressSelector } from '@/types/analyzers';
import {
  BUILTIN_CYPRESS_COMMANDS,
  REGEX_TEST_ID,
  REGEX_DATA_CY,
  REGEX_SELECTOR_SPLIT,
} from '@/utils/constants';
import {
  ECypressCommand,
  EHttpMethod,
  ETestBlockType,
  EAssertionType,
  ESelectorAttr,
  EAnalyzerName,
} from '@/utils/enums';

export interface CypressExtractorInput {
  filePath: string;
  sourceCode: string;
  /**
   * Optional callback to resolve JSON namespace imports.
   * Given an import path (e.g. "@fixtures/dataTestIds.json"), returns the parsed JSON object.
   * This allows the extractor to resolve `cy.get(dataTestIds.facilityName)` to actual selector strings.
   */
  resolveJsonImport?: (importPath: string) => Promise<Record<string, unknown> | null>;
}

/**
 * Analyzer that extracts semantic information from Cypress test files.
 *
 * @example
 * const analyzer = new CypressExtractorAnalyzer();
 * const result = await analyzer.extract({
 *   filePath: 'cypress/e2e/login.cy.ts',
 *   sourceCode: 'describe("Login", () => { cy.visit("/login"); });'
 * });
 * console.log(result.visitedRoutes); // ['/login']
 */
export class CypressExtractorAnalyzer extends BaseAnalyzer<
  CypressExtractorInput,
  ICypressExtractionResult
> {
  name = EAnalyzerName.CYPRESS_EXTRACTOR;
  version = '1.0.0';
  dependencies = [];

  /** Resolved namespace imports: binding name → { property → value } */
  private importBindings: Map<string, Record<string, unknown>> = new Map();

  /**
   * Placeholder implementation for indexing.
   * @param output The result of the extraction
   */
  index(_output: ICypressExtractionResult): void {
    // Placeholder implementation for indexing
  }

  /**
   * Extracts semantic information from the provided Cypress test file code.
   *
   * @param input The input containing file path and source code.
   * @returns A promise resolving to the Cypress extraction result.
   */
  async extract(input: CypressExtractorInput): Promise<ICypressExtractionResult> {
    const { filePath, sourceCode, resolveJsonImport } = input;

    const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);

    const result: ICypressExtractionResult = {
      filePath,
      imports: [],
      describeBlocks: [],
      itBlocks: [],
      visitedRoutes: [],
      selectors: [],
      containsText: [],
      interceptedAPIs: [],
      urlAssertions: [],
      customCommandsUsed: [],
    };

    // Phase 1: Resolve JSON namespace imports so we can dereference variable selectors
    if (resolveJsonImport) {
      await this.resolveNamespaceImports(sourceFile, resolveJsonImport);
    }

    // Phase 2: Extract imports + cypress commands
    this.visitNode(sourceFile, result);

    // Cleanup instance state
    this.importBindings.clear();

    return result;
  }

  /**
   * Scans top-level import declarations for `import * as X from "*.json"` patterns,
   * resolves them via the provided callback, and stores the results in `this.importBindings`.
   */
  private async resolveNamespaceImports(
    sourceFile: ts.SourceFile,
    resolveJsonImport: (importPath: string) => Promise<Record<string, unknown> | null>,
  ): Promise<void> {
    this.importBindings.clear();

    const pending: Array<{ bindingName: string; modulePath: string }> = [];

    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isImportDeclaration(node)) return;
      const moduleSpecifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) return;
      if (!moduleSpecifier.text.endsWith('.json')) return;

      // import * as X from "file.json"
      if (
        node.importClause?.namedBindings &&
        ts.isNamespaceImport(node.importClause.namedBindings)
      ) {
        pending.push({
          bindingName: node.importClause.namedBindings.name.text,
          modulePath: moduleSpecifier.text,
        });
      }
    });

    for (const { bindingName, modulePath } of pending) {
      const resolved = await resolveJsonImport(modulePath);
      if (resolved) {
        this.importBindings.set(bindingName, resolved);
      }
    }
  }

  /**
   * Recursively visits AST nodes to extract Cypress commands and test structure.
   *
   * @param node The current AST node to visit.
   * @param result The result object to populate.
   */
  private visitNode(node: ts.Node, result: ICypressExtractionResult): void {
    // Extract import module paths
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        result.imports!.push(moduleSpecifier.text);
      }
    }

    if (ts.isCallExpression(node)) {
      this.extractCypressCommand(node, result);
      this.extractDescribeOrIt(node, result);
    }

    ts.forEachChild(node, (child) => this.visitNode(child, result));
  }

  /**
   * Extracts describe, context, and it block names from the AST.
   *
   * @param node The call expression node.
   * @param result The result object to populate.
   */
  private extractDescribeOrIt(node: ts.CallExpression, result: ICypressExtractionResult): void {
    const expr = node.expression;

    if (ts.isIdentifier(expr)) {
      const name = expr.text;

      if (name === ETestBlockType.DESCRIBE && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg)) {
          result.describeBlocks.push(firstArg.text);
        }
      }

      if (name === ETestBlockType.IT && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg)) {
          result.itBlocks.push(firstArg.text);
        }
      }

      if (name === ETestBlockType.CONTEXT && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg)) {
          result.describeBlocks.push(firstArg.text);
        }
      }
    }
  }

  /**
   * Extracts Cypress commands from a call expression.
   *
   * @param node The call expression node.
   * @param result The result object to populate.
   */
  private extractCypressCommand(node: ts.CallExpression, result: ICypressExtractionResult): void {
    if (!this.isCypressCommand(node)) {
      return;
    }

    const commandName = this.getCommandName(node);

    switch (commandName) {
      case ECypressCommand.VISIT:
        this.extractVisit(node, result);
        break;

      case ECypressCommand.GET:
      case ECypressCommand.FIND:
        this.extractSelector(node, result);
        break;

      case ECypressCommand.CONTAINS:
        this.extractContains(node, result);
        break;

      case ECypressCommand.INTERCEPT:
        this.extractIntercept(node, result);
        break;

      case ECypressCommand.URL:
        this.extractURLAssertion(node, result);
        break;

      default:
        if (!BUILTIN_CYPRESS_COMMANDS.has(commandName)) {
          result.customCommandsUsed.push(commandName);
          this.extractCustomCommandHints(node, commandName, result);
        }
    }
  }

  /**
   * Extracts URL from a cy.visit() command.
   *
   * @param node The call expression node.
   * @param result The result object to populate.
   */
  private extractVisit(node: ts.CallExpression, result: ICypressExtractionResult): void {
    if (node.arguments.length === 0) return;

    const urlArg = node.arguments[0];

    if (ts.isStringLiteral(urlArg)) {
      result.visitedRoutes.push(urlArg.text);
    }

    if (ts.isTemplateExpression(urlArg)) {
      const staticPrefix = urlArg.head.text;
      result.visitedRoutes.push(staticPrefix);
    }
  }

  /**
   * Extracts a selector from a cy.get() or cy.find() command.
   * Handles both string literals and resolved property access expressions (e.g. dataTestIds.xxx).
   *
   * @param node The call expression node.
   * @param result The result object to populate.
   */
  private extractSelector(node: ts.CallExpression, result: ICypressExtractionResult): void {
    if (node.arguments.length === 0) return;

    const selectorArg = node.arguments[0];

    let selectorString: string | null = null;

    if (ts.isStringLiteral(selectorArg)) {
      selectorString = selectorArg.text;
    } else if (ts.isPropertyAccessExpression(selectorArg)) {
      selectorString = this.resolvePropertyAccess(selectorArg);
    }

    if (selectorString) {
      const parsed = this.parseCSSSelector(selectorString);
      if (parsed) {
        result.selectors.push(parsed);
      }
    }
  }

  /**
   * Resolves a property access expression (e.g. `dataTestIds.facilityName`) to its string value
   * using previously resolved JSON namespace imports.
   */
  private resolvePropertyAccess(expr: ts.PropertyAccessExpression): string | null {
    const obj = expr.expression;
    const prop = expr.name.text;

    if (ts.isIdentifier(obj)) {
      const binding = this.importBindings.get(obj.text);
      if (binding && typeof binding[prop] === 'string') {
        return binding[prop] as string;
      }
    }

    return null;
  }

  /**
   * Parses a CSS selector into a structured object.
   *
   * @param cssSelector The raw CSS selector string.
   * @returns The parsed selector, or null if parsing fails.
   */
  private parseCSSSelector(cssSelector: string): ICypressSelector | null {
    const testidMatch = cssSelector.match(REGEX_TEST_ID);
    if (testidMatch) {
      return {
        type: ESelectorAttr.TEST_ID,
        value: testidMatch[2],
        raw: cssSelector,
      };
    }

    const dataCyMatch = cssSelector.match(REGEX_DATA_CY);
    if (dataCyMatch) {
      return {
        type: ESelectorAttr.DATA_CY,
        value: dataCyMatch[2],
        raw: cssSelector,
      };
    }

    if (cssSelector.startsWith('#')) {
      return {
        type: ESelectorAttr.ID,
        value: cssSelector.substring(1).split(REGEX_SELECTOR_SPLIT)[0],
        raw: cssSelector,
      };
    }

    if (cssSelector.startsWith('.')) {
      return {
        type: ESelectorAttr.CLASS,
        value: cssSelector.substring(1).split(REGEX_SELECTOR_SPLIT)[0],
        raw: cssSelector,
      };
    }

    return {
      type: ESelectorAttr.COMPLEX,
      value: cssSelector,
      raw: cssSelector,
    };
  }

  /**
   * Extracts text content from a cy.contains() command.
   *
   * @param node The call expression node.
   * @param result The result object to populate.
   */
  private extractContains(node: ts.CallExpression, result: ICypressExtractionResult): void {
    if (node.arguments.length === 0) return;

    const textArg = node.arguments[0];

    if (ts.isStringLiteral(textArg)) {
      result.containsText.push(textArg.text);
    }

    if (ts.isRegularExpressionLiteral(textArg)) {
      result.containsText.push(textArg.text);
    }
  }

  /**
   * Extracts API interception details from a cy.intercept() command.
   *
   * @param node The call expression node.
   * @param result The result object to populate.
   */
  private extractIntercept(node: ts.CallExpression, result: ICypressExtractionResult): void {
    let method = '';
    let urlPattern = '';

    const HTTP_METHODS = new Set([
      EHttpMethod.GET,
      EHttpMethod.POST,
      EHttpMethod.PUT,
      EHttpMethod.DELETE,
      EHttpMethod.PATCH,
    ]);

    const args = node.arguments;

    if (args.length === 1) {
      // cy.intercept('/api/path')
      const arg = args[0];
      if (ts.isStringLiteral(arg)) {
        urlPattern = arg.text;
        method = EHttpMethod.GET;
      }
    } else if (args.length >= 2) {
      const firstArg = args[0];
      const secondArg = args[1];

      if (ts.isStringLiteral(firstArg) && HTTP_METHODS.has(firstArg.text as EHttpMethod)) {
        // cy.intercept('POST', '/api/path')
        // cy.intercept('POST', '/api/path', { ...mock })
        method = firstArg.text;
        if (ts.isStringLiteral(secondArg)) {
          urlPattern = secondArg.text;
        }
      } else if (ts.isStringLiteral(firstArg)) {
        // cy.intercept('/api/path', { ...mock })
        urlPattern = firstArg.text;
        method = EHttpMethod.GET;
      }
    }

    if (urlPattern) {
      result.interceptedAPIs.push({ method, urlPattern });
    }
  }

  /**
   * Extracts URL assertions from a cy.url().should() chain.
   *
   * @param node The cy.url() call expression node.
   * @param result The result object to populate.
   */
  private extractURLAssertion(node: ts.CallExpression, result: ICypressExtractionResult): void {
    const grandparent = node.parent.parent;
    if (grandparent && ts.isCallExpression(grandparent)) {
      const callExpr = grandparent;
      if (
        ts.isPropertyAccessExpression(callExpr.expression) &&
        callExpr.expression.name.text === EAssertionType.SHOULD
      ) {
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

  /**
   * Extracts hints from custom command arguments.
   * If any string literal argument looks like a route (starts with "/"), capture it as a visited route.
   */
  private extractCustomCommandHints(
    node: ts.CallExpression,
    _commandName: string,
    result: ICypressExtractionResult,
  ): void {
    for (const arg of node.arguments) {
      if (ts.isStringLiteral(arg) && arg.text.startsWith('/')) {
        result.visitedRoutes.push(arg.text);
      }
    }
  }

  /**
   * Checks if a call expression is a Cypress command (starts with `cy.`).
   *
   * @param node The call expression node.
   * @returns True if it's a Cypress command, false otherwise.
   */
  private isCypressCommand(node: ts.CallExpression): boolean {
    const expr = node.expression;

    if (ts.isPropertyAccessExpression(expr)) {
      const obj = expr.expression;
      if (ts.isIdentifier(obj) && obj.text === 'cy') {
        return true;
      }
    }

    return false;
  }

  /**
   * Gets the name of the Cypress command.
   *
   * @param node The call expression node.
   * @returns The command name string.
   */
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
