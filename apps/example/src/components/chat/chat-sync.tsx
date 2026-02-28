"use client";

import { DefaultChatTransport } from "ai";
import { ChatSync as StoreChatSync } from "ai-sdk-tools/client";
import { useMemo } from "react";
import type { ChatInputMessage } from "@/components/chat";

/**
 * App-specific ChatSync: creates transport and delegates to store's ChatSync.
 * See @ai-sdk-tools/store ChatSync for the architecture.
 */
export function ChatSync({ chatId }: { chatId: string }) {
  const options = useMemo(
    () => ({
      id: chatId,
      transport: new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest({ messages, id }) {
          const lastMessage = messages[messages.length - 1] as ChatInputMessage;

          const agentChoice = lastMessage.metadata?.agentChoice;
          const toolChoice = lastMessage.metadata?.toolChoice;

          return {
            body: {
              message: lastMessage,
              id,
              agentChoice,
              toolChoice,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
          };
        },
      }),
    }),
    [chatId],
  );

  return <StoreChatSync options={options} />;
}
