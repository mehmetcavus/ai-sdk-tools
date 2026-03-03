import type { z } from "zod";
import { mergeResults } from "./merge.js";
import { extractWithAnthropic } from "./providers/anthropic.js";
import { extractWithGemini } from "./providers/gemini.js";
import { extractWithMistral } from "./providers/mistral.js";
import { extractWithOCRFallback } from "./providers/ocr-fallback.js";
import type { ProviderResult } from "./providers/types.js";
import { validateQuality } from "./quality.js";
import { invoiceSchema, receiptSchema } from "./schemas.js";
import type { OCRInput, OCROptions, OCRProviderName, ProviderAttempt } from "./types.js";
import { OCRError } from "./types.js";
import { normalizeInput } from "./utils.js";

const DEFAULT_ORDER: OCRProviderName[] = ["mistral", "gemini", "ocr-fallback"];

const INVOICE_PROMPT = `Extract structured data from this invoice document. Extract all relevant fields including vendor information, dates, amounts, line items, tax information, and payment details. Be accurate and complete.`;

const RECEIPT_PROMPT = `Extract structured data from this receipt document. Extract all relevant fields including vendor/merchant name, date, total amount, items purchased, payment method, and transaction details. Be accurate and complete.`;

function getSchemaAndPrompt(
  typeOrSchema: "invoice" | "receipt" | z.ZodSchema<any>,
): { schema: z.ZodSchema<any>; prompt: string } {
  if (typeof typeOrSchema === "string") {
    if (typeOrSchema === "invoice") {
      return { schema: invoiceSchema, prompt: INVOICE_PROMPT };
    }
    if (typeOrSchema === "receipt") {
      return { schema: receiptSchema, prompt: RECEIPT_PROMPT };
    }
  }

  return {
    schema: typeOrSchema,
    prompt:
      "Extract structured data from this document according to the provided schema. Be accurate and complete.",
  };
}

async function runProvider<T>(
  name: OCRProviderName,
  extractOptions: {
    schema: z.ZodSchema<T>;
    input: { data: string; mediaType: string };
    prompt: string;
    timeout?: number;
    retries?: number;
  },
  options: OCROptions,
): Promise<ProviderResult<T> | null> {
  switch (name) {
    case "mistral":
      return extractWithMistral(extractOptions, options.providers?.mistral);
    case "gemini":
      return extractWithGemini(extractOptions, options.providers?.gemini);
    case "anthropic":
      return extractWithAnthropic(extractOptions, options.providers?.anthropic);
    case "ocr-fallback":
      if (extractOptions.input.mediaType === "application/pdf") {
        return extractWithOCRFallback(extractOptions, options.providers?.mistral);
      }
      return null;
    default:
      return null;
  }
}

export async function ocr<T extends Record<string, unknown>>(
  input: OCRInput,
  typeOrSchema: "invoice" | "receipt" | z.ZodSchema<T>,
  options: OCROptions = {},
): Promise<T> {
  const attempts: ProviderAttempt[] = [];
  const { schema, prompt } = getSchemaAndPrompt(typeOrSchema);
  const normalizedInput = await normalizeInput(input);

  const extractOptions = {
    schema,
    input: normalizedInput,
    prompt,
    timeout: options.timeout || 20000,
    retries: options.retries ?? 3,
  };

  const providerOrder = options.providerOrder ?? DEFAULT_ORDER;
  const results: Array<{ provider: OCRProviderName; data: T }> = [];

  for (const providerName of providerOrder) {
    try {
      const providerResult = await runProvider<T>(providerName, extractOptions, options);

      if (!providerResult) continue;

      attempts.push({
        provider: providerName,
        success: providerResult.success,
        error: providerResult.error,
        result: providerResult.result,
        duration: providerResult.duration,
      });

      if (providerResult.success && providerResult.result) {
        const data = providerResult.result as T;

        const isQualityGood = validateQuality(
          data,
          schema,
          options.qualityThreshold,
        );

        if (isQualityGood) {
          // High quality — merge with any previous lower-quality result if available
          if (results.length > 0) {
            return mergeResults(results[0].data, data);
          }
          return data;
        }

        // Keep for potential merge with a later provider
        results.push({ provider: providerName, data });
      }
    } catch (error) {
      attempts.push({
        provider: providerName,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  // If we collected multiple results, merge the best two
  if (results.length >= 2) {
    return mergeResults(results[0].data, results[1].data);
  }

  // Return any result we have, even if quality is poor
  if (results.length === 1) {
    return results[0].data;
  }

  // All attempts failed
  const firstError = attempts.find((a) => a.error)?.error;
  const finalError = firstError || new Error("All OCR providers failed");

  throw new OCRError(
    `Failed to extract data from document: ${finalError.message}`,
    attempts,
    finalError,
  );
}
