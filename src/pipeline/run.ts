import type { PipelineOptions, PipelineProgress, PipelineResult, PipelineStage } from "./types";
import { analyzeAudio } from "./preprocess";
import { separatePianoStem } from "./separation";
import { transcribeToRawMidi } from "./transcribeStage";
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

async function decodeAudioFile(file: File): Promise<AudioBuffer | null> {
  if (typeof OfflineAudioContext === "undefined") return null;
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null;
  }
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

  let audioFile = file;
  let audioBuffer = buffer;
  let separationApplied = false;

  if (options.enableSeparation !== false && analysis.profile === "full_song") {
    throwIfAborted(signal);
    const sep = await separatePianoStem(
      file,
      buffer,
      analysis,
      (local, label) => {
        report("separation", local, label, onProgress);
      },
      signal,
    );
    audioFile = sep.file;
    separationApplied = sep.applied;
    // Browser engines read the decoded buffer, not the file — decode the stem so they hear it too.
    if (sep.applied && sep.file !== file) {
      audioBuffer = (await decodeAudioFile(sep.file)) ?? buffer;
    }
    throwIfAborted(signal);
  }

  report("transcribe", 0, "Detecting notes…", onProgress);
  const raw = await transcribeToRawMidi(
    audioFile,
    audioBuffer,
    options.target ?? "both",
    (enginePct, label) => {
      report("transcribe", enginePct, label ?? "Detecting notes…", onProgress);
    },
    signal,
    options.engine ?? "auto",
  );
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
    separationApplied,
  };
}

export type { PipelineProgress };
