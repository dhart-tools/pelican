# Task 08: Route Analyzer

## Overview

Create an analyzer that extracts route definitions from React Router code and builds a mapping between URL patterns and component files. This analyzer enables route-based test matching.

## Objectives

1. Extract route definitions from router files
2. Support JSX route definitions: `<Route path="/login" element={<LoginPage />} />`
3. Support object-based routes: `{ path: "/login", element: <LoginPage /> }`
4. Support lazy-loaded routes
5. Build route map URL → Component mapping
6. Handle dynamic routes `/user/:id`

## Core Types

```typescript
export interface IRouteExtractionResult {
  filePath: string;
  routes: IRouteDef[];
}

export interface IRouteDef {
  path: string;
  component: string;
  componentPath?: string;
  isLazy: boolean;
  isDynamic: boolean;
  metadata?: {
    index?: boolean;
    layout?: string;
    children?: IRouteDef[];
  };
}
```

## Implementation

### 1. Create Route Analyzer

**File:** `src/analyzers/route-analyzer.ts`

```typescript
import * as ts from 'typescript';
import * as path from 'path';
import { BaseAnalyzer } from './base';
import {
  IRouteExtractionResult,
  IRouteDef
} from '../core/types';

export class RouteAnalyzer extends BaseAnalyzer {
  constructor() {
    super({
      name: 'route-analyzer',
      version: '1.0.0',
      description: 'Extracts route definitions and builds route map',
      dependencies: ['source-extractor']
    });
  }

  async analyze(input: {
    filePath: string;
    sourceCode: string;
    routerFile: string;
  }): Promise<IRouteExtractionResult> {
    const { filePath, sourceCode, routerFile } = input;

    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    const result: IRouteExtractionResult = {
      filePath,
      routes: []
    };

    this.visitNode(sourceFile, result, path.dirname(filePath));

    return result;
  }

  buildRouteMap(extractions: IRouteExtractionResult[]): Map<string, string> {
    const routeMap = new Map<string, string>();

    for (const extraction of extractions) {
      for (const route of extraction.routes) {
        if (route.componentPath) {
          routeMap.set(route.path, route.componentPath);
        }
      }
    }

    return routeMap;
  }

  private visitNode(node: ts.Node, result: IRouteExtractionResult, baseDir: string): void {
    // Detect JSX Route elements
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) {
      this.extractRouteFromJSX(node, result, baseDir);
    }

    // Detect object-based routes in arrays
    if (ts.isArrayLiteralExpression(node)) {
      this.extractRoutesFromArray(node, result, baseDir);
    }

    // Recursively visit children
    ts.forEachChild(node, (child) => this.visitNode(child, result, baseDir));
  }

  private extractRouteFromJSX(
    node: ts.JsxSelfClosingElement | ts.JsxElement,
    result: IRouteExtractionResult,
    baseDir: string
  ): void {
    const openingElement = ts.isJsxSelfClosingElement(node)
      ? node
      : node.openingElement;

    const tagName = openingElement.tagName.getFullText().trim();

    if (tagName !== 'Route' && tagName !== 'route') {
      return;
    }

    let routePath: string | null = null;
    let componentName: string | null = null;
    let isLazy = false;
    let componentPath: string | undefined;
    let isIndex = false;
    let hasChildren = false;

    for (const attr of openingElement.attributes.properties) {
      if (!ts.isJsxAttribute(attr)) continue;

      const attrName = attr.name.getText();

      if (attrName === 'path') {
        if (ts.isStringLiteral(attr.initializer)) {
          routePath = attr.initializer.text;
        }
      }

      if (attrName === 'element') {
        const componentExpr = this.unwrapJsxExpression(attr.initializer);
        componentName = this.extractComponentName(componentExpr);
        componentPath = this.extractComponentPath(componentExpr, baseDir, isLazy);
      }

      if (attrName === 'component') {
        const componentExpr = this.unwrapJsxExpression(attr.initializer);
        componentName = this.extractComponentName(componentExpr);
      }

      if (attrName === 'lazy') {
        isLazy = true;
        const lazyExpr = this.unwrapJsxExpression(attr.initializer);
        componentPath = this.extractLazyComponentPath(lazyExpr, baseDir);
      }

      if (attrName === 'index') {
        isIndex = true;
      }
    }

    // Check for nested routes in JSxElement
    if (ts.isJsxElement(node)) {
      hasChildren = node.children.some((child) =>
        ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)
      );
    }

    if (routePath && componentName) {
      result.routes.push({
        path: routePath,
        component: componentName,
        componentPath,
        isLazy,
        isDynamic: this.isDynamicRoute(routePath),
        metadata: {
          index: isIndex,
          children: hasChildren ? [] : undefined
        }
      });
    }
  }

  private extractRoutesFromArray(
    node: ts.ArrayLiteralExpression,
    result: IRouteExtractionResult,
    baseDir: string
  ): void {
    for (const element of node.elements) {
      if (ts.isObjectLiteralExpression(element)) {
        const route = this.extractRouteFromObject(element, baseDir);
        if (route) {
          result.routes.push(route);
        }
      }
    }
  }

  private extractRouteFromObject(obj: ts.ObjectLiteralExpression, baseDir: string): IRouteDef | null {
    let routePath: string | null = null;
    let componentName: string | null = null;
    let isLazy = false;
    let componentPath: string | undefined;
    let isIndex = false;
    let layout: string | undefined;

    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;

      const propName = prop.name.getText();

      if (propName === 'path' && ts.isStringLiteral(prop.initializer)) {
        routePath = prop.initializer.text;
      }

      if (propName === 'element') {
        componentName = this.extractComponentName(prop.initializer);
        componentPath = this.extractComponentPath(prop.initializer, baseDir, isLazy);
      }

      if (propName === 'component') {
        componentName = this.extractComponentName(prop.initializer);
      }

      if (propName === 'lazy') {
        isLazy = true;
        componentPath = this.extractLazyComponentPath(prop.initializer, baseDir);
      }

      if (propName === 'index') {
        isIndex = this.isTrue(prop.initializer);
      }

      if (propName === 'element' && ts.isCallExpression(prop.initializer)) {
        // Check for wrapper components like <Layout><Route ... /></Layout>
        layout = this.detectLayoutComponent(prop.initializer);
      }
    }

    if (routePath && componentName) {
      return {
        path: routePath,
        component: componentName,
        componentPath,
        isLazy,
        isDynamic: this.isDynamicRoute(routePath),
        metadata: {
          index: isIndex,
          layout
        }
      };
    }

    return null;
  }

  private unwrapJsxExpression(node: ts.JsxExpression): ts.Expression | undefined {
    return ts.isJsxExpression(node) ? node.expression : undefined;
  }

  private extractComponentName(expr: ts.Expression | undefined): string | null {
    if (!expr) return null;

    // <Component />
    if (ts.isJsxSelfClosingElement(expr)) {
      return expr.tagName.getText();
    }

    // <Component>children</Component>
    if ((ts.isJsxElement(expr))) {
      const tagName = expr.openingElement.tagName;
      return tagName ? tagName.getText() : null;
    }

    // Component variable
    if (ts.isIdentifier(expr)) {
      return expr.text;
    }

    return null;
  }

  private extractComponentPath(
    expr: ts.Expression | undefined,
    baseDir: string,
    isLazy: boolean
  ): string | undefined {
    if (!expr) return undefined;

    // Handle direct import: import('./pages/Login')
    if (ts.isCallExpression(expr)) {
      if (this.isImportCall(expr) && expr.arguments.length > 0) {
        const arg = expr.arguments[0];
        if (ts.isStringLiteral(arg)) {
          return path.resolve(baseDir, arg.text).replace(/\.tsx?$/, '.ts');
        }
      }
    }

    // For lazy routes, try to resolve the import
    if (isLazy && ts.isCallExpression(expr)) {
      const importExpr = this.extractImportExpression(expr);
      if (importExpr) {
        return path.resolve(baseDir, importExpr).replace(/\.tsx?$/, '.ts');
      }
    }

    return undefined;
  }

  private extractLazyComponentPath(expr: ts.Expression | undefined, baseDir: string): string | undefined {
    // lazy: () => import('./pages/Login')
    if (!expr) return undefined;

    if (ts.isArrowFunction(expr)) {
      const body = expr.body;
      if (ts.isCallExpression(body) && this.isImportCall(body)) {
        const arg = body.arguments[0];
        if (ts.isStringLiteral(arg)) {
          return path.resolve(baseDir, arg.text).replace(/\.tsx?$/, '.ts');
        }
      }
    }

    return undefined;
  }

  private isImportCall(node: ts.CallExpression): boolean {
    const expr = node.expression;
    return ts.isIdentifier(expr) && expr.text === 'import';
  }

  private extractImportExpression(node: ts.CallExpression): string | undefined {
    // Look for import('./path') inside arrow function or call
    for (const arg of node.arguments) {
      if (ts.isCallExpression(arg) && this.isImportCall(arg)) {
        const importArg = arg.arguments[0];
        if (ts.isStringLiteral(importArg)) {
          return importArg.text;
        }
      }
    }

    return undefined;
  }

  private isDynamicRoute(path: string): boolean {
    // /user/:id, /posts/:postId, /product/*
    return /:(\w+)|\*/.test(path);
  }

  private isTrue(node: ts.Expression): boolean {
    return (
      ts.isTrueKeyword(node) ||
      (ts.isStringLiteral(node) && node.text === 'true') ||
      (ts.isNumericLiteral(node) && node.text !== '0')
    );
  }

  private detectLayoutComponent(node: ts.CallExpression): string | undefined {
    // Detect: <Layout component={Component} />
    // or: createBrowserRouter([...], { wrapper: Layout })

    for (const arg of node.arguments) {
      if (ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (ts.isPropertyAssignment(prop) && prop.name.getText() === 'wrapper') {
            return this.extractComponentName(prop.initializer) || undefined;
          }
        }
      }
    }

    return undefined;
  }
}
```

### 2. Update Types File

**File:** `src/core/types.ts` (Add to existing)

```typescript
// Add these types

export interface IRouteExtractionResult {
  filePath: string;
  routes: IRouteDef[];
}

export interface IRouteDef {
  path: string;
  component: string;
  componentPath?: string;
  isLazy: boolean;
  isDynamic: boolean;
  metadata?: {
    index?: boolean;
    layout?: string;
    children?: IRouteDef[];
  };
}
```

## Usage Example

```typescript
import { RouteAnalyzer } from './analyzers/route-analyzer';

const analyzer = new RouteAnalyzer();

const result = await analyzer.analyze({
  filePath: 'src/App.tsx',
  sourceCode: fs.readFileSync('src/App.tsx', 'utf-8'),
  routerFile: 'src/App.tsx'
});

console.log(result.routes);
// [
//   {
//     path: '/',
//     component: 'HomePage',
//     componentPath: 'src/pages/HomePage.ts',
//     isLazy: false,
//     isDynamic: false
//   },
//   {
//     path: '/user/:id',
//     component: 'UserProfile',
//     componentPath: 'src/pages/UserProfile.ts',
//     isLazy: true,
//     isDynamic: true
//   }
// ]

// Build route map
const routeMap = analyzer.buildRouteMap([result]);
console.log(routeMap);
// Map {
//   '/' => 'src/pages/HomePage.ts',
//   '/user/:id' => 'src/pages/UserProfile.ts'
// }
```

## Example Input/Output

### Input: Router File

```tsx
// src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/user/:id"
          lazy={() => import('./pages/UserProfile')}
        />
        <Route path="/dashboard/*" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### Output: Route Extraction

```typescript
{
  filePath: 'src/App.tsx',
  routes: [
    {
      path: '/',
      component: 'HomePage',
      componentPath: undefined,
      isLazy: false,
      isDynamic: false
    },
    {
      path: '/login',
      component: 'LoginPage',
      componentPath: undefined,
      isLazy: false,
      isDynamic: false
    },
    {
      path: '/user/:id',
      component: 'UserProfile',
      componentPath: 'src/pages/UserProfile.ts',
      isLazy: true,
      isDynamic: true
    },
    {
      path: '/dashboard/*',
      component: 'DashboardPage',
      componentPath: undefined,
      isLazy: false,
      isDynamic: true
    }
  ]
}
```

## Dynamic Route Matching

For dynamic routes, the analyzer supports prefix matching:

```typescript
// Test visits /user/123
// Route: /user/:id

function matchRoute(visitedRoute: string, routePattern: string): boolean {
  if (!routePattern.includes(':') && !routePattern.includes('*')) {
    return visitedRoute === routePattern;
  }

  // Convert pattern to regex
  const regexPattern = '^' + routePattern
    .replace(/:\w+/g, '[^/]+')
    .replace(/\*/g, '.*') + '$';

  return new RegExp(regexPattern).test(visitedRoute);
}

// matchRoute('/user/123', '/user/:id') → true
// matchRoute('/user/john', '/user/:id') → true
// matchRoute('/user', '/user/:id') → false
```

## Testing Strategy

### Unit Tests

1. **JSX Route Extraction**
   - Test simple routes
   - Test lazy routes
   - Test index routes
   - Test dynamic routes

2. **Object-Based Routes**
   - Test route objects
   - Test nested route arrays
   - Test layout routes

3. **Component Extraction**
   - Test component name extraction
   - Test component path extraction
   - Test lazy import extraction

### Integration Tests

1. Test with real router files
2. Test route map building
3. Test dynamic route matching

## Dependencies

- `typescript` (peer dependency)
- `react-router-dom` (analyzed dependency)
- Base analyzer system (Task 01)

## Related Tasks

- Task 01: Base Analyzer System
- Task 02: Source Extractor Analyzer
- Task 05: Scoring Engine (route-match scorer)

## Notes

- Route mapping enables transitive test matching via visited routes
- Dynamic routes use prefix matching
- Lazy routes need component path extraction for full accuracy
- Layout routes impact multiple child routes