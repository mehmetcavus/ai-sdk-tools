# AI SDK v6 Compatibility Report

This report identifies incorrect usages, poor handling, compatibility issues, and deprecations in the ai-sdk-tools-v6 repository. No code changes have been made—this is for planning purposes.

---

## 1. Deprecated APIs (High Priority)

### 1.1 `generateObject` / `streamObject` → Use `generateText` / `streamText` with `Output.object`

**Migration guide:** [AI SDK 6.0 Migration](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)

`generateObject` and `streamObject` are deprecated and will be removed. Use `generateText`/`streamText` with `output: Output.object({ schema })` instead.

**Affected files:**

| File | Usage | Fix |
|------|-------|-----|
| `packages/agents/src/agent.ts` (line 1370) | `generateObject` for suggestions | Replace with `generateText` + `Output.object` |
| `packages/ocr/src/providers/mistral.ts` (line 45) | `generateObject` for OCR extraction | Replace with `generateText` + `Output.object` |
| `packages/ocr/src/providers/gemini.ts` (line 45) | `generateObject` for OCR extraction | Replace with `generateText` + `Output.object` |
| `packages/ocr/src/providers/ocr-fallback.ts` (line 67) | `generateObject` | Replace with `generateText` + `Output.object` |

**Migration pattern:**
```ts
// Before
const { object } = await generateObject({ model, schema, prompt });

// After
import { generateText, Output } from 'ai';
const { output } = await generateText({
  model,
  output: Output.object({ schema }),
  prompt,
});
```

---

### 1.2 `cachedInputTokens` and `reasoningTokens` in `LanguageModelUsage`

**Migration guide:** These are deprecated. Use:
- `cachedInputTokens` → `inputTokenDetails.cacheReadTokens`
- `reasoningTokens` → `outputTokenDetails.reasoningTokens`

**Affected files:**

| File | Usage | Fix |
|------|-------|-----|
| `apps/example/src/components/ai-elements/context.tsx` (lines 317, 357) | `usage?.reasoningTokens`, `usage?.cachedInputTokens` | Update to new structure |

---

### 1.3 Tool UI Part Helper Functions Renamed

**Migration guide:** [AI SDK 6.0 Migration - Tool UI Part Helpers](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)

| Old Name | New Name |
|----------|----------|
| `isToolUIPart` | `isStaticToolUIPart` |
| `isToolOrDynamicToolUIPart` | `isToolUIPart` |
| `getToolName` | `getStaticToolName` |
| `getToolOrDynamicToolName` | `getToolName` |

**Affected files:**

| File | Usage | Fix |
|------|-------|-----|
| `packages/agents/src/utils.ts` (line 55) | `isToolUIPart(sanitizedPart)` | Determine if checking static or dynamic; use `isStaticToolUIPart` or `isToolUIPart` accordingly |

---

## 2. Incorrect / Outdated Imports

### 2.1 `useChat` from `'ai/react'` (v5 path)

In AI SDK v6, React hooks live in `@ai-sdk/react`, not `ai/react`.

**Affected files:**

| File | Line | Current | Fix |
|------|------|---------|-----|
| `packages/devtools/README.md` | 61 | `import { useChat } from 'ai/react'` | `import { useChat } from '@ai-sdk/react'` |

---

### 2.2 UIMessage Type Import Inconsistency

Some files import `UIMessage` from `"ai"`, others from `"@ai-sdk/react"`. In v6, both may work, but the canonical source should be verified. The store package uses `@ai-sdk/react` for `UIMessage` and `UseChatHelpers`.

**Files importing from `"ai"`:**
- `apps/example/src/lib/extract-artifact-info.ts`
- `apps/example/src/app/custom-store/with-markdown-memo.ts`
- `apps/example/src/app/custom-store/with-message-parts.ts`
- `apps/example/src/app/custom-store/markdown-cache.ts`
- `apps/example/src/components/chat/message-artifact-button.tsx`
- `apps/example/src/components/ai-elements/message.tsx`
- `apps/example/src/components/ai-elements/branch.tsx`
- `apps/example/src/components/chat/chat-messages.tsx`
- `packages/agents/src/utils.ts`

**Recommendation:** Standardize on one source. Check AI SDK v6 docs for canonical export location.

---

## 3. Version Mismatches

### 3.1 Website App Uses @ai-sdk/openai v2 (AI SDK v5 era)

**File:** `apps/website/package.json`

| Package | Current | Expected for v6 |
|---------|---------|-----------------|
| `@ai-sdk/openai` | `^2.0.69` | `^3.0.0` |

The website app uses `ai: ^6.0.3` but `@ai-sdk/openai: ^2.0.69`. This creates a mixed v5/v6 dependency tree:
- `@ai-sdk/openai@2.0.69` → `@ai-sdk/provider@2.0.0`, `@ai-sdk/provider-utils@3.0.17`
- `ai@6.0.3` → `@ai-sdk/provider@3.0.0`, `@ai-sdk/provider-utils@4.0.1`

**Impact:** Potential runtime incompatibilities, type mismatches, and inconsistent behavior.

**Fix:** Upgrade `apps/website` to `@ai-sdk/openai@^3.0.1` (or match example app version).

---

## 4. Potential API Changes to Verify

### 4.1 `generateText` with `stopWhen` and `tools`

**File:** `apps/example/src/ai/tools/search/openai-web-search.ts`

Uses `generateText` with `stopWhen: stepCountIs(1)` and `tools`. **Verified:** `generateText` supports `stopWhen` and `stepCountIs` in AI SDK v6 for multi-step tool calling. The `result.steps` structure should be correct. No change needed unless runtime issues are observed.

---

### 4.2 `experimental_transcribe`

**File:** `apps/example/src/app/api/transcription/route.ts`

Uses `experimental_transcribe as transcribe` and `openai.transcription("gpt-4o-mini-transcribe")`. The `experimental_` prefix suggests it may be promoted or renamed in v6. Verify:
- Correct function name
- Correct model identifier for transcription

---

### 4.3 `Tool.toModelOutput` Parameter Change

**Migration guide:** In v6, `toModelOutput` receives `{ output }` instead of `output` directly.

**Check:** Search for any `toModelOutput` usage in tool definitions. Initial grep did not find direct usage, but custom tools or wrappers may use it.

---

### 4.4 `convertToModelMessages` is Async

**Migration guide:** `convertToModelMessages()` is now async—must be awaited.

**Status:** `packages/agents/src/agent.ts` already uses `await convertToModelMessages(...)` — **OK**.

---

## 5. OCR Package Provider Dependencies

### 5.1 Optional Peer Dependencies

The OCR package dynamically imports:
- `@ai-sdk/mistral`
- `@ai-sdk/google`

These are not in the root or example `package.json`. They are optional peer deps. Verify:
- Correct versions for AI SDK v6 compatibility
- Whether `@ai-sdk/mistral` and `@ai-sdk/google` at v3.x exist and work with `ai@6.x`

---

## 6. Documentation / Example Inconsistencies

### 6.1 Store Content Uses `api` vs `transport`

**Files:** `apps/website/src/components/store-content.tsx`, `apps/website/src/components/docs/*.tsx`

Some examples use `api: '/api/chat'` (legacy), others use `transport: new DefaultChatTransport({ api: '/api/chat' })`. In v6, `DefaultChatTransport` with `api` is the recommended pattern. Ensure docs consistently show the v6 transport pattern.

---

### 6.2 `isLoading` vs `status`

**File:** `apps/website/src/components/store-content.tsx` (line 144)

Uses `isLoading` from `useChat`. In v6, `useChat` from `@ai-sdk/react` may expose `status` instead of/in addition to `isLoading`. Verify and align docs.

---

## 7. Error Handling and Edge Cases

### 7.1 Agent Streaming Error Handling

**File:** `packages/agents/src/agent.ts`

The `toUIMessageStream` flow has error handling, but verify:
- Proper propagation of errors to `onError` callback
- Correct cleanup on stream failure
- Compatibility with v6 stream protocol changes

---

### 7.2 Cache Package `experimental_context`

**File:** `packages/cache/src/cache.ts`

Uses `(executionOptions as any)?.experimental_context?.writer`. The `experimental_context` API may change. Monitor AI SDK releases for stabilization or rename.

---

## 8. Summary Table

| Category | Count | Severity |
|----------|-------|----------|
| Deprecated `generateObject` usage | 4 files | High |
| Deprecated `LanguageModelUsage` fields | 1 file | Medium |
| Tool UI part helper renames | 1 file | Medium |
| Incorrect `ai/react` import | 1 file | Low |
| Website @ai-sdk/openai v2 | 1 package | High |
| UIMessage import consistency | 9+ files | Low |
| APIs to verify | 4 items | Medium |

---

## 9. Recommended Fix Order

1. **Website @ai-sdk/openai** — Upgrade to ^3.0.1 to align with v6
2. **generateObject → generateText + Output.object** — OCR package and agents package
3. **LanguageModelUsage** — Update context.tsx for new token fields
4. **isToolUIPart** — Apply helper renames in agents/utils.ts
5. **devtools README** — Fix useChat import path
6. **Verification** — Manually test generateText with tools, transcribe, and streaming

---

## 10. Codemods Available

The AI SDK provides codemods. Run from project root:

```sh
npx @ai-sdk/codemod v6
```

Relevant codemods:
- (None for generateObject → Output.object — manual migration)
- `rename-tool-call-options-to-tool-execution-options`
- `rename-core-message-to-model-message`
- `rename-converttocoremessages-to-converttomodelmessages`
- `add-await-converttomodelmessages`
- `wrap-tomodeloutput-parameter`

---

*Report generated for planning. No code changes have been applied.*
