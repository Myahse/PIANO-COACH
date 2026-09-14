import type { TranscribeTarget } from "../music/muscriptor";
import { selectTranscriptionEngine, type EnginePreference } from "../transcription/selectEngine";
import type { RawMidiLayers } from "./types";

/**
 * Stage 3 — transcription engine facade (MuScriptor preferred, Basic Pitch fallback).
 */
export async function transcribeToRawMidi(
  file: File,
  buffer: AudioBuffer,
  target: TranscribeTarget = "both",
  onProgress?: (pct: number, label?: string) => void,
  signal?: AbortSignal,
  enginePreference: EnginePreference = "auto",
): Promise<RawMidiLayers> {
  const engine = await selectTranscriptionEngine(enginePreference);
  onProgress?.(0, `Detecting notes · ${engine.name}…`);
  const result = await engine.transcribe(
    { file, buffer },
    { target, signal, onProgress },
  );
  return {
    voiceNotes: result.voiceNotes,
    instNotes: result.instNotes,
    engine: result.engine,
  };
}
