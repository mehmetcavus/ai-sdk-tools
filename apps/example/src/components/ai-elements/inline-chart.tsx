"use client";

import { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { StreamdownContext } from "streamdown";
import { CopyIcon } from "lucide-react";
import { Loader } from "@/components/ai-elements/loader";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

/** Hex colors - Recharts/Mermaid don't support var() */
const CHART_COLORS = [
  "#d97706", // chart-1
  "#0d9488", // chart-2
  "#6366f1", // chart-3
  "#eab308", // chart-4
  "#d946ef", // chart-5
];

export type ChartDataSpec = {
  type: "bar" | "line" | "area" | "pie";
  title?: string;
  data: Array<Record<string, string | number>>;
  xKey?: string;
  yKey?: string;
  /** For multi-series: [{ key, label }] */
  series?: Array<{ key: string; label?: string }>;
};

const RECHARTS_TYPES = ["bar", "line", "area", "pie"] as const;

export function parseChartSpec(raw: string): ChartDataSpec | null {
  const result = parseChartSpecWithError(raw);
  return result.spec;
}

/** Attempt to fix common AI JSON mistakes ( ) vs } { */
function tryRepairJson(s: string): string {
  return s
    .replace(/\}\s*\)/g, "}") // } ) -> }
    .replace(/\(\s*\{/g, "{") // ( { -> {
    .replace(/\(\s*"/g, '{"') // ( " -> { "
    .replace(/: (\d+)\)/g, ": $1}") // : 67) -> : 67}
    .replace(/\}\s*\)\s*,/g, "},") // } ) , -> },
    .replace(/,\s*\(\s*\{/g, ",{"); // , ( { -> ,{
}

/** Returns spec and parse error for debugging */
export function parseChartSpecWithError(
  raw: string
): { spec: ChartDataSpec | null; parseError?: string } {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("type" in parsed) ||
      !("data" in parsed) ||
      !Array.isArray((parsed as ChartDataSpec).data)
    ) {
      return {
        spec: null,
        parseError: "Missing type or data array",
      };
    }
    const spec = parsed as ChartDataSpec;
    if (!RECHARTS_TYPES.includes(spec.type)) {
      return { spec: null, parseError: `Unsupported type: ${spec.type}` };
    }
    // Auto-infer xKey/series from first data item when missing
    const first = spec.data[0];
    if (first && typeof first === "object") {
      const keys = Object.keys(first);
      const numKeys = keys.filter((k) => typeof first[k] === "number");
      const strKeys = keys.filter((k) => typeof first[k] === "string");
      if (!spec.xKey && strKeys.length > 0) {
        spec.xKey = strKeys[0];
      }
      if (!spec.series && numKeys.length > 0) {
        const xKey = spec.xKey ?? "name";
        const valueKeys = numKeys.filter((k) => k !== xKey);
        if (valueKeys.length > 0) {
          spec.series = valueKeys.map((k) => ({ key: k, label: k }));
        }
      }
    }
    return { spec };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Try repair and parse again
    try {
      const repaired = tryRepairJson(trimmed);
      const parsed = JSON.parse(repaired) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "type" in parsed &&
        "data" in parsed &&
        Array.isArray((parsed as ChartDataSpec).data)
      ) {
        const spec = parsed as ChartDataSpec;
        if (RECHARTS_TYPES.includes(spec.type)) {
          const first = spec.data[0];
          if (first && typeof first === "object") {
            const keys = Object.keys(first);
            const numKeys = keys.filter((k) => typeof first[k] === "number");
            const strKeys = keys.filter((k) => typeof first[k] === "string");
            if (!spec.xKey && strKeys.length > 0) spec.xKey = strKeys[0];
            if (!spec.series && numKeys.length > 0) {
              const xKey = spec.xKey ?? "name";
              spec.series = numKeys
                .filter((k) => k !== xKey)
                .map((k) => ({ key: k, label: k }));
            }
          }
          return { spec };
        }
      }
    } catch {
      // Repair failed, return original error
    }
    return { spec: null, parseError: msg };
  }
}

function RechartsBarChart({ spec }: { spec: ChartDataSpec }) {
  const xKey = spec.xKey ?? "name";
  const yKey = spec.yKey ?? "value";
  const config = useMemo(
    () =>
      Object.fromEntries(
        (spec.series ?? [{ key: yKey }]).map((s, i) => [
          s.key,
          {
            label: s.label ?? s.key,
            theme: {
              light: "hsl(0 0% 0%)",
              dark: "hsl(0 0% 100%)",
            },
          },
        ])
      ),
    [spec.series, yKey]
  );

  return (
    <ChartContainer config={config} className="h-[280px] w-full">
      <BarChart data={spec.data}>
        <XAxis
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          padding={{ left: 0, right: 16 }}
          className="text-xs"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="text-xs"
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => [String(value), ""]}
            />
          }
        />
        {(spec.series ?? [{ key: yKey }]).map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            fill={CHART_COLORS[i % CHART_COLORS.length]}
            radius={0}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

function RechartsLineChart({ spec }: { spec: ChartDataSpec }) {
  const xKey = spec.xKey ?? "name";
  const yKey = spec.yKey ?? "value";
  const config = useMemo(
    () =>
      Object.fromEntries(
        (spec.series ?? [{ key: yKey }]).map((s, i) => [
          s.key,
          {
            label: s.label ?? s.key,
            theme: {
              light: "hsl(0 0% 0%)",
              dark: "hsl(0 0% 100%)",
            },
          },
        ])
      ),
    [spec.series, yKey]
  );

  return (
    <ChartContainer config={config} className="h-[280px] w-full">
      <LineChart data={spec.data}>
        <XAxis
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          padding={{ left: 0, right: 16 }}
          className="text-xs"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="text-xs"
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => [String(value), ""]}
            />
          }
        />
        {(spec.series ?? [{ key: yKey }]).map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

function RechartsAreaChart({ spec }: { spec: ChartDataSpec }) {
  const xKey = spec.xKey ?? "name";
  const yKey = spec.yKey ?? "value";
  const config = useMemo(
    () =>
      Object.fromEntries(
        (spec.series ?? [{ key: yKey }]).map((s) => [
          s.key,
          {
            label: s.label ?? s.key,
            theme: {
              light: "hsl(0 0% 0%)",
              dark: "hsl(0 0% 100%)",
            },
          },
        ])
      ),
    [spec.series, yKey]
  );

  return (
    <ChartContainer config={config} className="h-[280px] w-full">
      <AreaChart data={spec.data}>
        <XAxis
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          padding={{ left: 0, right: 16 }}
          className="text-xs"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="text-xs"
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => [String(value), ""]}
            />
          }
        />
        {(spec.series ?? [{ key: yKey }]).map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            fill={CHART_COLORS[i % CHART_COLORS.length]}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            fillOpacity={0.3}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}

function RechartsPieChart({ spec }: { spec: ChartDataSpec }) {
  const yKey = spec.yKey ?? "value";
  const nameKey = spec.xKey ?? "name";
  const dataWithFill = useMemo(
    () =>
      spec.data.map((d, i) => ({
        ...d,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      })),
    [spec.data]
  );

  const config = useMemo(
    () => ({
      [yKey]: {
        label: yKey,
        theme: { light: "hsl(0 0% 0%)", dark: "hsl(0 0% 100%)" },
      },
    }),
    [yKey]
  );

  return (
    <ChartContainer config={config} className="h-[280px] w-full">
      <PieChart>
        <Pie
          data={dataWithFill}
          dataKey={yKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
        >
          {dataWithFill.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => [String(value), ""]}
            />
          }
        />
      </PieChart>
    </ChartContainer>
  );
}

/** Render Mermaid diagram (fallback when Recharts doesn't support the chart type) */
function MermaidChart({ code, className }: { code: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    if (!code || typeof window === "undefined") return;
    let cancelled = false;
    import("mermaid")
      .then((m) => {
        if (cancelled) return;
        m.default.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            primaryColor: "#d97706",
            primaryTextColor: "#111827",
            lineColor: "#6b7280",
          },
        });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        return m.default.render(id, code).then(({ svg: s }) => {
          if (!cancelled) {
            setSvg(s);
            setError(null);
          }
        });
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (svg && containerRef.current) {
      containerRef.current.innerHTML = svg;
    }
  }, [svg]);

  if (error) {
    return (
      <div className={cn("my-4 rounded-lg border bg-muted/30 p-4", className)}>
        <span className="text-xs text-muted-foreground">{error}</span>
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className={cn(
        "my-4 min-h-[200px] rounded-lg border bg-muted/30 p-4 flex items-center justify-center [&>svg]:max-w-full",
        className
      )}
    />
  );
}

export const InlineChart = memo(function InlineChart({
  code,
  language,
  className,
}: {
  code: string;
  language: string;
  className?: string;
}) {
  if (language !== "chart" && language !== "chart-data") return null;

  const { spec, parseError } = parseChartSpecWithError(code);

  if (spec && RECHARTS_TYPES.includes(spec.type)) {
    const Chart =
      spec.type === "bar"
        ? RechartsBarChart
        : spec.type === "line"
          ? RechartsLineChart
          : spec.type === "area"
            ? RechartsAreaChart
            : RechartsPieChart;

    return (
      <div
        className={cn(
          "my-4 overflow-hidden rounded-lg border bg-background",
          className
        )}
      >
        {spec.title && (
          <div className="border-b px-4 py-2">
            <p className="text-sm font-medium text-foreground">{spec.title}</p>
          </div>
        )}
        <div className="p-4">
          <Chart spec={spec} />
        </div>
      </div>
    );
  }

  // Mermaid fallback only for content that looks like Mermaid (flowchart, xychart, etc.)
  // Don't pass JSON to Mermaid - it expects diagram syntax, not chart JSON
  const looksLikeMermaid = /^\s*(flowchart|xychart|sequenceDiagram|pie|gantt|stateDiagram|erDiagram|journey|gitGraph|mindmap|quadrantChart|sankey|timeline)\b/i.test(
    code.trim()
  );
  if (looksLikeMermaid) {
    return <MermaidChart code={code} className={className} />;
  }

  // Use Streamdown's streaming state - show loading when still streaming
  const streamdownCtx = useContext(StreamdownContext);
  const isStreaming = streamdownCtx?.isAnimating ?? false;
  if (isStreaming) {
    return (
      <div
        className={cn(
          "my-4 flex items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 py-12",
          className
        )}
      >
        <Loader size={20} className="text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading chart...</span>
      </div>
    );
  }

  // Malformed or unsupported (complete content) - show raw code with copy button
  return (
    <ChartDebugFallback
      code={code}
      parseError={parseError}
      className={className}
    />
  );
});

function ChartDebugFallback({
  code,
  parseError,
  className,
}: {
  code: string;
  parseError?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div
      className={cn(
        "my-4 overflow-hidden rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-amber-200/50 px-4 py-2.5 dark:border-amber-800/50">
        <span className="min-w-0 flex-1 text-xs font-medium text-amber-800 dark:text-amber-200">
          {parseError ? `Parse error: ${parseError}` : "Could not render chart"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex shrink-0 items-center gap-2 rounded-md border border-amber-300/60 bg-amber-100/80 px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-200/80 dark:border-amber-700/60 dark:bg-amber-900/50 dark:text-amber-100 dark:hover:bg-amber-800/60"
          title="Copy JSON"
        >
          <CopyIcon className="h-4 w-4" aria-hidden />
          {copied ? "Copied!" : "Copy JSON"}
        </button>
      </div>
      <pre className="max-h-48 overflow-auto p-4 text-xs">
        <code>{code}</code>
      </pre>
    </div>
  );
}
