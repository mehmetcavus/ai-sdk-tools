import { getWriter } from "@ai-sdk-tools/artifacts";
import { tool } from "ai";
import { z } from "zod";
import { CashFlowArtifact } from "@/ai/artifacts/cash-flow";
import { currencyFilterSchema, dateRangeSchema } from "@/ai/types/filters";
import { generateCashFlowMetrics } from "@/ai/utils/fake-data";
import { generateArtifactDescription } from "@/lib/artifact-title";
import { delay } from "@/lib/delay";

/**
 * Cash Flow Analysis Tool
 *
 * Provides cash flow statements and analysis with:
 * - Operating activities
 * - Investing activities
 * - Financing activities
 * - Net cash flow
 */
export const cashFlowTool = tool({
  description: `Get cash flow statement and analysis for a specified period. Use useArtifact: true when the user asks for visual charts or visualizations.`,

  inputSchema: dateRangeSchema.merge(currencyFilterSchema).extend({
    categories: z
      .array(z.enum(["operating", "investing", "financing"]))
      .optional()
      .describe("Specific cash flow categories to include"),
    useArtifact: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When the user asks for visual report or charts, use this flag to enable the chart visualization",
      ),
  }),

  execute: async function* (
    { from, to, currency, categories, useArtifact },
    executionOptions,
  ) {
    if (!useArtifact) {
      const data = generateCashFlowMetrics({ from, to, currency, categories });
      yield {
        text: `Cash flow for ${from} to ${to}: Operating ${currency || "USD"} ${data.cashFlow.operating.toLocaleString()}, Investing ${data.cashFlow.investing.toLocaleString()}, Financing ${data.cashFlow.financing.toLocaleString()}, Net ${data.cashFlow.netCashFlow.toLocaleString()}.`,
      };
      return data;
    }

    const writer = getWriter(executionOptions);
    const description = generateArtifactDescription(from, to);
    const raw = generateCashFlowMetrics({ from, to, currency, categories });
    const { operating, investing, financing, netCashFlow } = raw.cashFlow;

    const analysis = CashFlowArtifact.stream(
      {
        description,
        asOfDate: to,
        stage: "generating",
        progress: 0,
        currency: currency || "USD",
        data: {
          operating: 0,
          investing: 0,
          financing: 0,
          netCashFlow: 0,
          chartData: [],
        },
      },
      writer,
    );

    yield { text: `Generating cash flow chart for ${from} to ${to}...` };
    await delay(300);

    const chartData = [
      { name: "Operating", value: operating, fill: "var(--chart-1)" },
      { name: "Investing", value: investing, fill: "var(--chart-2)" },
      { name: "Financing", value: financing, fill: "var(--chart-3)" },
    ];

    await analysis.update({
      stage: "generating",
      progress: 0.5,
      data: {
        operating,
        investing,
        financing,
        netCashFlow,
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
        operating,
        investing,
        financing,
        netCashFlow,
        chartData,
      },
    });

    yield {
      text: `Cash flow chart ready. Net cash flow: ${currency || "USD"} ${netCashFlow.toLocaleString()}.`,
      forceStop: true,
    };

    return { ...raw, forceStop: true };
  },
});
