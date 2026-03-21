import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTS_DIR = join(__dirname, "..", "..", "prompts");

export class PromptLoader {
  private promptsDir: string;

  constructor(promptsDir?: string) {
    this.promptsDir = promptsDir || PROMPTS_DIR;
  }

  async load(
    promptName: string,
    variables: Record<string, string>
  ): Promise<string> {
    const filePath = join(this.promptsDir, `${promptName}.md`);

    let template: string;
    try {
      template = await readFile(filePath, "utf-8");
    } catch {
      throw new Error(`Prompt template not found: ${promptName}.md at ${filePath}`);
    }

    // Replace all {{variableName}} placeholders
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      result = result.replace(pattern, value);
    }

    // Warn about unreplaced placeholders (developer safety check)
    const unreplaced = result.match(/\{\{[a-zA-Z_]+\}\}/g);
    if (unreplaced) {
      console.warn(
        `⚠️ Unreplaced placeholders in prompt "${promptName}":`,
        unreplaced
      );
    }

    return result;
  }
}
