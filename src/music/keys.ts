import { NOTE_NAMES, pc } from "./notes";
import type { TimedNote } from "./timed";

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

export type ScaleMode = "major" | "minor";

export type KeyPreference = {
  tonic: number | "auto";
  mode: ScaleMode | "auto";
};

export type ResolvedKey = {
  tonic: number;
  minor: boolean;
  pcs: Set<number>;
  label: string;
};

export const KEY_TONIC_OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "Auto key" },
  ...NOTE_NAMES.map((name, value) => ({ value: String(value), label: name.replace("#", "♯") })),
];

export function normalizeKeyPreference(tonicRaw: string, modeRaw: string): KeyPreference {
  if (tonicRaw === "auto") {
    const mode = modeRaw === "minor" || modeRaw === "major" ? modeRaw : "auto";
    return { tonic: "auto", mode };
  }
  const tonic = Number.parseInt(tonicRaw, 10);
  const mode = modeRaw === "minor" || modeRaw === "major" ? modeRaw : "auto";
  return {
    tonic: Number.isFinite(tonic) ? Math.max(0, Math.min(11, tonic)) : 0,
    mode,
  };
}

export function scalePcs(tonic: number, minor: boolean): Set<number> {
  return new Set((minor ? MINOR : MAJOR).map((step) => (tonic + step) % 12));
}

export function detectSongKey(notes: TimedNote[]): ResolvedKey {
  const weights = Array.from({ length: 12 }, () => 0);
  for (const note of notes) {
    weights[pc(note.note)] += note.duration * ((note.velocity ?? 80) / 80);
  }
  let bestTonic = 0;
  let bestMinor = false;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const minor of [false, true]) {
      const pcs = scalePcs(tonic, minor);
      let score = 0;
      for (let pitch = 0; pitch < 12; pitch++) {
        score += (pcs.has(pitch) ? 1 : -0.55) * (weights[pitch] ?? 0);
      }
      if (score > bestScore) {
        bestScore = score;
        bestTonic = tonic;
        bestMinor = minor;
      }
    }
  }
  return resolvedKey(bestTonic, bestMinor);
}

export function resolveSongKey(notes: TimedNote[], pref: KeyPreference): ResolvedKey {
  const detected = detectSongKey(notes);
  const tonic = pref.tonic === "auto" ? detected.tonic : pref.tonic;
  const minor =
    pref.mode === "auto" ? detected.minor : pref.mode === "minor";
  return resolvedKey(tonic, minor);
}

export function resolvedKey(tonic: number, minor: boolean): ResolvedKey {
  const name = NOTE_NAMES[tonic]?.replace("#", "♯") ?? "C";
  return {
    tonic,
    minor,
    pcs: scalePcs(tonic, minor),
    label: `${name} ${minor ? "minor" : "major"}`,
  };
}

export function inScale(midi: number, key: ResolvedKey): boolean {
  return key.pcs.has(pc(midi));
}

/** Shift notes so a manually chosen tonic replaces the detected one (Easy/Medium practice). */
export function transposeNotesToTonic(notes: TimedNote[], pref: KeyPreference): TimedNote[] {
  if (pref.tonic === "auto" || notes.length === 0) return notes;
  const detected = detectSongKey(notes);
  let semitones = pref.tonic - detected.tonic;
  while (semitones > 6) semitones -= 12;
  while (semitones < -6) semitones += 12;
  if (semitones === 0) return notes;
  return notes.map((note) => {
    let pitch = note.note + semitones;
    while (pitch > 108) pitch -= 12;
    while (pitch < 21) pitch += 12;
    return { ...note, note: pitch };
  });
}

export function nearestScalePitch(midi: number, key: ResolvedKey): number {
  if (inScale(midi, key)) return midi;
  const steps = key.minor ? MINOR : MAJOR;
  const baseOct = Math.floor(midi / 12);
  let best = midi;
  let bestDist = 99;
  for (const step of steps) {
    const targetPc = (key.tonic + step) % 12;
    for (let oct = baseOct - 1; oct <= baseOct + 1; oct++) {
      const candidate = oct * 12 + targetPc;
      if (candidate < 21 || candidate > 108) continue;
      const dist = Math.abs(candidate - midi);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
  }
  return best;
}

/** Snap or filter pitches to the chosen scale (Easy/Medium only). */
export function applyKeyToNotes(
  notes: TimedNote[],
  keyPref: KeyPreference,
  level: "easy" | "medium" | "hard",
): TimedNote[] {
  if (notes.length === 0 || level === "hard") return notes.map((n) => ({ ...n }));
  const key = resolveSongKey(notes, keyPref);
  if (level === "easy") {
    return notes.map((note) => ({ ...note, note: nearestScalePitch(note.note, key) }));
  }
  return notes.filter((note) => {
    if (inScale(note.note, key)) return true;
    return notes.some(
      (other) =>
        other !== note &&
        Math.abs(other.start - note.start) < 0.1 &&
        inScale(other.note, key),
    );
  });
}
