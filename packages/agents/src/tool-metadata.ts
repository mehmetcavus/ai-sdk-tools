import type { LanguageModel, Tool } from "ai";

export interface ToolModelInfo {
	model?: string;
	provider?: string;
	tier?: string;
}

const MODEL_INFO_KEY = "_modelInfo";

/**
 * Attach model/provider metadata to a tool for devtools visualization.
 *
 * Only needed for tools that internally call an LLM (e.g., web search).
 * Data-only tools should NOT use this — they'll correctly show no model info.
 *
 * @example
 * ```typescript
 * import { withModelInfo } from '@ai-sdk-tools/agents';
 *
 * export const webSearchTool = withModelInfo(
 *   tool({ description: '...', execute: async () => { ... } }),
 *   { model: modelFor('fast', 'openai'), provider: 'openai' }
 * );
 * ```
 */
export function withModelInfo(
	t: Tool,
	info: { model: LanguageModel | string; provider: string; tier?: string },
): Tool {
	const modelId =
		typeof info.model === "string" ? info.model : info.model.modelId;

	return Object.assign(t, {
		[MODEL_INFO_KEY]: { model: modelId, provider: info.provider, tier: info.tier },
	});
}

/**
 * Extract model info from a tool, if it was attached via `withModelInfo`.
 * Returns undefined for plain tools without metadata.
 */
export function getToolModelInfo(t: Tool): ToolModelInfo | undefined {
	return (t as Record<string, unknown>)[MODEL_INFO_KEY] as
		| ToolModelInfo
		| undefined;
}

/**
 * Scan a tools record and extract all declared model info into a map.
 */
export function extractToolModelInfo(
	tools: Record<string, Tool>,
): Record<string, ToolModelInfo> {
	const result: Record<string, ToolModelInfo> = {};
	for (const [name, tool] of Object.entries(tools)) {
		const info = getToolModelInfo(tool);
		if (info) result[name] = info;
	}
	return result;
}
