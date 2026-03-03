import { openai } from "@ai-sdk/openai";
import { experimental_transcribe as transcribe } from "ai";
import type { TranscriptionFactory } from "./types";

export const createOpenAITranscription: TranscriptionFactory = () => ({
  transcribe: async (audio: Buffer) => {
    const result = await transcribe({
      model: openai.transcription("gpt-4o-mini-transcribe"),
      audio,
    });

    return { text: result.text };
  },
});
