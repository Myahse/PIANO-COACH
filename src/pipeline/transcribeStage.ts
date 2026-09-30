import type { TranscribeTarget } from "../music/muscriptor";
import { basicPitchEngine } from "../transcription/engines/basicPitchEngine";
import { selectTranscriptionEngine, type EnginePreference } from "../transcription/selectEngine";
import type { RawMidiLayers } from "./types";

export type StemAudio = {
  file: File;
  buffer: AudioBuffer;
};

/**
 * Stage 3 — transcription engine facade.
 * MuScriptor (desktop) → Transkun V2 (browser piano model) → Basic Pitch fallback.
 */
export async function transcribeToRawMidi(
  file: File,
  buffer: AudioBuffer,
  target: TranscribeTarget = "both",
  onProgress?: (pct: number, label?: string) => void,
  signal?: AbortSignal,
  enginePreference: EnginePreference = "auto",
): Promise<RawMidiLayers> {
  const engine = await selectTranscriptionEngine(enginePreference, target);
  onProgress?.(0, `Detecting notes · ${engine.name}…`);
  try {
    const result = await engine.transcribe({ file, buffer }, { target, signal, onProgress });
    return {
      voiceNotes: result.voiceNotes,
      instNotes: result.instNotes,
      engine: result.engine,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // Automatic engine choice: if the preferred model fails (e.g. ONNX model could not load), fall back.
    if (enginePreference !== "auto" || engine === basicPitchEngine) throw error;
    console.warn(`${engine.name} failed, falling back to Basic Pitch`, error);
    onProgress?.(0, "Detecting notes · Basic Pitch (fallback)…");
    const result = await basicPitchEngine.transcribe({ file, buffer }, { target, signal, onProgress });
    return {
      voiceNotes: result.voiceNotes,
      instNotes: result.instNotes,
      engine: result.engine,
    };
  }
}

/** Transcribe piano and vocal stems separately for full-song imports. */
export async function transcribeDualStems(
  piano: StemAudio,
  vocal: StemAudio,
  onProgress?: (pct: number, label?: string) => void,
  signal?: AbortSignal,
  enginePreference: EnginePreference = "auto",
): Promise<RawMidiLayers> {
  const pianoRaw = await transcribeToRawMidi(
    piano.file,
    piano.buffer,
    "piano",
    (pct, label) => onProgress?.(pct * 0.5, label ?? "Detecting piano…"),
    signal,
    enginePreference,
  );
  const vocalRaw = await transcribeToRawMidi(
    vocal.file,
    vocal.buffer,
    "vocals",
    (pct, label) => onProgress?.(50 + pct * 0.5, label ?? "Detecting vocals…"),
    signal,
    enginePreference,
  );
  return {
    voiceNotes: vocalRaw.voiceNotes,
    instNotes: pianoRaw.instNotes,
    engine: pianoRaw.engine === vocalRaw.engine ? pianoRaw.engine : `${pianoRaw.engine}+vocal`,
  };
}
