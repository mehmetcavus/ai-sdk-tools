# @ai-sdk-tools/ocr

Extract structured data from invoices and receipts using AI SDK with intelligent provider fallback.

## Features

- **Clean API** - Simple, intuitive interface
- **Multiple Providers** - Anthropic, Mistral, Gemini with configurable execution order
- **Configurable Cascade** - Choose which providers to try and in what order
- **PDF Support** - Direct PDF processing with fallback to OCR extraction
- **Quality Validation** - Automatic quality checks with intelligent fallback
- **Result Merging** - Combines results from multiple attempts for best accuracy
- **Retry Logic** - Automatic retries with exponential backoff (default: 3 retries)
- **Multiple Input Formats** - Buffer, base64, file path, URL, or File object

## Installation

```bash
npm install @ai-sdk-tools/ocr
# or
bun add @ai-sdk-tools/ocr
```

Then install the provider SDK(s) you want to use (all are optional peer dependencies):

```bash
# Anthropic (recommended for accuracy)
npm install @ai-sdk/anthropic

# Mistral (good for PDFs)
npm install @ai-sdk/mistral

# Google Gemini
npm install @ai-sdk/google
```

## Quick Start

```typescript
import { ocr } from '@ai-sdk-tools/ocr';

// Extract invoice data (uses default order: mistral → gemini → ocr-fallback)
const invoice = await ocr(imageBuffer, 'invoice');

// Use Anthropic as primary provider
const invoice = await ocr(imageBuffer, 'invoice', {
  providerOrder: ['anthropic', 'mistral', 'gemini'],
});

// Extract receipt data
const receipt = await ocr(imageUrl, 'receipt');

// With custom schema
import { z } from 'zod';
const customSchema = z.object({
  vendor: z.string().optional(),
  total: z.number().optional(),
});
const data = await ocr(imageFile, customSchema);
```

## Provider Order

Control which providers are tried and in what sequence using `providerOrder`:

```typescript
// Anthropic first, then Mistral, then Gemini
const result = await ocr(input, 'invoice', {
  providerOrder: ['anthropic', 'mistral', 'gemini'],
});

// Anthropic only (no fallback)
const result = await ocr(input, 'invoice', {
  providerOrder: ['anthropic'],
});

// Default order (when providerOrder is omitted)
// ['mistral', 'gemini', 'ocr-fallback']
```

Available providers: `anthropic`, `mistral`, `gemini`, `ocr-fallback`

The `ocr-fallback` provider is a text extraction + LLM approach, used as a last resort for PDFs when vision models fail.

## API

### `ocr(input, typeOrSchema, options?)`

Extract structured data from a document.

**Parameters:**
- `input` - Buffer, string (base64/file path/URL), or File object
- `typeOrSchema` - `'invoice' | 'receipt'` or a Zod schema
- `options` - Optional configuration (see below)

**Returns:** Promise with extracted structured data

**Throws:** `OCRError` when all providers fail (includes per-provider attempt details)

## Options

All options are optional:

```typescript
{
  providerOrder?: OCRProviderName[],  // Provider execution order
  providers?: {
    anthropic?: { model?: string, apiKey?: string },
    mistral?: { model?: string, apiKey?: string },
    gemini?: { model?: string, apiKey?: string },
  },
  timeout?: number,       // Per-attempt timeout in ms (default: 20000)
  retries?: number,       // Retries per provider (default: 3)
  qualityThreshold?: QualityThreshold,
}
```

## Environment Variables

Each provider reads its API key from the environment:

| Provider | Environment Variable |
|----------|---------------------|
| Anthropic | `ANTHROPIC_API_KEY` |
| Mistral | `MISTRAL_API_KEY` |
| Gemini | `GOOGLE_GENERATIVE_AI_API_KEY` |

Or pass `apiKey` directly in the `providers` config.

## Predefined Schemas

```typescript
import { invoiceSchema, receiptSchema } from '@ai-sdk-tools/ocr';
```

The invoice schema extracts: vendor/customer info, dates, amounts, tax, line items, payment instructions, and more.

The receipt schema extracts: vendor, date, items, totals, tax, payment method, and tip.

## Error Handling

```typescript
import { ocr, OCRError } from '@ai-sdk-tools/ocr';

try {
  const result = await ocr(image, 'invoice');
} catch (error) {
  if (error instanceof OCRError) {
    console.error('OCR failed:', error.message);
    for (const attempt of error.attempts) {
      console.log(`${attempt.provider}: ${attempt.success ? 'OK' : 'FAILED'} (${attempt.duration}ms)`);
    }
  }
}
```

## How It Works

1. **Provider Cascade**: Tries each provider in `providerOrder` sequence
2. **Quality Check**: Validates extracted data meets minimum standards after each attempt
3. **Retry Logic**: Each provider attempt retries with exponential backoff on transient failures
4. **Result Merging**: If multiple providers succeed, combines results for best accuracy
5. **Error Aggregation**: If all providers fail, throws `OCRError` with per-provider diagnostics

### Provider Notes

- **Anthropic**: Uses prompt-based JSON extraction (avoids Anthropic's structured output union type limit). Excellent accuracy with `claude-haiku-4-5` default.
- **Mistral**: Native PDF support via `documentPageLimit`. Good balance of speed and accuracy.
- **Gemini**: Strong vision capabilities. Good fallback for complex documents.
- **OCR Fallback**: Text extraction + LLM parsing. Last resort for PDFs when vision fails.

## License

MIT
