"use client";

import type { UIMessage } from "@ai-sdk/react";
import { PaperclipIcon } from "lucide-react";
import Image from "next/image";
import { memo, useMemo } from "react";
import { FaviconStack } from "@/components/ai-elements/favicon-stack";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Response } from "@/components/ai-elements/response";
import { MessageArtifactButton } from "./message-artifact-button";

interface ChatMessagesProps {
  messages: UIMessage[];
  isStreaming?: boolean;
}

interface SourceItem {
  url: string;
  title: string;
  publishedDate?: string;
}

interface WebSearchToolOutput {
  sources?: SourceItem[];
}

/**
 * Extract sources from webSearch tool results
 * Sources are already deduplicated by the tool
 */
function extractWebSearchSources(parts: UIMessage["parts"]): SourceItem[] {
  const sources: SourceItem[] = [];

  for (const part of parts) {
    const type = part.type as string;
    if (type === "tool-webSearch") {
      const output = (part as { output?: WebSearchToolOutput }).output;
      if (output?.sources) {
        sources.push(...output.sources);
      }
    }
  }

  return sources;
}

/**
 * Extract source-url parts from AI SDK
 */
function extractAiSdkSources(parts: UIMessage["parts"]): SourceItem[] {
  const sources: SourceItem[] = [];

  for (const part of parts) {
    if (part.type === "source-url") {
      const sourcePart = part as { url: string; title?: string };
      sources.push({
        url: sourcePart.url,
        title: sourcePart.title || sourcePart.url,
      });
    }
  }

  return sources;
}

/**
 * Extract file parts from message
 */
function extractFileParts(parts: UIMessage["parts"]) {
  return parts.filter((part) => part.type === "file");
}

function getUniqueSources(parts: UIMessage["parts"]): SourceItem[] {
  const aiSdkSources = extractAiSdkSources(parts);
  const webSearchSources = extractWebSearchSources(parts);
  const allSources = [...aiSdkSources, ...webSearchSources];
  return allSources.filter(
    (source, index, self) =>
      index === self.findIndex((s) => s.url === source.url),
  );
}

interface ChatMessageItemProps {
  message: UIMessage;
  isLastMessage: boolean;
  isStreaming: boolean;
}

const ChatMessageItem = memo(function ChatMessageItem({
  message,
  isLastMessage,
  isStreaming,
}: ChatMessageItemProps) {
  const parts = message.parts || [];
  const uniqueSources = useMemo(() => getUniqueSources(parts), [parts]);

  const textParts = parts.filter((part) => part.type === "text");
  const textContent = textParts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");

  const fileParts = extractFileParts(parts);

  const shouldShowSources =
    uniqueSources.length > 0 &&
    message.role === "assistant" &&
    (!isLastMessage || !isStreaming);

  return (
    <div>
      {/* Render file attachments */}
      {fileParts.length > 0 && (
        <Message from={message.role}>
          <MessageContent variant="flat" className="max-w-[80%]">
            <div className="flex flex-wrap gap-2 mb-2">
              {fileParts.map((part) => {
                if (part.type !== "file") return null;

                const file = part as {
                  type: "file";
                  url?: string;
                  mediaType?: string;
                  filename?: string;
                };

                const fileKey = `${file.url}-${file.filename}`;
                const isImage = file.mediaType?.startsWith("image/");

                if (isImage && file.url) {
                  return (
                    <div
                      key={fileKey}
                      className="relative rounded-lg border overflow-hidden"
                    >
                      <Image
                        src={file.url}
                        alt={file.filename || "attachment"}
                        className="max-w-xs max-h-48 object-cover"
                        width={300}
                        height={192}
                        unoptimized
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={fileKey}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted/50"
                  >
                    <PaperclipIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {file.filename || "Unknown file"}
                    </span>
                  </div>
                );
              })}
            </div>
          </MessageContent>
        </Message>
      )}

      {/* Render text content in message */}
      {textParts.length > 0 && (
        <Message from={message.role}>
          <MessageContent variant="flat" className="max-w-[80%]">
            <Response
              isStreaming={
                message.role === "assistant" && isLastMessage && isStreaming
              }
            >
              {textContent}
            </Response>
            {message.role === "assistant" && (
              <div className="mt-2">
                <MessageArtifactButton message={message} />
              </div>
            )}
          </MessageContent>
        </Message>
      )}

      {/* Render sources as stacked favicons - show immediately when available */}
      {shouldShowSources && (
        <div className="max-w-[80%]">
          <FaviconStack sources={uniqueSources} />
        </div>
      )}
    </div>
  );
});

function getMessageTextContent(parts: UIMessage["parts"]): string {
  if (!parts) return "";
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

function isMessagesEqual(prev: UIMessage[], next: UIMessage[]): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  return prev.every((m, i) => {
    const n = next[i];
    if (!n || m.id !== n.id) return false;
    if ((m.parts?.length ?? 0) !== (n.parts?.length ?? 0)) return false;
    // During streaming, the last message's text part grows—parts.length stays 1.
    // Must compare actual text content or we block re-renders.
    const mText = getMessageTextContent(m.parts);
    const nText = getMessageTextContent(n.parts);
    return mText === nText;
  });
}

export const ChatMessages = memo(
  function ChatMessages({ messages, isStreaming = false }: ChatMessagesProps) {

    return (
      <>
        {messages.map((message, index) => (
          <ChatMessageItem
            key={message.id}
            message={message}
            isLastMessage={index === messages.length - 1}
            isStreaming={isStreaming}
          />
        ))}
      </>
    );
  },
  (prev, next) => {
    if (prev.isStreaming !== next.isStreaming) return false;
    return isMessagesEqual(prev.messages, next.messages);
  },
);
