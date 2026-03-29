# Test Suggestor v3 - Plug & Play Analyzer Architecture

## Development Standards

- **Documentation**: All public types, interfaces, classes, and methods must have complete JSDoc documentation, including descriptions, parameters, return types, and usage examples where applicable. Focus on high-value comments; avoid cluttering with unnecessary implementation details.
- **Testing**: Every analyzer and every scorer must have corresponding unit tests.
- **Modular Design**: Adhere to the plug-and-play analyzer architecture.
- **TypeScript**: Use strict TypeScript configuration.
- **ES Modules**: Follow ESM standards.

## Architecture Philosophy

The Test Suggestor v3 architecture is built on three core principles:

1. **Modular Analyzers**: Each analyzer is a self-contained module that can be added, removed, or modified independently
2. **Plug & Play Registration**: New analyzers are discovered and registered automatically via a simple registration system
3. **Unified Pipeline**: All analyzers follow the same pipeline - extract → index → score → suggest

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    CLI Entry Point                       │
│              (suggestor suggest/analyze)                 │
└──────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              Analyzer Registry (Core)                    │
│  - Discovers and registers all analyzers                 │
│  - Manages analyzer lifecycle                           │
│  - Provides unified interface                           │
└──────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│          Extractors (Plug & Play Modules)               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │ AST Source  │ │   Cypress   │ │   Redux     │       │
│  │  Extractor  │ │  Extractor  │ │  Chain      │       │
│  └─────────────┘ └─────────────┘ └─────────────┘       │
│  ┌─────────────┐ ┌─────────────┐                        │
│  │   i18n      │ │    Route    │                        │
│  │  Analyzer   │ │  Analyzer   │  + Future Analyzers   │
│  └─────────────┘ └─────────────┘                        │
└──────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│               Registry (Central Store)                   │
│  - ImportGraph                                          │
│  - SelectorIndex                                        │
│  - TranslationIndex                                     │
│  - ReduxChainMap                                        │
│  - RouteMap                                             │
└──────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│            Scoring Engine (Plug & Play)                 │
│  - Signal Evaluator (Plug & Play Scorer Modules)         │
│  - Aggregator                                           │
│  - Confidence Calculator                                │
└──────────────────────┬──────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              Results & Explanation                       │
│  - Ranked test suggestions                              │
│  - Signal breakdown                                     │
│  - Explanation generator                                │
└─────────────────────────────────────────────────────────┘
```

## Core Architecture Layers

### Layer 1: Analyzer Registry System

The **Analyzer Registry** is the heart of the plug-and-play architecture. It:

- Discovers analyzers via filesystem scanning
- Registers analyzers with their metadata
- Provides unified execution interface
- Manages analyzer dependencies

### Layer 2: Extractors (Analyzers)

Extractors are modular components that mine semantic information from source code. Each extractor:

- Implements a common interface (`IAnalyzer`)
- Registers itself with the registry
- Can be added/removed without affecting other components
- Contributes signals to the scoring engine

### Layer 3: Registry (Central Store)

The Registry is the centralized data store that holds:

- File entries (import/export metadata)
- Import graph (bidirectional dependencies)
- Specialized indexes (selectors, routes, i18n, Redux chains)

### Layer 4: Scoring Engine

The Scoring Engine evaluates test relevance using:

- Signal modules (plug-and-play scoring logic)
- Aggregation formula
- Confidence thresholds

## Key Design Decisions

### 1. Analyzer Interface Contract

All analyzers must implement:

```typescript
interface IAnalyzer<TInput, TOutput> {
  name: string;              // Unique analyzer identifier
  version: string;           // Semantic version
  dependencies: string[];    // Required analyzers

  extract(input: TInput): Promise<TOutput>;
  index(output: TOutput): void;
  getSignals(changedFile: string, testFile: string): ISignal[];
}
```

### 2. Registration Pattern

Analyzers are registered via:

- **Auto-discovery**: Scanning `src/core/analyzers/` directory
- **Manual registration**: Explicit calls in setup
- **Config-based**: Enabling/disabling via configuration

### 3. Signal-Based Scoring

Each analyzer contributes signals with weights:

```typescript
interface ISignal {
  source: string;        // Analyzer name
  type: string;         // Signal type
  weight: number;       // Confidence weight (0-1)
  matched: boolean;
  metadata?: any;
}
```

## Extensibility

### Adding a New Analyzer

To add a new analyzer:

1. Implement `IAnalyzer` interface
2. Place file in `src/core/analyzers/`
3. Analyzer auto-registers on startup
4. Contribute signals to scoring
5. No changes needed to core system

### Adding a New Scorer

To add a new scoring mechanism:

1. Implement `IScorer` interface
2. Register with Scoring Engine
3. Scorer becomes available globally
4. Can be configured to run conditionally

## File Structure

```
src/
  v2/
    core/
      registry.ts                  # Central registry store
      analyzer-registry.ts         # Analyzer discovery & registration
      scoring/                     # Consolidated Scoring System
        scoring-engine.ts          # Signal aggregation
        scoring-engine.test.ts     # Co-located unit tests
        scorers/                   # Plug & Play Scorers
          base.ts                  # Base scorer class
          base.test.ts
          direct-import-scorer.ts
          route-match-scorer.ts
          selector-match-scorer.ts
      git.ts                       # Git diff parsing
      types/                       # Shared types & interfaces
    analyzers/                     # Plug & Play Analyzers
      base.ts                      # Base analyzer class
      source-extractor/            # Modular analyzer directories
      cypress-extractor/
      redux-chain/
      i18n-analyzer/
      route-analyzer/
    commands/
      setup.ts                     # Setup wizard
      analyze.ts                   # Main CLI entry point
    config.ts                      # Configuration management
```

## Implementation Phases

Phase 1: Core Infrastructure (This document)
Phase 2: Base Analyzer System
Phase 3: Source Extractor Analyzer
Phase 4: Cypress Extractor Analyzer
Phase 5: Registry System
Phase 6: Scoring Engine
Phase 7: Redux Chain Analyzer
Phase 8: i18n Analyzer
Phase 9: Route Analyzer
Phase 10: Import Graph Analyzer
Phase 11: Scorer Modules
Phase 12: CLI Integration

## Configuration

```typescript
interface ISuggestorConfig {
  analyzers: {
    enabled: string[];          // List of enabled analyzers
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
```

---

Next: See individual task files for implementation details:
- `01-setup-analyzer-base.md` - Base analyzer system
- `02-source-extractor.md` - Source file AST mining
- `03-cypress-extractor.md` - Cypress test parsing
- `04-registry-system.md` - Central registry store
- `05-scoring-engine.md` - Signal aggregation
- `06-redux-chain-analyzer.md` - Redux chain detection
- `07-i18n-analyzer.md` - Translation resolution
- `08-route-analyzer.md` - Route extraction
- `09-import-graph-analyzer.md` - Import graph builder
- `10-scorer-modules.md` - Modular scorers
- `11-cli-integration.md` - CLI command integration