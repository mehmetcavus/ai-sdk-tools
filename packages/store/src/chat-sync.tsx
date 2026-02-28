"use client";

import type { UIMessage } from "@ai-sdk/react";
import { useChat } from "./use-chat";
import type { UseChatOptionsWithPerformance } from "./use-chat";

/**
 * Hosts useChat (useOriginalChat) so that UI components using store hooks
 * (useChatMessages, useChatStatus, useChatActions) only re-render when the
 * store updates—not on every stream chunk.
 *
 * useOriginalChat (@ai-sdk/react) uses useSyncExternalStore internally, so
 * any component that calls it will re-render when the chat state updates.
 * By isolating it in ChatSync (which renders null), only ChatSync re-renders;
 * siblings using store hooks re-render only when the Zustand store updates.
 *
 * @example
 * ```tsx
 * // Render as sibling of your chat UI:
 * <>
 *   <ChatSync options={{ id: chatId, transport }} />
 *   <ChatInterface />  // Uses useChatMessages, useChatStatus, useChatActions
 * </>
 * ```
 */
export function ChatSync<TMessage extends UIMessage = UIMessage>({
  options,
}: {
  options: UseChatOptionsWithPerformance<TMessage>;
}) {
  useChat<TMessage>(options);
  return null;
}
