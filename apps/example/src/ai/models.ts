import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createModelRegistry } from "@ai-sdk-tools/agents";

export const { model, modelFor } = createModelRegistry({
  tiers: ["reasoning", "smart", "fast", "nano"] as const,
  defaultProvider: "openai",
  providers: { openai, anthropic },
  profiles: {
    openai: {
      reasoning: "o3-mini",
      smart: "gpt-4o",
      fast: "gpt-4o-mini",
      nano: "gpt-4.1-nano",
    },
    anthropic: {
      reasoning: "claude-sonnet-4-20250514",
      smart: "claude-sonnet-4-20250514",
      fast: "claude-haiku-3-5-20241022",
      nano: "claude-haiku-3-5-20241022",
    },
  },
});

export type ModelTier = "reasoning" | "smart" | "fast" | "nano";
