import { getWriter } from "@ai-sdk-tools/artifacts";
import { tool } from "ai";
import { z } from "zod";
import { ProfitLossArtifact } from "@/ai/artifacts/profit-loss";
import { currencyFilterSchema, dateRangeSchema } from "@/ai/types/filters";
import { generateProfitLossMetrics } from "@/ai/utils/fake-data";
import { generateArtifactDescription } from "@/lib/artifact-title";
import { delay } from "@/lib/delay";

/**
 * Profit & Loss (P&L) Tool
 *
 * Generates profit and loss statements for financial reporting.
 */
export const profitLossTool = tool({
  description: `Get profit and loss (P&L) metrics for a specified date range. Use useArtifact: true when the user asks for visual charts or visualizations.`,

  inputSchema: dateRangeSchema.merge(currencyFilterSchema).extend({
    useArtifact: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When the user asks for visual report or charts, use this flag to enable the chart visualization",
      ),
  }),

  execute: async function* (
    { from, to, currency, useArtifact },
    executionOptions,
  ) {
    if (!useArtifact) {
      const data = generateProfitLossMetrics({ from, to, currency });
      yield {
        text: `P&L for ${from} to ${to}: Revenue ${currency || "USD"} ${data.revenue.toLocaleString()}, Expenses ${data.expenses.total.toLocaleString()}, Net Profit ${data.profit.net.toLocaleString()} (${data.profit.margin}% margin).`,
      };
      return data;
    }

    const writer = getWriter(executionOptions);
    const description = generateArtifactDescription(from, to);
    const data = generateProfitLossMetrics({ from, to, currency });

    const analysis = ProfitLossArtifact.stream(
      {
        description,
        asOfDate: to,
        stage: "generating",
        progress: 0,
        currency: currency || "USD",
        data: {
          revenue: 0,
          expenses: { total: 0, breakdown: { operating: 0, personnel: 0, other: 0 } },
          profit: { gross: 0, net: 0, margin: "0" },
          chartData: [],
        },
      },
      writer,
    );

    yield { text: `Generating profit & loss chart for ${from} to ${to}...` };
    await delay(300);

    const { expenses, profit } = data;
    const chartData = [
      { name: "Revenue", value: data.revenue, fill: "var(--chart-1)" },
      { name: "Operating", value: expenses.breakdown.operating, fill: "var(--chart-2)" },
      { name: "Personnel", value: expenses.breakdown.personnel, fill: "var(--chart-3)" },
      { name: "Other", value: expenses.breakdown.other, fill: "var(--chart-4)" },
    ];

    await analysis.update({
      stage: "generating",
      progress: 0.5,
      data: {
        revenue: data.revenue,
        expenses: data.expenses,
        profit: data.profit,
        chartData,
      },
    });
    await delay(200);

    await analysis.complete({
      description,
      asOfDate: to,
      stage: "complete",
      progress: 1,
      currency: currency || "USD",
      data: {
        revenue: data.revenue,
        expenses: data.expenses,
        profit: data.profit,
        chartData,
      },
    });

    yield {
      text: `Profit & loss chart ready. Revenue: ${currency || "USD"} ${data.revenue.toLocaleString()}, Net profit: ${data.profit.net.toLocaleString()} (${data.profit.margin}% margin).`,
      forceStop: true,
    };

    return { ...data, forceStop: true };
  },
});
