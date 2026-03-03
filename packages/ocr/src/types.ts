export type DocumentType = "invoice" | "receipt";

export type OCRProviderName = "mistral" | "gemini" | "anthropic" | "ocr-fallback";

export interface MistralConfig {
  model?: string;
  apiKey?: string;
}

export interface GeminiConfig {
  model?: string;
  apiKey?: string;
}

export interface AnthropicConfig {
  model?: string;
  apiKey?: string;
}

export interface ProviderConfig {
  mistral?: MistralConfig;
  gemini?: GeminiConfig;
  anthropic?: AnthropicConfig;
}

export interface OCROptions {
  providers?: ProviderConfig;
  /** Provider execution order. Defaults to ["mistral", "gemini", "ocr-fallback"]. */
  providerOrder?: OCRProviderName[];
  timeout?: number;
  retries?: number;
  qualityThreshold?: QualityThreshold;
}

export interface QualityThreshold {
  requireTotal?: boolean;
  requireCurrency?: boolean;
  requireVendor?: boolean;
  requireDate?: boolean;
}

export interface ProviderAttempt {
  provider: OCRProviderName;
  success: boolean;
  error?: Error;
  result?: unknown;
  duration?: number;
}

export class OCRError extends Error {
  constructor(
    message: string,
    public attempts: ProviderAttempt[],
    public finalError?: Error,
  ) {
    super(message);
    this.name = "OCRError";
  }
}

export type OCRInput = Buffer | string | File;
