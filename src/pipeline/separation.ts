import { monoSamplesToWavFile } from "../audio/wavFile";
import { separateAudioStems } from "./stemBackend";
import type { AudioAnalysis } from "./types";

export type SeparationResult = {
  file: File;
  /** Vocal stem or full mix for melody transcription. */
  vocalFile?: File;
  applied: boolean;
  backend?: "demucs" | "heuristic";
  message?: string;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
}

/**
 * Stage 2 — piano/instrument stem for full-song mixes.
 * Demucs when available on desktop; heuristic M/S filter otherwise.
 */
export async function separatePianoStem(
  file: File,
  buffer: AudioBuffer,
  analysis: AudioAnalysis,
  onProgress?: (pct: number, label: string) => void,
  signal?: AbortSignal,
): Promise<SeparationResult> {
  if (analysis.profile !== "full_song") {
    return { file, applied: false };
  }

  throwIfAborted(signal);
  onProgress?.(5, "Piano isolation · separating instruments…");

  try {
    const stems = await separateAudioStems(file, buffer, {
      signal,
      onProgress: (pct, label) => onProgress?.(pct, label),
    });
    throwIfAborted(signal);

    if (stems.stemFile) {
      return {
        file: stems.stemFile,
        vocalFile: stems.vocalFile ?? file,
        applied: true,
        backend: "demucs",
        message: "Demucs stems applied — piano and vocals transcribed separately.",
      };
    }

    const stemFile = monoSamplesToWavFile(
      stems.instruments,
      stems.sampleRate,
      file.name.replace(/\.[^.]+$/, "") + "-piano-stem.wav",
    );
    return {
      file: stemFile,
      vocalFile: stems.vocalFile ?? file,
      applied: true,
      backend: "heuristic",
      message: "Light stems applied — piano and vocals transcribed separately.",
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    onProgress?.(100, "Piano isolation · using full mix");
    return {
      file,
      applied: false,
      message: "Stem separation skipped — transcribing the mixed recording.",
    };
  }
}
