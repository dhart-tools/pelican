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
}

export class RegistryBuilder {
  private registry: IRegistry;
  private projectRoot: string;

  constructor() {
    this.registry = createRegistry();
    this.projectRoot = process.cwd();
  }

  async buildFromDirectories(config: RegistryBuilderConfig): Promise<IRegistry> {
    this.projectRoot = config.projectRoot ?? process.cwd();

    const extensions = config.sourceExtensions ?? ['.ts', '.tsx', '.js', '.jsx'];
    const ignoreDirs = config.ignoreDirs ?? ['node_modules', 'dist', 'build', '.next', 'coverage'];

    const fileEntries: IFileEntry[] = [];
    const sourceExtractor = new SourceExtractorAnalyzer();
    const cypressExtractor = new CypressExtractorAnalyzer();

    // --- Process source files ---
    const sourceFiles = await this.findSourceFiles(config.sourceDirs, extensions, ignoreDirs);
    console.log(`[RegistryBuilder] Found ${sourceFiles.length} source files.`);

    for (const filePath of sourceFiles) {
      try {
        const sourceCode = await fs.readFile(filePath, 'utf-8');
        const result = await sourceExtractor.extract({ filePath, sourceCode });
        fileEntries.push(this.convertSourceExtractionToFileEntry(result, filePath));
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
        fileEntries.push(this.convertCypressExtractionToFileEntry(result, filePath));
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
   * Handles relative imports and common Cypress path aliases (@fixtures/, @/).
   */
  private async resolveJsonImport(
    importPath: string,
    fromFile: string,
  ): Promise<Record<string, unknown> | null> {
    const candidates: string[] = [];

    if (importPath.startsWith('.')) {
      // Relative import — resolve from the importing file's directory
      candidates.push(path.resolve(this.projectRoot, path.dirname(fromFile), importPath));
    } else if (importPath.startsWith('@fixtures/') || importPath.startsWith('@fixtures\\')) {
      // Common Cypress alias: @fixtures/ → cypress/fixtures/
      candidates.push(
        path.resolve(this.projectRoot, 'cypress/fixtures', importPath.slice('@fixtures/'.length)),
      );
    } else if (importPath.startsWith('@/') || importPath.startsWith('@\\')) {
      // Project root alias: @/ → ./
      candidates.push(path.resolve(this.projectRoot, importPath.slice('@/'.length)));
    }

    for (const candidate of candidates) {
      try {
        const content = await fs.readFile(candidate, 'utf-8');
        return JSON.parse(content) as Record<string, unknown>;
      } catch {
        // Try next candidate
      }
    }

    return null;
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
