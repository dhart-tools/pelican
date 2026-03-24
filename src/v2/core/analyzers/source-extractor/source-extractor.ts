import * as ts from 'typescript';
import { BaseAnalyzer } from "../base";
import { ISourceExtractionResult } from "@v2/types/source-extractor";

/**
 * Analyzer that extracts semantic information from source files using TypeScript's Compiler API.
 */
export class SourceExtractorAnalyzer extends BaseAnalyzer<{ filePath: string; sourceCode: string }, ISourceExtractionResult> {
  name = 'source-extractor';
  version = '1.0.0';

  /**
   * Extracts AST information from the given file content.
   * 
   * @param input The input containing file path and source code
   * @returns A promise resolving to the extracted AST structure
   */
  async extract(input: { filePath: string; sourceCode: string }): Promise<ISourceExtractionResult> {
    const { filePath, sourceCode } = input;

    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

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
        slicesDefined: []
      }
    };

    this.visitNode(sourceFile, result);

    return result;
  }

  /**
   * Stores the extracted AST information into the central registry.
   * 
   * @param output The result of the extraction
   */
  index(output: ISourceExtractionResult): void {
    console.log("Indexing SourceExtractor output:", output.filePath);
  }

  private visitNode(node: ts.Node, result: ISourceExtractionResult): void {
    // Extract imports
    if (ts.isImportDeclaration(node)) {
      this.extractImport(node, result);
    }

    // Extract exports
    if (ts.isExportDeclaration(node)) {
      this.extractExport(node, result);
    }

    // Extract classes
    if (ts.isClassDeclaration(node) && node.name) {
      result.classes.push(node.name.text);
    }

    // Extract functions
    if (ts.isFunctionDeclaration(node) && node.name) {
      result.functions.push(node.name.text);
    }

    // Extract interfaces
    if (ts.isInterfaceDeclaration(node) && node.name) {
      result.interfaces.push(node.name.text);
    }

    // Extract JSX elements
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      this.extractJSXAttributes(node, result);
      
      const tagName = ts.isJsxElement(node) ? node.openingElement.tagName.getText() : node.tagName.getText();
      if (tagName === 'Route') {
        this.extractRouteFromJSX(result, node as ts.JsxSelfClosingElement);
      }
    }

    // Extract JSX text
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text.length > 0) {
        result.jsxTextContent.push(text);
      }
    }

    // Extract function calls (for i18n and Redux)
    if (ts.isCallExpression(node)) {
      this.extractFunctionCalls(node, result);
    }

    // Recursively visit children
    ts.forEachChild(node, (child) => this.visitNode(child, result));
  }

  private extractImport(node: ts.ImportDeclaration, result: ISourceExtractionResult): void {
    const moduleSpecifier = node.moduleSpecifier;
    if (ts.isStringLiteral(moduleSpecifier)) {
      result.imports.push(moduleSpecifier.text);

      // Extract named imports
      if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          result.exports.push(element.name.text);
        }
      }

      // Extract default import
      if (node.importClause?.name) {
        result.exports.push(node.importClause.name.text);
      }
    }
  }

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

  private extractJSXAttributes(
    node: ts.JsxElement | ts.JsxSelfClosingElement,
    result: ISourceExtractionResult
  ): void {
    const attributes = ts.isJsxElement(node)
      ? node.openingElement.attributes
      : node.attributes;

    if (ts.isJsxAttributes(attributes)) {
      for (const attr of attributes.properties) {
        if (ts.isJsxAttribute(attr)) {
          const attrName = attr.name.getText();
          const attrValue = attr.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : "";

          // Check if this is a selector attribute
          const selectorAttrs = ['data-testid', 'data-cy', 'id', 'aria-label'];
          if (selectorAttrs.includes(attrName)) {
            result.selectors.push({ attr: attrName, value: attrValue });
          }
        }
      }
    }
  }

  private getAttributeValue(attr: ts.JsxAttribute): string {
    if (ts.isStringLiteral(attr.initializer)) {
      return attr.initializer.text;
    }
    return '';
  }

  private extractFunctionCalls(node: ts.CallExpression, result: ISourceExtractionResult): void {
    const expr = node.expression;

    // Extract i18n translation keys: t('key'), useTranslation('ns')
    if (ts.isIdentifier(expr)) {
      const name = expr.text;

      // t('key') pattern
      if (name === 't' && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg)) {
          result.translationKeys.push(firstArg.text);
        }
      }

      // useSelector(selectorFn)
      if (name === 'useSelector' && node.arguments.length > 0) {
        const selector = node.arguments[0].getText();
        result.reduxUsage.selectorsUsed.push(selector);
      }

      // dispatch(actionCreator())
      if (name === 'dispatch' && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (ts.isCallExpression(firstArg)) {
          const actionCreator = firstArg.expression.getText();
          result.reduxUsage.actionsDispatched.push(actionCreator);
        }
      }

      // createSelector()
      if (name === 'createSelector') {
        // Extract selectors from arguments
        for (const arg of node.arguments.slice(0, -1)) {
          result.reduxUsage.selectorsUsed.push(arg.getText());
        }
      }
    }

    // createSlice({ name: 'user' })
    if (
      (ts.isPropertyAccessExpression(expr) && expr.name.text === 'createSlice') ||
      (ts.isIdentifier(expr) && expr.text === 'createSlice')
    ) {
      const firstArg = node.arguments[0];
      if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
        for (const prop of firstArg.properties) {
          if (ts.isPropertyAssignment(prop) && prop.name.getText() === 'name') {
            if (ts.isStringLiteral(prop.initializer)) {
              result.reduxUsage.slicesDefined.push(prop.initializer.text);
            }
          }
        }
      }
    }
  }

  private extractRouteFromJSX(
    result: ISourceExtractionResult,
    routeElement: ts.JsxSelfClosingElement
  ): void {
    let path: string | null = null;
    let component: string | null = null;

    for (const attr of routeElement.attributes.properties) {
      if (ts.isJsxAttribute(attr)) {
        const attrName = attr.name.getText();

        if (attrName === 'path' && attr.initializer && ts.isStringLiteral(attr.initializer)) {
          path = attr.initializer.text;
        }

        if (attrName === 'element' && attr.initializer && ts.isJsxExpression(attr.initializer)) {
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
