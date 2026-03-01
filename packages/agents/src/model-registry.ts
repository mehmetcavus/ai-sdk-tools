import type { LanguageModel } from "ai";

/**
 * Configuration for creating a model registry.
 * @template TTier - String literal union of tier names (e.g. "reasoning" | "smart" | "fast" | "nano")
 */
export interface ModelRegistryConfig<TTier extends string> {
	/** Ordered list of tier names. Used for startup logging and validation. */
	tiers: readonly TTier[];
	/** Provider to use when MODEL_PROVIDER env var is not set or is invalid. */
	defaultProvider: string;
	/** Map of provider name → factory function that creates a LanguageModel from a model ID. */
	providers: Record<string, (modelId: string) => LanguageModel>;
	/**
	 * Per-provider model profiles. Each profile maps tiers to model IDs.
	 * Profiles can be partial — missing tiers fall back to the defaultProvider.
	 */
	profiles: Record<string, Partial<Record<TTier, string>>>;
}

export interface ModelRegistry<TTier extends string> {
	/** Resolve a tier to its configured LanguageModel using the active provider. */
	model: (tier: TTier) => LanguageModel;
	/** Resolve a tier from a specific provider's profile (for provider-executed tools). */
	modelFor: (tier: TTier, provider: string) => LanguageModel;
	/** The provider that was resolved at startup. */
	activeProvider: string;
}

/**
 * Create a model registry that decouples agents from specific providers and model strings.
 *
 * Resolution cascade (most specific wins):
 * 1. Per-tier env override: MODEL_SMART=anthropic:claude-sonnet-4-20250514
 * 2. Global provider env:  MODEL_PROVIDER=anthropic → uses that provider's profile
 * 3. Code default:         defaultProvider → uses its profile
 *
 * @example
 * ```typescript
 * import { createModelRegistry } from '@ai-sdk-tools/agents';
 * import { openai } from '@ai-sdk/openai';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * const { model } = createModelRegistry({
 *   tiers: ['reasoning', 'smart', 'fast', 'nano'] as const,
 *   defaultProvider: 'openai',
 *   providers: { openai, anthropic },
 *   profiles: {
 *     openai: { reasoning: 'o3-mini', smart: 'gpt-4o', fast: 'gpt-4o-mini', nano: 'gpt-4.1-nano' },
 *     anthropic: { reasoning: 'claude-sonnet-4-20250514', smart: 'claude-sonnet-4-20250514', fast: 'claude-haiku-3-5-20241022', nano: 'claude-haiku-3-5-20241022' },
 *   },
 * });
 *
 * // In agents: model('fast'), model('smart'), etc.
 * // Switch all: MODEL_PROVIDER=anthropic
 * // Override one: MODEL_SMART=anthropic:claude-sonnet-4-20250514
 * ```
 */
export function createModelRegistry<TTier extends string>(
	config: ModelRegistryConfig<TTier>,
): ModelRegistry<TTier> {
	const { tiers, defaultProvider, providers, profiles } = config;

	function getActiveProvider(): string {
		const env = process.env.MODEL_PROVIDER;
		if (!env) return defaultProvider;

		if (!(env in profiles)) {
			console.warn(
				`[models] MODEL_PROVIDER="${env}" is not a known provider (${Object.keys(profiles).join(", ")}). Falling back to "${defaultProvider}".`,
			);
			return defaultProvider;
		}

		if (!(env in providers)) {
			console.warn(
				`[models] MODEL_PROVIDER="${env}" has a profile but no factory (missing import?). Falling back to "${defaultProvider}".`,
			);
			return defaultProvider;
		}

		return env;
	}

	function resolve(tier: TTier, active: string): LanguageModel {
		const envKey = `MODEL_${tier.toUpperCase()}`;
		const tierOverride = process.env[envKey];

		if (tierOverride) {
			const colonIdx = tierOverride.indexOf(":");
			if (colonIdx === -1) {
				console.warn(
					`[models] ${envKey}="${tierOverride}" — expected "provider:model" format. Ignoring.`,
				);
			} else {
				const provider = tierOverride.slice(0, colonIdx);
				const modelId = tierOverride.slice(colonIdx + 1);
				const factory = providers[provider];
				if (!factory) {
					console.warn(
						`[models] ${envKey} references unknown provider "${provider}". Ignoring.`,
					);
				} else {
					return factory(modelId);
				}
			}
		}

		const activeModelId = profiles[active]?.[tier];
		if (activeModelId && providers[active]) {
			return providers[active](activeModelId);
		}

		const fallbackModelId = profiles[defaultProvider]?.[tier];
		if (!fallbackModelId) {
			throw new Error(
				`[models] No model for tier "${tier}" in default provider "${defaultProvider}". This is a configuration bug.`,
			);
		}

		console.warn(
			`[models] Provider "${active}" has no "${tier}" model. Falling back to ${defaultProvider}:${fallbackModelId}`,
		);
		return providers[defaultProvider](fallbackModelId);
	}

	const active = getActiveProvider();
	const resolved = {} as Record<TTier, LanguageModel>;
	const resolutionLog: string[] = [];

	for (const tier of tiers) {
		resolved[tier] = resolve(tier, active);

		const envKey = `MODEL_${tier.toUpperCase()}`;
		const tierOverride = process.env[envKey];
		if (tierOverride) {
			resolutionLog.push(
				`  ${String(tier).padEnd(10)} → ${tierOverride} (env override)`,
			);
		} else if (profiles[active]?.[tier]) {
			resolutionLog.push(
				`  ${String(tier).padEnd(10)} → ${active}:${profiles[active][tier]}`,
			);
		} else {
			resolutionLog.push(
				`  ${String(tier).padEnd(10)} → ${defaultProvider}:${profiles[defaultProvider][tier]} (fallback)`,
			);
		}
	}

	console.info(
		`[models] Active provider: ${active}\n${resolutionLog.join("\n")}`,
	);

	function resolveFor(tier: TTier, provider: string): LanguageModel {
		const factory = providers[provider];
		if (!factory) {
			throw new Error(
				`[models] modelFor("${tier}", "${provider}") — provider "${provider}" has no factory.`,
			);
		}

		const modelId = profiles[provider]?.[tier];
		if (!modelId) {
			throw new Error(
				`[models] modelFor("${tier}", "${provider}") — provider "${provider}" has no "${tier}" tier.`,
			);
		}

		return factory(modelId);
	}

	return {
		model: (tier: TTier) => resolved[tier],
		modelFor: (tier: TTier, provider: string) => resolveFor(tier, provider),
		activeProvider: active,
	};
}
