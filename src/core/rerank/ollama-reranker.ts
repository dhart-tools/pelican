import { execFile } from "child_process";
import * as fs from "fs/promises";
import { promisify } from "util";

import { Ollama } from "ollama";
import pLimit from "p-limit";

import { IFileEntry } from "@/types/registry";

import {
  buildSourceHeader,
  buildSourcePayload,
  buildTestHeader,
  buildTestPayload,
  classifyTest,
  detectSourceProvider,
  detectSourceUIKind,
} from "./test-payload";

const execFileP = promisify(execFile);

// ─── Sampling defaults ────────────────────────────────────────────
// Halved from 8×30 to 4×20. The LLM rarely needs 240 lines of the source
// file — a 4-window stratified sample (~80 lines) is enough to recognise
// the file's role when no diff is available, and cuts prefill tokens by
// ~3×.
const SAMPLE_SEGMENTS = 4;
const SAMPLE_LINES_PER_WINDOW = 20;
const MAX_IDENTITY_CHARS = 300;

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
  /**
   * When true, the LLM also returns a short explanation per test. When false
   * (default), only the boolean verdict is returned — much faster since decode
   * shrinks from ~25 tokens to ~3. The verdict itself is unchanged either way.
   */
  explanations?: boolean;
  /**
   * Verdict shape the LLM is asked to produce:
   *   'bucket' — discrete 0-5 confidence (reweights pelican prior; default)
   *   'bool'   — legacy yes/no verdict
   */
  scoringMode?: "bucket" | "bool";
  /**
   * When true (default), all surviving candidates for a given source file are
   * scored in a single listwise LLM call — one prefill of the source block
   * amortized across every test. When false, falls back to per-pair calls.
   */
  listwise?: boolean;
  /**
   * Hard cap for candidates packed into one listwise call. Anything larger is
   * split into overlapping windows. Default 16 — beyond this, prompts start
   * crowding model context and verdict quality drops.
   */
  listwiseWindow?: number;
}

export const DEFAULT_OLLAMA_CONFIG: IOllamaRerankerConfig = {
  model: "qwen3.5:latest",
  host: "http://localhost:11434",
  concurrency: 3,
  explanations: false,
  scoringMode: "bucket",
  // Listwise (one LLM call per source) is ~2× faster than per-pair but the
  // model loses per-candidate rigor when many tests share one prompt, so
  // false positives spike. Keep the per-pair path as default until we
  // distill a classifier that can match per-pair accuracy cheaply.
  listwise: false,
  listwiseWindow: 16,
};

export interface IOllamaRerankResult {
  testFile: string;
  relevant: boolean;
  reason: string;
  /**
   * Discrete 0-5 confidence bucket when the reranker runs in bucket mode:
   *   0 = reject, 1 = likely-no, 2 = unsure, 3 = likely-yes, 4 = yes, 5 = strong-yes.
   * LLMs produce calibrated 5-bucket labels far better than continuous 0-100
   * scores, so this gives the caller enough signal to reweight pelican's
   * prior (`final = pelican × multiplier[bucket]`) without the noise of
   * asking the model for arbitrary percentages. Undefined when the reranker
   * ran in legacy boolean mode.
   */
  bucket?: number;
}

/**
 * Bucket → multiplier for pelican score. Gentler than the original 0.3..1.6
 * spread: bucket 1 (likely-no) only halves the score instead of gutting it,
 * and bucket 4-5 give a modest lift. Rationale — pelican's structural score
 * is the stable anchor; the LLM's job is tilt, not overturn. The original
 * aggressive multiplier caused wild swings in the kept count because
 * bucket-1 and bucket-2 (the noisy buckets) were dragging borderline-real
 * matches under threshold.
 */
export const BUCKET_MULTIPLIER: readonly number[] = [0, 0.5, 0.85, 1.0, 1.15, 1.3];

/**
 * Buckets at or below this are treated as rejections. Set to 0 — only the
 * hard-no bucket drops a pair. Bucket 1 (likely-no) survives but gets
 * aggressive downweight (×0.3) which usually pushes it under the final
 * `threshold` anyway. Keeping it in the pipeline avoids silently deleting
 * borderline matches the LLM was merely unsure about.
 */
export const BUCKET_REJECT_MAX = 0;

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
interface ISourceRuleFlags {
  hasProvider: boolean;
  isOnboarding: boolean;
  hasRoutes: boolean;
  hasSelectors: boolean;
  hasReduxSurface: boolean;
  isUIComponent: boolean;
  hasBypassableFlow: boolean;
}

/**
 * Build the KV-reused prefix. Rules are injected conditionally based on
 * source-side signals — R3 (provider) and R4 (onboarding) only render when
 * the source file could plausibly trigger them. Shrinking the prefill is
 * the fastest lever: every skipped rule is ~30-40 tokens off every call
 * for this source file.
 */
function buildKVPrefix(sourceBlock: string, flags: ISourceRuleFlags): string {
  const { compressedBlocks, legend } = compressSymbols([sourceBlock]);
  const compSource = compressedBlocks[0];
  const legendSection = legend ? `\nLegend: ${legend}\n` : "";

  // Minimal rule set. We spent a week discovering that adding rules
  // (R5-R9, A4-A6) causes wild kept-count swings because LLMs apply
  // long rule lists inconsistently. Back to the proven 4+3 set, plus
  // R5 as the one structural impossibility we can't afford to miss
  // (Vitest/Jest tests vs React bundle).
  // Terse grammar. Every token saved here multiplies across every LLM call
  // for this source. The trailing "→ no" / "→ yes" is implicit from R/A
  // prefix and dropped. Connectives use & | instead of AND/OR.
  const hard: string[] = [
    "R1 it_count=0",
    "R2 kind=component & source ∉ mount_targets",
    "R5 test in src/__tests__/ & source=.tsx",
  ];
  if (flags.hasProvider) {
    hard.push("R3 source.provider ≠ test.provider/login_helper");
  }
  if (flags.isOnboarding) {
    hard.push(
      "R4 source=onboarding & seeded & no signup/signin/onboard/register in describes|visits",
    );
  }

  const accepts: string[] = [
    "A1 test imports source | source ∈ mount_targets",
    "A2 distinctive token (¬ app/page/container) overlap: source.exports/routes/selectors/UI ∩ test.describes/visits/text/APIs",
    "A3 source=machine/hook/reducer/util & domain word in test.describes/visits/imports",
  ];

  return `Task: TEST runs SOURCE code? R first (→ no, stop), else A (→ yes, stop), else no.
R: ${hard.join(" ; ")}
A: ${accepts.join(" ; ")}
${legendSection}SOURCE:
${compSource}

TEST:
`;
}

function buildKVSuffix(
  testBlock: string,
  withExplanation: boolean,
  mode: "bool" | "bucket",
): string {
  let trailer: string;
  if (mode === "bucket") {
    // 0 reserved for R-rule hits. 1-5 for graded confidence. Unsure → 2.
    const scale = "0=R-rule hit. 1=likely no. 2=unsure. 3=weak yes. 4=clear yes. 5=direct wire (A1).";
    trailer = withExplanation
      ? `${scale} JSON: {"score":0-5,"reason":"≤80 chars"}`
      : `${scale} JSON: {"score":0-5}`;
  } else {
    trailer = withExplanation
      ? `JSON: {"relevant":true|false,"reason":"≤80 chars"}`
      : `JSON: {"relevant":true|false}`;
  }

  return `${testBlock}\n${trailer}`;
}

// JSON schemas enforced by Ollama's structured-output mode. llama.cpp grammar
// forces the model to stop at `maxLength`. Verdict bit emits first, so cutting
// the prose can only change latency, not the decision.
const VERDICT_SCHEMA_WITH_REASON = {
  type: "object",
  properties: {
    relevant: { type: "boolean" },
    reason: { type: "string", maxLength: 80 },
  },
  required: ["relevant", "reason"],
} as const;

const VERDICT_SCHEMA_BOOL_ONLY = {
  type: "object",
  properties: {
    relevant: { type: "boolean" },
  },
  required: ["relevant"],
} as const;

// Bucket mode: single integer 0-5. `minimum`/`maximum` are enforced by
// Ollama's grammar — the model cannot emit out-of-range values.
const VERDICT_SCHEMA_BUCKET_ONLY = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 5 },
  },
  required: ["score"],
} as const;

const VERDICT_SCHEMA_BUCKET_WITH_REASON = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 5 },
    reason: { type: "string", maxLength: 80 },
  },
  required: ["score", "reason"],
} as const;

// Listwise schemas: JSON array, one entry per candidate. `i` preserves the
// 1-based index so parse can survive reordering or dropped items.
const LISTWISE_SCHEMA_BOOL_ONLY = {
  type: "array",
  items: {
    type: "object",
    properties: {
      i: { type: "integer" },
      r: { type: "boolean" },
    },
    required: ["i", "r"],
  },
} as const;

const LISTWISE_SCHEMA_WITH_REASON = {
  type: "array",
  items: {
    type: "object",
    properties: {
      i: { type: "integer" },
      r: { type: "boolean" },
      reason: { type: "string", maxLength: 80 },
    },
    required: ["i", "r", "reason"],
  },
} as const;

function buildListwisePrompt(
  sourceBlock: string,
  items: Array<{ i: number; block: string }>,
  withExplanation: boolean,
): string {
  const { compressedBlocks, legend } = compressSymbols([sourceBlock]);
  const compSource = compressedBlocks[0];
  const legendSection = legend ? `\nSymbol legend — ${legend}\n` : "";

  const candidateSection = items
    .map((it) => `[${it.i}]\n${it.block}`)
    .join("\n---\n");

  const trailer = withExplanation
    ? `Reply JSON array only — one entry per candidate, in order. Keep "reason" ≤ 80 chars:
[{"i":1,"r":true|false,"reason":"..."}, ...]`
    : `Reply JSON array only — one entry per candidate, in order:
[{"i":1,"r":true|false}, ...]`;

  return `Decide for EACH candidate test below: does it execute SOURCE's code at runtime? Walk R1→R6, then A1→A3 per candidate. Stop at first match. No match → false.

R1 STUB: test.it_count=0 → false.
R2 MOUNT MISMATCH: test.kind="component" AND source path/exports not in test.mount_targets → false.
R3 PROVIDER LOCK: source.provider set (okta|google|cognito|auth0|facebook) AND test.provider/login_helper not SAME provider → false.
R4 ONBOARDING SKIP: source path or exports mention onboarding/welcome/firstrun/signup-flow AND test.seeded=true AND test describes/visits don't mention signup|signin|onboarding|register → false.
R5 LAYER MISMATCH: test path matches src/__tests__/.*\.test\.(t|j)s$ (Jest backend unit test) AND source is a frontend bundle entry (index*.tsx|*.tsx component) → false. Those tests never execute frontend bundle code.
R6 UNRELATED CYPRESS SIBLING: source is a container/component AND test is a Cypress spec for a SIBLING container/component whose describes/visits/mount_targets don't reference source or anything source exports → false. Token overlap in filenames alone (e.g. "Transaction") is NOT enough.

A1 DIRECT WIRE: test imports source, OR test.mount_targets contains source or any name source exports → true.
A2 DOMAIN OVERLAP: source's exports/routes/selectors/JSX-text share DISTINCTIVE domain token (not generic like "app","container","page") with test's describes/visits/asserted-text/intercepted-APIs → true. Thin overlap → skip.
A3 INFRASTRUCTURE TRANSIT: source is machine/hook/container/context/reducer/slice/util with no direct UI AND source's domain keyword appears in test's describes/visits/imports, OR governs flow test clearly runs → true.
${legendSection}
SOURCE:
${compSource}

CANDIDATES:
${candidateSection}

Apply R1→R6 then A1→A3 per candidate. First match wins. No match → false.

${trailer}`;
}

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
  const header = buildSourceHeader(entry);
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
      return `${header}\n\n${identity}\n\nWhat changed:\n${stdout}`;
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
    return `${header}\n\n${identity}\n\nFile content:\n${sampled}`;
  } catch {
    // 3. File unreadable — fall back to registry metadata
    return `${header}\n\n${buildSourcePayload(entry)}`;
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

    // Build all test blocks upfront + collect pre-LLM stub rejections.
    const testBlocks: Array<{ id: number; testFile: string; block: string }> = [];
    const stubRejections: IOllamaRerankResult[] = [];
    for (let i = 0; i < testEntries.length; i++) {
      const { testFile, entry } = testEntries[i];

      // Cheap stub detection: if registry says zero it-blocks AND the file has
      // no test/describe call, there's nothing the LLM could sensibly keep.
      if (entry) {
        let rawForClassify: string | undefined;
        try {
          rawForClassify = await fs.readFile(testFile, "utf-8");
        } catch {
          rawForClassify = undefined;
        }
        const kind = classifyTest(entry, rawForClassify).kind;
        if (kind === "stub") {
          stubRejections.push({
            testFile,
            relevant: false,
            reason: "Stub — no test cases",
          });
          if (this.config.debug) {
            process.stderr.write(`[ollama] pre-reject stub: ${testFile}\n`);
          }
          continue;
        }
      }

      const block = await this.buildTestBlock(testFile, entry, fileContentConfig);
      testBlocks.push({ id: i + 1, testFile, block });
      if (this.config.debug) {
        process.stderr.write(
          `[ollama] test block for ${testFile} (${block.length} chars):\n${block.slice(0, 200)}\n...\n`,
        );
      }
    }

    const total = testBlocks.length;
    const allResults: IOllamaRerankResult[] = [];
    let scored = 0;
    const fileStart = Date.now();

    const withExplanation = this.config.explanations === true;

    // Listwise path: one LLM call per window of candidates, not per candidate.
    // Source prefill happens once per window (not per candidate), verdict
    // array returned in one decode. Huge latency win at equivalent accuracy.
    if (this.config.listwise !== false && testBlocks.length > 0) {
      const windowSize = this.config.listwiseWindow ?? DEFAULT_OLLAMA_CONFIG.listwiseWindow!;
      if (this.config.debug) {
        process.stderr.write(
          `[ollama-timing] file=${changedFile} LISTWISE tests=${total} window=${windowSize} source=${sourceBlock.length}ch\n`,
        );
      }
      const listResults = await this.scoreListwise(
        changedFile,
        sourceBlock,
        testBlocks,
        withExplanation,
        windowSize,
        (done) => {
          scored = done;
          onPairScored?.(scored, total);
        },
      );
      if (this.config.debug) {
        process.stderr.write(
          `[ollama-timing] file=${changedFile} done total=${Date.now() - fileStart}ms tests=${total}\n`,
        );
      }
      return [...listResults, ...stubRejections];
    }

    // Per-pair path (kept as fallback). Every prompt begins with the same
    // `buildKVPrefix(sourceBlock)` bytes so Ollama prefills the source once
    // and reuses the cached attention state across calls.
    const kind = detectSourceUIKind(sourceEntry);
    const hasRoutes = (sourceEntry.routesDefined?.length ?? 0) > 0;
    const hasSelectors = (sourceEntry.selectors?.length ?? 0) > 0;
    const hasReduxSurface =
      (sourceEntry.reduxUsage?.actionsDispatched?.length ?? 0) +
        (sourceEntry.reduxUsage?.slicesDefined?.length ?? 0) >
      0;
    const isUIComponent = kind === "component" || kind === "container" || kind === "entry";
    // Flows that have known Cypress bypass shortcuts in this repo class.
    // Conservative — if the source doesn't own one of these flows we skip R7
    // to keep the prefix lean.
    const bypassablePath = /onboard|signin|signup|login|new-?transaction|signout/i.test(
      `${sourceEntry.path} ${sourceEntry.exports.join(" ")}`,
    );
    const ruleFlags: ISourceRuleFlags = {
      hasProvider: detectSourceProvider(sourceEntry) !== undefined,
      isOnboarding: /onboard|welcome|firstrun|signup-flow/i.test(
        `${sourceEntry.path} ${sourceEntry.exports.join(" ")}`,
      ),
      hasRoutes,
      hasSelectors,
      hasReduxSurface,
      isUIComponent,
      hasBypassableFlow: bypassablePath,
    };
    const prefix = buildKVPrefix(sourceBlock, ruleFlags);
    if (this.config.debug) {
      process.stderr.write(
        `[ollama-timing] file=${changedFile} tests=${total} prefix=${prefix.length}ch source=${sourceBlock.length}ch\n`,
      );
    }

    const mode: "bool" | "bucket" = this.config.scoringMode ?? "bucket";
    const schema =
      mode === "bucket"
        ? withExplanation
          ? VERDICT_SCHEMA_BUCKET_WITH_REASON
          : VERDICT_SCHEMA_BUCKET_ONLY
        : withExplanation
          ? VERDICT_SCHEMA_WITH_REASON
          : VERDICT_SCHEMA_BOOL_ONLY;
    const numPredict = withExplanation ? 96 : 16;

    // Parallel per-pair calls. We trade KV-prefix reuse (~1s saved per
    // consecutive call on the same source) for N-way parallelism, which is a
    // net win as long as the Ollama server has `OLLAMA_NUM_PARALLEL >= N`
    // slots. If the server is single-slot the requests queue and we lose
    // nothing vs the old serial loop; if it batches, wallclock drops ~N×.
    const limit = pLimit(Math.max(1, this.config.concurrency));
    await Promise.all(
      testBlocks.map((tb, i) =>
        limit(async () => {
          const prompt = prefix + buildKVSuffix(tb.block, withExplanation, mode);
          const callStart = Date.now();

          if (this.config.debug) {
            const debugFile = ".pelican/debug-rerank.log";
            const sep = "=".repeat(80);
            const logEntry = [
              `\n${sep}`,
              `[ollama] SCORING: ${changedFile} → ${tb.testFile} (${i + 1}/${total})`,
              sep,
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
              format: schema,
              options: { temperature: 0, num_predict: numPredict },
            });
            const callMs = Date.now() - callStart;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const r = response as any;
            const promptEvalMs = r.prompt_eval_duration
              ? Math.round(r.prompt_eval_duration / 1e6)
              : -1;
            const evalMs = r.eval_duration ? Math.round(r.eval_duration / 1e6) : -1;
            const promptTokens = r.prompt_eval_count ?? -1;
            const outputTokens = r.eval_count ?? -1;
            if (this.config.debug) {
              process.stderr.write(
                `[ollama-timing] ${i + 1}/${total} ${tb.testFile} total=${callMs}ms prefill=${promptEvalMs}ms(${promptTokens}tok) decode=${evalMs}ms(${outputTokens}tok)\n`,
              );
              await fs
                .appendFile(
                  ".pelican/debug-rerank.log",
                  `── RAW RESPONSE ──\n${response.response}\n── END RESPONSE ──\n`,
                  "utf-8",
                )
                .catch(() => {});
            }

            const verdict =
              mode === "bucket"
                ? parseBucketResponse(response.response)
                : parseResponse(response.response);
            allResults.push({ testFile: tb.testFile, ...verdict });

            if (this.config.debug) {
              const bucketTag = "bucket" in verdict ? ` bucket=${verdict.bucket}` : "";
              const summary = `[ollama] ${tb.testFile}: relevant=${verdict.relevant}${bucketTag} — ${verdict.reason}\n`;
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
              ...(mode === "bucket" ? { bucket: 3 } : {}),
            });
          }

          scored += 1;
          onPairScored?.(scored, total);
        }),
      ),
    );

    if (this.config.debug) {
      process.stderr.write(
        `[ollama-timing] file=${changedFile} done total=${Date.now() - fileStart}ms tests=${total}\n`,
      );
    }

    return [...allResults, ...stubRejections];
  }

  /**
   * Score all candidate test blocks in a single LLM call (or a handful of
   * calls if the window has to split). Source prefill is paid once per window
   * instead of once per candidate — the big latency unlock over per-pair.
   *
   * Sliding window: if candidate count exceeds `windowSize`, split into
   * non-overlapping chunks. Verdicts merged in input order. Overlap isn't
   * needed because each candidate is evaluated independently; we're not
   * asking for a global ranking, just per-candidate relevance.
   */
  private async scoreListwise(
    changedFile: string,
    sourceBlock: string,
    testBlocks: Array<{ id: number; testFile: string; block: string }>,
    withExplanation: boolean,
    windowSize: number,
    onProgress: (done: number) => void,
  ): Promise<IOllamaRerankResult[]> {
    const out: IOllamaRerankResult[] = [];
    const schema = withExplanation ? LISTWISE_SCHEMA_WITH_REASON : LISTWISE_SCHEMA_BOOL_ONLY;
    let doneCount = 0;

    for (let w = 0; w < testBlocks.length; w += windowSize) {
      const window = testBlocks.slice(w, w + windowSize);
      const items = window.map((tb, localIdx) => ({ i: localIdx + 1, block: tb.block }));
      const prompt = buildListwisePrompt(sourceBlock, items, withExplanation);
      // ~20 tokens per verdict bool-only, ~60 with reason. Add padding.
      const perItem = withExplanation ? 60 : 20;
      const numPredict = Math.min(4096, items.length * perItem + 32);

      const callStart = Date.now();
      if (this.config.debug) {
        const debugFile = ".pelican/debug-rerank.log";
        const sep = "=".repeat(80);
        const logEntry = [
          `\n${sep}`,
          `[ollama] LISTWISE: ${changedFile} window=${w + 1}..${w + window.length}/${testBlocks.length}`,
          sep,
          `── PROMPT (${prompt.length} chars) ──`,
          prompt.slice(0, 3000),
          prompt.length > 3000 ? `\n... (${prompt.length - 3000} chars truncated) ...` : "",
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
          format: schema,
          options: { temperature: 0, num_predict: numPredict },
        });
        const callMs = Date.now() - callStart;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = response as any;
        const promptEvalMs = r.prompt_eval_duration ? Math.round(r.prompt_eval_duration / 1e6) : -1;
        const evalMs = r.eval_duration ? Math.round(r.eval_duration / 1e6) : -1;
        const promptTokens = r.prompt_eval_count ?? -1;
        const outputTokens = r.eval_count ?? -1;
        if (this.config.debug) {
          process.stderr.write(
            `[ollama-timing] listwise window=${w + 1}..${w + window.length} ` +
              `total=${callMs}ms prefill=${promptEvalMs}ms(${promptTokens}tok) decode=${evalMs}ms(${outputTokens}tok)\n`,
          );
          await fs
            .appendFile(
              ".pelican/debug-rerank.log",
              `── RAW RESPONSE ──\n${response.response}\n── END RESPONSE ──\n`,
              "utf-8",
            )
            .catch(() => {});
        }

        const verdicts = parseListwiseResponse(response.response, window.length);
        for (let k = 0; k < window.length; k++) {
          const v = verdicts[k];
          out.push({
            testFile: window[k].testFile,
            relevant: v.relevant,
            reason: v.reason,
          });
        }
      } catch (err) {
        if (this.config.debug) {
          process.stderr.write(`[ollama] listwise window error: ${err}\n`);
        }
        // Precautionary include — same policy as per-pair error branch.
        for (const tb of window) {
          out.push({
            testFile: tb.testFile,
            relevant: true,
            reason: "LLM unavailable; included as precaution.",
          });
        }
      }

      doneCount += window.length;
      onProgress(doneCount);
    }
    return out;
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

    // Always try to read the file — mount targets and seeded markers only
    // show up in raw content, and structured metadata leans on them.
    let rawContent: string | undefined;
    try {
      rawContent = await fs.readFile(testFile, "utf-8");
    } catch {
      // fine — fall through with metadata-only header
    }

    const header = buildTestHeader(entry, rawContent);

    const hasCypressData =
      entry.cypress &&
      (entry.cypress.describeBlocks.length > 0 ||
        entry.cypress.itBlocks.length > 0 ||
        entry.cypress.visitedRoutes.length > 0);

    if (hasCypressData) {
      // Cypress metadata is rich enough; skip the raw body to save prompt tokens.
      return `${header}\n\n${buildTestPayload(entry)}`;
    }

    if (rawContent) {
      const sampled = stratifiedSampleLines(rawContent, fileContentConfig);
      const imports = entry.imports.length
        ? `Imports: ${entry.imports.slice(0, 15).join(", ")}`
        : "";
      return [header, "", imports, "", sampled].filter(Boolean).join("\n");
    }

    return `${header}\n\n${buildTestPayload(entry)}`;
  }

}

/**
 * Parse a listwise JSON-array response back into per-candidate verdicts.
 * Returns an array of length `expectedCount`.
 *
 * Missing indices default to `relevant=false` — when the LLM omits a
 * candidate from its array it's almost always because that candidate is a
 * reject it didn't bother to write. Defaulting to `true` inflates false
 * positives; an upstream bi-encoder + structural prior has already done
 * recall work, so the safer bias here is "silence = drop".
 *
 * If the response is entirely unparseable we fall BACK to `true` (same as
 * the per-pair error branch) so a model hiccup can't silently delete a
 * whole window of results.
 */
function parseListwiseResponse(
  text: string,
  expectedCount: number,
): Array<{ relevant: boolean; reason: string }> {
  const unparseableFallback = Array.from({ length: expectedCount }, () => ({
    relevant: true,
    reason: "Model response could not be parsed; included as precaution.",
  }));

  try {
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return unparseableFallback;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return unparseableFallback;

    // Per-item missing → reject. Whole-response missing → precautionary true
    // (handled above). Two different failure modes, two different defaults.
    const out: Array<{ relevant: boolean; reason: string }> = Array.from(
      { length: expectedCount },
      () => ({ relevant: false, reason: "LLM omitted from verdict list" }),
    );
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const idxRaw = (item as { i?: unknown }).i;
      const relRaw = (item as { r?: unknown }).r;
      const reasonRaw = (item as { reason?: unknown }).reason;
      const idx = typeof idxRaw === "number" ? idxRaw - 1 : -1;
      if (idx < 0 || idx >= expectedCount) continue;

      let relevant: boolean;
      if (typeof relRaw === "boolean") {
        relevant = relRaw;
      } else if (typeof relRaw === "string") {
        relevant = /^(true|yes|1)$/i.test(relRaw.trim());
      } else {
        continue;
      }
      const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
      out[idx] = { relevant, reason };
    }
    return out;
  } catch {
    return unparseableFallback;
  }
}

/**
 * Parse bucket-mode response: `{"score": 0..5, "reason"?: string}`.
 * `relevant` derived from bucket > BUCKET_REJECT_MAX (i.e. 2+). On parse
 * failure return bucket=3 (likely-yes) so pelican prior passes through
 * unchanged — same precautionary-include policy as bool parse.
 */
function parseBucketResponse(
  text: string,
): { relevant: boolean; reason: string; bucket: number } {
  try {
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
      let score: number | undefined;
      if (typeof parsed.score === "number") score = parsed.score;
      else if (typeof parsed.score === "string") {
        const n = parseInt(parsed.score, 10);
        if (!Number.isNaN(n)) score = n;
      }
      if (score !== undefined) {
        const b = Math.max(0, Math.min(5, Math.round(score)));
        return { relevant: b > BUCKET_REJECT_MAX, reason, bucket: b };
      }
    }
  } catch {
    // fall through
  }
  return {
    relevant: true,
    reason: "Model response could not be parsed; included as precaution.",
    bucket: 3,
  };
}

function parseResponse(text: string): { relevant: boolean; reason: string } {
  try {
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      // Accept partial shapes — small models (phi3, qwen2.5:3b) sometimes
      // omit `reason` or emit the key as a string instead of a boolean.
      const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
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

