import type { Tool } from "ai";

export type WebSearchSource = { url: string; title: string };

export interface WebSearchResult {
  query: string;
  found: number;
  context: string | null;
  sources: WebSearchSource[];
  error?: string;
}

export type WebSearchFactory = () => Tool;
