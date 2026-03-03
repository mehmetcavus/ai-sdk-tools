"use client";

import {
  Background,
  type Edge,
  MarkerType,
  type Node,
  Position,
  ReactFlow,
} from "@xyflow/react";
import dagre from "dagre";
import { useCallback, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import type { AgentFlowData, HistoryEntry } from "../types";
import { AgentNode } from "./agent-node";
import { ToolNode } from "./tool-node";

type ViewMode = "session" | "latest" | string;

interface PopoverEntry {
  requestId: string;
  requestLabel: number;
  duration?: number;
  callCount?: number;
}

interface AgentFlowVisualizationProps {
  completedEntries: HistoryEntry[];
  liveEntries: HistoryEntry[];
  allEntries: HistoryEntry[];
}

const nodeTypes = {
  agentNode: AgentNode,
  toolNode: ToolNode,
} as const;

// Auto-layout using dagre
function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction = "LR",
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 220;
  const nodeHeight = 180;
  const isHorizontal = direction === "LR";

  dagreGraph.setGraph({ rankdir: direction, ranksep: 250, nodesep: 120 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * Aggregate HistoryEntry[] into AgentFlowData for the visualization.
 * Simple: iterate entries, sum by agent/tool name.
 */
function aggregateEntries(entries: HistoryEntry[]): AgentFlowData {
  const agentMap = new Map<
    string,
    {
      durationMs: number;
      toolCallCount: number;
      status: "idle" | "executing" | "completed" | "error";
      model?: string;
      provider?: string;
      tier?: string;
    }
  >();
  const toolMap = new Map<
    string,
    {
      durationMs: number;
      callCount: number;
      agent?: string;
      model?: string;
      provider?: string;
      tier?: string;
    }
  >();
  const handoffSet = new Map<string, { from: string; to: string }>();
  let totalDurationMs = 0;

  for (const entry of entries) {
    const prev = agentMap.get(entry.agent);
    agentMap.set(entry.agent, {
      durationMs: (prev?.durationMs ?? 0) + entry.agentDuration,
      toolCallCount: (prev?.toolCallCount ?? 0) + entry.tools.length,
      status: entry.status,
      model: entry.model ?? prev?.model,
      provider: entry.provider ?? prev?.provider,
      tier: entry.tier ?? prev?.tier,
    });

    for (const tc of entry.tools) {
      const prevTool = toolMap.get(tc.tool);
      toolMap.set(tc.tool, {
        durationMs: (prevTool?.durationMs ?? 0) + tc.duration,
        callCount: (prevTool?.callCount ?? 0) + 1,
        agent: entry.agent,
        model: tc.model ?? prevTool?.model,
        provider: tc.provider ?? prevTool?.provider,
        tier: tc.tier ?? prevTool?.tier,
      });
    }

    if (entry.handoffFrom) {
      const key = `${entry.handoffFrom}->${entry.agent}`;
      if (!handoffSet.has(key)) {
        handoffSet.set(key, { from: entry.handoffFrom, to: entry.agent });
      }
    }

    totalDurationMs += entry.agentDuration;
  }

  const isActive = entries.some((e) => e.status === "executing");

  return {
    nodes: Array.from(agentMap.entries()).map(([id, d]) => ({
      id,
      name: id,
      status: d.status,
      duration:
        d.durationMs > 0
          ? d.durationMs / 1000
          : d.toolCallCount > 0
          ? 0
          : undefined,
      toolCallCount: d.toolCallCount,
      model: d.model,
      provider: d.provider,
      tier: d.tier,
    })),
    tools: Array.from(toolMap.entries()).map(([id, d]) => ({
      id,
      name: id,
      agent: d.agent,
      description: `A ${id} tool`,
      callCount: d.callCount,
      duration: d.callCount > 0 ? d.durationMs / 1000 : undefined,
      model: d.model,
      provider: d.provider,
      tier: d.tier,
    })),
    handoffs: Array.from(handoffSet.entries()).map(([, h], i) => ({
      id: `handoff-${i}`,
      from: h.from,
      to: h.to,
      timestamp: 0,
    })),
    totalRounds: 0,
    totalDuration: totalDurationMs / 1000,
    isActive,
  };
}

export function AgentFlowVisualization({
  completedEntries,
  liveEntries,
  allEntries,
}: AgentFlowVisualizationProps) {
  const [showModelInfo, setShowModelInfo] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("session");
  const [popoverNodeId, setPopoverNodeId] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Unique request IDs in chronological order (for labelling "Req 1", "Req 2", etc.)
  const requestIds = useMemo(
    () => [...new Set(allEntries.map((e) => e.requestId))],
    [allEntries],
  );

  const totalRequests = requestIds.length;

  const agentFlowData = useMemo((): AgentFlowData => {
    if (viewMode === "session") {
      return aggregateEntries(allEntries);
    }
    if (viewMode === "latest") {
      if (liveEntries.length > 0) return aggregateEntries(liveEntries);
      const lastId = completedEntries[completedEntries.length - 1]?.requestId;
      return lastId
        ? aggregateEntries(
            completedEntries.filter((e) => e.requestId === lastId),
          )
        : aggregateEntries([]);
    }
    // viewMode is a requestId string
    const filtered = allEntries.filter((e) => e.requestId === viewMode);
    return filtered.length > 0
      ? aggregateEntries(filtered)
      : aggregateEntries(allEntries);
  }, [viewMode, allEntries, completedEntries, liveEntries]);

  const getNodeHistory = useCallback(
    (nodeId: string, kind: "agent" | "tool"): PopoverEntry[] => {
      const name = kind === "tool" ? nodeId.replace(/^tool-/, "") : nodeId;

      if (kind === "agent") {
        return allEntries
          .filter((e) => e.agent === name)
          .map((e) => ({
            requestId: e.requestId,
            requestLabel: requestIds.indexOf(e.requestId) + 1,
            duration: e.agentDuration / 1000,
            callCount: e.tools.length,
          }));
      }

      return allEntries
        .filter((e) => e.tools.some((t) => t.tool === name))
        .map((e) => {
          const calls = e.tools.filter((t) => t.tool === name);
          return {
            requestId: e.requestId,
            requestLabel: requestIds.indexOf(e.requestId) + 1,
            duration: calls.reduce((s, c) => s + c.duration, 0) / 1000,
            callCount: calls.length,
          };
        });
    },
    [allEntries, requestIds],
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (popoverNodeId === node.id) {
        setPopoverNodeId(null);
        setPopoverPos(null);
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopoverNodeId(node.id);
      setPopoverPos({
        x: _.clientX - rect.left,
        y: _.clientY - rect.top,
      });
    },
    [popoverNodeId],
  );

  const closePopover = useCallback(() => {
    setPopoverNodeId(null);
    setPopoverPos(null);
  }, []);

  const changeViewMode = useCallback(
    (mode: ViewMode) => {
      setViewMode(mode);
      closePopover();
    },
    [closePopover],
  );

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!popoverPos) return;
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: popoverPos.x,
        origY: popoverPos.y,
      };

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        setPopoverPos({
          x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
          y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
        });
      };
      const onUp = () => {
        dragRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [popoverPos],
  );

  // Convert agent flow data to ReactFlow nodes and edges
  const initialNodes: Node[] = useMemo(() => {
    const agentNodes = agentFlowData.nodes.map((node, index) => ({
      id: node.id,
      type: "agentNode",
      position: { x: index * 300, y: 50 },
      data: {
        ...node,
        label: node.name,
        showModelInfo,
      },
    }));

    const toolNodes = agentFlowData.tools.map((tool) => {
      const agentIndex = agentFlowData.nodes.findIndex(
        (n) => n.id === tool.agent,
      );
      return {
        id: `tool-${tool.id}`,
        type: "toolNode",
        position: { x: agentIndex >= 0 ? agentIndex * 300 : 0, y: 280 },
        data: {
          ...tool,
          label: tool.name,
          description: `A ${tool.name} tool`,
          showModelInfo,
        },
      };
    });

    return [...agentNodes, ...toolNodes];
  }, [agentFlowData.nodes, agentFlowData.tools, showModelInfo]);

  const initialEdges: Edge[] = useMemo(() => {
    const handoffEdges = agentFlowData.handoffs.map((handoff) => {
      const label = handoff.routingStrategy
        ? `Routing (${handoff.routingStrategy})`
        : handoff.reason || "Handoff";

      return {
        id: handoff.id,
        source: handoff.from,
        target: handoff.to,
        type: "smoothstep",
        animated: true,
        label,
        style: { stroke: "#3f3f46", strokeWidth: 1.5 },
        labelStyle: {
          fill: "#71717a",
          fontSize: 10,
          fontWeight: 500,
        },
        labelBgStyle: { fill: "#18181b", fillOpacity: 0.95 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: "#3f3f46",
        },
      };
    });

    const toolEdges = agentFlowData.tools.map((tool) => ({
      id: `edge-${tool.agent}-${tool.id}`,
      source: tool.agent || "",
      target: `tool-${tool.id}`,
      type: "smoothstep",
      animated: true,
      style: { stroke: "#3f3f46", strokeWidth: 1, strokeDasharray: "5,5" },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: "#3f3f46",
      },
    }));

    return [...handoffEdges, ...toolEdges];
  }, [agentFlowData.handoffs, agentFlowData.tools]);

  const { nodes, edges } = useMemo(
    () => getLayoutedElements(initialNodes, initialEdges, "LR"),
    [initialNodes, initialEdges],
  );

  if (agentFlowData.nodes.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
        }}
      >
        <div className="ai-devtools-state-explorer-empty-content">
          <div className="ai-devtools-state-explorer-empty-title">
            No Agent Activity
          </div>
          <div className="ai-devtools-state-explorer-empty-description">
            Start a conversation with an agent-based
            <br /> system to see the orchestration flow here
          </div>
        </div>
      </div>
    );
  }

  const popoverHistory =
    popoverNodeId != null
      ? getNodeHistory(
          popoverNodeId,
          popoverNodeId.startsWith("tool-") ? "tool" : "agent",
        )
      : [];

  const popoverLabel = popoverNodeId
    ? popoverNodeId.startsWith("tool-")
      ? popoverNodeId.replace("tool-", "")
      : popoverNodeId
    : "";

  // For request navigation in footer
  const isRequestView = viewMode !== "session" && viewMode !== "latest";
  const currentReqIdx = isRequestView ? requestIds.indexOf(viewMode) : -1;

  return (
    <div
      ref={containerRef}
      style={{ height: "100%", width: "100%", background: "#000000" }}
    >
      <div style={{ height: "100%", width: "100%", position: "relative" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={handleNodeClick}
          onPaneClick={closePopover}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 0.8 }}
          minZoom={0.3}
          maxZoom={2}
          nodesConnectable={false}
          edgesReconnectable={false}
          edgesFocusable={false}
          defaultEdgeOptions={{
            type: "smoothstep",
            animated: true,
          }}
        >
          <Background
            color="#3f3f46"
            gap={24}
            size={1}
            style={{ background: "#000000" }}
          />
        </ReactFlow>

        {/* Per-request history popover */}
        {popoverNodeId && popoverPos && popoverHistory.length > 0 && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              left: Math.min(
                popoverPos.x,
                (containerRef.current?.clientWidth ?? 400) - 260,
              ),
              top: Math.max(0, popoverPos.y - 180),
              width: 240,
              maxHeight: 220,
              overflowX: "hidden",
              overflowY: "auto",
              boxSizing: "border-box",
              background: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 6,
              padding: "10px 0",
              boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
              zIndex: 50,
              fontFamily:
                "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 11,
            }}
          >
            <div
              onMouseDown={onDragStart}
              style={{
                padding: "0 12px 8px",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: "#71717a",
                textTransform: "uppercase",
                borderBottom: "1px solid #27272a",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                cursor: "grab",
                userSelect: "none",
              }}
            >
              {popoverLabel} — history
            </div>

            {popoverHistory.map((entry) => (
              <button
                type="button"
                key={entry.requestId}
                onClick={() =>
                  setViewMode((v) =>
                    v === entry.requestId ? "session" : entry.requestId,
                  )
                }
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  padding: "6px 12px",
                  boxSizing: "border-box",
                  background:
                    viewMode === entry.requestId ? "#27272a" : "transparent",
                  border: "none",
                  color: "#f4f4f5",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 11,
                  textAlign: "left",
                }}
              >
                <span style={{ color: "#a1a1aa" }}>
                  Req {entry.requestLabel}
                </span>
                <span style={{ display: "flex", gap: 10 }}>
                  {entry.duration !== undefined && (
                    <span style={{ color: "#f4f4f5" }}>
                      {entry.duration.toFixed(2)}s
                    </span>
                  )}
                  {entry.callCount !== undefined && entry.callCount > 0 && (
                    <span style={{ color: "#71717a" }}>{entry.callCount}x</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "28px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 12px",
            fontFamily:
              "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
            fontSize: "10px",
            color: "#cccccc",
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
          }}
        >
          {/* Left: view mode controls */}
          <div style={{ display: "flex", gap: "2px", alignItems: "center" }}>
            {(["session", "latest"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => changeViewMode(mode)}
                style={{
                  background: viewMode === mode ? "#27272a" : "transparent",
                  border: `1px solid ${
                    viewMode === mode ? "#a78bfa" : "#3f3f46"
                  }`,
                  borderRadius: 3,
                  padding: "1px 8px",
                  fontSize: 10,
                  color: viewMode === mode ? "#a78bfa" : "#71717a",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  lineHeight: "16px",
                }}
              >
                {mode === "session" ? "All" : "Latest"}
              </button>
            ))}

            {isRequestView && currentReqIdx >= 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  marginLeft: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (currentReqIdx > 0)
                      changeViewMode(requestIds[currentReqIdx - 1]);
                  }}
                  disabled={currentReqIdx === 0}
                  style={{
                    background: "transparent",
                    border: "1px solid #3f3f46",
                    borderRadius: 3,
                    padding: "1px 4px",
                    fontSize: 10,
                    color: currentReqIdx === 0 ? "#27272a" : "#a1a1aa",
                    cursor: currentReqIdx === 0 ? "default" : "pointer",
                    fontFamily: "inherit",
                    lineHeight: "16px",
                  }}
                >
                  {"<"}
                </button>
                <span
                  style={{
                    padding: "0 4px",
                    fontSize: 10,
                    color: "#a78bfa",
                    whiteSpace: "nowrap",
                  }}
                >
                  Req {currentReqIdx + 1}/{totalRequests}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (currentReqIdx < totalRequests - 1)
                      changeViewMode(requestIds[currentReqIdx + 1]);
                  }}
                  disabled={currentReqIdx === totalRequests - 1}
                  style={{
                    background: "transparent",
                    border: "1px solid #3f3f46",
                    borderRadius: 3,
                    padding: "1px 4px",
                    fontSize: 10,
                    color:
                      currentReqIdx === totalRequests - 1
                        ? "#27272a"
                        : "#a1a1aa",
                    cursor:
                      currentReqIdx === totalRequests - 1
                        ? "default"
                        : "pointer",
                    fontFamily: "inherit",
                    lineHeight: "16px",
                  }}
                >
                  {">"}
                </button>
              </div>
            )}
          </div>

          {/* Right: toggle + stats */}
          <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setShowModelInfo((v) => !v)}
              style={{
                background: showModelInfo ? "#27272a" : "transparent",
                border: `1px solid ${showModelInfo ? "#a78bfa" : "#3f3f46"}`,
                borderRadius: 3,
                padding: "1px 8px",
                fontSize: 10,
                color: showModelInfo ? "#a78bfa" : "#71717a",
                cursor: "pointer",
                fontFamily: "inherit",
                lineHeight: "16px",
              }}
            >
              Models
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ fontWeight: 600, color: "#ffffff" }}>
                {agentFlowData.nodes.length}
              </span>
              <span style={{ color: "#666666" }}>Agents</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ fontWeight: 600, color: "#ffffff" }}>
                {agentFlowData.handoffs.length}
              </span>
              <span style={{ color: "#666666" }}>Handoffs</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ fontWeight: 600, color: "#ffffff" }}>
                {agentFlowData.totalDuration > 0
                  ? `${agentFlowData.totalDuration.toFixed(2)}s`
                  : "0s"}
              </span>
              <span style={{ color: "#666666" }}>Duration</span>
            </div>
          </div>
        </div>
      </div>

      <style>
        {`
          @keyframes pulse {
            0%, 100% {
              opacity: 1;
            }
            50% {
              opacity: 0.5;
            }
          }
          
          .react-flow__node {
            cursor: pointer;
          }
          
          .react-flow__edge-path {
            stroke: #3f3f46;
          }
          
          .react-flow__edge-text {
            fill: #71717a;
          }
          
          .react-flow__background {
            background: #000000;
          }
          
          .react-flow__pane {
            cursor: default;
          }
          
          .react-flow__panel.react-flow__attribution {
            display: none;
          }
        `}
      </style>
    </div>
  );
}
