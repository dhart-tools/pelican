import { Ollama } from "ollama";
import type { ILLMAnalysisResult, ISuggestionResult } from "../types.js";

export class OllamaService {
  private client: Ollama;
  private model: string;

  constructor(host: string, model: string) {
    this.client = new Ollama({ host });
    this.model = model;
  }

  // ─── Connection ──────────────────────────────────────────

  async checkConnection(): Promise<boolean> {
    try {
      await this.client.list();
      return true;
    } catch {
      return false;
    }
  }

  // ─── Model Management ────────────────────────────────────

  async isModelAvailable(): Promise<boolean> {
    try {
      const list = await this.client.list();
      return list.models.some((m) => m.name.startsWith(this.model));
    } catch {
      return false;
    }
  }

  async pullModel(
    onProgress?: (progress: {
      status: string;
      completed?: number;
      total?: number;
    }) => void
  ): Promise<void> {
    const stream = await this.client.pull({ model: this.model, stream: true });

    for await (const chunk of stream) {
      onProgress?.({
        status: chunk.status,
        completed: chunk.completed,
        total: chunk.total,
      });
    }
  }

  // ─── Generation ──────────────────────────────────────────

  async generate(prompt: string): Promise<string> {
    const response = await this.client.generate({
      model: this.model,
      prompt,
      stream: false,
      options: { temperature: 0.1 },
    });

    const text = response.response.trim();
    if (!text) {
      throw new Error("Empty response from LLM");
    }
    return text;
  }

  async generateJSON<T>(prompt: string): Promise<T> {
    const raw = await this.generate(prompt);
    return OllamaService.extractJSON<T>(raw);
  }

  // ─── JSON Extraction (static, testable) ──────────────────

  static extractJSON<T>(raw: string): T {
    // Strategy 1: Direct parse
    try {
      return JSON.parse(raw) as T;
    } catch {
      // continue
    }

    // Strategy 2: Extract from ```json ... ``` code block
    const jsonBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (jsonBlockMatch) {
      try {
        return JSON.parse(jsonBlockMatch[1].trim()) as T;
      } catch {
        // continue
      }
    }

    // Strategy 3: Find first { ... } or [ ... ] in the response
    const objectMatch = raw.match(/(\{[\s\S]*\})/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[1]) as T;
      } catch {
        // continue
      }
    }

    const arrayMatch = raw.match(/(\[[\s\S]*\])/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[1]) as T;
      } catch {
        // continue
      }
    }

    throw new Error(
      `Failed to parse JSON from LLM response. Raw output:\n${raw.slice(0, 500)}`
    );
  }

  // ─── Getters ─────────────────────────────────────────────

  getModel(): string {
    return this.model;
  }

  getClient(): Ollama {
    return this.client;
  }
}
