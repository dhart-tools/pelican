# Task 01: Base Analyzer System

## Overview

Create the base analyzer infrastructure that enables plug-and-play analyzer registration and execution. This is the foundation that all other analyzers will build upon.

## Objectives

1. Define the analyzer interface contract
2. Create base analyzer class
3. Implement analyzer registry system
4. Establish analyzer discovery mechanism
5. Provide unified execution interface

## Core Interfaces

### Analyzer Interface

```typescript
// src/core/types.ts

export interface IAnalyzer<TInput = any, TOutput = any> {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly dependencies: string[];

  analyze(input: TInput): Promise<TOutput>;
  getSignals?(changedFile: string, testFile: string, context: IAnalyzerContext): ISignal[];
}

export interface IAnalyzerContext {
  registry: IRegistry;
  config: ISuggestorConfig;
  logger: ILogger;
}

export interface ISignal {
  source: string;              // Analyzer name that generated this signal
  type: string;               // Signal type (e.g., "direct-import", "route-match")
  weight: number;             // Confidence weight (0.0 - 1.0)
  matched: boolean;
  metadata?: {
    changedFile?: string;
    testFile?: string;
    details?: any;
  };
  reason?: string;            // Human-readable explanation
}
```

### Analyzer Registry Interface

```typescript
export interface IAnalyzerRegistry {
  register(analyzer: IAnalyzer): void;
  unregister(name: string): void;
  get(name: string): IAnalyzer | undefined;
  getAll(): IAnalyzer[];
  getEnabled(): IAnalyzer[];
  hasDependencies(analyzer: IAnalyzer): boolean;
  validate(analyzer: IAnalyzer): { valid: boolean; errors: string[] };
}
```

## Implementation

### 1. Create Base Analyzer Class

**File:** `src/analyzers/base.ts`

```typescript
import { IAnalyzer, IAnalyzerContext } from '../core/types';

export abstract class BaseAnalyzer implements IAnalyzer {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly dependencies: string[] = [];

  constructor(
    config: {
      name: string;
      version: string;
      description: string;
      dependencies?: string[];
    }
  ) {
    this.name = config.name;
    this.version = config.version;
    this.description = config.description;
    this.dependencies = config.dependencies || [];
  }

  abstract analyze(input: any): Promise<any>;

  protected getSignals?(
    changedFile: string,
    testFile: string,
    context: IAnalyzerContext
  ): ISignal[] {
    return [];
  }

  protected log(level: 'info' | 'warn' | 'error', message: string): void {
    console.log(`[${this.name}] ${level}: ${message}`);
  }
}
```

### 2. Create Analyzer Registry

**File:** `src/core/analyzer-registry.ts`

```typescript
import { IAnalyzer, IAnalyzerRegistry, ISuggestorConfig } from './types';

export class AnalyzerRegistry implements IAnalyzerRegistry {
  private analyzers: Map<string, IAnalyzer> = new Map();
  private config: ISuggestorConfig;

  constructor(config: ISuggestorConfig) {
    this.config = config;
  }

  register(analyzer: IAnalyzer): void {
    const validation = this.validate(analyzer);
    if (!validation.valid) {
      throw new Error(
        `Invalid analyzer ${analyzer.name}: ${validation.errors.join(', ')}`
      );
    }

    this.log('info', `Registering analyzer: ${analyzer.name}`);
    this.analyzers.set(analyzer.name, analyzer);
  }

  unregister(name: string): void {
    const analyzer = this.analyzers.get(name);
    if (analyzer) {
      this.log('info', `Unregistering analyzer: ${name}`);
      this.analyzers.delete(name);
    }
  }

  get(name: string): IAnalyzer | undefined {
    return this.analyzers.get(name);
  }

  getAll(): IAnalyzer[] {
    return Array.from(this.analyzers.values());
  }

  getEnabled(): IAnalyzer[] {
    const enabled = this.config.analyzers.enabled;
    return this.getAll().filter((a) => enabled.includes(a.name));
  }

  hasDependencies(analyzer: IAnalyzer): boolean {
    return analyzer.dependencies.every((dep) =>
      this.analyzers.has(dep)
    );
  }

  validate(analyzer: IAnalyzer): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!analyzer.name) {
      errors.push('Analyzer must have a name');
    }

    if (!analyzer.version) {
      errors.push('Analyzer must have a version');
    }

    if (typeof analyzer.analyze !== 'function') {
      errors.push('Analyzer must implement analyze() method');
    }

    if (!this.hasDependencies(analyzer)) {
      errors.push(
        `Missing dependencies: ${analyzer.dependencies.filter(
          (d) => !this.analyzers.has(d)
        ).join(', ')}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    console.log(`[Registry] ${level}: ${message}`);
  }
}
```

### 3. Create Analyzer Discovery System

**File:** `src/core/analyzer-discovery.ts`

```typescript
import fs from 'fs';
import path from 'path';
import { IAnalyzer } from './types';

export class AnalyzerDiscovery {
  static async discover(
    analyzersDir: string
  ): Promise<IAnalyzer[]> {
    const analyzers: IAnalyzer[] = [];

    if (!fs.existsSync(analyzersDir)) {
      return analyzers;
    }

    const files = fs.readdirSync(analyzersDir);

    for (const file of files) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) {
        continue;
      }

      try {
        const fullPath = path.join(analyzersDir, file);
        const module = await import(fullPath);

        // Look for default export or named exports that implement IAnalyzer
        if (module.default && this.isAnalyzer(module.default)) {
          analyzers.push(module.default);
        }

        for (const key of Object.keys(module)) {
          if (key !== 'default' && this.isAnalyzer(module[key])) {
            analyzers.push(module[key]);
          }
        }
      } catch (error) {
        console.warn(`Failed to load analyzer from ${file}:`, error);
      }
    }

    return analyzers;
  }

  private static isAnalyzer(obj: any): obj is IAnalyzer {
    return (
      obj &&
      typeof obj === 'object' &&
      typeof obj.name === 'string' &&
      typeof obj.analyze === 'function'
    );
  }
}
```

### 4. Create Types File

**File:** `src/core/types.ts`

```typescript
// Core interfaces
export interface IAnalyzer<TInput = any, TOutput = any> {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly dependencies: string[];

  analyze(input: TInput): Promise<TOutput>;
  getSignals?(changedFile: string, testFile: string, context: IAnalyzerContext): ISignal[];
}

export interface IAnalyzerContext {
  registry: IRegistry;
  config: ISuggestorConfig;
  logger: ILogger;
}

export interface ISignal {
  source: string;
  type: string;
  weight: number;
  matched: boolean;
  metadata?: {
    changedFile?: string;
    testFile?: string;
    details?: any;
  };
  reason?: string;
}

// Registry interfaces
export interface IFileEntry {
  name: string;
  type: 'source' | 'test';
  path: string;
  exports: string[];
  imports: string[];
  classes: string[];
  functions: string[];
  interfaces: string[];
  keywords: string[];
}

export interface IRegistry {
  files: Map<string, IFileEntry>;
  importGraph: {
    dependencies: Map<string, Set<string>>;
    dependents: Map<string, Set<string>>;
  };
  getIndex<T>(name: string): Map<any, any> | undefined;
  setIndex<T>(name: string, index: Map<any, any>): void;
}

// Configuration interfaces
export interface ISuggestorConfig {
  analyzers: {
    enabled: string[];
    sourceExtractor: {
      enabled: boolean;
      selectorStrategy: string[];
    };
    cypressExtractor: {
      enabled: boolean;
    };
    reduxChain: {
      enabled: boolean;
      storeDirs: string[];
    };
    i18n: {
      enabled: boolean;
      library: string;
      localesPath: string;
    };
    routeAnalyzer: {
      enabled: boolean;
      routerFile: string;
    };
    importGraph: {
      enabled: boolean;
    };
  };
  scoring: {
    minConfidence: number;
    ubiquityThreshold: number;
    enabledScorers: string[];
  };
}

export interface ILogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ISourceSelector {
  attr: string;
  value: string;
}

export interface ICypressSelector {
  type: string;
  value: string;
}

export interface IRouteDef {
  path: string;
  component: string;
}
```

## Usage Example

```typescript
import { AnalyzerRegistry, AnalyzerDiscovery } from './core/analyzers';
import { createRegistry } from './core/registry';

// Initialize
const config = loadConfig();
const registry = createRegistry();
const analyzerRegistry = new AnalyzerRegistry(config);

// Discover and register analyzers
const analyzers = await AnalyzerDiscovery.discover('./src/analyzers');
for (const analyzer of analyzers) {
  analyzerRegistry.register(analyzer);
}

// Get enabled analyzers
const enabledAnalyzers = analyzerRegistry.getEnabled();

// Execute analysis
for (const analyzer of enabledAnalyzers) {
  const result = await analyzer.analyze({
    files: changedFiles,
    registry,
    config
  });
}
```

## Testing Strategy

### Unit Tests

1. **Analyzer Registry**
   - Test registration/unregistration
   - Test dependency validation
   - Test enabled analyzer filtering

2. **Analyzer Discovery**
   - Test auto-discovery from filesystem
   - Test module loading
   - Test error handling

3. **Base Analyzer**
   - Test abstract class usage
   - Test initialization

### Integration Tests

1. Test full analyzer registration flow
2. Test analyzer execution with context
3. Test inter-analyzer dependencies

## Dependencies

- None (core infrastructure)

## Related Tasks

- Task 02: Source Extractor Analyzer
- Task 03: Cypress Extractor Analyzer
- Task 04: Registry System

## Notes

- This is the foundational task; all other analyzers depend on this
- The plug-and-play mechanism allows easy addition of new analyzers
- Analyzer discovery can be disabled for production builds for performance