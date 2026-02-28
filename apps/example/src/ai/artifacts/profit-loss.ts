import { artifact } from "ai-sdk-tools";
import { z } from "zod";

export const ProfitLossArtifact = artifact(
  "profit-loss",
  z.object({
    description: z.string(),
    stage: z.enum(["generating", "complete"]).default("generating"),
    progress: z.number().min(0).max(1),
    currency: z.string().default("USD"),
    asOfDate: z.string(),
    data: z.object({
      revenue: z.number(),
      expenses: z.object({
        total: z.number(),
        breakdown: z.object({
          operating: z.number(),
          personnel: z.number(),
          other: z.number(),
        }),
      }),
      profit: z.object({
        gross: z.number(),
        net: z.number(),
        margin: z.string(),
      }),
      // Chart data: category breakdown for bar chart
      chartData: z.array(
        z.object({
          name: z.string(),
          value: z.number(),
          fill: z.string().optional(),
        }),
      ),
    }),
  }),
);

export type ProfitLossArtifact = z.infer<typeof ProfitLossArtifact>;
