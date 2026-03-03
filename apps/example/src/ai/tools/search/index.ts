import { withModelInfo } from "@ai-sdk-tools/agents";
import { modelFor } from "@/ai/models";
import { createOpenAIWebSearch } from "./openai-web-search";
import { createAnthropicWebSearch } from "./anthropic-web-search";
import type { WebSearchFactory } from "./types";

const WEB_SEARCH_DEFAULT = "openai";

const implementations: Record<string, WebSearchFactory> = {
  openai: createOpenAIWebSearch,
  anthropic: createAnthropicWebSearch,
};

function resolveWebSearchProvider(): string {
  const override = process.env.WEB_SEARCH_PROVIDER;
  if (override) {
    if (override in implementations) return override;
    console.warn(
      `[web-search] WEB_SEARCH_PROVIDER="${override}" has no implementation. Ignoring.`,
    );
  }

  const modelProvider = process.env.MODEL_PROVIDER;
  if (modelProvider && modelProvider in implementations) return modelProvider;

  return WEB_SEARCH_DEFAULT;
}

const provider = resolveWebSearchProvider();

export const webSearchTool = withModelInfo(
  implementations[provider](),
  { model: modelFor("fast", provider), provider, tier: "fast" },
);

console.info(`[web-search] Using ${provider} web search`);
