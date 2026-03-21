# Part 8: Commands & CLI Entry Point

> **Prerequisite**: Read `00-base-context.md` first.

## Scope

The orchestration layer — wire everything together. Three command implementations and the CLI entry point. **This part depends on ALL other parts being complete.**

## Files to Create

| File | Purpose |
|---|---|
| `src/commands/setup.ts` | `suggestor setup` command |
| `src/commands/index.ts` | `suggestor index` command |
| `src/commands/suggest.ts` | `suggestor suggest` command |
| `src/cli.ts` | Entry point, command routing with commander |

## Dependencies

**ALL parts**: This is the integration layer.
- Part 1: `loadConfig`, `writeDefaultConfig`, types
- Part 2: `DescriptorStore` class (load, save, init, upsert, find)
- Part 3: `GitService` class (getCurrentSha, getChangedFilesSinceSha, getWorkingChanges, isGitRepo)
- Part 4: (used indirectly via Part 7)
- Part 5: `createClient`, `checkConnection`, `pullModel`, `isModelAvailable`
- Part 6: `SetupView`, `IndexView`, `SuggestView`
- Part 7: `analyzeFiles`, `suggest`

---

## `src/commands/setup.ts`

```typescript
import React from "react";
import { render } from "ink";
import { createClient, checkConnection, pullModel, isModelAvailable } from "../llm/ollama.js";
import { DescriptorStore } from "../store/descriptor.js";
import { loadConfig, writeDefaultConfig } from "../config.js";
import { SetupView } from "../ui/components/SetupView.js";
```

### `export async function setupCommand(options: { light?: boolean }): Promise<void>`

**Flow:**
1. Load config (determine model, ollamaHost)
2. If `--light` flag → override model to `qwen2.5-coder:1.5b`
3. Render `SetupView` with ink
4. **Step 1**: Check Ollama connection → update step status
5. **Step 2**: Check if model exists → if not, pull with progress callback → update progress bar
6. **Step 3**: Init `descriptor.json` → update step status
7. **Step 4**: Write `.suggestorrc.json` if not found → update step status
8. All done → update all steps to success

**Error handling:**
- Ollama not running → show error with install instructions: `"Install Ollama from https://ollama.ai and run 'ollama serve'"`
- Model pull fails → show error with model name

---

## `src/commands/index.ts`

```typescript
import React from "react";
import { render } from "ink";
import { readFile } from "fs/promises";
import { glob } from "glob";
import { DescriptorStore } from "../store/descriptor.js";
import { GitService } from "../core/git.js";
import { analyzeFiles } from "../core/analyzer.js";
import { createClient } from "../llm/ollama.js";
import { loadConfig } from "../config.js";
import { IndexView } from "../ui/components/IndexView.js";
```

### `export async function indexCommand(): Promise<void>`

**Flow:**
1. Load config
2. Read current `descriptor.json` → get stored SHA
3. Get current HEAD SHA
4. Get changed files since stored SHA (or all files if first run)
5. Filter by `sourcePatterns` + `testPatterns`, exclude `ignorePatterns`
6. Read file contents for changed files
7. Render `IndexView` with ink
8. Run `analyzeFiles()` with progress callback → update UI
9. Upsert each result into descriptor
10. Update descriptor SHA to current HEAD
11. Write descriptor
12. Show summary: new, updated, total

**Edge cases:**
- No changes since last index → show "Already up to date"
- Not a git repo → show error
- Some files fail to analyze → skip them, show warning

---

## `src/commands/suggest.ts`

```typescript
import React from "react";
import { render } from "ink";
import { DescriptorStore } from "../store/descriptor.js";
import { GitService } from "../core/git.js";
import { analyzeFile } from "../core/analyzer.js";
import { suggest } from "../core/matcher.js";
import { createClient } from "../llm/ollama.js";
import { loadConfig } from "../config.js";
import { SuggestView } from "../ui/components/SuggestView.js";
import { readFile } from "fs/promises";
```

### `export async function suggestCommand(): Promise<void>`

**Flow:**
1. Load config
2. Get working changes (staged + unstaged) via git
3. If no changes → show "No changes detected"
4. Read descriptor
5. For each changed file:
   - If in descriptor → use cached `IFileEntry`
   - If not → quick `analyzeFile()` to get metadata
6. Render `SuggestView` with ink
7. Run `suggest()` (keyword funnel + semantic rank) with status callback
8. Display results table
9. Exit

---

## `src/cli.ts`

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { setupCommand } from "./commands/setup.js";
import { indexCommand } from "./commands/index.js";
import { suggestCommand } from "./commands/suggest.js";
```

### Implementation

```typescript
const program = new Command();

program
  .name("suggestor")
  .description("AI-powered test suggestion CLI")
  .version("0.1.0");

program
  .command("setup")
  .description("Set up Suggestor: pull LLM model and initialize project")
  .option("--light", "Use smaller model (1.5b) for faster setup")
  .action(async (options) => {
    try {
      await setupCommand(options);
    } catch (error) {
      console.error("Setup failed:", error);
      process.exit(1);
    }
  });

program
  .command("index")
  .description("Index source and test files for suggestion matching")
  .action(async () => {
    try {
      await indexCommand();
    } catch (error) {
      console.error("Indexing failed:", error);
      process.exit(1);
    }
  });

program
  .command("suggest")
  .description("Suggest relevant tests for current file changes")
  .action(async () => {
    try {
      await suggestCommand();
    } catch (error) {
      console.error("Suggestion failed:", error);
      process.exit(1);
    }
  });

program.parse();
```

**Critical:** First line must be `#!/usr/bin/env node` for the bin script to work.

---

## Guidelines

- Each command is a self-contained async function
- Commands handle their own ink rendering lifecycle (`render()` → update state → unmount)
- All errors are caught and displayed to the user with helpful messages
- Use `process.cwd()` as the project root for all file operations
- The CLI should feel responsive — show UI immediately, then populate with data

## How ink Rendering Works in Commands

```typescript
// Pattern for each command:
import { render } from "ink";
import React, { useState, useEffect } from "react";

function CommandApp() {
  const [status, setStatus] = useState("idle");
  // ... state management
  
  useEffect(() => {
    // Run the actual command logic here
    runLogic().then(() => setStatus("done"));
  }, []);
  
  return <SomeView status={status} /* ... */ />;
}

export async function someCommand() {
  const { waitUntilExit } = render(<CommandApp />);
  await waitUntilExit();
}
```

## Verification

```bash
pnpm build
pnpm dev setup     # Should pull model and init
pnpm dev index     # Should analyze files
# Make a file change...
pnpm dev suggest   # Should show relevant tests
```
