import * as fs from 'fs';
import * as path from 'path';

import * as ts from 'typescript';

import { BaseAnalyzer } from '@/core/analyzers/base';
import {
  IRouteExtractionResult,
  IRouteDef,
  IImportMap,
  IAliasMap,
  IAliasResolverConfig,
} from '@/types/analyzers';
import { EAnalyzerName } from '@/utils/enums';

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
    const sortedPrefixes = Object.keys(this.aliasMap).sort((a, b) => b.length - a.length);

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
      if (fs.existsSync(p)) {
        raw = fs.readFileSync(p, 'utf-8');
        break;
      }
    }
    if (!raw) return {};

    const result: IAliasMap = {};

    try {
      // Pattern: '@'  : path.resolve(__dirname, 'src')
      //          "@/" : path.resolve(__dirname, './src')
      // Capture: group 1 = alias key, group 2 = path argument
      const objPattern =
        /['"]([^'"]+)['"]\s*:\s*path\.(?:resolve|join)\s*\([^,)]+,\s*['"]([^'"]+)['"]\)/g;
      let m: RegExpExecArray | null;
      while ((m = objPattern.exec(raw)) !== null) {
        const prefix = m[1].replace(/\/\*$/, '');
        const rel = m[2].replace(/\/\*$/, '');
        result[prefix] = path.resolve(projectRoot, rel);
      }

      // Pattern (array format): find: '@', replacement: path.resolve(__dirname, 'src')
      const arrPattern =
        /find\s*:\s*['"]([^'"]+)['"]\s*,\s*replacement\s*:\s*path\.(?:resolve|join)\s*\([^,)]+,\s*['"]([^'"]+)['"]\)/g;
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
      if (fs.existsSync(p)) {
        raw = fs.readFileSync(p, 'utf-8');
        break;
      }
    }
    if (!raw) return {};

    const result: IAliasMap = {};

    try {
      // Pattern: '@': path.resolve(__dirname, 'src/')
      const pattern =
        /['"]([^'"]+)['"]\s*:\s*path\.(?:resolve|join)\s*\([^,)]+,\s*['"]([^'"]+)['"]\)/g;
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
    // Normalize keys by stripping a trailing slash. resolve() matches a prefix
    // as either an exact hit or `prefix + '/'`, so a key stored WITH its slash
    // (e.g. user config `{"@dm/": "src/dm/"}`) would be tested as `@dm//` and
    // never match `@dm/components`. Strip it once here so both `@dm` and `@dm/`
    // configs behave identically. Targets keep no trailing slash so path.join
    // in resolve() produces clean paths.
    for (const [key, value] of Object.entries(incoming)) {
      const normKey = key.endsWith('/') ? key.slice(0, -1) : key;
      const normValue = value.endsWith('/') ? value.slice(0, -1) : value;
      this.aliasMap[normKey] = normValue;
    }
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
/**
 * Callback signature for resolving an imported const-object's keys to their
 * string-literal values. Returns Map<exportedConstName, Record<key, value>>.
 *
 * Example: importPath = '@dm/constants/Routes', fromFile = '<router>.tsx'
 *   → Map { 'RouterPath' → { MANAGE_DEVICES: '/managedevices', ... } }
 *
 * Mirrors the cypress-extractor's resolveTsConstImport plumbing so the
 * registry-builder can pass the same resolver through.
 */
export type ResolveConstImport = (
  importPath: string,
) => Promise<Map<string, Record<string, string>> | null>;

/**
 * One `export … from './x'` declaration in a barrel file.
 *  - `{ star: true, from }`           → `export * from './x'`
 *  - `{ exported, local, from }`      → `export { local as exported } from './x'`
 *    (`local` is `'default'` for `export { default as Foo } from './x'`)
 */
type IReExport =
  | { star: true; from: string }
  | { star: false; exported: string; local: string; from: string };

export class RouteAnalyzer extends BaseAnalyzer<
  {
    filePath: string;
    sourceCode: string;
    aliasConfig?: IAliasResolverConfig;
    resolveConstImport?: ResolveConstImport;
  },
  IRouteExtractionResult
> {
  name = EAnalyzerName.ROUTE_ANALYZER;
  version = '1.0.0';
  dependencies = [EAnalyzerName.SOURCE_EXTRACTOR];

  private processedNodes = new Set<ts.Node>();
  // Per-extraction cache: rawSpecifier → constName → { key: value }.
  // Cleared at the start of every extract() call so cross-file leaks can't
  // happen. Keyed by raw specifier (the import path before alias expansion)
  // because that's what the AST nodes carry.
  private constCache = new Map<string, Map<string, Record<string, string>>>();

  // Per-extraction caches for barrel resolution (cleared each extract()):
  //   realFileCache: absPathNoExt → first existing on-disk file (or null)
  //   reExportCache: realFile → parsed `export … from` declarations
  private realFileCache = new Map<string, string | null>();
  private reExportCache = new Map<string, IReExport[]>();

  // Depth ceiling for following barrel re-export chains
  // (barrel → sub-barrel → component). Cycles are also guarded via a visited set.
  private static readonly MAX_BARREL_DEPTH = 5;

  /**
   * Orchestrates the extraction of routes from a source file.
   *
   * @param input.filePath           Path to the file being analyzed.
   * @param input.sourceCode         Raw source code of the file.
   * @param input.aliasConfig        Optional alias resolver configuration.
   *                                 If omitted, aliases are auto-detected from
   *                                 tsconfig / vite / webpack in process.cwd().
   * @param input.resolveConstImport Optional callback for resolving
   *                                 `path={Const.MEMBER}` to a string literal
   *                                 by reading the imported const file. Without
   *                                 it, non-literal paths are silently skipped.
   */
  async extract(input: {
    filePath: string;
    sourceCode: string;
    aliasConfig?: IAliasResolverConfig;
    resolveConstImport?: ResolveConstImport;
  }): Promise<IRouteExtractionResult> {
    const { filePath, sourceCode, aliasConfig, resolveConstImport } = input;
    this.processedNodes.clear();
    this.constCache.clear();
    this.realFileCache.clear();
    this.reExportCache.clear();

    const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);

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

    // ─── STEP 3a: Pre-resolve const imports the file actually uses ────────────
    // Find every `import { X } from '...'` or `import * as X from '...'` whose
    // local name appears in a PropertyAccessExpression inside a JSX `path=` attr
    // (e.g. `path={RouterPath.MANAGE_DEVICES}` → must resolve `RouterPath`).
    // This pre-pass keeps the AST walk synchronous; resolution happens once per
    // unique specifier.
    if (resolveConstImport) {
      const namesUsedInPath = this.collectConstNamesUsedInRoutePaths(sourceFile);
      const specifiersToResolve = new Set<string>();
      for (const stmt of sourceFile.statements) {
        if (!ts.isImportDeclaration(stmt)) continue;
        if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
        const spec = stmt.moduleSpecifier.text;
        const clause = stmt.importClause;
        if (!clause) continue;
        let touchesPath = false;
        if (clause.name && namesUsedInPath.has(clause.name.text)) touchesPath = true;
        if (clause.namedBindings) {
          if (ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              if (namesUsedInPath.has(el.name.text)) touchesPath = true;
            }
          } else if (ts.isNamespaceImport(clause.namedBindings)) {
            if (namesUsedInPath.has(clause.namedBindings.name.text)) touchesPath = true;
          }
        }
        if (touchesPath) specifiersToResolve.add(spec);
      }
      for (const spec of specifiersToResolve) {
        try {
          const resolved = await resolveConstImport(spec);
          if (resolved) this.constCache.set(spec, resolved);
        } catch {
          // Best-effort; keep walking the AST without the const value.
        }
      }
    }

    // ─── STEP 3b: Walk the AST and extract routes ────────────────────────────
    this.visitNode(sourceFile, result, path.dirname(filePath), importMap, sourceFile);

    return result;
  }

  /**
   * Collects identifier names that appear as the left side of a
   * PropertyAccessExpression inside a JSX `path={...}` attribute. Used to
   * narrow which imports are worth resolving as const objects — we don't want
   * to read every imported file in the project, only the ones whose values
   * actually feed a route path.
   */
  private collectConstNamesUsedInRoutePaths(node: ts.Node): Set<string> {
    const names = new Set<string>();
    const visit = (n: ts.Node): void => {
      if (ts.isJsxAttribute(n) && n.name.getText() === 'path' && n.initializer) {
        const init = n.initializer;
        if (ts.isJsxExpression(init) && init.expression) {
          const expr = init.expression;
          if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
            names.add(expr.expression.text);
          }
        }
      }
      // Also catch `path: RouterPath.MANAGE_DEVICES` inside data-router objects.
      if (
        ts.isPropertyAssignment(n) &&
        n.name.getText() === 'path' &&
        ts.isPropertyAccessExpression(n.initializer) &&
        ts.isIdentifier(n.initializer.expression)
      ) {
        names.add(n.initializer.expression.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return names;
  }

  /**
   * Resolves a path expression to its string literal value.
   * Handles three cases:
   *   1. StringLiteral             → returns its text directly.
   *   2. Identifier (const x = '/foo')      → resolved via local const
   *      declarations in the same file (top-level only).
   *   3. PropertyAccessExpression  → looks up the namespace/named import
   *      in the constCache populated during pre-resolution.
   * Returns null if the path can't be resolved statically.
   */
  private resolvePathExpression(expr: ts.Expression, sourceFile: ts.SourceFile): string | null {
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return expr.text;
    }
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
      const localName = expr.expression.text;
      const memberName = expr.name.text;
      // Find which import specifier this local name came from.
      for (const stmt of sourceFile.statements) {
        if (!ts.isImportDeclaration(stmt)) continue;
        if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
        const spec = stmt.moduleSpecifier.text;
        const clause = stmt.importClause;
        if (!clause) continue;
        let matches = false;
        if (clause.name && clause.name.text === localName) matches = true;
        if (clause.namedBindings) {
          if (ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              if (el.name.text === localName) {
                matches = true;
                break;
              }
            }
          } else if (
            ts.isNamespaceImport(clause.namedBindings) &&
            clause.namedBindings.name.text === localName
          ) {
            matches = true;
          }
        }
        if (!matches) continue;
        const constsFromFile = this.constCache.get(spec);
        if (!constsFromFile) return null;
        // The local name might be the const name itself, or — for namespace
        // imports — the const is keyed inside `constsFromFile` as one of the
        // file's exports. Try both.
        const direct = constsFromFile.get(localName);
        if (direct && memberName in direct) return direct[memberName];
        // Namespace import: const lives under its original name; only one
        // exported const-object per file usually, so pick the first match.
        for (const obj of constsFromFile.values()) {
          if (memberName in obj) return obj[memberName];
        }
        return null;
      }
    }
    return null;
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
        // Last-resort fallback: when component resolution fails (namespace
        // imports like `<DMContainers.Foo />`, wrapper indirection through
        // `<ProtectedRoute>...</ProtectedRoute>`, etc.), point the route at
        // the file that DECLARED it. The route-match scorer then climbs the
        // dependency cone from there via its transitive lookup, which is
        // still better than dropping the route entirely.
        const componentPath = route.componentPath ?? extraction.filePath;
        // Skip empty paths — they're not visit-able by any test.
        if (!route.path) continue;
        if (routeMap.has(route.path) && routeMap.get(route.path) !== componentPath) {
          // Keep the first resolved entry; only warn for genuine differences.
          // (Re-runs and idempotent extractions are common, no point shouting.)
          console.warn(
            `[RouteAnalyzer] Duplicate route path "${route.path}" found in ` +
              `"${extraction.filePath}". Overwriting previous entry.`,
          );
        }
        routeMap.set(route.path, componentPath);
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
    baseDir: string,
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

      // Namespace import: `import * as Containers from '@/containers'`
      // Lets us resolve `<Containers.ManageDevicesContainer />` to the barrel
      // file. The route-match scorer's transitive search then walks the barrel
      // to reach the actual page component.
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        importMap[clause.namedBindings.name.text] = absoluteSpecifier;
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
    importMap: IImportMap,
    sourceFile: ts.SourceFile,
  ): void {
    if (this.processedNodes.has(node)) {
      return;
    }

    try {
      // 1. Detect JSX Route elements: <Route path="/" element={<Home />} />
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) {
        this.extractRouteFromJSX(node, result, baseDir, importMap, sourceFile);
      }

      // 2. Detect createBrowserRouter([...]) or createHashRouter([...])
      if (ts.isCallExpression(node)) {
        this.extractRoutesFromRouterCall(node, result, baseDir, importMap, sourceFile);
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
            this.extractRoutesFromArray(node, result, baseDir, importMap, '', sourceFile);
          }
        }
      }
    } catch (err) {
      console.warn(`[RouteAnalyzer] Failed to process node at pos ${node.pos}: ${err}`);
    }

    ts.forEachChild(node, (child) => this.visitNode(child, result, baseDir, importMap, sourceFile));
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
    importMap: IImportMap,
    sourceFile: ts.SourceFile,
  ): void {
    const openingElement = ts.isJsxSelfClosingElement(node) ? node : node.openingElement;
    const tagName = openingElement.tagName.getFullText().trim();

    if (tagName !== 'Route') return;

    let routePath: string | null = null;
    let componentName: string | null;
    let isLazy: boolean;
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
      } else if (init && ts.isJsxExpression(init) && init.expression) {
        // path={EXPR} — try to resolve string literals, identifiers, and
        // PropertyAccessExpressions (e.g. `path={RouterPath.MANAGE_DEVICES}`).
        // Resolution uses the constCache populated at the start of extract().
        const resolved = this.resolvePathExpression(init.expression, sourceFile);
        if (resolved !== null) routePath = resolved;
      }
    }

    if ('index' in attrs) {
      isIndex = true;
      routePath = routePath ?? '';
    }

    if ('element' in attrs) {
      const expr = this.unwrapJsxExpression(attrs['element'].initializer as ts.JsxExpression);
      componentName = this.extractComponentName(expr);
      const resolvedPath = this.resolveComponentPath(
        componentName,
        expr,
        baseDir,
        importMap,
        isLazy,
      );

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
    importMap: IImportMap,
    sourceFile: ts.SourceFile,
  ): void {
    const callee = node.expression;
    if (!ts.isIdentifier(callee)) return;
    if (callee.text !== 'createBrowserRouter' && callee.text !== 'createHashRouter') return;

    const firstArg = node.arguments[0];
    if (firstArg && ts.isArrayLiteralExpression(firstArg)) {
      this.extractRoutesFromArray(firstArg, result, baseDir, importMap, '', sourceFile);
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
    parentPath: string,
    sourceFile: ts.SourceFile,
  ): void {
    this.processedNodes.add(node);
    for (const element of node.elements) {
      if (ts.isObjectLiteralExpression(element)) {
        const route = this.extractRouteFromObject(
          element,
          baseDir,
          importMap,
          parentPath,
          sourceFile,
        );
        if (route) {
          result.routes.push(route);

          const childrenProp = element.properties.find(
            (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'children',
          ) as ts.PropertyAssignment | undefined;

          if (childrenProp && ts.isArrayLiteralExpression(childrenProp.initializer)) {
            this.extractRoutesFromArray(
              childrenProp.initializer,
              result,
              baseDir,
              importMap,
              route.path,
              sourceFile,
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
    parentPath: string,
    sourceFile: ts.SourceFile,
  ): IRouteDef | null {
    let routePath: string | null = null;
    let componentName: string | null = null;
    let isLazy: boolean;
    let componentPath: string | undefined;
    let isIndex = false;

    const props: Record<string, ts.PropertyAssignment> = {};
    for (const prop of obj.properties) {
      if (ts.isPropertyAssignment(prop)) {
        props[prop.name.getText()] = prop;
      }
    }

    isLazy = 'lazy' in props;

    if ('path' in props) {
      // Same trio of cases as JSX: literal, NoSubstitutionTemplateLiteral,
      // and PropertyAccessExpression for `path: RouterPath.MANAGE_DEVICES`.
      const rawPath = this.resolvePathExpression(props['path'].initializer, sourceFile);
      if (rawPath !== null) {
        routePath =
          rawPath.startsWith('/') || !parentPath
            ? rawPath
            : `${parentPath}/${rawPath}`.replace(/\/\//g, '/');
      }
    }

    if ('index' in props) {
      isIndex = props['index'].initializer.kind === ts.SyntaxKind.TrueKeyword;
      if (isIndex) routePath = parentPath || '/';
    }

    if ('element' in props) {
      componentName = this.extractComponentName(props['element'].initializer);
      componentPath = this.resolveComponentPath(
        componentName,
        props['element'].initializer,
        baseDir,
        importMap,
        isLazy,
      );
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
    _isLazy: boolean,
  ): string | undefined {
    // Strategy 1: named/default import resolved via the import map.
    // `import { ManageDevices } from '@dm/components'` registers ManageDevices
    // at the barrel; resolveExportedSymbol follows the barrel's
    // `export … from './ManageDevices'` chain to the REAL page file so the
    // route points at the page, not the catch-all barrel (which transitively
    // imports the whole app and makes route-match match everything).
    if (componentName && importMap[componentName]) {
      const moduleNoExt = importMap[componentName].replace(/\.tsx?$/, '');
      const real = this.resolveExportedSymbol(moduleNoExt, componentName, new Set(), 0);
      if (real) return real;
      // No on-disk file backs the module (e.g. virtual unit-test sources) —
      // fall back to the legacy string-based path so those tests still resolve.
      return moduleNoExt + '.ts';
    }

    // Strategy 1b: namespace member — `DMContainers.ManageDevicesContainer`.
    // Look up the namespace (left of the first dot) in the import map, then
    // resolve the member through the barrel the namespace points at.
    if (componentName && componentName.includes('.')) {
      const [head, ...rest] = componentName.split('.');
      const member = rest.join('.');
      if (head && member && importMap[head]) {
        const moduleNoExt = importMap[head].replace(/\.tsx?$/, '');
        const real = this.resolveExportedSymbol(moduleNoExt, member, new Set(), 0);
        if (real) return real;
        return moduleNoExt + '.ts';
      }
    }

    // Strategy 2: Inline import() call
    if (expr && ts.isCallExpression(expr) && this.isImportCall(expr) && expr.arguments.length > 0) {
      const arg = expr.arguments[0];
      if (ts.isStringLiteral(arg)) {
        const absNoExt = path.resolve(baseDir, arg.text).replace(/\.tsx?$/, '');
        return this.findRealFile(absNoExt) ?? absNoExt + '.ts';
      }
    }

    return undefined;
  }

  /**
   * Resolves the extensionless module path `absNoExt` to the first matching
   * file on disk, trying `.ts`, `.tsx`, then `index.ts` / `index.tsx` for a
   * directory import. Returns null when nothing exists (the caller then keeps
   * the legacy string path so virtual-source unit tests are unaffected).
   * Cached per extract().
   */
  private findRealFile(absNoExt: string): string | null {
    const cached = this.realFileCache.get(absNoExt);
    if (cached !== undefined) return cached;
    const candidates = [
      absNoExt + '.ts',
      absNoExt + '.tsx',
      path.join(absNoExt, 'index.ts'),
      path.join(absNoExt, 'index.tsx'),
    ];
    let found: string | null = null;
    for (const c of candidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) {
          found = c;
          break;
        }
      } catch {
        // unreadable candidate — keep trying
      }
    }
    this.realFileCache.set(absNoExt, found);
    return found;
  }

  /**
   * Parses the `export … from './x'` declarations of a real file. Files with
   * none are leaf modules (the component itself); files with them are barrels.
   * Cached per extract().
   */
  private getReExports(realFile: string): IReExport[] {
    const cached = this.reExportCache.get(realFile);
    if (cached) return cached;
    const out: IReExport[] = [];
    try {
      const src = fs.readFileSync(realFile, 'utf-8');
      const sf = ts.createSourceFile(realFile, src, ts.ScriptTarget.Latest, true);
      for (const stmt of sf.statements) {
        if (!ts.isExportDeclaration(stmt)) continue;
        if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
        const from = stmt.moduleSpecifier.text;
        if (!stmt.exportClause) {
          out.push({ star: true, from }); // export * from './x'
        } else if (ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            const exported = el.name.text; // re-exported name (after `as`)
            const local = el.propertyName?.text ?? exported; // original name in target
            out.push({ star: false, exported, local, from });
          }
        }
      }
    } catch {
      // unreadable — treat as a leaf with no re-exports
    }
    this.reExportCache.set(realFile, out);
    return out;
  }

  /**
   * Resolves `symbol`, exported by the module at `absNoExt`, to the real source
   * file that defines it, following barrel `export … from` chains (named and
   * `export *`). Returns null only when no file backs `absNoExt` on disk, so
   * the caller can fall back to legacy string resolution. Depth- and
   * cycle-guarded.
   */
  private resolveExportedSymbol(
    absNoExt: string,
    symbol: string,
    visited: Set<string>,
    depth: number,
  ): string | null {
    const realFile = this.findRealFile(absNoExt);
    if (!realFile) return null;
    if (visited.has(realFile) || depth >= RouteAnalyzer.MAX_BARREL_DEPTH) return realFile;
    visited.add(realFile);

    const reExports = this.getReExports(realFile);
    // Leaf module (no `export … from`): this file defines the component.
    if (reExports.length === 0) return realFile;

    // 1) Direct named re-export of the symbol → follow it to the target.
    for (const re of reExports) {
      if (re.star || re.exported !== symbol) continue;
      const targetNoExt = path.resolve(path.dirname(realFile), re.from);
      const resolved = this.resolveExportedSymbol(targetNoExt, re.local, visited, depth + 1);
      return resolved ?? this.findRealFile(targetNoExt) ?? realFile;
    }

    // 2) `export * from './x'` — search each star-barrel for the symbol.
    for (const re of reExports) {
      if (!re.star) continue;
      const targetNoExt = path.resolve(path.dirname(realFile), re.from);
      const resolved = this.resolveExportedSymbol(targetNoExt, symbol, visited, depth + 1);
      if (resolved) return resolved;
    }

    // Symbol not found behind this barrel — best effort: the barrel file itself.
    return realFile;
  }

  private extractLazyComponentPath(
    expr: ts.Expression | undefined,
    baseDir: string,
  ): string | undefined {
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
    return (
      expr.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(expr) && expr.text === 'import')
    );
  }

  /**
   * Known wrapper components that pass children through transparently
   * (auth/permission gates, layouts, error boundaries). When a route element
   * matches one of these, prefer to surface the WRAPPED inner component as
   * the route's real target so the route-match scorer can climb the right
   * dependency cone.
   */
  private static readonly WRAPPER_COMPONENT_NAMES = new Set([
    'ProtectedRoute',
    'PrivateRoute',
    'PublicRoute',
    'AuthRoute',
    'RequireAuth',
    'GuardedRoute',
    'Layout',
    'AppLayout',
    'PageLayout',
    'ProtectedLayout',
    'AuthLayout',
    'ErrorBoundary',
    'Suspense',
  ]);

  /**
   * Returns the inner JSX child of a wrapper element, if there's exactly one
   * meaningful (non-whitespace) JSX child. Used to look past
   *   <ProtectedRoute ...><RealPage /></ProtectedRoute>
   * and treat `<RealPage />` as the route's actual target.
   */
  private unwrapWrapperChildren(node: ts.JsxElement): ts.Expression | null {
    const jsxChildren: ts.Expression[] = [];
    for (const child of node.children) {
      if (ts.isJsxSelfClosingElement(child) || ts.isJsxElement(child)) {
        jsxChildren.push(child as unknown as ts.Expression);
      } else if (ts.isJsxExpression(child) && child.expression) {
        let inner: ts.Expression = child.expression;
        while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
        if (ts.isJsxSelfClosingElement(inner) || ts.isJsxElement(inner) || ts.isIdentifier(inner)) {
          jsxChildren.push(inner);
        }
      }
      // JsxText is ignored — pure whitespace between tags.
    }
    return jsxChildren.length === 1 ? jsxChildren[0] : null;
  }

  private extractComponentName(expr: ts.Expression | undefined): string | null {
    if (!expr) return null;
    // Peel off `({...})` wrappers — common when the element is multi-line:
    //   element={(<Foo>...</Foo>)}   ← ParenthesizedExpression around JSX
    let inner: ts.Expression = expr;
    while (ts.isParenthesizedExpression(inner)) inner = inner.expression;

    // If the outer element is a known wrapper (ProtectedRoute, Layout, etc.)
    // with exactly one JSX child, return the inner child's name instead.
    // This is what makes `<ProtectedRoute><DMContainers.X/></ProtectedRoute>`
    // resolve to `DMContainers.X` (whose namespace `DMContainers` lives in
    // importMap), not to the wrapper barrel.
    if (ts.isJsxElement(inner)) {
      const wrapperTag = inner.openingElement.tagName.getText();
      if (RouteAnalyzer.WRAPPER_COMPONENT_NAMES.has(wrapperTag)) {
        const innerChild = this.unwrapWrapperChildren(inner);
        if (innerChild) return this.extractComponentName(innerChild);
      }
      return wrapperTag;
    }
    if (ts.isJsxSelfClosingElement(inner)) return inner.tagName.getText();
    if (ts.isIdentifier(inner)) return inner.text;
    return null;
  }

  private unwrapJsxExpression(
    node: ts.JsxExpression | ts.StringLiteral | undefined,
  ): ts.Expression | undefined {
    if (!node) return undefined;
    if (!ts.isJsxExpression(node)) return undefined;
    let inner: ts.Expression | undefined = node.expression;
    // Strip any parenthesized wrappers so downstream consumers see the real
    // JSX/Identifier/CallExpression node directly.
    while (inner && ts.isParenthesizedExpression(inner)) inner = inner.expression;
    return inner;
  }

  private isDynamicRoute(routePath: string): boolean {
    return /:(\w+)|\*/.test(routePath);
  }
}
