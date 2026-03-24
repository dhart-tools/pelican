import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { ISuggestorConfig } from "./types.js";
import { env } from "./env.js";

const CONFIG_FILENAME = ".suggestorrc.json";

export const DEFAULT_CONFIG: ISuggestorConfig = {
  model: "qwen2.5-coder:3b",
  testPatterns: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/*.cy.ts", "**/*.cy.tsx", "**/*.pw.ts", "**/*.playwright.ts"],
  sourcePatterns: ["**/*.ts", "**/*.tsx"],
  sourceDirs: ["src"],
  ignorePatterns: ["node_modules", "dist", ".git", "context"],
  maxParallelAnalysis: 1,
  ollamaHost: env.OLLAMA_HOST,
};

export async function loadConfig(projectRoot: string): Promise<ISuggestorConfig> {
  const configPath = join(projectRoot, CONFIG_FILENAME);
  
  try {
    const content = await readFile(configPath, "utf-8");
    const userConfig = JSON.parse(content);
    
    return {
      ...DEFAULT_CONFIG,
      ...userConfig,
    };
  } catch (error) {
    // If file doesn't exist or is malformed, return defaults
    return DEFAULT_CONFIG;
  }
}

export async function writeDefaultConfig(projectRoot: string): Promise<void> {
  const configPath = join(projectRoot, CONFIG_FILENAME);
  
  // Only write if doesn't exist
  try {
    await readFile(configPath);
  } catch (error) {
    await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}
