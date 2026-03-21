# Part 1: Project Foundation

> **Prerequisite**: Read `00-base-context.md` first.

## Scope

Set up the project skeleton: `package.json`, `tsconfig.json`, shared types, and configuration loader. This is the foundation everything else depends on.

## Files to Create

| File | Purpose |
|---|---|
| `package.json` | Project manifest with all dependencies |
| `tsconfig.json` | TypeScript configuration |
| `src/types.ts` | All shared interfaces (copy from base context) |
| `src/config.ts` | Configuration loader |

---

## Step-by-Step Instructions

### Step 1: Create `package.json`

```json
{
  "name": "suggestor",
  "version": "0.1.0",
  "description": "AI-powered test suggestion CLI",
  "type": "module",
  "bin": {
    "suggestor": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "start": "node dist/cli.js"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "ollama": "^0.5.12",
    "ink": "^5.1.0",
    "react": "^18.3.1",
    "glob": "^11.0.1",
    "p-limit": "^6.2.0",
    "cli-table3": "^0.6.5",
    "chalk": "^5.4.1"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "tsx": "^4.19.3",
    "@types/node": "^22.12.0",
    "@types/react": "^18.3.18"
  }
}
```

### Step 2: Create `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "context"]
}
```

### Step 3: Create `src/types.ts`

Copy **all** interfaces from the "Shared TypeScript Interfaces" section of `00-base-context.md` exactly as written.

### Step 4: Create `src/config.ts`

This module loads `.suggestorrc.json` from the project root, merging with defaults.

```typescript
// src/config.ts
import { readFile } from "fs/promises";
import { join } from "path";
import type { ISuggestorConfig } from "./types.js";
```

**Behavior:**
1. Export `DEFAULT_CONFIG` constant:
   ```typescript
   const DEFAULT_CONFIG: ISuggestorConfig = {
     model: "qwen2.5-coder:3b",
     testPatterns: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
     sourcePatterns: ["**/*.ts", "**/*.tsx"],
     ignorePatterns: ["node_modules", "dist", ".git", "context"],
     maxParallelAnalysis: 4,
     ollamaHost: "http://localhost:11434",
   };
   ```
2. Export `async function loadConfig(projectRoot: string): Promise<ISuggestorConfig>`
   - Try to read `.suggestorrc.json` from `projectRoot`
   - If exists: `JSON.parse()` → deep merge with `DEFAULT_CONFIG` (user values override defaults)
   - If not exists: return `DEFAULT_CONFIG`
   - On parse error: log warning, return `DEFAULT_CONFIG`
3. Export `async function writeDefaultConfig(projectRoot: string): Promise<void>`
   - Write `DEFAULT_CONFIG` to `.suggestorrc.json` with `JSON.stringify(config, null, 2)`
   - Only write if file doesn't already exist

---

## Guidelines

- All exports must be named exports (no default exports)
- Use `import type` for type-only imports
- Config loader must be defensive — never crash on malformed `.suggestorrc.json`
- Deep merge means: if user provides `{ model: "codellama:7b" }`, all other fields get defaults

## Expected Output

After this part is done, running `npm install` should succeed and `tsc --noEmit` should pass with zero errors.

## Verification

```bash
pnpm install
npx tsc --noEmit   # Should pass with no errors
```
