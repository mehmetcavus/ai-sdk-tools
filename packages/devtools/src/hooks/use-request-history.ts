import { useCallback, useEffect, useRef, useState } from "react";
import type { AIEvent, HistoryEntry, HistoryToolCall } from "../types";

interface ToolModelMeta {
  model?: string;
  provider?: string;
  tier?: string;
}

interface BuilderState {
  currentRequestId: string | null;
  triageStartTime: number;
  currentAgent: string | null;
  pendingHandoffs: Map<string, { from: string; startTime: number }>;
  toolCallIdToAgent: Map<string, string>;
  seenToolCallIds: Set<string>;
  toolModelInfo: Map<string, ToolModelMeta>;
  lastProcessedIndex: number;
  live: HistoryEntry[];
}

function createBuilderState(): BuilderState {
  return {
    currentRequestId: null,
    triageStartTime: 0,
    currentAgent: null,
    pendingHandoffs: new Map(),
    toolCallIdToAgent: new Map(),
    seenToolCallIds: new Set(),
    toolModelInfo: new Map(),
    lastProcessedIndex: 0,
    live: [],
  };
}

function findLiveEntry(
  live: HistoryEntry[],
  requestId: string | null,
  agent: string | null,
): HistoryEntry | undefined {
  if (!requestId || !agent) return undefined;
  return live.find((e) => e.requestId === requestId && e.agent === agent);
}

export function useRequestHistory(events: AIEvent[]) {
  const [completedEntries, setCompletedEntries] = useState<HistoryEntry[]>([]);
  const [liveEntries, setLiveEntries] = useState<HistoryEntry[]>([]);
  const builderRef = useRef<BuilderState>(createBuilderState());

  const processNewEvents = useCallback(
    (newEvents: AIEvent[]) => {
      const b = builderRef.current;
      let liveChanged = false;
      const completeBatch: HistoryEntry[] = [];

      for (const event of newEvents) {
        switch (event.type) {
          case "tool-model-info": {
            const tools = event.data?.tools;
            if (tools && typeof tools === "object") {
              for (const [name, info] of Object.entries(tools)) {
                b.toolModelInfo.set(
                  name,
                  info as ToolModelMeta,
                );
              }
            }
            break;
          }

          case "agent-start": {
            const agentName = event.metadata?.agent;
            if (!agentName) break;

            if (!b.currentRequestId) {
              // First agent-start of a new request (triage)
              b.currentRequestId = event.id;
              b.triageStartTime = event.timestamp;
              b.currentAgent = agentName;
              break;
            }

            // Specialist agent starting — create a HistoryEntry
            b.currentAgent = agentName;
            const handoff = b.pendingHandoffs.get(agentName);

            const entry: HistoryEntry = {
              requestId: b.currentRequestId,
              agent: agentName,
              agentStartTime: event.timestamp,
              agentEndTime: 0,
              agentDuration: 0,
              model: event.metadata?.model,
              provider: event.metadata?.provider,
              tier: event.metadata?.tier,
              status: "executing",
              tools: [],
              handoffFrom: handoff?.from,
              handoffStartTime: handoff?.startTime,
              handoffEndTime: event.timestamp,
              handoffDuration: handoff
                ? event.timestamp - handoff.startTime
                : undefined,
            };

            b.live.push(entry);
            if (handoff) b.pendingHandoffs.delete(agentName);
            liveChanged = true;
            break;
          }

          case "agent-handoff": {
            const from = event.metadata?.fromAgent;
            const to = event.metadata?.toAgent;
            if (from && to) {
              b.pendingHandoffs.set(to, {
                from,
                startTime: event.timestamp,
              });
            }
            break;
          }

          case "tool-call-start": {
            const toolName =
              event.metadata?.toolName || event.data?.toolName;
            const toolCallId =
              event.metadata?.toolCallId || event.data?.toolCallId;

            if (!toolName || toolName === "unknown" || !toolName.trim()) break;
            if (toolName === "handoff_to_agent") break;

            // Dedup: AI SDK emits tool-input-start, tool-input-delta, tool-input-available
            if (toolCallId && b.seenToolCallIds.has(toolCallId)) break;
            if (toolCallId) b.seenToolCallIds.add(toolCallId);

            const agentName =
              event.metadata?.agent || b.currentAgent;
            const entry = findLiveEntry(b.live, b.currentRequestId, agentName);
            if (!entry) break;

            if (toolCallId) {
              b.toolCallIdToAgent.set(toolCallId, agentName || "");
            }

            const meta = b.toolModelInfo.get(toolName);
            const tc: HistoryToolCall = {
              tool: toolName,
              toolCallId: toolCallId || `anon-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              startTime: event.timestamp,
              endTime: 0,
              duration: 0,
              model: meta?.model,
              provider: meta?.provider,
              tier: meta?.tier,
            };

            entry.tools.push(tc);
            liveChanged = true;
            break;
          }

          case "tool-call-result": {
            const toolCallId =
              event.metadata?.toolCallId || event.data?.toolCallId;
            const directName =
              event.metadata?.toolName || event.data?.toolName;

            // Find the tool call by toolCallId across all live entries
            let matched = false;
            for (const entry of b.live) {
              for (const tc of entry.tools) {
                if (
                  (toolCallId && tc.toolCallId === toolCallId) ||
                  (!toolCallId && directName && tc.tool === directName && tc.endTime === 0)
                ) {
                  tc.endTime = event.timestamp;
                  tc.duration = tc.endTime - tc.startTime;
                  matched = true;
                  break;
                }
              }
              if (matched) break;
            }
            if (matched) liveChanged = true;
            break;
          }

          case "agent-finish": {
            const agentName = event.metadata?.agent;
            if (!agentName) break;
            const entry = findLiveEntry(b.live, b.currentRequestId, agentName);
            if (!entry) break;

            entry.agentEndTime = event.timestamp;
            entry.agentDuration = entry.agentEndTime - entry.agentStartTime;
            entry.status = "completed";
            if (event.metadata?.model) entry.model = event.metadata.model;
            if (event.metadata?.provider) entry.provider = event.metadata.provider;
            if (event.metadata?.tier) entry.tier = event.metadata.tier;
            liveChanged = true;
            break;
          }

          case "agent-error": {
            const agentName = event.metadata?.agent;
            if (!agentName) break;
            const entry = findLiveEntry(b.live, b.currentRequestId, agentName);
            if (!entry) break;

            entry.agentEndTime = event.timestamp;
            entry.agentDuration = entry.agentEndTime - entry.agentStartTime;
            entry.status = "error";
            liveChanged = true;
            break;
          }

          case "agent-complete": {
            // Finalize any entries still marked executing
            for (const entry of b.live) {
              if (entry.status === "executing") {
                if (entry.agentEndTime === 0) {
                  entry.agentEndTime = event.timestamp;
                  entry.agentDuration =
                    entry.agentEndTime - entry.agentStartTime;
                }
                entry.status = "completed";
              }
            }

            completeBatch.push(...b.live);

            // Reset builder for next request
            b.currentRequestId = null;
            b.triageStartTime = 0;
            b.currentAgent = null;
            b.pendingHandoffs.clear();
            b.toolCallIdToAgent.clear();
            b.seenToolCallIds.clear();
            b.live = [];
            liveChanged = true;
            break;
          }

          case "finish": {
            // Fallback: if agent-finish didn't fire, finalize current agent
            if (b.currentAgent) {
              const entry = findLiveEntry(
                b.live,
                b.currentRequestId,
                b.currentAgent,
              );
              if (entry && entry.agentEndTime === 0) {
                entry.agentEndTime = event.timestamp;
                entry.agentDuration =
                  entry.agentEndTime - entry.agentStartTime;
                liveChanged = true;
              }
            }
            break;
          }
        }
      }

      if (completeBatch.length > 0) {
        setCompletedEntries((prev) => [...prev, ...completeBatch]);
      }
      if (liveChanged) {
        setLiveEntries([...b.live]);
      }
    },
    [],
  );

  useEffect(() => {
    const b = builderRef.current;

    if (events.length === 0) {
      // Full reset (e.g. user cleared events)
      builderRef.current = createBuilderState();
      setCompletedEntries([]);
      setLiveEntries([]);
      return;
    }

    if (events.length < b.lastProcessedIndex) {
      // Events were trimmed — completed entries are already safe.
      // Just adjust the index so we don't reprocess.
      b.lastProcessedIndex = events.length;
      return;
    }

    const newEvents = events.slice(b.lastProcessedIndex);
    b.lastProcessedIndex = events.length;

    if (newEvents.length > 0) {
      processNewEvents(newEvents);
    }
  }, [events, events.length, processNewEvents]);

  const allEntries: HistoryEntry[] =
    liveEntries.length > 0
      ? [...completedEntries, ...liveEntries]
      : completedEntries;

  return { completedEntries, liveEntries, allEntries };
}
