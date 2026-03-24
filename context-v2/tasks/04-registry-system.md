# Task 04: Registry System

## Overview

Create the central registry that stores and manages all extracted metadata from analyzers. The registry provides indexed access to files, import graphs, selectors, routes, translations, and Redux chains.

## Objectives

1. Create central registry store
2. Build and maintain import graph (bidirectional)
3. Build indexed lookups for fast queries
4. Support registry serialization/persistence
5. Provide query interface for scoring engine

## Core Types

```typescript
export interface IRegistry {
  files: Map<string, IFileEntry>;
  importGraph: IImportGraph;

  // Indexes
  getSelectorIndex(): Map<string, Set<string>>;
  setSelectorIndex(index: Map<string, Set<string>>): void;

  getRouteMap(): Map<string, string>;
  setRouteMap(map: Map<string, string>): void;

  getTranslationIndex(): ITranslationIndex;
  setTranslationIndex(index: ITranslationIndex): void;

  getReduxChains(): Map<string, IReduxChain>;
  setReduxChains(chains: Map<string, IReduxChain>): void;

  getTextIndex(): Map<string, Set<string>>;
  setTextIndex(index: Map<string, Set<string>>): void;

  // Query methods
  getFile(path: string): IFileEntry | undefined;
  getFilesByType(type: 'source' | 'test'): IFileEntry[];

  // Build methods
  buildFromFileEntries(entries: IFileEntry[]): void;
  buildImportGraph(entries: IFileEntry[]): void;
  buildSelectorIndex(entries: IFileEntry[]): void;
  buildRouteMap(entries: IFileEntry[]): void;

  // Persistence
  serialize(): string;
  deserialize(data: string): void;
}

export interface IImportGraph {
  dependencies: Map<string, Set<string>>;    // file → files it imports
  dependents: Map<string, Set<string>>;      // file → files that import it
}

export interface ITranslationIndex {
  keyToText: Map<string, string>;           // translation key → translated text
  textToKeys: Map<string, string[]>;        // translated text → keys
  keyToFiles: Map<string, Set<string>>;     // translation key → source files
}

export interface IReduxChain {
  sliceName: string;
  files: {
    actions?: string;
    reducer?: string;
    selectors?: string;
    sagas?: string[];
    types?: string;
    slice?: string;
  };
  actionTypes: string[];
  selectorNames: string[];
  consumers: string[];
}
```

## Implementation

### 1. Create Registry Class

**File:** `src/core/registry.ts`

```typescript
import {
  IRegistry,
  IFileEntry,
  IImportGraph,
  ITranslationIndex,
  IReduxChain,
  ISourceExtractionResult,
  ICypressExtractionResult
} from './types';

export class Registry implements IRegistry {
  private files: Map<string, IFileEntry> = new Map();
  private importGraph: IImportGraph = {
    dependencies: new Map(),
    dependents: new Map()
  };

  // Indexes
  private selectorIndex: Map<string, Set<string>> = new Map();
  private routeMap: Map<string, string> = new Map();
  private translationIndex: ITranslationIndex = {
    keyToText: new Map(),
    textToKeys: new Map(),
    keyToFiles: new Map()
  };
  private reduxChains: Map<string, IReduxChain> = new Map();
  private textIndex: Map<string, Set<string>> = new Map();

  // ========== Core Methods ==========

  getFiles(): Map<string, IFileEntry> {
    return this.files;
  }

  getImportGraph(): IImportGraph {
    return this.importGraph;
  }

  // ========== Index Methods ==========

  getSelectorIndex(): Map<string, Set<string>> {
    return this.selectorIndex;
  }

  setSelectorIndex(index: Map<string, Set<string>>): void {
    this.selectorIndex = index;
  }

  getRouteMap(): Map<string, string> {
    return this.routeMap;
  }

  setRouteMap(map: Map<string, string>): void {
    this.routeMap = map;
  }

  getTranslationIndex(): ITranslationIndex {
    return this.translationIndex;
  }

  setTranslationIndex(index: ITranslationIndex): void {
    this.translationIndex = index;
  }

  getReduxChains(): Map<string, IReduxChain> {
    return this.reduxChains;
  }

  setReduxChains(chains: Map<string, IReduxChain>): void {
    this.reduxChains = chains;
  }

  getTextIndex(): Map<string, Set<string>> {
    return this.textIndex;
  }

  setTextIndex(index: Map<string, Set<string>>): void {
    this.textIndex = index;
  }

  getIndex<T>(name: string): Map<any, any> | undefined {
    switch (name) {
      case 'selectors':
        return this.selectorIndex as any;
      case 'routes':
        return this.routeMap as any;
      case 'translations':
        return this.translationIndex.keyToText as any;
      case 'reduxChains':
        return this.reduxChains as any;
      case 'text':
        return this.textIndex as any;
      default:
        return undefined;
    }
  }

  setIndex<T>(name: string, index: Map<any, any>): void {
    switch (name) {
      case 'selectors':
        this.selectorIndex = index;
        break;
      case 'routes':
        this.routeMap = index;
        break;
      case 'translations':
        this.translationIndex.keyToText = index;
        break;
      case 'reduxChains':
        this.reduxChains = index;
        break;
      case 'text':
        this.textIndex = index;
        break;
    }
  }

  // ========== Query Methods ==========

  getFile(path: string): IFileEntry | undefined {
    return this.files.get(path);
  }

  getFilesByType(type: 'source' | 'test'): IFileEntry[] {
    return Array.from(this.files.values()).filter((f) => f.type === type);
  }

  getDependencies(filePath: string): Set<string> {
    return this.importGraph.dependencies.get(filePath) || new Set();
  }

  getDependents(filePath: string): Set<string> {
    return this.importGraph.dependents.get(filePath) || new Set();
  }

  // ========== Build Methods ==========

  buildFromFileEntries(entries: IFileEntry[]): void {
    // Clear existing data
    this.files.clear();
    this.importGraph.dependencies.clear();
    this.importGraph.dependents.clear();
    this.selectorIndex.clear();
    this.routeMap.clear();
    this.textIndex.clear();

    // Add files
    for (const entry of entries) {
      this.files.set(entry.path, entry);
    }

    // Build indexes
    this.buildImportGraph(entries);
    this.buildSelectorIndex(entries);
    this.buildRouteMap(entries);
    this.buildTextIndex(entries);
  }

  buildImportGraph(entries: IFileEntry[]): void {
    for (const entry of entries) {
      const filePath = entry.path;

      // Build dependencies map
      const deps = this.importGraph.dependencies.get(filePath) || new Set();
      for (const importPath of entry.imports) {
        deps.add(importPath);

        // Build reverse map (dependents)
        const dependents = this.importGraph.dependents.get(importPath) || new Set();
        dependents.add(filePath);
        this.importGraph.dependents.set(importPath, dependents);
      }
      this.importGraph.dependencies.set(filePath, deps);
    }
  }

  buildSelectorIndex(entries: IFileEntry[]): void {
    for (const entry of entries) {
      if (entry.type === 'source' && entry.selectors) {
        for (const selector of entry.selectors) {
          const files = this.selectorIndex.get(selector.value) || new Set();
          files.add(entry.path);
          this.selectorIndex.set(selector.value, files);
        }
      }
    }
  }

  buildRouteMap(entries: IFileEntry[]): void {
    for (const entry of entries) {
      if (entry.type === 'source' && entry.routesDefined) {
        for (const route of entry.routesDefined) {
          this.routeMap.set(route.path, entry.path);
        }
      }
    }
  }

  buildTextIndex(entries: IFileEntry[]): void {
    for (const entry of entries) {
      if (entry.jsxTextContent) {
        for (const text of entry.jsxTextContent) {
          const normalizedText = text.toLowerCase().trim();
          if (normalizedText.length > 3) { // Filter very short text
            const files = this.textIndex.get(normalizedText) || new Set();
            files.add(entry.path);
            this.textIndex.set(normalizedText, files);
          }
        }
      }
    }
  }

  // ========== Helper Methods ==========

  addOrUpdateFile(entry: IFileEntry): void {
    this.files.set(entry.path, entry);

    // Update import graph
    this.addFileToImportGraph(entry);

    // Update indexes
    if (entry.type === 'source') {
      this.addFileToSelectorIndex(entry);
      this.addFileToRouteMap(entry);
      this.addFileToTextIndex(entry);
    }
  }

  private addFileToImportGraph(entry: IFileEntry): void {
    const filePath = entry.path;
    const deps = this.importGraph.dependencies.get(filePath) || new Set();

    for (const importPath of entry.imports) {
      deps.add(importPath);

      const dependents = this.importGraph.dependents.get(importPath) || new Set();
      dependents.add(filePath);
      this.importGraph.dependents.set(importPath, dependents);
    }

    this.importGraph.dependencies.set(filePath, deps);
  }

  private addFileToSelectorIndex(entry: IFileEntry): void {
    if (!entry.selectors) return;

    for (const selector of entry.selectors) {
      const files = this.selectorIndex.get(selector.value) || new Set();
      files.add(entry.path);
      this.selectorIndex.set(selector.value, files);
    }
  }

  private addFileToRouteMap(entry: IFileEntry): void {
    if (!entry.routesDefined) return;

    for (const route of entry.routesDefined) {
      this.routeMap.set(route.path, entry.path);
    }
  }

  private addFileToTextIndex(entry: IFileEntry): void {
    if (!entry.jsxTextContent) return;

    for (const text of entry.jsxTextContent) {
      const normalizedText = text.toLowerCase().trim();
      if (normalizedText.length > 3) {
        const files = this.textIndex.get(normalizedText) || new Set();
        files.add(entry.path);
        this.textIndex.set(normalizedText, files);
      }
    }
  }

  // ========== Persistence ==========

  serialize(): string {
    const data = {
      files: Array.from(this.files.entries()),
      importGraph: {
        dependencies: Array.from(this.importGraph.dependencies.entries()),
        dependents: Array.from(this.importGraph.dependents.entries())
      },
      selectorIndex: Array.from(this.selectorIndex.entries()),
      routeMap: Array.from(this.routeMap.entries()),
      translationIndex: {
        keyToText: Array.from(this.translationIndex.keyToText.entries()),
        textToKeys: Array.from(this.translationIndex.textToKeys.entries()),
        keyToFiles: Array.from(this.translationIndex.keyToFiles.entries())
      },
      reduxChains: Array.from(this.reduxChains.entries()),
      textIndex: Array.from(this.textIndex.entries())
    };

    return JSON.stringify(data, null, 2);
  }

  deserialize(data: string): void {
    const parsed = JSON.parse(data);

    this.files = new Map(parsed.files);
    this.importGraph.dependencies = new Map(parsed.importGraph.dependencies);
    this.importGraph.dependents = new Map(parsed.importGraph.dependents);
    this.selectorIndex = new Map(parsed.selectorIndex);
    this.routeMap = new Map(parsed.routeMap);
    this.translationIndex = {
      keyToText: new Map(parsed.translationIndex.keyToText),
      textToKeys: new Map(parsed.translationIndex.textToKeys),
      keyToFiles: new Map(parsed.translationIndex.keyToFiles)
    };
    this.reduxChains = new Map(parsed.reduxChains);
    this.textIndex = new Map(parsed.textIndex);
  }
}

// Factory function
export function createRegistry(): IRegistry {
  return new Registry();
}
```

### 2. Create Registry Builder

**File:** `src/core/registry-builder.ts`

```typescript
import { IRegistry, IFileEntry } from './types';
import { createRegistry } from './registry';
import { SourceExtractorAnalyzer } from '../analyzers/source-extractor';
import { CypressExtractorAnalyzer } from '../analyzers/cypress-extractor';

export class RegistryBuilder {
  private registry: IRegistry;

  constructor() {
    this.registry = createRegistry();
  }

  async buildFromDirectories(config: {
    sourceDirs: string[];
    testPatterns: string[];
  }): Promise<IRegistry> {
    const fileEntries: IFileEntry[] = [];

    // Extract source files
    const sourceExtractor = new SourceExtractorAnalyzer();
    for (const dir of config.sourceDirs) {
      const sourceFiles = await this.findSourceFiles(dir);
      for (const filePath of sourceFiles) {
        try {
          const sourceCode = await this.readFile(filePath);
          const result = await sourceExtractor.analyze({ filePath, sourceCode });

          fileEntries.push(this.convertSourceExtractionToFileEntry(result));
        } catch (error) {
          console.warn(`Failed to process source file ${filePath}:`, error);
        }
      }
    }

    // Extract test files
    const cypressExtractor = new CypressExtractorAnalyzer();
    const testFiles = await this.findTestFiles(config.testPatterns);
    for (const filePath of testFiles) {
      try {
        const sourceCode = await this.readFile(filePath);
        const result = await cypressExtractor.analyze({ filePath, sourceCode });

        fileEntries.push(this.convertCypressExtractionToFileEntry(result));
      } catch (error) {
        console.warn(`Failed to process test file ${filePath}:`, error);
      }
    }

    // Build registry from entries
    this.registry.buildFromFileEntries(fileEntries);

    return this.registry;
  }

  private findSourceFiles(dir: string): Promise<string[]> {
    // Implementation depends on your glob library preference
    return Promise.resolve([]);
  }

  private findTestFiles(patterns: string[]): Promise<string[]> {
    // Implementation depends on your glob library preference
    return Promise.resolve([]);
  }

  private async readFile(filePath: string): Promise<string> {
    const fs = await import('fs/promises');
    return fs.readFile(filePath, 'utf-8');
  }

  private convertSourceExtractionToFileEntry(result: any): IFileEntry {
    return {
      name: result.filePath,
      type: 'source',
      path: result.filePath,
      exports: result.exports,
      imports: result.imports,
      classes: result.classes,
      functions: result.functions,
      interfaces: result.interfaces,
      keywords: result.keywords,
      selectors: result.selectors,
      jsxTextContent: result.jsxTextContent,
      translationKeys: result.translationKeys,
      routesDefined: result.routesDefined,
      reduxUsage: result.reduxUsage
    };
  }

  private convertCypressExtractionToFileEntry(result: any): IFileEntry {
    return {
      name: result.filePath,
      type: 'test',
      path: result.filePath,
      exports: [],
      imports: [],
      classes: [],
      functions: [],
      interfaces: [],
      keywords: [],
      cypress: {
        visitedRoutes: result.visitedRoutes,
        selectors: result.selectors,
        containsText: result.containsText,
        interceptedAPIs: result.interceptedAPIs,
        customCommandsUsed: result.customCommandsUsed,
        describeBlocks: result.describeBlocks,
        itBlocks: result.itBlocks
      }
    };
  }
}
```

## Usage Example

```typescript
import { createRegistry } from './core/registry';
import { RegistryBuilder } from './core/registry-builder';

// Quick creation
const registry = createRegistry();

// Build from directories
const builder = new RegistryBuilder();
const builtRegistry = await builder.buildFromDirectories({
  sourceDirs: ['src'],
  testPatterns: ['**/*.cy.ts']
});

// Query registry
const file = builtRegistry.getFile('src/pages/LoginPage.tsx');
const deps = builtRegistry.getDependencies('src/pages/LoginPage.tsx');
const selectorFiles = builtRegistry.getSelectorIndex().get('submit-btn');
```

## Testing Strategy

### Unit Tests

1. **File Entry Management**
   - Test add/update file
   - Test get file
   - Test get files by type

2. **Import Graph**
   - Test dependency tracking
   - Test dependent tracking
   - Test bidirectional mapping

3. **Indexes**
   - Test selector index
   - Test route map
   - Test text index

4. **Persistence**
   - Test serialization
   - Test deserialization
   - Test round-trip

## Dependencies

- Base analyzer system (Task 01)
- Source extractor (Task 02)
- Cypress extractor (Task 03)

## Related Tasks

- Task 02: Source Extractor Analyzer
- Task 03: Cypress Extractor Analyzer
- Task 05: Scoring Engine
- Task 06: Redux Chain Analyzer

## Notes

- Registry is the single source of truth for all metadata
- Import graph enables transitive dependency resolution
- Indexes provide O(1) lookup performance
- Persistence ensures fast subsequent runs