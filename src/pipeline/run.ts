import { decodeAudioFile } from "../audio/decode";
import type { PipelineOptions, PipelineProgress, PipelineResult, PipelineStage } from "./types";
import { analyzeAudio } from "./preprocess";
import { separatePianoStem, type SeparationResult } from "./separation";
import { transcribeDualStems, transcribeToRawMidi } from "./transcribeStage";
import { applyMidiIntelligence } from "./intelligence";

const STAGE_RANGE: Record<PipelineStage, [number, number]> = {
  preprocess: [0, 12],
  separation: [12, 22],
  transcribe: [22, 88],
  intelligence: [88, 100],
};

function mapProgress(stage: PipelineStage, localPct: number): number {
  const [lo, hi] = STAGE_RANGE[stage];
  return lo + (Math.min(100, Math.max(0, localPct)) / 100) * (hi - lo);
}

function report(
  stage: PipelineStage,
  localPct: number,
  label: string,
  onProgress?: (pct: number, label?: string) => void,
): void {
  onProgress?.(Math.round(mapProgress(stage, localPct)), label);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
}

async function decodeStem(file: File, fallback: AudioBuffer): Promise<AudioBuffer> {
  try {
    return await decodeAudioFile(file);
  } catch {
    return fallback;
  }
}

/**
 * Full songs: transcribe piano from the instrument stem and vocals from cleaner audio.
 * Heuristic vocal stems are too noisy — use the original mix for the vocal pass instead.
 */
function shouldDualTranscribe(
  target: NonNullable<PipelineOptions["target"]>,
  profile: string,
  separation: SeparationResult,
): boolean {
  return target === "both" && profile === "full_song" && separation.applied;
}

export function vocalSourceForTranscription(
  target: NonNullable<PipelineOptions["target"]>,
  separation: SeparationResult,
  original: File,
): File {
  if (target !== "vocals") return original;
  if (separation.backend === "demucs" && separation.vocalFile) return separation.vocalFile;
  return original;
}

export function vocalSourceForDualPass(separation: SeparationResult, original: File): File {
  if (separation.backend === "demucs" && separation.vocalFile) return separation.vocalFile;
  return original;
}

/**
 * Full import pipeline:
 *
 * MP3 → preprocess → [separation] → MuScriptor → MIDI intelligence → score
 */
export async function runImportPipeline(
  file: File,
  buffer: AudioBuffer,
  options: PipelineOptions = {},
  onProgress?: (pct: number, label?: string) => void,
): Promise<PipelineResult> {
  const signal = options.signal;

  throwIfAborted(signal);
  report("preprocess", 5, "Analyzing audio…", onProgress);
  const analysis = await analyzeAudio(buffer, options.forceProfile);
  throwIfAborted(signal);

  if (analysis.recommendation) {
    report("preprocess", 100, analysis.recommendation, onProgress);
  } else {
    report("preprocess", 100, "Audio analyzed", onProgress);
  }

  const target = options.target ?? "both";
  let separation: SeparationResult = { file, applied: false };

  if (options.enableSeparation !== false && analysis.profile === "full_song") {
    throwIfAborted(signal);
    separation = await separatePianoStem(
      file,
      buffer,
      analysis,
      (local, label) => {
        report("separation", local, label, onProgress);
      },
      signal,
    );
    throwIfAborted(signal);
  }

  report("transcribe", 0, "Detecting notes…", onProgress);
  let raw;
  if (shouldDualTranscribe(target, analysis.profile, separation)) {
    const pianoFile = separation.file;
    const vocalFile = vocalSourceForDualPass(separation, file);
    const [pianoBuffer, vocalBuffer] = await Promise.all([
      decodeStem(pianoFile, buffer),
      decodeStem(vocalFile, buffer),
    ]);
    raw = await transcribeDualStems(
      { file: pianoFile, buffer: pianoBuffer },
      { file: vocalFile, buffer: vocalBuffer },
      (enginePct, label) => {
        report("transcribe", enginePct, label ?? "Detecting notes…", onProgress);
      },
      signal,
      options.engine ?? "auto",
    );
  } else {
    let audioFile = file;
    let transcribeBuffer = buffer;
    if (target === "piano" && separation.applied) {
      audioFile = separation.file;
      transcribeBuffer = await decodeStem(audioFile, buffer);
    } else if (target === "vocals") {
      audioFile = vocalSourceForTranscription(target, separation, file);
      if (audioFile !== file) transcribeBuffer = await decodeStem(audioFile, buffer);
    }
    // target "both" on full songs: always transcribe the full mix unless Demucs dual ran above.
    raw = await transcribeToRawMidi(
      audioFile,
      transcribeBuffer,
      target,
      (enginePct, label) => {
        report("transcribe", enginePct, label ?? "Detecting notes…", onProgress);
      },
      signal,
      options.engine ?? "auto",
    );
  }
  throwIfAborted(signal);

  report("intelligence", 10, "Cleaning MIDI · removing artifacts…", onProgress);
  const score = applyMidiIntelligence(raw, {
    quantize: options.quantize,
    quantizeStep: options.quantizeStep,
  });

  report("intelligence", 70, "Assigning hands…", onProgress);
  report("intelligence", 100, "Creating score…", onProgress);
  onProgress?.(100, "Done");

  return {
    ...score,
    engine: raw.engine,
    analysis,
    separationApplied: separation.applied,
  };
}

export type { PipelineProgress };
