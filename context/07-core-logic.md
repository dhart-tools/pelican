# Part 7: Core Logic (Analyzer & Matcher)

> **Prerequisite**: Read `00-base-context.md` first.

## Scope

The brain of the application — analyzer combines AST + LLM extraction, matcher implements two-phase suggestion pipeline.

## Files to Create

| File | Purpose |
|---|---|
| `src/core/analyzer.ts` | Hybrid file analysis (AST + LLM) |
| `src/core/git.ts` | `GitService` class for git operations |

## Dependencies

- **Part 1**: `IAnalysisResult`, `IFileEntry`, `ISuggestionResult`, `IASTExtractionResult`, `ILLMAnalysisResult`
- **Part 4**: `extractFromFile`, `astResultToKeywords`, `detectFileType`
- **Part 3**: `GitService` class (getCurrentSha, getWorkingChanges, etc.)
- **Part 2**: `DescriptorStore` class (load, save, findByKeywords, etc.)

---

## `src/core/analyzer.ts`

### Imports

```typescript
import { Ollama } from "ollama";
import pLimit from "p-limit";
import type { IAnalysisResult, ILLMAnalysisResult } from "../types.js";
import { extractFromFile, astResultToKeywords, detectFileType } from "./ast-extractor.js";
import { generateJSON } from "../llm/ollama.js";
import { loadPrompt } from "../llm/prompts.js";
```

### Functions to Implement

#### `analyzeFile(filePath, fileContent, client, model): Promise<IAnalysisResult>`
1. **AST pass**: `extractFromFile(filePath)` → `astResultToKeywords(result)` — instant, deterministic
2. **LLM pass**: Load `analyze` prompt with `{filePath, fileContent}` (truncate to 200 lines) → `generateJSON<ILLMAnalysisResult>()`
3. **Merge**: Deduplicate keywords from AST + LLM, combine components, use LLM description
4. **Type**: Use `detectFileType(filePath)`

#### `analyzeFiles(files, client, model, maxParallel, onProgress?): Promise<IAnalysisResult[]>`
1. `pLimit(maxParallel)` for concurrency
2. Map files → limited `analyzeFile` calls
3. Call `onProgress(completed, total, currentFile)` per file
4. On single file failure → catch, warn, return AST-only result (graceful degradation)

#### Helpers
- `truncateContent(content, maxLines)`: Split, take N lines, append `"... (truncated)"`
- `deduplicateKeywords(keywords)`: Lowercase → Set → sorted array

---

## `src/core/matcher.ts`

### Imports

```typescript
import { Ollama } from "ollama";
import type { IDescriptor, IFileEntry, ISuggestionResult } from "../types.js";
import { DescriptorStore } from "../store/descriptor.js";
import { generate } from "../llm/ollama.js";
import { loadPrompt } from "../llm/prompts.js";
```

### Functions to Implement

2. For each (changedFile, testFile) pair → `store.computeKeywordOverlap(changedEntry, testEntry)`
3. **Score**: `(keywordOverlap * 0.4) + (componentOverlap * 0.6)` — components weighted higher
4. Aggregate: if test matches multiple changed files, take max score
5. Sort descending, return top 15 candidates

#### Phase 2: `semanticRank(changedFiles, candidates, client, model): Promise<ISuggestionResult[]>`
1. Build context strings for changed files and candidates (name, description, keywords)
2. Load `suggest` prompt with `{changedFiles, candidateTests}`
3. Call LLM → parse JSON into `ISuggestionResult[]`
4. **Blend**: `finalConfidence = (phase1Score * 0.3) + (llmConfidence * 0.7)`
5. Filter out confidence < 0.3, sort descending
6. On LLM failure → fall back to Phase 1 scores

#### Orchestrator: `suggest(changedFiles, descriptor, client, model, onStatus?): Promise<ISuggestionResult[]>`
1. `onStatus("matching")` → `keywordMatch()`
2. If zero candidates → return empty
3. `onStatus("ranking")` → `semanticRank()`
4. Return final results

---

## Guidelines

- Graceful degradation: AST-only on LLM failure in analyzer; Phase 1 only on LLM failure in matcher
- All scores normalized 0-1
- Component overlap weighted 60% vs keyword 40%
- Cap LLM prompt to 15 candidates max
- `onProgress`/`onStatus` callbacks optional, used by UI

## Edge Cases

1. Changed file not in descriptor → analyze on-the-fly
2. No test files indexed → return empty with message
3. LLM returns garbage → use Phase 1 scores only
4. Only test files changed → suggest the changed tests themselves
5. >20 changed files → batch into groups of 5 for LLM
