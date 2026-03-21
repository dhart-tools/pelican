# Test Suggestor CLI — Base Context

> **Every agent must read this file first.** It contains the shared architecture, purpose, conventions, and interface contracts that all parts depend on.

---

## Purpose

A TypeScript CLI tool that helps developers identify which test files to run when they make source code changes. It uses:
- **Git SHA tracking** for incremental indexing
- **Hybrid keyword extraction** (TypeScript AST + local LLM via Ollama) for file analysis
- **Two-phase matching** (keyword funnel → LLM semantic ranking) for suggestions

Three commands: `setup`, `index`, `suggest`.

---

## Technology Stack

| Tech | Purpose | Version |
|---|---|---|
| TypeScript | Language | 5.x, ES2022 target, NodeNext modules |
| Node.js | Runtime | 20+ |
| Commander | CLI framework | ^12.x |
| Ollama | Local LLM | `qwen2.5-coder:3b` default model |
| ink + React | Terminal UI | ink v5, React 18 |
| TypeScript Compiler API | AST extraction | Built into `typescript` package |
| p-limit | Concurrency control | ^6.x |
| glob | File pattern matching | ^11.x |

---

## Project Structure

```
suggestor/
├── src/
│   ├── cli.ts                     # Entry point, command routing
│   ├── commands/
│   │   ├── setup.ts               # Setup command
│   │   ├── index.ts               # Index command
│   │   └── suggest.ts             # Suggest command
│   ├── core/
│   │   ├── analyzer.ts            # Hybrid: AST + LLM file analysis
│   │   ├── ast-extractor.ts       # TS compiler API keyword extraction
│   │   ├── matcher.ts             # Keyword funnel + LLM semantic ranking
│   │   └── git.ts                 # Git SHA & diff utilities
│   ├── llm/
│   │   ├── ollama.ts              # Ollama client wrapper
│   │   └── prompts.ts             # Prompt template loader
│   ├── ui/
│   │   ├── components/
│   │   │   ├── SetupView.tsx      # Setup command UI
│   │   │   ├── IndexView.tsx      # Index progress UI
│   │   │   ├── SuggestView.tsx    # Suggestion results UI
│   │   │   └── common/
│   │   │       ├── ProgressBar.tsx # Reusable progress bar
│   │   │       ├── StatusLine.tsx  # Status with spinner
│   │   │       └── ResultsTable.tsx # Formatted results
│   │   └── theme.ts               # Colors & styles
│   ├── store/
│   │   └── descriptor.ts          # Read/write descriptor.json
│   └── config.ts                  # Configuration loader
├── prompts/
│   ├── analyze.md                 # File analysis prompt
│   └── suggest.md                 # Test suggestion prompt
├── descriptor.json                # The agent map (committable)
├── .suggestorrc.json              # User configuration
├── package.json
└── tsconfig.json
```

---

## `descriptor.json` Schema

This is the core data store — a committable JSON file acting as the "agent map."

```typescript
interface IDescriptor {
  sha: string;               // Last indexed git SHA
  files: IFileEntry[];         // Array of analyzed files
}

interface IFileEntry {
  name: string;               // Relative path: "src/deviceManager.ts"
  description: string;        // LLM-generated description of the file
  keywords: string[];         // Merged AST + LLM keywords (lowercase)
  components: string[];       // Exported classes, functions, interfaces
  type: "source" | "test";    // Whether this is a source or test file
}
```

**Example:**
```json
{
  "sha": "a1b2c3d4e5f6",
  "files": [
    {
      "name": "src/deviceManager.ts",
      "description": "Manages device lifecycle, connection pooling, and state tracking",
      "keywords": ["device manager", "device group", "connection", "lifecycle"],
      "components": ["DeviceManager", "DeviceGroup", "ConnectionPool"],
      "type": "source"
    },
    {
      "name": "src/__tests__/deviceManager.test.ts",
      "description": "Tests device creation, group operations, and connection handling",
      "keywords": ["device manager", "device group", "test", "connection"],
      "components": ["DeviceManager", "DeviceGroup"],
      "type": "test"
    }
  ]
}
```

---

## `.suggestorrc.json` Schema

```typescript
interface ISuggestorConfig {
  model: string;                    // Default: "qwen2.5-coder:3b"
  testPatterns: string[];           // Default: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"]
  sourcePatterns: string[];         // Default: ["**/*.ts", "**/*.tsx"]
  ignorePatterns: string[];         // Default: ["node_modules", "dist", ".git", "context"]
  maxParallelAnalysis: number;      // Default: 4
  ollamaHost: string;              // Default: "http://localhost:11434"
}
```

---

## Shared TypeScript Interfaces

All agents must use these exact interfaces. Place them in `src/types.ts`:

```typescript
// ─── Descriptor Types ────────────────────────────────────
export interface IDescriptor {
  sha: string;
  files: IFileEntry[];
}

export interface IFileEntry {
  name: string;
  description: string;
  keywords: string[];
  components: string[];
  type: "source" | "test";
}

// ─── Analysis Types ──────────────────────────────────────
export interface IASTExtractionResult {
  exports: string[];           // Exported names
  classes: string[];           // Class names
  functions: string[];         // Function names
  interfaces: string[];        // Interface/type names
  imports: string[];           // Imported module names
}

export interface ILLMAnalysisResult {
  description: string;
  keywords: string[];
  components: string[];
  type: "source" | "test";
}

export interface IAnalysisResult {
  name: string;
  description: string;
  keywords: string[];          // Merged AST + LLM keywords
  components: string[];        // From AST extraction
  type: "source" | "test";
}

// ─── Matching Types ──────────────────────────────────────
export interface ISuggestionResult {
  testFile: string;            // Path to suggested test file
  confidence: number;          // 0-1 confidence score
  reason: string;              // Why this test was suggested
  matchedKeywords: string[];   // Overlapping keywords
}

// ─── Config Types ────────────────────────────────────────
export interface ISuggestorConfig {
  model: string;
  testPatterns: string[];
  sourcePatterns: string[];
  ignorePatterns: string[];
  maxParallelAnalysis: number;
  ollamaHost: string;
}

// ─── Git Types ───────────────────────────────────────────
export interface IGitChanges {
  staged: string[];
  unstaged: string[];
  all: string[];               // Deduplicated union
}
```

---

## Code Style & Conventions

1. **ESM only**: Use `import`/`export`, not `require`
2. **Strict TypeScript**: `strict: true` in tsconfig
3. **Async/await**: All I/O operations are async
4. **Error handling**: Wrap external calls (git, ollama, fs) in try/catch, throw descriptive errors
5. **No classes unless necessary**: Prefer functions and plain objects
6. **Naming**: camelCase for variables/functions, PascalCase for types/interfaces/components
7. **File naming**: kebab-case for files (`ast-extractor.ts`), PascalCase for React components (`SetupView.tsx`)
8. **Imports**: Group by (1) node builtins, (2) external packages, (3) internal modules — separated by blank lines

---

## Command Flow Overview

### `suggestor setup`
```
Check Ollama running → Pull model (progress bar) → Init descriptor.json → Create .suggestorrc.json
```

### `suggestor index`
```
Read descriptor.json SHA → git diff --name-only <sha> HEAD → Filter by patterns
→ For each file (parallel):
    → AST extract (instant) + LLM analyze (async)
    → Merge keywords
→ Upsert into descriptor.json → Update SHA to HEAD
```

### `suggestor suggest`
```
git diff (staged + unstaged) → changed files
→ For each: use cached descriptor data or quick-analyze
→ Phase 1: Keyword funnel (score all test files by keyword overlap) → top N candidates
→ Phase 2: LLM semantic ranking (always runs on candidates) → ranked results
→ Display in animated table
```

---

## Dependency Graph Between Parts

```
Part 1 (Foundation) ──────────────────────────────────┐
                                                       ▼
Part 2 (Store) ─────────────────────────────────► Part 8 (Commands & CLI)
Part 3 (Git) ──────────────────────────────────►       ▲
Part 4 (AST) ──────► Part 7 (Core Logic) ─────────────┤
Part 5 (LLM) ──────►                                   │
Part 6 (UI Components) ────────────────────────────────┘
```

**Parts 2, 3, 4, 5, 6 can all be built in parallel** — they have no dependencies on each other.
**Part 7** depends on Parts 2, 4, 5.
**Part 8** depends on all other parts.
