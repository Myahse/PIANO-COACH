import { separateWithDemucs } from "../audio/demucsStem";
import { prepareSources, type AudioSources } from "../music/separate";

export type StemBackend = "demucs" | "heuristic";

export type StemSeparationResult = {
  backend: StemBackend;
  /** Instrument / piano stem as mono float samples at `sampleRate`. */
  instruments: Float32Array;
  sampleRate: number;
  vocal?: Float32Array;
  /** When Demucs succeeds, ready-to-transcribe WAV for the engine. */
  stemFile?: File;
};

const MODEL_RATE = 22050;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
}

async function heuristicStems(buffer: AudioBuffer, maxSeconds: number): Promise<StemSeparationResult> {
  const { vocal, instruments } = await prepareSources(buffer, maxSeconds);
  return { backend: "heuristic", instruments, vocal, sampleRate: MODEL_RATE };
}

/**
 * Try neural Demucs stems on desktop, then fall back to M/S heuristic filtering.
 */
export async function separateAudioStems(
  file: File,
  buffer: AudioBuffer,
  opts: {
    maxSeconds?: number;
    signal?: AbortSignal;
    onProgress?: (pct: number, label: string) => void;
  } = {},
): Promise<StemSeparationResult> {
  const maxSeconds = opts.maxSeconds ?? Math.min(buffer.duration, 600);
  throwIfAborted(opts.signal);

  opts.onProgress?.(10, "Piano isolation · checking Demucs…");
  try {
    const audioBytes = await file.arrayBuffer();
    throwIfAborted(opts.signal);
    opts.onProgress?.(25, "Piano isolation · Demucs stem split…");
    const stemFile = await separateWithDemucs(audioBytes, file.name, opts.signal);
    if (stemFile) {
      opts.onProgress?.(100, "Piano isolation · Demucs instrument stem ready");
      return {
        backend: "demucs",
        instruments: new Float32Array(0),
        sampleRate: buffer.sampleRate,
        stemFile,
      };
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
  }

  throwIfAborted(opts.signal);
  opts.onProgress?.(40, "Piano isolation · heuristic filter…");
  const heuristic = await heuristicStems(buffer, maxSeconds);
  opts.onProgress?.(100, "Piano isolation · instrument stem ready");
  return heuristic;
}

export type { AudioSources };
