export interface TranscriptionResult {
  text: string;
}

export type TranscriptionProvider = {
  transcribe: (audio: Buffer) => Promise<TranscriptionResult>;
};

export type TranscriptionFactory = () => TranscriptionProvider;
