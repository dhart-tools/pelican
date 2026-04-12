import * as fs from 'fs';
import * as path from 'path';

import * as ts from 'typescript';

import { BaseAnalyzer } from '@/core/analyzers/base';
import {
  IImportGraph,
  IImportGraphExtractionResult,
  IExportMetadata,
  IBarrelIndex,
  ISpecRegistry,
  IImportGraphAnalyzerInput,
  IAliasMap,
  IAliasResolverConfig,
} from '@/types/analyzers';
import { PROJECT_EXTENSIONS } from '@/utils/constants';
import { EAnalyzerName, EImportExportType } from '@/utils/enums';
// =============================================================================
// AliasResolver
// =============================================================================

/**
 * AliasResolver handles the expansion of path aliases (e.g. @/) into absolute
 * filesystem paths based on project configuration (tsconfig, vite, webpack).
 */
export class AliasResolver {
  private aliasMap: IAliasMap = {};

  constructor(config: IAliasResolverConfig = {}) {
    const {
      projectRoot = process.cwd(),
      aliases = {},
      configFiles = ['tsconfig', 'vite', 'webpack'],
    } = config;

    // Load from each config source. User-supplied aliases win (merged last).
    if (configFiles.includes('tsconfig')) {
      this.mergeAliases(this.loadFromTsConfig(projectRoot));
    }
    if (configFiles.includes('vite')) {
      this.mergeAliases(this.loadFromViteConfig(projectRoot));
    }
    if (configFiles.includes('webpack')) {
      this.mergeAliases(this.loadFromWebpackConfig(projectRoot));
    }

    const resolvedUserAliases: IAliasMap = {};
    for (const [prefix, target] of Object.entries(aliases)) {
      resolvedUserAliases[prefix] = path.isAbsolute(target)
        ? target
        : path.resolve(projectRoot, target);
    }
    this.mergeAliases(resolvedUserAliases);
  }

  /**
   * Resolves a module specifier to an absolute path if it matches an alias.
   */
  resolve(specifier: string): string {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      return specifier;
    }

    const sortedPrefixes = Object.keys(this.aliasMap).sort((a, b) => b.length - a.length);

    for (const prefix of sortedPrefixes) {
      const target = this.aliasMap[prefix];

      if (specifier === prefix) {
        return target;
      }
      if (specifier.startsWith(prefix + '/')) {
        const remainder = specifier.slice(prefix.length + 1);
        return path.join(target, remainder);
      }
    }

    return specifier;
  }

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
      return {};
    }
  }

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
      const objPattern =
        /['"]([^'"]+)['"]\s*:\s*path\.(?:resolve|join)\s*\([^,)]+,\s*['"]([^'"]+)['"]\)/g;
      let m: RegExpExecArray | null;
      while ((m = objPattern.exec(raw)) !== null) {
        const prefix = m[1].replace(/\/\*$/, '');
        const rel = m[2].replace(/\/\*$/, '');
        result[prefix] = path.resolve(projectRoot, rel);
      }
    } catch {
      // Ignored
    }
    return result;
  }

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
      const pattern =
        /['"]([^'"]+)['"]\s*:\s*path\.(?:resolve|join)\s*\([^,)]+,\s*['"]([^'"]+)['"]\)/g;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(raw)) !== null) {
        const prefix = m[1].replace(/\/?$/, '');
        const rel = m[2].replace(/\/?$/, '');
        result[prefix] = path.resolve(projectRoot, rel);
      }
    } catch {
      // Ignored
    }
    return result;
  }

  private mergeAliases(incoming: IAliasMap): void {
    Object.assign(this.aliasMap, incoming);
  }
}

// =============================================================================
// ImportGraphAnalyzer
// =============================================================================

/**
 * ImportGraphAnalyzer: Builds a bidirectional dependency graph tracing
 * imports between source files. This provides the foundation for transitive
 * impact analysis and ranked test suggestions.
 *
 * Features:
 * 1. Alias resolution for tsconfig, Vite, and Webpack.
 * 2. Specialized barrel file resolution (storing and expanding re-exports).
 * 3. Support for dynamic import() expressions and common require() calls.
 * 4. Filtering of type-only imports to accurately reflect runtime dependencies.
 * 5. Transitive dependent/dependency analysis with configurable depth.
 */
export class ImportGraphAnalyzer extends BaseAnalyzer<
  IImportGraphAnalyzerInput,
  IImportGraphExtractionResult
> {
  name = EAnalyzerName.IMPORT_GRAPH_ANALYZER;
  version = '1.0.0';
  dependencies = [EAnalyzerName.SOURCE_EXTRACTOR];

  /**
   * Internal index of barrel files to their re-exported contents.
   */
  private barrelIndex: IBarrelIndex = new Map();

  /**
   * Extracts import and export metadata from a single source file.
   *
   * @param input.filePath      Absolute path to the file.
   * @param input.sourceCode    Raw content of the file.
   * @param input.aliasConfig   Configuration for resolving path aliases.
   */
  async extract(input: IImportGraphAnalyzerInput): Promise<IImportGraphExtractionResult> {
    const { filePath, sourceCode, aliasConfig } = input;
    const baseDir = path.dirname(filePath);

    const resolver = new AliasResolver({
      projectRoot: aliasConfig?.projectRoot ?? baseDir,
      ...aliasConfig,
    });

    const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);

    const result: IImportGraphExtractionResult = {
      filePath,
      imports: [],
      exports: [],
    };

    this.visitNode(sourceFile, result, baseDir, resolver);

    return result;
  }

  /**
   * Required by BaseAnalyzer; useful for logging or additional indexing metadata.
   */
  index(_output: IImportGraphExtractionResult): void {
    // Current pattern does not require centralized indexing during extraction pass,
    // as building the graph usually occurs as a secondary pass over all results.
  }

  /**
   * Processes all extraction results to build the full bidirectional graph.
   *
   * Resolution Pass 1: Build barrel contents index from all exports.
   * Resolution Pass 2: Map imports to their real source files (expanding barrels).
   *
   * @param extractions Array of results from multiple analyze calls.
   * @returns A complete IImportGraph structure.
   */
  buildImportGraph(extractions: IImportGraphExtractionResult[]): IImportGraph {
    const importGraph: IImportGraph = {
      dependencies: new Map(),
      dependents: new Map(),
    };

    // First pass: Index barrels
    this.barrelIndex.clear();
    for (const extraction of extractions) {
      this.addExportsToBarrelIndex(extraction.filePath, extraction.exports);
    }

    // Second pass: Build dependency edges
    for (const extraction of extractions) {
      const filePath = extraction.filePath;
      const deps = importGraph.dependencies.get(filePath) || new Set<string>();

      for (const imp of extraction.imports) {
        if (imp.isTypeOnly) continue;

        // Resolve through barrels (conservative mapping)
        const resolvedFiles = this.resolveThroughBarrels(imp.resolvedPath, imp.specifier);

        for (const targetFile of resolvedFiles) {
          deps.add(targetFile);

          const dependents = importGraph.dependents.get(targetFile) || new Set<string>();
          dependents.add(filePath);
          importGraph.dependents.set(targetFile, dependents);
        }
      }

      importGraph.dependencies.set(filePath, deps);
    }

    return importGraph;
  }

  // ─── Recursive AST Visitors ───────────────────────────────────────────────

  private visitNode(
    node: ts.Node,
    result: IImportGraphExtractionResult,
    baseDir: string,
    resolver: AliasResolver,
  ): void {
    // 1. Static Import Statement: import { X } from './Y'
    if (ts.isImportDeclaration(node)) {
      this.handleImportDeclaration(node, result, baseDir, resolver);
    }

    // 2. Export Declaration with Source: export { X } from './Y'
    if (ts.isExportDeclaration(node)) {
      this.handleExportDeclaration(node, result, baseDir, resolver);
    }

    // 3. Export Default (Assignment)
    if (ts.isExportAssignment(node)) {
      result.exports.push({ name: 'default', type: EImportExportType.DEFAULT });
    }

    // 4. Exported Variable, Function, or Class Declarations
    if (
      ts.isVariableStatement(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node)
    ) {
      this.handleExportedDeclaration(node, result);
    }

    // 5. Function Calls (dynamic imports and require)
    if (ts.isCallExpression(node)) {
      this.handleCallExpression(node, result, baseDir, resolver);
    }

    ts.forEachChild(node, (child) => this.visitNode(child, result, baseDir, resolver));
  }

  private handleImportDeclaration(
    node: ts.ImportDeclaration,
    result: IImportGraphExtractionResult,
    baseDir: string,
    resolver: AliasResolver,
  ): void {
    const specifier = node.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) return;

    const source = specifier.text;
    const resolvedPath = this.resolvePath(source, baseDir, resolver);
    const isTypeOnly = node.importClause?.isTypeOnly === true;

    // Default import: import Home from './Home'
    if (node.importClause?.name) {
      result.imports.push({
        source,
        resolvedPath,
        type: EImportExportType.DEFAULT,
        specifier: node.importClause.name.text,
        isTypeOnly,
      });
    }

    const namedBindings = node.importClause?.namedBindings;
    if (namedBindings) {
      // Namespace import: import * as Utils from './Utils'
      if (ts.isNamespaceImport(namedBindings)) {
        result.imports.push({
          source,
          resolvedPath,
          type: EImportExportType.NAMESPACE,
          specifier: namedBindings.name.text,
          isTypeOnly,
        });
      }
      // Named bindings: import { A, B } from './File'
      else if (ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          result.imports.push({
            source,
            resolvedPath,
            type: EImportExportType.NAMED,
            specifier: element.name.text,
            isTypeOnly: isTypeOnly || element.isTypeOnly,
          });
        }
      }
    }

    // Side-effect import: import './styles.css'
    if (!node.importClause) {
      result.imports.push({
        source,
        resolvedPath,
        type: EImportExportType.NAMED, // Categorized as named for dependency tracking
        isTypeOnly: false,
      });
    }
  }

  private handleExportDeclaration(
    node: ts.ExportDeclaration,
    result: IImportGraphExtractionResult,
    baseDir: string,
    resolver: AliasResolver,
  ): void {
    const specifier = node.moduleSpecifier;
    let resolvedSource: string | undefined;

    if (specifier && ts.isStringLiteral(specifier)) {
      resolvedSource = this.resolvePath(specifier.text, baseDir, resolver);
    }

    const exportClause = node.exportClause;
    if (exportClause && ts.isNamedExports(exportClause)) {
      for (const element of exportClause.elements) {
        result.exports.push({
          name: element.name.text,
          source: specifier && ts.isStringLiteral(specifier) ? specifier.text : undefined,
          resolvedSource,
          type:
            node.isTypeOnly || element.isTypeOnly
              ? EImportExportType.TYPE
              : EImportExportType.NAMED,
        });
      }
    } else if (!exportClause && resolvedSource) {
      // Wildcard re-export: export * from './File'
      result.exports.push({
        name: '*',
        source: specifier && ts.isStringLiteral(specifier) ? specifier.text : undefined,
        resolvedSource,
        type: EImportExportType.NAMESPACE,
      });
    }
  }

  private handleCallExpression(
    node: ts.CallExpression,
    result: IImportGraphExtractionResult,
    baseDir: string,
    resolver: AliasResolver,
  ): void {
    // Dynamic import()
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        const source = arg.text;
        result.imports.push({
          source,
          resolvedPath: this.resolvePath(source, baseDir, resolver),
          type: EImportExportType.NAMESPACE,
          isDynamic: true,
          isTypeOnly: false,
        });
      }
    }

    // require()
    if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        const source = arg.text;
        const resolvedPath = this.resolvePath(source, baseDir, resolver);

        // Deduplicate against static imports
        if (!result.imports.some((i) => i.source === source && !i.isDynamic)) {
          result.imports.push({
            source,
            resolvedPath,
            type: EImportExportType.DEFAULT,
            isTypeOnly: false,
          });
        }
      }
    }
  }

  private handleExportedDeclaration(
    node: ts.VariableStatement | ts.FunctionDeclaration | ts.ClassDeclaration,
    result: IImportGraphExtractionResult,
  ): void {
    const modifiers = ts.getModifiers(node);
    const isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) return;

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          result.exports.push({
            name: declaration.name.text,
            type: EImportExportType.NAMED,
          });
        }
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      result.exports.push({
        name: node.name.text,
        type: EImportExportType.NAMED,
      });
    } else if (ts.isClassDeclaration(node) && node.name) {
      result.exports.push({
        name: node.name.text,
        type: EImportExportType.NAMED,
      });
    }
  }

  // ─── Transitive Graph Analysis ────────────────────────────────────────────

  /**
   * Traces all files that transitively import the given file.
   * "If I change X, what might break?"
   *
   * @example
   *   // File B imports A, File C imports B.
   *   getTransitiveDependents(graph, 'A.ts') → Map { 'B.ts' => 1, 'C.ts' => 2 }
   */
  getTransitiveDependents(
    graph: IImportGraph,
    filePath: string,
    maxDepth = 10,
  ): Map<string, number> {
    const dependents = new Map<string, number>();
    const visited = new Set<string>();

    const traverse = (current: string, depth: number) => {
      if (depth > maxDepth || visited.has(current)) return;
      visited.add(current);

      const directDependents = graph.dependents.get(current);
      if (!directDependents) return;

      for (const dep of directDependents) {
        const existingDepth = dependents.get(dep) ?? Infinity;
        dependents.set(dep, Math.min(existingDepth, depth));
        traverse(dep, depth + 1);
      }
    };

    traverse(filePath, 1);
    return dependents;
  }

  /**
   * Traces all files the given file transitively depends on.
   */
  getTransitiveDependencies(
    graph: IImportGraph,
    filePath: string,
    maxDepth = 10,
  ): Map<string, number> {
    const dependencies = new Map<string, number>();
    const visited = new Set<string>();

    const traverse = (current: string, depth: number) => {
      if (depth > maxDepth || visited.has(current)) return;
      visited.add(current);

      const directDeps = graph.dependencies.get(current);
      if (!directDeps) return;

      for (const dep of directDeps) {
        const existingDepth = dependencies.get(dep) ?? Infinity;
        dependencies.set(dep, Math.min(existingDepth, depth));
        traverse(dep, depth + 1);
      }
    };

    traverse(filePath, 1);
    return dependencies;
  }

  /**
   * Ranks Cypress spec files that test the changed file or its dependents.
   * Ranked by proximity: Depth 0 (direct) > Depth 1 (importing) > Depth 2+ (transitive).
   */
  suggestSpecFiles(
    // TODO: Make these parameters configurable
    graph: IImportGraph,
    changedFile: string,
    specRegistry: ISpecRegistry,
    maxDepth = 10,
  ): Array<{ specFile: string; depth: number }> {
    const dependents = this.getTransitiveDependents(graph, changedFile, maxDepth);
    const suggestions = new Map<string, number>();

    // 1. Direct matches (Depth 0)
    const directSpecs = specRegistry.get(changedFile);
    if (directSpecs) {
      for (const spec of directSpecs) {
        suggestions.set(spec, 0);
      }
    }

    // 2. Transitive matches (Depth 1+)
    for (const [dependentFile, depth] of dependents) {
      const specs = specRegistry.get(dependentFile);
      if (!specs) continue;

      for (const spec of specs) {
        const existing = suggestions.get(spec) ?? Infinity;
        suggestions.set(spec, Math.min(existing, depth));
      }
    }

    return Array.from(suggestions.entries())
      .map(([specFile, depth]) => ({ specFile, depth }))
      .sort((a, b) => a.depth - b.depth);
  }

  /**
   * Patch-updates a graph when a single file changes, avoiding a full rebuild.
   */
  updateGraph(graph: IImportGraph, extraction: IImportGraphExtractionResult): void {
    const filePath = extraction.filePath;

    // Clear old outgoing edges
    const oldDeps = graph.dependencies.get(filePath);
    if (oldDeps) {
      for (const target of oldDeps) {
        const dependents = graph.dependents.get(target);
        if (dependents) {
          dependents.delete(filePath);
          if (dependents.size === 0) graph.dependents.delete(target);
        }
      }
    }

    // Add new edges
    const newDeps = new Set<string>();
    for (const imp of extraction.imports) {
      if (imp.isTypeOnly) continue;

      const targets = this.resolveThroughBarrels(imp.resolvedPath, imp.specifier);
      for (const target of targets) {
        newDeps.add(target);
        const dependents = graph.dependents.get(target) || new Set<string>();
        dependents.add(filePath);
        graph.dependents.set(target, dependents);
      }
    }
    graph.dependencies.set(filePath, newDeps);
  }

  // ─── Helper Logic ─────────────────────────────────────────────────────────

  private resolvePath(source: string, baseDir: string, resolver: AliasResolver): string {
    const resolved = resolver.resolve(source);

    // If it's a node_module or absolute after alias expansion
    if (!resolved.startsWith('.') && !path.isAbsolute(resolved)) {
      return resolved;
    }

    const absPath = path.isAbsolute(resolved) ? resolved : path.resolve(baseDir, resolved);

    // Extension probe
    for (const ext of PROJECT_EXTENSIONS) {
      if (fs.existsSync(absPath + ext)) return absPath + ext;
    }

    // Index probe
    for (const ext of PROJECT_EXTENSIONS) {
      const indexPath = path.join(absPath, `index${ext}`);
      if (fs.existsSync(indexPath)) return indexPath;
    }

    return absPath;
  }

  private addExportsToBarrelIndex(filePath: string, exports: IExportMetadata[]): void {
    const contents = new Set<string>();
    for (const exp of exports) {
      if (exp.resolvedSource) {
        contents.add(exp.resolvedSource);
      }
    }
    if (contents.size > 0) {
      this.barrelIndex.set(filePath, contents);
    }
  }

  private resolveThroughBarrels(resolvedPath: string, _specifier?: string): string[] {
    const barrelContents = this.barrelIndex.get(resolvedPath);
    if (!barrelContents || barrelContents.size === 0) {
      return [resolvedPath];
    }

    // Conservative approximation: a barrel import depends on all re-exported files
    // in that barrel. A more expensive implementation would scan the exports of each
    // file in barrelContents to find exactly where 'specifier' lived.
    return Array.from(barrelContents);
  }
}
