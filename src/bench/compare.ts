import type { TimedNote } from "../music/timed";

export type ReferenceTranscription = {
  id: string;
  title: string;
  notes: TimedNote[];
};

export type CompareOptions = {
  /** Max start-time delta to count a pitch match (seconds). */
  toleranceSec?: number;
};

export type CompareMetrics = {
  referenceCount: number;
  candidateCount: number;
  matchedReference: number;
  matchedCandidate: number;
  recall: number;
  precision: number;
  f1: number;
  startOffsetMedian: number;
  durationDeltaMedian: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Greedy pitch+time matcher for benchmark runs against saved reference transcriptions.
 * Reference JSON lives under `public/bench/references/*.json`.
 */
export function compareTranscriptions(
  reference: TimedNote[],
  candidate: TimedNote[],
  opts: CompareOptions = {},
): CompareMetrics {
  const tol = opts.toleranceSec ?? 0.08;
  const refSorted = [...reference].sort((a, b) => a.start - b.start || a.note - b.note);
  const candSorted = [...candidate].sort((a, b) => a.start - b.start || a.note - b.note);
  const usedCand = new Set<number>();
  const startOffsets: number[] = [];
  const durationDeltas: number[] = [];
  let matchedReference = 0;

  for (const ref of refSorted) {
    let bestIdx = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < candSorted.length; i++) {
      if (usedCand.has(i)) continue;
      const cand = candSorted[i]!;
      if (cand.note !== ref.note) continue;
      const delta = Math.abs(cand.start - ref.start);
      if (delta <= tol && delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      usedCand.add(bestIdx);
      matchedReference += 1;
      const cand = candSorted[bestIdx]!;
      startOffsets.push(cand.start - ref.start);
      durationDeltas.push(cand.duration - ref.duration);
    }
  }

  const matchedCandidate = usedCand.size;
  const recall = refSorted.length ? matchedReference / refSorted.length : 0;
  const precision = candSorted.length ? matchedCandidate / candSorted.length : 0;
  const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;

  return {
    referenceCount: refSorted.length,
    candidateCount: candSorted.length,
    matchedReference,
    matchedCandidate,
    recall,
    precision,
    f1,
    startOffsetMedian: median(startOffsets),
    durationDeltaMedian: median(durationDeltas),
  };
}

export async function loadReferenceTranscription(url: string): Promise<ReferenceTranscription> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Reference not found: ${url}`);
  const data = (await res.json()) as ReferenceTranscription;
  if (!Array.isArray(data.notes)) throw new Error(`Invalid reference JSON: ${url}`);
  return data;
}
