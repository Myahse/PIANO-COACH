import { probeMuScriptor, transcribeWithMuScriptor } from "../../music/muscriptor";
import type { TranscriptionEngine, TranscriptionInput, TranscriptionOptions, TranscriptionOutput } from "../types";

export const muscriptorEngine: TranscriptionEngine = {
  id: "muscriptor",
  name: "MuScriptor",
  capabilities: {
    polyphonic: true,
    piano: true,
    stems: true,
    velocity: true,
    pedal: false,
    desktopOnly: true,
  },

  async isAvailable(): Promise<boolean> {
    return probeMuScriptor();
  },

  async transcribe(input: TranscriptionInput, options: TranscriptionOptions): Promise<TranscriptionOutput> {
    if (options.signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
    const result = await transcribeWithMuScriptor(input.file, options.target, (pct, label) => {
      if (options.signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
      options.onProgress?.(pct, label);
    });
    return {
      voiceNotes: result.voiceNotes,
      instNotes: result.instNotes,
      engine: result.engine,
    };
  },
};
