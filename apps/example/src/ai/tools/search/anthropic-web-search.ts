import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { AppContext } from "@/ai/agents/shared";
import { modelFor } from "@/ai/models";
import type {
  WebSearchFactory,
  WebSearchResult,
  WebSearchSource,
} from "./types";

export const createAnthropicWebSearch: WebSearchFactory = () =>
  tool({
    description:
      "Search the web for current information, prices, news, and external data. Returns concise factual data for analysis.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Search query (2-4 words max for faster results)"),
    }),
    execute: async ({ query }, executionOptions): Promise<WebSearchResult> => {
      const appContext = executionOptions.experimental_context as AppContext;

      try {
        const result = await generateText({
          model: modelFor("fast", "anthropic"),
          prompt: `<search-request>
                  Search for: ${query}
                  Current date: ${appContext.currentDateTime}
                  Focus on recent information.
                </search-request>`,
          stopWhen: stepCountIs(3),
          tools: {
            web_search: anthropic.tools.webSearch_20250305({
              maxUses: 3,
              ...(appContext.country
                ? {
                    userLocation: {
                      type: "approximate" as const,
                      country: appContext.country,
                      timezone: appContext.timezone,
                    },
                  }
                : {}),
            }),
          },
        });

        const rawSources: Array<{ url: string; title?: string }> = [];
        const seenUrls = new Set<string>();

        // Anthropic web search is a server-side tool — sources are normalized
        // by the AI SDK into step content and/or result.sources.
        for (const step of result.steps ?? []) {
          if (Array.isArray(step.content)) {
            for (const item of step.content) {
              if (
                item.type === "source" &&
                "sourceType" in item &&
                item.sourceType === "url" &&
                !seenUrls.has(item.url)
              ) {
                seenUrls.add(item.url);
                rawSources.push({
                  url: item.url,
                  title: ("title" in item ? item.title : undefined) || item.url,
                });
              }
            }
          }
        }

        // AI SDK v6 also exposes a top-level sources array
        if (Array.isArray((result as any).sources)) {
          for (const source of (result as any).sources) {
            if (
              source.sourceType === "url" &&
              source.url &&
              !seenUrls.has(source.url)
            ) {
              seenUrls.add(source.url);
              rawSources.push({
                url: source.url,
                title: source.title || source.url,
              });
            }
          }
        }

        const formattedSources: WebSearchSource[] = rawSources
          .slice(0, 3)
          .map((source) => ({
            url: source.url,
            title: source.title || source.url,
          }));

        const contextData = result.text || "";

        return {
          query,
          found: formattedSources.length,
          context: contextData,
          sources: formattedSources,
        };
      } catch (error) {
        return {
          query,
          found: 0,
          context: null,
          sources: [],
          error: error instanceof Error ? error.message : "Search failed",
        };
      }
    },
  });
