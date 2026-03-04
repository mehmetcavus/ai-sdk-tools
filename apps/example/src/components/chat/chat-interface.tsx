"use client";

import { generateId } from "ai";
import {
  useChatActions,
  useChatMessages,
  useChatStatus as useStoreChatStatus,
  useDataPart,
} from "ai-sdk-tools/client";
import { type RefObject, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  ChatArtifactLayout,
  ChatHeader,
  ChatHistory,
  ChatInput,
  type ChatInputMessage,
  ChatMessages,
  ChatStatusIndicators,
  ChatSync,
  EmptyStateHeading,
  SuggestedPrompts,
  SuggestionPills,
} from "@/components/chat";
import { Header } from "@/components/header";
import { useChatInterface } from "@/hooks/use-chat-interface";
import { useChatStatus } from "@/hooks/use-chat-status";
import { cn } from "@/lib/utils";

export function ChatInterface() {
  const { chatId: routeChatId, isHome } = useChatInterface();
  const chatId = useMemo(() => routeChatId ?? generateId(), [routeChatId]);

  const [text, setText] = useState<string>("");
  const [useWebSearch, setUseWebSearch] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ChatSync hosts useChat (renders null). ChatInterface reads from the store
  // via useChatMessages/useChatStatus/useChatActions — re-renders only on store update.
  const messages = useChatMessages();
  const status = useStoreChatStatus();
  const { sendMessage, stop } = useChatActions();
  const { agentStatus, currentToolCall } = useChatStatus(messages, status);

  const hasMessages = messages.length > 0;

  const [suggestions] = useDataPart<{ prompts: string[] }>("suggestions");
  const hasSuggestions = suggestions?.prompts && suggestions.prompts.length > 0;

  const handleSubmit = (message: ChatInputMessage) => {
    // If currently streaming or submitted, stop instead of submitting
    if (status === "streaming" || status === "submitted") {
      stop();
      return;
    }

    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    if (message.files?.length) {
      toast.success("Files attached", {
        description: `${message.files.length} file(s) attached to message`,
      });
    }

    sendMessage({
      text: message.text || "Sent with attachments",
      files: message.files,
      metadata: {
        agentChoice: message.metadata?.agentChoice,
        toolChoice: message.metadata?.toolChoice,
      },
    });
    setText("");
  };

  const chatInput = (
    <ChatInput
      text={text}
      setText={setText}
      textareaRef={textareaRef as RefObject<HTMLTextAreaElement | null>}
      useWebSearch={useWebSearch}
      setUseWebSearch={setUseWebSearch}
      onSubmit={handleSubmit}
      status={status}
      hasMessages={hasMessages}
    />
  );

  return (
    <div
      className="relative flex size-full overflow-hidden min-h-screen"
    >
      <ChatSync chatId={chatId} />
      <div className={cn(!isHome && "hidden")}>
        <Header onToggleHistory={() => setIsHistoryOpen(!isHistoryOpen)} />
      </div>

      {/* Chat History Sidebar */}
      {isHistoryOpen && (
        <>
          {/* Overlay - closes sidebar when clicking outside */}
          <button
            type="button"
            className="fixed inset-0 bg-black/50 z-30"
            onClick={() => setIsHistoryOpen(false)}
            aria-label="Close chat history"
          />
          {/* Sidebar */}
          <div className="fixed left-0 top-0 bottom-0 z-40 w-64 bg-background border-r border-border">
            <ChatHistory />
          </div>
        </>
      )}

      <ChatArtifactLayout hasMessages={hasMessages}>
        {({ isCanvasOpen }) => (
          <>
            <div
              className={cn(
                !hasMessages && "hidden",
                "absolute inset-x-0 top-0 flex flex-col overflow-hidden transition-[bottom] duration-300 ease-in-out",
              )}
              style={{ bottom: "var(--ai-devtools-height, 0px)" }}
            >
              <div
                className={cn(
                  "fixed left-0 z-50 shrink-0 transition-all duration-300 ease-in-out",
                  isCanvasOpen ? "right-[600px]" : "right-0",
                )}
              >
                <div className="bg-background/80 dark:bg-background/50 backdrop-blur-sm p-2 pt-6">
                  <ChatHeader />
                </div>
              </div>
              <Conversation>
                <ConversationContent className="pb-48 pt-14">
                  <div className="max-w-2xl mx-auto w-full">
                    <ChatMessages
                      messages={messages}
                      isStreaming={
                        status === "streaming" || status === "submitted"
                      }
                    />
                    <ChatStatusIndicators
                      agentStatus={agentStatus}
                      currentToolCall={currentToolCall}
                      status={status}
                    />
                  </div>
                </ConversationContent>
                <ConversationScrollButton
                  className={cn(hasSuggestions ? "bottom-52" : "bottom-42")}
                />
              </Conversation>
            </div>

            <div className={cn(hasMessages && "hidden")}>
              <EmptyStateHeading />
            </div>

            <div
              className={cn(
                hasMessages
                  ? "fixed left-0 z-50 transition-all duration-300 ease-in-out"
                  : "w-full max-w-2xl px-4",
                hasMessages &&
                  (isCanvasOpen ? "right-[600px]" : "right-0"),
              )}
              style={
                hasMessages
                  ? { bottom: "var(--ai-devtools-height, 0px)" }
                  : undefined
              }
            >
              <div
                className={cn(
                  "w-full",
                  hasMessages && "pb-4 max-w-2xl mx-auto",
                )}
              >
                <div className={cn(!hasMessages && "hidden")}>
                  <SuggestedPrompts delay={1} />
                </div>
                {chatInput}
                <div className={cn(hasMessages && "hidden", "mt-8")}>
                  <SuggestionPills />
                </div>
              </div>
            </div>
          </>
        )}
      </ChatArtifactLayout>
    </div>
  );
}
