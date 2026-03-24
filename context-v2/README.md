# Context V2 - Test Suggestor v3 Architecture

## Overview

This directory contains the modular, plug-and-play architecture for Test Suggestor v3. The architecture is designed to be extensible, maintainable, and easy to understand.

## Development Standards

- **Documentation**: All public types, interfaces, classes, and methods must have complete JSDoc documentation, including descriptions, parameters, return types, and usage examples where applicable. Focus on high-value comments; avoid cluttering with unnecessary implementation details.
- **Testing**: Every analyzer and every scorer must have corresponding unit tests.
- **Modular Design**: Adhere to the plug-and-play analyzer architecture.
- **TypeScript**: Use strict TypeScript configuration.
- **ES Modules**: Follow ESM standards.

## Architecture Philosophy

1. **Plug & Play Analyzers**: Each analyzer is a self-contained module that can be added or removed independently
2. **Modular Scorers**: Scoring signals are implemented as separate modules that can be enabled/disabled
3. **Unified Registry**: All metadata is stored in a central registry with indexed lookups
4. **Configurable**: Everything can be configured via config file or CLI options

## System Layers

```
┌─────────────────────────────────────────────────┐
│                    CLI Layer                     │
│          (analyze, setup, registry)              │
└──────────────────────┬──────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│              Analyzer Registry                   │
│         (Discovery & Registration)               │
└──────────────────────┬──────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│              Analyzers (Extractors)              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  Source  │ │  Cypress  │ │   Redux Chain    │ │
│  │Extractor │ │ Extractor │ │    Analyzer      │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │   i18n   │ │   Route  │ │  Import Graph    │ │
│  │ Analyzer │ │  Analyzer │ │    Analyzer      │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
└──────────────────────┬──────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│                 Registry Store                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  Import  │ │  Route   │ │  Selector        │ │
│  │  Graph   │ │   Map    │ │    Index         │ │
│  ├──────────┤ ├──────────┤ ├──────────────────┤ │
│  │ Redux    │ │   i18n   │ │  Translations    │ │
│  │  Chains  │ │  Index   │ │                  │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
└──────────────────────┬──────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│              Scoring Engine                      │
│         (Plug & Play Scorers)                    │
└──────────────────────┬──────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│              Results & Output                   │
└─────────────────────────────────────────────────┘
```

## Task Files

Each task file contains complete implementation details, including:

- Objectives
- Core types and interfaces
- Full implementation code
- Usage examples
- Testing strategy
- Dependencies
- Related tasks

### Core Infrastructure

| Task | Description | Status |
|------|-------------|--------|
| [00-architecture-overview.md](00-architecture-overview.md) | High-level architecture overview | ✅ |
| [01-setup-analyzer-base.md](tasks/01-setup-analyzer-base.md) | Base analyzer system & registry | ✅ |
| [02-source-extractor.md](tasks/02-source-extractor.md) | Source file AST mining | ✅ |
| [03-cypress-extractor.md](tasks/03-cypress-extractor.md) | Cypress test file parsing | ✅ |
| [04-registry-system.md](tasks/04-registry-system.md) | Central registry store | ✅ |
| [05-scoring-engine.md](tasks/05-scoring-engine.md) | Signal aggregation system | ✅ |

### Specialized Analyzers

| Task | Description | Status |
|------|-------------|--------|
| [06-redux-chain-analyzer.md](tasks/06-redux-chain-analyzer.md) | Redux chain detection | ✅ |
| [07-i18n-analyzer.md](tasks/07-i18n-analyzer.md) | Translation key resolution | ✅ |
| [08-route-analyzer.md](tasks/08-route-analyzer.md) | Route definition extraction | ✅ |
| [09-import-graph-analyzer.md](tasks/09-import-graph-analyzer.md) | Import graph builder | ✅ |

### Scoring & Integration

| Task | Description | Status |
|------|-------------|--------|
| [10-scorer-modules.md](tasks/10-scorer-modules.md) | All scorer implementations | ✅ |
| [11-cli-integration.md](tasks/11-cli-integration.md) | CLI commands and setup wizard | ✅ |

## Implementation Order

Follow this order to implement the system:

### Phase 1: Foundation (Tasks 00-01)
1. Read architecture overview
2. Implement base analyzer system
3. Implement analyzer registry

### Phase 2: Core Analyzers (Tasks 02-03)
4. Implement source extractor
5. Implement Cypress extractor

### Phase 3: Registry (Task 04)
6. Implement registry system
7. Implement registry builder

### Phase 4: Scoring (Task 05)
8. Implement scoring engine
9. Implement base scorer class

### Phase 5: Specialized Analyzers (Tasks 06-09)
10. Implement Redux chain analyzer
11. Implement i18n analyzer
12. Implement route analyzer
13. Implement import graph analyzer

### Phase 6: Scorers (Task 10)
14. Implement all scorer modules

### Phase 7: Integration (Task 11)
15. Implement CLI commands
16. Implement setup wizard
17. Implement config management

## Adding a New Analyzer

1. Create a new file in `src/analyzers/` extending `BaseAnalyzer`
2. Implement `analyze()` method
3. Register in `src/commands/analyze.ts` or let auto-discovery handle it
4. Contributed signals can be used by scorers

Example:

```typescript
import { BaseAnalyzer } from './base';

export class MyAnalyzer extends BaseAnalyzer {
  constructor() {
    super({
      name: 'my-analyzer',
      version: '1.0.0',
      description: 'My custom analyzer',
      dependencies: ['source-extractor']
    });
  }

  async analyze(input: any): Promise<any> {
    // Your implementation
  }
}
```

## Adding a New Scorer

1. Create a new file in `src/scorers/` extending `BaseScorer`
2. Implement `evaluate()` method
3. Register in `registerAllScorers()` function
4. Enable in config

Example:

```typescript
import { BaseScorer } from './base';

export class MyScorer extends BaseScorer {
  constructor() {
    super({
      name: 'my-scorer',
      version: '1.0.0',
      description: 'My custom scorer',
      weight: 0.75
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    // Your implementation
  }
}
```

## Configuration

Example `.suggestorrc.json`:

```json
{
  "analyzers": {
    "enabled": ["source-extractor", "cypress-extractor", "redux-chain", "i18n"],
    "sourceExtractor": {
      "enabled": true,
      "selectorStrategy": ["data-testid", "data-cy"]
    },
    "cypressExtractor": {
      "enabled": true
    },
    "reduxChain": {
      "enabled": true,
      "storeDirs": ["src/store"]
    },
    "i18n": {
      "enabled": true,
      "library": "react-i18next",
      "localesPath": "public/locales/{locale}/translation.json"
    }
  },
  "scoring": {
    "minConfidence": 0.40,
    "ubiquityThreshold": 0.70,
    "enabledScorers": ["direct-import", "route-match", "selector-match"]
  }
}
```

## CLI Usage

```bash
# Run setup wizard
suggestor setup

# Analyze changes
suggestor analyze

# Build registry
suggestor registry build

# Get configuration
suggestor config list
```

## Testing

Each task file includes testing strategies:

- Unit tests for individual components
- Integration tests for interactions
- Test data examples

## Key Benefits

✅ **Plug & Play**: Add/remove analyzers without core changes  
✅ **Extensible**: Easy to add new signals/analyzer  
✅ **Maintainable**: Each component has clear boundaries  
✅ **Testable**: Each task can be tested independently  
✅ **Configurable**: Everything is customizable  
✅ **Documented**: Each task has complete documentation  

## Migration from v2

The main changes from v2:

1. **Analyzer-based architecture**: Replaces monolithic extraction with modular analyzers
2. **Scorer modules**: Each signal is a separate module
3. **Auto-discovery**: Analyzers and scorers are automatically discovered
4. **Enhanced registry**: Better indexing and query capabilities
5. **Setup wizard**: Improved configuration experience

## License

This architecture is part of the Test Suggestor project.

---

**Next Steps:**

1. Start with [00-architecture-overview.md](00-architecture-overview.md)
2. Follow the implementation order
3. Test each component before moving to the next
4. Use the provided examples as templates