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

> ⚠️ **CRITICAL: Interface/Class Property Alignment**
>
> The `IRegistry` interface declares `files` and `importGraph` as **public properties**. The class
> must expose them the same way. Do NOT make them `private` and expose via getter methods — that
> creates a TypeScript compile error because the class would not satisfy the interface.
>
> **Wrong (will not compile):**
> ```typescript
> class Registry implements IRegistry {
>   private files: Map<string, IFileEntry> = new Map(); // ❌ private, not on interface
>   getFiles(): Map<string, IFileEntry> { ... }         // ❌ not declared on IRegistry
> }
> ```
>
> **Correct:**
> ```typescript
> class Registry implements IRegistry {
>   public files: Map<string, IFileEntry> = new Map();           // ✅ matches interface
>   public importGraph: IImportGraph = { ... };                  // ✅ matches interface
> }
> ```
>
> If you want internal safety (preventing accidental mutation from outside), use `readonly` on the
> interface instead of making them private. The public Maps themselves are still mutable, but the
> property reference cannot be reassigned:
> ```typescript
> export interface IRegistry {
>   readonly files: Map<string, IFileEntry>;
>   readonly importGraph: IImportGraph;
>   // ...
> }
> ```

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
  // ⚠️ These MUST be public to satisfy IRegistry interface.
  // Do NOT change to private. Use readonly on IRegistry if you want to
  // prevent external reassignment.
  public files: Map<string, IFileEntry> = new Map();
  public importGraph: IImportGraph = {
    dependencies: new Map(),
    dependents: new Map()
  };

  // Indexes (these are internal — private is fine here)
  private selectorIndex: Map<string, Set<string>> = new Map();
  private routeMap: Map<string, string> = new Map();
  private translationIndex: ITranslationIndex = {
    keyToText: new Map(),
    textToKeys: new Map(),
    keyToFiles: new Map()
  };
  private reduxChains: Map<string, IReduxChain> = new Map();
  private textIndex: Map<string, Set<string>> = new Map();

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

  // ========== Query Methods ==========

  getFile(path: string): IFileEntry | undefined {
    // ⚠️ Always normalize the path before lookup.
    // See "Path Normalization" section below for normalizePath() implementation.
    return this.files.get(normalizePath(path));
  }

  getFilesByType(type: 'source' | 'test'): IFileEntry[] {
    return Array.from(this.files.values()).filter((f) => f.type === type);
  }

  getDependencies(filePath: string): Set<string> {
    return this.importGraph.dependencies.get(normalizePath(filePath)) || new Set();
  }

  getDependents(filePath: string): Set<string> {
    return this.importGraph.dependents.get(normalizePath(filePath)) || new Set();
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

    // ⚠️ Normalize all entry paths before storing.
    // Without this, the same file may be stored under multiple keys if
    // analyzers return inconsistent path formats (relative vs absolute, etc.)
    // See "Path Normalization" section for normalizePath() implementation.
    for (const entry of entries) {
      const normalizedEntry = {
        ...entry,
        path: normalizePath(entry.path),
        imports: entry.imports.map(normalizePath)
      };
      this.files.set(normalizedEntry.path, normalizedEntry);
    }

    // Build indexes from the normalized entries stored in this.files
    const normalizedEntries = Array.from(this.files.values());
    this.buildImportGraph(normalizedEntries);
    this.buildSelectorIndex(normalizedEntries);
    this.buildRouteMap(normalizedEntries);
    this.buildTextIndex(normalizedEntries);
  }

  buildImportGraph(entries: IFileEntry[]): void {
    for (const entry of entries) {
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
          if (normalizedText.length > 3) {
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
    const normalizedEntry = {
      ...entry,
      path: normalizePath(entry.path),
      imports: entry.imports.map(normalizePath)
    };

    // ⚠️ IMPORTANT: Remove stale import graph edges before re-adding.
    // If this file previously imported FileA and no longer does, the old edge
    // must be removed or it will persist and cause false positive test suggestions.
    // See "Stale Edge Removal" section below for full explanation.
    this.removeFileFromImportGraph(normalizedEntry.path);

    this.files.set(normalizedEntry.path, normalizedEntry);

    this.addFileToImportGraph(normalizedEntry);

    if (normalizedEntry.type === 'source') {
      this.addFileToSelectorIndex(normalizedEntry);
      this.addFileToRouteMap(normalizedEntry);
      this.addFileToTextIndex(normalizedEntry);
    }
  }

  // ⚠️ IMPORTANT: removeFileFromImportGraph must be called BEFORE re-adding a file.
  // See "Stale Edge Removal" section for why this matters.
  private removeFileFromImportGraph(filePath: string): void {
    const oldDeps = this.importGraph.dependencies.get(filePath);
    if (oldDeps) {
      for (const dep of oldDeps) {
        const dependents = this.importGraph.dependents.get(dep);
        if (dependents) {
          dependents.delete(filePath);
          if (dependents.size === 0) {
            this.importGraph.dependents.delete(dep);
          }
        }
      }
    }
    this.importGraph.dependencies.delete(filePath);
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
        // ⚠️ Sets serialize as Arrays in JSON. That is fine here because
        // deserialize() explicitly reconstructs them as Sets. See deserialize() below.
        dependencies: Array.from(this.importGraph.dependencies.entries()).map(
          ([k, v]) => [k, Array.from(v)]
        ),
        dependents: Array.from(this.importGraph.dependents.entries()).map(
          ([k, v]) => [k, Array.from(v)]
        )
      },
      selectorIndex: Array.from(this.selectorIndex.entries()).map(
        ([k, v]) => [k, Array.from(v)]
      ),
      routeMap: Array.from(this.routeMap.entries()),
      translationIndex: {
        keyToText: Array.from(this.translationIndex.keyToText.entries()),
        textToKeys: Array.from(this.translationIndex.textToKeys.entries()),
        keyToFiles: Array.from(this.translationIndex.keyToFiles.entries()).map(
          ([k, v]) => [k, Array.from(v)]
        )
      },
      reduxChains: Array.from(this.reduxChains.entries()),
      textIndex: Array.from(this.textIndex.entries()).map(
        ([k, v]) => [k, Array.from(v)]
      )
    };

    return JSON.stringify(data, null, 2);
  }

  deserialize(data: string): void {
    const parsed = JSON.parse(data);

    this.files = new Map(parsed.files);

    // ⚠️ CRITICAL: After JSON.parse(), everything that was a Set is now a plain Array.
    // You MUST explicitly reconstruct Sets here. If you write:
    //   this.importGraph.dependencies = new Map(parsed.importGraph.dependencies);
    // ...then the values will be Arrays, and any code calling .has() or .add() on
    // them will throw "TypeError: x.has is not a function" at runtime.
    // See "Serialization: Set vs Array" section below for full details.
    this.importGraph.dependencies = new Map(
      parsed.importGraph.dependencies.map(([k, v]: [string, string[]]) => [k, new Set(v)])
    );
    this.importGraph.dependents = new Map(
      parsed.importGraph.dependents.map(([k, v]: [string, string[]]) => [k, new Set(v)])
    );

    this.selectorIndex = new Map(
      parsed.selectorIndex.map(([k, v]: [string, string[]]) => [k, new Set(v)])
    );

    this.routeMap = new Map(parsed.routeMap);

    this.translationIndex = {
      keyToText: new Map(parsed.translationIndex.keyToText),
      textToKeys: new Map(parsed.translationIndex.textToKeys),
      keyToFiles: new Map(
        parsed.translationIndex.keyToFiles.map(([k, v]: [string, string[]]) => [k, new Set(v)])
      )
    };

    this.reduxChains = new Map(parsed.reduxChains);

    this.textIndex = new Map(
      parsed.textIndex.map(([k, v]: [string, string[]]) => [k, new Set(v)])
    );
  }
}

// Factory function
export function createRegistry(): IRegistry {
  return new Registry();
}
```

---

## Critical Fix 1: Serialization — Set vs Array Data Corruption

### What the bug is

JavaScript's `JSON.stringify()` does **not** know how to serialize a `Set`. When you call
`JSON.stringify(mySet)`, it silently produces `{}` (an empty object). When you first convert to an
Array via `Array.from(set)` and then stringify, you get a JSON array — which is correct for storage.
But when you call `JSON.parse()` on that data, you get a plain JavaScript `Array` back, **not** a
`Set`.

If your deserialization code does not explicitly reconstruct the Sets, every value in your
`selectorIndex`, `textIndex`, and import graph will silently be an `Array` disguised as a `Set`.
The code will appear to work until the first call to `.has()` or `.add()`, at which point you get a
runtime crash.

### Why it matters for this project

The scoring engine calls `.has()` on `selectorIndex` values to check whether a specific file uses a
selector. If the values are Arrays (not Sets), every single lookup crashes. The suggester breaks
completely for any run that loads a cached/serialized registry.

### Concrete example of the failure

```typescript
// Step 1: Build registry normally (works fine)
registry.buildFromFileEntries([
  {
    path: 'src/components/LoginForm.tsx',
    type: 'source',
    selectors: [{ value: 'submit-btn' }],
    imports: [],
    // ...
  }
]);

// Step 2: Serialize to disk
const json = registry.serialize();
// json contains: { "selectorIndex": [["submit-btn", ["src/components/LoginForm.tsx"]]] }
// Notice the value is a JSON array, not a Set. That is correct for JSON.

// Step 3: Create a new registry and deserialize (THIS IS WHERE THE BUG LIVES)
const freshRegistry = createRegistry();

// ❌ BUGGY deserialize — does NOT reconstruct Sets:
freshRegistry['selectorIndex'] = new Map(parsed.selectorIndex);
// The value for "submit-btn" is now the plain Array ["src/components/LoginForm.tsx"]
// not a Set.

// Step 4: Scoring engine queries it — CRASHES HERE
const files = freshRegistry.getSelectorIndex().get('submit-btn');
files.has('src/components/LoginForm.tsx'); // 💥 TypeError: files.has is not a function
files.add('src/pages/LoginPage.tsx');      // 💥 TypeError: files.add is not a function
```

### The fix

**In `serialize()`:** Explicitly convert each Set to an Array before stringifying.

```typescript
// In serialize():
selectorIndex: Array.from(this.selectorIndex.entries()).map(
  ([k, v]) => [k, Array.from(v)]  // ← convert Set → Array explicitly
),
```

**In `deserialize()`:** Explicitly reconstruct each Set from the parsed Array.

```typescript
// In deserialize():
this.selectorIndex = new Map(
  parsed.selectorIndex.map(([k, v]: [string, string[]]) => [k, new Set(v)])
  //                                                              ^^^^^^^^
  //                                                   Array → Set reconstruction
);
```

Apply this pattern to every field that holds a `Set` value:
- `importGraph.dependencies`
- `importGraph.dependents`
- `selectorIndex`
- `translationIndex.keyToFiles`
- `textIndex`

### Complete before/after comparison

```typescript
// ❌ BEFORE (buggy): deserialize assumes Map values are already Sets
deserialize(data: string): void {
  const parsed = JSON.parse(data);
  this.selectorIndex = new Map(parsed.selectorIndex); // values are Arrays!
  this.importGraph.dependencies = new Map(parsed.importGraph.dependencies); // values are Arrays!
  // ...
}

// ✅ AFTER (correct): reconstruct Sets explicitly
deserialize(data: string): void {
  const parsed = JSON.parse(data);

  this.selectorIndex = new Map(
    parsed.selectorIndex.map(([k, v]: [string, string[]]) => [k, new Set(v)])
  );
  this.importGraph.dependencies = new Map(
    parsed.importGraph.dependencies.map(([k, v]: [string, string[]]) => [k, new Set(v)])
  );
  this.importGraph.dependents = new Map(
    parsed.importGraph.dependents.map(([k, v]: [string, string[]]) => [k, new Set(v)])
  );
  this.textIndex = new Map(
    parsed.textIndex.map(([k, v]: [string, string[]]) => [k, new Set(v)])
  );
  this.translationIndex = {
    keyToText: new Map(parsed.translationIndex.keyToText),
    textToKeys: new Map(parsed.translationIndex.textToKeys),
    keyToFiles: new Map(
      parsed.translationIndex.keyToFiles.map(([k, v]: [string, string[]]) => [k, new Set(v)])
    )
  };
  // routeMap and reduxChains values are NOT Sets, so plain new Map() is fine for those
  this.routeMap = new Map(parsed.routeMap);
  this.reduxChains = new Map(parsed.reduxChains);
}
```

---

## Critical Fix 2: Path Normalization

### What the bug is

File paths are used as Map keys everywhere in the registry. If two different strings refer to the
same file on disk (e.g., `src/pages/Login.tsx` vs `./src/pages/Login.tsx` vs
`/project/src/pages/Login.tsx`), the registry stores them as **three separate entries**. The import
graph edges built from one representation never connect to file entries stored under another
representation. Lookups return `undefined`. The graph is broken.

### Why it matters for this project

Different analyzers, bundlers, and TypeScript `paths` aliases can all produce different path strings
for the same file. Without normalization, the import graph will have dangling edges that never
resolve, the scoring engine will fail to find file entries, and test suggestions will be silently
wrong or missing.

### Concrete example of the failure

```
Project root: /project

Analyzer A (SourceExtractor) processes LoginPage.tsx and returns:
  filePath: "src/pages/LoginPage.tsx"       ← relative, no leading ./

Analyzer B (CypressExtractor) finds LoginPage imported in a test and returns:
  imports: ["./src/pages/LoginPage.tsx"]    ← relative, WITH leading ./

TypeScript compiler resolves it to:
  "/project/src/pages/LoginPage.tsx"        ← absolute path
```

```typescript
// After buildFromFileEntries:
registry.files.has("src/pages/LoginPage.tsx")    // ✅ true — this is how it was stored
registry.files.has("./src/pages/LoginPage.tsx")  // ❌ false — different key!
registry.files.has("/project/src/pages/LoginPage.tsx") // ❌ false — different key!

// Import graph edge from test file points to "./src/pages/LoginPage.tsx"
// but the file entry is stored under "src/pages/LoginPage.tsx"
// → getDependents("src/pages/LoginPage.tsx") returns empty Set
// → Scoring engine thinks no tests cover LoginPage → WRONG RESULT
```

### The fix: normalizePath() utility

Create a `normalizePath()` function and apply it **every time** a path is stored or looked up in
the registry.

```typescript
// src/core/path-utils.ts

import * as path from 'path';

/**
 * Normalize a file path to a consistent relative form from the project root.
 *
 * Rules:
 * 1. If the path is absolute, make it relative to the project root.
 * 2. Remove any leading "./"
 * 3. Normalize path separators to forward slashes (Windows safety).
 * 4. Resolve any ".." segments.
 *
 * All paths stored in the registry go through this function.
 * All lookups into the registry go through this function.
 *
 * @param filePath - The raw path from an analyzer or file system call.
 * @param projectRoot - The absolute path to the project root. Defaults to process.cwd().
 */
export function normalizePath(filePath: string, projectRoot: string = process.cwd()): string {
  let normalized: string;

  if (path.isAbsolute(filePath)) {
    // Convert absolute path to relative from project root
    normalized = path.relative(projectRoot, filePath);
  } else {
    // Resolve ".." etc. relative to project root, then make relative again
    normalized = path.relative(projectRoot, path.resolve(projectRoot, filePath));
  }

  // Normalize separators to forward slashes (handles Windows paths)
  return normalized.split(path.sep).join('/');
}
```

### Where to apply normalizePath()

Apply it in **every** place a path enters or is looked up in the registry:

| Location | What to normalize |
|---|---|
| `buildFromFileEntries()` | `entry.path` and every path in `entry.imports` |
| `addOrUpdateFile()` | `entry.path` and every path in `entry.imports` |
| `getFile(path)` | the `path` argument before `.get()` |
| `getDependencies(filePath)` | the `filePath` argument before `.get()` |
| `getDependents(filePath)` | the `filePath` argument before `.get()` |
| `RegistryBuilder.convertSourceExtractionToFileEntry()` | `result.filePath` and `result.imports` |
| `RegistryBuilder.convertCypressExtractionToFileEntry()` | `result.filePath` and `result.imports` |

### Example: what the registry looks like after normalization

```typescript
// All three of these arrive from different analyzers, referring to the same file:
const paths = [
  "src/pages/LoginPage.tsx",
  "./src/pages/LoginPage.tsx",
  "/project/src/pages/LoginPage.tsx"
];

paths.map(normalizePath);
// → ["src/pages/LoginPage.tsx", "src/pages/LoginPage.tsx", "src/pages/LoginPage.tsx"]
// All three resolve to the same key. One entry, one node in the import graph. ✅
```

---

## Critical Fix 3: RegistryBuilder — Implementing findSourceFiles and findTestFiles

### What the bug is

The `RegistryBuilder` class contains two stub methods that always return empty arrays:

```typescript
private findSourceFiles(dir: string): Promise<string[]> {
  return Promise.resolve([]); // ← always empty, builder always produces nothing
}
private findTestFiles(patterns: string[]): Promise<string[]> {
  return Promise.resolve([]); // ← always empty
}
```

`buildFromDirectories()` calls these methods, receives empty arrays, processes zero files, and
returns an empty registry. The entire build system is a no-op.

### The fix

Install `fast-glob` (or `glob` v9+) and implement both methods.

```bash
npm install fast-glob
npm install --save-dev @types/node
```

**File:** `src/core/registry-builder.ts`

```typescript
import * as fg from 'fast-glob';
import * as path from 'path';
import * as fs from 'fs/promises';
import { IRegistry, IFileEntry } from './types';
import { createRegistry } from './registry';
import { normalizePath } from './path-utils';
import { SourceExtractorAnalyzer } from '../analyzers/source-extractor';
import { CypressExtractorAnalyzer } from '../analyzers/cypress-extractor';

export interface RegistryBuilderConfig {
  /**
   * Directories to scan for source files (React/TS components, pages, hooks, etc.)
   * Example: ['src', 'lib']
   */
  sourceDirs: string[];

  /**
   * Glob patterns to find Cypress spec files.
   * Example: ['**\/*.cy.ts', '**\/*.cy.tsx', 'cypress/e2e/**\/*.spec.ts']
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
        const result = await sourceExtractor.analyze({ filePath, sourceCode });
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
        const result = await cypressExtractor.analyze({ filePath, sourceCode });
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
    ignoreDirs: string[]
  ): Promise<string[]> {
    const extPattern = extensions.length === 1
      ? extensions[0]
      : `{${extensions.join(',')}}`;

    const patterns = sourceDirs.map((dir) => `${dir}/**/*${extPattern}`);
    const ignorePatterns = ignoreDirs.map((d) => `**/${d}/**`);

    const files = await fg(patterns, {
      cwd: this.projectRoot,
      ignore: ignorePatterns,
      absolute: false,  // return relative paths (we normalize them ourselves)
      onlyFiles: true
    });

    return files.map((f) => normalizePath(f, this.projectRoot));
  }

  /**
   * Finds all test files matching the given glob patterns.
   *
   * Example:
   *   testPatterns = ['**\/*.cy.ts', 'cypress/e2e/**\/*.spec.ts']
   *   ignoreDirs   = ['node_modules']
   *
   *   Returns: ['cypress/e2e/login.cy.ts', 'cypress/e2e/checkout.cy.ts', ...]
   */
  private async findTestFiles(
    testPatterns: string[],
    ignoreDirs: string[]
  ): Promise<string[]> {
    const ignorePatterns = ignoreDirs.map((d) => `**/${d}/**`);

    const files = await fg(testPatterns, {
      cwd: this.projectRoot,
      ignore: ignorePatterns,
      absolute: false,
      onlyFiles: true
    });

    return files.map((f) => normalizePath(f, this.projectRoot));
  }

  private convertSourceExtractionToFileEntry(result: any, filePath: string): IFileEntry {
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
      reduxUsage: result.reduxUsage
    };
  }

  private convertCypressExtractionToFileEntry(result: any, filePath: string): IFileEntry {
    return {
      name: path.basename(filePath),
      type: 'test',
      path: normalizePath(filePath, this.projectRoot),
      exports: [],
      // ⚠️ Do NOT hardcode imports as []. Cypress spec files import page objects,
      // helpers, fixtures, and custom command modules. These imports are needed so
      // the import graph knows what shared helpers a test depends on. If a shared
      // helper changes, the graph must be able to find all tests that import it.
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
        customCommandsUsed: result.customCommandsUsed,
        describeBlocks: result.describeBlocks,
        itBlocks: result.itBlocks
      }
    };
  }
}
```

---

## Important Fix 4: Stale Edge Removal in addOrUpdateFile()

### What the bug is

When `addOrUpdateFile()` is called for a file that is already in the registry (e.g., because the
file was edited and the watcher triggered a re-analysis), the old import graph edges are **never
removed**. New edges are added on top of the old ones.

This means if a file previously imported `ComponentA` and the developer removes that import, the
registry still thinks the dependency exists. The scoring engine finds the stale edge and suggests
tests for `ComponentA` even though the source file no longer uses it. These are false positive
suggestions — the exact problem this tool is supposed to solve.

### Concrete example of the failure

```
Initial state: LoginPage.tsx imports [AuthService.ts, LoginForm.tsx]

Developer refactors: removes LoginForm.tsx import.
File watcher detects change → calls addOrUpdateFile(LoginPage.tsx)

New imports: [AuthService.ts]  ← LoginForm is gone

❌ Without stale edge removal:
  importGraph.dependencies["src/pages/LoginPage.tsx"]
    = Set { "src/services/AuthService.ts", "src/components/LoginForm.tsx" }
    //                                      ↑ STALE — should have been removed

  importGraph.dependents["src/components/LoginForm.tsx"]
    = Set { "src/pages/LoginPage.tsx" }
    //       ↑ STALE — LoginPage no longer imports LoginForm

Result: Scoring engine sees LoginPage → LoginForm dependency.
LoginForm changes → engine suggests login.cy.ts ← FALSE POSITIVE
```

### The fix

Before adding the new edges for an updated file, remove all existing edges for that file from the
import graph. The helper `removeFileFromImportGraph()` handles this.

```typescript
private removeFileFromImportGraph(filePath: string): void {
  // Get the current outbound edges (what this file imports)
  const oldDeps = this.importGraph.dependencies.get(filePath);

  if (oldDeps) {
    // For each old dependency, remove this file from that dependency's dependents list
    for (const dep of oldDeps) {
      const dependents = this.importGraph.dependents.get(dep);
      if (dependents) {
        dependents.delete(filePath);
        // Clean up empty Sets so the graph doesn't fill with empty entries
        if (dependents.size === 0) {
          this.importGraph.dependents.delete(dep);
        }
      }
    }
  }

  // Remove the file's own outbound edge entry entirely
  this.importGraph.dependencies.delete(filePath);
}
```

### Step-by-step: how addOrUpdateFile() must work

```typescript
addOrUpdateFile(entry: IFileEntry): void {
  const normalizedEntry = {
    ...entry,
    path: normalizePath(entry.path),
    imports: entry.imports.map(normalizePath)
  };

  // Step 1: Remove ALL existing import graph edges for this file.
  //         Must happen BEFORE re-adding so stale edges don't survive.
  this.removeFileFromImportGraph(normalizedEntry.path);

  // Step 2: Update the file entry in the files map.
  this.files.set(normalizedEntry.path, normalizedEntry);

  // Step 3: Add fresh import graph edges based on the new imports list.
  this.addFileToImportGraph(normalizedEntry);

  // Step 4: Update other indexes.
  if (normalizedEntry.type === 'source') {
    this.addFileToSelectorIndex(normalizedEntry);
    this.addFileToRouteMap(normalizedEntry);
    this.addFileToTextIndex(normalizedEntry);
  }
}
```

### Full trace: correct behavior after the fix

```
Initial state: LoginPage.tsx imports [AuthService.ts, LoginForm.tsx]
  dependencies["src/pages/LoginPage.tsx"] = Set { "src/services/AuthService.ts",
                                                  "src/components/LoginForm.tsx" }
  dependents["src/services/AuthService.ts"]  = Set { "src/pages/LoginPage.tsx" }
  dependents["src/components/LoginForm.tsx"] = Set { "src/pages/LoginPage.tsx" }

Developer removes LoginForm import. addOrUpdateFile(LoginPage.tsx) is called.
New imports: [AuthService.ts]

→ removeFileFromImportGraph("src/pages/LoginPage.tsx")
    For dep "src/services/AuthService.ts":
      dependents["src/services/AuthService.ts"].delete("src/pages/LoginPage.tsx")
      → Set is now empty → delete dependents["src/services/AuthService.ts"] entirely
    For dep "src/components/LoginForm.tsx":
      dependents["src/components/LoginForm.tsx"].delete("src/pages/LoginPage.tsx")
      → Set is now empty → delete dependents["src/components/LoginForm.tsx"] entirely
    delete dependencies["src/pages/LoginPage.tsx"]

→ addFileToImportGraph(LoginPage.tsx with imports=[AuthService.ts])
    dependencies["src/pages/LoginPage.tsx"] = Set { "src/services/AuthService.ts" }
    dependents["src/services/AuthService.ts"] = Set { "src/pages/LoginPage.tsx" }

✅ Final state:
  LoginForm is no longer in the graph at all.
  Scoring engine will NOT suggest login.cy.ts when LoginForm.tsx changes. Correct!
```

---

## Testing Strategy

### Unit Tests

#### 1. Interface/Class Alignment

```typescript
// src/core/__tests__/registry.interface.test.ts
import { createRegistry } from '../registry';
import { IRegistry } from '../types';

describe('Registry — interface compliance', () => {
  it('should satisfy IRegistry interface (files is a public Map)', () => {
    const registry = createRegistry();
    // If `files` were private, accessing it here would be a TypeScript error
    // and registry would not be assignable to IRegistry.
    const typed: IRegistry = registry;
    expect(typed.files).toBeInstanceOf(Map);
  });

  it('should satisfy IRegistry interface (importGraph is a public object)', () => {
    const registry: IRegistry = createRegistry();
    expect(registry.importGraph).toBeDefined();
    expect(registry.importGraph.dependencies).toBeInstanceOf(Map);
    expect(registry.importGraph.dependents).toBeInstanceOf(Map);
  });
});
```

#### 2. Path Normalization

```typescript
// src/core/__tests__/path-utils.test.ts
import { normalizePath } from '../path-utils';
import * as path from 'path';

const PROJECT_ROOT = '/project';

describe('normalizePath', () => {
  it('strips leading ./ from relative paths', () => {
    expect(normalizePath('./src/pages/Login.tsx', PROJECT_ROOT))
      .toBe('src/pages/Login.tsx');
  });

  it('converts absolute paths to relative from project root', () => {
    expect(normalizePath('/project/src/pages/Login.tsx', PROJECT_ROOT))
      .toBe('src/pages/Login.tsx');
  });

  it('leaves already-clean relative paths unchanged', () => {
    expect(normalizePath('src/pages/Login.tsx', PROJECT_ROOT))
      .toBe('src/pages/Login.tsx');
  });

  it('resolves .. segments', () => {
    expect(normalizePath('src/pages/../components/Button.tsx', PROJECT_ROOT))
      .toBe('src/components/Button.tsx');
  });

  it('normalizes all three representations of the same file to the same string', () => {
    const representations = [
      'src/pages/Login.tsx',
      './src/pages/Login.tsx',
      '/project/src/pages/Login.tsx'
    ];
    const normalized = representations.map((p) => normalizePath(p, PROJECT_ROOT));
    expect(new Set(normalized).size).toBe(1); // all the same
    expect(normalized[0]).toBe('src/pages/Login.tsx');
  });

  it('handles Windows-style backslash separators', () => {
    // Simulate a path that came through on Windows
    const windowsPath = 'src\\pages\\Login.tsx';
    expect(normalizePath(windowsPath, PROJECT_ROOT)).toBe('src/pages/Login.tsx');
  });
});

describe('Registry — path normalization on file storage and lookup', () => {
  it('stores files under normalized paths and retrieves them regardless of input format', () => {
    const registry = createRegistry();
    registry.buildFromFileEntries([
      {
        path: 'src/pages/LoginPage.tsx',
        type: 'source',
        name: 'LoginPage.tsx',
        imports: [],
        exports: [], classes: [], functions: [], interfaces: [], keywords: []
      }
    ]);

    // All three representations should find the same entry
    expect(registry.getFile('src/pages/LoginPage.tsx')).toBeDefined();
    expect(registry.getFile('./src/pages/LoginPage.tsx')).toBeDefined();
    expect(registry.getFile('/project/src/pages/LoginPage.tsx')).toBeDefined();
  });
});
```

#### 3. Import Graph — Dependency and Dependent Tracking

```typescript
// src/core/__tests__/registry.import-graph.test.ts
import { createRegistry } from '../registry';

describe('Registry — import graph', () => {
  const entries = [
    {
      path: 'src/pages/LoginPage.tsx',
      type: 'source' as const,
      name: 'LoginPage.tsx',
      imports: ['src/components/LoginForm.tsx', 'src/services/AuthService.ts'],
      exports: [], classes: [], functions: [], interfaces: [], keywords: []
    },
    {
      path: 'src/components/LoginForm.tsx',
      type: 'source' as const,
      name: 'LoginForm.tsx',
      imports: ['src/services/AuthService.ts'],
      exports: [], classes: [], functions: [], interfaces: [], keywords: []
    },
    {
      path: 'src/services/AuthService.ts',
      type: 'source' as const,
      name: 'AuthService.ts',
      imports: [],
      exports: [], classes: [], functions: [], interfaces: [], keywords: []
    }
  ];

  it('builds forward dependency edges', () => {
    const registry = createRegistry();
    registry.buildFromFileEntries(entries);

    const deps = registry.getDependencies('src/pages/LoginPage.tsx');
    expect(deps.has('src/components/LoginForm.tsx')).toBe(true);
    expect(deps.has('src/services/AuthService.ts')).toBe(true);
  });

  it('builds reverse dependent edges', () => {
    const registry = createRegistry();
    registry.buildFromFileEntries(entries);

    const dependents = registry.getDependents('src/services/AuthService.ts');
    expect(dependents.has('src/pages/LoginPage.tsx')).toBe(true);
    expect(dependents.has('src/components/LoginForm.tsx')).toBe(true);
  });

  it('returns empty Set for a file with no dependents', () => {
    const registry = createRegistry();
    registry.buildFromFileEntries(entries);

    const dependents = registry.getDependents('src/pages/LoginPage.tsx');
    expect(dependents.size).toBe(0);
  });
});
```

#### 4. Stale Edge Removal

```typescript
// src/core/__tests__/registry.stale-edges.test.ts
import { createRegistry } from '../registry';

describe('Registry — stale edge removal on addOrUpdateFile()', () => {
  it('removes old dependency edges when imports change', () => {
    const registry = createRegistry();

    // Initial state: LoginPage imports both AuthService and LoginForm
    registry.buildFromFileEntries([
      {
        path: 'src/pages/LoginPage.tsx',
        type: 'source',
        name: 'LoginPage.tsx',
        imports: ['src/services/AuthService.ts', 'src/components/LoginForm.tsx'],
        exports: [], classes: [], functions: [], interfaces: [], keywords: []
      }
    ]);

    expect(registry.getDependencies('src/pages/LoginPage.tsx')
      .has('src/components/LoginForm.tsx')).toBe(true);
    expect(registry.getDependents('src/components/LoginForm.tsx')
      .has('src/pages/LoginPage.tsx')).toBe(true);

    // Developer removes LoginForm import
    registry.addOrUpdateFile({
      path: 'src/pages/LoginPage.tsx',
      type: 'source',
      name: 'LoginPage.tsx',
      imports: ['src/services/AuthService.ts'], // LoginForm is gone
      exports: [], classes: [], functions: [], interfaces: [], keywords: []
    });

    // LoginForm dependency must be gone
    expect(registry.getDependencies('src/pages/LoginPage.tsx')
      .has('src/components/LoginForm.tsx')).toBe(false);

    // LoginPage must no longer appear in LoginForm's dependents
    expect(registry.getDependents('src/components/LoginForm.tsx')
      .has('src/pages/LoginPage.tsx')).toBe(false);

    // AuthService edge must still be intact
    expect(registry.getDependencies('src/pages/LoginPage.tsx')
      .has('src/services/AuthService.ts')).toBe(true);
    expect(registry.getDependents('src/services/AuthService.ts')
      .has('src/pages/LoginPage.tsx')).toBe(true);
  });

  it('cleans up empty dependents Sets to prevent graph pollution', () => {
    const registry = createRegistry();

    registry.buildFromFileEntries([
      {
        path: 'src/pages/LoginPage.tsx',
        type: 'source',
        name: 'LoginPage.tsx',
        imports: ['src/components/LoginForm.tsx'],
        exports: [], classes: [], functions: [], interfaces: [], keywords: []
      }
    ]);

    // Remove the import
    registry.addOrUpdateFile({
      path: 'src/pages/LoginPage.tsx',
      type: 'source',
      name: 'LoginPage.tsx',
      imports: [],
      exports: [], classes: [], functions: [], interfaces: [], keywords: []
    });

    // The dependents entry for LoginForm should be deleted (not left as an empty Set)
    expect(registry.importGraph.dependents.has('src/components/LoginForm.tsx')).toBe(false);
  });

  it('handles the case where the file was not previously in the registry', () => {
    const registry = createRegistry();

    // addOrUpdateFile on a brand-new file should not throw
    expect(() => {
      registry.addOrUpdateFile({
        path: 'src/pages/NewPage.tsx',
        type: 'source',
        name: 'NewPage.tsx',
        imports: ['src/components/Button.tsx'],
        exports: [], classes: [], functions: [], interfaces: [], keywords: []
      });
    }).not.toThrow();

    expect(registry.getDependencies('src/pages/NewPage.tsx')
      .has('src/components/Button.tsx')).toBe(true);
  });
});
```

#### 5. Serialization Round-Trip (Set Preservation)

```typescript
// src/core/__tests__/registry.serialization.test.ts
import { createRegistry } from '../registry';

describe('Registry — serialization round-trip', () => {
  const buildPopulatedRegistry = () => {
    const registry = createRegistry();
    registry.buildFromFileEntries([
      {
        path: 'src/pages/LoginPage.tsx',
        type: 'source',
        name: 'LoginPage.tsx',
        imports: ['src/components/LoginForm.tsx'],
        selectors: [{ value: 'submit-btn' }, { value: 'email-input' }],
        jsxTextContent: ['Sign In', 'Forgot password?'],
        exports: [], classes: [], functions: [], interfaces: [], keywords: []
      },
      {
        path: 'src/components/LoginForm.tsx',
        type: 'source',
        name: 'LoginForm.tsx',
        imports: [],
        exports: [], classes: [], functions: [], interfaces: [], keywords: []
      }
    ]);
    return registry;
  };

  it('preserves selectorIndex values as Sets after round-trip', () => {
    const original = buildPopulatedRegistry();
    const json = original.serialize();

    const restored = createRegistry();
    restored.deserialize(json);

    const files = restored.getSelectorIndex().get('submit-btn');
    expect(files).toBeInstanceOf(Set); // ← This fails without the fix
    expect(files!.has('src/pages/LoginPage.tsx')).toBe(true);
  });

  it('preserves importGraph.dependencies as Sets after round-trip', () => {
    const original = buildPopulatedRegistry();
    const json = original.serialize();

    const restored = createRegistry();
    restored.deserialize(json);

    const deps = restored.getDependencies('src/pages/LoginPage.tsx');
    expect(deps).toBeInstanceOf(Set); // ← This fails without the fix
    expect(deps.has('src/components/LoginForm.tsx')).toBe(true);
  });

  it('preserves importGraph.dependents as Sets after round-trip', () => {
    const original = buildPopulatedRegistry();
    const json = original.serialize();

    const restored = createRegistry();
    restored.deserialize(json);

    const dependents = restored.getDependents('src/components/LoginForm.tsx');
    expect(dependents).toBeInstanceOf(Set); // ← This fails without the fix
    expect(dependents.has('src/pages/LoginPage.tsx')).toBe(true);
  });

  it('preserves textIndex values as Sets after round-trip', () => {
    const original = buildPopulatedRegistry();
    const json = original.serialize();

    const restored = createRegistry();
    restored.deserialize(json);

    const files = restored.getTextIndex().get('sign in');
    expect(files).toBeInstanceOf(Set); // ← This fails without the fix
    expect(files!.has('src/pages/LoginPage.tsx')).toBe(true);
  });

  it('allows .has() and .add() on deserialized Set values without throwing', () => {
    const original = buildPopulatedRegistry();
    const restored = createRegistry();
    restored.deserialize(original.serialize());

    const files = restored.getSelectorIndex().get('submit-btn')!;

    // These throw "TypeError: files.has is not a function" if values are Arrays
    expect(() => files.has('src/pages/LoginPage.tsx')).not.toThrow();
    expect(() => files.add('src/pages/SomeOtherPage.tsx')).not.toThrow();
  });

  it('produces identical file entries before and after round-trip', () => {
    const original = buildPopulatedRegistry();
    const json = original.serialize();

    const restored = createRegistry();
    restored.deserialize(json);

    const originalFile = original.getFile('src/pages/LoginPage.tsx');
    const restoredFile = restored.getFile('src/pages/LoginPage.tsx');
    expect(restoredFile).toEqual(originalFile);
  });
});
```

#### 6. File Entry Management

```typescript
// src/core/__tests__/registry.file-entries.test.ts
import { createRegistry } from '../registry';

describe('Registry — file entry management', () => {
  it('returns undefined for a file not in the registry', () => {
    const registry = createRegistry();
    expect(registry.getFile('src/pages/DoesNotExist.tsx')).toBeUndefined();
  });

  it('getFilesByType returns only source files when type is "source"', () => {
    const registry = createRegistry();
    registry.buildFromFileEntries([
      { path: 'src/pages/Login.tsx', type: 'source', name: 'Login.tsx',
        imports: [], exports: [], classes: [], functions: [], interfaces: [], keywords: [] },
      { path: 'cypress/e2e/login.cy.ts', type: 'test', name: 'login.cy.ts',
        imports: [], exports: [], classes: [], functions: [], interfaces: [], keywords: [] }
    ]);
    const sources = registry.getFilesByType('source');
    expect(sources).toHaveLength(1);
    expect(sources[0].path).toBe('src/pages/Login.tsx');
  });

  it('getFilesByType returns only test files when type is "test"', () => {
    const registry = createRegistry();
    registry.buildFromFileEntries([
      { path: 'src/pages/Login.tsx', type: 'source', name: 'Login.tsx',
        imports: [], exports: [], classes: [], functions: [], interfaces: [], keywords: [] },
      { path: 'cypress/e2e/login.cy.ts', type: 'test', name: 'login.cy.ts',
        imports: [], exports: [], classes: [], functions: [], interfaces: [], keywords: [] }
    ]);
    const tests = registry.getFilesByType('test');
    expect(tests).toHaveLength(1);
    expect(tests[0].path).toBe('cypress/e2e/login.cy.ts');
  });
});
```

---

### 2. Create Registry Builder

**File:** `src/core/registry-builder.ts`

See implementation in **Critical Fix 3** above. The full `RegistryBuilder` class is defined there.

---

## Usage Example

```typescript
import { createRegistry } from './core/registry';
import { RegistryBuilder } from './core/registry-builder';

// Quick creation (empty registry, populate manually)
const registry = createRegistry();

// Build from directories (real file discovery)
const builder = new RegistryBuilder();
const builtRegistry = await builder.buildFromDirectories({
  sourceDirs: ['src'],
  testPatterns: ['**/*.cy.ts', '**/*.cy.tsx'],
  sourceExtensions: ['.ts', '.tsx'],
  ignoreDirs: ['node_modules', 'dist', 'coverage']
});

// Query registry — all lookups normalize paths automatically
const file = builtRegistry.getFile('src/pages/LoginPage.tsx');
const deps = builtRegistry.getDependencies('src/pages/LoginPage.tsx');
const selectorFiles = builtRegistry.getSelectorIndex().get('submit-btn');

// Incremental update when a file changes (e.g., via file watcher)
// Old import edges are automatically removed before new ones are added.
registry.addOrUpdateFile(updatedFileEntry);

// Serialize to disk (cache for next run)
const json = builtRegistry.serialize();
await fs.writeFile('.registry-cache.json', json, 'utf-8');

// Restore from disk — all Sets are correctly reconstructed
const freshRegistry = createRegistry();
freshRegistry.deserialize(await fs.readFile('.registry-cache.json', 'utf-8'));
const restoredSelector = freshRegistry.getSelectorIndex().get('submit-btn');
restoredSelector.has('src/pages/LoginPage.tsx'); // ✅ works, it's a Set
```

---

## Dependencies

- Base analyzer system (Task 01)
- Source extractor (Task 02)
- Cypress extractor (Task 03)
- `fast-glob` npm package (for `RegistryBuilder.findSourceFiles` and `findTestFiles`)

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
- All paths in the registry are normalized to relative forward-slash form from project root
- Redux chains (`getReduxChains`) will remain empty until Task 06 is integrated; consumers should handle an empty Map gracefully
