import { execFile } from "child_process";
import * as fs from "fs/promises";
import { promisify } from "util";

import { Ollama } from "ollama";
// pLimit retained as dependency for potential single-pair fallback
// import pLimit from "p-limit";

import { IFileEntry } from "@/types/registry";

import { buildSourcePayload, buildTestPayload } from "./test-payload";

const execFileP = promisify(execFile);

// ─── Sampling defaults ────────────────────────────────────────────
const SAMPLE_SEGMENTS = 8;
const SAMPLE_LINES_PER_WINDOW = 30;
const MAX_IDENTITY_CHARS = 400;

/**
 * Controls how file content is prepared before being sent to the LLM.
 * All fields are configurable via `IRerankerConfig.fileContent`.
 */
export interface IFileContentConfig {
  /** Number of equal-width regions to sample from. Default: 8 */
  segments: number;
  /** Lines to capture per region. Default: 30 */
  linesPerWindow: number;
  /**
   * JS/TS keyword tokens stripped from each line before sending.
   * Reduces boilerplate noise while preserving identifiers and structure.
   * Set to [] to disable filtering entirely.
   */
  stripKeywords: string[];
}

export const DEFAULT_FILE_CONTENT_CONFIG: IFileContentConfig = {
  segments: SAMPLE_SEGMENTS,
  linesPerWindow: SAMPLE_LINES_PER_WINDOW,
  stripKeywords: [
    // ── Variable / module declarations ──────────────────────────────
    "const",
    "let",
    "var",
    "function",
    "import",
    "export",
    "default",
    "from",
    "require",
    // ── Async ────────────────────────────────────────────────────────
    "async",
    "await",
    // ── Class / OOP ──────────────────────────────────────────────────
    "class",
    "extends",
    "super",
    "new",
    "this",
    "static",
    "abstract",
    "override",
    // ── Access modifiers (TS) ────────────────────────────────────────
    "public",
    "private",
    "protected",
    "readonly",
    // ── TypeScript structural ────────────────────────────────────────
    "type",
    "interface",
    "enum",
    "namespace",
    "module",
    "declare",
    "implements",
    "infer",
    "keyof",
    "as",
    "is",
    "satisfies",
    // ── Return / yield / throw ───────────────────────────────────────
    "return",
    "yield",
    "throw",
    // ── Misc operators ───────────────────────────────────────────────
    "typeof",
    "instanceof",
    "void",
    "delete",
    "in",
    "of",
  ],
};

export interface IOllamaRerankerConfig {
  model: string;
  host: string;
  /** Max parallel Ollama calls. Keep low — local LLMs are GPU-bound. */
  concurrency: number;
  debug?: boolean;
  fileContent?: Partial<IFileContentConfig>;
  /** Base git ref for diff extraction. Default: HEAD~1 */
  base?: string;
  /** Target git ref for diff extraction. Default: HEAD */
  target?: string;
}

export const DEFAULT_OLLAMA_CONFIG: IOllamaRerankerConfig = {
  model: "qwen3.5:latest",
  host: "http://localhost:11434",
  concurrency: 2,
};

export interface IOllamaRerankResult {
  testFile: string;
  relevant: boolean;
  reason: string;
}

// ─── Symbol compression ───────────────────────────────────────────
//
// Long selector strings like `transaction-list-filter-date-range-button`
// consume many tokens for little LLM value. Replace them with short IDs
// (S1, S2, …) and pass a legend so the model can still reason about them.
// Also compresses long route patterns (R1, R2, …).

interface ISymbolTable {
  compressedBlocks: string[];
  legend: string;
}

function compressSymbols(blocks: string[]): ISymbolTable {
  const selectorMap = new Map<string, string>();
  const routeMap = new Map<string, string>();
  let sCount = 1;
  let rCount = 1;

  // Replace data-testid / data-test values with S1, S2, …
  const selectorPattern = /(data-test(?:id)?=["'])([^"']+)(["'])/g;
  // Replace long route-like segments (e.g. /api/some/long/path) with R1, R2, …
  const routePattern = /(\/[a-z0-9_-]{4,}(?:\/[a-z0-9_-]{3,}){2,})/g;

  const compressedBlocks = blocks.map((block) => {
    let out = block.replace(selectorPattern, (_, open, value, close) => {
      if (!selectorMap.has(value)) selectorMap.set(value, `S${sCount++}`);
      return `${open}${selectorMap.get(value)}${close}`;
    });
    out = out.replace(routePattern, (_, route) => {
      if (!routeMap.has(route)) routeMap.set(route, `R${rCount++}`);
      return routeMap.get(route)!;
    });
    return out;
  });

  const parts: string[] = [];
  if (selectorMap.size) {
    parts.push(`Selectors: ${[...selectorMap.entries()].map(([v, k]) => `${k}=${v}`).join(", ")}`);
  }
  if (routeMap.size) {
    parts.push(`Routes: ${[...routeMap.entries()].map(([v, k]) => `${k}=${v}`).join(", ")}`);
  }

  return { compressedBlocks, legend: parts.join(" | ") };
}

// ─── Prompt ──────────────────────────────────────────────────────

/**
 * Build a stable byte-identical prefix shared across every test call for a
 * given source file. Ollama reuses the KV cache when a new prompt starts with
 * the same bytes as a prior one, so this prefix is prefilled ONCE per file —
 * subsequent test calls skip straight to the test-specific portion.
 *
 * NOTE: symbol compression is applied to the source alone. Compressing source
 * + test together would leak test-specific selectors into the prefix legend
 * and break KV reuse. Token savings from cross-block dedup are minor; prefix
 * stability matters more.
 */
function buildKVPrefix(sourceBlock: string): string {
  const { compressedBlocks, legend } = compressSymbols([sourceBlock]);
  const compSource = compressedBlocks[0];
  const legendSection = legend ? `\nSymbol legend — ${legend}\n` : "";

  return `You are a senior developer deciding which tests could break after a code change.

Read the source file carefully. Understand what it does — its logic, state management, data transformations, side effects, UI behavior, and the contract it exposes to consumers.

Then read the candidate test. Decide: if a bug were introduced in the source file, would this test have any chance of catching it?
${legendSection}
SOURCE FILE (changed):
${compSource}

CANDIDATE TEST:
`;
}

function buildKVSuffix(testBlock: string): string {
  return `${testBlock}

A test is relevant if its assertions have any behavioral dependency on the source file, even indirectly (through a parent component, a shared hook, a util, or an API layer). A test is NOT relevant only if its assertions have zero behavioral dependency on the source file.

Reply in JSON only — no markdown, no text outside the JSON object.
Keep "reason" to ONE short sentence, max 80 characters:
{"relevant": true|false, "reason": "one short sentence"}`;
}

// JSON schema enforced by Ollama's structured-output mode. The llama.cpp
// grammar backing this respects `maxLength`, so the model is forced to stop
// well before the current ~250-char reason outputs. Verdict bit emits first,
// so truncating the prose doesn't change the decision.
const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    relevant: { type: "boolean" },
    reason: { type: "string", maxLength: 80 },
  },
  required: ["relevant", "reason"],
} as const;

/**
 * Returns a stratified line-based sample of `content`.
 * If the file fits within `segments × linesPerWindow` lines it is returned as-is.
 * Gaps are annotated so the LLM knows lines were skipped.
 */
function stratifiedSampleLines(content: string, config: IFileContentConfig): string {
  const lines = content.split("\n");
  const { segments, linesPerWindow } = config;

  if (lines.length <= segments * linesPerWindow) return content;

  const step = lines.length / segments;
  const parts: string[] = [];
  let prevEnd = 0;

  for (let i = 0; i < segments; i++) {
    const targetStart =
      i === segments - 1
        ? Math.max(0, lines.length - linesPerWindow) // last segment covers file end
        : Math.floor(step * i);

    const start = Math.max(targetStart, prevEnd); // never go backwards
    if (start >= lines.length) break;

    const end = Math.min(start + linesPerWindow, lines.length);

    if (parts.length > 0 && start > prevEnd) {
      parts.push(`// ··· ${start - prevEnd} lines skipped ···`);
    }

    parts.push(lines.slice(start, end).join("\n"));
    prevEnd = end;
  }

  return parts.join("\n");
}

// ─── Source payload: adaptive ─────────────────────────────────────
//
// Strategy:
//   1. Try git diff (--unified=8 for generous context around each hunk).
//      If a real diff exists → prepend a compact identity line then attach the diff.
//      The LLM sees exactly what changed AND recognises the file's role from the header.
//   2. If no diff (untracked file, --files flag without git context, etc.) →
//      read the actual file from disk. Strip the import block (noise) and truncate.
//   3. If file unreadable → fall back to the registry metadata summary.

function buildCompactIdentity(entry: IFileEntry): string {
  const parts: string[] = [`File: ${entry.path}`];
  if (entry.exports.length) {
    parts.push(`Exports: ${entry.exports.slice(0, 10).join(", ")}`);
  }
  if (entry.selectors?.length) {
    const sels = entry.selectors
      .map((s) => s.value)
      .filter(Boolean)
      .slice(0, 10)
      .join(", ");
    if (sels) parts.push(`Selectors: ${sels}`);
  }
  if (entry.routesDefined?.length) {
    const routes = entry.routesDefined
      .map((r) => r.path)
      .filter(Boolean)
      .slice(0, 8)
      .join(", ");
    if (routes) parts.push(`Routes: ${routes}`);
  }
  return parts.join("\n").slice(0, MAX_IDENTITY_CHARS);
}

/**
 * Strip the leading import block from a source file so the LLM sees
 * the implementation body first, not 30 lines of import statements.
 * Keeps the first import line for module-identity context.
 */
function stripImports(content: string): string {
  const lines = content.split("\n");
  let firstImport = -1;
  let lastImport = -1;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("import ") || t.startsWith("// import") || t === "") {
      if (firstImport === -1 && t.startsWith("import ")) firstImport = i;
      if (t.startsWith("import ")) lastImport = i;
    } else if (firstImport !== -1) {
      // First non-import, non-blank line after imports → stop
      break;
    }
  }

  if (firstImport === -1) return content; // no imports found

  // Keep one representative import line, skip the rest
  const kept =
    firstImport !== lastImport
      ? [`${lines[firstImport]} … (${lastImport - firstImport} more imports)`, ""]
      : [lines[firstImport], ""];
  const body = lines.slice(lastImport + 1);
  return [...kept, ...body].join("\n");
}

async function buildAdaptiveSourcePayload(
  entry: IFileEntry,
  changedFile: string,
  fileContentConfig: IFileContentConfig,
  base?: string,
  target?: string,
): Promise<string> {
  const identity = buildCompactIdentity(entry);
  const baseRef = base ?? "HEAD~1";
  const targetRef = target ?? "HEAD";

  // 1. Try git diff with generous unified context.
  //    Diff is already targeted — no keyword stripping needed (LLMs read code natively).
  try {
    const { stdout } = await execFileP(
      "git",
      ["diff", "--unified=8", `${baseRef}..${targetRef}`, "--", changedFile],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 },
    );
    if (stdout.trim().length > 30) {
      return `${identity}\n\nWhat changed:\n${stdout}`;
    }
  } catch {
    // git unavailable or no diff — fall through
  }

  // 2. No diff — read file, strip imports, stratified sample.
  //    No keyword filtering — LLMs understand code structure natively,
  //    and aggressive stripping can gut React components to empty strings.
  try {
    const raw = await fs.readFile(changedFile, "utf-8");
    const body = stripImports(raw);
    const sampled = stratifiedSampleLines(body, fileContentConfig);
    return `${identity}\n\nFile content:\n${sampled}`;
  } catch {
    // 3. File unreadable — fall back to registry metadata
    return buildSourcePayload(entry);
  }
}

// ─── Reranker ─────────────────────────────────────────────────────

/**
 * Local LLM reranker via Ollama.
 *
 * Source side  — adaptive:
 *   git diff (--unified=8) if available → shows exactly what changed.
 *   Full file content (imports stripped) if no diff.
 *   Always prepended with a compact identity header (path, exports, selectors).
 *
 * Test side  — raw file:
 *   Actual Cypress file content, truncated to MAX_TEST_CHARS.
 *   A code-aware model reads `cy.get`, `cy.intercept`, describe/it natively.
 *   Falls back to registry metadata if the file can't be read.
 *
 * All pairs scored with temperature=0 for deterministic output.
 * Results cached externally in `.pelican/pelican.lock`.
 */
export class OllamaReranker {
  private ollama: Ollama;
  private config: IOllamaRerankerConfig;
  private _available: boolean | null = null;
  // Test blocks are read + sampled once per testFile and reused across every
  // source file that scores against them. Cache is keyed by absolute path.
  private testBlockCache = new Map<string, string>();

  constructor(config: Partial<IOllamaRerankerConfig> = {}) {
    this.config = { ...DEFAULT_OLLAMA_CONFIG, ...config };
    this.ollama = new Ollama({ host: this.config.host });
  }

  async checkAvailable(): Promise<boolean> {
    try {
      await this.ollama.show({ model: this.config.model });
      this._available = true;
      return true;
    } catch {
      this._available = false;
      return false;
    }
  }

  isAvailable(): boolean {
    return this._available === true;
  }

  get model(): string {
    return this.config.model;
  }

  async rerankPairs(
    sourceEntry: IFileEntry,
    changedFile: string,
    testEntries: Array<{ testFile: string; entry: IFileEntry | undefined }>,
    onPairScored?: (scored: number, total: number) => void,
  ): Promise<IOllamaRerankResult[]> {
    const fileContentConfig: IFileContentConfig = {
      ...DEFAULT_FILE_CONTENT_CONFIG,
      ...this.config.fileContent,
    };

    // Build source payload once — shared across all test pairs for this file
    const sourceBlock = await buildAdaptiveSourcePayload(
      sourceEntry,
      changedFile,
      fileContentConfig,
      this.config.base,
      this.config.target,
    );

    if (this.config.debug) {
      process.stderr.write(
        `[ollama] source block (${sourceBlock.length} chars):\n${sourceBlock.slice(0, 300)}\n...\n`,
      );
    }

    // Build all test blocks upfront
    const testBlocks: Array<{ id: number; testFile: string; block: string }> = [];
    for (let i = 0; i < testEntries.length; i++) {
      const { testFile, entry } = testEntries[i];
      const block = await this.buildTestBlock(testFile, entry, fileContentConfig);
      testBlocks.push({ id: i + 1, testFile, block });
      if (this.config.debug) {
        process.stderr.write(
          `[ollama] test block for ${testFile} (${block.length} chars):\n${block.slice(0, 200)}\n...\n`,
        );
      }
    }

    // Per-test serial calls with KV prefix reuse.
    // Every prompt begins with the same `buildKVPrefix(sourceBlock)` bytes,
    // so Ollama prefills the source ONCE and reuses the cached attention
    // state for each subsequent test — only the test-specific suffix is
    // prefilled per call.
    const prefix = buildKVPrefix(sourceBlock);
    const total = testBlocks.length;
    const allResults: IOllamaRerankResult[] = [];
    let scored = 0;
    const fileStart = Date.now();
    process.stderr.write(
      `[ollama-timing] file=${changedFile} tests=${total} prefix=${prefix.length}ch source=${sourceBlock.length}ch\n`,
    );

    for (let i = 0; i < total; i++) {
      const tb = testBlocks[i];
      const prompt = prefix + buildKVSuffix(tb.block);
      const callStart = Date.now();

      if (this.config.debug) {
        const debugFile = ".pelican/debug-rerank.log";
        const sep = "=".repeat(80);
        const logEntry = [
          `\n${sep}`,
          `[ollama] SCORING: ${changedFile} → ${tb.testFile} (${i + 1}/${total})`,
          `${sep}`,
          `── PROMPT (${prompt.length} chars, prefix ${prefix.length}) ──`,
          prompt.slice(0, 2000),
          prompt.length > 2000 ? `\n... (${prompt.length - 2000} chars truncated) ...` : "",
          `── END PROMPT ──\n`,
        ].join("\n");
        await fs.appendFile(debugFile, logEntry, "utf-8").catch(() => {});
      }

      try {
        const response = await this.ollama.generate({
          model: this.config.model,
          prompt,
          stream: false,
          think: false,
          keep_alive: -1,
          format: VERDICT_SCHEMA,
          options: { temperature: 0, num_predict: 96 },
        });
        const callMs = Date.now() - callStart;
        // `response` carries perf counters from Ollama in ns — convert to ms
        // so we can see prefill vs decode split per call.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = response as any;
        const promptEvalMs = r.prompt_eval_duration ? Math.round(r.prompt_eval_duration / 1e6) : -1;
        const evalMs = r.eval_duration ? Math.round(r.eval_duration / 1e6) : -1;
        const promptTokens = r.prompt_eval_count ?? -1;
        const outputTokens = r.eval_count ?? -1;
        process.stderr.write(
          `[ollama-timing] ${i + 1}/${total} ${tb.testFile} total=${callMs}ms prefill=${promptEvalMs}ms(${promptTokens}tok) decode=${evalMs}ms(${outputTokens}tok)\n`,
        );

        if (this.config.debug) {
          const debugFile = ".pelican/debug-rerank.log";
          const logEntry = [`── RAW RESPONSE ──`, response.response, `── END RESPONSE ──`, ``].join(
            "\n",
          );
          await fs.appendFile(debugFile, logEntry, "utf-8").catch(() => {});
        }

        const verdict = parseResponse(response.response);
        allResults.push({ testFile: tb.testFile, ...verdict });

        if (this.config.debug) {
          const summary = `[ollama] ${tb.testFile}: relevant=${verdict.relevant} — ${verdict.reason}\n`;
          await fs.appendFile(".pelican/debug-rerank.log", summary, "utf-8").catch(() => {});
          process.stderr.write(summary);
        }
      } catch (err) {
        if (this.config.debug) {
          process.stderr.write(`[ollama] scoring error for ${tb.testFile}: ${err}\n`);
        }
        allResults.push({
          testFile: tb.testFile,
          relevant: true,
          reason: "LLM unavailable; included as precaution.",
        });
      }

      scored += 1;
      onPairScored?.(scored, total);
    }

    process.stderr.write(
      `[ollama-timing] file=${changedFile} done total=${Date.now() - fileStart}ms tests=${total}\n`,
    );

    return allResults;
  }

  /**
   * Build test payload.
   *
   * Cypress tests → rich metadata from extractor (describes, its, selectors,
   * intercepts) is sufficient for LLM verdict.
   *
   * Non-Cypress tests (Jest/Vitest/Playwright) → read actual file from disk
   * because registry metadata is too sparse (only path + imports). The LLM
   * needs to see the test body to understand what it covers.
   */
  private async buildTestBlock(
    testFile: string,
    entry: IFileEntry | undefined,
    fileContentConfig: IFileContentConfig,
  ): Promise<string> {
    const cached = this.testBlockCache.get(testFile);
    if (cached) return cached;

    const block = await this.buildTestBlockUncached(testFile, entry, fileContentConfig);
    this.testBlockCache.set(testFile, block);
    return block;
  }

  private async buildTestBlockUncached(
    testFile: string,
    entry: IFileEntry | undefined,
    fileContentConfig: IFileContentConfig,
  ): Promise<string> {
    if (!entry) return `Test file: ${testFile}`;

    // Cypress tests have rich extracted metadata — use it directly
    const hasCypressData =
      entry.cypress &&
      (entry.cypress.describeBlocks.length > 0 ||
        entry.cypress.itBlocks.length > 0 ||
        entry.cypress.visitedRoutes.length > 0);
    if (hasCypressData) {
      return buildTestPayload(entry);
    }

    // Non-Cypress: read actual file content so LLM can see what's tested
    try {
      const raw = await fs.readFile(testFile, "utf-8");
      const sampled = stratifiedSampleLines(raw, fileContentConfig);
      const header = `Test file: ${testFile}`;
      const imports = entry.imports.length
        ? `Imports: ${entry.imports.slice(0, 15).join(", ")}`
        : "";
      return [header, imports, "", sampled].filter(Boolean).join("\n");
    } catch {
      return buildTestPayload(entry);
    }
  }

}

function parseResponse(text: string): { relevant: boolean; reason: string } {
  try {
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      // Accept partial shapes — small models (phi3, qwen2.5:3b) sometimes
      // omit `reason` or emit the key as a string instead of a boolean.
      const reason =
        typeof parsed.reason === "string" ? parsed.reason.trim() : "No reason provided.";
      if (typeof parsed.relevant === "boolean") {
        return { relevant: parsed.relevant, reason };
      }
      if (typeof parsed.relevant === "string") {
        return { relevant: /^(true|yes|1)$/i.test(parsed.relevant.trim()), reason };
      }
    }
  } catch {
    // fall through
  }
  // Ambiguous / malformed output: default to `relevant=true` so we do NOT
  // silently drop a candidate the structural scorer already flagged. Missing
  // a test is worse than including a borderline one — the user can always
  // `--min-confidence` upward. Matches the error-branch policy in `scoreOne`.
  const looksFalse = /"relevant"\s*:\s*false\b/i.test(text) || /\bfalse\b/.test(text.slice(0, 80));
  return {
    relevant: !looksFalse,
    reason: "Model response could not be parsed; included as precaution.",
  };
}

