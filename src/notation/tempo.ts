import type { TimedNote } from "../music/timed";

export type BeatGrid = {
  /** Seconds per quarter-note beat. */
  beatDuration: number;
  /** Time (s) of a beat — the grid is `offset + k * beatDuration`. */
  offset: number;
};

const HOP = 0.01;
const MIN_BPM = 50;
const MAX_BPM = 180;
/** Tempo prior centre: listeners and notation favour ~110 BPM over its half/double. */
const PRIOR_BPM = 110;
const PRIOR_OCTAVES = 0.9;

/**
 * Onset-strength envelope from note onsets: chord attacks and bass notes weigh more,
 * because they usually fall on beats. Smoothed so slightly early/late notes still line up.
 */
function onsetEnvelope(notes: TimedNote[], length: number): Float64Array {
  const env = new Float64Array(length);
  for (const note of notes) {
    const i = Math.round(note.start / HOP);
    if (i < 0 || i >= length) continue;
    const bass = note.note < 55 ? 1.5 : 1;
    const loud = 0.5 + (note.velocity ?? 80) / 127;
    const long = Math.min(2, 0.5 + note.duration * 2);
    env[i] += bass * loud * long;
  }
  // Gaussian smoothing, sigma ≈ 20 ms.
  const kernel = [0.05, 0.25, 0.4, 0.25, 0.05];
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += (env[i + k] ?? 0) * kernel[k + 2]!;
    out[i] = sum;
  }
  return out;
}

function autocorr(env: Float64Array, lag: number): number {
  let sum = 0;
  for (let i = lag; i < env.length; i++) sum += env[i]! * env[i - lag]!;
  return sum / Math.max(1, env.length - lag);
}

function combStrength(env: Float64Array, period: number, offset: number): number {
  let sum = 0;
  let count = 0;
  for (let t = offset; t < env.length * HOP; t += period) {
    const i = Math.round(t / HOP);
    sum += Math.max(env[i - 1] ?? 0, env[i] ?? 0, env[i + 1] ?? 0);
    count += 1;
  }
  return count ? sum / count : 0;
}

function bestOffset(env: Float64Array, period: number): { offset: number; strength: number } {
  let best = { offset: 0, strength: -1 };
  for (let offset = 0; offset < period; offset += HOP) {
    const strength = combStrength(env, period, offset);
    if (strength > best.strength) best = { offset, strength };
  }
  return best;
}

/**
 * Global tempo + beat phase from transcribed notes.
 * Autocorrelation of the onset envelope picks the period (with a log-tempo prior so the
 * beat — not the 8th/16th subdivision — wins); a comb search then finds the beat phase.
 */
export function estimateBeatGrid(notes: TimedNote[]): BeatGrid {
  const fallback: BeatGrid = { beatDuration: 0.5, offset: 0 };
  if (notes.length < 4) return fallback;
  const end = notes.reduce((max, note) => Math.max(max, note.start), 0);
  const length = Math.ceil(end / HOP) + 10;
  const env = onsetEnvelope(notes, length);

  const minLag = Math.round(60 / MAX_BPM / HOP);
  const maxLag = Math.round(60 / MIN_BPM / HOP);
  const acf = (lag: number) => (lag < env.length ? autocorr(env, lag) : 0);

  let bestLag = 0;
  let bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * HOP);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES) ** 2);
    // A real beat period is reinforced at double its length (half notes / bars).
    const score = (acf(lag) + 0.5 * acf(lag * 2)) * prior;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || bestScore <= 0) return fallback;

  // Refine the period to sub-hop precision so the grid does not drift over long songs.
  let period = bestLag * HOP;
  let phase = bestOffset(env, period);
  for (let p = period - HOP; p <= period + HOP; p += HOP / 20) {
    const candidate = bestOffset(env, p);
    if (candidate.strength > phase.strength * 1.0001) {
      phase = candidate;
      period = p;
    }
  }
  return { beatDuration: period, offset: phase.offset };
}
