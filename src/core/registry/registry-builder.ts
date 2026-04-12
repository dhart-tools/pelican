import * as fs from 'fs/promises';
import * as path from 'path';

import { glob } from 'glob';

import { CypressExtractorAnalyzer } from '@/core/analyzers/cypress-extractor';
import { SourceExtractorAnalyzer } from '@/core/analyzers/source-extractor';
import { normalizePath } from '@/core/registry/path-utils';
import { createRegistry } from '@/core/registry/registry';
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
  private debug = false;

  constructor() {
    this.registry = createRegistry();
    this.projectRoot = process.cwd();
  }

  async buildFromDirectories(config: RegistryBuilderConfig): Promise<IRegistry> {
    this.projectRoot = config.projectRoot ?? process.cwd();
    this.pathAliases = config.pathAliases ?? {};
    this.debug = config.debug ?? false;

    const extensions = config.sourceExtensions ?? ['.ts', '.tsx', '.js', '.jsx'];
    const ignoreDirs = config.ignoreDirs ?? ['node_modules', 'dist', 'build', '.next', 'coverage'];

    const fileEntries: IFileEntry[] = [];
    const sourceExtractor = new SourceExtractorAnalyzer();
    const cypressExtractor = new CypressExtractorAnalyzer();

    if (this.debug) {
      this.log(`projectRoot: ${this.projectRoot}`);
      this.log(`pathAliases: ${JSON.stringify(this.pathAliases)}`);
    }

    // --- Process source files ---
    const sourceFiles = await this.findSourceFiles(config.sourceDirs, extensions, ignoreDirs);
    console.log(`[RegistryBuilder] Found ${sourceFiles.length} source files.`);

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
        console.warn(`[RegistryBuilder] Failed to process source file ${filePath}:`, error);
      }
    }

    // --- Process test files ---
    const testFiles = await this.findTestFiles(config.testPatterns, ignoreDirs);
    console.log(`[RegistryBuilder] Found ${testFiles.length} test files.`);

    for (const filePath of testFiles) {
      try {
        const sourceCode = await fs.readFile(filePath, 'utf-8');
        const result = await cypressExtractor.extract({
          filePath,
          sourceCode,
          resolveJsonImport: (importPath) => this.resolveJsonImport(importPath, filePath),
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
      } catch (error) {
        console.warn(`[RegistryBuilder] Failed to process test file ${filePath}:`, error);
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

    const files = await glob(testPatterns, {
      cwd: this.projectRoot,
      ignore: ignorePatterns,
      absolute: false,
      nodir: true,
    });

    return files.map((f) => normalizePath(f, this.projectRoot));
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
      // Try configured path aliases
      for (const [alias, target] of Object.entries(this.pathAliases)) {
        if (importPath.startsWith(alias)) {
          const rest = importPath.slice(alias.length);
          candidates.push(path.resolve(this.projectRoot, target, rest));
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
      this.log(`  ⚠ no alias matched for "${importPath}". Configure pathAliases in .suggestorrc.json`);
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

  private convertSourceExtractionToFileEntry(
    result: ISourceExtractionResult,
    filePath: string,
  ): IFileEntry {
    return {
      name: path.basename(filePath),
      type: 'source',
      path: normalizePath(filePath, this.projectRoot),
      exports: result.exports ?? [],
      imports: (result.imports ?? []).map((p: string) => normalizePath(p, this.projectRoot)),
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
      imports: (result.imports ?? []).map((p: string) => normalizePath(p, this.projectRoot)),
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
