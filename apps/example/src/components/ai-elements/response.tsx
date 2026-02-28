"use client";

import { type ComponentProps, type ReactNode, memo } from "react";
import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";
import { InlineChart } from "@/components/ai-elements/inline-chart";
import { extractChartFromPre } from "@/lib/extract-chart-from-pre";
import { cn } from "@/lib/utils";

type ResponseProps = ComponentProps<typeof Streamdown> & {
  isStreaming?: boolean;
};

const H2Override = ({ children, ...rest }: { children?: ReactNode }) => (
  <h3 className="font-medium text-sm text-primary tracking-wide" {...rest}>
    {children}
  </h3>
);
const H3Override = ({ children, ...rest }: { children?: ReactNode }) => (
  <h3 className="font-medium text-sm text-primary tracking-wide" {...rest}>
    {children}
  </h3>
);
const H4Override = ({ children, ...rest }: { children?: ReactNode }) => (
  <h4 className="font-medium text-sm text-primary tracking-wide" {...rest}>
    {children}
  </h4>
);
function PreOverride(
  props: ComponentProps<"pre"> & { node?: unknown }
) {
  const { children, node, ...rest } = props;
  const chart = extractChartFromPre(node as Parameters<typeof extractChartFromPre>[0]);
  if (chart) {
    return (
      <InlineChart
        code={chart.code}
        language={chart.language}
      />
    );
  }
  return <pre {...rest}>{children}</pre>;
}

const STREAMDOWN_COMPONENTS = {
  h2: H2Override,
  h3: H3Override,
  h4: H4Override,
  pre: PreOverride,
};

export const Response = memo(function Response({
  className,
  isStreaming = false,
  ...props
}: ResponseProps) {
  return (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      plugins={{ code, mermaid }}
      animated={isStreaming}
      isAnimating={isStreaming}
      {...props}
      components={STREAMDOWN_COMPONENTS}
    />
  );
}, (prev, next) => {
  return prev.children === next.children && prev.isStreaming === next.isStreaming;
});
