import { createOpenAITranscription } from "./openai-transcription";
import type { TranscriptionFactory } from "./types";

const TRANSCRIPTION_DEFAULT = "openai";

const implementations: Record<string, TranscriptionFactory> = {
  openai: createOpenAITranscription,
  // anthropic: createAnthropicTranscription,
  // google: createGoogleTranscription,
};

function resolveTranscriptionProvider(): string {
  const override = process.env.TRANSCRIPTION_PROVIDER;
  if (override) {
    if (override in implementations) return override;
    console.warn(
      `[transcription] TRANSCRIPTION_PROVIDER="${override}" has no implementation. Ignoring.`,
    );
  }

  const modelProvider = process.env.MODEL_PROVIDER;
  if (modelProvider && modelProvider in implementations) return modelProvider;

  return TRANSCRIPTION_DEFAULT;
}

const provider = resolveTranscriptionProvider();

export const transcriptionProvider = implementations[provider]();

console.info(`[transcription] Using ${provider} transcription`);
