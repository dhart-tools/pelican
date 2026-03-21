import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    OLLAMA_HOST: z.string().url().default("http://localhost:11434"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
