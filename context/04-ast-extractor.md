# Part 4: AST Extractor

> **Prerequisite**: Read `00-base-context.md` first.

## Scope

Extract structural keywords from TypeScript files using the TypeScript Compiler API. This provides **deterministic, instant** keyword extraction as the reliable backbone of the hybrid approach.

## Files to Create

| File | Purpose |
|---|---|
| `src/core/ast-extractor.ts` | TS compiler API keyword extraction |

## Dependencies on Other Parts

- **Part 1** (types): Uses `IASTExtractionResult` from `src/types.ts`
- Uses the `typescript` package (already a dev dependency)
- No other part dependencies

---

## Step-by-Step Instructions

### Step 1: Create `src/core/ast-extractor.ts`

```typescript
import ts from "typescript";
import { readFile } from "fs/promises";
import type { IASTExtractionResult } from "../types.js";
```

### Step 2: Implement the main extraction function

#### `export async function extractFromFile(filePath: string): Promise<IASTExtractionResult>`

1. Read the file content via `fs/promises`
2. Create a source file: `ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)`
3. Walk the AST and collect:
   - **Exports**: Any node with `export` modifier — get the name
   - **Classes**: `ts.isClassDeclaration(node)` → `node.name?.text`
   - **Functions**: `ts.isFunctionDeclaration(node)` → `node.name?.text`
   - **Interfaces**: `ts.isInterfaceDeclaration(node)` or `ts.isTypeAliasDeclaration(node)` → `node.name.text`
   - **Imports**: `ts.isImportDeclaration(node)` → extract the module specifier string
4. Return `{ exports, classes, functions, interfaces, imports }`

### Step 3: Implement the AST walker

#### `function walk(node: ts.Node, result: IASTExtractionResult): void`

Use recursive descent:

```typescript
function walk(node: ts.Node, result: IASTExtractionResult): void {
  // Check for exported declarations
  const isExported = node.modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword
  );

  if (ts.isClassDeclaration(node) && node.name) {
    result.classes.push(node.name.text);
    if (isExported) result.exports.push(node.name.text);
  }

  if (ts.isFunctionDeclaration(node) && node.name) {
    result.functions.push(node.name.text);
    if (isExported) result.exports.push(node.name.text);
  }

  if (ts.isInterfaceDeclaration(node)) {
    result.interfaces.push(node.name.text);
    if (isExported) result.exports.push(node.name.text);
  }

  if (ts.isTypeAliasDeclaration(node)) {
    result.interfaces.push(node.name.text);
    if (isExported) result.exports.push(node.name.text);
  }

  if (ts.isVariableStatement(node) && isExported) {
    node.declarationList.declarations.forEach((decl) => {
      if (ts.isIdentifier(decl.name)) {
        result.exports.push(decl.name.text);
      }
    });
  }

  if (ts.isImportDeclaration(node)) {
    const moduleSpecifier = node.moduleSpecifier;
    if (ts.isStringLiteral(moduleSpecifier)) {
      result.imports.push(moduleSpecifier.text);
    }
  }

  ts.forEachChild(node, (child) => walk(child, result));
}
```

### Step 4: Implement keyword conversion

#### `export function astResultToKeywords(result: IASTExtractionResult): string[]`

Convert AST results into normalized keywords:

1. Collect all names: `[...result.exports, ...result.classes, ...result.functions, ...result.interfaces]`
2. For each name, also split camelCase/PascalCase into constituent words:
   - `"DeviceManager"` → `["DeviceManager", "device", "manager"]`
   - `"handleUserLogin"` → `["handleUserLogin", "handle", "user", "login"]`
3. Lowercase all keywords
4. Deduplicate
5. Filter out common noise: `["the", "a", "an", "is", "get", "set", "has", "to", "from", "with", "for", "of", "in", "on", "at", "by"]`

### Step 5: Implement camelCase splitter utility

#### `function splitCamelCase(name: string): string[]`

```typescript
function splitCamelCase(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1);
}
```

### Step 6: Implement file type detection

#### `export function detectFileType(filePath: string): "source" | "test"`

- If path matches any of these patterns → `"test"`:
  - `*.test.ts`, `*.test.tsx`
  - `*.spec.ts`, `*.spec.tsx`
  - Inside `__tests__/` directory
  - Inside `tests/` directory at project root
- Otherwise → `"source"`

---

## Guidelines

- **No TypeScript `program` creation**: Use `ts.createSourceFile()` only (single-file parsing). Do NOT create a `ts.Program` — it's much slower and unnecessary for syntactic extraction
- **Handle parse errors gracefully**: If a file has syntax errors, the TS parser may still return a partial AST. Extract what you can, don't throw
- **Filter noise**: Common single-letter names (`a`, `b`, `x`) and trivial words should be filtered from keywords
- **Performance**: This should process 100 files in under 1 second. It's pure parsing, no I/O except file reads

## Edge Cases to Handle

1. **Non-TypeScript files** → return empty result (don't crash)
2. **Empty files** → return empty result
3. **Files with only re-exports** (`export { x } from '...'`) → capture the exported names
4. **Arrow function exports** (`export const foo = () => {}`) → captured via `VariableStatement` handling
5. **Default exports** → capture if named (`export default class Foo`), skip if anonymous

## Verification

Given this input file:
```typescript
// src/deviceManager.ts
import { Connection } from "./connection";

export class DeviceManager {
  private pool: ConnectionPool;
  connect(device: Device): void {}
}

export interface DeviceConfig {
  timeout: number;
}

export function createDeviceGroup(name: string): DeviceGroup {}
```

Expected output:
```typescript
{
  exports: ["DeviceManager", "DeviceConfig", "createDeviceGroup"],
  classes: ["DeviceManager"],
  functions: ["createDeviceGroup"],
  interfaces: ["DeviceConfig"],
  imports: ["./connection"]
}

// astResultToKeywords → [
//   "devicemanager", "device", "manager",
//   "deviceconfig", "config",
//   "createdevicegroup", "create", "group"
// ]
```
