/**
 * Minimal hast-like type for code block extraction.
 * Streamdown passes node from hast-util-to-jsx-runtime.
 */
interface HastElement {
  tagName?: string;
  children?: HastNode[];
  properties?: { className?: string | string[] };
}
interface HastNode {
  type?: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: { className?: string | string[] };
}

/**
 * Extract chart code and language from a hast pre element (code block).
 * Returns { code, language } if it's a chart block, null otherwise.
 */
export function extractChartFromPre(node: HastElement | undefined): {
  code: string;
  language: string;
} | null {
  if (!node || node.tagName !== "pre") return null;

  const codeEl = node.children?.find(
    (c): c is HastElement =>
      typeof c === "object" &&
      c !== null &&
      "tagName" in c &&
      (c as HastElement).tagName === "code"
  ) as HastElement | undefined;

  if (!codeEl?.properties?.className) return null;

  const className = codeEl.properties.className;
  const classList = Array.isArray(className) ? className : [className];
  const langClass = classList.find(
    (c): c is string => typeof c === "string" && c.startsWith("language-")
  );
  if (!langClass) return null;

  const language = langClass.replace(/^language-/, "");
  if (language !== "chart" && language !== "chart-data") return null;

  const code = extractTextFromNode(codeEl);
  return { code, language };
}

function extractTextFromNode(node: HastElement): string {
  return (node.children ?? [])
    .map((c) => {
      if (typeof c === "object" && c !== null && "value" in c) {
        return (c as { value?: string }).value ?? "";
      }
      if (typeof c === "object" && c !== null && "children" in c) {
        return extractTextFromNode(c as HastElement);
      }
      return "";
    })
    .join("");
}
