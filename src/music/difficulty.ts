import { resolveSongKey, type KeyPreference, type ResolvedKey } from "./keys";
import { mergeTiedNotes, type TimedNote } from "./timed";

export type SongLevel = "easy" | "medium" | "hard";

export type NoteLayers = {
  voice?: TimedNote[];
  instruments?: TimedNote[];
  leftHand?: TimedNote[];
  rightHand?: TimedNote[];
  all?: TimedNote[];
};

export function normalizeSongLevel(value: string): SongLevel {
  if (value === "easy" || value === "hard") return value;
  return "medium";
}

/** Pick note layers per level: Easy = vocals, Hard = full song, Medium = both stems. */
export function sourceNotesForLevel(layers: NoteLayers, level: SongLevel, fallback: TimedNote[]): TimedNote[] {
  const voice = layers.voice ?? [];
  const inst = layers.instruments ?? [];
  const all = layers.all ?? [...voice, ...inst];

  if (level === "easy") {
    return voice.length ? voice.slice() : fallback.slice();
  }
  if (level === "hard") {
    return all.length ? all.slice().sort((a, b) => a.start - b.start || a.note - b.note) : fallback.slice();
  }
  const merged = [...voice, ...inst].sort((a, b) => a.start - b.start || a.note - b.note);
  return merged.length ? merged : all.length ? all.slice() : fallback.slice();
}

export function applySongLevel(
  notes: TimedNote[],
  level: SongLevel,
  keyPref: KeyPreference = { tonic: "auto", mode: "auto" },
): TimedNote[] {
  if (notes.length === 0) return [];
  if (level === "easy") return notes.map((note) => ({ ...note }));
  if (level === "hard") return notes.map((note) => ({ ...note }));

  const key = resolveSongKey(notes, keyPref);
  const sorted = mergeTiedNotes(notes, 0.16);
  const stats = measureSong(sorted);
  return simplifyForLearning(sorted, key, {
    voices: Math.min(5, Math.max(3, stats.typicalVoices)),
    melodyOnly: false,
    minDuration: Math.max(0.05, stats.medianDuration * 0.18),
  });
}

type LearnOpts = {
  voices: number;
  melodyOnly: boolean;
  minDuration: number;
};

function simplifyForLearning(notes: TimedNote[], key: ResolvedKey, opts: LearnOpts): TimedNote[] {
  const playable = notes.filter((note) => note.duration >= opts.minDuration);
  let pool = limitVoices(playable, opts.voices);
  if (opts.melodyOnly) {
    pool = extractLearningLines(pool, key);
  }
  return mergeTiedNotes(pool, 0.18);
}

function extractLearningLines(notes: TimedNote[], key: ResolvedKey): TimedNote[] {
  const buckets = new Map<number, TimedNote[]>();
  for (const note of notes) {
    const slot = Math.round(note.start * 20);
    const list = buckets.get(slot) ?? [];
    list.push(note);
    buckets.set(slot, list);
  }

  const melody: TimedNote[] = [];
  const bass: TimedNote[] = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => strength(b) - strength(a));
    const lead = list.find((n) => n.note >= 55) ?? list[0];
    if (lead) melody.push({ ...lead });
    const low = list
      .filter((n) => n.note < 60 && key.pcs.has(n.note % 12))
      .sort((a, b) => a.note - b.note)[0];
    if (low && low !== lead) bass.push({ ...low, duration: Math.min(low.duration, 1.6) });
  }

  return [...melody, ...bass].sort((a, b) => a.start - b.start || a.note - b.note);
}

function measureSong(notes: TimedNote[]): { typicalVoices: number; medianDuration: number } {
  const durations = notes.map((note) => note.duration).sort((a, b) => a - b);
  const concurrent = notes
    .map((note) => {
      return (
        1 +
        notes.filter(
          (other) =>
            other !== note && note.start >= other.start && note.start < other.start + other.duration * 0.65,
        ).length
      );
    })
    .sort((a, b) => a - b);
  return {
    typicalVoices: concurrent[Math.floor(concurrent.length * 0.75)] ?? 1,
    medianDuration: durations[Math.floor(durations.length / 2)] ?? 0.2,
  };
}

function limitVoices(notes: TimedNote[], voices: number): TimedNote[] {
  const kept: TimedNote[] = [];
  for (const note of notes) {
    const active = kept.filter((item) => note.start < item.start + item.duration * 0.65);
    if (active.length < voices) {
      kept.push({ ...note });
      continue;
    }
    const weakest = active.reduce((low, item) => (strength(item) < strength(low) ? item : low));
    if (strength(note) > strength(weakest)) {
      weakest.duration = Math.max(0.1, note.start - weakest.start);
      kept.push({ ...note });
    }
  }
  return kept.filter((note) => note.duration >= 0.08);
}

function strength(note: TimedNote): number {
  return Math.max(0.08, note.duration) * ((note.velocity ?? 80) / 80);
}
