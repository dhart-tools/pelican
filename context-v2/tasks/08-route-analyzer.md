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
7. Support `createBrowserRouter` / `createHashRouter` object-based route configs
8. Recursively extract nested `children` routes and stitch full paths
9. Resolve `componentPath` for non-lazy routes by cross-referencing import statements
10. Handle index routes (routes with no `path`, only `index: true`)
11. Fix attribute ordering bug for `isLazy` flag
12. Deduplicate route map entries with warnings on conflict
13. Resolve path aliases (`@/`, `@pages/`, `~/`, custom) from `tsconfig.json`, `vite.config.ts`, and `webpack.config.js`

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

// IImportMap
// Maps a component's local identifier name → its resolved ABSOLUTE file path.
//
// Built by buildImportMap() by scanning all ImportDeclaration nodes at the top
// of the file. The AliasResolver is applied at build time, so aliased paths are
// already expanded to absolute paths before being stored here.
//
// Example (relative import):
//   import HomePage from './pages/HomePage'
//   → { HomePage: '/project/src/pages/HomePage' }
//
// Example (aliased import, alias '@' → '/project/src'):
//   import HomePage from '@/pages/HomePage'
//   → { HomePage: '/project/src/pages/HomePage' }   ← same result, alias expanded
export interface IImportMap {
  [componentName: string]: string; // component name → absolute resolved path
}

// IAliasMap
// A flat map of alias prefix → absolute directory it points to.
// Built by AliasResolver from tsconfig / vite / webpack config files,
// then optionally extended/overridden by the user via IAliasResolverConfig.
//
// Keys are the alias prefix WITHOUT trailing slash or glob (/* stripped).
// Values are absolute filesystem paths to the target directory.
//
// Examples:
//   { '@':           '/project/src' }
//     → import X from '@/pages/Home'    resolves to /project/src/pages/Home
//
//   { '@pages':      '/project/src/pages' }
//     → import X from '@pages/Login'    resolves to /project/src/pages/Login
//
//   { '~':           '/project/src' }
//     → import X from '~/utils/format'  resolves to /project/src/utils/format
//
//   { '@utils':      '/project/src/utils',
//     '@components': '/project/src/components' }
//     → multiple aliases, longest prefix matched first to avoid ambiguity
export interface IAliasMap {
  [aliasPrefix: string]: string; // alias prefix (no trailing /) → absolute fs path
}

// IAliasResolverConfig
// Passed to RouteAnalyzer.extract() via the aliasConfig field to control
// how aliases are detected and resolved.
//
// Fields:
//   projectRoot  — Absolute path to the project root. Used to locate config
//                  files (tsconfig.json, vite.config.ts, webpack.config.js)
//                  and to resolve relative alias targets found inside them.
//                  Default: directory of the file being analyzed.
//
//   aliases      — User-supplied alias overrides. Merged LAST so they always
//                  win over anything auto-detected from config files.
//                  Values may be relative (resolved against projectRoot)
//                  or absolute.
//                  Example: { '@': 'src', '@utils': 'src/utils' }
//
//   configFiles  — Which config file(s) to read aliases from.
//                  Default: ['tsconfig', 'vite', 'webpack']
//                  Pass [] to skip all auto-detection and rely only on aliases.
export interface IAliasResolverConfig {
  projectRoot?: string;
  aliases?: Record<string, string>;
  configFiles?: Array<'tsconfig' | 'vite' | 'webpack'>;
}
```

## Implementation

### 1. Create Alias Resolver

**File:** `src/analyzers/alias-resolver.ts`

The `AliasResolver` is a standalone class responsible for one job: turning an
aliased import specifier into an absolute filesystem path. It is constructed
once per file analysis and passed into `buildImportMap`.

```typescript
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { IAliasMap, IAliasResolverConfig } from '@v2/types/analyzers';

export class AliasResolver {
  private aliasMap: IAliasMap = {};

  constructor(config: IAliasResolverConfig = {}) {
    const {
      projectRoot = process.cwd(),
      aliases = {},
      configFiles = ['tsconfig', 'vite', 'webpack'],
    } = config;

    // Load from each config source in order. Later entries overwrite earlier ones.
    // User-supplied aliases are merged last so they always win.
    if (configFiles.includes('tsconfig')) this.mergeAliases(this.loadFromTsConfig(projectRoot));
    if (configFiles.includes('vite'))     this.mergeAliases(this.loadFromViteConfig(projectRoot));
    if (configFiles.includes('webpack'))  this.mergeAliases(this.loadFromWebpackConfig(projectRoot));

    // User overrides — highest priority
    const resolved: IAliasMap = {};
    for (const [prefix, target] of Object.entries(aliases)) {
      resolved[prefix] = path.isAbsolute(target) ? target : path.resolve(projectRoot, target);
    }
    this.mergeAliases(resolved);
  }

  // ---------------------------------------------------------------------------
  // resolve(specifier)
  // ---------------------------------------------------------------------------
  // Expands an aliased import specifier to an absolute path.
  // Relative and absolute specifiers pass through unchanged.
  //
  // How prefix matching works:
  //   Prefixes are sorted longest-first to avoid '@' swallowing '@pages'.
  //   For each prefix we check two conditions:
  //     (a) exact match:        specifier === prefix
  //     (b) prefix + '/':       specifier.startsWith(prefix + '/')
  //   If (b), the prefix and its trailing slash are stripped and the remainder
  //   is joined onto the target directory with path.join.
  //
  // Examples (aliasMap = { '@': '/project/src', '@pages': '/project/src/pages' }):
  //   resolve('@/pages/HomePage')  → '/project/src/pages/HomePage'
  //   resolve('@pages/Login')       → '/project/src/pages/Login'     ← longer prefix wins
  //   resolve('~/utils/format')     → '~/utils/format'               ← no match, unchanged
  //   resolve('./pages/HomePage')   → './pages/HomePage'              ← relative, unchanged
  //   resolve('react')              → 'react'                         ← third-party, unchanged
  resolve(specifier: string): string {
    if (specifier.startsWith('.') || specifier.startsWith('/')) return specifier;

    const sortedPrefixes = Object.keys(this.aliasMap).sort((a, b) => b.length - a.length);

    for (const prefix of sortedPrefixes) {
      const target = this.aliasMap[prefix];
      if (specifier === prefix) return target;
      if (specifier.startsWith(prefix + '/')) {
        const remainder = specifier.slice(prefix.length + 1);
        return path.join(target, remainder);
      }
    }

    return specifier; // no alias matched
  }

  getAliasMap(): IAliasMap { return { ...this.aliasMap }; }

  // ---------------------------------------------------------------------------
  // loadFromTsConfig
  // ---------------------------------------------------------------------------
  // Reads compilerOptions.paths from tsconfig.json using the TS compiler API
  // (which handles comments and trailing commas that JSON.parse would reject).
  //
  // tsconfig format:
  //   "baseUrl": ".",
  //   "paths": {
  //     "@/*":      ["src/*"],       ← glob — strip trailing /*
  //     "@pages/*": ["src/pages/*"],
  //     "@utils":   ["src/utils/index"] ← non-glob, kept as-is
  //   }
  //
  // The baseUrl is resolved to an absolute path and used as the root for all
  // relative path targets. The trailing /* is stripped from both key and value
  // because AliasResolver handles the remainder itself in resolve().
  //
  // Example output for the above:
  //   { '@': '/project/src', '@pages': '/project/src/pages', '@utils': '/project/src/utils/index' }
  private loadFromTsConfig(projectRoot: string): IAliasMap {
    const configPath = path.join(projectRoot, 'tsconfig.json');
    if (!fs.existsSync(configPath)) return {};

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const { config, error } = ts.parseConfigFileTextToJson(configPath, raw);
      if (error || !config?.compilerOptions?.paths) return {};

      const baseUrl = config.compilerOptions.baseUrl ?? '.';
      const absBaseUrl = path.resolve(projectRoot, baseUrl);
      const paths: Record<string, string[]> = config.compilerOptions.paths;
      const result: IAliasMap = {};

      for (const [key, values] of Object.entries(paths)) {
        if (!Array.isArray(values) || values.length === 0) continue;
        const prefix = key.replace(/\/\*$/, '');
        const targetRel = (values[0] as string).replace(/\/\*$/, '');
        result[prefix] = path.resolve(absBaseUrl, targetRel);
      }

      return result;
    } catch {
      console.warn('[AliasResolver] Failed to parse tsconfig.json');
      return {};
    }
  }

  // ---------------------------------------------------------------------------
  // loadFromViteConfig
  // ---------------------------------------------------------------------------
  // Reads resolve.alias from vite.config.ts / vite.config.js using regex,
  // because the file is TypeScript and cannot be require()'d at runtime.
  //
  // Handles three common Vite alias formats:
  //
  //   Format A — object shorthand with path.resolve:
  //     resolve: { alias: { '@': path.resolve(__dirname, 'src') } }
  //
  //   Format B — array format with path.resolve:
  //     resolve: { alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }] }
  //
  //   Format C — array format with plain string:
  //     resolve: { alias: [{ find: '@', replacement: '/absolute/path' }] }
  //
  // Limitation: Only statically analyzable (literal string) alias values are
  // extracted. Computed aliases (env vars, conditional logic) are not supported
  // — use IAliasResolverConfig.aliases to supply them manually.
  private loadFromViteConfig(projectRoot: string): IAliasMap {
    const candidates = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'];
    let raw = '';
    for (const name of candidates) {
      const p = path.join(projectRoot, name);
      if (fs.existsSync(p)) { raw = fs.readFileSync(p, 'utf-8'); break; }
    }
    if (!raw) return {};

    const result: IAliasMap = {};
    try {
      // Format A: '@': path.resolve(__dirname, 'src')
      const objPattern = /['"]([^'"]+)['"]\s*:\s*path\.(?:resolve|join)\s*\([^,)]+,\s*['"]([^'"]+)['"]\)/g;
      let m: RegExpExecArray | null;
      while ((m = objPattern.exec(raw)) !== null) {
        result[m[1].replace(/\/\*$/, '')] = path.resolve(projectRoot, m[2].replace(/\/\*$/, ''));
      }
      // Format B: find: '@', replacement: path.resolve(__dirname, 'src')
      const arrPattern = /find\s*:\s*['"]([^'"]+)['"]\s*,\s*replacement\s*:\s*path\.(?:resolve|join)\s*\([^,)]+,\s*['"]([^'"]+)['"]\)/g;
      while ((m = arrPattern.exec(raw)) !== null) {
        result[m[1].replace(/\/\*$/, '')] = path.resolve(projectRoot, m[2].replace(/\/\*$/, ''));
      }
      // Format C: find: '@', replacement: '/abs/or/relative'
      const strPattern = /find\s*:\s*['"]([^'"]+)['"]\s*,\s*replacement\s*:\s*['"]([^'"]+)['"]/g;
      while ((m = strPattern.exec(raw)) !== null) {
        result[m[1].replace(/\/\*$/, '')] = path.resolve(projectRoot, m[2].replace(/\/\*$/, ''));
      }
    } catch {
      console.warn('[AliasResolver] Failed to parse vite config');
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // loadFromWebpackConfig
  // ---------------------------------------------------------------------------
  // Reads resolve.alias from webpack.config.js / webpack.config.ts using regex.
  //
  // Webpack alias format:
  //   resolve: {
  //     alias: {
  //       '@':           path.resolve(__dirname, 'src/'),
  //       '@components': path.resolve(__dirname, 'src/components/'),
  //     }
  //   }
  //
  // Trailing slashes in webpack alias targets are stripped because AliasResolver
  // re-adds the path separator in resolve().
  private loadFromWebpackConfig(projectRoot: string): IAliasMap {
    const candidates = ['webpack.config.js', 'webpack.config.ts', 'webpack.config.mjs'];
    let raw = '';
    for (const name of candidates) {
      const p = path.join(projectRoot, name);
      if (fs.existsSync(p)) { raw = fs.readFileSync(p, 'utf-8'); break; }
    }
    if (!raw) return {};

    const result: IAliasMap = {};
    try {
      const pattern = /['"]([^'"]+)['"]\s*:\s*path\.(?:resolve|join)\s*\([^,)]+,\s*['"]([^'"]+)['"]\)/g;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(raw)) !== null) {
        result[m[1].replace(/\/?$/, '')] = path.resolve(projectRoot, m[2].replace(/\/?$/, ''));
      }
    } catch {
      console.warn('[AliasResolver] Failed to parse webpack config');
    }
    return result;
  }

  private mergeAliases(incoming: IAliasMap): void {
    Object.assign(this.aliasMap, incoming);
  }
}
```

### 2. Update Route Analyzer

**File:** `src/analyzers/route-analyzer.ts`

Two methods change: `extract()` (builds the resolver and passes it to
`buildImportMap`) and `buildImportMap()` (uses the resolver to expand aliases
before storing paths). Everything else is unchanged.

```typescript
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

import { BaseAnalyzer } from '@v2/core/analyzers/base';
import {
  IRouteExtractionResult,
  IRouteDef,
  IImportMap,
  IAliasResolverConfig,
} from '@v2/types/analyzers';
import { EAnalyzerName } from '@v2/utils/enums';
import { AliasResolver } from './alias-resolver';

export class RouteAnalyzer extends BaseAnalyzer<
  { filePath: string; sourceCode: string; aliasConfig?: IAliasResolverConfig },
  IRouteExtractionResult
> {
  name = EAnalyzerName.ROUTE_ANALYZER;
  version = '1.0.0';
  dependencies = [EAnalyzerName.SOURCE_EXTRACTOR];

  private processedNodes = new Set<ts.Node>();

  /**
   * Orchestrates the extraction of routes from a source file.
   *
   * @param input.filePath     Path to the file being analyzed.
   * @param input.sourceCode   Raw source code of the file.
   * @param input.aliasConfig  Optional alias resolver configuration.
   *                           If omitted, aliases are auto-detected from
   *                           tsconfig / vite / webpack relative to the file.
   */
  async extract(input: {
    filePath: string;
    sourceCode: string;
    aliasConfig?: IAliasResolverConfig;
  }): Promise<IRouteExtractionResult> {
    const { filePath, sourceCode, aliasConfig } = input;
    this.processedNodes.clear();

    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    const result: IRouteExtractionResult = { filePath, routes: [] };

    // ─── STEP 1: Build alias resolver ────────────────────────────────────────
    // projectRoot defaults to the directory of the file being analyzed.
    // This is a reasonable fallback for monorepos — each package tends to have
    // its own tsconfig.json / vite.config.ts in its own directory.
    const resolver = new AliasResolver({
      projectRoot: aliasConfig?.projectRoot ?? path.dirname(filePath),
      ...aliasConfig,
    });

    // ─── STEP 2: Build import map ─────────────────────────────────────────────
    // Aliases are expanded to absolute paths at this stage, so downstream
    // resolveComponentPath does not need to know about aliases at all.
    const importMap = this.buildImportMap(sourceFile, resolver, path.dirname(filePath));

    // ─── STEP 3: Walk the AST and extract routes ──────────────────────────────
    this.visitNode(sourceFile, result, path.dirname(filePath), importMap);

    return result;
  }

  // ... buildRouteMap, index, visitNode, extractRouteFromJSX,
  //     extractRoutesFromRouterCall, extractRoutesFromArray,
  //     extractRouteFromObject — all unchanged from previous version ...

  // ---------------------------------------------------------------------------
  // buildImportMap  (UPDATED — alias-aware)
  // ---------------------------------------------------------------------------
  // Same structure as before, but now every module specifier is passed through
  // AliasResolver.resolve() before the local-path filter and before storage.
  //
  // Key change — the filter for local paths:
  //
  //   BEFORE:
  //     if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) continue;
  //     // ← Aliased imports like '@/pages/Home' were dropped here. Bug.
  //
  //   AFTER:
  //     const resolvedSpecifier = resolver.resolve(rawSpecifier);
  //     if (!resolvedSpecifier.startsWith('.') && !resolvedSpecifier.startsWith('/')) continue;
  //     // ← After resolution, '@/pages/Home' → '/project/src/pages/Home' → kept.
  //     // ← Unresolved third-party ('react') → 'react' → still dropped. Correct.
  //
  // Key change — stored value:
  //
  //   BEFORE: importMap[name] = './pages/HomePage'   (relative specifier)
  //   AFTER:  importMap[name] = '/project/src/pages/HomePage'  (absolute path)
  //
  // This means resolveComponentPath no longer needs baseDir for Strategy 1 —
  // the path is already absolute.
  private buildImportMap(
    sourceFile: ts.SourceFile,
    resolver: AliasResolver,
    baseDir: string
  ): IImportMap {
    const importMap: IImportMap = {};

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const moduleSpecifier = statement.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) continue;

      const rawSpecifier = moduleSpecifier.text;

      // Expand alias (no-op for relative/absolute paths)
      const resolvedSpecifier = resolver.resolve(rawSpecifier);

      // After expansion, if still not a local path → third-party, skip
      if (!resolvedSpecifier.startsWith('.') && !resolvedSpecifier.startsWith('/')) continue;

      // Convert to absolute so we don't need baseDir in resolveComponentPath
      const absolutePath = path.isAbsolute(resolvedSpecifier)
        ? resolvedSpecifier
        : path.resolve(baseDir, resolvedSpecifier);

      const clause = statement.importClause;
      if (!clause) continue;

      if (clause.name) {
        importMap[clause.name.text] = absolutePath;
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          importMap[element.name.text] = absolutePath;
        }
      }
    }

    return importMap;
  }

  // ---------------------------------------------------------------------------
  // resolveComponentPath  (UPDATED — no baseDir needed for Strategy 1)
  // ---------------------------------------------------------------------------
  // Strategy 1 is now simpler: importMap already holds absolute paths, so we
  // just normalise the extension and return. No path.resolve() needed.
  //
  // Strategy 2 (inline import() call) is unchanged — it still resolves against
  // baseDir. Aliased dynamic imports (e.g. lazy(() => import('@/pages/Login')))
  // are NOT expanded here. See Known Limitations.
  private resolveComponentPath(
    componentName: string | null,
    expr: ts.Expression | undefined,
    baseDir: string,
    importMap: IImportMap,
    isLazy: boolean
  ): string | undefined {
    // Strategy 1: import map (absolute, alias already expanded)
    if (componentName && importMap[componentName]) {
      return importMap[componentName].replace(/\.tsx?$/, '') + '.ts';
    }

    // Strategy 2: inline import() call (relative paths only)
    if (expr && ts.isCallExpression(expr) && this.isImportCall(expr) && expr.arguments.length > 0) {
      const arg = expr.arguments[0];
      if (ts.isStringLiteral(arg)) {
        return path.resolve(baseDir, arg.text).replace(/\.tsx?$/, '') + '.ts';
      }
    }

    return undefined;
  }

  // extractLazyComponentPath, isImportCall, extractComponentName,
  // unwrapJsxExpression, isDynamicRoute — all unchanged
}
```

### 3. Update Types File

**File:** `src/types/analyzers.ts` (add to existing)

```typescript
import * as ts from 'typescript';
import * as path from 'path';
import { BaseAnalyzer } from './base';
import {
  IRouteExtractionResult,
  IRouteDef,
  IImportMap
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

    // STEP 1: Build import map FIRST so we can resolve componentPath
    // for non-lazy routes that are imported at the top of the file.
    // Example: import HomePage from './pages/HomePage'
    // → importMap = { HomePage: './pages/HomePage' }
    const importMap = this.buildImportMap(sourceFile);

    // STEP 2: Walk the AST and extract all routes
    this.visitNode(sourceFile, result, path.dirname(filePath), importMap);

    return result;
  }

  // ---------------------------------------------------------------------------
  // buildRouteMap
  // ---------------------------------------------------------------------------
  // Converts an array of IRouteExtractionResult into a flat Map<path, componentPath>.
  // If two files define the same route path, the last one wins and a warning is logged.
  //
  // Example:
  //   Input:  [{ filePath: 'App.tsx', routes: [{ path: '/', componentPath: 'pages/Home.ts' }] }]
  //   Output: Map { '/' => 'pages/Home.ts' }
  buildRouteMap(extractions: IRouteExtractionResult[]): Map<string, string> {
    const routeMap = new Map<string, string>();

    for (const extraction of extractions) {
      for (const route of extraction.routes) {
        if (route.componentPath) {
          if (routeMap.has(route.path)) {
            // Two different files claim the same path. Warn and keep last.
            console.warn(
              `[RouteAnalyzer] Duplicate route path "${route.path}" found in ` +
              `"${extraction.filePath}". Overwriting previous entry.`
            );
          }
          routeMap.set(route.path, route.componentPath);
        }
      }
    }

    return routeMap;
  }

  // ---------------------------------------------------------------------------
  // buildImportMap  (NEW)
  // ---------------------------------------------------------------------------
  // Scans all ImportDeclaration nodes at the top of the file and builds a map
  // from the local identifier name to the module specifier string.
  //
  // Handles:
  //   import HomePage from './pages/HomePage'
  //     → { HomePage: './pages/HomePage' }
  //
  //   import { LoginPage } from './pages/LoginPage'
  //     → { LoginPage: './pages/LoginPage' }
  //
  //   import DashboardPage, { DashboardHeader } from './pages/Dashboard'
  //     → { DashboardPage: './pages/Dashboard', DashboardHeader: './pages/Dashboard' }
  //
  // Does NOT include:
  //   import * as React from 'react'         (namespace imports, not components)
  //   import 'styles.css'                    (side-effect imports)
  //   import { BrowserRouter } from 'react-router-dom' (third-party, no local path)
  private buildImportMap(sourceFile: ts.SourceFile): IImportMap {
    const importMap: IImportMap = {};

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;

      const moduleSpecifier = statement.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) continue;

      const modulePath = moduleSpecifier.text;

      // Skip third-party imports (they don't start with . or /)
      // e.g. 'react', 'react-router-dom', 'lodash'
      if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) continue;

      const clause = statement.importClause;
      if (!clause) continue;

      // Default import: import HomePage from './pages/HomePage'
      if (clause.name) {
        importMap[clause.name.text] = modulePath;
      }

      // Named imports: import { LoginPage, RegisterPage } from './pages/auth'
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          importMap[element.name.text] = modulePath;
        }
      }
    }

    return importMap;
  }

  // ---------------------------------------------------------------------------
  // visitNode
  // ---------------------------------------------------------------------------
  // Recursively walks the AST. Three things are detected at each node:
  //   1. JSX <Route> elements
  //   2. Array literals (which may be createBrowserRouter route configs)
  //   3. createBrowserRouter / createHashRouter call expressions (NEW)
  private visitNode(
    node: ts.Node,
    result: IRouteExtractionResult,
    baseDir: string,
    importMap: IImportMap
  ): void {
    try {
      // Detect JSX Route elements: <Route path="/" element={<Home />} />
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) {
        this.extractRouteFromJSX(node, result, baseDir, importMap);
      }

      // Detect createBrowserRouter([...]) or createHashRouter([...]) (NEW)
      // This is more reliable than catching any ArrayLiteralExpression because
      // we anchor the array to the router creation call.
      if (ts.isCallExpression(node)) {
        this.extractRoutesFromRouterCall(node, result, baseDir, importMap);
      }

      // Detect standalone array literals (fallback for cases where the array
      // is defined separately and passed to createBrowserRouter later)
      if (ts.isArrayLiteralExpression(node)) {
        this.extractRoutesFromArray(node, result, baseDir, importMap, '');
      }
    } catch (err) {
      // Do not let a single malformed node crash the entire analysis.
      // Log and continue to the next node.
      console.warn(`[RouteAnalyzer] Failed to process node at pos ${node.pos}: ${err}`);
    }

    // Recursively visit children regardless of errors above
    ts.forEachChild(node, (child) =>
      this.visitNode(child, result, baseDir, importMap)
    );
  }

  // ---------------------------------------------------------------------------
  // extractRoutesFromRouterCall  (NEW)
  // ---------------------------------------------------------------------------
  // Handles the React Router v6 data-router API:
  //
  //   const router = createBrowserRouter([
  //     { path: '/', element: <HomePage /> },
  //     { path: '/login', element: <LoginPage /> },
  //   ]);
  //
  //   const router = createHashRouter([
  //     { path: '/dashboard', element: <DashboardLayout />, children: [...] }
  //   ]);
  //
  // We detect the call by name and then delegate array parsing to
  // extractRoutesFromArray with an empty parentPath prefix.
  private extractRoutesFromRouterCall(
    node: ts.CallExpression,
    result: IRouteExtractionResult,
    baseDir: string,
    importMap: IImportMap
  ): void {
    const callee = node.expression;

    // Only match createBrowserRouter or createHashRouter
    if (!ts.isIdentifier(callee)) return;
    if (callee.text !== 'createBrowserRouter' && callee.text !== 'createHashRouter') return;

    // First argument should be the routes array
    const firstArg = node.arguments[0];
    if (!firstArg || !ts.isArrayLiteralExpression(firstArg)) return;

    // Extract routes from this array, starting with no parent path prefix
    this.extractRoutesFromArray(firstArg, result, baseDir, importMap, '');
  }

  private extractRouteFromJSX(
    node: ts.JsxSelfClosingElement | ts.JsxElement,
    result: IRouteExtractionResult,
    baseDir: string,
    importMap: IImportMap
  ): void {
    const openingElement = ts.isJsxSelfClosingElement(node)
      ? node
      : node.openingElement;

    const tagName = openingElement.tagName.getFullText().trim();

    if (tagName !== 'Route') return;

    let routePath: string | null = null;
    let componentName: string | null = null;
    let isLazy = false;
    let isIndex = false;
    let hasChildren = false;

    // FIX: Collect ALL attribute values in a first pass before interpreting
    // them. This avoids the bug where `isLazy` is still false when
    // `extractComponentPath` is called because `element` appears before `lazy`
    // in the JSX attribute list.
    //
    // Example of the bug (BEFORE fix):
    //   <Route element={<UserProfile />} lazy={() => import('./pages/UserProfile')} />
    //   When we hit `element`, isLazy is still false → wrong path extraction
    //
    // With two-pass approach we read all attrs first, then process.
    const attrs: Record<string, ts.JsxAttribute> = {};
    for (const attr of openingElement.attributes.properties) {
      if (ts.isJsxAttribute(attr)) {
        attrs[attr.name.getText()] = attr;
      }
    }

    // Determine isLazy FIRST before processing element/component
    isLazy = 'lazy' in attrs;

    if ('path' in attrs) {
      const init = attrs['path'].initializer;
      if (init && ts.isStringLiteral(init)) {
        routePath = init.text;
      }
    }

    if ('index' in attrs) {
      isIndex = true;
      // Index routes have no path; use empty string as sentinel
      routePath = routePath ?? '';
    }

    if ('element' in attrs) {
      const expr = this.unwrapJsxExpression(attrs['element'].initializer as ts.JsxExpression);
      componentName = this.extractComponentName(expr);
      // Now isLazy is correctly set before calling extractComponentPath
      const resolvedPath = this.resolveComponentPath(componentName, expr, baseDir, importMap, isLazy);
      if (resolvedPath) {
        // componentPath is set after object construction below
        result.routes.push({
          path: routePath ?? '',
          component: componentName ?? '',
          componentPath: resolvedPath,
          isLazy,
          isDynamic: this.isDynamicRoute(routePath ?? ''),
          metadata: { index: isIndex }
        });
        return;
      }
    }

    if ('component' in attrs) {
      const expr = this.unwrapJsxExpression(attrs['component'].initializer as ts.JsxExpression);
      componentName = this.extractComponentName(expr);
    }

    if ('lazy' in attrs) {
      const lazyExpr = this.unwrapJsxExpression(attrs['lazy'].initializer as ts.JsxExpression);
      const lazyPath = this.extractLazyComponentPath(lazyExpr, baseDir);
      if (routePath !== null && componentName) {
        result.routes.push({
          path: routePath,
          component: componentName,
          componentPath: lazyPath,
          isLazy: true,
          isDynamic: this.isDynamicRoute(routePath),
          metadata: { index: isIndex }
        });
        return;
      }
    }

    // Check for nested routes in JsxElement children
    if (ts.isJsxElement(node)) {
      hasChildren = node.children.some(
        (child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)
      );
    }

    // Handle index routes with no path (NEW)
    // React Router v6: <Route index element={<HomePage />} />
    // routePath is null here but isIndex is true — still push it.
    if ((routePath !== null || isIndex) && componentName) {
      result.routes.push({
        path: routePath ?? '',
        component: componentName,
        componentPath: this.resolveComponentPath(componentName, undefined, baseDir, importMap, isLazy),
        isLazy,
        isDynamic: this.isDynamicRoute(routePath ?? ''),
        metadata: {
          index: isIndex,
          children: hasChildren ? [] : undefined
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // extractRoutesFromArray
  // ---------------------------------------------------------------------------
  // Processes an array of route objects. Now accepts a `parentPath` parameter
  // so that nested children routes can have their full path computed.
  //
  // Example (nested children):
  //   parentPath = '/dashboard'
  //   child object has path = 'overview'
  //   → stitched path = '/dashboard/overview'
  //
  // Index routes inside children arrays have no path property:
  //   { index: true, element: <DashboardIndex /> }
  //   → path = '/dashboard' (inherits parent, marked as index)
  private extractRoutesFromArray(
    node: ts.ArrayLiteralExpression,
    result: IRouteExtractionResult,
    baseDir: string,
    importMap: IImportMap,
    parentPath: string
  ): void {
    for (const element of node.elements) {
      if (ts.isObjectLiteralExpression(element)) {
        const route = this.extractRouteFromObject(element, baseDir, importMap, parentPath);
        if (route) {
          result.routes.push(route);

          // Recursively extract children routes (NEW)
          // Children paths are relative to this route's path.
          const childrenProp = element.properties.find(
            (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'children'
          ) as ts.PropertyAssignment | undefined;

          if (childrenProp && ts.isArrayLiteralExpression(childrenProp.initializer)) {
            this.extractRoutesFromArray(
              childrenProp.initializer,
              result,
              baseDir,
              importMap,
              route.path  // pass this route's full path as the new parent
            );
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // extractRouteFromObject
  // ---------------------------------------------------------------------------
  // Extracts a single IRouteDef from an object literal like:
  //   { path: '/login', element: <LoginPage />, lazy: () => import('./pages/Login') }
  //
  // parentPath is prepended to relative child paths. For top-level routes,
  // parentPath is ''.
  private extractRouteFromObject(
    obj: ts.ObjectLiteralExpression,
    baseDir: string,
    importMap: IImportMap,
    parentPath: string
  ): IRouteDef | null {
    let routePath: string | null = null;
    let componentName: string | null = null;
    let isLazy = false;
    let componentPath: string | undefined;
    let isIndex = false;
    let layout: string | undefined;

    // FIX: same two-pass approach as JSX — collect all props first so that
    // isLazy is correctly set when we call resolveComponentPath for `element`.
    const props: Record<string, ts.PropertyAssignment> = {};
    for (const prop of obj.properties) {
      if (ts.isPropertyAssignment(prop)) {
        props[prop.name.getText()] = prop;
      }
    }

    // Determine isLazy before processing element
    isLazy = 'lazy' in props;

    if ('path' in props && ts.isStringLiteral(props['path'].initializer)) {
      const rawPath = props['path'].initializer.text;

      // Stitch parent + child paths (NEW)
      // If rawPath is absolute (starts with /), use as-is.
      // If rawPath is relative (e.g. 'overview'), prepend parentPath.
      //
      // Examples:
      //   parentPath='/dashboard', rawPath='overview'  → '/dashboard/overview'
      //   parentPath='/dashboard', rawPath='/admin'    → '/admin'   (absolute, keep)
      //   parentPath='',           rawPath='/login'    → '/login'
      routePath = rawPath.startsWith('/')
        ? rawPath
        : `${parentPath}/${rawPath}`.replace(/\/\//g, '/');
    }

    if ('index' in props) {
      isIndex = this.isTrue(props['index'].initializer);
      if (isIndex) {
        // Index route: inherit the parent path, no own path segment
        routePath = parentPath || '/';
      }
    }

    if ('element' in props) {
      componentName = this.extractComponentName(props['element'].initializer);
      componentPath = this.resolveComponentPath(componentName, props['element'].initializer, baseDir, importMap, isLazy);
    }

    if ('component' in props) {
      componentName = this.extractComponentName(props['component'].initializer);
      if (!componentPath) {
        componentPath = this.resolveComponentPath(componentName, undefined, baseDir, importMap, isLazy);
      }
    }

    if ('lazy' in props) {
      componentPath = this.extractLazyComponentPath(props['lazy'].initializer, baseDir);
      // Component name may be derivable from the lazy import path
      if (!componentName && componentPath) {
        componentName = path.basename(componentPath, '.ts');
      }
    }

    if ('element' in props && ts.isCallExpression(props['element'].initializer)) {
      layout = this.detectLayoutComponent(props['element'].initializer);
    }

    if ((routePath !== null || isIndex) && componentName) {
      return {
        path: routePath ?? parentPath ?? '/',
        component: componentName,
        componentPath,
        isLazy,
        isDynamic: this.isDynamicRoute(routePath ?? ''),
        metadata: {
          index: isIndex,
          layout
        }
      };
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // resolveComponentPath  (NEW — replaces extractComponentPath)
  // ---------------------------------------------------------------------------
  // Resolves a component's file path using two strategies, in order:
  //
  // Strategy 1 — Import map lookup (for non-lazy, top-of-file imports):
  //   If componentName is 'HomePage' and importMap has { HomePage: './pages/HomePage' }
  //   → returns path.resolve(baseDir, './pages/HomePage') + '.ts'
  //
  // Strategy 2 — Inline import() call (for lazy routes):
  //   If the expression is a CallExpression containing import('./pages/Login')
  //   → returns path.resolve(baseDir, './pages/Login') + '.ts'
  //
  // Returns undefined if neither strategy finds a path.
  private resolveComponentPath(
    componentName: string | null,
    expr: ts.Expression | undefined,
    baseDir: string,
    importMap: IImportMap,
    isLazy: boolean
  ): string | undefined {
    // Strategy 1: check the import map for this component name
    if (componentName && importMap[componentName]) {
      return path.resolve(baseDir, importMap[componentName]).replace(/\.tsx?$/, '') + '.ts';
    }

    if (!expr) return undefined;

    // Strategy 2: inline import() call
    if (ts.isCallExpression(expr) && this.isImportCall(expr) && expr.arguments.length > 0) {
      const arg = expr.arguments[0];
      if (ts.isStringLiteral(arg)) {
        return path.resolve(baseDir, arg.text).replace(/\.tsx?$/, '') + '.ts';
      }
    }

    return undefined;
  }

  private unwrapJsxExpression(node: ts.JsxExpression | ts.StringLiteral | undefined): ts.Expression | undefined {
    if (!node) return undefined;
    // FIX: guard against non-JsxExpression nodes (e.g. StringLiteral for path="...")
    return ts.isJsxExpression(node) ? node.expression : undefined;
  }

  private extractComponentName(expr: ts.Expression | undefined): string | null {
    if (!expr) return null;

    // <Component />  (self-closing JSX)
    if (ts.isJsxSelfClosingElement(expr)) {
      return expr.tagName.getText();
    }

    // <Component>children</Component>
    if (ts.isJsxElement(expr)) {
      return expr.openingElement.tagName.getText();
    }

    // Bare identifier: component={HomePage}
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

    if (ts.isCallExpression(expr)) {
      if (this.isImportCall(expr) && expr.arguments.length > 0) {
        const arg = expr.arguments[0];
        if (ts.isStringLiteral(arg)) {
          return path.resolve(baseDir, arg.text).replace(/\.tsx?$/, '') + '.ts';
        }
      }
    }

    if (isLazy && ts.isCallExpression(expr)) {
      const importExpr = this.extractImportExpression(expr);
      if (importExpr) {
        return path.resolve(baseDir, importExpr).replace(/\.tsx?$/, '') + '.ts';
      }
    }

    return undefined;
  }

  private extractLazyComponentPath(expr: ts.Expression | undefined, baseDir: string): string | undefined {
    if (!expr) return undefined;

    // lazy: () => import('./pages/Login')
    if (ts.isArrowFunction(expr)) {
      const body = expr.body;
      if (ts.isCallExpression(body) && this.isImportCall(body)) {
        const arg = body.arguments[0];
        if (ts.isStringLiteral(arg)) {
          return path.resolve(baseDir, arg.text).replace(/\.tsx?$/, '') + '.ts';
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

  // isDynamicRoute
  // Returns true if the path contains a :param segment or a * wildcard.
  // Examples:
  //   '/user/:id'        → true
  //   '/posts/:postId'   → true
  //   '/dashboard/*'     → true
  //   '/login'           → false
  //   '/'                → false
  private isDynamicRoute(routePath: string): boolean {
    return /:(\w+)|\*/.test(routePath);
  }

  // isTrue
  // FIX: original used ts.isTrueKeyword which does not exist in the TS compiler API.
  // Correct check is node.kind === ts.SyntaxKind.TrueKeyword.
  private isTrue(node: ts.Expression): boolean {
    return (
      node.kind === ts.SyntaxKind.TrueKeyword ||
      (ts.isStringLiteral(node) && node.text === 'true') ||
      (ts.isNumericLiteral(node) && node.text !== '0')
    );
  }

  private detectLayoutComponent(node: ts.CallExpression): string | undefined {
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

// Maps component local name → relative import specifier.
// Built by buildImportMap() from the file's top-level import declarations.
// Used by resolveComponentPath() to find file paths for non-lazy components.
export interface IImportMap {
  [componentName: string]: string;
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
//     componentPath: 'src/pages/HomePage.ts',   ← resolved from import map
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
//   '/'          => 'src/pages/HomePage.ts',
//   '/user/:id'  => 'src/pages/UserProfile.ts'
// }
```

## Example Input/Output

### Example 1 — JSX Routes (Basic)

**Input:**
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

**Output:**
```typescript
{
  filePath: 'src/App.tsx',
  routes: [
    {
      path: '/',
      component: 'HomePage',
      componentPath: 'src/pages/HomePage.ts',   // resolved via importMap
      isLazy: false,
      isDynamic: false
    },
    {
      path: '/login',
      component: 'LoginPage',
      componentPath: undefined,                 // LoginPage not in imports → unresolved
      isLazy: false,
      isDynamic: false
    },
    {
      path: '/user/:id',
      component: 'UserProfile',
      componentPath: 'src/pages/UserProfile.ts', // resolved from lazy import()
      isLazy: true,
      isDynamic: true
    },
    {
      path: '/dashboard/*',
      component: 'DashboardPage',
      componentPath: 'src/pages/DashboardPage.ts', // resolved via importMap
      isLazy: false,
      isDynamic: true
    }
  ]
}
```

---

### Example 2 — `createBrowserRouter` Object Config (NEW)

This is the React Router v6 data router pattern. Routes are defined as a plain
array of objects and passed directly to `createBrowserRouter`.

**Input:**
```tsx
// src/router.tsx
import { createBrowserRouter } from 'react-router-dom';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';

const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/user/:id', lazy: () => import('./pages/UserProfile') },
]);

export default router;
```

**Output:**
```typescript
{
  filePath: 'src/router.tsx',
  routes: [
    {
      path: '/',
      component: 'HomePage',
      componentPath: 'src/pages/HomePage.ts',    // from importMap
      isLazy: false,
      isDynamic: false
    },
    {
      path: '/login',
      component: 'LoginPage',
      componentPath: 'src/pages/LoginPage.ts',   // from importMap
      isLazy: false,
      isDynamic: false
    },
    {
      path: '/user/:id',
      component: 'UserProfile',
      componentPath: 'src/pages/UserProfile.ts', // from lazy import()
      isLazy: true,
      isDynamic: true
    }
  ]
}
```

---

### Example 3 — Nested Children Routes with Path Stitching (NEW)

Child routes with relative paths are stitched onto their parent path.

**Input:**
```tsx
// src/router.tsx
import { createBrowserRouter } from 'react-router-dom';
import DashboardLayout from './pages/DashboardLayout';
import OverviewPage from './pages/Overview';
import SettingsPage from './pages/Settings';

const router = createBrowserRouter([
  {
    path: '/dashboard',
    element: <DashboardLayout />,
    children: [
      { index: true, element: <OverviewPage /> },         // inherits /dashboard
      { path: 'settings', element: <SettingsPage /> },    // relative → /dashboard/settings
      { path: '/admin', element: <AdminPage /> },         // absolute → /admin
    ]
  }
]);
```

**Output:**
```typescript
{
  filePath: 'src/router.tsx',
  routes: [
    // Parent route
    {
      path: '/dashboard',
      component: 'DashboardLayout',
      componentPath: 'src/pages/DashboardLayout.ts',
      isLazy: false,
      isDynamic: false
    },
    // Index child — inherits parent path, isIndex: true
    {
      path: '/dashboard',
      component: 'OverviewPage',
      componentPath: 'src/pages/Overview.ts',
      isLazy: false,
      isDynamic: false,
      metadata: { index: true }
    },
    // Relative child — stitched: '/dashboard' + '/' + 'settings'
    {
      path: '/dashboard/settings',
      component: 'SettingsPage',
      componentPath: 'src/pages/Settings.ts',
      isLazy: false,
      isDynamic: false
    },
    // Absolute child — kept as-is, NOT prefixed with /dashboard
    {
      path: '/admin',
      component: 'AdminPage',
      componentPath: undefined,
      isLazy: false,
      isDynamic: false
    }
  ]
}
```

---

### Example 4 — Index Route in JSX (NEW)

`<Route index element={<HomePage />} />` has no `path` attribute at all.

**Input:**
```tsx
<Routes>
  <Route path="/dashboard" element={<DashboardLayout />}>
    <Route index element={<DashboardHome />} />
    <Route path="settings" element={<Settings />} />
  </Route>
</Routes>
```

**Output:**
```typescript
routes: [
  {
    path: '/dashboard',
    component: 'DashboardLayout',
    componentPath: 'src/pages/DashboardLayout.ts',
    isLazy: false,
    isDynamic: false
  },
  {
    // index route: path is '' (empty string), metadata.index is true
    path: '',
    component: 'DashboardHome',
    componentPath: 'src/pages/DashboardHome.ts',
    isLazy: false,
    isDynamic: false,
    metadata: { index: true }
  },
  {
    path: 'settings',
    component: 'Settings',
    componentPath: 'src/pages/Settings.ts',
    isLazy: false,
    isDynamic: false
  }
]
```

---

### Example 5 — Import Map Resolution for Non-Lazy Routes (NEW)

Before this fix, `componentPath` was always `undefined` for non-lazy routes.
Now the analyzer cross-references the import statements at the top of the file.

**Input:**
```tsx
// src/App.tsx
import HomePage from './pages/HomePage';           // default import
import { LoginPage, RegisterPage } from './pages/auth'; // named imports
import DashboardPage from '../features/Dashboard'; // relative up-dir

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
    </Routes>
  );
}
```

**Import map built internally:**
```typescript
{
  HomePage:      './pages/HomePage',
  LoginPage:     './pages/auth',
  RegisterPage:  './pages/auth',
  DashboardPage: '../features/Dashboard'
}
```

**Output:**
```typescript
routes: [
  { path: '/',          component: 'HomePage',      componentPath: 'src/pages/HomePage.ts' },
  { path: '/login',     component: 'LoginPage',     componentPath: 'src/pages/auth.ts' },
  { path: '/register',  component: 'RegisterPage',  componentPath: 'src/pages/auth.ts' },
  { path: '/dashboard', component: 'DashboardPage', componentPath: 'src/features/Dashboard.ts' }
]
```

---

### Example 6 — Duplicate Route Path Warning (NEW)

**Input:**
```typescript
// Two separate files both define path "/"
const extractionA = { filePath: 'src/App.tsx',    routes: [{ path: '/', componentPath: 'src/pages/Home.ts', ... }] };
const extractionB = { filePath: 'src/Router.tsx', routes: [{ path: '/', componentPath: 'src/pages/Index.ts', ... }] };

const routeMap = analyzer.buildRouteMap([extractionA, extractionB]);
```

**Console output:**
```
[RouteAnalyzer] Duplicate route path "/" found in "src/Router.tsx". Overwriting previous entry.
```

**routeMap after:**
```
Map { '/' => 'src/pages/Index.ts' }   // last writer wins
```

## Dynamic Route Matching

For dynamic routes, the analyzer supports prefix matching:

```typescript
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

// matchRoute('/user/123',  '/user/:id') → true
// matchRoute('/user/john', '/user/:id') → true
// matchRoute('/user',      '/user/:id') → false
// matchRoute('/dashboard/x/y', '/dashboard/*') → true
```

## Testing Strategy

### Unit Tests

#### 1. JSX Route Extraction

```typescript
// src/analyzers/__tests__/route-analyzer.test.ts
import { RouteAnalyzer } from '../route-analyzer';

describe('RouteAnalyzer — JSX Routes', () => {
  const analyzer = new RouteAnalyzer();

  it('extracts a simple JSX route with element prop', async () => {
    const source = `
      import HomePage from './pages/HomePage';
      function App() {
        return <Route path="/" element={<HomePage />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]).toMatchObject({
      path: '/',
      component: 'HomePage',
      isLazy: false,
      isDynamic: false
    });
  });

  it('resolves componentPath for non-lazy route via import map', async () => {
    const source = `
      import HomePage from './pages/HomePage';
      function App() {
        return <Route path="/" element={<HomePage />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    // componentPath should be resolved even though route is not lazy
    expect(result.routes[0].componentPath).toMatch(/pages\/HomePage/);
  });

  it('extracts a lazy JSX route', async () => {
    const source = `
      function App() {
        return <Route path="/user/:id" lazy={() => import('./pages/UserProfile')} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes[0]).toMatchObject({
      path: '/user/:id',
      isLazy: true,
      isDynamic: true,
      componentPath: expect.stringContaining('pages/UserProfile')
    });
  });

  it('extracts index route (no path attribute)', async () => {
    const source = `
      import DashboardHome from './pages/DashboardHome';
      function App() {
        return <Route index element={<DashboardHome />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].metadata?.index).toBe(true);
    // path is empty string for index routes in JSX
    expect(result.routes[0].path).toBe('');
  });

  it('marks wildcard routes as dynamic', async () => {
    const source = `
      import DashboardPage from './pages/DashboardPage';
      function App() {
        return <Route path="/dashboard/*" element={<DashboardPage />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes[0].isDynamic).toBe(true);
  });

  it('does not treat non-Route JSX elements as routes', async () => {
    const source = `
      function App() {
        return <div><Link to="/">Home</Link></div>;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes).toHaveLength(0);
  });
});
```

#### 2. Object-Based / `createBrowserRouter` Routes (NEW)

```typescript
describe('RouteAnalyzer — createBrowserRouter', () => {
  const analyzer = new RouteAnalyzer();

  it('extracts routes from createBrowserRouter call', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import HomePage from './pages/HomePage';
      import LoginPage from './pages/LoginPage';

      const router = createBrowserRouter([
        { path: '/', element: <HomePage /> },
        { path: '/login', element: <LoginPage /> },
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    expect(result.routes).toHaveLength(2);
    expect(result.routes[0]).toMatchObject({ path: '/', component: 'HomePage' });
    expect(result.routes[1]).toMatchObject({ path: '/login', component: 'LoginPage' });
  });

  it('extracts routes from createHashRouter call', async () => {
    const source = `
      import { createHashRouter } from 'react-router-dom';
      import AboutPage from './pages/About';

      const router = createHashRouter([
        { path: '/about', element: <AboutPage /> },
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    expect(result.routes[0]).toMatchObject({ path: '/about', component: 'AboutPage' });
  });

  it('resolves componentPath via import map for object-based routes', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import HomePage from './pages/HomePage';

      const router = createBrowserRouter([
        { path: '/', element: <HomePage /> },
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    expect(result.routes[0].componentPath).toMatch(/pages\/HomePage/);
  });

  it('resolves componentPath from lazy import in object route', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';

      const router = createBrowserRouter([
        { path: '/user/:id', lazy: () => import('./pages/UserProfile') },
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    expect(result.routes[0]).toMatchObject({
      isLazy: true,
      componentPath: expect.stringContaining('pages/UserProfile')
    });
  });
});
```

#### 3. Nested Children Routes (NEW)

```typescript
describe('RouteAnalyzer — Nested Children Routes', () => {
  const analyzer = new RouteAnalyzer();

  it('stitches relative child path onto parent path', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import DashboardLayout from './pages/DashboardLayout';
      import SettingsPage from './pages/Settings';

      const router = createBrowserRouter([
        {
          path: '/dashboard',
          element: <DashboardLayout />,
          children: [
            { path: 'settings', element: <SettingsPage /> },
          ]
        }
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    const settingsRoute = result.routes.find(r => r.component === 'SettingsPage');
    // Relative 'settings' should be stitched onto '/dashboard'
    expect(settingsRoute?.path).toBe('/dashboard/settings');
  });

  it('does NOT prefix absolute child path with parent path', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import Layout from './pages/Layout';
      import AdminPage from './pages/Admin';

      const router = createBrowserRouter([
        {
          path: '/dashboard',
          element: <Layout />,
          children: [
            { path: '/admin', element: <AdminPage /> }, // absolute path
          ]
        }
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    const adminRoute = result.routes.find(r => r.component === 'AdminPage');
    expect(adminRoute?.path).toBe('/admin'); // NOT '/dashboard/admin'
  });

  it('handles index child route inheriting parent path', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import DashboardLayout from './pages/DashboardLayout';
      import OverviewPage from './pages/Overview';

      const router = createBrowserRouter([
        {
          path: '/dashboard',
          element: <DashboardLayout />,
          children: [
            { index: true, element: <OverviewPage /> },
          ]
        }
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    const indexRoute = result.routes.find(r => r.component === 'OverviewPage');
    expect(indexRoute?.path).toBe('/dashboard');
    expect(indexRoute?.metadata?.index).toBe(true);
  });

  it('handles three levels of nesting', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';

      const router = createBrowserRouter([
        {
          path: '/org',
          element: <OrgLayout />,
          children: [
            {
              path: 'team',
              element: <TeamLayout />,
              children: [
                { path: 'members', element: <MembersPage /> }
              ]
            }
          ]
        }
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    const membersRoute = result.routes.find(r => r.component === 'MembersPage');
    expect(membersRoute?.path).toBe('/org/team/members');
  });
});
```

#### 4. Component Path Resolution via Import Map (NEW)

```typescript
describe('RouteAnalyzer — Import Map Resolution', () => {
  const analyzer = new RouteAnalyzer();

  it('resolves default import to componentPath', async () => {
    const source = `
      import HomePage from './pages/HomePage';
      function App() {
        return <Route path="/" element={<HomePage />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes[0].componentPath).toMatch(/pages\/HomePage\.ts$/);
  });

  it('resolves named import to componentPath', async () => {
    const source = `
      import { LoginPage } from './pages/auth';
      function App() {
        return <Route path="/login" element={<LoginPage />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes[0].componentPath).toMatch(/pages\/auth\.ts$/);
  });

  it('does NOT resolve third-party package imports as componentPath', async () => {
    const source = `
      import { BrowserRouter } from 'react-router-dom';
      function App() {
        return <Route path="/" element={<BrowserRouter />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    // react-router-dom is third-party — should NOT appear in importMap
    expect(result.routes[0].componentPath).toBeUndefined();
  });

  it('returns undefined componentPath when component is not imported', async () => {
    // LoginPage is used but never imported at the top of file
    const source = `
      function App() {
        return <Route path="/login" element={<LoginPage />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes[0].componentPath).toBeUndefined();
  });
});
```

#### 5. Route Map Building (Deduplication)

```typescript
describe('RouteAnalyzer — buildRouteMap', () => {
  const analyzer = new RouteAnalyzer();

  it('builds a map from path to componentPath', () => {
    const extractions = [
      {
        filePath: 'src/App.tsx',
        routes: [
          { path: '/', component: 'HomePage', componentPath: 'src/pages/HomePage.ts', isLazy: false, isDynamic: false }
        ]
      }
    ];
    const map = analyzer.buildRouteMap(extractions);
    expect(map.get('/')).toBe('src/pages/HomePage.ts');
  });

  it('omits routes with no componentPath from the map', () => {
    const extractions = [
      {
        filePath: 'src/App.tsx',
        routes: [
          { path: '/login', component: 'LoginPage', componentPath: undefined, isLazy: false, isDynamic: false }
        ]
      }
    ];
    const map = analyzer.buildRouteMap(extractions);
    expect(map.has('/login')).toBe(false);
  });

  it('logs a warning and keeps last entry on duplicate path', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const extractions = [
      { filePath: 'src/App.tsx',    routes: [{ path: '/', component: 'Home',  componentPath: 'src/pages/Home.ts',  isLazy: false, isDynamic: false }] },
      { filePath: 'src/Router.tsx', routes: [{ path: '/', component: 'Index', componentPath: 'src/pages/Index.ts', isLazy: false, isDynamic: false }] }
    ];
    const map = analyzer.buildRouteMap(extractions);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Duplicate route path "/"'));
    expect(map.get('/')).toBe('src/pages/Index.ts'); // last writer wins
    warnSpy.mockRestore();
  });
});
```

#### 6. Dynamic Route Matching

```typescript
describe('matchRoute', () => {
  it('matches exact static routes', () => {
    expect(matchRoute('/login', '/login')).toBe(true);
    expect(matchRoute('/login', '/register')).toBe(false);
  });

  it('matches :param segments', () => {
    expect(matchRoute('/user/123',  '/user/:id')).toBe(true);
    expect(matchRoute('/user/john', '/user/:id')).toBe(true);
    expect(matchRoute('/user',      '/user/:id')).toBe(false);
  });

  it('matches * wildcard', () => {
    expect(matchRoute('/dashboard/anything/here', '/dashboard/*')).toBe(true);
    expect(matchRoute('/dashboard',               '/dashboard/*')).toBe(true);
    expect(matchRoute('/other',                   '/dashboard/*')).toBe(false);
  });

  it('matches mixed :param and *', () => {
    expect(matchRoute('/org/42/docs/intro', '/org/:id/docs/*')).toBe(true);
  });
});
```

### Integration Tests

```typescript
describe('RouteAnalyzer — Integration', () => {
  const analyzer = new RouteAnalyzer();

  it('handles a real-world App.tsx with mixed JSX routes', async () => {
    const source = fs.readFileSync('src/__fixtures__/App.tsx', 'utf-8');
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.routes.every(r => typeof r.path === 'string')).toBe(true);
  });

  it('handles a real-world router.tsx with createBrowserRouter', async () => {
    const source = fs.readFileSync('src/__fixtures__/router.tsx', 'utf-8');
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    const routeMap = analyzer.buildRouteMap([result]);
    // Every lazy route should have a componentPath in the map
    const lazyRoutes = result.routes.filter(r => r.isLazy);
    lazyRoutes.forEach(r => {
      expect(routeMap.has(r.path)).toBe(true);
    });
  });

  it('full pipeline: analyze → buildRouteMap → matchRoute', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import HomePage from './pages/HomePage';

      const router = createBrowserRouter([
        { path: '/', element: <HomePage /> },
        { path: '/user/:id', lazy: () => import('./pages/UserProfile') },
        {
          path: '/dashboard',
          element: <DashboardLayout />,
          children: [
            { path: 'settings', element: <SettingsPage /> }
          ]
        }
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    const routeMap = analyzer.buildRouteMap([result]);

    // Static route
    expect(matchRoute('/', '/')).toBe(true);

    // Dynamic route
    expect(matchRoute('/user/99', '/user/:id')).toBe(true);

    // Nested stitched route
    const settingsRoute = result.routes.find(r => r.path === '/dashboard/settings');
    expect(settingsRoute).toBeDefined();

    // Route map covers all resolvable paths
    expect(routeMap.size).toBeGreaterThan(0);
  });
});
```

---

### Example 7 — Alias Resolution: `@/` prefix from tsconfig (NEW)

This is the most common real-world case. The project uses `@/` as an alias
for `src/` defined in `tsconfig.json`. Without alias support, every
`componentPath` would be `undefined` for these imports.

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

**Input:**
```tsx
// src/router.tsx
import { createBrowserRouter } from 'react-router-dom';
import HomePage from '@/pages/HomePage';
import { LoginPage } from '@/pages/auth';

const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/user/:id', lazy: () => import('./pages/UserProfile') },
]);
```

**AliasResolver internal state after reading tsconfig:**
```typescript
aliasMap = {
  '@': '/project/src'   // '@/*' key → stripped to '@', 'src/*' value → stripped to 'src'
}
```

**AliasResolver.resolve() calls during buildImportMap:**
```typescript
resolve('@/pages/HomePage')  → '/project/src/pages/HomePage'  ← alias expanded
resolve('@/pages/auth')      → '/project/src/pages/auth'       ← alias expanded
resolve('react-router-dom')  → 'react-router-dom'              ← no match, unchanged → filtered out
```

**importMap built:**
```typescript
{
  HomePage:  '/project/src/pages/HomePage',
  LoginPage: '/project/src/pages/auth'
}
```

**Output:**
```typescript
{
  filePath: 'src/router.tsx',
  routes: [
    {
      path: '/',
      component: 'HomePage',
      componentPath: '/project/src/pages/HomePage.ts',  // ← resolved via alias
      isLazy: false,
      isDynamic: false
    },
    {
      path: '/login',
      component: 'LoginPage',
      componentPath: '/project/src/pages/auth.ts',       // ← resolved via alias
      isLazy: false,
      isDynamic: false
    },
    {
      path: '/user/:id',
      component: 'UserProfile',
      componentPath: 'src/pages/UserProfile.ts',         // ← resolved via relative import()
      isLazy: true,
      isDynamic: true
    }
  ]
}
```

---

### Example 8 — Multiple Named Aliases: `@pages/`, `@components/` (NEW)

Projects often define several named aliases. The longest prefix always wins to
prevent `@` from incorrectly swallowing `@pages`.

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*":           ["src/*"],
      "@pages/*":      ["src/pages/*"],
      "@components/*": ["src/components/*"]
    }
  }
}
```

**Input:**
```tsx
import HomePage from '@pages/HomePage';         // matches '@pages', not '@'
import Button from '@components/Button';         // matches '@components'
import { useAuth } from '@/hooks/useAuth';       // matches '@'
```

**Prefix matching (sorted longest-first):**
```
Prefixes (sorted): ['@components', '@pages', '@']

resolve('@pages/HomePage'):
  test '@components' → '@pages/HomePage'.startsWith('@components/') → false
  test '@pages'      → '@pages/HomePage'.startsWith('@pages/')      → true ✓
  remainder = 'HomePage'
  → path.join('/project/src/pages', 'HomePage') = '/project/src/pages/HomePage'

resolve('@components/Button'):
  test '@components' → '@components/Button'.startsWith('@components/') → true ✓
  remainder = 'Button'
  → '/project/src/components/Button'

resolve('@/hooks/useAuth'):
  test '@components' → false
  test '@pages'      → false
  test '@'           → '@/hooks/useAuth'.startsWith('@/') → true ✓
  remainder = 'hooks/useAuth'
  → '/project/src/hooks/useAuth'
```

**importMap built:**
```typescript
{
  HomePage: '/project/src/pages/HomePage',
  Button:   '/project/src/components/Button',
  useAuth:  '/project/src/hooks/useAuth'
}
```

---

### Example 9 — User-Supplied Aliases Override Config (NEW)

When the project's config file uses computed aliases (e.g., from env vars) that
the regex parser cannot extract, the user supplies them manually. User aliases
are merged last and always win.

**vite.config.ts (computed alias — NOT parseable by regex):**
```typescript
const isDev = process.env.NODE_ENV === 'development';
resolve: {
  alias: {
    '@': isDev ? path.resolve(__dirname, 'src') : path.resolve(__dirname, 'dist')
  }
}
```

**Usage — user supplies the alias manually:**
```typescript
const result = await analyzer.extract({
  filePath: 'src/router.tsx',
  sourceCode,
  aliasConfig: {
    projectRoot: '/project',
    configFiles: [],          // skip auto-detection entirely
    aliases: {
      '@':       'src',       // relative to projectRoot → /project/src
      '@utils':  'src/utils'  // → /project/src/utils
    }
  }
});
```

**AliasResolver internal state:**
```typescript
// configFiles: [] → nothing auto-detected
// user aliases merged:
aliasMap = {
  '@':      '/project/src',
  '@utils': '/project/src/utils'
}
```

---

#### 7. AliasResolver Unit Tests (NEW)

```typescript
// src/analyzers/__tests__/alias-resolver.test.ts
import * as path from 'path';
import * as fs from 'fs';
import { AliasResolver } from '../alias-resolver';

// ─── resolve() ───────────────────────────────────────────────────────────────

describe('AliasResolver.resolve()', () => {
  it('passes relative imports through unchanged', () => {
    const r = new AliasResolver({ configFiles: [], aliases: { '@': '/project/src' } });
    expect(r.resolve('./pages/Home')).toBe('./pages/Home');
    expect(r.resolve('../utils')).toBe('../utils');
  });

  it('passes absolute imports through unchanged', () => {
    const r = new AliasResolver({ configFiles: [], aliases: { '@': '/project/src' } });
    expect(r.resolve('/absolute/path')).toBe('/absolute/path');
  });

  it('passes unresolvable third-party imports through unchanged', () => {
    const r = new AliasResolver({ configFiles: [], aliases: { '@': '/project/src' } });
    expect(r.resolve('react')).toBe('react');
    expect(r.resolve('react-router-dom')).toBe('react-router-dom');
  });

  it('expands @/ prefix alias', () => {
    const r = new AliasResolver({ configFiles: [], aliases: { '@': '/project/src' } });
    expect(r.resolve('@/pages/HomePage')).toBe('/project/src/pages/HomePage');
    expect(r.resolve('@/hooks/useAuth')).toBe('/project/src/hooks/useAuth');
  });

  it('expands named @pages prefix alias', () => {
    const r = new AliasResolver({ configFiles: [], aliases: { '@pages': '/project/src/pages' } });
    expect(r.resolve('@pages/Login')).toBe('/project/src/pages/Login');
  });

  it('expands ~ prefix alias', () => {
    const r = new AliasResolver({ configFiles: [], aliases: { '~': '/project/src' } });
    expect(r.resolve('~/utils/format')).toBe('/project/src/utils/format');
  });

  it('matches longest prefix first to avoid ambiguity', () => {
    const r = new AliasResolver({
      configFiles: [],
      aliases: {
        '@':           '/project/src',
        '@pages':      '/project/src/pages',
        '@components': '/project/src/components',
      }
    });
    // '@pages/Login' — '@pages' must win over '@'
    expect(r.resolve('@pages/Login')).toBe('/project/src/pages/Login');
    // '@components/Button' — '@components' must win over '@'
    expect(r.resolve('@components/Button')).toBe('/project/src/components/Button');
    // '@/utils' — falls through to '@'
    expect(r.resolve('@/utils')).toBe('/project/src/utils');
  });

  it('handles exact alias match (no remainder)', () => {
    const r = new AliasResolver({ configFiles: [], aliases: { '@utils': '/project/src/utils/index' } });
    expect(r.resolve('@utils')).toBe('/project/src/utils/index');
  });
});

// ─── loadFromTsConfig ────────────────────────────────────────────────────────

describe('AliasResolver — tsconfig.json loading', () => {
  const tmpDir = '/tmp/alias-resolver-test-tsconfig';

  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('reads @/* paths from tsconfig.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { '@/*': ['src/*'] }
      }
    }));
    const r = new AliasResolver({ projectRoot: tmpDir, configFiles: ['tsconfig'] });
    expect(r.resolve('@/pages/Home')).toBe(path.join(tmpDir, 'src/pages/Home'));
  });

  it('reads multiple paths from tsconfig.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@/*':      ['src/*'],
          '@pages/*': ['src/pages/*'],
        }
      }
    }));
    const r = new AliasResolver({ projectRoot: tmpDir, configFiles: ['tsconfig'] });
    expect(r.resolve('@pages/Login')).toBe(path.join(tmpDir, 'src/pages/Login'));
    expect(r.resolve('@/components/Nav')).toBe(path.join(tmpDir, 'src/components/Nav'));
  });

  it('handles tsconfig with comments (uses TS parser, not JSON.parse)', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'),
      `{
        // This is a comment
        "compilerOptions": {
          "baseUrl": ".",
          "paths": { "@/*": ["src/*"] }  // trailing comma ok too
        }
      }`
    );
    const r = new AliasResolver({ projectRoot: tmpDir, configFiles: ['tsconfig'] });
    expect(r.resolve('@/pages/Home')).toBe(path.join(tmpDir, 'src/pages/Home'));
  });

  it('returns empty map when tsconfig.json does not exist', () => {
    const r = new AliasResolver({ projectRoot: tmpDir, configFiles: ['tsconfig'] });
    expect(r.getAliasMap()).toEqual({});
  });

  it('returns empty map when tsconfig has no paths', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'es2020' }
    }));
    const r = new AliasResolver({ projectRoot: tmpDir, configFiles: ['tsconfig'] });
    expect(r.getAliasMap()).toEqual({});
  });
});

// ─── loadFromViteConfig ───────────────────────────────────────────────────────

describe('AliasResolver — vite.config loading', () => {
  const tmpDir = '/tmp/alias-resolver-test-vite';

  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('reads object-format alias with path.resolve', () => {
    fs.writeFileSync(path.join(tmpDir, 'vite.config.ts'), `
      import { defineConfig } from 'vite';
      import path from 'path';
      export default defineConfig({
        resolve: {
          alias: { '@': path.resolve(__dirname, 'src') }
        }
      });
    `);
    const r = new AliasResolver({ projectRoot: tmpDir, configFiles: ['vite'] });
    expect(r.resolve('@/pages/Home')).toBe(path.join(tmpDir, 'src/pages/Home'));
  });

  it('reads array-format alias with path.resolve', () => {
    fs.writeFileSync(path.join(tmpDir, 'vite.config.ts'), `
      export default defineConfig({
        resolve: {
          alias: [
            { find: '@', replacement: path.resolve(__dirname, 'src') },
            { find: '@pages', replacement: path.resolve(__dirname, 'src/pages') }
          ]
        }
      });
    `);
    const r = new AliasResolver({ projectRoot: tmpDir, configFiles: ['vite'] });
    expect(r.resolve('@/utils')).toBe(path.join(tmpDir, 'src/utils'));
    expect(r.resolve('@pages/Login')).toBe(path.join(tmpDir, 'src/pages/Login'));
  });

  it('returns empty map when no vite config exists', () => {
    const r = new AliasResolver({ projectRoot: tmpDir, configFiles: ['vite'] });
    expect(r.getAliasMap()).toEqual({});
  });
});

// ─── loadFromWebpackConfig ────────────────────────────────────────────────────

describe('AliasResolver — webpack.config loading', () => {
  const tmpDir = '/tmp/alias-resolver-test-webpack';

  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('reads alias with path.resolve from webpack config', () => {
    fs.writeFileSync(path.join(tmpDir, 'webpack.config.js'), `
      const path = require('path');
      module.exports = {
        resolve: {
          alias: {
            '@': path.resolve(__dirname, 'src/'),
            '@components': path.resolve(__dirname, 'src/components/'),
          }
        }
      };
    `);
    const r = new AliasResolver({ projectRoot: tmpDir, configFiles: ['webpack'] });
    expect(r.resolve('@/pages/Home')).toBe(path.join(tmpDir, 'src/pages/Home'));
    expect(r.resolve('@components/Nav')).toBe(path.join(tmpDir, 'src/components/Nav'));
  });

  it('returns empty map when no webpack config exists', () => {
    const r = new AliasResolver({ projectRoot: tmpDir, configFiles: ['webpack'] });
    expect(r.getAliasMap()).toEqual({});
  });
});

// ─── Priority / merge order ───────────────────────────────────────────────────

describe('AliasResolver — merge priority', () => {
  const tmpDir = '/tmp/alias-resolver-test-merge';

  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('user-supplied aliases override tsconfig aliases for same prefix', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } }
    }));
    const r = new AliasResolver({
      projectRoot: tmpDir,
      configFiles: ['tsconfig'],
      aliases: { '@': 'app' }  // user says @ → app, not src
    });
    // User alias should win
    expect(r.resolve('@/pages/Home')).toBe(path.join(tmpDir, 'app/pages/Home'));
  });

  it('configFiles: [] skips all auto-detection', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } }
    }));
    const r = new AliasResolver({
      projectRoot: tmpDir,
      configFiles: [],          // skip tsconfig
      aliases: { '@': 'app' }
    });
    expect(r.getAliasMap()).toEqual({ '@': path.join(tmpDir, 'app') });
  });
});

// ─── Integration: AliasResolver + RouteAnalyzer ───────────────────────────────

describe('RouteAnalyzer — alias integration', () => {
  const analyzer = new RouteAnalyzer();

  it('resolves componentPath for @/ aliased import in JSX route', async () => {
    const source = `
      import HomePage from '@/pages/HomePage';
      function App() {
        return <Route path="/" element={<HomePage />} />;
      }
    `;
    const result = await analyzer.extract({
      filePath: '/project/src/App.tsx',
      sourceCode: source,
      aliasConfig: {
        projectRoot: '/project',
        configFiles: [],
        aliases: { '@': 'src' }
      }
    });
    expect(result.routes[0].componentPath).toBe('/project/src/pages/HomePage.ts');
  });

  it('resolves componentPath for @pages/ aliased import in createBrowserRouter', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import LoginPage from '@pages/LoginPage';

      const router = createBrowserRouter([
        { path: '/login', element: <LoginPage /> }
      ]);
    `;
    const result = await analyzer.extract({
      filePath: '/project/src/router.tsx',
      sourceCode: source,
      aliasConfig: {
        configFiles: [],
        aliases: { '@pages': '/project/src/pages' }
      }
    });
    expect(result.routes[0].componentPath).toBe('/project/src/pages/LoginPage.ts');
  });

  it('still resolves relative imports correctly when aliases are also configured', async () => {
    const source = `
      import HomePage from './pages/HomePage';
      import LoginPage from '@/pages/LoginPage';
      function App() {
        return (
          <>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
          </>
        );
      }
    `;
    const result = await analyzer.extract({
      filePath: '/project/src/App.tsx',
      sourceCode: source,
      aliasConfig: { configFiles: [], aliases: { '@': 'src' }, projectRoot: '/project' }
    });
    const home  = result.routes.find(r => r.path === '/');
    const login = result.routes.find(r => r.path === '/login');
    expect(home?.componentPath).toBe('/project/src/pages/HomePage.ts');
    expect(login?.componentPath).toBe('/project/src/pages/LoginPage.ts');
  });

  it('returns undefined componentPath for unresolvable alias (not in aliasMap)', async () => {
    const source = `
      import MysteryPage from '@mystery/Page';
      function App() {
        return <Route path="/mystery" element={<MysteryPage />} />;
      }
    `;
    const result = await analyzer.extract({
      filePath: '/project/src/App.tsx',
      sourceCode: source,
      aliasConfig: { configFiles: [], aliases: { '@': 'src' }, projectRoot: '/project' }
      // '@mystery' not in aliases → resolve() returns '@mystery/Page' unchanged
      // → not a local path → filtered out of importMap
    });
    expect(result.routes[0].componentPath).toBeUndefined();
  });
});
```

- **Layout component detection via JSX wrapping** (`<Layout><Route /></Layout>`) is not yet implemented. Currently only the `wrapper` property in `createBrowserRouter` options is checked.
- **`componentPath` for named exports from barrel files** (e.g. `import { A, B, C } from './pages'`) will resolve to the barrel file path, not the individual component file. This is acceptable for test matching but may require a deeper resolution step for high precision.
- **Namespace imports** (`import * as Pages from '@/pages'`) are not tracked in the import map, aliased or otherwise.
- **Aliased dynamic imports** (`lazy: () => import('@/pages/Login')`) are NOT resolved — the alias resolver only runs during `buildImportMap` (static imports). Dynamic imports in `lazy()` callbacks are resolved against `baseDir` only. To work around this, ensure lazy-loaded components also have a static import at the top of the file, or supply the `aliases` config so the resolver at least handles the static side.
- **Computed vite/webpack aliases** (e.g. aliases built from `process.env` values or conditional logic) cannot be extracted by the regex parser. Use `IAliasResolverConfig.aliases` to supply these manually.
- **Monorepo tsconfig extends chains** (e.g. `tsconfig.base.json`) are not followed — only the `tsconfig.json` in `projectRoot` is read. Supply `aliases` manually if paths are defined in a parent config.

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
- `AliasResolver` is constructed once per `extract()` call — cheap, stateless after construction
- `buildImportMap` stores absolute paths so `resolveComponentPath` needs no baseDir for Strategy 1
- `AliasResolver.resolve()` sorts prefixes longest-first to prevent shorter aliases swallowing longer ones (e.g. `@` must not match before `@pages`)
- Two-pass attribute collection in both JSX and object extractors prevents the `isLazy` ordering bug
- `isTrue()` uses `ts.SyntaxKind.TrueKeyword` (not the non-existent `ts.isTrueKeyword`)
- Error boundaries in `visitNode` prevent a single bad node from failing the whole file
- `configFiles: []` disables all auto-detection — useful for CI environments or monorepos where config file location is non-standardLiteral(arg)) {
          return path.resolve(baseDir, arg.text).replace(/\.tsx?$/, '') + '.ts';
        }
      }
    }

    if (isLazy && ts.isCallExpression(expr)) {
      const importExpr = this.extractImportExpression(expr);
      if (importExpr) {
        return path.resolve(baseDir, importExpr).replace(/\.tsx?$/, '') + '.ts';
      }
    }

    return undefined;
  }

  private extractLazyComponentPath(expr: ts.Expression | undefined, baseDir: string): string | undefined {
    if (!expr) return undefined;

    // lazy: () => import('./pages/Login')
    if (ts.isArrowFunction(expr)) {
      const body = expr.body;
      if (ts.isCallExpression(body) && this.isImportCall(body)) {
        const arg = body.arguments[0];
        if (ts.isStringLiteral(arg)) {
          return path.resolve(baseDir, arg.text).replace(/\.tsx?$/, '') + '.ts';
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

  // isDynamicRoute
  // Returns true if the path contains a :param segment or a * wildcard.
  // Examples:
  //   '/user/:id'        → true
  //   '/posts/:postId'   → true
  //   '/dashboard/*'     → true
  //   '/login'           → false
  //   '/'                → false
  private isDynamicRoute(routePath: string): boolean {
    return /:(\w+)|\*/.test(routePath);
  }

  // isTrue
  // FIX: original used ts.isTrueKeyword which does not exist in the TS compiler API.
  // Correct check is node.kind === ts.SyntaxKind.TrueKeyword.
  private isTrue(node: ts.Expression): boolean {
    return (
      node.kind === ts.SyntaxKind.TrueKeyword ||
      (ts.isStringLiteral(node) && node.text === 'true') ||
      (ts.isNumericLiteral(node) && node.text !== '0')
    );
  }

  private detectLayoutComponent(node: ts.CallExpression): string | undefined {
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

// Maps component local name → relative import specifier.
// Built by buildImportMap() from the file's top-level import declarations.
// Used by resolveComponentPath() to find file paths for non-lazy components.
export interface IImportMap {
  [componentName: string]: string;
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
//     componentPath: 'src/pages/HomePage.ts',   ← resolved from import map
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
//   '/'          => 'src/pages/HomePage.ts',
//   '/user/:id'  => 'src/pages/UserProfile.ts'
// }
```

## Example Input/Output

### Example 1 — JSX Routes (Basic)

**Input:**
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

**Output:**
```typescript
{
  filePath: 'src/App.tsx',
  routes: [
    {
      path: '/',
      component: 'HomePage',
      componentPath: 'src/pages/HomePage.ts',   // resolved via importMap
      isLazy: false,
      isDynamic: false
    },
    {
      path: '/login',
      component: 'LoginPage',
      componentPath: undefined,                 // LoginPage not in imports → unresolved
      isLazy: false,
      isDynamic: false
    },
    {
      path: '/user/:id',
      component: 'UserProfile',
      componentPath: 'src/pages/UserProfile.ts', // resolved from lazy import()
      isLazy: true,
      isDynamic: true
    },
    {
      path: '/dashboard/*',
      component: 'DashboardPage',
      componentPath: 'src/pages/DashboardPage.ts', // resolved via importMap
      isLazy: false,
      isDynamic: true
    }
  ]
}
```

---

### Example 2 — `createBrowserRouter` Object Config (NEW)

This is the React Router v6 data router pattern. Routes are defined as a plain
array of objects and passed directly to `createBrowserRouter`.

**Input:**
```tsx
// src/router.tsx
import { createBrowserRouter } from 'react-router-dom';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';

const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/user/:id', lazy: () => import('./pages/UserProfile') },
]);

export default router;
```

**Output:**
```typescript
{
  filePath: 'src/router.tsx',
  routes: [
    {
      path: '/',
      component: 'HomePage',
      componentPath: 'src/pages/HomePage.ts',    // from importMap
      isLazy: false,
      isDynamic: false
    },
    {
      path: '/login',
      component: 'LoginPage',
      componentPath: 'src/pages/LoginPage.ts',   // from importMap
      isLazy: false,
      isDynamic: false
    },
    {
      path: '/user/:id',
      component: 'UserProfile',
      componentPath: 'src/pages/UserProfile.ts', // from lazy import()
      isLazy: true,
      isDynamic: true
    }
  ]
}
```

---

### Example 3 — Nested Children Routes with Path Stitching (NEW)

Child routes with relative paths are stitched onto their parent path.

**Input:**
```tsx
// src/router.tsx
import { createBrowserRouter } from 'react-router-dom';
import DashboardLayout from './pages/DashboardLayout';
import OverviewPage from './pages/Overview';
import SettingsPage from './pages/Settings';

const router = createBrowserRouter([
  {
    path: '/dashboard',
    element: <DashboardLayout />,
    children: [
      { index: true, element: <OverviewPage /> },         // inherits /dashboard
      { path: 'settings', element: <SettingsPage /> },    // relative → /dashboard/settings
      { path: '/admin', element: <AdminPage /> },         // absolute → /admin
    ]
  }
]);
```

**Output:**
```typescript
{
  filePath: 'src/router.tsx',
  routes: [
    // Parent route
    {
      path: '/dashboard',
      component: 'DashboardLayout',
      componentPath: 'src/pages/DashboardLayout.ts',
      isLazy: false,
      isDynamic: false
    },
    // Index child — inherits parent path, isIndex: true
    {
      path: '/dashboard',
      component: 'OverviewPage',
      componentPath: 'src/pages/Overview.ts',
      isLazy: false,
      isDynamic: false,
      metadata: { index: true }
    },
    // Relative child — stitched: '/dashboard' + '/' + 'settings'
    {
      path: '/dashboard/settings',
      component: 'SettingsPage',
      componentPath: 'src/pages/Settings.ts',
      isLazy: false,
      isDynamic: false
    },
    // Absolute child — kept as-is, NOT prefixed with /dashboard
    {
      path: '/admin',
      component: 'AdminPage',
      componentPath: undefined,
      isLazy: false,
      isDynamic: false
    }
  ]
}
```

---

### Example 4 — Index Route in JSX (NEW)

`<Route index element={<HomePage />} />` has no `path` attribute at all.

**Input:**
```tsx
<Routes>
  <Route path="/dashboard" element={<DashboardLayout />}>
    <Route index element={<DashboardHome />} />
    <Route path="settings" element={<Settings />} />
  </Route>
</Routes>
```

**Output:**
```typescript
routes: [
  {
    path: '/dashboard',
    component: 'DashboardLayout',
    componentPath: 'src/pages/DashboardLayout.ts',
    isLazy: false,
    isDynamic: false
  },
  {
    // index route: path is '' (empty string), metadata.index is true
    path: '',
    component: 'DashboardHome',
    componentPath: 'src/pages/DashboardHome.ts',
    isLazy: false,
    isDynamic: false,
    metadata: { index: true }
  },
  {
    path: 'settings',
    component: 'Settings',
    componentPath: 'src/pages/Settings.ts',
    isLazy: false,
    isDynamic: false
  }
]
```

---

### Example 5 — Import Map Resolution for Non-Lazy Routes (NEW)

Before this fix, `componentPath` was always `undefined` for non-lazy routes.
Now the analyzer cross-references the import statements at the top of the file.

**Input:**
```tsx
// src/App.tsx
import HomePage from './pages/HomePage';           // default import
import { LoginPage, RegisterPage } from './pages/auth'; // named imports
import DashboardPage from '../features/Dashboard'; // relative up-dir

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
    </Routes>
  );
}
```

**Import map built internally:**
```typescript
{
  HomePage:      './pages/HomePage',
  LoginPage:     './pages/auth',
  RegisterPage:  './pages/auth',
  DashboardPage: '../features/Dashboard'
}
```

**Output:**
```typescript
routes: [
  { path: '/',          component: 'HomePage',      componentPath: 'src/pages/HomePage.ts' },
  { path: '/login',     component: 'LoginPage',     componentPath: 'src/pages/auth.ts' },
  { path: '/register',  component: 'RegisterPage',  componentPath: 'src/pages/auth.ts' },
  { path: '/dashboard', component: 'DashboardPage', componentPath: 'src/features/Dashboard.ts' }
]
```

---

### Example 6 — Duplicate Route Path Warning (NEW)

**Input:**
```typescript
// Two separate files both define path "/"
const extractionA = { filePath: 'src/App.tsx',    routes: [{ path: '/', componentPath: 'src/pages/Home.ts', ... }] };
const extractionB = { filePath: 'src/Router.tsx', routes: [{ path: '/', componentPath: 'src/pages/Index.ts', ... }] };

const routeMap = analyzer.buildRouteMap([extractionA, extractionB]);
```

**Console output:**
```
[RouteAnalyzer] Duplicate route path "/" found in "src/Router.tsx". Overwriting previous entry.
```

**routeMap after:**
```
Map { '/' => 'src/pages/Index.ts' }   // last writer wins
```

## Dynamic Route Matching

For dynamic routes, the analyzer supports prefix matching:

```typescript
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

// matchRoute('/user/123',  '/user/:id') → true
// matchRoute('/user/john', '/user/:id') → true
// matchRoute('/user',      '/user/:id') → false
// matchRoute('/dashboard/x/y', '/dashboard/*') → true
```

## Testing Strategy

### Unit Tests

#### 1. JSX Route Extraction

```typescript
// src/analyzers/__tests__/route-analyzer.test.ts
import { RouteAnalyzer } from '../route-analyzer';

describe('RouteAnalyzer — JSX Routes', () => {
  const analyzer = new RouteAnalyzer();

  it('extracts a simple JSX route with element prop', async () => {
    const source = `
      import HomePage from './pages/HomePage';
      function App() {
        return <Route path="/" element={<HomePage />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]).toMatchObject({
      path: '/',
      component: 'HomePage',
      isLazy: false,
      isDynamic: false
    });
  });

  it('resolves componentPath for non-lazy route via import map', async () => {
    const source = `
      import HomePage from './pages/HomePage';
      function App() {
        return <Route path="/" element={<HomePage />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    // componentPath should be resolved even though route is not lazy
    expect(result.routes[0].componentPath).toMatch(/pages\/HomePage/);
  });

  it('extracts a lazy JSX route', async () => {
    const source = `
      function App() {
        return <Route path="/user/:id" lazy={() => import('./pages/UserProfile')} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes[0]).toMatchObject({
      path: '/user/:id',
      isLazy: true,
      isDynamic: true,
      componentPath: expect.stringContaining('pages/UserProfile')
    });
  });

  it('extracts index route (no path attribute)', async () => {
    const source = `
      import DashboardHome from './pages/DashboardHome';
      function App() {
        return <Route index element={<DashboardHome />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].metadata?.index).toBe(true);
    // path is empty string for index routes in JSX
    expect(result.routes[0].path).toBe('');
  });

  it('marks wildcard routes as dynamic', async () => {
    const source = `
      import DashboardPage from './pages/DashboardPage';
      function App() {
        return <Route path="/dashboard/*" element={<DashboardPage />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes[0].isDynamic).toBe(true);
  });

  it('does not treat non-Route JSX elements as routes', async () => {
    const source = `
      function App() {
        return <div><Link to="/">Home</Link></div>;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes).toHaveLength(0);
  });
});
```

#### 2. Object-Based / `createBrowserRouter` Routes (NEW)

```typescript
describe('RouteAnalyzer — createBrowserRouter', () => {
  const analyzer = new RouteAnalyzer();

  it('extracts routes from createBrowserRouter call', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import HomePage from './pages/HomePage';
      import LoginPage from './pages/LoginPage';

      const router = createBrowserRouter([
        { path: '/', element: <HomePage /> },
        { path: '/login', element: <LoginPage /> },
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    expect(result.routes).toHaveLength(2);
    expect(result.routes[0]).toMatchObject({ path: '/', component: 'HomePage' });
    expect(result.routes[1]).toMatchObject({ path: '/login', component: 'LoginPage' });
  });

  it('extracts routes from createHashRouter call', async () => {
    const source = `
      import { createHashRouter } from 'react-router-dom';
      import AboutPage from './pages/About';

      const router = createHashRouter([
        { path: '/about', element: <AboutPage /> },
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    expect(result.routes[0]).toMatchObject({ path: '/about', component: 'AboutPage' });
  });

  it('resolves componentPath via import map for object-based routes', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import HomePage from './pages/HomePage';

      const router = createBrowserRouter([
        { path: '/', element: <HomePage /> },
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    expect(result.routes[0].componentPath).toMatch(/pages\/HomePage/);
  });

  it('resolves componentPath from lazy import in object route', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';

      const router = createBrowserRouter([
        { path: '/user/:id', lazy: () => import('./pages/UserProfile') },
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    expect(result.routes[0]).toMatchObject({
      isLazy: true,
      componentPath: expect.stringContaining('pages/UserProfile')
    });
  });
});
```

#### 3. Nested Children Routes (NEW)

```typescript
describe('RouteAnalyzer — Nested Children Routes', () => {
  const analyzer = new RouteAnalyzer();

  it('stitches relative child path onto parent path', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import DashboardLayout from './pages/DashboardLayout';
      import SettingsPage from './pages/Settings';

      const router = createBrowserRouter([
        {
          path: '/dashboard',
          element: <DashboardLayout />,
          children: [
            { path: 'settings', element: <SettingsPage /> },
          ]
        }
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    const settingsRoute = result.routes.find(r => r.component === 'SettingsPage');
    // Relative 'settings' should be stitched onto '/dashboard'
    expect(settingsRoute?.path).toBe('/dashboard/settings');
  });

  it('does NOT prefix absolute child path with parent path', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import Layout from './pages/Layout';
      import AdminPage from './pages/Admin';

      const router = createBrowserRouter([
        {
          path: '/dashboard',
          element: <Layout />,
          children: [
            { path: '/admin', element: <AdminPage /> }, // absolute path
          ]
        }
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    const adminRoute = result.routes.find(r => r.component === 'AdminPage');
    expect(adminRoute?.path).toBe('/admin'); // NOT '/dashboard/admin'
  });

  it('handles index child route inheriting parent path', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import DashboardLayout from './pages/DashboardLayout';
      import OverviewPage from './pages/Overview';

      const router = createBrowserRouter([
        {
          path: '/dashboard',
          element: <DashboardLayout />,
          children: [
            { index: true, element: <OverviewPage /> },
          ]
        }
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    const indexRoute = result.routes.find(r => r.component === 'OverviewPage');
    expect(indexRoute?.path).toBe('/dashboard');
    expect(indexRoute?.metadata?.index).toBe(true);
  });

  it('handles three levels of nesting', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';

      const router = createBrowserRouter([
        {
          path: '/org',
          element: <OrgLayout />,
          children: [
            {
              path: 'team',
              element: <TeamLayout />,
              children: [
                { path: 'members', element: <MembersPage /> }
              ]
            }
          ]
        }
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    const membersRoute = result.routes.find(r => r.component === 'MembersPage');
    expect(membersRoute?.path).toBe('/org/team/members');
  });
});
```

#### 4. Component Path Resolution via Import Map (NEW)

```typescript
describe('RouteAnalyzer — Import Map Resolution', () => {
  const analyzer = new RouteAnalyzer();

  it('resolves default import to componentPath', async () => {
    const source = `
      import HomePage from './pages/HomePage';
      function App() {
        return <Route path="/" element={<HomePage />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes[0].componentPath).toMatch(/pages\/HomePage\.ts$/);
  });

  it('resolves named import to componentPath', async () => {
    const source = `
      import { LoginPage } from './pages/auth';
      function App() {
        return <Route path="/login" element={<LoginPage />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes[0].componentPath).toMatch(/pages\/auth\.ts$/);
  });

  it('does NOT resolve third-party package imports as componentPath', async () => {
    const source = `
      import { BrowserRouter } from 'react-router-dom';
      function App() {
        return <Route path="/" element={<BrowserRouter />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    // react-router-dom is third-party — should NOT appear in importMap
    expect(result.routes[0].componentPath).toBeUndefined();
  });

  it('returns undefined componentPath when component is not imported', async () => {
    // LoginPage is used but never imported at the top of file
    const source = `
      function App() {
        return <Route path="/login" element={<LoginPage />} />;
      }
    `;
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes[0].componentPath).toBeUndefined();
  });
});
```

#### 5. Route Map Building (Deduplication)

```typescript
describe('RouteAnalyzer — buildRouteMap', () => {
  const analyzer = new RouteAnalyzer();

  it('builds a map from path to componentPath', () => {
    const extractions = [
      {
        filePath: 'src/App.tsx',
        routes: [
          { path: '/', component: 'HomePage', componentPath: 'src/pages/HomePage.ts', isLazy: false, isDynamic: false }
        ]
      }
    ];
    const map = analyzer.buildRouteMap(extractions);
    expect(map.get('/')).toBe('src/pages/HomePage.ts');
  });

  it('omits routes with no componentPath from the map', () => {
    const extractions = [
      {
        filePath: 'src/App.tsx',
        routes: [
          { path: '/login', component: 'LoginPage', componentPath: undefined, isLazy: false, isDynamic: false }
        ]
      }
    ];
    const map = analyzer.buildRouteMap(extractions);
    expect(map.has('/login')).toBe(false);
  });

  it('logs a warning and keeps last entry on duplicate path', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const extractions = [
      { filePath: 'src/App.tsx',    routes: [{ path: '/', component: 'Home',  componentPath: 'src/pages/Home.ts',  isLazy: false, isDynamic: false }] },
      { filePath: 'src/Router.tsx', routes: [{ path: '/', component: 'Index', componentPath: 'src/pages/Index.ts', isLazy: false, isDynamic: false }] }
    ];
    const map = analyzer.buildRouteMap(extractions);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Duplicate route path "/"'));
    expect(map.get('/')).toBe('src/pages/Index.ts'); // last writer wins
    warnSpy.mockRestore();
  });
});
```

#### 6. Dynamic Route Matching

```typescript
describe('matchRoute', () => {
  it('matches exact static routes', () => {
    expect(matchRoute('/login', '/login')).toBe(true);
    expect(matchRoute('/login', '/register')).toBe(false);
  });

  it('matches :param segments', () => {
    expect(matchRoute('/user/123',  '/user/:id')).toBe(true);
    expect(matchRoute('/user/john', '/user/:id')).toBe(true);
    expect(matchRoute('/user',      '/user/:id')).toBe(false);
  });

  it('matches * wildcard', () => {
    expect(matchRoute('/dashboard/anything/here', '/dashboard/*')).toBe(true);
    expect(matchRoute('/dashboard',               '/dashboard/*')).toBe(true);
    expect(matchRoute('/other',                   '/dashboard/*')).toBe(false);
  });

  it('matches mixed :param and *', () => {
    expect(matchRoute('/org/42/docs/intro', '/org/:id/docs/*')).toBe(true);
  });
});
```

### Integration Tests

```typescript
describe('RouteAnalyzer — Integration', () => {
  const analyzer = new RouteAnalyzer();

  it('handles a real-world App.tsx with mixed JSX routes', async () => {
    const source = fs.readFileSync('src/__fixtures__/App.tsx', 'utf-8');
    const result = await analyzer.analyze({ filePath: 'src/App.tsx', sourceCode: source, routerFile: 'src/App.tsx' });
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.routes.every(r => typeof r.path === 'string')).toBe(true);
  });

  it('handles a real-world router.tsx with createBrowserRouter', async () => {
    const source = fs.readFileSync('src/__fixtures__/router.tsx', 'utf-8');
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    const routeMap = analyzer.buildRouteMap([result]);
    // Every lazy route should have a componentPath in the map
    const lazyRoutes = result.routes.filter(r => r.isLazy);
    lazyRoutes.forEach(r => {
      expect(routeMap.has(r.path)).toBe(true);
    });
  });

  it('full pipeline: analyze → buildRouteMap → matchRoute', async () => {
    const source = `
      import { createBrowserRouter } from 'react-router-dom';
      import HomePage from './pages/HomePage';

      const router = createBrowserRouter([
        { path: '/', element: <HomePage /> },
        { path: '/user/:id', lazy: () => import('./pages/UserProfile') },
        {
          path: '/dashboard',
          element: <DashboardLayout />,
          children: [
            { path: 'settings', element: <SettingsPage /> }
          ]
        }
      ]);
    `;
    const result = await analyzer.analyze({ filePath: 'src/router.tsx', sourceCode: source, routerFile: 'src/router.tsx' });
    const routeMap = analyzer.buildRouteMap([result]);

    // Static route
    expect(matchRoute('/', '/')).toBe(true);

    // Dynamic route
    expect(matchRoute('/user/99', '/user/:id')).toBe(true);

    // Nested stitched route
    const settingsRoute = result.routes.find(r => r.path === '/dashboard/settings');
    expect(settingsRoute).toBeDefined();

    // Route map covers all resolvable paths
    expect(routeMap.size).toBeGreaterThan(0);
  });
});
```

## Known Limitations

- **Layout component detection via JSX wrapping** (`<Layout><Route /></Layout>`) is not yet implemented. Currently only the `wrapper` property in `createBrowserRouter` options is checked.
- **`componentPath` for named exports from barrel files** (e.g. `import { A, B, C } from './pages'`) will resolve to the barrel file path, not the individual component file. This is acceptable for test matching but may require a deeper resolution step for high precision.
- **Namespace imports** (`import * as Pages from './pages'`) are not tracked in the import map.

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
- `buildImportMap` runs before AST traversal so `resolveComponentPath` always has fresh data
- Two-pass attribute collection in both JSX and object extractors prevents the `isLazy` ordering bug
- `isTrue()` uses `ts.SyntaxKind.TrueKeyword` (not the non-existent `ts.isTrueKeyword`)
- Error boundaries in `visitNode` prevent a single bad node from failing the whole file