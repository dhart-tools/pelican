import React, { useState, useEffect } from "react";
import { render } from "ink";
import { OllamaService } from "../llm/ollama.js";
import { DescriptorStore } from "../store/descriptor.js";
import { loadConfig, writeDefaultConfig } from "../config.js";
import { SetupView } from "../ui/components/SetupView.js";

interface SetupStep {
  name: string;
  status: "loading" | "success" | "error" | "idle";
  detail?: string;
}

function SetupApp({ modelOverride }: { modelOverride?: string }) {
  const [steps, setSteps] = useState<SetupStep[]>([
    { name: "Checking Ollama", status: "loading" },
    { name: "Pulling model", status: "idle" },
    { name: "Initializing descriptor", status: "idle" },
    { name: "Creating config", status: "idle" },
  ]);

  const [pullProgress, setPullProgress] = useState<{
    status: string;
    completed?: number;
    total?: number;
  }>();

  useEffect(() => {
    async function runSetup() {
      const projectRoot = process.cwd();
      const config = await loadConfig(projectRoot);
      const model = modelOverride || config.model;
      const ollama = new OllamaService(config.ollamaHost, model);

      // Step 1: Check Connection
      const isConnected = await ollama.checkConnection();
      if (!isConnected) {
        setSteps((prev) => [
          { ...prev[0], status: "error", detail: `Could not connect to ${config.ollamaHost}` },
          ...prev.slice(1),
        ]);
        return;
      }
      setSteps((prev) => [
        { ...prev[0], status: "success", detail: `Connected to ${config.ollamaHost}` },
        { ...prev[1], status: "loading" },
        ...prev.slice(2),
      ]);

      // Step 2: Check/Pull Model
      const isAvailable = await ollama.isModelAvailable();
      if (!isAvailable) {
        try {
          await ollama.pullModel((progress) => {
            setPullProgress(progress);
          });
        } catch (err: any) {
          setSteps((prev) => [
            prev[0],
            { ...prev[1], status: "error", detail: `Failed to pull ${model}: ${err.message}` },
            ...prev.slice(2),
          ]);
          return;
        }
      }
      setSteps((prev) => [
        prev[0],
        { ...prev[1], status: "success", detail: `Model ${model} ready` },
        { ...prev[2], status: "loading" },
        ...prev.slice(3),
      ]);

      // Step 3: Descriptor
      const store = new DescriptorStore(process.cwd());
      await store.init();
      setSteps((prev) => [
        prev[0],
        prev[1],
        { ...prev[2], status: "success", detail: "descriptor.json initialized" },
        { ...prev[3], status: "loading" },
      ]);

      // Step 4: Config
      await writeDefaultConfig(projectRoot);
      setSteps((prev) => [
        prev[0],
        prev[1],
        prev[2],
        { ...prev[3], status: "success", detail: ".suggestorrc.json ready" },
      ]);
    }

    runSetup();
  }, [modelOverride]);

  return <SetupView steps={steps} pullProgress={pullProgress} />;
}

export async function setupCommand(options: { light?: boolean }): Promise<void> {
  const modelOverride = options.light ? "qwen2.5-coder:1.5b" : undefined;
  const { waitUntilExit } = render(<SetupApp modelOverride={modelOverride} />);
  await waitUntilExit();
}
