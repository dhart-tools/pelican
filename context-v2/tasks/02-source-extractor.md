# Task 02: Source Extractor Analyzer

## Overview

Create an analyzer that extracts semantic information from source TypeScript/React files using TypeScript's Compiler API. This analyzer forms the foundation for understanding source code structure and dependencies.

## Objectives

1. Parse TypeScript/React AST to extract exports, imports, functions, classes
2. Extract JSX attributes (data-testid, data-cy, id, aria-label)
3. Extract JSX text content
4. Extract route definitions (react-router-dom patterns)
5. Extract i18n translation keys
6. Extract Redux usage patterns (useSelector, useDispatch, createSlice, etc.)

## Core Types

### Source Extractor Output

```typescript
export interface ISourceExtractionResult {
  filePath: string;
  exports: string[];
  imports: string[];
  classes: string[];
  functions: string[];
  interfaces: string[];
  keywords: string[];

  // JSX mining
  selectors: ISourceSelector[];
  jsxTextContent: string[];
  translationKeys: string[];
  routesDefined: IRouteDef[];

  // Redux usage
  reduxUsage: {
    selectorsUsed: string[];
    actionsDispatched: string[];
    slicesDefined: string[];
  };
}

export interface ISourceSelector {
  attr: string;
  value: string;
}

export interface IRouteDef {
  path: string;
  component: string;
}
```

## Implementation

### 1. Create Source Extractor Analyzer

**File:** `src/analyzers/source-extractor.ts`

```typescript
import * as ts from 'typescript';
import { BaseAnalyzer } from './base';
import { ISourceExtractionResult, ISourceSelector, IRouteDef } from '../core/types';

export class SourceExtractorAnalyzer extends BaseAnalyzer {
  constructor() {
    super({
      name: 'source-extractor',
      version: '1.0.0',
      description: 'Extracts semantic information from source TypeScript/React files',
      dependencies: []
    });
  }

  async analyze(input: {
    filePath: string;
    sourceCode: string;
  }): Promise<ISourceExtractionResult> {
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
    if (ts.isStringLiteral(moduleSpecifier)) {
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
          const attrValue = this.getAttributeValue(attr);

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
    if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'createSlice') {
      const firstArg = node.arguments[0];
      if (ts.isObjectLiteralExpression(firstArg)) {
        for (const prop of firstArg.properties) {
          if (ts.isPropertyAssignment(prop) && prop.name.getText() === 'name') {
            if (ts.isStringLiteral(prop.initializer)) {
              result.reduxUsage.slicesDefined.push(prop.initializer.text);
            }
          }
        }
      }
    }

    // <Route path="/login" element={<LoginPage />} />
    if (ts.isJsxSelfClosingElement(expr)) {
      const tagName = expr.tagName.getText();
      if (tagName === 'Route') {
        this.extractRouteFromJSX(result, expr);
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

        if (attrName === 'path' && ts.isStringLiteral(attr.initializer)) {
          path = attr.initializer.text;
        }

        if (attrName === 'element') {
          component = this.extractComponentFromJSXElement(attr.initializer);
        }
      }
    }

    if (path && component) {
      result.routesDefined.push({ path, component });
    }
  }

  private extractComponentFromJSXElement(node: ts.JsxExpression): string {
    if (ts.isJsxSelfClosingElement(node.expression)) {
      return node.expression.tagName.getText();
    }
    return '';
  }
}
```

### 2. Update Types File

**File:** `src/core/types.ts` (Add to existing)

```typescript
// Add these interfaces to the types.ts file

export interface ISourceExtractionResult {
  filePath: string;
  exports: string[];
  imports: string[];
  classes: string[];
  functions: string[];
  interfaces: string[];
  keywords: string[];

  // JSX mining
  selectors: ISourceSelector[];
  jsxTextContent: string[];
  translationKeys: string[];
  routesDefined: IRouteDef[];

  // Redux usage
  reduxUsage: {
    selectorsUsed: string[];
    actionsDispatched: string[];
    slicesDefined: string[];
  };
}

export interface ISourceSelector {
  attr: string;
  value: string;
}

export interface IRouteDef {
  path: string;
  component: string;
}
```

### 3. Create Helper for File Processing

**File:** `src/analyzers/source-extractor-utils.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { SourceExtractorAnalyzer } from './source-extractor';

export class SourceExtractorHelper {
  private analyzer: SourceExtractorAnalyzer;

  constructor() {
    this.analyzer = new SourceExtractorAnalyzer();
  }

  async extractFromFile(filePath: string): Promise<any> {
    const sourceCode = fs.readFileSync(filePath, 'utf-8');
    return this.analyzer.analyze({ filePath, sourceCode });
  }

  async extractFromDirectory(
    dirPath: string,
    patterns: string[] = ['**/*.ts', '**/*.tsx']
  ): Promise<any[]> {
    const results: any[] = [];

    const files = this.matchFiles(dirPath, patterns);

    for (const file of files) {
      try {
        const result = await this.extractFromFile(file);
        results.push(result);
      } catch (error) {
        console.warn(`Failed to extract from ${file}:`, error);
      }
    }

    return results;
  }

  private matchFiles(dirPath: string, patterns: string[]): string[] {
    // Use glob patterns to find matching files
    // Implementation depends on your preference (glob, fast-glob, etc.)
    // For now, simple implementation
    const files: string[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        files.push(...this.matchFiles(fullPath, patterns));
      } else if (entry.isFile()) {
        for (const pattern of patterns) {
          if (this.matchPattern(entry.name, pattern)) {
            files.push(fullPath);
            break;
          }
        }
      }
    }

    return files;
  }

  private matchPattern(filename: string, pattern: string): boolean {
    // Simple pattern matching
    const regex = new RegExp(
      '^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$'
    );
    return regex.test(filename);
  }
}
```

## Usage Example

```typescript
import { SourceExtractorAnalyzer } from './analyzers/source-extractor';
import { SourceExtractorHelper } from './analyzers/source-extractor-utils';

// Single file
const analyzer = new SourceExtractorAnalyzer();
const result = await analyzer.analyze({
  filePath: 'src/components/LoginForm.tsx',
  sourceCode: fs.readFileSync('src/components/LoginForm.tsx', 'utf-8')
});

console.log(result.selectors);      // [{ attr: 'data-testid', value: 'submit-btn' }]
console.log(result.translationKeys); // ['login.submitButton']
console.log(result.routesDefined);  // []

// Directory
const helper = new SourceExtractorHelper();
const allResults = await helper.extractFromDirectory('src');
```

## Testing Strategy

### Unit Tests

1. **JSX Attribute Extraction**
   - Test data-testid extraction
   - Test data-cy extraction
   - Test ID extraction
   - Test aria-label extraction

2. **Translation Key Extraction**
   - Test t('key') extraction
   - Test useTranslation() patterns

3. **Redux Pattern Extraction**
   - Test useSelector extraction
   - Test useDispatch with action creators
   - Test createSlice detection
   - Test createSelector detection

4. **Route Extraction**
   - Test JSX route extraction
   - Test lazy-loaded routes

### Integration Tests

1. Test extraction from real React components
2. Test extraction from Redux files
3. Test extraction from large codebases

### Test Data

Create test files:

```
tests/fixtures/source-extractor/
  simple-component.tsx
  redux-hook-component.tsx
  i18n-component.tsx
  route-component.tsx
  complex-component.tsx
```

## Example Input/Output

### Input: Login Component

```tsx
// src/pages/LoginPage.tsx
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import { login } from '../store/actions';

export function LoginPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const error = useSelector((state) => state.auth.error);

  return (
    <form>
      <input data-testid="username-input" type="text" />
      <input data-testid="password-input" type="password" />
      <button
        data-testid="submit-btn"
        onClick={() => dispatch(login({ username: 'test' }))}
      >
        {t('login.submitButton')}
      </button>
    </form>
  );
}
```

### Output: Extraction Result

```typescript
{
  filePath: 'src/pages/LoginPage.tsx',
  exports: ['LoginPage'],
  imports: ['react-i18next', 'react-redux', '../store/actions'],
  classes: [],
  functions: ['LoginPage'],
  interfaces: [],
  keywords: [],
  selectors: [
    { attr: 'data-testid', value: 'username-input' },
    { attr: 'data-testid', value: 'password-input' },
    { attr: 'data-testid', value: 'submit-btn' }
  ],
  jsxTextContent: [],
  translationKeys: ['login.submitButton'],
  routesDefined: [],
  reduxUsage: {
    selectorsUsed: ['(state) => state.auth.error'],
    actionsDispatched: ['login'],
    slicesDefined: []
  }
}
```

## Dependencies

- `typescript` (peer dependency)
- Base analyzer system (Task 01)

## Performance Considerations

1. Cache AST parsing results
2. Limit recursion depth
3. Parallelize file processing for directories
4. Use incremental parsing for large files

## Related Tasks

- Task 01: Base Analyzer System
- Task 03: Cypress Extractor Analyzer
- Task 06: Redux Chain Analyzer
- Task 07: i18n Analyzer

## Notes

- This analyzer is core to understanding source code structure
- All other analyzers build upon the metadata extracted here
- JSX attribute extraction respects configured selector strategy