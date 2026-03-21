# Part 2: Store Layer

> **Prerequisite**: Read `00-base-context.md` first.

## Scope

Create the descriptor store — a class-based read/write layer for `descriptor.json`. This acts as the "agent map" that stores all indexed file metadata.

## Files to Create

| File | Purpose |
|---|---|
| `src/store/descriptor.ts` | `DescriptorStore` class for CRUD operations |

## Dependencies on Other Parts

- **Part 1** (types): Uses `IDescriptor`, `IFileEntry` from `src/types.ts`
- No other dependencies

---

## Step-by-Step Instructions

### Step 1: Create `src/store/descriptor.ts`

Implement the `DescriptorStore` class.

```typescript
import { readFile, writeFile, rename } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { IDescriptor, IFileEntry } from "../types.js";
```

### Step 2: Implement `DescriptorStore` Class

#### Properties:
- `private projectRoot: string`
- `private descriptor: IDescriptor | null = null`

#### Methods to Implement:

#### `constructor(projectRoot: string)`
- Save `projectRoot`.

#### `async load(): Promise<IDescriptor>`
- Read `descriptor.json` from `projectRoot`.
- If file doesn't exist: return `{ sha: "", files: [] }`.
- Parse JSON, validate it has `sha` and `files` fields.
- Store results in `this.descriptor`.

#### `async save(descriptor?: IDescriptor): Promise<void>`
- Use `descriptor` if provided, otherwise use `this.descriptor`.
- Write to `descriptor.json` with `JSON.stringify` + trailing newline.
- **Atomic write**: Write to `.descriptor.json.tmp` first, then `rename` to `descriptor.json`.

#### `async init(): Promise<void>`
- Create empty `descriptor.json` with `{ sha: "", files: [] }` if it doesn't exist.

#### `getFileEntry(filePath: string): IFileEntry | undefined`
- Find entry in `this.descriptor.files` where `name === filePath`.

#### `upsertFileEntry(entry: IFileEntry): void`
- Update existing or append new entry to `this.descriptor.files`.

#### `removeFileEntry(filePath: string): void`
- Remove entry with matching `name` from `this.descriptor.files`.

#### `getTestFiles(): IFileEntry[]`
- Return all entries where `type === "test"`.

#### `getSourceFiles(): IFileEntry[]`
- Return all entries where `type === "source"`.

#### `findByKeywords(keywords: string[]): IFileEntry[]`
- Find matching entries sorted by number of overlapping keywords (descending).

---

## Guidelines

- **Encapsulation**: The class should manage the internal state of the descriptor after loading.
- **Atomic writes**: Always use the tmp file pattern to prevent data loss.
- **Case-insensitivity**: Keyword searches must be case-insensitive.
- **Lowercase keywords**: All stored keywords should be normalized to lowercase.

## Verification

```typescript
const store = new DescriptorStore(process.cwd());
await store.load();
store.upsertFileEntry({
  name: "src/foo.ts",
  description: "Foo",
  keywords: ["foo"],
  components: ["Foo"],
  type: "source"
});
await store.save();
```
