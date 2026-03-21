#!/usr/bin/env node

/**
 * environment setup script for Suggestor
 * 
 * This script automates:
 * 1. Dependency installation (pnpm)
 * 2. Project build (tsc)
 * 3. Suggestor CLI setup (model pull, config init)
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import chalk from "chalk";

function run(command, desc) {
  console.log(chalk.blue(`\n🚀 ${desc}...`));
  try {
    execSync(command, { stdio: "inherit" });
    console.log(chalk.green(`✅ ${desc} successful.`));
  } catch (err) {
    console.error(chalk.red(`❌ ${desc} failed.`));
    process.exit(1);
  }
}

console.log(chalk.bold.cyan("\n--- Suggestor Environment Setup ---\n"));

// 1. Check for Ollama
try {
  execSync("ollama --version", { stdio: "ignore" });
} catch (err) {
  console.log(chalk.yellow("⚠️  Ollama not found. Please install it from https://ollama.ai/download"));
  console.log(chalk.yellow("Suggestor requires Ollama for local LLM analysis.\n"));
  // We don't exit here, but the later setup command might fail if they don't install it.
}

// 2. Install dependencies
run("pnpm install", "Installing dependencies");

// 3. Build project
run("pnpm build", "Building project");

// 4. Run suggestor setup
run("node dist/cli.js setup --light", "Initializing Suggestor system");

console.log(chalk.bold.green("\n✨ Environment setup complete!\n"));
console.log(chalk.cyan("Now you can use Suggestor:"));
console.log(`  ${chalk.white("pnpm suggestor index")}   - to index your repo`);
console.log(`  ${chalk.white("pnpm suggestor suggest")} - to get test suggestions\n`);
