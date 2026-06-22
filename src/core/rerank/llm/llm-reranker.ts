import { ISignal } from "@/types/analyzers";
import { IRerankConfig } from "@/types/config";
import { IReasonPoint } from "@/types/scorers";
import { EScorerType } from "@/utils/enums";

import { createLimiter, Limiter } from "./limiter";
import { ILLMProvider } from "./provider";

/**
 * Anchors the LLM is NOT allowed to override when protectAnchors is on. Only the
 * CERTAIN ones: a direct import (the test imports the changed file) or
 * colocation (Foo.test.tsx beside Foo.tsx). Deliberately excludes filename-match
 * — that heuristic is the flood source and is exactly what we want the LLM to
 * second-guess (it's how the provisioning cluster all looks identical).
 */
const PROTECTED_ANCHOR_TYPES: ReadonlySet<string> = new Set<string>([
  EScorerType.DIRECT_IMPORT,
  EScorerType.COLOCATION,
]);

/** One candidate spec handed to the reranker for a single changed file. */
export interface IRerankCandidate {
  testFile: string;
  score: number;
  signals: ISignal[];
  /** Test body / header excerpt shown to the LLM. */
  testExcerpt: string;
}

export interface IRerankInput {
  changedFile: string;
  /** Diff + source header describing what actually changed. */
  changeSummary: string;
}

export interface IRerankVerdict {
  testFile: string;
  kept: boolean;
  /** Why kept/dropped — surfaced in --debug. */
  reason: string;
  /** True only when the LLM was actually consulted (vs auto-kept/protected). */
  judged: boolean;
  llmRelevant?: boolean;
  llmConfidence?: number;
  /** The model's structured rationale — bullet points. Surfaced in the UI as
   * the reasoning lines for kept candidates. */
  why?: IReasonPoint[];
}

const hasProtectedAnchor = (signals: ISignal[]): boolean =>
  signals.some(
    (s) => s.matched && s.anchorEligible !== false && PROTECTED_ANCHOR_TYPES.has(s.type),
  );

const JSON_INSTRUCTION =
  "Respond with ONLY a JSON object: " +
  '{"relevant": boolean, "confidence": number between 0 and 1, "why": array of points}. ' +
  'Each point is {"tag": short label, "file": the changed file it concerns, "point": one sentence}, ' +
  'where tag is a 1-3 word relationship (e.g. "Direct Impact", "Could Regress", "Shared State", ' +
  '"Setup Only", "Different Feature"), and point names what changed and which test step it affects. ' +
  "Give 1-3 points. No prose, no code fences.";

// 'broad' — the original criterion: keep anything a regression COULD break.
const BROAD_SYSTEM_PROMPT =
  "You decide whether a test should run for a given code change in a CI test-selection tool. " +
  "A test is RELEVANT only if it actually exercises the changed behaviour — i.e. a regression in " +
  "the change could make this test fail. A test that merely mentions the same feature/domain but " +
  "does not drive the changed code path is NOT relevant. " +
  JSON_INSTRUCTION;

// 'strict' (default) — match a tester's targeted selection. Drops specs that
// only touch the change incidentally even if a regression could affect them.
const STRICT_SYSTEM_PROMPT =
  "You select which tests a team runs for a code change in a CI test-selection tool. " +
  "A test should RUN only if it PRIMARILY exercises the changed behaviour — its main purpose " +
  "drives the changed code path. If the test's main purpose is a DIFFERENT feature and it only " +
  "touches the change incidentally — via setup/fixtures, or a dependency it does not assert on — " +
  "mark it NOT relevant, EVEN IF a regression could incidentally affect it. Judge by what the " +
  "test is for, not merely what it transitively depends on. " +
  JSON_INSTRUCTION;

const systemPromptFor = (mode: "strict" | "broad"): string =>
  mode === "broad" ? BROAD_SYSTEM_PROMPT : STRICT_SYSTEM_PROMPT;

// Change triage — is the diff behavioural, or provably cosmetic? Used to skip
// test selection entirely for whitespace/format-only changes.
const TRIAGE_SYSTEM =
  "You triage a code change for test selection. Classify the change as COSMETIC only if it " +
  "cannot possibly alter runtime behaviour — i.e. it is purely whitespace, indentation, " +
  "formatting, comments, import reordering, or renaming a local variable consistently. " +
  "Anything else is BEHAVIOURAL. IMPORTANT: whitespace or text inside a string/template literal, " +
  "JSX text, or a regex IS behavioural (it can change rendered/asserted output). If you are unsure, " +
  'answer behavioural. Respond with ONLY: {"cosmetic": boolean, "confidence": number 0..1, "why": short string}.';

export interface ITriageResult {
  cosmetic: boolean;
  confidence: number;
  why: string;
}

/** Build the per-pair user message. Small, focused, groundable. */
export function buildRerankPrompt(input: IRerankInput, candidate: IRerankCandidate): string {
  return (
    `CHANGE — ${input.changedFile}\n` +
    `${input.changeSummary.trim()}\n\n` +
    `TEST — ${candidate.testFile}\n` +
    `${candidate.testExcerpt.trim()}\n\n` +
    `Anchor each point on the SPECIFIC change above — what was added/removed/modified ` +
    `(prefer the DIFF lines if shown) — not just the file as a whole. Phrase it as ` +
    `"the change to <X> could break <which step of this test>". Reply with the JSON object only.`
  );
}

/**
 * Extract {relevant, confidence} from an LLM reply, tolerating code fences and
 * surrounding prose. Returns null when nothing parseable is found (caller then
 * fails open).
 */
/** Coerce one raw `why` array item into a reason point, tolerating shapes. */
function toReasonPoint(item: unknown): IReasonPoint | null {
  if (typeof item === "string") {
    const point = item.trim();
    return point ? { tag: "", file: "", point } : null;
  }
  if (item && typeof item === "object") {
    const o = item as { tag?: unknown; file?: unknown; point?: unknown; reason?: unknown };
    const point = String(o.point ?? o.reason ?? "").trim();
    if (!point) return null;
    return {
      tag: typeof o.tag === "string" ? o.tag.trim() : "",
      file: typeof o.file === "string" ? o.file.trim().replace(/^@/, "") : "",
      point,
    };
  }
  return null;
}

export function parseVerdict(
  raw: string,
): { relevant: boolean; confidence: number; why: IReasonPoint[] } | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as { relevant?: unknown; confidence?: unknown; why?: unknown };
    if (typeof obj.relevant !== "boolean") return null;
    const confidence =
      typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 0.5;
    // `why` is an array of {tag, file, point}; tolerate a bare string or missing.
    const why: IReasonPoint[] = Array.isArray(obj.why)
      ? obj.why
          .map(toReasonPoint)
          .filter((p): p is IReasonPoint => p !== null)
          .slice(0, 5)
      : typeof obj.why === "string" && obj.why.trim()
        ? [{ tag: "", file: "", point: obj.why.trim() }]
        : [];
    return { relevant: obj.relevant, confidence, why };
  } catch {
    return null;
  }
}

/**
 * LLM rerank pass — recall-safe by construction:
 *  - candidates at/above candidateBand.max are auto-kept (strong structural
 *    match, never second-guessed);
 *  - candidates carrying a narrow structural anchor are kept when protectAnchors;
 *  - only the ambiguous middle is sent to the LLM, capped at maxCandidates;
 *  - any LLM error/timeout/unparseable reply KEEPS the candidate (fail-open).
 *
 * The LLM can only drop a candidate that is both in-band AND (when protected)
 * unanchored — exactly the flood of domain-similar-but-behaviourally-unrelated
 * specs that static analysis can't separate.
 */
export class LLMReranker {
  constructor(
    private readonly provider: ILLMProvider,
    private readonly config: IRerankConfig,
    private readonly log?: (msg: string) => void,
  ) {}

  /**
   * @param limiter shared concurrency limiter. Pass ONE limiter across all
   * changed files so the global in-flight cap holds even when files are reranked
   * in parallel. Defaults to a fresh per-call limiter (single-file use).
   */
  /**
   * Triage a change: is its diff behavioural, or provably cosmetic (whitespace/
   * formatting/comments)? Used to skip test selection for no-op changes. One
   * LLM call. Fails CLOSED to behavioural (cosmetic:false) on any error/parse
   * failure — a triage miss must never drop tests, so uncertainty keeps them.
   */
  async triageChange(changeSummary: string): Promise<ITriageResult> {
    const fallback: ITriageResult = { cosmetic: false, confidence: 0, why: "triage unavailable" };
    try {
      const raw = await this.provider.complete(
        [
          { role: "system", content: TRIAGE_SYSTEM },
          { role: "user", content: changeSummary },
        ],
        { timeoutMs: this.config.timeoutMs, temperature: 0, maxTokens: 1200 },
      );
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return fallback;
      const o = JSON.parse(m[0]) as { cosmetic?: unknown; confidence?: unknown; why?: unknown };
      if (typeof o.cosmetic !== "boolean") return fallback;
      return {
        cosmetic: o.cosmetic,
        confidence: typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0,
        why: typeof o.why === "string" ? o.why.trim() : "",
      };
    } catch (err) {
      this.log?.(`triage: ${String(err)} — treating as behavioural (keeps tests)`);
      return fallback;
    }
  }

  async rerank(
    input: IRerankInput,
    candidates: IRerankCandidate[],
    limiter: Limiter = createLimiter(this.config.concurrency),
  ): Promise<IRerankVerdict[]> {
    const { candidateBand, protectAnchors, maxCandidates } = this.config;

    const autoKept: IRerankVerdict[] = [];
    const toJudge: IRerankCandidate[] = [];

    for (const c of candidates) {
      if (c.score >= candidateBand.max) {
        autoKept.push({
          testFile: c.testFile,
          kept: true,
          judged: false,
          reason: `auto-kept (score ${c.score.toFixed(2)} ≥ band.max ${candidateBand.max})`,
        });
      } else if (c.score < candidateBand.min) {
        // Below the band: not the LLM's business — leave as-is (kept; upstream
        // threshold already governs it).
        autoKept.push({
          testFile: c.testFile,
          kept: true,
          judged: false,
          reason: `below band.min ${candidateBand.min} — not judged`,
        });
      } else if (protectAnchors && hasProtectedAnchor(c.signals)) {
        autoKept.push({
          testFile: c.testFile,
          kept: true,
          judged: false,
          reason: "protected (direct-import/colocation anchor)",
        });
      } else {
        toJudge.push(c);
      }
    }

    // Cost cap: judge the highest-scoring in-band candidates first; any beyond
    // the cap are KEPT unjudged (fail-open, never a silent drop).
    toJudge.sort((a, b) => b.score - a.score);
    const overflow = toJudge.slice(maxCandidates);
    const judging = toJudge.slice(0, maxCandidates);
    if (overflow.length > 0) {
      this.log?.(
        `rerank: ${overflow.length} in-band candidate(s) over maxCandidates=${maxCandidates} kept unjudged`,
      );
    }
    const overflowKept: IRerankVerdict[] = overflow.map((c) => ({
      testFile: c.testFile,
      kept: true,
      judged: false,
      reason: `over maxCandidates cap — kept unjudged`,
    }));

    const judged = await Promise.all(judging.map((c) => limiter(() => this.judge(input, c))));

    return [...autoKept, ...overflowKept, ...judged];
  }

  private async judge(input: IRerankInput, c: IRerankCandidate): Promise<IRerankVerdict> {
    const prompt = buildRerankPrompt(input, c);
    try {
      const raw = await this.provider.complete(
        [
          { role: "system", content: systemPromptFor(this.config.judgeMode) },
          { role: "user", content: prompt },
        ],
        // Headroom for reasoning models (e.g. nemotron): they spend tokens on a
        // thinking trace before the JSON verdict; too low truncates it →
        // unparseable → fail-open. 800 fits the trace + the tiny JSON.
        // Headroom for a reasoning model: it spends tokens on a thinking trace
        // BEFORE the JSON. With the diff-anchored, multi-point `why`, 800 could
        // truncate the JSON array → unparseable → fail-open with empty reasoning.
        // 2000 fits the trace + a 1-3 point verdict.
        { timeoutMs: this.config.timeoutMs, temperature: 0, maxTokens: 10000 },
      );
      const verdict = parseVerdict(raw);
      if (!verdict) {
        this.log?.(`rerank: ${c.testFile} — unparseable reply, keeping (fail-open)`);
        return {
          testFile: c.testFile,
          kept: true,
          judged: true,
          reason: "unparseable LLM reply — kept (fail-open)",
        };
      }
      // Recall-safe gate: DROP only on a CONFIDENT rejection — the model must
      // say not-relevant AND be at/above dropConfidence. A relevant verdict, or
      // any low-confidence rejection, is kept. (keepThreshold is honoured as a
      // floor on "relevant" verdicts for back-compat, but the drop decision is
      // governed by dropConfidence.)
      const confidentReject = !verdict.relevant && verdict.confidence >= this.config.dropConfidence;
      const kept = !confidentReject;
      return {
        testFile: c.testFile,
        kept,
        judged: true,
        llmRelevant: verdict.relevant,
        llmConfidence: verdict.confidence,
        why: verdict.why,
        reason: kept
          ? verdict.relevant
            ? `LLM: relevant (conf ${verdict.confidence.toFixed(2)})`
            : `LLM: not relevant but low confidence ${verdict.confidence.toFixed(2)} < dropConfidence ${this.config.dropConfidence} — kept`
          : `LLM: not relevant, conf ${verdict.confidence.toFixed(2)} ≥ dropConfidence ${this.config.dropConfidence} — dropped`,
      };
    } catch (err) {
      this.log?.(`rerank: ${c.testFile} — ${String(err)}, keeping (fail-open)`);
      return {
        testFile: c.testFile,
        kept: true,
        judged: true,
        reason: `LLM error — kept (fail-open)`,
      };
    }
  }
}
