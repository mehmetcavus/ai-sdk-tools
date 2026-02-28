import type { UIMessage } from "@ai-sdk/react";

export interface ArtifactInfo {
  type: string;
  id: string;
}

/**
 * Extract all artifacts from a message.
 * Returns an array of { type, id } for each artifact found.
 */
export function extractAllArtifactsFromMessage(
  message: UIMessage,
): ArtifactInfo[] {
  if (!message.parts || !Array.isArray(message.parts)) {
    return [];
  }

  const seen = new Set<string>();
  const artifacts: ArtifactInfo[] = [];

  const addArtifact = (type: string, id: string) => {
    const key = `${type}:${id}`;
    if (!seen.has(key)) {
      seen.add(key);
      artifacts.push({ type, id });
    }
  };

  for (const part of message.parts) {
    if (part.type.startsWith("data-artifact-") && "data" in part) {
      const artifactPart = part as {
        type: string;
        data?: { type?: string; id?: string };
      };
      const type =
        artifactPart.data?.type ||
        part.type.match(/^data-artifact-(.+)$/)?.[1];
      const id = artifactPart.data?.id;
      if (type && id) {
        addArtifact(type, id);
      }
    }

    if (part.type.startsWith("tool-") && "result" in part && part.result) {
      const result = part.result;
      if (typeof result === "object" && result && "parts" in result) {
        const parts = (result as { parts?: unknown[] }).parts;
        if (Array.isArray(parts)) {
          for (const nestedPart of parts) {
            const np = nestedPart as {
              type?: string;
              data?: { type?: string; id?: string };
            };
            if (np.type?.startsWith("data-artifact-")) {
              const type =
                np.data?.type ||
                np.type.match(/^data-artifact-(.+)$/)?.[1];
              const id = np.data?.id;
              if (type && id) {
                addArtifact(type, id);
              }
            }
          }
        }
      }
    }
  }

  return artifacts;
}

/**
 * Extract artifact type from a message (first match).
 * @deprecated Use extractAllArtifactsFromMessage instead.
 */
export function extractArtifactTypeFromMessage(
  message: UIMessage,
): string | null {
  return extractAllArtifactsFromMessage(message)[0]?.type ?? null;
}

/**
 * Extract artifact ID from a message (first match).
 * @deprecated Use extractAllArtifactsFromMessage instead.
 */
export function extractArtifactIdFromMessage(
  message: UIMessage,
): string | null {
  return extractAllArtifactsFromMessage(message)[0]?.id ?? null;
}
