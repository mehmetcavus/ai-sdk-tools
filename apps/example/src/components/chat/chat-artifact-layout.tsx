"use client";

import { useArtifacts } from "ai-sdk-tools/client";
import type { ReactNode } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { cn } from "@/lib/utils";
import { ArtifactCanvas } from "@/components/canvas";

interface ChatArtifactLayoutProps {
  hasMessages: boolean;
  children: (layout: { isCanvasOpen: boolean }) => ReactNode;
}

/**
 * Isolates useArtifacts so ChatInterface doesn't re-render when artifact data
 * changes. Only this component re-renders on data updates.
 */
export function ChatArtifactLayout({
  children,
  hasMessages,
}: ChatArtifactLayoutProps) {
  const [selectedType, setSelectedType] = useQueryState(
    "artifact-type",
    parseAsString,
  );

  const [data] = useArtifacts({
    value: selectedType ?? undefined,
    onChange: (v: string | null) => setSelectedType(v ?? null),
  });

  const hasArtifacts = data.artifacts.length > 0;
  const isCanvasOpen = hasArtifacts && data.activeType !== null;

  return (
    <>
      {/* Canvas slides in from right when artifacts are present and canvas is open */}
      <div
        className={cn(
          "fixed right-0 top-0 bottom-0 z-20",
          isCanvasOpen ? "translate-x-0" : "translate-x-full",
          hasMessages && "transition-transform duration-300 ease-in-out",
        )}
        style={{ width: "600px" }}
      >
        {hasArtifacts && <ArtifactCanvas />}
      </div>

      {/* Main chat area - slides left when canvas opens.
          flex-col in empty state stacks EmptyStateHeading + input area vertically. */}
      <div
        className={cn(
          "relative flex-1 transition-all duration-300 ease-in-out",
          isCanvasOpen && "mr-[600px]",
          !hasMessages && "flex flex-col items-center justify-center",
        )}
      >
        {children({ isCanvasOpen })}
      </div>
    </>
  );
}
