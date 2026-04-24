import * as ts from 'typescript';

import { BaseAnalyzer } from '@/core/analyzers/base';
import { ISourceExtractionResult } from '@/types/analyzers';
import { SELECTOR_ATTRIBUTES } from '@/utils/constants';
import { EFunctionCall, ERedux, EReactRouter, EReactComponent, EAnalyzerName } from '@/utils/enums';

/**
 * Analyzer that extracts semantic information from source files using TypeScript's Compiler API.
 *
 * @example
 * const analyzer = new SourceExtractorAnalyzer();
 * const result = await analyzer.extract({
 *   filePath: 'src/App.tsx',
 *   sourceCode: 'export const App = () => <div data-testid="app" />;'
 * });
 * console.log(result.selectors); // [{ attr: 'data-testid', value: 'app' }]
 */
export class SourceExtractorAnalyzer extends BaseAnalyzer<
  { filePath: string; sourceCode: string },
  ISourceExtractionResult
> {
  name = EAnalyzerName.SOURCE_EXTRACTOR;
  version = '1.0.0';

  /**
   * Extracts AST information from the given file content.
   *
   * @param input The input containing file path and source code
   * @returns A promise resolving to the extracted AST structure
   *
   * @example
   * const result = await analyzer.extract({
   *   filePath: 'Component.tsx',
   *   sourceCode: 'import { t } from "i18n"; t("hello");'
   * });
   */
  async extract(input: { filePath: string; sourceCode: string }): Promise<ISourceExtractionResult> {
    const { filePath, sourceCode } = input;

    const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);

    const result: ISourceExtractionResult = {
      filePath,
      exports: [],
      imports: [],
      classes: [],
      functions: [],
      interfaces: [],
      keywords: [],
      selectors: [],
      jsxTextContent: [],
      translationKeys: [],
      routesDefined: [],
      reduxUsage: {
        selectorsUsed: [],
        actionsDispatched: [],
        slicesDefined: [],
      },
      actionTypeStrings: [],
      actionTypeConstExports: {},
      importedIdentifiers: [],
    };

    this.visitNode(sourceFile, result);

    return result;
  }

  /**
   * Stores the extracted AST information into the central registry.
   *
   * @param output The result of the extraction
   *
   * @example
   * analyzer.index(extractedData);
   */
  index(output: ISourceExtractionResult): void {
    console.log('Indexing SourceExtractor output:', output.filePath);
  }

  /**
   * Recursively visits AST nodes to extract relevant information.
   *
   * @param node The current AST node to visit
   * @param result The result object to populate
   */
  private visitNode(node: ts.Node, result: ISourceExtractionResult): void {
    if (ts.isImportDeclaration(node)) {
      this.extractImport(node, result);
    }

    if (ts.isExportDeclaration(node)) {
      this.extractExport(node, result);
    }

    if (ts.isClassDeclaration(node) && node.name) {
      result.classes.push(node.name.text);
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      result.functions.push(node.name.text);
    }

    if (ts.isInterfaceDeclaration(node) && node.name) {
      result.interfaces.push(node.name.text);
    }

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      this.extractJSXAttributes(node, result);

      const tagName = ts.isJsxElement(node)
        ? node.openingElement.tagName.getText()
        : node.tagName.getText();
      // Accept any `*Route` tag (Route, PrivateRoute, PublicRoute, ProtectedRoute…)
      // or `AuthenticatedRoute`, etc. Real apps rarely use React Router's raw `Route`.
      if (tagName === EReactComponent.ROUTE || /Route$/.test(tagName)) {
        this.extractRouteFromJSX(result, node);
      }
    }

    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text.length > 0) {
        result.jsxTextContent.push(text);
      }
    }

    if (ts.isCallExpression(node)) {
      this.extractFunctionCalls(node, result);
      this.maybeCollectKeyMirrorActionTypes(node, result);
    }

    // Extract selector-like properties from object literals (e.g. { dataTestId: 'SaveButton' })
    if (ts.isPropertyAssignment(node)) {
      this.extractObjectPropertySelector(node, result);
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      this.maybeCollectActionType(node.text, result);
    }

    // `export const FOO = 'action-type-literal'` — record the binding so
    // other files that import FOO by identifier can be linked back to this
    // literal during registry post-processing.
    if (ts.isVariableStatement(node)) {
      this.maybeCollectActionTypeConstExport(node, result);
    }

    // PropertyAccess form: `ActionTypes.RECEIVED_FOO`, `TeamTypes.RECEIVED_TEAMS`.
    // Mattermost dispatches/reducer-cases address types this way, so the raw
    // string never appears at the call site even though both sides agree on
    // the symbol. Treat the trailing identifier as an action-type reference.
    if (ts.isPropertyAccessExpression(node)) {
      this.maybeCollectActionTypeFromPropertyAccess(node, result);
    }

    ts.forEachChild(node, (child) => this.visitNode(child, result));
  }

  // Action-type-shaped strings — two accepted forms:
  //   * UPPER_SNAKE with at least one underscore (RECEIVED_CHANNEL, LOGIN_SUCCESS).
  //     Single-word UPPER strings like POST/DELETE/BEARER are rejected — too generic.
  //   * "slice/SOMETHING" RTK namespaced form (channels/receivedChannel).
  //     The slash + lowercase-prefix shape is rare enough to be specific to
  //     redux-toolkit action conventions, so we accept any case after the slash.
  private static readonly ACTION_TYPE_RE = /^(?:[a-z][a-zA-Z0-9]*\/)?[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

  private maybeCollectActionType(text: string, result: ISourceExtractionResult): void {
    if (text.length < 5 || text.length > 80) return;
    if (!SourceExtractorAnalyzer.ACTION_TYPE_RE.test(text)) return;
    result.actionTypeStrings.push(text);
  }

  // Property access whose object is identifier ending in "Types" or "ActionTypes",
  // and member name passes the action-type regex. Restricted to that suffix to
  // avoid harvesting unrelated UPPER_SNAKE constants on other namespaces.
  private maybeCollectActionTypeFromPropertyAccess(
    node: ts.PropertyAccessExpression,
    result: ISourceExtractionResult,
  ): void {
    const obj = node.expression;
    if (!ts.isIdentifier(obj)) return;
    if (!/Types$/.test(obj.text)) return;
    const memberName = node.name.text;
    this.maybeCollectActionType(memberName, result);
  }

  // Mattermost / mattermost-redux convention: `keyMirror({ FOO_BAR: null, ... })`
  // produces an object whose values equal their keys. The action types are
  // identifier keys, not string literals — so they bypass `maybeCollectActionType`.
  // This handler harvests UPPER_SNAKE keys from any `keyMirror(...)` call.
  private maybeCollectKeyMirrorActionTypes(
    node: ts.CallExpression,
    result: ISourceExtractionResult,
  ): void {
    const callee = node.expression;
    const calleeName = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : '';
    if (calleeName !== 'keyMirror') return;
    const arg = node.arguments[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) return;
    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
      const keyNode = prop.name;
      if (!keyNode || !ts.isIdentifier(keyNode)) continue;
      this.maybeCollectActionType(keyNode.text, result);
    }
  }

  /**
   * Extracts import information from an import declaration.
   *
   * @param node The import declaration node
   * @param result The result object to populate
   */
  private extractImport(node: ts.ImportDeclaration, result: ISourceExtractionResult): void {
    const moduleSpecifier = node.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) return;
    const module = moduleSpecifier.text;
    result.imports.push(module);

    const clause = node.importClause;
    if (!clause || !clause.namedBindings) return;
    if (ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        result.importedIdentifiers.push({ name: el.name.text, module });
      }
    }
  }

  // Scan `export const X = 'literal'` (and `export const { X, Y } = ...`
  // is out of scope — keep it simple). When the literal matches the
  // action-type regex, remember the binding so importers can resolve it.
  private maybeCollectActionTypeConstExport(
    node: ts.VariableStatement,
    result: ISourceExtractionResult,
  ): void {
    const isExported = ts
      .getModifiers(node)
      ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) return;
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const init = decl.initializer;
      if (!init) continue;
      if (!ts.isStringLiteral(init) && !ts.isNoSubstitutionTemplateLiteral(init)) continue;
      const literal = init.text;
      if (!SourceExtractorAnalyzer.ACTION_TYPE_RE.test(literal)) continue;
      if (literal.length < 5 || literal.length > 80) continue;
      result.actionTypeConstExports[decl.name.text] = literal;
    }
  }

  /**
   * Extracts export information from an export declaration.
   *
   * @param node The export declaration node
   * @param result The result object to populate
   */
  private extractExport(node: ts.ExportDeclaration, result: ISourceExtractionResult): void {
    const moduleSpecifier = node.moduleSpecifier;
    if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
      result.imports.push(moduleSpecifier.text);
    }

    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        result.exports.push(element.name.text);
      }
    }
  }

  /**
   * Extracts relevant data attributes (e.g., data-testid) from JSX elements.
   *
   * @param node The JSX element node
   * @param result The result object to populate
   */
  private extractJSXAttributes(
    node: ts.JsxElement | ts.JsxSelfClosingElement,
    result: ISourceExtractionResult,
  ): void {
    const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;

    if (ts.isJsxAttributes(attributes)) {
      for (const attr of attributes.properties) {
        if (ts.isJsxAttribute(attr)) {
          const attrName = attr.name.getText();
          const attrValue = this.getAttributeValue(attr);

          if (SELECTOR_ATTRIBUTES.includes(attrName) && attrValue) {
            result.selectors.push({ attr: attrName, value: attrValue });
          }
        }
      }
    }
  }

  /**
   * Gets the string value of a JSX attribute.
   *
   * @param attr The JSX attribute node
   * @returns The attribute value string, or an empty string if not a string literal
   */
  private getAttributeValue(attr: ts.JsxAttribute): string {
    if (!attr.initializer) return '';
    if (ts.isStringLiteral(attr.initializer)) {
      return attr.initializer.text;
    }
    // `data-test={`transaction-item-${id}`}` — use static head as best-effort value
    // so prefix-matching in SelectorMatchScorer can still match `getBySelLike(...)`.
    if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      const expr = attr.initializer.expression;
      if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
        return expr.text;
      }
      if (ts.isTemplateExpression(expr)) {
        return expr.head.text;
      }
    }
    return '';
  }

  /**
   * Extracts selectors from object literal property assignments.
   * Catches patterns like `{ dataTestId: 'SaveButton' }` that aren't JSX attributes.
   *
   * @param node The property assignment node
   * @param result The result object to populate
   */
  private extractObjectPropertySelector(
    node: ts.PropertyAssignment,
    result: ISourceExtractionResult,
  ): void {
    const propName = node.name.getText();
    if (!SELECTOR_ATTRIBUTES.includes(propName)) return;

    if (node.initializer && ts.isStringLiteral(node.initializer)) {
      result.selectors.push({ attr: propName, value: node.initializer.text });
    }
  }

  /**
   * Extracts function calls for specific patterns like i18n and Redux.
   *
   * @param node The call expression node
   * @param result The result object to populate
   */
  private extractFunctionCalls(node: ts.CallExpression, result: ISourceExtractionResult): void {
    const expr = node.expression;

    if (ts.isIdentifier(expr)) {
      const name = expr.text;

      if (name === EFunctionCall.T && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg)) {
          result.translationKeys.push(firstArg.text);
        }
      }

      if (name === EFunctionCall.USE_SELECTOR && node.arguments.length > 0) {
        const selector = node.arguments[0].getText();
        result.reduxUsage.selectorsUsed.push(selector);
      }

      if (name === EFunctionCall.DISPATCH && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (ts.isCallExpression(firstArg)) {
          const actionCreator = firstArg.expression.getText();
          result.reduxUsage.actionsDispatched.push(actionCreator);
        }
      }

      if (name === EFunctionCall.CREATE_SELECTOR) {
        for (const arg of node.arguments.slice(0, -1)) {
          result.reduxUsage.selectorsUsed.push(arg.getText());
        }
      }
    }

    if (
      (ts.isPropertyAccessExpression(expr) && expr.name.text === EFunctionCall.CREATE_SLICE) ||
      (ts.isIdentifier(expr) && expr.text === EFunctionCall.CREATE_SLICE)
    ) {
      const firstArg = node.arguments[0];
      if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
        for (const prop of firstArg.properties) {
          if (ts.isPropertyAssignment(prop) && prop.name.getText() === ERedux.NAME) {
            if (ts.isStringLiteral(prop.initializer)) {
              result.reduxUsage.slicesDefined.push(prop.initializer.text);
            }
          }
        }
      }
    }
  }

  /**
   * Extracts route definitions from React Router JSX components.
   *
   * @param result The result object to populate
   * @param routeElement The Route JSX element node
   */
  private extractRouteFromJSX(
    result: ISourceExtractionResult,
    routeElement: ts.JsxElement | ts.JsxSelfClosingElement,
  ): void {
    let path: string | null = null;
    let component: string | null = null;

    const attributes = ts.isJsxSelfClosingElement(routeElement)
      ? routeElement.attributes.properties
      : routeElement.openingElement.attributes.properties;

    for (const attr of attributes) {
      if (!ts.isJsxAttribute(attr)) continue;
      const attrName = attr.name.getText();

      if (attrName === EReactRouter.PATH && attr.initializer) {
        if (ts.isStringLiteral(attr.initializer)) {
          path = attr.initializer.text;
        } else if (
          ts.isJsxExpression(attr.initializer) &&
          attr.initializer.expression &&
          ts.isStringLiteral(attr.initializer.expression)
        ) {
          path = attr.initializer.expression.text;
        }
      }

      // React Router v6: `element={<Foo />}`
      if (
        attrName === EReactRouter.ELEMENT &&
        attr.initializer &&
        ts.isJsxExpression(attr.initializer) &&
        attr.initializer.expression
      ) {
        const expr = attr.initializer.expression;
        if (ts.isJsxSelfClosingElement(expr)) component = expr.tagName.getText();
        else if (ts.isJsxElement(expr)) component = expr.openingElement.tagName.getText();
      }

      // React Router v5 / custom: `component={Foo}`
      if (
        attrName === 'component' &&
        attr.initializer &&
        ts.isJsxExpression(attr.initializer) &&
        attr.initializer.expression &&
        ts.isIdentifier(attr.initializer.expression)
      ) {
        component = attr.initializer.expression.text;
      }
    }

    // Children-as-route pattern: `<PrivateRoute path="/x"><Foo /></PrivateRoute>`
    if (!component && ts.isJsxElement(routeElement)) {
      for (const child of routeElement.children) {
        if (ts.isJsxSelfClosingElement(child)) {
          component = child.tagName.getText();
          break;
        }
        if (ts.isJsxElement(child)) {
          component = child.openingElement.tagName.getText();
          break;
        }
      }
    }

    if (path && component) {
      result.routesDefined.push({
        path,
        component,
        isLazy: false,
        isDynamic: path.includes(':') || path.includes('*'),
      });
    }
  }
}
