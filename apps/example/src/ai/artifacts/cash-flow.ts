import { artifact } from "ai-sdk-tools";
import { z } from "zod";

export const CashFlowArtifact = artifact(
  "cash-flow",
  z.object({
    description: z.string(),
    stage: z.enum(["generating", "complete"]).default("generating"),
    progress: z.number().min(0).max(1),
    currency: z.string().default("USD"),
    asOfDate: z.string(),
    data: z.object({
      operating: z.number(),
      investing: z.number(),
      financing: z.number(),
      netCashFlow: z.number(),
      // Chart data for bar chart
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

export type CashFlowArtifact = z.infer<typeof CashFlowArtifact>;
