"use client";

import {
  Background,
  type Edge,
  MarkerType,
  type Node,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import dagre from "dagre";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import type { AgentFlowData, AIEvent } from "../types";
import { AgentNode } from "./agent-node";
import { ToolNode } from "./tool-node";

type ViewMode = "session" | "latest" | number;

interface RequestEntry {
  requestIndex: number;
  duration?: number;
  callCount?: number;
}

interface AgentFlowVisualizationProps {
  events: AIEvent[];
}

const nodeTypes = {
  agentNode: AgentNode,
  toolNode: ToolNode,
} as const;

/**
 * Split the event stream into per-request groups.
 * Each group ends at an `agent-complete` event; any trailing events
 * after the last `agent-complete` form the active (in-progress) request.
 */
function segmentEventsByRequest(events: AIEvent[]): AIEvent[][] {
  const groups: AIEvent[][] = [];
  let current: AIEvent[] = [];

  for (const event of events) {
    current.push(event);
    if (event.type === "agent-complete") {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

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
      // Shift dagre node position (anchor=center) to top-left
      // to match React Flow node anchor point (top-left)
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// Process events into agent flow data
function processAgentEvents(events: AIEvent[]): AgentFlowData {
  const agentMap = new Map<
    string,
    {
      name: string;
      status: "idle" | "executing" | "completed" | "error";
      startTime?: number;
      endTime?: number;
      toolCallCount: number;
      routingStrategy?: "programmatic" | "llm";
      matchScore?: number;
      round?: number;
      model?: string;
      provider?: string;
      tier?: string;
    }
  >();
  const handoffs: Array<{
    id: string;
    from: string;
    to: string;
    reason?: string;
    routingStrategy?: "programmatic" | "llm";
    timestamp: number;
  }> = [];
  const toolMap = new Map<
    string,
    {
      name: string;
      agent?: string;
      description?: string;
      callCount: number;
      startTime?: number;
      endTime?: number;
      model?: string;
      provider?: string;
      tier?: string;
    }
  >();
  const toolCallIdToName = new Map<string, string>();
  const toolModelInfoMap = new Map<string, { model?: string; provider?: string; tier?: string }>();
  let totalRounds = 0;
  let isActive = false;
  let currentAgent: string | undefined;

  for (const event of events) {
    switch (event.type) {
      case "agent-start": {
        const agentName = event.metadata?.agent;
        if (agentName) {
          currentAgent = agentName;
          const existing = agentMap.get(agentName);
          agentMap.set(agentName, {
            name: agentName,
            status: "executing",
            startTime: existing?.startTime || event.timestamp,
            endTime: existing?.endTime,
            toolCallCount: existing?.toolCallCount || 0,
            routingStrategy: event.metadata?.routingStrategy,
            matchScore: event.metadata?.matchScore,
            round: event.metadata?.round,
            model: event.metadata?.model || existing?.model,
            provider: event.metadata?.provider || existing?.provider,
            tier: event.metadata?.tier || existing?.tier,
          });
          isActive = true;
        }
        break;
      }

      case "agent-finish": {
        const agentName = event.metadata?.agent;
        if (agentName && agentMap.has(agentName)) {
          const agent = agentMap.get(agentName);
          if (agent) {
            agentMap.set(agentName, {
              ...agent,
              status: "completed",
              endTime: event.timestamp,
              model: event.metadata?.model || agent.model,
              provider: event.metadata?.provider || agent.provider,
              tier: event.metadata?.tier || agent.tier,
            });
          }
        }
        break;
      }

      case "agent-error": {
        const agentName = event.metadata?.agent;
        if (agentName && agentMap.has(agentName)) {
          const agent = agentMap.get(agentName);
          if (agent) {
            agentMap.set(agentName, {
              ...agent,
              status: "error",
              endTime: event.timestamp,
            });
          }
        }
        break;
      }

      case "agent-handoff": {
        const fromAgent = event.metadata?.fromAgent;
        const toAgent = event.metadata?.toAgent;
        if (fromAgent && toAgent) {
          handoffs.push({
            id: `handoff-${handoffs.length}`,
            from: fromAgent,
            to: toAgent,
            reason: event.metadata?.reason,
            routingStrategy: event.metadata?.routingStrategy,
            timestamp: event.timestamp,
          });

          // Set routing strategy on the target agent
          if (toAgent && event.metadata?.routingStrategy) {
            const targetAgent = agentMap.get(toAgent);
            if (targetAgent) {
              agentMap.set(toAgent, {
                ...targetAgent,
                routingStrategy: event.metadata.routingStrategy,
              });
            } else {
              // Create placeholder for target agent if it doesn't exist yet
              agentMap.set(toAgent, {
                name: toAgent,
                status: "idle",
                toolCallCount: 0,
                routingStrategy: event.metadata.routingStrategy,
              });
            }
          }
        }
        break;
      }

      case "agent-complete": {
        totalRounds = event.metadata?.totalRounds || totalRounds;
        isActive = false;
        break;
      }

      case "tool-model-info": {
        const tools = event.data?.tools;
        if (tools && typeof tools === "object") {
          for (const [name, info] of Object.entries(tools)) {
            toolModelInfoMap.set(name, info as { model?: string; provider?: string; tier?: string });
          }
        }
        break;
      }

      case "tool-call-start": {
        // Track tool calls and create tool nodes
        const toolName = event.metadata?.toolName || event.data?.toolName;
        const toolCallId = event.metadata?.toolCallId || event.data?.toolCallId;
        const agentName = currentAgent || event.metadata?.agent;

        // Filter out internal orchestration tools from visualization
        const isInternalTool = toolName === "handoff_to_agent"

        // Only track valid tool names (not undefined, empty, "unknown", or internal)
        if (
          toolName &&
          toolName !== "unknown" &&
          toolName.trim() !== "" &&
          !isInternalTool
        ) {
          if (toolCallId) toolCallIdToName.set(toolCallId, toolName);

          const declaredInfo = toolModelInfoMap.get(toolName);
          const existing = toolMap.get(toolName);
          toolMap.set(toolName, {
            name: toolName,
            agent: agentName,
            description: event.metadata?.description || `${toolName} tool`,
            callCount: (existing?.callCount || 0) + 1,
            startTime: existing?.startTime ?? event.timestamp,
            endTime: existing?.endTime,
            model: existing?.model || declaredInfo?.model,
            provider: existing?.provider || declaredInfo?.provider,
            tier: existing?.tier || declaredInfo?.tier,
          });

          // Also increment agent's tool call count
          if (agentName && agentMap.has(agentName)) {
            const agent = agentMap.get(agentName);
            if (agent) {
              agentMap.set(agentName, {
                ...agent,
                toolCallCount: agent.toolCallCount + 1,
              });
            }
          }
        }
        break;
      }

      case "tool-call-result": {
        const toolCallId = event.metadata?.toolCallId || event.data?.toolCallId;
        const directName = event.metadata?.toolName || event.data?.toolName;
        const toolName =
          (directName && toolMap.has(directName) ? directName : null) ||
          (toolCallId ? toolCallIdToName.get(toolCallId) : null);

        if (toolName && toolMap.has(toolName)) {
          const tool = toolMap.get(toolName)!;
          toolMap.set(toolName, {
            ...tool,
            endTime: event.timestamp,
          });
        }
        break;
      }

      case "finish": {
        if (currentAgent && agentMap.has(currentAgent)) {
          const agent = agentMap.get(currentAgent);
          if (agent) {
            const responseModel =
              event.data?.response?.model || event.data?.model;
            agentMap.set(currentAgent, {
              ...agent,
              status: agent.status === "executing" ? "completed" : agent.status,
              endTime: agent.endTime ?? event.timestamp,
              ...(responseModel ? { model: responseModel } : {}),
            });
          }
        }
        isActive = false;
        break;
      }
    }
  }

  const nodes = Array.from(agentMap.entries()).map(([id, data]) => ({
    id,
    ...data,
    duration:
      data.startTime && data.endTime
        ? (data.endTime - data.startTime) / 1000
        : undefined,
  }));

  const tools = Array.from(toolMap.entries()).map(([id, data]) => ({
    id,
    ...data,
    duration:
      data.startTime && data.endTime
        ? (data.endTime - data.startTime) / 1000
        : undefined,
  }));

  const firstEvent = events.find(
    (e) => e.type === "agent-start" || e.type === "agent-handoff",
  );
  const lastEvent = [...events]
    .reverse()
    .find((e) => e.type === "agent-finish" || e.type === "agent-complete");

  const totalDuration =
    firstEvent && lastEvent
      ? (lastEvent.timestamp - firstEvent.timestamp) / 1000
      : 0;

  return {
    nodes,
    tools,
    handoffs,
    totalRounds,
    totalDuration,
    isActive,
  };
}

export function AgentFlowVisualization({
  events,
}: AgentFlowVisualizationProps) {
  const [showModelInfo, setShowModelInfo] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("session");
  const [popoverNodeId, setPopoverNodeId] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const requestGroups = useMemo(
    () => segmentEventsByRequest(events),
    [events],
  );

  const totalRequests = requestGroups.length;

  const filteredEvents = useMemo(() => {
    if (viewMode === "session") return events;
    if (viewMode === "latest") return requestGroups[totalRequests - 1] ?? [];
    if (typeof viewMode === "number") return requestGroups[viewMode] ?? [];
    return events;
  }, [events, viewMode, requestGroups, totalRequests]);

  const agentFlowData = useMemo(
    () => processAgentEvents(filteredEvents),
    [filteredEvents],
  );

  // Pre-process per-request flow data for the drill-down popover
  const perRequestFlowData = useMemo(
    () => requestGroups.map((group) => processAgentEvents(group)),
    [requestGroups],
  );

  // Build per-node request history for popover
  const getNodeHistory = useCallback(
    (nodeId: string, kind: "agent" | "tool"): RequestEntry[] => {
      const entries: RequestEntry[] = [];
      for (let i = 0; i < perRequestFlowData.length; i++) {
        const data = perRequestFlowData[i];
        if (kind === "agent") {
          const node = data.nodes.find((n) => n.id === nodeId);
          if (node) {
            entries.push({
              requestIndex: i,
              duration: node.duration,
              callCount: node.toolCallCount,
            });
          }
        } else {
          const rawId = nodeId.replace(/^tool-/, "");
          const tool = data.tools.find((t) => t.id === rawId);
          if (tool) {
            entries.push({
              requestIndex: i,
              duration: tool.duration,
              callCount: tool.callCount,
            });
          }
        }
      }
      return entries;
    },
    [perRequestFlowData],
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

  const layoutedElements = useMemo(() => {
    return getLayoutedElements(initialNodes, initialEdges, "LR");
  }, [initialNodes, initialEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(
    layoutedElements.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    layoutedElements.edges,
  );

  useEffect(() => {
    const newLayout = getLayoutedElements(initialNodes, initialEdges, "LR");
    setNodes(newLayout.nodes);
    setEdges(newLayout.edges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onInit = useCallback(() => {}, []);

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

  return (
    <div ref={containerRef} style={{ height: "100%", width: "100%", background: "#000000" }}>
      <div style={{ height: "100%", width: "100%", position: "relative" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onPaneClick={closePopover}
          onInit={onInit}
          nodeTypes={nodeTypes}
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
            style={{
              position: "absolute",
              left: Math.min(popoverPos.x, (containerRef.current?.clientWidth ?? 400) - 260),
              top: Math.max(0, popoverPos.y - 180),
              width: 240,
              maxHeight: 220,
              overflowY: "auto",
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
              style={{
                padding: "0 12px 8px",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: "#71717a",
                textTransform: "uppercase",
                borderBottom: "1px solid #27272a",
              }}
            >
              {popoverLabel} — request history
            </div>

            {popoverHistory.map((entry) => (
              <button
                type="button"
                key={entry.requestIndex}
                onClick={() => changeViewMode(entry.requestIndex)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  padding: "6px 12px",
                  background:
                    typeof viewMode === "number" && viewMode === entry.requestIndex
                      ? "#27272a"
                      : "transparent",
                  border: "none",
                  color: "#f4f4f5",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 11,
                  textAlign: "left",
                }}
              >
                <span style={{ color: "#a1a1aa" }}>
                  Req {entry.requestIndex + 1}
                </span>
                <span style={{ display: "flex", gap: 10 }}>
                  {entry.duration !== undefined && (
                    <span style={{ color: "#f4f4f5" }}>
                      {entry.duration.toFixed(2)}s
                    </span>
                  )}
                  {entry.callCount !== undefined && entry.callCount > 0 && (
                    <span style={{ color: "#71717a" }}>
                      {entry.callCount}x
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        
        {/* Footer */}
        <div style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "28px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 12px",
          fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
          fontSize: "10px",
          color: "#cccccc",
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
        }}>
          {/* Left: view mode controls */}
          <div style={{ display: "flex", gap: "2px", alignItems: "center" }}>
            {(["session", "latest"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => changeViewMode(mode)}
                style={{
                  background: viewMode === mode ? "#27272a" : "transparent",
                  border: `1px solid ${viewMode === mode ? "#a78bfa" : "#3f3f46"}`,
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

            {typeof viewMode === "number" && (
              <div style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: 4 }}>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof viewMode === "number" && viewMode > 0)
                      changeViewMode(viewMode - 1);
                  }}
                  disabled={viewMode === 0}
                  style={{
                    background: "transparent",
                    border: "1px solid #3f3f46",
                    borderRadius: 3,
                    padding: "1px 4px",
                    fontSize: 10,
                    color: viewMode === 0 ? "#27272a" : "#a1a1aa",
                    cursor: viewMode === 0 ? "default" : "pointer",
                    fontFamily: "inherit",
                    lineHeight: "16px",
                  }}
                >
                  {"<"}
                </button>
                <span style={{
                  padding: "0 4px",
                  fontSize: 10,
                  color: "#a78bfa",
                  whiteSpace: "nowrap",
                }}>
                  Req {viewMode + 1}/{totalRequests}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof viewMode === "number" && viewMode < totalRequests - 1)
                      changeViewMode(viewMode + 1);
                  }}
                  disabled={viewMode === totalRequests - 1}
                  style={{
                    background: "transparent",
                    border: "1px solid #3f3f46",
                    borderRadius: 3,
                    padding: "1px 4px",
                    fontSize: 10,
                    color:
                      viewMode === totalRequests - 1 ? "#27272a" : "#a1a1aa",
                    cursor:
                      viewMode === totalRequests - 1 ? "default" : "pointer",
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
              <span style={{ fontWeight: 600, color: "#ffffff" }}>{agentFlowData.nodes.length}</span>
              <span style={{ color: "#666666" }}>Agents</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ fontWeight: 600, color: "#ffffff" }}>{agentFlowData.handoffs.length}</span>
              <span style={{ color: "#666666" }}>Handoffs</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ fontWeight: 600, color: "#ffffff" }}>{agentFlowData.totalRounds}</span>
              <span style={{ color: "#666666" }}>Rounds</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ fontWeight: 600, color: "#ffffff" }}>
                {agentFlowData.totalDuration > 0 
                  ? `${(agentFlowData.totalDuration / 1000).toFixed(2)}s`
                  : "0s"
                }
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
