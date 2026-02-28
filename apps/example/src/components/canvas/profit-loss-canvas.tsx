"use client";

import { useArtifact } from "ai-sdk-tools/client";
import { BarChart3, DollarSign, TrendingDown, TrendingUp } from "lucide-react";
import { parseAsInteger, useQueryState } from "nuqs";
import { memo, useMemo } from "react";
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import { ProfitLossArtifact } from "@/ai/artifacts/profit-loss";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { ProgressToast } from "@/components/ui/progress-toast";

const CHART_CONFIG = {
  revenue: {
    label: "Revenue",
    theme: {
      light: "hsl(0 0% 0%)",
      dark: "hsl(0 0% 100%)",
    },
  },
  operating: {
    label: "Operating",
    theme: {
      light: "hsl(220 70% 50%)",
      dark: "hsl(220 70% 60%)",
    },
  },
  personnel: {
    label: "Personnel",
    theme: {
      light: "hsl(160 60% 45%)",
      dark: "hsl(160 60% 55%)",
    },
  },
  other: {
    label: "Other",
    theme: {
      light: "hsl(30 80% 50%)",
      dark: "hsl(30 80% 60%)",
    },
  },
};

function ProfitLossCanvasInner() {
  const [version] = useQueryState("version", parseAsInteger.withDefault(0));
  const [artifact] = useArtifact(ProfitLossArtifact, { version });

  const chartData = useMemo(() => {
    if (!artifact.data?.data?.chartData?.length) return [];
    return artifact.data.data.chartData;
  }, [artifact.data]);

  if (!artifact.data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-xs text-muted-foreground">
            Loading profit & loss...
          </p>
        </div>
      </div>
    );
  }

  const data = artifact.data;
  const isLoading = data.stage !== "complete";
  const { revenue, expenses, profit } = data.data;
  const currency = data.currency || "USD";

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="space-y-1 pb-4 border-b">
          <h2 className="text-2xl tracking-tight font-mono">
            Profit & Loss Statement
          </h2>
          {data.description && (
            <p className="text-sm text-muted-foreground">
              {data.description}
            </p>
          )}
        </div>

        {chartData.length > 0 && (
          <Card className="border-0 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Revenue vs Expenses</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={CHART_CONFIG} className="h-[280px]">
                <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" width={80} tickLine={false} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => [
                          `${currency} ${Number(value).toLocaleString()}`,
                          "",
                        ]}
                      />
                    }
                  />
                  <Bar dataKey="value" radius={0}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Card className="shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-4 w-4" />
                <div>
                  <p className="text-xs text-muted-foreground">Revenue</p>
                  <p className="text-lg font-semibold">
                    {currency} {revenue.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <TrendingDown className="h-4 w-4" />
                <div>
                  <p className="text-xs text-muted-foreground">Expenses</p>
                  <p className="text-lg font-semibold">
                    {currency} {expenses.total.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <BarChart3 className="h-4 w-4" />
                <div>
                  <p className="text-xs text-muted-foreground">Net Profit</p>
                  <p className="text-lg font-semibold">
                    {currency} {profit.net.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <DollarSign className="h-4 w-4" />
                <div>
                  <p className="text-xs text-muted-foreground">Net Margin</p>
                  <p className="text-lg font-semibold">{profit.margin}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-xs">
              <span>Operating</span>
              <span className="font-mono">
                {currency} {expenses.breakdown.operating.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span>Personnel</span>
              <span className="font-mono">
                {currency} {expenses.breakdown.personnel.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span>Other</span>
              <span className="font-mono">
                {currency} {expenses.breakdown.other.toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <ProgressToast
          isVisible={isLoading}
          stage={data.stage}
          message={isLoading ? `${data.stage}...` : undefined}
        />
      </div>
    </div>
  );
}

export const ProfitLossCanvas = memo(ProfitLossCanvasInner);
