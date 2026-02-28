"use client";

import type { UIMessage } from "@ai-sdk/react";
import { BarChart3 } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { extractAllArtifactsFromMessage } from "@/lib/extract-artifact-info";

const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  revenue: "Revenue",
  "balance-sheet": "Balance Sheet",
  "profit-loss": "Profit & Loss",
  "cash-flow": "Cash Flow",
};

interface MessageArtifactButtonProps {
  message: UIMessage;
}

export function MessageArtifactButton({ message }: MessageArtifactButtonProps) {
  const [selectedType, setSelectedType] = useQueryState(
    "artifact-type",
    parseAsString,
  );

  const artifacts = extractAllArtifactsFromMessage(message);

  if (artifacts.length === 0) {
    return null;
  }

  const labelKeys = Object.keys(ARTIFACT_TYPE_LABELS);
  const sortedArtifacts = [...artifacts].sort((a, b) => {
    const ai = labelKeys.indexOf(a.type);
    const bi = labelKeys.indexOf(b.type);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });

  return (
    <div className="flex flex-wrap items-center gap-3">
      {sortedArtifacts.map((artifact) => {
        const label =
          ARTIFACT_TYPE_LABELS[artifact.type] || artifact.type;
        const isActive = selectedType === artifact.type;

        return (
          <button
            key={`${artifact.type}:${artifact.id}`}
            type="button"
            onClick={() => setSelectedType(artifact.type)}
            className={`inline-flex items-center gap-1.5 text-xs transition-colors ${
              isActive
                ? "text-primary hover:text-primary/80"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label={`Open ${label} canvas`}
            title={`Open ${label} canvas`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
