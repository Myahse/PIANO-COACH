import { bufferToMono } from "../transkun/audioLoad";
import { loadTranskunBuffers, type TranskunBuffers } from "../transkun/buffers";
import { TranskunHeadsModel, TranskunModel } from "../transkun/onnxModel";
import { TranskunTranscriber, type TranscribeProgress } from "../transkun/transcriber";
import { mergeLegatoFragments, type TimedNote } from "./timed";

/** TuesdayCrowd/transkun-onnx — ONNX export of Yujia Yan Transkun V2 (Neural Semi-CRF). */
export const TRANSKUN_V2_LABEL = "Transkun V2";

const HF_BASE = "https://huggingface.co/TuesdayCrowd/transkun-onnx/resolve/main/";
const LOCAL_BASE = "/models/transkun/";

const STAGE_LABEL: Record<TranscribeProgress["stage"], string> = {
  mel: "Transkun V2 · analyzing…",
  onnx: "Transkun V2 · running model…",
  viterbi: "Transkun V2 · decoding…",
  heads: "Transkun V2 · refining timing…",
  merge: "Transkun V2 · stitching…",
};

type EngineCache = {
  base: string;
  buffers: TranskunBuffers;
  model: TranskunModel;
  heads: TranskunHeadsModel;
};

let cache: EngineCache | null = null;

async function modelBaseUrl(): Promise<string> {
  try {
    const probe = await fetch(`${LOCAL_BASE}params.json`);
    const type = probe.headers.get("content-type") ?? "";
    if (probe.ok && type.includes("json")) {
      await probe.json();
      return LOCAL_BASE;
    }
  } catch {
    /* use remote */
  }
  // Dev server proxies Hugging Face to avoid CORS; production should ship /models/transkun/.
  const remote = import.meta.env.DEV ? "/hf-transkun/" : HF_BASE;
  return remote;
}

async function ensureEngine(onProgress?: (pct: number, label?: string) => void): Promise<EngineCache> {
  const base = await modelBaseUrl();
  if (cache && cache.base === base) return cache;

  onProgress?.(8, `Loading ${TRANSKUN_V2_LABEL}…`);
  const buffers = await loadTranskunBuffers(base);

  onProgress?.(14, `Loading ${TRANSKUN_V2_LABEL}…`);
  const model = new TranskunModel(`${base}transkun.onnx`);
  await model.load();

  onProgress?.(18, `Loading ${TRANSKUN_V2_LABEL}…`);
  const heads = new TranskunHeadsModel(`${base}transkun-heads.onnx`);
  await heads.load();

  cache = { base, buffers, model, heads };
  onProgress?.(22, `${TRANSKUN_V2_LABEL} ready`);
  return cache;
}

function progressFromSegment(p: TranscribeProgress): { pct: number; label: string } {
  const ratio = p.segmentsTotal > 0 ? p.segmentsDone / p.segmentsTotal : 0;
  return {
    pct: 22 + Math.round(ratio * 72),
    label: `${STAGE_LABEL[p.stage]} ${p.segmentsDone}/${p.segmentsTotal}`,
  };
}

export async function transcribeWithTranskun(
  buffer: AudioBuffer,
  onProgress?: (pct: number, label?: string) => void,
): Promise<TimedNote[]> {
  const { buffers, model, heads } = await ensureEngine(onProgress);
  onProgress?.(24, "Detecting Notes · Transkun V2…");
  const audio = await bufferToMono(buffer, buffers.params.fs);
  const transcriber = new TranskunTranscriber(buffers, model, heads);
  const result = await transcriber.transcribe(audio, (segment) => {
    const { pct, label } = progressFromSegment(segment);
    onProgress?.(pct, label);
  });

  const fs = buffers.params.fs;
  const notes = result.notes.map((note) => ({
    note: note.pitch,
    start: note.onsetSample / fs,
    duration: Math.max(0.03, note.durationSample / fs),
    velocity: note.velocity,
  }));
  return mergeLegatoFragments(notes, 0.02);
}

/** Load Transkun V2 into memory (optional warm-up before the first import). */
export async function preloadTranskunV2(onProgress?: (pct: number, label?: string) => void): Promise<void> {
  await ensureEngine(onProgress);
}
