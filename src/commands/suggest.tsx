import React, { useState, useEffect } from "react";
import { render } from "ink";
import { readFile } from "fs/promises";
import { join } from "path";
import { DescriptorStore } from "../store/descriptor.js";
import { GitService } from "../core/git.js";
import { Analyzer } from "../core/analyzer.js";
import { Matcher } from "../core/matcher.js";
import { OllamaService } from "../llm/ollama.js";
import { PromptLoader } from "../llm/prompts.js";
import { loadConfig } from "../config.js";
import { SuggestView } from "../ui/components/SuggestView.js";
import type { IFileEntry, ISuggestionResult } from "../types.js";

// ─── Simple Glob Matcher ───────────────────────────────────

function matchesPattern(file: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*") + "$";
  const regex = new RegExp(regexStr);
  return regex.test(file);
}

function SuggestApp() {
  const [state, setState] = useState<{
    status: "detecting" | "analyzing" | "matching" | "ranking" | "done" | "error";
    changedFiles: string[];
    results: ISuggestionResult[];
    error?: string;
  }>({
    status: "detecting",
    changedFiles: [],
    results: [],
  });

  useEffect(() => {
    async function runSuggest() {
      try {
        const projectRoot = process.cwd();
        const config = await loadConfig(projectRoot);
        
        const store = new DescriptorStore(projectRoot);
        await store.load();
        
        const git = new GitService(projectRoot);
        if (!(await git.isGitRepo())) {
          setState(s => ({ ...s, status: "error", error: "Not a git repository." }));
          return;
        }

        // 1. Get working changes
        const changes = await git.getWorkingChanges();
        const relevantChanges = changes.all.filter(f => f !== "descriptor.json");
        if (relevantChanges.length === 0) {
          setState(s => ({ ...s, status: "done", changedFiles: [] }));
          return;
        }

        setState(s => ({ ...s, status: "analyzing", changedFiles: relevantChanges }));

        const ollama = new OllamaService(config.ollamaHost, config.model);
        const promptLoader = new PromptLoader();
        const descriptor = store.getDescriptor();
        const analyzer = new Analyzer(projectRoot, ollama, promptLoader, descriptor?.projectDescription || "General purpose TypeScript/React project", config.maxParallelAnalysis);
        const matcher = new Matcher(store, ollama, promptLoader);

        // 2. Map changed files to IFileEntry (cached or fresh)
        const changedEntries: IFileEntry[] = [];
        for (const filePath of relevantChanges) {
          const existing = store.getFileEntry(filePath);
          if (existing) {
            changedEntries.push(existing);
          } else {
            // Quick analysis for new file
            const absolutePath = join(projectRoot, filePath);
            const content = await readFile(absolutePath, "utf-8");
            const isTest = config.testPatterns.some(p => matchesPattern(filePath, p));
            const result = await analyzer.analyzeFile(
                filePath, 
                content, 
                undefined,
                (isTest ? "test" : "source") as "test" | "source"
            );
            const entry: IFileEntry = {
              name: filePath,
              description: result.description,
              keywords: result.keywords,
              components: result.components,
              type: result.type,
            };
            changedEntries.push(entry);
          }
        }

        // 3. Run Matching & Ranking
        const results = await matcher.suggest(changedEntries, (phase) => {
          setState(s => ({ ...s, status: phase }));
        });

        setState(s => ({ ...s, status: "done", results: results }));


      } catch (err: any) {
        setState(s => ({ ...s, status: "error", error: err.message }));
      }
    }

    runSuggest();
  }, []);

  return <SuggestView {...state} />;
}

export async function suggestCommand(): Promise<void> {
  const { waitUntilExit } = render(<SuggestApp />);
  await waitUntilExit();
}
