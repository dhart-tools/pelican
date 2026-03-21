# Part 3: Git Utilities (GitService)

> **Prerequisite**: Read `00-base-context.md` first.

## Scope

Git integration layer: SHA tracking for incremental indexing, diff utilities for change detection, and file content hashing. Implemented as a `GitService` class.

## Files to Create

| File | Purpose |
|---|---|
| `src/core/git.ts` | `GitService` class for git operations |

## Dependencies on Other Parts

- **Part 1** (types): Uses `IGitChanges` from `src/types.ts`
- No other dependencies.

---

## Step-by-Step Instructions

### Step 1: Create `src/core/git.ts`

Implement the `GitService` class.

```typescript
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import type { IGitChanges } from "../types.js";

const execFileAsync = promisify(execFile);
```

### Step 2: Implement `GitService` Class

#### Properties:
- `private cwd: string`

#### Methods:

#### `constructor(cwd: string)`
- Save `cwd`.

#### `private async execGit(args: string[]): Promise<string>`
- Run `git` with `args` in `this.cwd`.
- Return stdout trimmed.
- Throw descriptive errors if not a git repo or if command fails.

#### `async isGitRepo(): Promise<boolean>`
- `git rev-parse --is-inside-work-tree` → returns true if successful.

#### `async getCurrentSha(): Promise<string>`
- `git rev-parse HEAD`.

#### `async getChangedFilesSinceSha(sha: string): Promise<string[]>`
- If `sha` is empty → `git ls-files`.
- Else → `git diff --name-only --diff-filter=ACMR <sha> HEAD`.

#### `async getWorkingChanges(): Promise<IGitChanges>`
- Staged changes: `git diff --name-only --cached --diff-filter=ACMR`.
- Unstaged changes: `git diff --name-only --diff-filter=ACMR`.
- Return `{ staged, unstaged, all: deduplicatedUnion }`.

#### `async getFileDiff(filePath: string): Promise<string>`
- `git diff -- <filePath>`.
- Fallbacks: `--cached` for staged-only, then full file content for untracked.

#### `async getFileContentSha(filePath: string): Promise<string>`
- SHA256 of file content (slice to 12 chars).

#### `async getAllTrackedFiles(): Promise<string[]>`
- `git ls-files`.

---

## Guidelines

- **Safety**: Always use `execFile` (not `exec`) to prevent shell injection.
- **Error Handling**: Provide human-readable errors for "not a git repo" or "no commits".
- **Performance**: Git commands are fast, but avoid redundant calls by caching SHA when appropriate in caller.

## Verification

```typescript
const git = new GitService(process.cwd());
const sha = await git.getCurrentSha();
const changes = await git.getWorkingChanges();
```
