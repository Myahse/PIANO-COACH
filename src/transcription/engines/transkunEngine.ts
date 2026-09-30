import { transcribeWithTranskun } from "../../music/transkunEngine";
import type { TranscriptionEngine, TranscriptionInput, TranscriptionOptions, TranscriptionOutput } from "../types";

/**
 * Transkun V2 (Neural Semi-CRF) running in the browser via ONNX.
 * A dedicated piano model — far more accurate than Basic Pitch on piano audio.
 */
export const transkunEngine: TranscriptionEngine = {
  id: "transkun",
  name: "Transkun V2",
  capabilities: {
    polyphonic: true,
    piano: true,
    stems: false,
    velocity: true,
    pedal: false,
    desktopOnly: false,
  },

  async isAvailable(): Promise<boolean> {
    return typeof WebAssembly !== "undefined";
  },

  async transcribe(input: TranscriptionInput, options: TranscriptionOptions): Promise<TranscriptionOutput> {
    if (options.signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
    const notes = await transcribeWithTranskun(input.buffer, (pct, label) => {
      if (options.signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
      options.onProgress?.(pct, label);
    });
    if (notes.length === 0) throw new Error("No notes were found.");
    // Piano model: every note belongs to the piano layer; never duplicate into the vocal layer.
    return {
      voiceNotes: [],
      instNotes: notes,
      engine: "transkun-v2",
    };
  },
};
