# Task 09: Import Graph Analyzer

## Overview

Create an analyzer that builds a bidirectional import graph tracing dependencies between files. This graph enables transitive impact analysis (e.g., "File A imports File B, File B imports File C → changing C impacts A").

## Objectives

1. Analyze imports from source and test files
2. Build bidirectional dependency graph
3. Support import alias resolution (tsconfig paths)
4. Enable transitive dependency resolution
5. Track dependency depth

## Core Types

```typescript
export interface IImportGraph {
  dependencies: Map<string, Set<string>>;    // file → files it imports
  dependents: Map<string, Set<string>>;      // file → files that import it
}

export interface IImportGraphExtractionResult {
  filePath: string;
  imports: IImportMetadata[];
  exports: IExportMetadata[];
}

export interface IImportMetadata {
  source: string;
  resolvedPath: string;
  type: 'default' | 'named' | 'namespace' | 'type';
  specifier?: string;
}

export interface IExportMetadata {
  name: string;
  source?: string;
  type: 'named' | 'default' | 'namespace' | 'type';
}
```

## Implementation

### 1. Create Import Graph Analyzer

**File:** `src/analyzers/import-graph-analyzer.ts`

```typescript
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { BaseAnalyzer } from './base';
import {
  IImportGraph,
  IImportGraphExtractionResult,
  IImportMetadata,
  IExportMetadata
} from '../core/types';

export class ImportGraphAnalyzer extends BaseAnalyzer {
  private tsConfigPaths: Record<string, string[]> = {};

  constructor() {
    super({
      name: 'import-graph',
      version: '1.0.0',
      description: 'Builds bidirectional import graph for transitive analysis',
      dependencies: []
    });
  }

  async analyze(input: {
    filePath: string;
    sourceCode: string;
    tsConfig?: string;
  }): Promise<IImportGraphExtractionResult> {
    const { filePath, sourceCode, tsConfig } = input;

    // Load tsconfig if provided
    if (tsConfig) {
      this.loadTsConfigPaths(tsConfig);
    }

    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    const result: IImportGraphExtractionResult = {
      filePath,
      imports: [],
      exports: []
    };

    this.visitNode(sourceFile, result, path.dirname(filePath));

    return result;
  }

  buildImportGraph(extractions: IImportGraphExtractionResult[]): IImportGraph {
    const importGraph: IImportGraph = {
      dependencies: new Map(),
      dependents: new Map()
    };

    for (const extraction of extractions) {
      const filePath = extraction.filePath;

      // Add imports to dependencies
      const deps = importGraph.dependencies.get(filePath) || new Set();
      for (const imp of extraction.imports) {
        deps.add(imp.resolvedPath);

        // Add reverse mapping to dependents
        const dependents = importGraph.dependents.get(imp.resolvedPath) || new Set();
        dependents.add(filePath);
        importGraph.dependents.set(imp.resolvedPath, dependents);
      }
      importGraph.dependencies.set(filePath, deps);

      // Track exports for re-export resolution
      this.addExports(filePath, extraction.exports);
    }

    return importGraph;
  }

  private visitNode(
    node: ts.Node,
    result: IImportGraphExtractionResult,
    baseDir: string
  ): void {
    // Extract imports
    if (ts.isImportDeclaration(node)) {
      this.extractImport(node, result, baseDir);
    }

    // Extract exports
    if (ts.isExportDeclaration(node)) {
      this.extractExport(node, result, baseDir);
    }

    // Extract export assignments (export default ...)
    if (ts.isExportAssignment(node)) {
      this.extractExportAssignment(node, result);
    }

    // Recursively visit children
    ts.forEachChild(node, (child) => this.visitNode(child, result, baseDir));
  }

  private extractImport(
    node: ts.ImportDeclaration,
    result: IImportGraphExtractionResult,
    baseDir: string
  ): void {
    const moduleSpecifier = node.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) return;

    const source = moduleSpecifier.text;
    const resolvedPath = this.resolveImportPath(source, baseDir);

    let importType: IImportMetadata['type'] = 'named';
    let specifier: string | undefined;

    if (node.importClause?.name) {
      // import Component from './file'
      importType = 'default';
      specifier = node.importClause.name.text;
    } else if (node.importClause?.namedBindings) {
      const bindings = node.importClause.namedBindings;

      if (ts.isNamespaceImport(bindings)) {
        // import * as ns from './file'
        importType = 'namespace';
        specifier = bindings.name.text;
      } else if (ts.isNamedImports(bindings)) {
        // import { A, B } from './file'
        for (const element of bindings.elements) {
          if (element.propertyName) {
            // import { a as X } from './file'
            result.imports.push({
              source,
              resolvedPath,
              type: 'named',
              specifier: element.name.text
            });
          } else {
            result.imports.push({
              source,
              resolvedPath,
              type: 'named',
              specifier: element.name.text
            });
          }
        }
        return; // Already processed named imports
      }
    }

    result.imports.push({
      source,
      resolvedPath,
      type: importType,
      specifier
    });
  }

  private extractExport(
    node: ts.ExportDeclaration,
    result: IImportGraphExtractionResult,
    baseDir: string
  ): void {
    const moduleSpecifier = node.moduleSpecifier;
    let source: string | undefined;
    let resolvedPath: string | undefined;

    if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
      source = moduleSpecifier.text;
      resolvedPath = this.resolveImportPath(source, baseDir);
    }

    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      // export { A, B } from './file'
      for (const element of node.exportClause.elements) {
        result.exports.push({
          name: element.name.text,
          source: resolvedPath,
          type: 'named'
        });
      }
    }
  }

  private extractExportAssignment(
    node: ts.ExportAssignment,
    result: IImportGraphExtractionResult
  ): void {
    // export default Expression
    result.exports.push({
      name: 'default',
      type: 'default'
    });
  }

  private resolveImportPath(importPath: string, baseDir: string): string {
    // Handle relative imports
    if (importPath.startsWith('.')) {
      const resolved = path.resolve(baseDir, importPath);

      // Try to find exact file match
      if (fs.existsSync(resolved + '.ts')) return resolved + '.ts';
      if (fs.existsSync(resolved + '.tsx')) return resolved + '.tsx';
      if (fs.existsSync(resolved + '.js')) return resolved + '.js';
      if (fs.existsSync(resolved + '.jsx')) return resolved + '.jsx';

      // Try index file
      const indexPath = path.join(resolved, 'index.ts');
      if (fs.existsSync(indexPath)) return indexPath;

      return resolved;
    }

    // Handle path aliases (@/ → src/)
    for (const [alias, paths] of Object.entries(this.tsConfigPaths)) {
      if (importPath.startsWith(alias.replace('*', ''))) {
        const suffix = importPath.replace(alias, '');
        for (const candidate of paths) {
          const resolved = path.resolve(candidate.replace('*', ''));
          if (fs.existsSync(resolved + suffix + '.ts')) {
            return path.resolve(resolved, suffix) + '.ts';
          }
        }
      }
    }

    // Handle node_modules imports (keep as-is)
    return importPath;
  }

  private loadTsConfigPaths(tsConfigPath: string): void {
    try {
      const tsConfigContent = fs.readFileSync(tsConfigPath, 'utf-8');
      const tsConfig = JSON.parse(tsConfigContent);

      if (tsConfig.compilerOptions?.paths) {
        const baseUrl = tsConfig.compilerOptions.baseUrl || '.';
        this.tsConfigPaths = {};

        for (const [alias, paths] of Object.entries(tsConfig.compilerOptions.paths)) {
          const resolvedPaths = (paths as string[]).map((p) => {
            return path.resolve(path.dirname(tsConfigPath), baseUrl, p);
          });
          this.tsConfigPaths[alias] = resolvedPaths;
        }
      }
    } catch (error) {
      console.warn(`Failed to load tsconfig from ${tsConfigPath}:`, error);
    }
  }

  private addExports(filePath: string, exports: IExportMetadata[]): void {
    // Store exports for barrel export resolution
    // Implementation would track exports in a separate index
  }

  // Helper methods for transitive analysis

  getTransitiveDependencies(
    importGraph: IImportGraph,
    filePath: string,
    maxDepth: number = 3
  ): Map<string, number> {
    const dependencies = new Map<string, number>();
    const visited = new Set<string>();

    const traverse = (currentPath: string, depth: number) => {
      if (depth > maxDepth || visited.has(currentPath)) return;
      visited.add(currentPath);

      const deps = importGraph.dependencies.get(currentPath);
      if (!deps) return;

      for (const dep of deps) {
        const existingDepth = dependencies.get(dep) || Infinity;
        dependencies.set(dep, Math.min(existingDepth, depth));
        traverse(dep, depth + 1);
      }
    };

    traverse(filePath, 1);
    return dependencies;
  }

  getTransitiveDependents(
    importGraph: IImportGraph,
    filePath: string,
    maxDepth: number = 3
  ): Map<string, number> {
    const dependents = new Map<string, number>();
    const visited = new Set<string>();

    const traverse = (currentPath: string, depth: number) => {
      if (depth > maxDepth || visited.has(currentPath)) return;
      visited.add(currentPath);

      const deps = importGraph.dependents.get(currentPath);
      if (!deps) return;

      for (const dep of deps) {
        const existingDepth = dependents.get(dep) || Infinity;
        dependents.set(dep, Math.min(existingDepth, depth));
        traverse(dep, depth + 1);
      }
    };

    traverse(filePath, 1);
    return dependents;
  }
}
```

### 2. Update Types File

**File:** `src/core/types.ts` (Add to existing)

```typescript
// Add these types

export interface IImportGraph {
  dependencies: Map<string, Set<string>>;    // file → files it imports
  dependents: Map<string, Set<string>>;      // file → files that import it
}

export interface IImportGraphExtractionResult {
  filePath: string;
  imports: IImportMetadata[];
  exports: IExportMetadata[];
}

export interface IImportMetadata {
  source: string;
  resolvedPath: string;
  type: 'default' | 'named' | 'namespace' | 'type';
  specifier?: string;
}

export interface IExportMetadata {
  name: string;
  source?: string;
  type: 'named' | 'default' | 'namespace' | 'type';
}
```

## Usage Example

```typescript
import { ImportGraphAnalyzer } from './analyzers/import-graph-analyzer';

const analyzer = new ImportGraphAnalyzer();

// Extract from files
const result1 = await analyzer.analyze({
  filePath: 'src/App.tsx',
  sourceCode: fs.readFileSync('src/App.tsx', 'utf-8'),
  tsConfig: 'tsconfig.json'
});

const result2 = await analyzer.analyze({
  filePath: 'src/pages/LoginPage.tsx',
  sourceCode: fs.readFileSync('src/pages/LoginPage.tsx', 'utf-8'),
  tsConfig: 'tsconfig.json'
});

// Build import graph
const importGraph = analyzer.buildImportGraph([result1, result2]);

// Query dependencies
const deps = importGraph.dependencies.get('src/App.tsx');
console.log(deps);
// Set(['./pages/HomePage', './components/Header', ...])

const dependents = importGraph.dependents.get('src/components/Button.tsx');
console.log(dependents);
// Set(['src/pages/LoginPage', 'src/components/Form', ...])

// Transitive analysis
const transitiveDeps = analyzer.getTransitiveDependencies(importGraph, 'src/App.tsx', 2);
console.log(transitiveDeps);
// Map([
//   ['src/pages/HomePage.ts', 1],
//   ['src/components/Button.ts', 2],
//   ...
// ])
```

## Testing Strategy

### Unit Tests

1. **Import Extraction**
   - Test relative path resolution
   - Test path alias resolution
   - Test node_modules handling
   - Test default imports
   - Test named imports
   - Test namespace imports

2. **Export Extraction**
   - Test named exports
   - Test export default
   - Test re-exports

3. **Import Graph**
   - Test dependency mapping
   - Test dependent mapping
   - Test bidirectional consistency

4. **Transitive Analysis**
   - Test shallow traversal (depth 1)
   - Test deep traversal (depth > 1)
   - Test circular dependency handling

### Integration Tests

1. Test with real codebase
2. Test tsconfig path resolution
3. Test barrel export resolution

## Dependencies

- `typescript` (peer dependency)
- Base analyzer system (Task 01)
- Registry system (Task 04 - for storing import graph)

## Related Tasks

- Task 01: Base Analyzer System
- Task 04: Registry System
- Task 05: Scoring Engine (transitive-import scorer)

## Notes

- Import graph is fundamental for transitive impact analysis
- Path aliases are resolved using tsconfig.json
- Circular dependencies are handled by visited set
- Transitive depth can be limited to prevent explosion