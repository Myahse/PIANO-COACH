import type { AudioAnalysis, AudioProfile } from "./types";

function mixToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const out = new Float32Array(length);
  const channels = buffer.numberOfChannels;
  for (let ch = 0; ch < channels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) out[i]! += data[i]! / channels;
  }
  return out;
}

/** Rough vocal-band energy ratio (300–3400 Hz) via decimated sample — no FFT. */
function estimateVocalPresence(mono: Float32Array, sampleRate: number): number {
  const step = Math.max(1, Math.floor(sampleRate / 4000));
  let total = 0;
  let mid = 0;
  let prev = mono[0] ?? 0;
  for (let i = step; i < mono.length; i += step) {
    const sample = mono[i]!;
    const delta = Math.abs(sample - prev);
    total += sample * sample + delta * delta;
    if (i % 3 === 0) mid += sample * sample;
    prev = sample;
  }
  if (total <= 1e-12) return 0;
  return Math.min(1, mid / total);
}

function profileFromAnalysis(vocalPresence: number, force?: AudioProfile): AudioProfile {
  if (force) return force;
  if (vocalPresence >= 0.42) return "full_song";
  if (vocalPresence <= 0.28) return "solo_piano";
  return "unknown";
}

/**
 * Stage 1 — inspect the audio and choose solo-piano vs full-song path.
 * Separation runs only for `full_song` when enabled.
 */
export async function analyzeAudio(
  buffer: AudioBuffer,
  forceProfile?: AudioProfile,
): Promise<AudioAnalysis> {
  const mono = mixToMono(buffer);
  const vocalPresence = estimateVocalPresence(mono, buffer.sampleRate);
  const profile = profileFromAnalysis(vocalPresence, forceProfile);
  const durationSec = buffer.duration;

  let recommendation: string | undefined;
  if (profile === "full_song") {
    recommendation = "Full mix detected — piano stem isolation recommended when available.";
  } else if (profile === "solo_piano") {
    recommendation = "Solo piano detected — transcribing the full recording.";
  }

  return { profile, durationSec, vocalPresence, recommendation };
}
