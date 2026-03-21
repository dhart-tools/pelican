# Part 5: LLM Integration (OllamaService + PromptLoader)

> **Prerequisite**: Read `00-base-context.md` first.

## Scope

Ollama client wrapper and prompt template system. This handles all communication with the local LLM.

## Files to Create

| File | Purpose |
|---|---|
| `src/llm/ollama.ts` | Ollama client (connection, model management, generation) |
| `src/llm/prompts.ts` | Prompt template loader with variable interpolation |
| `prompts/analyze.md` | Template for file analysis |
| `prompts/suggest.md` | Template for test suggestion |

## Dependencies on Other Parts

- **Part 1** (types): Uses `ILLMAnalysisResult`, `ISuggestionResult` from `src/types.ts`
- Uses `ollama` npm package
- No other part dependencies

---

## Step-by-Step Instructions

### Step 1: Create `src/llm/ollama.ts`

```typescript
import { Ollama } from "ollama";
import type { ILLMAnalysisResult, ISuggestionResult } from "../types.js";
```

### Step 2: Implement Ollama client functions

#### `export function createClient(host: string): Ollama`
- Return `new Ollama({ host })`

#### `export async function checkConnection(client: Ollama): Promise<boolean>`
- Try `await client.list()`
- Return `true` if successful, `false` on network error
- Do NOT throw — return boolean

#### `export async function pullModel(client: Ollama, model: string, onProgress?: (progress: { status: string; completed?: number; total?: number }) => void): Promise<void>`
- Use `client.pull({ model, stream: true })`
- Iterate over the async stream
- For each chunk, call `onProgress` with status, completed bytes, total bytes
- The progress callback is used by the UI to show a progress bar

#### `export async function isModelAvailable(client: Ollama, model: string): Promise<boolean>`
- `client.list()` → check if model name is in the list
- Return boolean

#### `export async function generate(client: Ollama, model: string, prompt: string): Promise<string>`
- `client.generate({ model, prompt, stream: false })`
- Return `response.response` (the text content)
- Set `options: { temperature: 0.1 }` for deterministic output

#### `export async function generateJSON<T>(client: Ollama, model: string, prompt: string): Promise<T>`
- Call `generate()` to get raw text
- Extract JSON from the response:
  1. Try `JSON.parse(raw)` directly
  2. If fails: look for ```json ... ``` block and parse content
  3. If fails: look for `{` ... `}` or `[` ... `]` and try parsing that
  4. If all fail: throw `"Failed to parse JSON from LLM response"`
- Return parsed result typed as `T`

---

### Step 3: Create `src/llm/prompts.ts`

```typescript
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
```

#### `export async function loadPrompt(promptName: string, variables: Record<string, string>): Promise<string>`
- Compute prompts directory: relative to this file, `../../prompts/`
- Read `${promptName}.md`
- Replace all `{{variableName}}` placeholders with values from `variables`
- Return the interpolated prompt string
- Throw if prompt file not found: `"Prompt template not found: ${promptName}.md"`

---

### Step 4: Create `prompts/analyze.md`

```markdown
You are a code analysis assistant. Analyze the following source code file and extract metadata.

**File path:** {{filePath}}

**File content:**
```
{{fileContent}}
```

Respond with a JSON object containing:
- `description`: A concise 1-2 sentence description of what this file does
- `keywords`: An array of semantic keywords describing the domain concepts, patterns, and responsibilities in this file. Include both specific technical terms and broader domain concepts. Aim for 5-15 keywords.
- `components`: An array of the main classes, functions, or modules defined in this file
- `type`: Either "source" or "test" based on whether this is a test file

Respond ONLY with the JSON object, no explanation:
```

### Step 5: Create `prompts/suggest.md`

```markdown
You are a test suggestion assistant. Given a list of changed source files and a list of candidate test files, determine which test files are most relevant to the changes.

**Changed files:**
{{changedFiles}}

**Candidate test files:**
{{candidateTests}}

For each relevant test file, provide:
- `testFile`: The file path
- `confidence`: A score from 0 to 1 indicating how likely this test is affected
- `reason`: A brief explanation of why this test is relevant

Respond ONLY with a JSON array of objects, ordered by confidence (highest first). Only include tests with confidence > 0.3:
```

---

## Guidelines

- **Temperature 0.1**: Keep LLM output deterministic and focused
- **JSON extraction is robust**: The LLM may wrap JSON in markdown code blocks — handle this
- **Timeouts**: The `ollama` package handles timeouts internally, but if generation takes > 60s, something is wrong
- **Stream for pull only**: Use streaming for `pullModel` (progress tracking), non-streaming for `generate` (simpler)
- **Prompt templates are versioned**: They live in `prompts/` directory as `.md` files so they're trackable in git

## Edge Cases to Handle

1.  **Ollama not running** → `checkConnection` returns `false`, caller shows helpful error
2.  **Model not found** → `pullModel` will start downloading; `isModelAvailable` returns `false`
3.  **LLM returns invalid JSON** → `generateJSON` tries 3 extraction strategies before throwing
4.  **LLM returns empty response** → throw `"Empty response from LLM"`
5.  **Very large files** → truncate `fileContent` in prompts to first 200 lines to stay within context window
6.  **Prompt file not found** → throw descriptive error with correct path

## Verification

```typescript
const client = createClient("http://localhost:11434");
const connected = await checkConnection(client);
// Should return true if Ollama is running

const prompt = await loadPrompt("analyze", {
  filePath: "src/foo.ts",
  fileContent: "export class Foo { bar() {} }"
});
// Should contain the file content interpolated into the template

const result = await generateJSON<ILLMAnalysisResult>(client, "qwen2.5-coder:3b", prompt);
// Should return { description: "...", keywords: [...], components: [...], type: "source" }
```
