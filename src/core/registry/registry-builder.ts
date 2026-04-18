import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

import { glob } from 'glob';
import * as ts from 'typescript';

import { CypressExtractorAnalyzer } from '@/core/analyzers/cypress-extractor';
import { SourceExtractorAnalyzer } from '@/core/analyzers/source-extractor';
import { normalizePath } from '@/core/registry/path-utils';
import { createRegistry } from '@/core/registry/registry';
import { loadTsConfigAliases } from '@/core/registry/tsconfig-loader';
import { ICypressExtractionResult, ISourceExtractionResult } from '@/types';
import { IRegistry, IFileEntry } from '@/types/registry';

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
   * Absolute path to the project root.
   * Default: process.cwd()
   */
  projectRoot?: string;

  /**
   * Path alias mappings for resolving imports in test files.
   * Keys are the alias prefix (e.g. "@fixtures/"), values are directories relative to projectRoot.
   */
  pathAliases?: Record<string, string>;

  /**
   * When true, logs detailed extraction and resolution info to stderr.
   */
  debug?: boolean;
}

export class RegistryBuilder {
  private registry: IRegistry;
  private projectRoot: string;
  private pathAliases: Record<string, string> = {};
  private baseUrlRoots: string[] = [];
  private debug = false;

  constructor() {
    this.registry = createRegistry();
    this.projectRoot = process.cwd();
  }

  async buildFromDirectories(config: RegistryBuilderConfig): Promise<IRegistry> {
    this.projectRoot = config.projectRoot ?? process.cwd();
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

    const fileEntries: IFileEntry[] = [];
    const sourceExtractor = new SourceExtractorAnalyzer();
    const cypressExtractor = new CypressExtractorAnalyzer();

    if (this.debug) {
      this.log(`projectRoot: ${this.projectRoot}`);
      this.log(`pathAliases (merged): ${JSON.stringify(this.pathAliases)}`);
      this.log(`baseUrlRoots (tsconfig): ${JSON.stringify(this.baseUrlRoots)}`);
    }

    // --- Process source files ---
    const sourceFiles = await this.findSourceFiles(config.sourceDirs, extensions, ignoreDirs);
    if (this.debug) this.log(`Found ${sourceFiles.length} source files.`);

    for (const filePath of sourceFiles) {
      try {
        const sourceCode = await fs.readFile(filePath, 'utf-8');
        const result = await sourceExtractor.extract({ filePath, sourceCode });
        const entry = this.convertSourceExtractionToFileEntry(result, filePath);
        fileEntries.push(entry);
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

    // --- Process test files ---
    const testFiles = await this.findTestFiles(config.testPatterns, ignoreDirs);
    if (this.debug) this.log(`Found ${testFiles.length} test files.`);

    for (const filePath of testFiles) {
      try {
        const sourceCode = await fs.readFile(filePath, 'utf-8');

        // Content-sniff: Cypress tests contain `cy.` calls; Jest/Vitest unit
        // tests don't. Route unit tests through SourceExtractor so we still
        // index their imports (the Direct/Transitive Import and Colocation
        // scorers rely on test imports). Cypress-style tests keep the full
        // selector + route + intercept extraction.
        if (this.looksLikeCypressTest(sourceCode)) {
          const result = await cypressExtractor.extract({
            filePath,
            sourceCode,
            resolveJsonImport: (importPath) => this.resolveJsonImport(importPath, filePath),
            resolveTsConstImport: (importPath) =>
              this.resolveTsConstImport(importPath, filePath),
          });
          const entry = this.convertCypressExtractionToFileEntry(result, filePath);
          fileEntries.push(entry);
          if (this.debug) {
            this.logExtraction('test', filePath, {
              selectors: result.selectors.length,
              visitedRoutes: result.visitedRoutes,
              containsText: result.containsText,
              customCommands: result.customCommandsUsed,
              imports: result.imports,
            });
          }
          continue;
        }

        const result = await sourceExtractor.extract({ filePath, sourceCode });
        const entry = this.convertSourceExtractionToFileEntry(result, filePath);
        entry.type = 'test';
        // Unit tests have no Cypress selectors/routes; drop source-only fields
        // that would skew the selector index for test files.
        entry.selectors = undefined;
        entry.routesDefined = undefined;
        fileEntries.push(entry);
        if (this.debug) {
          this.logExtraction('test', filePath, {
            imports: result.imports,
            kind: 'unit',
          });
        }
      } catch (error) {
        if (this.debug) this.log(`Failed to process test file ${filePath}: ${error}`);
      }
    }

    this.registry.buildFromFileEntries(fileEntries);
    return this.registry;
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
  ): Promise<string[]> {
    const extPattern = extensions.length === 1 ? extensions[0] : `{${extensions.join(',')}}`;

    const patterns = sourceDirs.map((dir) => `${dir}/**/*${extPattern}`);
    const ignorePatterns = ignoreDirs.map((d) => `**/${d}/**`);

    const files = await glob(patterns, {
      cwd: this.projectRoot,
      ignore: ignorePatterns,
      absolute: false, // return relative paths (we normalize them ourselves)
      nodir: true, // onlyFiles equivalent in glob
    });

    return files.map((f) => normalizePath(f, this.projectRoot));
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
  private async findTestFiles(testPatterns: string[], ignoreDirs: string[]): Promise<string[]> {
    const ignorePatterns = ignoreDirs.map((d) => `**/${d}/**`);

    // Fallback: if user didn't configure any testPatterns, sweep common layouts
    // (`**/*.cy.ts`, `**/*.spec.ts`, `**/*.test.ts`, `**/*.e2e.ts`, plus .tsx/.js/.jsx variants)
    // so pelican isn't silently blind on default installs.
    const effectivePatterns = testPatterns.length > 0
      ? testPatterns
      : ['**/*.{cy,spec,test,e2e,integration,int}.{ts,tsx,js,jsx,mts,cts}'];

    const files = await glob(effectivePatterns, {
      cwd: this.projectRoot,
      ignore: ignorePatterns,
      absolute: false,
      nodir: true,
    });

    return files.map((f) => normalizePath(f, this.projectRoot));
  }

  /**
   * Heuristic: a Cypress test contains a `cy.` call somewhere; unit tests
   * (Jest / Vitest) don't. Comment-stripping is unnecessary — Cypress specs
   * always have at least one `cy.visit` or `cy.get`, and false positives on
   * the word `cy.` inside a string literal are benign (we'd still extract
   * imports correctly either way).
   */
  private looksLikeCypressTest(sourceCode: string): boolean {
    return /\bcy\s*\.\s*[a-zA-Z_]/.test(sourceCode);
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
        const sourceFile = ts.createSourceFile(
          candidate,
          content,
          ts.ScriptTarget.Latest,
          true,
        );

        const result = new Map<string, Record<string, string>>();
        for (const stmt of sourceFile.statements) {
          if (!ts.isVariableStatement(stmt)) continue;
          const isExported = ts
            .getModifiers(stmt)
            ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
          if (!isExported) continue;

          for (const decl of stmt.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name)) continue;
            if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) continue;

            const obj: Record<string, string> = {};
            for (const prop of decl.initializer.properties) {
              if (!ts.isPropertyAssignment(prop)) continue;
              const key = prop.name.getText(sourceFile).replace(/['"]/g, '');
              if (ts.isStringLiteral(prop.initializer)) {
                obj[key] = prop.initializer.text;
              } else if (ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
                obj[key] = prop.initializer.text;
              }
            }
            if (Object.keys(obj).length > 0) result.set(decl.name.text, obj);
          }
        }

        if (result.size > 0) {
          if (this.debug) {
            this.log(`resolveTsConstImport: ${candidate} exports [${[...result.keys()].join(', ')}]`);
          }
          return result;
        }
      } catch {
        // try next candidate
      }
    }

    return null;
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
          this.log(`  ✓ resolved: ${candidate} (${keys.length} keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''})`);
        }
        return parsed;
      } catch {
        if (this.debug) {
          this.log(`  ✗ failed: ${candidate}`);
        }
      }
    }

    if (this.debug && candidates.length === 0) {
      this.log(`  ⚠ no alias matched for "${importPath}". Configure pathAliases in .pelicanrc.json`);
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
          } catch { /* ignore */ }
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
    };
  }

  private convertCypressExtractionToFileEntry(
    result: ICypressExtractionResult,
    filePath: string,
  ): IFileEntry {
    return {
      name: path.basename(filePath),
      type: 'test',
      path: normalizePath(filePath, this.projectRoot),
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
    };
  }
}
