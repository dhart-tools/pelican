import React, { useState, useEffect } from "react";
import { render } from "ink";
import { readFile } from "fs/promises";
import { join } from "path";
import { DescriptorStore } from "../store/descriptor.js";
import { GitService } from "../core/git.js";
import { Analyzer } from "../core/analyzer.js";
import { OllamaService } from "../llm/ollama.js";
import { PromptLoader } from "../llm/prompts.js";
import { loadConfig } from "../config.js";
import { IndexView } from "../ui/components/IndexView.js";

// ─── Simple Glob Matcher ───────────────────────────────────

function matchesPattern(file: string, pattern: string): boolean {
  // Convert glob to simple regex
  // **/*.ts -> .*\.ts$
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*") + "$";
  const regex = new RegExp(regexStr);
  return regex.test(file);
}

function IndexApp({ all }: { all: boolean }) {
  const [state, setState] = useState<{
    status: "scanning" | "analyzing" | "saving" | "done" | "error";
    totalFiles: number;
    processedFiles: number;
    currentFile?: string;
    newFiles: number;
    updatedFiles: number;
    error?: string;
  }>({
    status: "scanning",
    totalFiles: 0,
    processedFiles: 0,
    newFiles: 0,
    updatedFiles: 0,
  });

  useEffect(() => {
    async function runIndex() {
      try {
        const projectRoot = process.cwd();
        const config = await loadConfig(projectRoot);
        
        const store = new DescriptorStore(projectRoot);
        const descriptor = await store.load();
        
        const git = new GitService(projectRoot);
        if (!(await git.isGitRepo())) {
          setState(s => ({ ...s, status: "error", error: "Not a git repository." }));
          return;
        }

        const currentSha = await git.getCurrentSha();
        const storedSha = all ? "" : descriptor.sha;

        // 1. Get changed files
        let changedFiles: string[] = [];
        if (!storedSha) {
          // First run or all: get all tracked files
          const allFiles = await git.getChangedFilesSinceSha(""); // Empty string gets all tracked
          changedFiles = allFiles;
        } else {
          changedFiles = await git.getChangedFilesSinceSha(storedSha);
        }

        // 2. Filter files based on patterns
        const filteredFiles = changedFiles.filter(file => {
          const isSource = config.sourcePatterns.some(p => matchesPattern(file, p)) &&
                           (config.sourceDirs.length === 0 || config.sourceDirs.some(dir => file.startsWith(dir)));
          const isTest = config.testPatterns.some(p => matchesPattern(file, p));
          const isIgnored = config.ignorePatterns.some(p => matchesPattern(file, p) || file.includes(p));
          return (isSource || isTest) && !isIgnored;
        });

        if (filteredFiles.length === 0) {
          setState(s => ({ ...s, status: "done", totalFiles: descriptor.files.length }));
          return;
        }

        setState(s => ({ ...s, status: "analyzing", totalFiles: filteredFiles.length }));

        // 3. Prepare for analysis
        const ollama = new OllamaService(config.ollamaHost, config.model);
        const promptLoader = new PromptLoader();
        const analyzer = new Analyzer(projectRoot, ollama, promptLoader, descriptor.projectDescription || "General purpose TypeScript/React project", config.maxParallelAnalysis);

        const filesToAnalyze = await Promise.all(
          filteredFiles.map(async (f) => {
            const isTest = config.testPatterns.some(p => matchesPattern(f, p));
            return {
              path: f,
              content: await readFile(join(projectRoot, f), "utf-8"),
              type: (isTest ? "test" : "source") as "test" | "source",
            };
          })
        );

        // 4. Run Batch Analysis
        const results = await analyzer.analyzeFiles(filesToAnalyze, (completed, total, current) => {
          setState(s => ({
            ...s,
            processedFiles: completed,
            currentFile: current,
          }));
        });

        // 5. Update Store
        setState(s => ({ ...s, status: "saving" }));
        
        let newCount = 0;
        let updatedCount = 0;

        for (const result of results) {
          const existing = store.getFileEntry(result.name);
          if (existing) updatedCount++;
          else newCount++;
          
          store.upsertFileEntry({
            ...result,
          });
        }

        store.setSha(currentSha);
        await store.save();

        setState(s => ({
          ...s,
          status: "done",
          newFiles: newCount,
          updatedFiles: updatedCount,
          totalFiles: store.getDescriptor()?.files.length || 0,
        }));

      } catch (err: any) {
        setState(s => ({ ...s, status: "error", error: err.message }));
      }
    }

    runIndex();
  }, []);

  return <IndexView {...state} />;
}

export async function indexCommand(options: { all: boolean }): Promise<void> {
  const { waitUntilExit } = render(<IndexApp all={options.all} />);
  await waitUntilExit();
}
