// ─── Descriptor Types ────────────────────────────────────
export interface IDescriptor {
  sha: string;
  projectDescription?: string;
  files: IFileEntry[];
}

export interface IFileEntry {
  name: string;
  description: string;
  keywords: string[];
  components: string[];
  type: "source" | "test";
}

// ─── Analysis Types ──────────────────────────────────────
export interface IASTExtractionResult {
  exports: string[];           // Exported names
  classes: string[];           // Class names
  functions: string[];         // Function names
  interfaces: string[];        // Interface/type names
  imports: string[];           // Imported module names
  selectors: { attr: string; value: string }[];
  jsxTextContent: string[];
  translationKeys: string[];
  reduxUsage: {
    selectorsUsed: string[];
    actionsDispatched: string[];
    slicesDefined: string[];
  };
}

export interface ILLMAnalysisResult {
  description: string;
  keywords: string[];
  components: string[];
  type: "source" | "test";
}

export interface IAnalysisResult {
  name: string;
  description: string;
  keywords: string[];          // Merged AST + LLM keywords
  components: string[];        // From AST extraction
  type: "source" | "test";
}

// ─── Matching Types ──────────────────────────────────────
export interface ISuggestionResult {
  testFile: string;            // Path to suggested test file
  confidence: number;          // 0-1 confidence score
  reason: string;              // Why this test was suggested
  matchedKeywords: string[];   // Overlapping keywords
}

// ─── Config Types ────────────────────────────────────────
export interface ISuggestorConfig {
  model: string;
  testPatterns: string[];
  sourcePatterns: string[];
  sourceDirs: string[];
  ignorePatterns: string[];
  maxParallelAnalysis: number;
  ollamaHost: string;
}

// ─── Git Types ───────────────────────────────────────────
export interface IGitChanges {
  staged: string[];
  unstaged: string[];
  all: string[];               // Deduplicated union
}
