import * as ts from "typescript";
import { BaseAnalyzer } from "@v2/core/analyzers/base";
import { EFunctionCall, ERedux, EReactRouter, EReactComponent, EAnalyzerName } from "@v2/utils/enums";
import { ISourceExtractionResult } from "@v2/types/analyzers";
import { SELECTOR_ATTRIBUTES } from "@v2/utils/constants";

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
  version = "1.0.0";

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
    console.log("Indexing SourceExtractor output:", output.filePath);
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
      if (tagName === EReactComponent.ROUTE) {
        this.extractRouteFromJSX(result, node as ts.JsxSelfClosingElement);
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
    }

    ts.forEachChild(node, (child) => this.visitNode(child, result));
  }

  /**
   * Extracts import information from an import declaration.
   *
   * @param node The import declaration node
   * @param result The result object to populate
   */
  private extractImport(node: ts.ImportDeclaration, result: ISourceExtractionResult): void {
    const moduleSpecifier = node.moduleSpecifier;
    if (ts.isStringLiteral(moduleSpecifier)) {
      result.imports.push(moduleSpecifier.text);

      if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          result.exports.push(element.name.text);
        }
      }

      if (node.importClause?.name) {
        result.exports.push(node.importClause.name.text);
      }
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

          if (SELECTOR_ATTRIBUTES.includes(attrName)) {
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
    if (attr.initializer && ts.isStringLiteral(attr.initializer)) {
      return attr.initializer.text;
    }
    return "";
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
    routeElement: ts.JsxSelfClosingElement,
  ): void {
    let path: string | null = null;
    let component: string | null = null;

    for (const attr of routeElement.attributes.properties) {
      if (ts.isJsxAttribute(attr)) {
        const attrName = attr.name.getText();

        if (
          attrName === EReactRouter.PATH &&
          attr.initializer &&
          ts.isStringLiteral(attr.initializer)
        ) {
          path = attr.initializer.text;
        }

        if (
          attrName === EReactRouter.ELEMENT &&
          attr.initializer &&
          ts.isJsxExpression(attr.initializer)
        ) {
          const jsxExpr = attr.initializer as ts.JsxExpression;
          if (jsxExpr.expression && ts.isJsxSelfClosingElement(jsxExpr.expression)) {
            component = jsxExpr.expression.tagName.getText();
          }
        }
      }
    }

    if (path && component) {
      result.routesDefined.push({ path, component });
    }
  }
}
