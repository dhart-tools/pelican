#!/usr/bin/env node
import { Command } from "commander";
import { setupCommand } from "./commands/setup.js";
import { indexCommand } from "./commands/index.js";
import { suggestCommand } from "./commands/suggest.js";

const program = new Command();

program.name("suggestor").description("AI-powered test suggestion CLI").version("0.1.0");

program
  .command("setup")
  .description("Set up Suggestor: pull LLM model and initialize project")
  .option("--light", "Use smaller model (1.5b) for faster setup")
  .action(async (options) => {
    try {
      await setupCommand(options);
    } catch (error) {
      console.error("\n❌ Setup failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("index")
  .description("Index source and test files for suggestion matching")
  .action(async () => {
    try {
      await indexCommand();
    } catch (error) {
      console.error("\n❌ Indexing failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("suggest")
  .description("Suggest relevant tests for current file changes")
  .action(async () => {
    try {
      await suggestCommand();
    } catch (error) {
      console.error("\n❌ Suggestion failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Handle unknown commands
program.on("command:*", () => {
  console.error(
    "Invalid command: %s\nSee --help for a list of available commands.",
    program.args.join(" "),
  );
  process.exit(1);
});

program.parse();
