import { prepareMelodyNotes, preparePianoNotes } from "./cleanup";
import { splitHands } from "./handSplit";
import {
  MUSCRIPTOR_LABEL,
  normalizeTranscribeTarget,
  transcribeWithMuScriptor,
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

export async function transcribeAudioFile(
  file: File,
  _buffer: AudioBuffer,
  onProgress?: (pct: number, label?: string) => void,
  mode: TileMode = "both",
  target: TranscribeTarget = "both",
): Promise<Transcription> {
  const normalizedTarget = normalizeTranscribeTarget(target);
  const layers = await transcribeWithMuScriptor(file, normalizedTarget, onProgress);
  return packLayers(layers.voiceNotes, layers.instNotes, mode, layers.engine, onProgress);
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

function packLayers(
  voiceNotes: TimedNote[],
  instNotes: TimedNote[],
  mode: TileMode,
  engine: string,
  onProgress?: (pct: number, label?: string) => void,
): Transcription {
  onProgress?.(92, "Creating Score · saving transcription…");
  const inst = preparePianoNotes([...instNotes].sort((a, b) => a.start - b.start || a.note - b.note));
  const voice = prepareMelodyNotes([...voiceNotes].sort((a, b) => a.start - b.start || a.note - b.note));
  const { left, right } = splitHands(inst);
  const all = [...inst, ...voice].sort((a, b) => a.start - b.start || a.note - b.note);
  const chosen = applyTileMode({ voice, instruments: inst, leftHand: left, rightHand: right, all }, mode);
  onProgress?.(100, "Done");
  return {
    notes: chosen,
    fullNotes: all.length ? all : inst.length ? inst : voice,
    voiceNotes: voice,
    instNotes: inst,
    leftHandNotes: left,
    rightHandNotes: right,
    offset: 0,
    engine,
  };
}
