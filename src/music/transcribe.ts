import { runImportPipeline } from "../pipeline";
import {
  MUSCRIPTOR_LABEL,
  normalizeTranscribeTarget,
  type TranscribeTarget,
} from "./muscriptor";
import { type TimedNote } from "./timed";

export type { TranscribeTarget };
export { normalizeTranscribeTarget, MUSCRIPTOR_LABEL };

export type TileMode = "voice" | "instruments" | "both" | "left" | "right";

export type NoteLayers = {
  voice?: TimedNote[];
  instruments?: TimedNote[];
  leftHand?: TimedNote[];
  rightHand?: TimedNote[];
  all?: TimedNote[];
};

export type Transcription = {
  notes: TimedNote[];
  fullNotes: TimedNote[];
  voiceNotes: TimedNote[];
  instNotes: TimedNote[];
  leftHandNotes: TimedNote[];
  rightHandNotes: TimedNote[];
  offset: number;
  engine: string;
};

export function normalizeTileMode(value: string): TileMode {
  if (value === "instruments" || value === "piano") return "instruments";
  if (value === "left") return "left";
  if (value === "right") return "right";
  if (value === "both" || value === "full") return "both";
  return "voice";
}

export function applyTileMode(source: TimedNote[] | NoteLayers, mode: TileMode): TimedNote[] {
  const layers = Array.isArray(source) ? { voice: source, instruments: [], all: source } : source;
  const all = layers.all ?? [...(layers.voice ?? []), ...(layers.instruments ?? [])];
  if (mode === "left") return (layers.leftHand?.length ? layers.leftHand : layers.instruments ?? all).slice();
  if (mode === "right") return (layers.rightHand?.length ? layers.rightHand : layers.instruments ?? all).slice();
  if (mode === "instruments") return (layers.instruments?.length ? layers.instruments : all).slice();
  if (mode === "voice") return (layers.voice?.length ? layers.voice : all).slice();
  return all.slice().sort((a, b) => a.start - b.start || a.note - b.note);
}

export type TranscribeOptions = {
  signal?: AbortSignal;
  engine?: "auto" | "muscriptor" | "basic-pitch";
};

export async function transcribeAudioFile(
  file: File,
  buffer: AudioBuffer,
  onProgress?: (pct: number, label?: string) => void,
  mode: TileMode = "both",
  target: TranscribeTarget = "both",
  opts: TranscribeOptions = {},
): Promise<Transcription> {
  const normalizedTarget = normalizeTranscribeTarget(target);
  const result = await runImportPipeline(
    file,
    buffer,
    {
      target: normalizedTarget,
      enableSeparation: true,
      signal: opts.signal,
      engine: opts.engine,
    },
    onProgress,
  );

  const chosen = applyTileMode(
    {
      voice: result.voiceNotes,
      instruments: result.instNotes,
      leftHand: result.leftHandNotes,
      rightHand: result.rightHandNotes,
      all: result.fullNotes,
    },
    mode,
  );

  return {
    notes: chosen,
    fullNotes: result.fullNotes.length ? result.fullNotes : result.instNotes.length ? result.instNotes : result.voiceNotes,
    voiceNotes: result.voiceNotes,
    instNotes: result.instNotes,
    leftHandNotes: result.leftHandNotes,
    rightHandNotes: result.rightHandNotes,
    offset: 0,
    engine: result.engine,
  };
}

/** @deprecated Use transcribeAudioFile — kept for bench tooling. */
export async function transcribeAudio(
  buffer: AudioBuffer,
  onProgress?: (pct: number, label?: string) => void,
  mode: TileMode = "both",
  target: TranscribeTarget = "both",
): Promise<Transcription> {
  const blob = new Blob([buffer.getChannelData(0)], { type: "audio/wav" });
  const file = new File([blob], "bench.wav", { type: "audio/wav" });
  return transcribeAudioFile(file, buffer, onProgress, mode, target);
}
