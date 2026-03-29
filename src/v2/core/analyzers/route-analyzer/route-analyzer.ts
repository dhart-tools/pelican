import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

import { BaseAnalyzer } from '@v2/core/analyzers/base';
import {
  IRouteExtractionResult,
  IRouteDef,
  IImportMap,
  IAliasMap,
  IAliasResolverConfig,
} from '@v2/types/analyzers';
import { EAnalyzerName } from '@v2/utils/enums';

// =============================================================================
// AliasResolver
// =============================================================================
// Responsible for loading alias definitions from project config files and
// resolving aliased import paths into absolute filesystem paths.
//
// Priority order (highest → lowest, later entries win):
//   1. tsconfig.json  compilerOptions.paths
//   2. vite.config.ts resolve.alias
//   3. webpack.config.js resolve.alias
//   4. User-supplied aliases (IAliasResolverConfig.aliases) ← always wins
//
// Supported alias styles:
//   '@/'       → e.g. import X from '@/pages/Home'   (slash suffix)
//   '@pages'   → e.g. import X from '@pages/Home'    (named, no slash)
//   '~/'       → e.g. import X from '~/pages/Home'   (tilde)
//   arbitrary  → any custom prefix the user defines
//
// What counts as an alias?
//   Any import specifier that does NOT start with '.' or '/' is a candidate.
//   We test each known prefix against the specifier. If it matches, we replace
//   the prefix with the resolved absolute directory and re-join the rest of the
//   path segments.
//
// Example resolution:
//   aliasMap  = { '@': '/project/src' }
//   specifier = '@/pages/HomePage'
//   step 1: prefix '@' matches start of '@/pages/HomePage' (after stripping '/')
//   step 2: remainder = 'pages/HomePage'
//   step 3: result = path.join('/project/src', 'pages/HomePage')
//         = '/project/src/pages/HomePage'
export class AliasResolver {
  private aliasMap: IAliasMap = {};

  constructor(config: IAliasResolverConfig = {}) {
    const {
      projectRoot = process.cwd(),
      aliases = {},
      configFiles = ['tsconfig', 'vite', 'webpack'],
    } = config;

    // Load from each requested config source in priority order.
    // User-supplied aliases are merged last so they always win.
    if (configFiles.includes('tsconfig')) {
      this.mergeAliases(this.loadFromTsConfig(projectRoot));
    }
    if (configFiles.includes('vite')) {
      this.mergeAliases(this.loadFromViteConfig(projectRoot));
    }
    if (configFiles.includes('webpack')) {
      this.mergeAliases(this.loadFromWebpackConfig(projectRoot));
    }

    // User overrides — applied last, highest priority
    const resolvedUserAliases: IAliasMap = {};
    for (const [prefix, target] of Object.entries(aliases)) {
      // User may supply relative paths like { '@': 'src' } — resolve them
      resolvedUserAliases[prefix] = path.isAbsolute(target)
        ? target
        : path.resolve(projectRoot, target);
    }
    this.mergeAliases(resolvedUserAliases);
  }

  // ---------------------------------------------------------------------------
  // resolve
  // ---------------------------------------------------------------------------
  // Given an import specifier that may contain an alias prefix, returns the
  // equivalent absolute path. Returns the original specifier unchanged if no
  // alias matches (so regular relative imports pass through untouched).
  //
  // Examples:
  //   resolve('@/pages/HomePage')   → '/project/src/pages/HomePage'
  //   resolve('@pages/Login')        → '/project/src/pages/Login'
  //   resolve('~/utils/format')      → '/project/src/utils/format'
  //   resolve('./pages/HomePage')    → './pages/HomePage'  (no alias, unchanged)
  //   resolve('react')               → 'react'             (no alias, unchanged)
  resolve(specifier: string): string {
    // Fast path: relative and absolute imports never contain aliases
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      return specifier;
    }

    // Try each registered alias prefix, longest first to avoid ambiguity.
    // e.g. '@components' must be tested before '@' or it would match the '@'
    // prefix and produce a wrong path.
    const sortedPrefixes = Object.keys(this.aliasMap).sort(
      (a, b) => b.length - a.length
    );

    for (const prefix of sortedPrefixes) {
      const target = this.aliasMap[prefix];

      // Match prefix exactly, or prefix followed by '/' (so '@' matches
      // '@/pages' but does NOT match '@pages' when both are registered).
      if (specifier === prefix) {
        return target;
      }
      if (specifier.startsWith(prefix + '/')) {
        const remainder = specifier.slice(prefix.length + 1); // strip 'prefix/'
        return path.join(target, remainder);
      }
    }

    // No alias matched — return as-is (will be filtered out later as third-party)
    return specifier;
  }

  // Returns a copy of the current alias map (useful for debugging / tests)
  getAliasMap(): IAliasMap {
    return { ...this.aliasMap };
  }

  // ---------------------------------------------------------------------------
  // loadFromTsConfig
  // ---------------------------------------------------------------------------
  // Reads compilerOptions.paths from tsconfig.json.
  //
  // tsconfig paths format:
  //   "paths": {
  //     "@/*":        ["src/*"],          ← glob-style, strip the /*
  //     "@pages/*":   ["src/pages/*"],
  //     "@utils":     ["src/utils/index"] ← non-glob (exact alias)
  //   }
  //   "baseUrl": "."                      ← paths are relative to baseUrl
  //
  // We strip the trailing /* from both the key and the value because we handle
  // the remainder ourselves in resolve(). Non-glob entries are kept as-is.
  //
  // Example output:
  //   { '@': '/project/src', '@pages': '/project/src/pages' }
  private loadFromTsConfig(projectRoot: string): IAliasMap {
    const configPath = path.join(projectRoot, 'tsconfig.json');
    if (!fs.existsSync(configPath)) return {};

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      // tsconfig files may contain comments — use ts.parseConfigFileTextToJson
      const { config, error } = ts.parseConfigFileTextToJson(configPath, raw);
      if (error || !config?.compilerOptions?.paths) return {};

      const baseUrl = config.compilerOptions.baseUrl ?? '.';
      const absBaseUrl = path.resolve(projectRoot, baseUrl);
      const paths: Record<string, string[]> = config.compilerOptions.paths;
      const result: IAliasMap = {};

      for (const [key, values] of Object.entries(paths)) {
        if (!Array.isArray(values) || values.length === 0) continue;

        // Strip trailing /* from key: '@/*' → '@'
        const prefix = key.replace(/\/\*$/, '');
        // Strip trailing /* from value: 'src/*' → 'src'
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
  // Reads resolve.alias from vite.config.ts / vite.config.js.
  //
  // Vite alias formats:
  //
  //   Format A — object:
  //     resolve: { alias: { '@': path.resolve(__dirname, 'src') } }
  //
  //   Format B — array:
  //     resolve: { alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }] }
  //
  // We use a regex-based approach because vite.config.ts is TypeScript and
  // cannot be require()'d directly. We look for string literals and
  // path.resolve/path.join call patterns.
  //
  // Limitation: only statically analyzable aliases are extracted. Dynamic
  // aliases (e.g. computed from env vars) will not be resolved — fall back
  // to user-supplied aliases in that case.
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
      // Pattern: '@'  : path.resolve(__dirname, 'src')
      //          "@/" : path.resolve(__dirname, './src')
      // Capture: group 1 = alias key, group 2 = path argument
      const objPattern = /['"]([^'"]+)['"]\s*:\s*path\.(?:resolve|join)\s*\([^,)]+,\s*['"]([^'"]+)['"]\)/g;
      let m: RegExpExecArray | null;
      while ((m = objPattern.exec(raw)) !== null) {
        const prefix = m[1].replace(/\/\*$/, '');
        const rel = m[2].replace(/\/\*$/, '');
        result[prefix] = path.resolve(projectRoot, rel);
      }

      // Pattern (array format): find: '@', replacement: path.resolve(__dirname, 'src')
      const arrPattern = /find\s*:\s*['"]([^'"]+)['"]\s*,\s*replacement\s*:\s*path\.(?:resolve|join)\s*\([^,)]+,\s*['"]([^'"]+)['"]\)/g;
      while ((m = arrPattern.exec(raw)) !== null) {
        const prefix = m[1].replace(/\/\*$/, '');
        const rel = m[2].replace(/\/\*$/, '');
        result[prefix] = path.resolve(projectRoot, rel);
      }

      // Pattern: plain string replacement (no path.resolve):
      //   find: '@', replacement: '/absolute/path'
      //   find: '@', replacement: './relative/path'
      const strPattern = /find\s*:\s*['"]([^'"]+)['"]\s*,\s*replacement\s*:\s*['"]([^'"]+)['"]/g;
      while ((m = strPattern.exec(raw)) !== null) {
        const prefix = m[1].replace(/\/\*$/, '');
        const target = m[2].replace(/\/\*$/, '');
        result[prefix] = path.resolve(projectRoot, target);
      }
    } catch {
      console.warn('[AliasResolver] Failed to parse vite config');
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // loadFromWebpackConfig
  // ---------------------------------------------------------------------------
  // Reads resolve.alias from webpack.config.js / webpack.config.ts.
  //
  // Webpack alias format:
  //   resolve: {
  //     alias: {
  //       '@': path.resolve(__dirname, 'src/'),
  //       '@components': path.resolve(__dirname, 'src/components/'),
  //     }
  //   }
  //
  // Same regex approach as Vite. Trailing slashes in webpack aliases are
  // stripped because we re-add the separator in resolve().
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
      // Pattern: '@': path.resolve(__dirname, 'src/')
      const pattern = /['"]([^'"]+)['"]\s*:\s*path\.(?:resolve|join)\s*\([^,)]+,\s*['"]([^'"]+)['"]\)/g;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(raw)) !== null) {
        const prefix = m[1].replace(/\/?$/, ''); // strip trailing slash
        const rel = m[2].replace(/\/?$/, '');
        result[prefix] = path.resolve(projectRoot, rel);
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

// =============================================================================
// RouteAnalyzer
// =============================================================================

/**
 * RouteAnalyzer: Extracts route definitions from React Router code and builds a mapping
 * between URL patterns and component files.
 *
 * This analyzer supports:
 * 1. JSX declarations: <Route path="/login" element={<LoginPage />} />
 * 2. Object-based configs: { path: "/login", element: <LoginPage /> }
 * 3. Lazy-loaded routes: lazy(() => import("./pages/Login"))
 * 4. Data-router APIs: createBrowserRouter([...]) / createHashRouter([...])
 * 5. Nested routes with recursive path stitching.
 * 6. Path aliases: @/, @pages/, ~/, and arbitrary custom prefixes resolved
 *    from tsconfig.json, vite.config.ts, webpack.config.js, or user config.
 */
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
   * @param input.filePath      Path to the file being analyzed.
   * @param input.sourceCode    Raw source code of the file.
   * @param input.aliasConfig   Optional alias resolver configuration.
   *                            If omitted, aliases are auto-detected from
   *                            tsconfig / vite / webpack in process.cwd().
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

    const result: IRouteExtractionResult = {
      filePath,
      routes: [],
    };

    // ─── STEP 1: Build alias resolver ────────────────────────────────────────
    // AliasResolver reads tsconfig/vite/webpack and merges user-supplied aliases.
    // We build this once per file analysis and pass it into buildImportMap so
    // that aliased specifiers are expanded before being stored.
    //
    // If the project root is not specified, we default to the directory of the
    // file being analyzed (reasonable fallback for monorepos or nested packages).
    const resolver = new AliasResolver({
      projectRoot: aliasConfig?.projectRoot ?? path.dirname(filePath),
      ...aliasConfig,
    });

    // ─── STEP 2: Build import map ─────────────────────────────────────────────
    // We scan imports first so we can resolve componentPath for non-lazy routes.
    // The resolver is passed in so aliased paths are expanded at this stage.
    const importMap = this.buildImportMap(sourceFile, resolver, path.dirname(filePath));

    // ─── STEP 3: Walk the AST and extract routes ──────────────────────────────
    this.visitNode(sourceFile, result, path.dirname(filePath), importMap);

    return result;
  }

  /**
   * Required by BaseAnalyzer; handles indexing of extracted route data.
   */
  index(output: IRouteExtractionResult): void {
    console.log(`[RouteAnalyzer] Indexing ${output.routes.length} routes from ${output.filePath}`);
  }

  /**
   * Converts an array of extraction results into a flat Map<path, componentPath>.
   * Warns on duplicate route paths and keeps the last writer.
   *
   * @param extractions Array of extraction results from multiple files.
   * @returns A Map where the key is the route path and the value is the component file path.
   */
  buildRouteMap(extractions: IRouteExtractionResult[]): Map<string, string> {
    const routeMap = new Map<string, string>();

    for (const extraction of extractions) {
      for (const route of extraction.routes) {
        if (route.componentPath) {
          if (routeMap.has(route.path)) {
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

  // ─── Core Extraction Logic ────────────────────────────────────────────────

  /**
   * Scans all ImportDeclaration nodes to build a mapping from local component
   * name → resolved absolute file path.
   *
   * The AliasResolver is applied to every module specifier before it is stored,
   * so aliased imports produce correct absolute paths just like relative ones.
   *
   * BEFORE alias support (old behaviour):
   *   import HomePage from '@/pages/HomePage'
   *   → skipped entirely (does not start with '.' or '/')
   *   → componentPath always undefined for aliased components
   *
   * AFTER alias support (new behaviour):
   *   aliasMap = { '@': '/project/src' }
   *   import HomePage from '@/pages/HomePage'
   *   → resolver.resolve('@/pages/HomePage') = '/project/src/pages/HomePage'
   *   → importMap['HomePage'] = '/project/src/pages/HomePage'
   *   → componentPath resolved correctly downstream
   *
   * Handles:
   *   import HomePage from './pages/HomePage'           → default import, relative
   *   import HomePage from '@/pages/HomePage'           → default import, aliased
   *   import { LoginPage } from '@pages/auth'           → named import, aliased
   *   import A, { B } from '@/pages/misc'               → mixed, aliased
   *
   * Does NOT handle:
   *   import * as Pages from '@/pages'                  → namespace import, skipped
   *   import 'styles.css'                               → side-effect, skipped
   *   import { BrowserRouter } from 'react-router-dom'  → unresolvable third-party, skipped
   */
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

      // Run the specifier through the alias resolver.
      // If it is a relative/absolute path, it passes through unchanged.
      // If it matches a known alias prefix, it is expanded to an absolute path.
      // If it is an unresolvable third-party package ('react', 'lodash'), it
      // is returned unchanged and then filtered out by the check below.
      const resolvedSpecifier = resolver.resolve(rawSpecifier);

      // After alias resolution, any import that is still not a local path
      // (absolute or relative) is a third-party package — skip it.
      if (!resolvedSpecifier.startsWith('.') && !resolvedSpecifier.startsWith('/')) continue;

      // Convert to absolute path so resolveComponentPath can use it directly
      // without needing baseDir again.
      const absoluteSpecifier = path.isAbsolute(resolvedSpecifier)
        ? resolvedSpecifier
        : path.resolve(baseDir, resolvedSpecifier);

      const clause = statement.importClause;
      if (!clause) continue;

      // Default import: import HomePage from '@/pages/HomePage'
      if (clause.name) {
        importMap[clause.name.text] = absoluteSpecifier;
      }

      // Named imports: import { LoginPage, RegisterPage } from '@pages/auth'
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          importMap[element.name.text] = absoluteSpecifier;
        }
      }
    }

    return importMap;
  }

  /**
   * Recursively walks the AST to detect JSX routes or router configurations.
   */
  private visitNode(
    node: ts.Node,
    result: IRouteExtractionResult,
    baseDir: string,
    importMap: IImportMap
  ): void {
    if (this.processedNodes.has(node)) {
      return;
    }

    try {
      // 1. Detect JSX Route elements: <Route path="/" element={<Home />} />
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) {
        this.extractRouteFromJSX(node, result, baseDir, importMap);
      }

      // 2. Detect createBrowserRouter([...]) or createHashRouter([...])
      if (ts.isCallExpression(node)) {
        this.extractRoutesFromRouterCall(node, result, baseDir, importMap);
      }

      // 3. Fallback: Standalone array literals (might be route configs).
      // Only process if the first element looks like a route object.
      if (ts.isArrayLiteralExpression(node) && node.elements.length > 0) {
        const firstArg = node.elements[0];
        if (ts.isObjectLiteralExpression(firstArg)) {
          const hasRouteKeys = firstArg.properties.some((p) => {
            const name = p.name?.getText();
            return name === 'path' || name === 'element' || name === 'lazy' || name === 'index';
          });
          if (hasRouteKeys) {
            this.extractRoutesFromArray(node, result, baseDir, importMap, '');
          }
        }
      }
    } catch (err) {
      console.warn(`[RouteAnalyzer] Failed to process node at pos ${node.pos}: ${err}`);
    }

    ts.forEachChild(node, (child) =>
      this.visitNode(child, result, baseDir, importMap)
    );
  }

  // ─── JSX-Specific Extraction ──────────────────────────────────────────────

  /**
   * Extracts route data from JSX <Route /> elements.
   * Uses a two-pass attribute collection to avoid the isLazy ordering bug.
   */
  private extractRouteFromJSX(
    node: ts.JsxSelfClosingElement | ts.JsxElement,
    result: IRouteExtractionResult,
    baseDir: string,
    importMap: IImportMap
  ): void {
    const openingElement = ts.isJsxSelfClosingElement(node) ? node : node.openingElement;
    const tagName = openingElement.tagName.getFullText().trim();

    if (tagName !== 'Route') return;

    let routePath: string | null = null;
    let componentName: string | null = null;
    let isLazy = false;
    let isIndex = false;

    const attrs: Record<string, ts.JsxAttribute> = {};
    for (const attr of openingElement.attributes.properties) {
      if (ts.isJsxAttribute(attr)) {
        attrs[attr.name.getText()] = attr;
      }
    }

    isLazy = 'lazy' in attrs;

    if ('path' in attrs) {
      const init = attrs['path'].initializer;
      if (init && ts.isStringLiteral(init)) {
        routePath = init.text;
      }
    }

    if ('index' in attrs) {
      isIndex = true;
      routePath = routePath ?? '';
    }

    if ('element' in attrs) {
      const expr = this.unwrapJsxExpression(attrs['element'].initializer as ts.JsxExpression);
      componentName = this.extractComponentName(expr);
      const resolvedPath = this.resolveComponentPath(componentName, expr, baseDir, importMap, isLazy);

      if (resolvedPath || (routePath !== null && componentName)) {
        result.routes.push({
          path: routePath ?? '',
          component: componentName ?? 'Unknown',
          componentPath: resolvedPath,
          isLazy,
          isDynamic: this.isDynamicRoute(routePath ?? ''),
          metadata: { index: isIndex },
        });
        return;
      }
    }

    if ('lazy' in attrs) {
      const lazyExpr = this.unwrapJsxExpression(attrs['lazy'].initializer as ts.JsxExpression);
      const lazyPath = this.extractLazyComponentPath(lazyExpr, baseDir);
      if (routePath !== null) {
        result.routes.push({
          path: routePath,
          component: lazyPath ? path.basename(lazyPath, '.ts') : 'LazyComponent',
          componentPath: lazyPath,
          isLazy: true,
          isDynamic: this.isDynamicRoute(routePath),
          metadata: { index: isIndex },
        });
      }
    }
  }

  // ─── Router Configuration Extraction ─────────────────────────────────────

  /**
   * Processes createBrowserRouter / createHashRouter calls to extract
   * object-based routes from the first array argument.
   */
  private extractRoutesFromRouterCall(
    node: ts.CallExpression,
    result: IRouteExtractionResult,
    baseDir: string,
    importMap: IImportMap
  ): void {
    const callee = node.expression;
    if (!ts.isIdentifier(callee)) return;
    if (callee.text !== 'createBrowserRouter' && callee.text !== 'createHashRouter') return;

    const firstArg = node.arguments[0];
    if (firstArg && ts.isArrayLiteralExpression(firstArg)) {
      this.extractRoutesFromArray(firstArg, result, baseDir, importMap, '');
    }
  }

  /**
   * Iterates through an array of route objects and extracts definitions.
   * Recurses into children arrays, passing the parent route path as a prefix.
   */
  private extractRoutesFromArray(
    node: ts.ArrayLiteralExpression,
    result: IRouteExtractionResult,
    baseDir: string,
    importMap: IImportMap,
    parentPath: string
  ): void {
    this.processedNodes.add(node);
    for (const element of node.elements) {
      if (ts.isObjectLiteralExpression(element)) {
        const route = this.extractRouteFromObject(element, baseDir, importMap, parentPath);
        if (route) {
          result.routes.push(route);

          const childrenProp = element.properties.find(
            (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'children'
          ) as ts.PropertyAssignment | undefined;

          if (childrenProp && ts.isArrayLiteralExpression(childrenProp.initializer)) {
            this.extractRoutesFromArray(
              childrenProp.initializer,
              result,
              baseDir,
              importMap,
              route.path
            );
          }
        }
      }
    }
  }

  /**
   * Parses a single route object literal into an IRouteDef.
   * Uses two-pass prop collection to ensure isLazy is known before resolving paths.
   */
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

    const props: Record<string, ts.PropertyAssignment> = {};
    for (const prop of obj.properties) {
      if (ts.isPropertyAssignment(prop)) {
        props[prop.name.getText()] = prop;
      }
    }

    isLazy = 'lazy' in props;

    if ('path' in props && ts.isStringLiteral(props['path'].initializer)) {
      const rawPath = props['path'].initializer.text;
      routePath = (rawPath.startsWith('/') || !parentPath)
        ? rawPath
        : `${parentPath}/${rawPath}`.replace(/\/\//g, '/');
    }

    if ('index' in props) {
      isIndex = props['index'].initializer.kind === ts.SyntaxKind.TrueKeyword;
      if (isIndex) routePath = parentPath || '/';
    }

    if ('element' in props) {
      componentName = this.extractComponentName(props['element'].initializer);
      componentPath = this.resolveComponentPath(componentName, props['element'].initializer, baseDir, importMap, isLazy);
    }

    if ('lazy' in props) {
      componentPath = this.extractLazyComponentPath(props['lazy'].initializer, baseDir);
      if (!componentName && componentPath) {
        componentName = path.basename(componentPath, '.ts');
      }
    }

    if ((routePath !== null || isIndex) && (componentName || componentPath)) {
      return {
        path: routePath ?? parentPath ?? '/',
        component: componentName ?? 'Unknown',
        componentPath,
        isLazy,
        isDynamic: this.isDynamicRoute(routePath ?? ''),
        metadata: { index: isIndex },
      };
    }

    return null;
  }

  // ─── Path Resolution & Helpers ────────────────────────────────────────────

  /**
   * Resolves a component's absolute file path.
   *
   * Strategy 1 — Import map lookup:
   *   The importMap now stores ABSOLUTE paths (after alias expansion), so we
   *   simply normalise the extension and return. No baseDir math needed here.
   *
   *   Example:
   *     importMap['HomePage'] = '/project/src/pages/HomePage'  (set by buildImportMap)
   *     → returns '/project/src/pages/HomePage.ts'
   *
   * Strategy 2 — Inline import() call (lazy routes without an import statement):
   *   If the expression is a dynamic import() call, we resolve its argument
   *   against baseDir. Aliased import() paths (e.g. import('@/pages/Login'))
   *   are NOT currently expanded here — lazy aliased imports must be listed in
   *   the top-of-file import statements to be resolved. This is a known
   *   limitation documented in Known Limitations below.
   */
  private resolveComponentPath(
    componentName: string | null,
    expr: ts.Expression | undefined,
    baseDir: string,
    importMap: IImportMap,
    isLazy: boolean
  ): string | undefined {
    // Strategy 1: Import map (absolute path, alias already expanded)
    if (componentName && importMap[componentName]) {
      return importMap[componentName].replace(/\.tsx?$/, '') + '.ts';
    }

    // Strategy 2: Inline import() call
    if (expr && ts.isCallExpression(expr) && this.isImportCall(expr) && expr.arguments.length > 0) {
      const arg = expr.arguments[0];
      if (ts.isStringLiteral(arg)) {
        return path.resolve(baseDir, arg.text).replace(/\.tsx?$/, '') + '.ts';
      }
    }

    return undefined;
  }

  private extractLazyComponentPath(expr: ts.Expression | undefined, baseDir: string): string | undefined {
    if (!expr) return undefined;

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
    return expr.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(expr) && expr.text === 'import');
  }

  private extractComponentName(expr: ts.Expression | undefined): string | null {
    if (!expr) return null;
    if (ts.isJsxSelfClosingElement(expr)) return expr.tagName.getText();
    if (ts.isJsxElement(expr)) return expr.openingElement.tagName.getText();
    if (ts.isIdentifier(expr)) return expr.text;
    return null;
  }

  private unwrapJsxExpression(node: ts.JsxExpression | ts.StringLiteral | undefined): ts.Expression | undefined {
    if (!node) return undefined;
    return ts.isJsxExpression(node) ? node.expression : undefined;
  }

  private isDynamicRoute(routePath: string): boolean {
    return /:(\w+)|\*/.test(routePath);
  }
}