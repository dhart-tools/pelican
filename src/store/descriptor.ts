import { readFile, writeFile, rename } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { IDescriptor, IFileEntry } from "../types.js";

export class DescriptorStore {
  private projectRoot: string;
  private descriptor: IDescriptor | null = null;
  private descriptorPath: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.descriptorPath = join(projectRoot, "descriptor.json");
  }

  async load(): Promise<IDescriptor> {
    if (!existsSync(this.descriptorPath)) {
      this.descriptor = { sha: "", files: [] };
      return this.descriptor;
    }

    try {
      const content = await readFile(this.descriptorPath, "utf-8");
      if (!content.trim()) {
        this.descriptor = { sha: "", files: [] };
        return this.descriptor;
      }
      this.descriptor = JSON.parse(content) as IDescriptor;
      return this.descriptor;
    } catch (error) {
      console.warn("⚠️ Failed to parse descriptor.json, starting with empty one.");
      this.descriptor = { sha: "", files: [] };
      return this.descriptor;
    }
  }

  async save(descriptor?: IDescriptor): Promise<void> {
    const data = descriptor || this.descriptor;
    if (!data) return;

    const tmpPath = `${this.descriptorPath}.tmp`;
    const content = JSON.stringify(data, null, 2) + "\n";

    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, this.descriptorPath);
  }

  async init(): Promise<void> {
    if (!existsSync(this.descriptorPath)) {
      await this.save({ sha: "", files: [] });
    }
  }

  getDescriptor(): IDescriptor | null {
    return this.descriptor;
  }

  setSha(sha: string): void {
    if (this.descriptor) {
      this.descriptor.sha = sha;
    }
  }

  setProjectDescription(description: string): void {
    if (this.descriptor) {
      this.descriptor.projectDescription = description;
    }
  }

  getFileEntry(filePath: string): IFileEntry | undefined {
    return this.descriptor?.files.find(f => f.name === filePath);
  }

  upsertFileEntry(entry: IFileEntry): void {
    if (!this.descriptor) return;

    const index = this.descriptor.files.findIndex(f => f.name === entry.name);
    if (index !== -1) {
      this.descriptor.files[index] = entry;
    } else {
      this.descriptor.files.push(entry);
    }
  }

  removeFileEntry(filePath: string): void {
    if (!this.descriptor) return;
    this.descriptor.files = this.descriptor.files.filter(f => f.name !== filePath);
  }

  getTestFiles(): IFileEntry[] {
    return this.descriptor?.files.filter(f => f.type === "test") || [];
  }

  getSourceFiles(): IFileEntry[] {
    return this.descriptor?.files.filter(f => f.type === "source") || [];
  }

  findByKeywords(keywords: string[]): IFileEntry[] {
    if (!this.descriptor) return [];

    const searchWords = keywords.map(k => k.toLowerCase());

    return this.descriptor.files
      .map(file => {
        const fileWords = new Set(file.keywords.map(k => k.toLowerCase()));
        let overlap = 0;
        for (const word of searchWords) {
          if (fileWords.has(word)) overlap++;
        }
        return { file, overlap };
      })
      .filter(item => item.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .map(item => item.file);
  }

  computeKeywordOverlap(entryA: IFileEntry, entryB: IFileEntry): { score: number; matched: string[] } {
    const wordsA = entryA.keywords.map(k => k.toLowerCase());
    const wordsB = entryB.keywords.map(k => k.toLowerCase());
    
    // Fuzzy match: check if a word from B is contained in any keyword of A
    const matched = wordsB.filter(w => wordsA.some(a => a.includes(w) || w.includes(a)));
    
    return {
      score: matched.length,
      matched
    };
  }
}
