import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

import { glob } from 'glob';
import * as ts from 'typescript';

import { CypressExtractorAnalyzer } from '@/core/analyzers/cypress-extractor';
import { ReduxChainAnalyzer } from '@/core/analyzers/redux-chain/redux-chain-analyzer';
import { RouteAnalyzer } from '@/core/analyzers/route-analyzer/route-analyzer';
import { SourceExtractorAnalyzer } from '@/core/analyzers/source-extractor';
import { normalizePath } from '@/core/registry/path-utils';
import { createRegistry } from '@/core/registry/registry';
import { partitionSuggestableTests } from '@/core/registry/suggestion-exclusions';
import { loadTsConfigAliases } from '@/core/registry/tsconfig-loader';
import { ICypressExtractionResult, ISourceExtractionResult } from '@/types';
import { IReduxExtractionResult, IRouteExtractionResult } from '@/types/analyzers';
import { IRegistry, IFileEntry } from '@/types/registry';
import { formatBuildLine } from '@/utils/build-info';

export interface RegistryBuilderConfig {
  /**
   * Directories to scan for source files (React/TS components, pages, hooks, etc.)
   * Example: ['src', 'lib']
   */
  sourceDirs: string[];

  /**
   * Glob patterns to find Cypress spec files.
   * Example: ['**\\/*.cy.ts', '**\\/*.cy.tsx', 'cypress/e2e/**\\/*.spec.ts']
   */
  testPatterns: string[];

  /**
   * File extensions to include when scanning sourceDirs.
   * Default: ['.ts', '.tsx', '.js', '.jsx']
   */
  sourceExtensions?: string[];

  /**
   * Directories to ignore when scanning (relative to project root).
   * Default: ['node_modules', 'dist', 'build', '.next', 'coverage']
   */
  ignoreDirs?: string[];

  /**
   * Glob patterns for files to exclude from BOTH source and test discovery.
   * Use this when a file is neither a production source nor a test you care
   * about — e.g. jest unit tests in a repo that only selects Cypress specs.
   */
  excludePatterns?: string[];

  /**
   * Absolute path to the SOURCE repository root. Source files (and the import
   * graph) are scanned and resolved relative to this. Required.
   */
  sourceRoot: string;

  /**
   * Absolute path to the TEST repository root. Cypress specs are scanned here;
   * jest-style tests colocated in the source repo are also picked up. When the
   * two repos are the same, pass the same value as sourceRoot. Required.
   */
  testRoot: string;

  /**
   * Path alias mappings for resolving imports. Keys are the alias prefix
   * (e.g. "@dm/", "@fixtures/"), values are ABSOLUTE target directories
   * (see config-loader.getMergedAliases).
   */
  pathAliases?: Record<string, string>;

  /**
   * When true, logs detailed extraction and resolution info to stderr.
   */
  debug?: boolean;
}

export class RegistryBuilder {
  private registry: IRegistry;
  /** Source repo root. Doubles as the import-resolution base (imports point at
   * source) and the `projectRoot` the resolver helpers reference. */
  private projectRoot: string;
  private testRoot: string;
  private pathAliases: Record<string, string> = {};
  private baseUrlRoots: string[] = [];
  private debug = false;

  constructor() {
    this.registry = createRegistry();
    this.projectRoot = process.cwd();
    this.testRoot = process.cwd();
  }

  async buildFromDirectories(config: RegistryBuilderConfig): Promise<IRegistry> {
    this.projectRoot = config.sourceRoot;
    this.testRoot = config.testRoot;
    this.debug = config.debug ?? false;

    // Auto-detect aliases + baseUrl from tsconfig.json in each source tree.
    // User-provided aliases win on exact prefix conflict (merged last).
    const detected = loadTsConfigAliases(
      this.projectRoot,
      config.sourceDirs,
      this.debug ? (m) => this.log(m) : undefined,
    );
    this.pathAliases = { ...detected.aliases, ...(config.pathAliases ?? {}) };
    this.baseUrlRoots = detected.baseUrlRoots;

    const extensions = config.sourceExtensions ?? ['.ts', '.tsx', '.js', '.jsx'];
    const ignoreDirs = config.ignoreDirs ?? ['node_modules', 'dist', 'build', '.next', 'coverage'];
    const excludePatterns = config.excludePatterns ?? [];

    const fileEntries: IFileEntry[] = [];
    const sourceExtractor = new SourceExtractorAnalyzer();
    const cypressExtractor = new CypressExtractorAnalyzer();
    const reduxChainAnalyzer = new ReduxChainAnalyzer();
    const reduxExtractions: IReduxExtractionResult[] = [];
    const routeAnalyzer = new RouteAnalyzer();
    const routeExtractions: IRouteExtractionResult[] = [];
    const routeAliasConfig = {
      projectRoot: this.projectRoot,
      aliases: this.pathAliases,
    };
    // Counters so the summary log can distinguish "RouteAnalyzer never ran on
    // anything" from "RouteAnalyzer ran on N files but every file produced 0
    // routes". The two cases imply very different next steps for debugging.
    let routeFilesScanned = 0;
    let routeFilesContributed = 0;
    let routeFilesFailed = 0;

    if (this.debug) {
      this.log(formatBuildLine());
      this.log(`projectRoot: ${this.projectRoot}`);
      this.log(`pathAliases (merged): ${JSON.stringify(this.pathAliases)}`);
      this.log(`baseUrlRoots (tsconfig): ${JSON.stringify(this.baseUrlRoots)}`);
    }

    // --- Process source files ---
    // Source walk excludes anything that matches `testPatterns` — a file can't
    // be both source and test, and whichever list names it first wins. Plus
    // the user's explicit `excludePatterns` (typically unit-test noise in a
    // repo that only cares about E2E specs).
    const sourceExcludes = [...excludePatterns, ...config.testPatterns];
    const sourceFiles = await this.findSourceFiles(
      config.sourceDirs,
      extensions,
      ignoreDirs,
      sourceExcludes,
    );
    if (this.debug) this.log(`Found ${sourceFiles.length} source files.`);

    for (const filePath of sourceFiles) {
      try {
        const sourceCode = await fs.readFile(filePath, 'utf-8');
        const result = await sourceExtractor.extract({ filePath, sourceCode });
        const entry = this.convertSourceExtractionToFileEntry(result, filePath);
        fileEntries.push(entry);

        // Run redux-chain on source files too — detects createSlice, createAction,
        // createSelector, saga generators. Consumers found in Pass 2 via imports.
        try {
          const redux = await reduxChainAnalyzer.extract({ filePath, sourceCode });
          // Rewrite importedFiles from raw specifiers to resolved absolute-ish
          // workspace paths so buildChains can match them against selector files.
          redux.importedFiles = this.resolveImports(redux.importedFiles ?? [], filePath);
          reduxExtractions.push(redux);
        } catch (e) {
          if (this.debug) this.log(`redux-chain extract failed for ${filePath}: ${e}`);
        }

        // Run route-analyzer on every source file — JSX <Route>, data-routers,
        // and lazy() imports can live anywhere, not just App.tsx. Cheap to skip
        // files with no routes (extractor produces an empty result).
        try {
          routeFilesScanned++;
          const routeResult = await routeAnalyzer.extract({
            filePath,
            sourceCode,
            aliasConfig: routeAliasConfig,
            // Lets the analyzer resolve `path={RouterPath.MANAGE_DEVICES}` by
            // reading the imported const-object file. Same plumbing as
            // cypressExtractor uses for action-type literals.
            resolveConstImport: async (importPath) => {
              if (this.debug) {
                this.log(
                  `route-analyzer: requesting const resolve for "${importPath}" from ${filePath}`,
                );
              }
              const r = await this.resolveTsConstImport(importPath, filePath);
              if (this.debug) {
                this.log(
                  `route-analyzer: const resolve for "${importPath}" returned ${
                    r === null ? 'null' : `${r.size} const-object(s)`
                  }`,
                );
              }
              return r;
            },
          });
          if (routeResult.routes.length > 0) {
            for (const r of routeResult.routes) {
              if (r.componentPath)
                r.componentPath = normalizePath(r.componentPath, this.projectRoot);
            }
            routeExtractions.push(routeResult);
            routeFilesContributed++;
            // Per-file log — the most useful breadcrumb when the summary line
            // shows zero contributions: which files DID produce routes, with
            // a peek at the first three paths so it's obvious whether the
            // target's real router files were touched.
            if (this.debug) {
              const sample = routeResult.routes
                .slice(0, 3)
                .map((r) => r.path + (r.componentPath ? ` → ${r.componentPath}` : ''))
                .join(', ');
              this.log(
                `route-analyzer: ${filePath} → ${routeResult.routes.length} route(s)${sample ? ` [${sample}${routeResult.routes.length > 3 ? ', …' : ''}]` : ''}`,
              );
            }
          }
        } catch (e) {
          routeFilesFailed++;
          if (this.debug) this.log(`route-analyzer extract failed for ${filePath}: ${e}`);
        }

        if (this.debug) {
          this.logExtraction('source', filePath, {
            exports: result.exports,
            imports: result.imports,
            selectors: result.selectors,
            translationKeys: result.translationKeys,
          });
        }
      } catch (error) {
        if (this.debug) this.log(`Failed to process source file ${filePath}: ${error}`);
      }
    }

    // --- Process test files (from both repos; each tagged with its root) ---
    const discoveredTestFiles = await this.findTestFiles(
      config.testPatterns,
      ignoreDirs,
      excludePatterns,
    );

    // Drop specs that must never be suggested (separate-cadence suites such as
    // InterOps and dmSanity). Centralized in `suggestion-exclusions.ts` — add
    // new rules there, not here. Excluded here (registry build) rather than at
    // scoring time so these specs never enter the candidate pool at all.
    const { excluded } = partitionSuggestableTests(discoveredTestFiles.map((t) => t.abs));
    const excludedSet = new Set(excluded.map((e) => e.path));
    const testFiles = discoveredTestFiles.filter((t) => !excludedSet.has(t.abs));
    if (this.debug) {
      this.log(
        `Found ${discoveredTestFiles.length} test files; ` +
          `${excluded.length} excluded from suggestions, ${testFiles.length} kept.`,
      );
      for (const { path: excludedPath, rule } of excluded) {
        this.log(`  excluded ${excludedPath} (${rule.id})`);
      }
    }

    for (const { abs: filePath, repoRoot } of testFiles) {
      try {
        const sourceCode = await fs.readFile(filePath, 'utf-8');

        // All tests route through the cypress-extractor: the AST walk picks up
        // describe/it blocks regardless of framework (Cypress, Jest, Vitest).
        // For non-cypress tests the `cy.*` fields (visitedRoutes, selectors,
        // intercepts, etc.) stay empty — harmless — while describeBlocks +
        // itBlocks + imports populate, so describe-block / direct-import /
        // transitive-import / colocation scorers all fire on unit tests too.
        const result = await cypressExtractor.extract({
          filePath,
          sourceCode,
          resolveJsonImport: (importPath) => this.resolveJsonImport(importPath, filePath),
          resolveTsConstImport: (importPath) => this.resolveTsConstImport(importPath, filePath),
        });
        const entry = this.convertCypressExtractionToFileEntry(result, filePath, repoRoot);
        fileEntries.push(entry);
        if (this.debug) {
          this.logExtraction('test', filePath, {
            selectors: result.selectors.length,
            visitedRoutes: result.visitedRoutes,
            containsText: result.containsText,
            customCommands: result.customCommandsUsed,
            imports: result.imports,
            describeBlocks: result.describeBlocks.length,
            itBlocks: result.itBlocks.length,
          });
        }
      } catch (error) {
        if (this.debug) this.log(`Failed to process test file ${filePath}: ${error}`);
      }
    }

    this.expandBarrelImports(fileEntries);

    // Resolve imported identifiers → action-type literals BEFORE building
    // the registry — `buildFromFileEntries` clones each entry, so mutations
    // after that point never land in the indexed copy. For each
    // `import { ORDER_FOO } from './types'`, if `./types.ts` has
    // `export const ORDER_FOO = 'order/foo'`, add that literal to the
    // importer's actionTypeStrings. Bridges sagas/specs that reference the
    // constant by name to the file that mints the raw string.
    const byPath = new Map<string, IFileEntry>();
    for (const e of fileEntries) byPath.set(e.path, e);
    for (const entry of fileEntries) {
      const idents = entry.importedIdentifiers ?? [];
      if (idents.length === 0) continue;
      const added = new Set<string>(entry.actionTypeStrings ?? []);
      const before = added.size;
      for (const { name, module } of idents) {
        const resolved = this.resolveImports([module], entry.path);
        for (const target of resolved) {
          const targetEntry = byPath.get(target);
          const literal = targetEntry?.actionTypeConstExports?.[name];
          if (literal) added.add(literal);
        }
      }
      if (added.size > before) entry.actionTypeStrings = Array.from(added);
    }

    this.registry.buildFromFileEntries(fileEntries);

    // Route map publication — MERGE with what the registry already populated
    // from `entry.routesDefined` (shallow source-extractor path). The standalone
    // RouteAnalyzer is more capable (data-routers, lazy imports, alias
    // resolution), so its entries win on path collisions, but we keep any
    // routes the simpler pipeline already found.
    try {
      const sourceExtractorRoutes = this.registry.getRouteMap().size;
      if (this.debug) {
        this.log(
          `route-analyzer summary: scanned=${routeFilesScanned}, contributed=${routeFilesContributed}, failed=${routeFilesFailed}; source-extractor pipeline produced ${sourceExtractorRoutes} entries before merge`,
        );
      }

      const externalRouteMap = routeAnalyzer.buildRouteMap(routeExtractions);
      if (externalRouteMap.size > 0) {
        const merged = new Map(this.registry.getRouteMap());
        const before = merged.size;
        let overrides = 0;
        for (const [routePath, componentPath] of externalRouteMap) {
          if (merged.has(routePath) && merged.get(routePath) !== componentPath) overrides++;
          merged.set(routePath, componentPath);
        }
        this.registry.setRouteMap(merged);
        if (this.debug) {
          this.log(
            `route map merged: ${before} existing + ${externalRouteMap.size} from RouteAnalyzer = ${merged.size} total (${overrides} overridden)`,
          );
          // Sample of final route map so the user can grep for specific paths
          // (e.g. /managedevices) without dumping the whole registry.json.
          const sample: string[] = [];
          let i = 0;
          for (const [p, c] of merged) {
            sample.push(`${p} → ${c}`);
            if (++i >= 15) break;
          }
          this.log(
            `route map sample (first ${sample.length}/${merged.size}): ${sample.join(' | ')}`,
          );
        }
      } else if (this.debug) {
        this.log(
          `route map: RouteAnalyzer found 0 routes across ${routeFilesScanned} files (${routeFilesFailed} failed); keeping ${sourceExtractorRoutes} from source-extractor`,
        );
        if (sourceExtractorRoutes > 0) {
          const sample: string[] = [];
          let i = 0;
          for (const [p, c] of this.registry.getRouteMap()) {
            sample.push(`${p} → ${c}`);
            if (++i >= 15) break;
          }
          this.log(`route map sample (source-extractor only): ${sample.join(' | ')}`);
        }
      }
    } catch (e) {
      if (this.debug) this.log(`route map build failed: ${e}`);
    }

    // Top test selectors by frequency — calibration data for
    // `scoring.ubiquitousSelectorThreshold`. A selector at share > threshold is
    // disqualified as a match, so this table is where the threshold is set from
    // real data. Emitted here (setup path) so it's captured without needing a
    // headless analyze run.
    if (this.debug) {
      const totalTests = this.registry.getTestFileCount();
      const top = this.registry.getTopTestSelectors(30);
      this.log(`top test selectors (of ${totalTests} specs) — share% · count · value:`);
      for (const { value, count } of top) {
        const share = totalTests > 0 ? ((100 * count) / totalTests).toFixed(0) : '0';
        this.log(`  ${share.padStart(3)}%  ${count}  ${value}`);
      }
    }

    // Redux chain reconciliation — after file entries are in the registry so
    // the chain's action-type strings can also be surfaced through the
    // file-level actionTypeStrings index (used by ActionTypeScorer).
    try {
      // Count distinct slice names BEFORE buildChains so a "0 chains" outcome
      // points at the right place. If extractions had slice names but the
      // chain build still returned empty, that's a reconciliation bug, not
      // a detection bug.
      const slicesSeen = new Set<string>();
      let extractionsWithRole = 0;
      for (const ext of reduxExtractions) {
        if (ext.sliceName) slicesSeen.add(ext.sliceName);
        if (ext.role && ext.role !== 'unknown') extractionsWithRole++;
      }
      if (this.debug) {
        this.log(
          `redux-chain summary: ${reduxExtractions.length} extractions, ${extractionsWithRole} with a redux role, ${slicesSeen.size} distinct slice names`,
        );
      }
      const chains = await reduxChainAnalyzer.buildChains(reduxExtractions);
      this.registry.setReduxChains(chains);
      if (this.debug) {
        this.log(`redux chains built: ${chains.size}`);
        if (chains.size > 0) {
          const names = Array.from(chains.keys()).slice(0, 10);
          this.log(`redux chain names (first ${names.length}/${chains.size}): ${names.join(', ')}`);
        }
      }

      // Promote chain.actionTypes back onto the slice file's
      // actionTypeStrings list so ActionTypeScorer sees them.
      for (const chain of chains.values()) {
        const sliceFile = chain.files.slice ?? chain.files.reducer ?? chain.files.actions;
        if (!sliceFile) continue;
        const entry = this.registry.getFile(sliceFile);
        if (!entry) continue;
        const merged = new Set([...(entry.actionTypeStrings ?? []), ...chain.actionTypes]);
        entry.actionTypeStrings = Array.from(merged);
      }
      // Rebuild the action-type index now that slice files have the synthesized
      // `slice/actionCreator` strings added. Requires the registry to have a
      // list of all entries; rely on the internal helper through files iterator.
      const all: IFileEntry[] = [];
      for (const f of this.registry.getFilesByType('source')) all.push(f);
      for (const f of this.registry.getFilesByType('test')) all.push(f);
      this.registry.buildActionTypeIndex(all);
    } catch (e) {
      if (this.debug) this.log(`redux chain build failed: ${e}`);
    }

    return this.registry;
  }

  /**
   * Expand barrel re-exports into direct edges.
   *
   * Mattermost (and most large TS codebases) has lots of `index.ts` files
   * whose only job is `export { A } from './a'; export * from './b';`.
   * When `foo.ts` imports `{ A }` from `./barrel`, the resolver stops at
   * `./barrel/index.ts`. The Direct-Import and Transitive-Import scorers
   * then never see the real target file (`./a.ts`) as a dependency of
   * `foo.ts`, even though semantically it is one.
   *
   * This pass detects pure-barrel files (basename `index.{ts,tsx,js,jsx}`
   * whose AST contains only re-export statements) and, for every importer
   * of such a barrel, appends the barrel's targets to the importer's
   * dependency list. Conservative (adds all targets, not just the one the
   * importer referenced by name) — inflates the graph slightly but keeps
   * the implementation cheap and avoids symbol-resolution misses.
   */
  private expandBarrelImports(entries: IFileEntry[]): void {
    const byPath = new Map<string, IFileEntry>();
    for (const e of entries) byPath.set(e.path, e);

    const barrelTargets = new Map<string, Set<string>>();
    for (const entry of entries) {
      if (!this.isBarrelCandidate(entry.path)) continue;
      const targets = this.readBarrelTargets(entry);
      if (targets && targets.size > 0) barrelTargets.set(entry.path, targets);
    }

    if (barrelTargets.size === 0) return;
    if (this.debug) this.log(`barrel files detected: ${barrelTargets.size}`);

    for (const entry of entries) {
      const extra: string[] = [];
      for (const imp of entry.imports) {
        const targets = barrelTargets.get(imp);
        if (!targets) continue;
        for (const t of targets) if (t !== entry.path) extra.push(t);
      }
      if (extra.length === 0) continue;
      const merged = new Set([...entry.imports, ...extra]);
      entry.imports = Array.from(merged);
    }
  }

  private isBarrelCandidate(normalizedPath: string): boolean {
    const base = path.basename(normalizedPath);
    return /^index\.(ts|tsx|js|jsx|mts|cts)$/.test(base);
  }

  /**
   * Returns the set of re-exported target paths for a barrel file, or
   * null if the file isn't actually a pure barrel. A file is a "pure
   * barrel" when every top-level statement is either an import (ignored)
   * or a re-export with a `from '...'` clause — no runtime code, no
   * local declarations.
   */
  private readBarrelTargets(entry: IFileEntry): Set<string> | null {
    const abs = path.resolve(this.projectRoot, entry.path);
    let sourceCode: string;
    try {
      sourceCode = fsSync.readFileSync(abs, 'utf-8');
    } catch {
      return null;
    }
    const sf = ts.createSourceFile(entry.path, sourceCode, ts.ScriptTarget.Latest, true);

    const targets = new Set<string>();
    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt)) continue; // ignored
      if (
        ts.isExportDeclaration(stmt) &&
        stmt.moduleSpecifier &&
        ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        const spec = stmt.moduleSpecifier.text;
        const resolved = this.resolveImports([spec], abs);
        for (const r of resolved) targets.add(r);
        continue;
      }
      // Any other statement (function decl, var decl, class, export =, etc.)
      // disqualifies the file as a pure barrel.
      return null;
    }
    return targets.size > 0 ? targets : null;
  }

  /**
   * Finds all source files in the given directories matching the given extensions.
   *
   * Example:
   *   sourceDirs = ['src']
   *   extensions = ['.ts', '.tsx']
   *   ignoreDirs = ['node_modules']
   *
   *   Returns: ['src/components/Button.tsx', 'src/pages/LoginPage.tsx', ...]
   */
  private async findSourceFiles(
    sourceDirs: string[],
    extensions: string[],
    ignoreDirs: string[],
    excludePatterns: string[] = [],
  ): Promise<string[]> {
    const extPattern = extensions.length === 1 ? extensions[0] : `{${extensions.join(',')}}`;

    const patterns = sourceDirs.map((dir) => `${dir}/**/*${extPattern}`);
    const ignorePatterns = [...ignoreDirs.map((d) => `**/${d}/**`), ...excludePatterns];

    // Absolute paths: reads and relative-import resolution then work regardless
    // of process.cwd() (essential when source/test live in different repos).
    return glob(patterns, {
      cwd: this.projectRoot,
      ignore: ignorePatterns,
      absolute: true,
      nodir: true,
    });
  }

  /**
   * Finds all test files matching the given glob patterns.
   *
   * Example:
   *   testPatterns = ['**\\/*.cy.ts', 'cypress/e2e/**\\/*.spec.ts']
   *   ignoreDirs   = ['node_modules']
   *
   *   Returns: ['cypress/e2e/login.cy.ts', 'cypress/e2e/checkout.cy.ts', ...]
   */
  private async findTestFiles(
    testPatterns: string[],
    ignoreDirs: string[],
    excludePatterns: string[] = [],
  ): Promise<Array<{ abs: string; repoRoot: string }>> {
    const ignorePatterns = [...ignoreDirs.map((d) => `**/${d}/**`), ...excludePatterns];

    // Fallback: if user didn't configure any testPatterns, sweep common layouts
    // so pelican isn't silently blind on default installs.
    const effectivePatterns =
      testPatterns.length > 0
        ? testPatterns
        : ['**/*.{cy,spec,test,e2e,integration,int}.{ts,tsx,js,jsx,mts,cts}'];

    // Tests can live in BOTH repos: jest-style specs colocated in the source
    // repo, Cypress specs in the test repo. Scan both roots and tag each file
    // with the root it came from (deduping when the two roots are the same).
    const roots = [...new Set([this.projectRoot, this.testRoot])];
    const seen = new Set<string>();
    const out: Array<{ abs: string; repoRoot: string }> = [];
    for (const repoRoot of roots) {
      const files = await glob(effectivePatterns, {
        cwd: repoRoot,
        ignore: ignorePatterns,
        absolute: true,
        nodir: true,
      });
      for (const abs of files) {
        if (seen.has(abs)) continue;
        seen.add(abs);
        out.push({ abs, repoRoot });
      }
    }
    return out;
  }

  /**
   * Resolves a TS import like `import { SELECTORS } from './selectors'` to a
   * map of the top-level `export const <name> = { key: 'value', ... }` objects
   * in the target file. Only string-valued properties are captured (the only
   * kind that can be used as a selector value at runtime).
   */
  private async resolveTsConstImport(
    importPath: string,
    fromFile: string,
  ): Promise<Map<string, Record<string, string>> | null> {
    const candidates = this.candidateFilePathsForImport(importPath, fromFile);

    for (const candidate of candidates) {
      try {
        const content = await fs.readFile(candidate, 'utf-8');
        const sourceFile = ts.createSourceFile(candidate, content, ts.ScriptTarget.Latest, true);

        const result = new Map<string, Record<string, string>>();
        for (const stmt of sourceFile.statements) {
          if (!ts.canHaveModifiers(stmt)) continue;
          const isExported = ts
            .getModifiers(stmt)
            ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
          if (!isExported) continue;

          // Pattern 1: `export const X = { ... }` — also handles
          //   `export const X = { ... } as const`        (AsExpression)
          //   `export const X = Object.freeze({ ... })`  (CallExpression)
          if (ts.isVariableStatement(stmt)) {
            for (const decl of stmt.declarationList.declarations) {
              if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
              const obj = this.extractStringMapFromExpression(decl.initializer, sourceFile);
              if (obj && Object.keys(obj).length > 0) result.set(decl.name.text, obj);
            }
            continue;
          }

          // Pattern 2: `export enum X { FOO = '/foo', BAR = '/bar' }`
          //   and     `export const enum X { ... }`
          // String-valued enums extract cleanly; numeric/heterogeneous enums are
          // skipped on a per-member basis.
          if (ts.isEnumDeclaration(stmt)) {
            const obj: Record<string, string> = {};
            for (const member of stmt.members) {
              if (!ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name)) continue;
              const key = ts.isIdentifier(member.name) ? member.name.text : member.name.text;
              if (!member.initializer) continue;
              if (ts.isStringLiteral(member.initializer)) {
                obj[key] = member.initializer.text;
              } else if (ts.isNoSubstitutionTemplateLiteral(member.initializer)) {
                obj[key] = member.initializer.text;
              }
            }
            if (Object.keys(obj).length > 0) result.set(stmt.name.text, obj);
            continue;
          }
        }

        if (this.debug) {
          this.log(
            `resolveTsConstImport: ${candidate} → ${result.size} const-objects [${[...result.keys()].join(', ') || '(empty)'}]`,
          );
        }
        if (result.size > 0) return result;
      } catch {
        // try next candidate
      }
    }

    if (this.debug) {
      this.log(`resolveTsConstImport: ${importPath} (from ${fromFile}) → no candidates matched`);
    }
    return null;
  }

  /**
   * Pulls string key→value pairs out of an expression that's expected to be
   * an object literal — directly, behind `as const`, or wrapped in
   * `Object.freeze(...)`. Returns null when the shape isn't one we recognise.
   */
  private extractStringMapFromExpression(
    expr: ts.Expression,
    sourceFile: ts.SourceFile,
  ): Record<string, string> | null {
    // Unwrap `({...} as const)` and `({...} as Readonly<...>)`
    let inner: ts.Expression = expr;
    while (ts.isAsExpression(inner) || ts.isParenthesizedExpression(inner)) {
      inner = inner.expression;
    }
    // Unwrap `Object.freeze({...})`
    if (
      ts.isCallExpression(inner) &&
      ts.isPropertyAccessExpression(inner.expression) &&
      ts.isIdentifier(inner.expression.expression) &&
      inner.expression.expression.text === 'Object' &&
      inner.expression.name.text === 'freeze' &&
      inner.arguments.length === 1
    ) {
      inner = inner.arguments[0];
    }
    if (!ts.isObjectLiteralExpression(inner)) return null;

    const obj: Record<string, string> = {};
    for (const prop of inner.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = prop.name.getText(sourceFile).replace(/['"]/g, '');
      if (ts.isStringLiteral(prop.initializer)) {
        obj[key] = prop.initializer.text;
      } else if (ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
        obj[key] = prop.initializer.text;
      }
    }
    return obj;
  }

  private candidateFilePathsForImport(importPath: string, fromFile: string): string[] {
    const candidates: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    const baseDirectory = path.dirname(fromFile);

    const roots: string[] = [];
    if (importPath.startsWith('.')) {
      roots.push(path.resolve(this.projectRoot, baseDirectory, importPath));
    } else {
      let aliasMatched = false;
      for (const [alias, target] of Object.entries(this.pathAliases)) {
        if (importPath.startsWith(alias)) {
          const rest = importPath.slice(alias.length).replace(/^\/+/, '');
          roots.push(path.resolve(this.projectRoot, target, rest));
          aliasMatched = true;
        }
      }
      // tsconfig baseUrl fallback for bare imports like `components/foo`.
      // Only when no alias hit — aliases are more specific.
      if (!aliasMatched) {
        for (const base of this.baseUrlRoots) {
          roots.push(path.resolve(this.projectRoot, base, importPath));
        }
      }
    }

    for (const root of roots) {
      for (const ext of extensions) candidates.push(root + ext);
      for (const ext of extensions) candidates.push(path.join(root, `index${ext}`));
    }
    return candidates;
  }

  /**
   * Resolves a JSON import path to its parsed content.
   * Uses pathAliases from config, then falls back to relative resolution.
   */
  private async resolveJsonImport(
    importPath: string,
    fromFile: string,
  ): Promise<Record<string, unknown> | null> {
    const candidates: string[] = [];

    if (importPath.startsWith('.')) {
      // Relative import — resolve from the importing file's directory
      candidates.push(path.resolve(this.projectRoot, path.dirname(fromFile), importPath));
    } else {
      let aliasMatched = false;
      for (const [alias, target] of Object.entries(this.pathAliases)) {
        if (importPath.startsWith(alias)) {
          const rest = importPath.slice(alias.length);
          candidates.push(path.resolve(this.projectRoot, target, rest));
          aliasMatched = true;
        }
      }
      if (!aliasMatched) {
        for (const base of this.baseUrlRoots) {
          candidates.push(path.resolve(this.projectRoot, base, importPath));
        }
      }
    }

    if (this.debug) {
      this.log(`resolveJsonImport: "${importPath}" from "${fromFile}"`);
      this.log(`  candidates: ${JSON.stringify(candidates)}`);
    }

    for (const candidate of candidates) {
      try {
        const content = await fs.readFile(candidate, 'utf-8');
        const parsed = JSON.parse(content) as Record<string, unknown>;
        if (this.debug) {
          const keys = Object.keys(parsed);
          this.log(
            `  ✓ resolved: ${candidate} (${keys.length} keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''})`,
          );
        }
        return parsed;
      } catch {
        if (this.debug) {
          this.log(`  ✗ failed: ${candidate}`);
        }
      }
    }

    if (this.debug && candidates.length === 0) {
      this.log(
        `  ⚠ no alias matched for "${importPath}". Configure pathAliases in .pelicanrc.json`,
      );
    }

    return null;
  }

  /** Debug log helper — writes to stderr so it doesn't pollute JSON output */
  private log(message: string): void {
    process.stderr.write(`[debug] ${message}\n`);
  }

  /** Logs extraction summary for a file */
  private logExtraction(type: string, filePath: string, data: Record<string, unknown>): void {
    this.log(`[${type}] ${filePath}`);
    for (const [key, value] of Object.entries(data)) {
      const display = Array.isArray(value)
        ? `[${value.length}] ${JSON.stringify(value.slice(0, 3))}${value.length > 3 ? '...' : ''}`
        : JSON.stringify(value);
      this.log(`  ${key}: ${display}`);
    }
  }

  /**
   * Resolves an import specifier (`./utils`, `@dashboard/foo`) to a normalized
   * workspace-relative path (`src/auth/utils.ts`). External npm packages and
   * unresolvable paths are dropped.
   */
  private resolveImports(imports: string[], fromFile: string): string[] {
    const out: string[] = [];
    const fromDir = path.dirname(fromFile);
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];

    for (const raw of imports) {
      const searchRoots: string[] = [];
      if (raw.startsWith('.')) {
        searchRoots.push(path.resolve(this.projectRoot, fromDir, raw));
      } else {
        for (const [alias, target] of Object.entries(this.pathAliases)) {
          if (raw.startsWith(alias)) {
            const rest = raw.slice(alias.length).replace(/^\/+/, '');
            searchRoots.push(path.resolve(this.projectRoot, target, rest));
          }
        }
        if (searchRoots.length === 0) {
          for (const base of this.baseUrlRoots) {
            searchRoots.push(path.resolve(this.projectRoot, base, raw));
          }
        }
      }
      if (searchRoots.length === 0) continue;

      let resolved: string | undefined;
      outer: for (const searchRoot of searchRoots) {
        const candidates = [
          searchRoot,
          ...exts.map((e) => searchRoot + e),
          ...exts.map((e) => path.join(searchRoot, `index${e}`)),
        ];
        for (const c of candidates) {
          try {
            if (fsSync.existsSync(c) && fsSync.statSync(c).isFile()) {
              resolved = c;
              break outer;
            }
          } catch {
            /* ignore */
          }
        }
      }
      if (!resolved) continue;

      out.push(normalizePath(resolved, this.projectRoot));
    }
    return out;
  }

  private convertSourceExtractionToFileEntry(
    result: ISourceExtractionResult,
    filePath: string,
  ): IFileEntry {
    return {
      name: path.basename(filePath),
      type: 'source',
      path: normalizePath(filePath, this.projectRoot),
      repoRoot: this.projectRoot,
      exports: result.exports ?? [],
      imports: this.resolveImports(result.imports ?? [], filePath),
      classes: result.classes ?? [],
      functions: result.functions ?? [],
      interfaces: result.interfaces ?? [],
      keywords: result.keywords ?? [],
      selectors: result.selectors,
      jsxTextContent: result.jsxTextContent,
      translationKeys: result.translationKeys,
      routesDefined: result.routesDefined,
      reduxUsage: result.reduxUsage,
      actionTypeStrings: result.actionTypeStrings,
      actionTypeConstExports: result.actionTypeConstExports,
      importedIdentifiers: result.importedIdentifiers,
    };
  }

  private convertCypressExtractionToFileEntry(
    result: ICypressExtractionResult,
    filePath: string,
    repoRoot: string,
  ): IFileEntry {
    return {
      name: path.basename(filePath),
      type: 'test',
      // A spec's registry key is relative to ITS OWN repo root, so cross-repo
      // specs don't collapse into "../.." paths.
      path: normalizePath(filePath, repoRoot),
      repoRoot,
      exports: [],
      // Cypress spec files import page objects, helpers, fixtures, and custom command modules.
      // These imports are needed so the import graph knows what shared helpers a test depends on.
      imports: this.resolveImports(result.imports ?? [], filePath),
      classes: [],
      functions: [],
      interfaces: [],
      keywords: [],
      cypress: {
        visitedRoutes: result.visitedRoutes,
        selectors: result.selectors,
        containsText: result.containsText,
        interceptedAPIs: result.interceptedAPIs,
        urlAssertions: result.urlAssertions,
        customCommandsUsed: result.customCommandsUsed,
        describeBlocks: result.describeBlocks,
        itBlocks: result.itBlocks,
      },
      actionTypeStrings: result.actionTypeStrings,
      importedIdentifiers: result.importedIdentifiers,
    };
  }
}
