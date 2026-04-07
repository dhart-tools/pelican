import * as fs from 'fs/promises';
import * as path from 'path';

import { glob } from 'glob';
import pLimit from 'p-limit';

import { CypressExtractorAnalyzer } from '@v2/core/analyzers/cypress-extractor';
import { SourceExtractorAnalyzer } from '@v2/core/analyzers/source-extractor';
import { normalizePath } from '@v2/core/registry/path-utils';
import { createRegistry } from '@v2/core/registry/registry';
import { ICypressExtractionResult, ISourceExtractionResult, ISuggestorConfig } from '@v2/types';
import { IRegistry, IFileEntry } from '@v2/types/registry';

import {
  convertCypressExtractionToFileEntry,
  convertSourceExtractionToFileEntry,
} from './result-converters';

export interface BuildProgress {
  message: string;
  current: number;
  total: number;
  type: 'source' | 'test';
}

export class RegistryBuilder {
  private registry: IRegistry;
  private projectRoot: string;
  private onProgress?: (progress: BuildProgress) => void;

  constructor(projectRoot: string = process.cwd(), onProgress?: (p: BuildProgress) => void) {
    this.registry = createRegistry();
    this.projectRoot = projectRoot;
    this.onProgress = onProgress;
  }

  /**
   * Helper to build a registry from configuration.
   */
  static async build(
    config: ISuggestorConfig,
    projectRoot: string = process.cwd(),
    onProgress?: (p: BuildProgress) => void,
  ): Promise<IRegistry> {
    const builder = new RegistryBuilder(projectRoot, onProgress);
    return builder.buildFromConfig(config);
  }

  async buildFromConfig(config: ISuggestorConfig): Promise<IRegistry> {
    const sourceDirs = config.sourceDirs ?? ['src'];
    const testPatterns = config.testPatterns ?? ['**/*.cy.ts', '**/*.cy.tsx'];
    const ignorePatterns = config.ignorePatterns ?? ['node_modules', 'dist', '.git'];
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    const fileEntries: IFileEntry[] = [];
    const sourceExtractor = new SourceExtractorAnalyzer();
    const cypressExtractor = new CypressExtractorAnalyzer();

    const limit = pLimit(10); // Concurrent processing limit

    // --- 1. Find all files ---
    const sourceFiles = await this.findFiles(
      sourceDirs.map((d) => `${d}/**/*{${extensions.join(',')}}`),
      ignorePatterns,
    );
    const testFiles = await this.findFiles(testPatterns, ignorePatterns);

    // --- 2. Process source files in parallel ---
    if (sourceFiles.length > 0) {
      this.notify('Starting source file extraction...', 0, sourceFiles.length, 'source');

      const sourceTasks = sourceFiles.map((filePath, index) =>
        limit(async () => {
          try {
            const sourceCode = await fs.readFile(filePath, 'utf-8');
            const result = await sourceExtractor.extract({ filePath, sourceCode });
            fileEntries.push(convertSourceExtractionToFileEntry(result, filePath, this.projectRoot));
            this.notify(
              `Extracted: ${path.relative(this.projectRoot, filePath)}`,
              index + 1,
              sourceFiles.length,
              'source',
            );
          } catch (error) {
            console.warn(`[RegistryBuilder] Failed to process source file ${filePath}:`, error);
          }
        }),
      );
      await Promise.all(sourceTasks);
    }

    // --- 3. Process test files in parallel ---
    if (testFiles.length > 0) {
      this.notify('Starting test file extraction...', 0, testFiles.length, 'test');

      const testTasks = testFiles.map((filePath, index) =>
        limit(async () => {
          try {
            const sourceCode = await fs.readFile(filePath, 'utf-8');
            const result = await cypressExtractor.extract({ filePath, sourceCode });
            fileEntries.push(convertCypressExtractionToFileEntry(result, filePath, this.projectRoot));
            this.notify(
              `Extracted: ${path.relative(this.projectRoot, filePath)}`,
              index + 1,
              testFiles.length,
              'test',
            );
          } catch (error) {
            console.warn(`[RegistryBuilder] Failed to process test file ${filePath}:`, error);
          }
        }),
      );
      await Promise.all(testTasks);
    }

    this.registry.buildFromFileEntries(fileEntries);
    return this.registry;
  }

  /**
   * Finds all files matching the given patterns, respecting ignore patterns.
   */
  private async findFiles(patterns: string[], ignore: string[]): Promise<string[]> {
    const ignorePatterns = ignore.map((d) => (d.includes('**') ? d : `**/${d}/**`));

    const files = await glob(patterns, {
      cwd: this.projectRoot,
      ignore: ignorePatterns,
      absolute: true, // Use absolute paths for stability
      nodir: true,
    });

    return files.map((f) => normalizePath(f, this.projectRoot));
  }

  private notify(message: string, current: number, total: number, type: 'source' | 'test') {
    if (this.onProgress) {
      this.onProgress({ message, current, total, type });
    }
  }
}
