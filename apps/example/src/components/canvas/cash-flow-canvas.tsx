"use client";

import { useArtifact } from "ai-sdk-tools/client";
import { ArrowDownLeft, ArrowUpRight, DollarSign, Wallet } from "lucide-react";
import { parseAsInteger, useQueryState } from "nuqs";
import { memo, useMemo } from "react";
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import { CashFlowArtifact } from "@/ai/artifacts/cash-flow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { ProgressToast } from "@/components/ui/progress-toast";

const CHART_CONFIG = {
  operating: {
    label: "Operating",
    theme: {
      light: "hsl(220 70% 50%)",
      dark: "hsl(220 70% 60%)",
    },
  },
  investing: {
    label: "Investing",
    theme: {
      light: "hsl(160 60% 45%)",
      dark: "hsl(160 60% 55%)",
    },
  },
  financing: {
    label: "Financing",
    theme: {
      light: "hsl(30 80% 50%)",
      dark: "hsl(30 80% 60%)",
    },
  },
};

function CashFlowCanvasInner() {
  const [version] = useQueryState("version", parseAsInteger.withDefault(0));
  const [artifact] = useArtifact(CashFlowArtifact, { version });

  const chartData = useMemo(() => {
    if (!artifact.data?.data?.chartData?.length) return [];
    return artifact.data.data.chartData;
  }, [artifact.data]);

  if (!artifact.data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-xs text-muted-foreground">
            Loading cash flow...
          </p>
        </div>
      </div>
    );
  }

  const data = artifact.data;
  const isLoading = data.stage !== "complete";
  const { operating, investing, financing, netCashFlow } = data.data;
  const currency = data.currency || "USD";

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="space-y-1 pb-4 border-b">
          <h2 className="text-2xl tracking-tight font-mono">
            Cash Flow Statement
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
              <CardTitle className="text-sm">Cash Flow by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={CHART_CONFIG} className="h-[280px]">
                <BarChart data={chartData}>
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    className="text-xs"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    className="text-xs"
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
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
                <ArrowUpRight className="h-4 w-4" />
                <div>
                  <p className="text-xs text-muted-foreground">Operating</p>
                  <p className="text-lg font-semibold">
                    {currency} {operating.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <ArrowDownLeft className="h-4 w-4" />
                <div>
                  <p className="text-xs text-muted-foreground">Investing</p>
                  <p className="text-lg font-semibold">
                    {currency} {investing.toLocaleString()}
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
                  <p className="text-xs text-muted-foreground">Financing</p>
                  <p className="text-lg font-semibold">
                    {currency} {financing.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Wallet className="h-4 w-4" />
                <div>
                  <p className="text-xs text-muted-foreground">Net Cash Flow</p>
                  <p className="text-lg font-semibold">
                    {currency} {netCashFlow.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <ProgressToast
          isVisible={isLoading}
          stage={data.stage}
          message={isLoading ? `${data.stage}...` : undefined}
        />
      </div>
    </div>
  );
}

export const CashFlowCanvas = memo(CashFlowCanvasInner);
