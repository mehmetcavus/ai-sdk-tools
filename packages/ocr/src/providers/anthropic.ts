import { generateText } from "ai";
import type { z } from "zod";
import { retryCall } from "../utils.js";
import type { ExtractOptions, ProviderResult } from "./types.js";

let anthropicProvider: any;

async function getAnthropicProvider(config?: {
  model?: string;
  apiKey?: string;
}) {
  if (!anthropicProvider) {
    try {
      // @ts-expect-error - Optional peer dependency
      const anthropic = await import("@ai-sdk/anthropic");
      anthropicProvider = anthropic.anthropic;
    } catch {
      throw new Error(
        "@ai-sdk/anthropic is not installed. Install it with: npm install @ai-sdk/anthropic",
      );
    }
  }

  const apiKey = config?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Anthropic API key is required. Set ANTHROPIC_API_KEY or provide apiKey in config",
    );
  }

  const model = config?.model || "claude-haiku-4-5-20251001";
  return anthropicProvider(model, { apiKey });
}

/**
 * Build a JSON template description from a Zod schema for prompt injection.
 * Works with Zod v4's internal structure where _def.type + _def.shape are used
 * instead of v3's typeName-based approach.
 */
function schemaToJsonTemplate(schema: z.ZodTypeAny): unknown {
  const def = (schema as any)._def;

  if (def.shape && typeof def.shape === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(def.shape)) {
      result[key] = schemaToJsonTemplate(value as z.ZodTypeAny);
    }
    return result;
  }

  if (def.innerType) {
    return schemaToJsonTemplate(def.innerType);
  }

  if (def.type === "array" && def.element) {
    return [schemaToJsonTemplate(def.element)];
  }

  const type = def.type;
  if (type === "string") return "<string>";
  if (type === "number") return "<number>";
  if (type === "boolean") return "<boolean>";

  return "<value>";
}

/**
 * Anthropic provider avoids Output.object() because Anthropic's structured output
 * compilation fails when schemas have more than 16 nullable/union parameters.
 * Instead, we prompt for JSON and parse with Zod.
 */
export async function extractWithAnthropic<T>(
  options: ExtractOptions<T>,
  config?: { model?: string; apiKey?: string },
): Promise<ProviderResult<T>> {
  const startTime = Date.now();

  try {
    const model = await getAnthropicProvider(config);

    const isPdf = options.input.mediaType === "application/pdf";

    const contentPart = isPdf
      ? {
          type: "file" as const,
          data: options.input.data,
          mediaType: options.input.mediaType,
        }
      : {
          type: "image" as const,
          image: `data:${options.input.mediaType};base64,${options.input.data}`,
        };

    const jsonTemplate = schemaToJsonTemplate(options.schema);

    const result = await retryCall(
      () =>
        generateText({
          model,
          temperature: 0.1,
          abortSignal: AbortSignal.timeout(options.timeout ?? 20000),
          system: `${options.prompt}\n\nYou MUST respond with ONLY a valid JSON object (no markdown fences, no explanation). Extract ALL fields where data is visible. Use null for fields not present in the document. Follow this exact structure:\n${JSON.stringify(jsonTemplate, null, 2)}`,
          messages: [
            {
              role: "user",
              content: [contentPart],
            },
          ],
        }),
      {
        retries: options.retries ?? 3,
        timeout: options.timeout ?? 20000,
      },
    );

    let jsonText = result.text.trim();
    const fenceMatch = jsonText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }

    const parsed = options.schema.parse(JSON.parse(jsonText));

    return {
      success: true,
      result: parsed as T,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      duration: Date.now() - startTime,
    };
  }
}
