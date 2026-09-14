import { runBasicPitchPath } from "../../bench/basicPitchOnly";
import type { TranscriptionEngine, TranscriptionInput, TranscriptionOptions, TranscriptionOutput } from "../types";

export const basicPitchEngine: TranscriptionEngine = {
  id: "basic-pitch",
  name: "Basic Pitch",
  capabilities: {
    polyphonic: true,
    piano: true,
    stems: false,
    velocity: false,
    pedal: false,
    desktopOnly: false,
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async transcribe(input: TranscriptionInput, options: TranscriptionOptions): Promise<TranscriptionOutput> {
    if (options.signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
    options.onProgress?.(30, "Detecting notes · Basic Pitch (browser)…");
    const notes = await runBasicPitchPath(input.buffer);
    if (options.signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
    options.onProgress?.(85, "Basic Pitch · notes detected");
    const instNotes = options.target === "vocals" ? [] : notes;
    const voiceNotes = options.target === "piano" ? [] : notes;
    return {
      voiceNotes,
      instNotes,
      engine: "basic-pitch",
    };
  },
};
