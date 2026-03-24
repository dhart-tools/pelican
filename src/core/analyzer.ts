import { readFile } from "fs/promises";
import { join } from "path";
import pLimit from "p-limit";
import type { IAnalysisResult, ILLMAnalysisResult, IASTExtractionResult } from "../types.js";
import { ASTExtractor } from "./ast-extractor.js";
import { OllamaService } from "../llm/ollama.js";
import { PromptLoader } from "../llm/prompts.js";

// ─── Helpers ───────────────────────────────────────────────

function truncateContent(content: string, maxLines = 200): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join("\n") + "\n\n... (truncated)";
}

const GLOBAL_NOISE_WORDS = new Set([
  "string", "number", "boolean", "any", "void", "object", "array", "null", "undefined", "true", "false",
  "class", "function", "const", "let", "var", "export", "import", "return", "if", "else", "async", "await",
  "promise", "then", "catch", "setter", "getter", "constructor", "method", "property", "item", "the", "a",
  "an", "is", "get", "set", "has", "to", "from", "with", "for", "of", "in", "on", "at", "by", "do", "be",
  "it", "or", "as", "up", "so", "no", "me", "my", "we", "us"
]);

function deduplicateKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map((k) => k.toLowerCase()))]
    .filter(k => !GLOBAL_NOISE_WORDS.has(k) && k.length > 2)
    .sort();
}

// ─── Analyzer Class ────────────────────────────────────────

export class Analyzer {
  private astExtractor: ASTExtractor;
  private ollama: OllamaService;
  private promptLoader: PromptLoader;
  private maxParallel: number;
  private projectDescription: string;
  private verbose: boolean;

  constructor(
    cwd: string,
    ollama: OllamaService,
    promptLoader: PromptLoader,
    projectDescription: string,
    maxParallel = 5,
    verbose = false
  ) {
    this.astExtractor = new ASTExtractor(cwd);
    this.ollama = ollama;
    this.promptLoader = promptLoader;
    this.projectDescription = projectDescription;
    this.maxParallel = maxParallel;
    this.verbose = verbose;
  }

  // ─── Single File Analysis ──────────────────────────────────

  // ─── Formatting Helpers ────────────────────────────────────

  private formatASTStructure(result: IASTExtractionResult): string {
    return [
      `Exports: ${result.exports.join(", ")}`,
      `Classes: ${result.classes.join(", ")}`,
      `Functions: ${result.functions.join(", ")}`,
      `Interfaces: ${result.interfaces.join(", ")}`,
      `Imports: ${result.imports.join(", ")}`,
    ].join("\n");
  }

  // ─── Single File Analysis ──────────────────────────────────

  // Increased timeout to 120s for heavier models
  private async callLLMWithRetry(prompt: string, filePath: string, onToken?: (token: string) => void, retries = 2): Promise<ILLMAnalysisResult> {
    for (let i = 0; i < retries; i++) {
      try {
        if (this.verbose) {
            console.error(`\n[Analyzer] Analyzing ${filePath} (Attempt ${i + 1}/${retries})...`);
            console.error(`[Analyzer] Prompt: ${prompt.slice(0, 200)}...`);
        }
        const result = await this.ollama.generateJSON<ILLMAnalysisResult>(prompt, onToken);
        if (this.verbose) {
            console.error(`[Analyzer] Success for ${filePath}:`, JSON.stringify(result));
        }
        return result;
      } catch (err) {
        if (i === retries - 1) throw err;
        console.warn(`Retry ${i + 1}/${retries} after error:`, err instanceof Error ? err.message : err);
      }
    }
    throw new Error("Max retries exceeded");
  }

  async analyzeFile(
    filePath: string,
    fileContent: string,
    onToken?: (token: string) => void,
    forcedType?: "source" | "test"
  ): Promise<IAnalysisResult> {
    const astResult = await this.astExtractor.extractFromFile(filePath);
    const astKeywords = this.astExtractor.toKeywords(astResult);
    const fileType = forcedType || this.astExtractor.detectFileType(filePath);

    let llmResult: ILLMAnalysisResult | null = null;
    try {
      const prompt = await this.promptLoader.load("analyze", {
        filePath,
        projectDescription: this.projectDescription,
        astStructure: this.formatASTStructure(astResult),
        fileContent: truncateContent(fileContent),
        initialKeywords: astKeywords.join(", "),
      });
      // deterministic response:
      llmResult = await this.callLLMWithRetry(prompt, filePath, onToken);
    } catch (err) {
      console.warn(`⚠️ LLM analysis failed for ${filePath}, using AST-only:`, err instanceof Error ? err.message : err);
    }

    // Phase 3: Merge results
    const mergedKeywords = deduplicateKeywords([
      ...astKeywords,
      ...(llmResult?.keywords || []),
    ]);

    const mergedComponents = [
      ...new Set([
        ...astResult.classes,
        ...astResult.functions,
        ...(llmResult?.components || []),
      ]),
    ];

    return {
      name: filePath,
      description: llmResult?.description || `File: ${filePath}`,
      keywords: mergedKeywords,
      components: mergedComponents,
      type: fileType,
    };
  }

  // ─── Batch File Analysis ───────────────────────────────────

  async analyzeFiles(
    files: Array<{ path: string; content: string; type?: "source" | "test" }>,
    onProgress?: (completed: number, total: number, currentFile: string) => void,
    onToken?: (token: string) => void
  ): Promise<IAnalysisResult[]> {
    const limit = pLimit(this.maxParallel);
    let completed = 0;

    const tasks = files.map((file) =>
      limit(async () => {
        try {
          const result = await this.analyzeFile(file.path, file.content, onToken, file.type);
          completed++;
          onProgress?.(completed, files.length, file.path);
          return result;
        } catch (err) {
          // On total failure, return AST-only fallback
          console.warn(
            `⚠️ Full analysis failed for ${file.path}:`,
            err instanceof Error ? err.message : err
          );
          completed++;
          onProgress?.(completed, files.length, file.path);

          const astResult = await this.astExtractor.extractFromFile(file.path);
          const astKeywords = this.astExtractor.toKeywords(astResult);

          return {
            name: file.path,
            description: `File: ${file.path}`,
            keywords: astKeywords,
            components: [...astResult.classes, ...astResult.functions],
            type: file.type || this.astExtractor.detectFileType(file.path),
          } as IAnalysisResult;
        }
      })
    );

    return Promise.all(tasks);
  }
}
