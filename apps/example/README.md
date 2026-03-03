This is a [Next.js](https://nextjs.org) project showcasing AI SDK Tools with multi-agent orchestration, persistent memory, and financial tools.

## Getting Started

### 1. Environment Setup

Copy the environment variables template:

```bash
cp .env.local.example .env.local
```

Add your API keys:

```env
# Required
OPENAI_API_KEY=sk-...

# Optional - Memory Persistence
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token-here
```

**Model Provider Configuration:**

This app uses the [Model Registry](../../packages/agents/MODEL_REGISTRY_DESIGN.md) from `@ai-sdk-tools/agents` to decouple agents from specific providers. Switch all agents to a different provider with a single env var:

```env
# Optional - Model Provider (default: openai)
MODEL_PROVIDER=anthropic

# Optional - Per-tier overrides (format: provider:model-id)
# MODEL_SMART=anthropic:claude-sonnet-4-20250514
# MODEL_REASONING=openai:o3-mini
```

**Tool Provider Configuration:**

Web search and transcription are also decoupled from the model provider. Each can be independently overridden, and they auto-select based on `MODEL_PROVIDER` when available or fall back to a sensible default:

```env
# Override web search provider (default: follows MODEL_PROVIDER, fallback: openai)
# Supported: openai, anthropic
WEB_SEARCH_PROVIDER=anthropic

# Override transcription provider (default: follows MODEL_PROVIDER, fallback: openai)
# Supported: openai (more providers coming as AI SDK adds support)
TRANSCRIPTION_PROVIDER=openai
```

| Feature | Resolution Order | Fallback |
|---------|-----------------|----------|
| **Agents/Chat** | `MODEL_PROVIDER` → `openai` | openai |
| **Web Search** | `WEB_SEARCH_PROVIDER` → `MODEL_PROVIDER` → `openai` | openai |
| **Transcription** | `TRANSCRIPTION_PROVIDER` → `MODEL_PROVIDER` → `openai` | openai |

This means you can run a pure Anthropic setup (`MODEL_PROVIDER=anthropic`) and web search will automatically use Anthropic's web search, while transcription falls back to OpenAI (since Anthropic has no transcription API yet).

**Memory Storage Options:**

| Provider | When to Use | Setup Required |
|----------|------------|----------------|
| **In-Memory** | Development, testing | None - works by default |
| **Upstash Redis** | Production, persistent across restarts | Add env vars |

**To use Upstash (recommended for production):**
1. Create free account: https://console.upstash.com
2. Create a Redis database
3. Copy REST URL and Token to `.env.local`

The app automatically detects Upstash credentials and switches providers - no code changes needed!

### 2. Install dependencies:

```bash
bun install
```

### 3. Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
