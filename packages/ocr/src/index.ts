// Main OCR function
export { ocr } from "./ocr.js";
export type { InvoiceData, ReceiptData } from "./schemas.js";
// Schemas
export { invoiceSchema, receiptSchema } from "./schemas.js";

// Types
export type {
  AnthropicConfig,
  DocumentType,
  GeminiConfig,
  MistralConfig,
  OCRInput,
  OCROptions,
  OCRProviderName,
  ProviderConfig,
  QualityThreshold,
} from "./types.js";
export { OCRError } from "./types.js";
