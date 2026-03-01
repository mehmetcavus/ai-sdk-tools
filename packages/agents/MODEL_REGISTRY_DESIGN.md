# Model Registry Design

A flexible, provider-agnostic model configuration system for `@ai-sdk-tools/agents`. Switch providers with one env var, assign the right model to each task, and scale to hundreds of agents without touching agent files.

## Problem

When agents hardcode provider imports and model strings, every file is tightly coupled to a specific provider:

```typescript
// Every agent file repeats this pattern
import { openai } from "@ai-sdk/openai";

export const customersAgent = createAgent({
  name: "customers",
  model: openai("gpt-4o-mini"),   // hardcoded provider + model
});
```

### What breaks at scale

| Problem | Impact |
| ------- | ------ |
| **Provider lock-in** | Switching to Anthropic requires updating imports and model strings in every file |
| **No cost/performance tiering** | Agents pick arbitrary model strings instead of declaring capability needs |
| **No central visibility** | Impossible to see what model each agent uses without grepping the codebase |
| **No runtime flexibility** | Can't A/B test providers or switch models per environment |
| **Doesn't scale** | 200+ agents means 200+ files to update for a provider switch |

---

## Solution: Two-Layer Architecture

The model registry follows the same **mechanism-vs-policy** pattern used for memory:

- **Package (`@ai-sdk-tools/agents`)** provides the mechanism — `createModelRegistry()` factory, types, resolution logic, validation, startup logging
- **App** provides the policy — which providers, which profiles, which default

### Resolution Cascade

```
Per-agent `model:` override    (escape hatch in agent config)
        ↓ not set?
Per-tier env var               MODEL_SMART=provider:model-id
        ↓ not set?
Global provider env            MODEL_PROVIDER=anthropic → uses that provider's profile
        ↓ not set?
Code default                   defaultProvider → "openai" → uses openai profile
```

Four layers, each more specific than the last. Agent files never reference providers or model strings directly.

---

## Package Side: `createModelRegistry()`

The package exports a generic factory function with zero provider dependencies. Apps bring their own providers.

```typescript
// @ai-sdk-tools/agents — exported from package
import type { LanguageModel } from "ai";

interface ModelRegistryConfig<TTier extends string> {
  tiers: readonly TTier[];
  defaultProvider: string;
  providers: Record<string, (modelId: string) => LanguageModel>;
  profiles: Record<string, Partial<Record<TTier, string>>>;
}

interface ModelRegistry<TTier extends string> {
  /** Resolve a tier using the active provider (the common path for agents). */
  model: (tier: TTier) => LanguageModel;
  /** Resolve a tier from a specific provider's profile (for provider-executed tools). */
  modelFor: (tier: TTier, provider: string) => LanguageModel;
  activeProvider: string;
}

function createModelRegistry<TTier extends string>(
  config: ModelRegistryConfig<TTier>
): ModelRegistry<TTier> {
  const { tiers, defaultProvider, providers, profiles } = config;

  function getActiveProvider(): string {
    const env = process.env.MODEL_PROVIDER;
    if (!env) return defaultProvider;

    if (!(env in profiles)) {
      console.warn(
        `[models] MODEL_PROVIDER="${env}" is not a known provider ` +
        `(${Object.keys(profiles).join(", ")}). Falling back to "${defaultProvider}".`
      );
      return defaultProvider;
    }

    if (!(env in providers)) {
      console.warn(
        `[models] MODEL_PROVIDER="${env}" has a profile but no factory ` +
        `(missing import?). Falling back to "${defaultProvider}".`
      );
      return defaultProvider;
    }

    return env;
  }

  function resolve(tier: TTier, active: string): LanguageModel {
    // Layer 1: Per-tier env override (MODEL_SMART=anthropic:claude-sonnet-4-20250514)
    const tierOverride = process.env[`MODEL_${tier.toUpperCase()}`];
    if (tierOverride) {
      const colonIdx = tierOverride.indexOf(":");
      if (colonIdx === -1) {
        console.warn(
          `[models] MODEL_${tier.toUpperCase()}="${tierOverride}" ` +
          `— expected "provider:model" format. Ignoring.`
        );
      } else {
        const provider = tierOverride.slice(0, colonIdx);
        const modelId = tierOverride.slice(colonIdx + 1);
        const factory = providers[provider];
        if (!factory) {
          console.warn(
            `[models] MODEL_${tier.toUpperCase()} references unknown ` +
            `provider "${provider}". Ignoring.`
          );
        } else {
          return factory(modelId);
        }
      }
    }

    // Layer 2: Active provider's profile
    const activeModelId = profiles[active]?.[tier];
    if (activeModelId && providers[active]) {
      return providers[active](activeModelId);
    }

    // Layer 3: Fallback to default provider for this tier
    const fallbackModelId = profiles[defaultProvider]?.[tier];
    if (!fallbackModelId) {
      throw new Error(
        `[models] No model for tier "${tier}" in default provider ` +
        `"${defaultProvider}". This is a configuration bug.`
      );
    }

    console.warn(
      `[models] Provider "${active}" has no "${tier}" model. ` +
      `Falling back to ${defaultProvider}:${fallbackModelId}`
    );
    return providers[defaultProvider](fallbackModelId);
  }

  // Resolve all tiers once at startup
  const active = getActiveProvider();
  const resolved = {} as Record<TTier, LanguageModel>;
  const resolutionLog: string[] = [];

  for (const tier of tiers) {
    resolved[tier] = resolve(tier, active);

    const tierOverride = process.env[`MODEL_${tier.toUpperCase()}`];
    if (tierOverride) {
      resolutionLog.push(`  ${String(tier).padEnd(10)} → ${tierOverride} (env override)`);
    } else if (profiles[active]?.[tier]) {
      resolutionLog.push(
        `  ${String(tier).padEnd(10)} → ${active}:${profiles[active][tier]}`
      );
    } else {
      resolutionLog.push(
        `  ${String(tier).padEnd(10)} → ${defaultProvider}:${profiles[defaultProvider][tier]} (fallback)`
      );
    }
  }

  console.info(
    `[models] Active provider: ${active}\n${resolutionLog.join("\n")}`
  );

  // Provider-targeted lookup for provider-executed tools
  function resolveFor(tier: TTier, provider: string): LanguageModel {
    const factory = providers[provider];
    if (!factory) {
      throw new Error(
        `[models] modelFor("${tier}", "${provider}") — provider "${provider}" has no factory.`
      );
    }

    const modelId = profiles[provider]?.[tier];
    if (!modelId) {
      throw new Error(
        `[models] modelFor("${tier}", "${provider}") — provider "${provider}" has no "${tier}" tier.`
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
```

### Key design decisions

- **Generic `TTier`** — apps define their own tiers (`"reasoning"`, `"smart"`, `"fast"`, `"nano"`, `"vision"`, etc.)
- **`Partial<Record<TTier, string>>`** — profiles can omit tiers they don't support; missing tiers fall back to the default provider
- **Zero provider dependencies** — the package never imports `@ai-sdk/openai`, `@ai-sdk/anthropic`, etc.
- **Resolved once at startup** — no per-request overhead for `model()` (the common path)
- **`modelFor()` resolves on-demand** — used by provider-executed tools that need a model from a specific provider regardless of the active provider
- **Startup logging** — full visibility into what resolved to what

---

## App Side: Configuration

The app imports concrete providers and configures the registry.

### `src/ai/models.ts` — registry configuration

```typescript
// apps/example/src/ai/models.ts
import { createModelRegistry } from "@ai-sdk-tools/agents";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

export type ModelTier = "reasoning" | "smart" | "fast" | "nano";

export const { model, modelFor } = createModelRegistry({
  tiers: ["reasoning", "smart", "fast", "nano"] as const,
  defaultProvider: "openai",
  providers: { openai, anthropic },
  profiles: {
    openai: {
      reasoning: "o3-mini",
      smart:     "gpt-4o",
      fast:      "gpt-4o-mini",
      nano:      "gpt-4.1-nano",
    },
    anthropic: {
      reasoning: "claude-sonnet-4-20250514",
      smart:     "claude-sonnet-4-20250514",
      fast:      "claude-haiku-3-5-20241022",
      nano:      "claude-haiku-3-5-20241022",
    },
  },
});
```

### `model()` vs `modelFor()` — when to use which

| Function | Resolves from | Use for |
| -------- | ------------- | ------- |
| `model("fast")` | Active provider (from `MODEL_PROVIDER` env) | Agents, tools with no provider coupling |
| `modelFor("fast", "openai")` | Specified provider's profile | Provider-executed tools (web search, code execution) that require a model from the same provider |

`model()` is the common path — used by all agents. `modelFor()` exists specifically for provider-executed tools where the model and tool must be from the same provider (see [Provider-Executed Tools](#provider-executed-tools-web-search) below).

### `src/ai/agents/shared.ts` — `createAgent` with tier support

The app's `createAgent` wrapper adds a `tier` field to `AgentConfig`. The `model` field becomes optional — agents declare intent via `tier`, and `createAgent` resolves it.

```typescript
// apps/example/src/ai/agents/shared.ts
import { model, type ModelTier } from "../models";

interface AgentConfig<TContext extends Record<string, unknown>> {
  name: string;
  tier?: ModelTier;          // declare capability need
  model?: LanguageModel;     // optional: direct override (escape hatch)
  instructions: string | ((context: TContext) => string);
  tools?: Record<string, Tool> | ((context: TContext) => Record<string, Tool>);
  handoffs?: Array<any>;
  handoffDescription?: string;
  maxTurns?: number;
  temperature?: number;
  modelSettings?: Record<string, unknown>;
  matchOn?: (string | RegExp)[] | ((message: string) => boolean);
}

export const createAgent = (config: AgentConfig<AppContext>) => {
  return new Agent({
    modelSettings: { parallel_tool_calls: true },
    ...config,
    model: config.model ?? model(config.tier ?? "fast"),  // resolve here
    memory: {
      // ...
      chats: {
        generateTitle: {
          model: model("nano"),       // was: openai("gpt-4.1-nano")
        },
        generateSuggestions: {
          model: model("nano"),       // was: openai("gpt-4.1-nano")
        },
      },
    },
  });
};
```

### Agent files — before and after

**Before:**

```typescript
// apps/example/src/ai/agents/customers.ts
import { openai } from "@ai-sdk/openai";
import { createAgent, formatContextForLLM } from "./shared";

export const customersAgent = createAgent({
  name: "customers",
  model: openai("gpt-4o-mini"),
  temperature: 0.3,
  instructions: (ctx) => `...`,
  tools: { /* ... */ },
  maxTurns: 5,
});
```

**After:**

```typescript
// apps/example/src/ai/agents/customers.ts
import { createAgent, formatContextForLLM } from "./shared";

export const customersAgent = createAgent({
  name: "customers",
  tier: "fast",
  temperature: 0.3,
  instructions: (ctx) => `...`,
  tools: { /* ... */ },
  maxTurns: 5,
});
```

No provider import. No model string. Just a semantic tier.

### Direct model override — the escape hatch

When an agent needs a specific model that doesn't fit any tier (fine-tuned models, experiments, provider-specific features), the `model` field takes priority over `tier`:

```typescript
import { openai } from "@ai-sdk/openai";
import { createAgent } from "./shared";

export const specialAgent = createAgent({
  name: "special",
  model: openai("ft:gpt-4o:my-org:custom:abc123"),  // bypasses registry
  instructions: (ctx) => `...`,
});
```

Resolution order in `createAgent`:

```typescript
config.model ?? model(config.tier ?? "fast")
//   ↑ wins if set     ↑ tier lookup     ↑ default tier
```

### Three usage patterns

| Pattern | When | Example |
| ------- | ---- | ------- |
| `tier: "fast"` | 99% of agents | `createAgent({ tier: "fast", ... })` |
| No tier, no model | Uses default tier ("fast") | `createAgent({ name: "simple", ... })` |
| `model: provider("...")` | Escape hatch for fine-tuned / experimental models | `createAgent({ model: openai("ft:..."), ... })` |

---

## Provider-Executed Tools (Web Search)

Some AI SDK tools are **provider-executed** — they run on the provider's servers, not locally. These tools **must be paired with a model from the same provider**. You cannot use `openai.tools.webSearch()` with an Anthropic model or vice versa.

This creates a different challenge from agents: when `MODEL_PROVIDER=anthropic`, agents automatically get Anthropic models via `model("fast")`, but a web search tool using `openai.tools.webSearch()` would break because it's now receiving an Anthropic model for an OpenAI server-side tool.

### The constraint

| Tool Type | Model coupling | Example |
| --------- | -------------- | ------- |
| Regular tools (CRUD, analytics) | Provider-agnostic — `model("fast")` works | `tool({ execute: ... })` |
| Provider-executed tools | Must match provider — model and tool from same provider | `openai.tools.webSearch()`, `anthropic.tools.webSearch_20250305()` |

### Solution: Web Search Factory with `modelFor()`

Each provider's web search lives in its own file. A factory in `index.ts` resolves which implementation to use, following the same cascade pattern as the model registry. Each implementation uses `modelFor()` to get the correct model from its own provider.

#### File structure

```
tools/search/
  index.ts                    — factory: resolves provider, exports webSearchTool
  types.ts                    — shared WebSearchResult type
  openai-web-search.ts        — OpenAI implementation
  anthropic-web-search.ts     — Anthropic implementation (future)
```

#### `types.ts` — shared contract

```typescript
// apps/example/src/ai/tools/search/types.ts
import type { Tool } from "ai";

export interface WebSearchResult {
  query: string;
  found: number;
  context: string | null;
  sources: Array<{ url: string; title: string }>;
  error?: string;
}

export type WebSearchFactory = () => Tool;
```

#### `openai-web-search.ts` — uses `modelFor("fast", "openai")`

The model is resolved from the OpenAI profile via `modelFor`, not hardcoded. If you change OpenAI's "fast" model in the registry, web search picks it up automatically.

```typescript
// apps/example/src/ai/tools/search/openai-web-search.ts
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { AppContext } from "@/ai/agents/shared";
import { modelFor } from "@/ai/models";
import type { WebSearchFactory } from "./types";

export const createOpenAIWebSearch: WebSearchFactory = () =>
  tool({
    description:
      "Search the web for current information, prices, news, and external data.",
    inputSchema: z.object({
      query: z.string().describe("Search query (2-4 words max)"),
    }),
    execute: async ({ query }, executionOptions) => {
      const appContext = executionOptions.experimental_context as AppContext;
      const result = await generateText({
        model: modelFor("fast", "openai"),  // fast tier, always from OpenAI profile
        prompt: `...`,
        stopWhen: stepCountIs(1),
        tools: {
          web_search: openai.tools.webSearch({
            searchContextSize: "low",
            userLocation: {
              type: "approximate",
              country: appContext.country,
              timezone: appContext.timezone,
            },
          }),
        },
        temperature: 0,
      });
      // ...parse OpenAI response format, return WebSearchResult
    },
  });
```

#### `anthropic-web-search.ts` — future implementation

```typescript
// apps/example/src/ai/tools/search/anthropic-web-search.ts (future)
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { AppContext } from "@/ai/agents/shared";
import { modelFor } from "@/ai/models";
import type { WebSearchFactory } from "./types";

export const createAnthropicWebSearch: WebSearchFactory = () =>
  tool({
    description:
      "Search the web for current information, prices, news, and external data.",
    inputSchema: z.object({
      query: z.string().describe("Search query (2-4 words max)"),
    }),
    execute: async ({ query }, executionOptions) => {
      const appContext = executionOptions.experimental_context as AppContext;
      const result = await generateText({
        model: modelFor("fast", "anthropic"),  // fast tier, always from Anthropic profile
        prompt: `...`,
        stopWhen: stepCountIs(1),
        tools: {
          web_search: anthropic.tools.webSearch_20250305({
            maxUses: 1,
            userLocation: {
              type: "approximate",
              country: appContext.country,
              timezone: appContext.timezone,
            },
          }),
        },
        temperature: 0,
      });
      // ...parse Anthropic response format (different from OpenAI)
    },
  });
```

#### `index.ts` — resolution cascade

```typescript
// apps/example/src/ai/tools/search/index.ts
import { createOpenAIWebSearch } from "./openai-web-search";
// import { createAnthropicWebSearch } from "./anthropic-web-search";
import type { WebSearchFactory } from "./types";

const WEB_SEARCH_DEFAULT = "openai";

const implementations: Record<string, WebSearchFactory> = {
  openai: createOpenAIWebSearch,
  // anthropic: createAnthropicWebSearch,   // uncomment when ready
};

function resolveWebSearchProvider(): string {
  // Layer 1: Explicit override
  const override = process.env.WEB_SEARCH_PROVIDER;
  if (override) {
    if (override in implementations) return override;
    console.warn(
      `[web-search] WEB_SEARCH_PROVIDER="${override}" has no implementation. Ignoring.`
    );
  }

  // Layer 2: Follow the active model provider
  const modelProvider = process.env.MODEL_PROVIDER;
  if (modelProvider && modelProvider in implementations) return modelProvider;

  // Layer 3: Default
  return WEB_SEARCH_DEFAULT;
}

const provider = resolveWebSearchProvider();
export const webSearchTool = implementations[provider]();

console.info(`[web-search] Using ${provider} web search`);
```

#### Web search resolution cascade

```
WEB_SEARCH_PROVIDER env var       (most specific — force a specific search provider)
        ↓ not set or no implementation?
MODEL_PROVIDER env var            (follow the model provider if it has an implementation)
        ↓ not set or no implementation?
WEB_SEARCH_DEFAULT                ("openai")
```

#### How it plays out

| `MODEL_PROVIDER` | `WEB_SEARCH_PROVIDER` | Anthropic impl exists? | Web search uses | Agents use |
|---|---|---|---|---|
| not set | not set | no | OpenAI (default) | OpenAI |
| `anthropic` | not set | no | OpenAI (fallback) | Anthropic |
| `anthropic` | not set | **yes** | Anthropic (follows model provider) | Anthropic |
| `anthropic` | `openai` | yes | OpenAI (explicit override) | Anthropic |
| `openai` | `anthropic` | yes | Anthropic (explicit override) | OpenAI |

#### Why `modelFor()` instead of hardcoding models

| Approach | What happens when OpenAI's "fast" changes from `gpt-4o-mini` to `gpt-4.1-mini` |
|----------|---|
| Hardcoded `openai("gpt-4o-mini")` | Must update `openai-web-search.ts` manually |
| `modelFor("fast", "openai")` | Automatically picks up the new model from the registry profile |

The web search implementation stays coupled to its **provider** (because it uses provider-specific tools like `openai.tools.webSearch()`), but decoupled from **which specific model** within that provider. The registry profile remains the single source of truth for model choices.

#### Adding a new web search provider

1. Create `src/ai/tools/search/<provider>-web-search.ts` with a `WebSearchFactory` export
2. Register it in `index.ts`:

```typescript
import { createNewProviderWebSearch } from "./<provider>-web-search";

const implementations: Record<string, WebSearchFactory> = {
  openai: createOpenAIWebSearch,
  anthropic: createAnthropicWebSearch,
  newProvider: createNewProviderWebSearch,
};
```

3. No other files change.

---

## Environment Variables

### Switch everything with one change

```bash
# .env.local — switch all agents to Anthropic
MODEL_PROVIDER=anthropic
```

### Mix providers per tier

```bash
# .env.local — Anthropic globally, but OpenAI for reasoning
MODEL_PROVIDER=anthropic
MODEL_REASONING=openai:o3-mini
```

### Per-tier override (most specific)

```bash
# .env.local — override just the smart tier
MODEL_SMART=anthropic:claude-sonnet-4-20250514
```

### Override web search provider

```bash
# .env.local — Anthropic for agents, but force OpenAI web search
MODEL_PROVIDER=anthropic
WEB_SEARCH_PROVIDER=openai
```

### No env vars (zero config)

Falls through to `defaultProvider` ("openai") using the openai profile, and OpenAI web search. Works out of the box with just `OPENAI_API_KEY`.

---

## Startup Logs

The registry logs its resolution on startup for full visibility.

**Default (no env vars):**

```
[models] Active provider: openai
  reasoning  → openai:o3-mini
  smart      → openai:gpt-4o
  fast       → openai:gpt-4o-mini
  nano       → openai:gpt-4.1-nano
```

**`MODEL_PROVIDER=anthropic`:**

```
[models] Active provider: anthropic
  reasoning  → anthropic:claude-sonnet-4-20250514
  smart      → anthropic:claude-sonnet-4-20250514
  fast       → anthropic:claude-haiku-3-5-20241022
  nano       → anthropic:claude-haiku-3-5-20241022
```

**`MODEL_PROVIDER=anthropic` with `MODEL_REASONING=openai:o3-mini`:**

```
[models] Active provider: anthropic
  reasoning  → openai:o3-mini (env override)
  smart      → anthropic:claude-sonnet-4-20250514
  fast       → anthropic:claude-haiku-3-5-20241022
  nano       → anthropic:claude-haiku-3-5-20241022
```

**Provider with missing tier (e.g. future `google` profile without `reasoning`):**

```
[models] Provider "google" has no "reasoning" model. Falling back to openai:o3-mini
[models] Active provider: google
  reasoning  → openai:o3-mini (fallback)
  smart      → google:gemini-2.5-pro
  fast       → google:gemini-2.5-flash
  nano       → google:gemini-2.5-flash
```

**Typo in env var:**

```
[models] MODEL_PROVIDER="gogle" is not a known provider (openai, anthropic). Falling back to "openai".
[models] Active provider: openai
  reasoning  → openai:o3-mini
  smart      → openai:gpt-4o
  fast       → openai:gpt-4o-mini
  nano       → openai:gpt-4.1-nano
```

---

## Error Handling

### Model registry

| Scenario | Behavior |
| -------- | -------- |
| Unknown `MODEL_PROVIDER` | Warn + fall back to `defaultProvider` |
| Provider profile exists but no factory | Warn + fall back to `defaultProvider` |
| Per-tier env var bad format | Warn + skip to Layer 2 |
| Per-tier env var unknown provider | Warn + skip to Layer 2 |
| Active provider missing a tier | Warn + fall back to `defaultProvider` for that tier |
| Default provider missing a tier | Hard `throw` — this is a configuration bug |
| `modelFor()` unknown provider | Hard `throw` — caller explicitly requested a non-existent provider |
| `modelFor()` provider missing tier | Hard `throw` — caller explicitly requested a missing tier |
| No env vars at all | Use `defaultProvider` profile silently |

### Web search

| Scenario | Behavior |
| -------- | -------- |
| `WEB_SEARCH_PROVIDER` set to unknown | Warn + skip to Layer 2 |
| `MODEL_PROVIDER` has no web search implementation | Fall back to `WEB_SEARCH_DEFAULT` ("openai") |
| No env vars at all | Use `WEB_SEARCH_DEFAULT` ("openai") silently |

---

## Migration Guide (Example App)

### Current model usage

| File | Current Model | Target Tier |
| ---- | ------------- | ----------- |
| `agents/triage.ts` | `openai("gpt-4o-mini")` | `fast` |
| `agents/general.ts` | `openai("gpt-4o")` | `smart` |
| `agents/analytics.ts` | `openai("gpt-4o")` | `smart` |
| `agents/research.ts` | `openai("gpt-4o")` | `smart` |
| `agents/reports.ts` | `openai("gpt-4o-mini")` | `fast` |
| `agents/operations.ts` | `openai("gpt-4o-mini")` | `fast` |
| `agents/transactions.ts` | `openai("gpt-4o-mini")` | `fast` |
| `agents/invoices.ts` | `openai("gpt-4o-mini")` | `fast` |
| `agents/customers.ts` | `openai("gpt-4o-mini")` | `fast` |
| `agents/time-tracking.ts` | `openai("gpt-4o-mini")` | `fast` |
| `agents/shared.ts` (title) | `openai("gpt-4.1-nano")` | `nano` |
| `agents/shared.ts` (suggestions) | `openai("gpt-4.1-nano")` | `nano` |
| `tools/search/openai-web-search.ts` | `openai("gpt-4o-mini")` | `modelFor("fast", "openai")` |

### Files to change

| File | Change |
| ---- | ------ |
| **Package: `@ai-sdk-tools/agents`** | |
| `packages/agents/src/model-registry.ts` | **New** — `createModelRegistry()` factory, types |
| `packages/agents/src/index.ts` | Export `createModelRegistry` and related types |
| **App: `apps/example`** | |
| `src/ai/models.ts` | **New** — registry configuration with providers and profiles |
| `src/ai/agents/shared.ts` | Replace `openai` import. Add `tier` to `AgentConfig`. Update `createAgent` resolution. Replace `openai("gpt-4.1-nano")` with `model("nano")`. |
| `src/ai/agents/triage.ts` | Remove `openai` import. `model: openai("gpt-4o-mini")` → `tier: "fast"` |
| `src/ai/agents/general.ts` | Remove `openai` import. `model: openai("gpt-4o")` → `tier: "smart"` |
| `src/ai/agents/analytics.ts` | Remove `openai` import. `model: openai("gpt-4o")` → `tier: "smart"` |
| `src/ai/agents/research.ts` | Remove `openai` import. `model: openai("gpt-4o")` → `tier: "smart"` |
| `src/ai/agents/reports.ts` | Remove `openai` import. `model: openai("gpt-4o-mini")` → `tier: "fast"` |
| `src/ai/agents/operations.ts` | Remove `openai` import. `model: openai("gpt-4o-mini")` → `tier: "fast"` |
| `src/ai/agents/transactions.ts` | Remove `openai` import. `model: openai("gpt-4o-mini")` → `tier: "fast"` |
| `src/ai/agents/invoices.ts` | Remove `openai` import. `model: openai("gpt-4o-mini")` → `tier: "fast"` |
| `src/ai/agents/customers.ts` | Remove `openai` import. `model: openai("gpt-4o-mini")` → `tier: "fast"` |
| `src/ai/agents/time-tracking.ts` | Remove `openai` import. `model: openai("gpt-4o-mini")` → `tier: "fast"` |
| `src/ai/tools/search/types.ts` | **New** — shared `WebSearchResult` type and `WebSearchFactory` type |
| `src/ai/tools/search/openai-web-search.ts` | Refactor to factory: export `createOpenAIWebSearch`. Use `modelFor("fast", "openai")` instead of `openai("gpt-4o-mini")`. |
| `src/ai/tools/search/index.ts` | Replace re-export with web search factory: resolve provider, export `webSearchTool` |
| `.env.local.example` | Add `MODEL_PROVIDER`, `MODEL_*`, and `WEB_SEARCH_PROVIDER` examples |

**Total: 3 new files (1 package, 2 app), 12 modified app files, 1 package index update, 1 env example update.**

---

## Adding a New Provider

1. Install the SDK package: `bun add @ai-sdk/google`
2. Update your app's `models.ts`:

```typescript
import { google } from "@ai-sdk/google";

export const { model, modelFor } = createModelRegistry({
  tiers: ["reasoning", "smart", "fast", "nano"] as const,
  defaultProvider: "openai",
  providers: { openai, anthropic, google },
  profiles: {
    // ...existing profiles...
    google: {
      smart: "gemini-2.5-pro",
      fast:  "gemini-2.5-flash",
      nano:  "gemini-2.5-flash",
      // reasoning intentionally omitted — falls back to defaultProvider
    },
  },
});
```

3. Set env: `MODEL_PROVIDER=google`

No agent files change.

## Adding a New Tier

1. Update your app's `models.ts`:

```typescript
export const { model, modelFor } = createModelRegistry({
  tiers: ["reasoning", "smart", "fast", "nano", "vision"] as const,
  // ...
  profiles: {
    openai: {
      // ...existing tiers...
      vision: "gpt-4o",
    },
  },
});
```

2. Use in agents: `tier: "vision"`

The `ModelTier` type updates automatically from the `as const` tuple.
