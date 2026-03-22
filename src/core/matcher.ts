import type { IFileEntry, ISuggestionResult } from "../types.js";
import { DescriptorStore } from "../store/descriptor.js";
import { OllamaService } from "../llm/ollama.js";
import { PromptLoader } from "../llm/prompts.js";

// ─── Matcher Class ─────────────────────────────────────────

export class Matcher {
  private store: DescriptorStore;
  private ollama: OllamaService;
  private promptLoader: PromptLoader;

  constructor(
    store: DescriptorStore,
    ollama: OllamaService,
    promptLoader: PromptLoader
  ) {
    this.store = store;
    this.ollama = ollama;
    this.promptLoader = promptLoader;
  }

  // ─── Phase 1: Keyword Funnel ─────────────────────────────

  keywordMatch(changedFiles: IFileEntry[]): Array<{
    testFile: IFileEntry;
    score: number;
    matchedKeywords: string[];
  }> {
    const testFiles = this.store.getTestFiles();
    if (testFiles.length === 0) return [];

    // Always include all test files as candidates, 
    // but rank them based on keyword overlap
    const candidates = testFiles.map(testEntry => {
        let bestScore = 0;
        let bestMatched: string[] = [];

        for (const changedEntry of changedFiles) {
            const keywordOverlap = this.store.computeKeywordOverlap(changedEntry, testEntry);
            const keywordScore = keywordOverlap.matched.length / Math.max(changedEntry.keywords.length, 1);
            
            const changedComponents = new Set(changedEntry.components.map((c) => c.toLowerCase()));
            const componentMatches = testEntry.components.filter((c) => changedComponents.has(c.toLowerCase()));
            const componentScore = componentMatches.length / Math.max(changedEntry.components.length, 1);
            
            const finalScore = keywordScore * 0.4 + componentScore * 0.6;
            
            if (finalScore > bestScore) {
                bestScore = finalScore;
                bestMatched = keywordOverlap.matched;
            }
        }
        
        return {
            testFile: testEntry,
            score: bestScore,
            matchedKeywords: bestMatched
        };
    });

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
  }


  // ─── Phase 2: LLM Semantic Ranking ───────────────────────

  async semanticRank(
    changedFiles: IFileEntry[],
    candidates: Array<{
      testFile: IFileEntry;
      score: number;
      matchedKeywords: string[];
    }>
  ): Promise<ISuggestionResult[]> {
    // Build context strings
    const changedFilesContext = changedFiles
      .map(
        (f) =>
          `- **${f.name}**: ${f.description} (keywords: ${f.keywords.slice(0, 10).join(", ")})`
      )
      .join("\n");

    const candidateTestsContext = candidates
      .map(
        (c) =>
          `- **${c.testFile.name}**: ${c.testFile.description} (components: ${c.testFile.components.join(", ")}) (keywords: ${c.testFile.keywords.slice(0, 10).join(", ")})`
      )
      .join("\n");

    try {
      const prompt = await this.promptLoader.load("suggest", {
        changedFiles: changedFilesContext,
        candidateTests: candidateTestsContext,
      });

      const llmResults =
        await this.ollama.generateJSON<
          Array<{ testFile: string; confidence: number; reason: string }>
        >(prompt);

      // Blend: finalConfidence = (phase1Score * 0.3) + (llmConfidence * 0.7)
      return llmResults
        .map((llmResult) => {
          const phase1 = candidates.find(
            (c) => c.testFile.name === llmResult.testFile
          );
          const phase1Score = phase1?.score || 0;
          const blended = phase1Score * 0.3 + llmResult.confidence * 0.7;

          return {
            testFile: llmResult.testFile,
            confidence: Math.min(blended, 1),
            reason: llmResult.reason,
            matchedKeywords: phase1?.matchedKeywords || [],
          };
        })
        .filter((r) => {
          const isTestFile = this.store.getTestFiles().some(t => t.name === r.testFile);
          return isTestFile && r.confidence > 0.3;
        })
        .sort((a, b) => b.confidence - a.confidence);
    } catch (err) {
      // Graceful degradation: use Phase 1 scores only
      console.warn(
        "⚠️ LLM semantic ranking failed, using keyword scores only:",
        err instanceof Error ? err.message : err
      );

      return candidates
        .filter((c) => c.score > 0.1)
        .map((c) => ({
          testFile: c.testFile.name,
          confidence: c.score,
          reason: `Keyword match (${c.matchedKeywords.length} overlapping keywords)`,
          matchedKeywords: c.matchedKeywords,
        }));
    }
  }

  // ─── Orchestrator ────────────────────────────────────────

  async suggest(
    changedFiles: IFileEntry[],
    onStatus?: (phase: "matching" | "ranking" | "done") => void
  ): Promise<ISuggestionResult[]> {
    // Phase 1: Keyword funnel
    onStatus?.("matching");
    const candidates = this.keywordMatch(changedFiles);

    if (candidates.length === 0) {
      onStatus?.("done");
      return [];
    }

    // Phase 2: LLM semantic ranking
    onStatus?.("ranking");
    const results = await this.semanticRank(changedFiles, candidates);
    onStatus?.("done");
    return results;
  }
}
