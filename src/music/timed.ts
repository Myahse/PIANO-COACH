import { SONGS } from "./songs";

export type TimedNote = {
  note: number;
  start: number;
  duration: number;
  velocity?: number;
};

/** Smallest visible tile height — does not change stored note length. */
export const MIN_TILE_DURATION = 0.04;

/** Minimum guide-piano hold so fast notes stay audible. */
export const MIN_GUIDE_DURATION = 0.07;

export function tileDuration(note: TimedNote): number {
  return Math.max(note.duration, MIN_TILE_DURATION);
}

export function guideDuration(note: TimedNote): number {
  return Math.max(note.duration, MIN_GUIDE_DURATION);
}

/** Drop shorter same-pitch hits that sit inside a longer sustain (transcriber flutter). */
export function stripNestedSamePitch(notes: TimedNote[]): TimedNote[] {
  if (notes.length < 2) return notes;
  return notes.filter((note) => {
    const end = note.start + note.duration;
    const parent = notes.find(
      (other) =>
        other !== note &&
        other.note === note.note &&
        other.duration > note.duration * 1.08 &&
        other.start <= note.start + 0.012 &&
        other.start + other.duration >= end - 0.012,
    );
    if (!parent) return true;
    if (note.duration < 0.2) return false;
    return note.duration > parent.duration * 0.5;
  });
}

/** Shorten only when the same pitch is clearly re-struck — ignore micro-blips inside a sustain. */
export function clampBeforeReattack(notes: TimedNote[]): TimedNote[] {
  const sorted = stripNestedSamePitch([...notes]).sort((a, b) => a.start - b.start || a.note - b.note);
  const withoutBlips = sorted.filter((note) => {
    if (note.duration >= 0.06) return true;
    return !sorted.some(
      (other) =>
        other !== note &&
        other.note === note.note &&
        other.duration >= 0.15 &&
        other.start <= note.start + 0.012 &&
        other.start + other.duration >= note.start + note.duration + 0.015,
    );
  });

  const nextAttack = new Map<number, { start: number; duration: number }>();
  for (let i = withoutBlips.length - 1; i >= 0; i--) {
    const note = withoutBlips[i]!;
    const later = nextAttack.get(note.note);
    if (
      later &&
      later.start > note.start + 0.06 &&
      later.duration >= 0.07 &&
      note.duration >= 0.12
    ) {
      const capped = Math.max(MIN_TILE_DURATION, later.start - note.start - 0.01);
      if (capped < note.duration - 0.01) {
        withoutBlips[i] = { ...note, duration: capped };
      }
    }
    nextAttack.set(note.note, { start: note.start, duration: note.duration });
  }
  return withoutBlips.sort((a, b) => a.start - b.start || a.note - b.note);
}

/** @deprecated Use tileDuration — kept for call sites migrating gradually. */
export function playDuration(note: TimedNote): number {
  return tileDuration(note);
}

/** Merge same-pitch fragments only when overlapping (true sustain / transcriber stutter). */
export function mergeLegatoFragments(notes: TimedNote[], maxGap = 0.012): TimedNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.note - b.note);
  const kept: TimedNote[] = [];
  for (const note of sorted) {
    let prev: TimedNote | undefined;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i]?.note === note.note) {
        prev = kept[i];
        break;
      }
    }
    if (prev) {
      const prevEnd = prev.start + prev.duration;
      const gap = note.start - prevEnd;
      const stutter =
        gap <= maxGap &&
        gap >= 0 &&
        note.duration <= 0.09 &&
        prev.duration <= 0.14;
      const overlap = note.start < prevEnd - 0.004;
      if (overlap || stutter) {
        prev.duration = Math.max(prevEnd, note.start + note.duration) - prev.start;
        if ((note.velocity ?? 0) > (prev.velocity ?? 0)) prev.velocity = note.velocity;
        continue;
      }
    }
    kept.push({ ...note });
  }
  return kept.sort((a, b) => a.start - b.start || a.note - b.note);
}

/** Align chord starts for display — preserves each note's real duration. */
export function smoothForTiles(notes: TimedNote[]): TimedNote[] {
  const sorted = [...notes]
    .map((note) => ({ ...note }))
    .sort((a, b) => a.start - b.start || a.note - b.note);
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j]!.start - sorted[i]!.start <= 0.05) j += 1;
    if (j - i > 1) {
      const snap = sorted[i]!.start;
      for (let k = i + 1; k < j; k++) sorted[k]!.start = snap;
    }
    i = j;
  }
  return sorted.sort((a, b) => a.start - b.start || a.note - b.note);
}

export type Piece = {
  id: string;
  title: string;
  source: "builtin" | "midi" | "musicxml" | "audio";
  notes: TimedNote[];
  fullNotes?: TimedNote[];
  voiceNotes?: TimedNote[];
  instNotes?: TimedNote[];
  leftHandNotes?: TimedNote[];
  rightHandNotes?: TimedNote[];
  audio?: AudioBuffer;
  audioOffset?: number;
  /** Saved track length so playback timing survives if AudioBuffer reload fails. */
  audioDurationSec?: number;
  savedAt?: number;
};

export function melodyToTimed(notes: number[], beats: number[], bpm: number): TimedNote[] {
  const beat = 60 / bpm;
  let time = 0;
  return notes.map((note, index) => {
    const length = (beats[index] ?? 1) * beat;
    const timed = { note, start: time, duration: Math.max(0.08, length * 0.9) };
    time += length;
    return timed;
  });
}

export function pitchesToTimed(notes: number[], bpm: number, beatsEach = 1): TimedNote[] {
  return melodyToTimed(notes, notes.map(() => beatsEach), bpm);
}

/** Slow down or speed up timed notes (speed 0.7 = 70% tempo). */
export function scaleTimedNotes(notes: TimedNote[], speed: number): TimedNote[] {
  const factor = 1 / Math.max(0.35, speed);
  return notes.map((note) => ({
    ...note,
    start: note.start * factor,
    duration: note.duration * factor,
  }));
}

/** Wide-gap merge for lesson simplification — not for raw transcription storage. */
export function mergeTiedNotes(notes: TimedNote[], maxGap = 0.42): TimedNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.note - b.note);
  const kept: TimedNote[] = [];
  for (const note of sorted) {
    let prev: TimedNote | undefined;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i]?.note === note.note) {
        prev = kept[i];
        break;
      }
    }
    if (prev) {
      const gap = note.start - (prev.start + prev.duration);
      if (gap <= maxGap) {
        prev.duration = Math.max(prev.start + prev.duration, note.start + note.duration) - prev.start;
        if ((note.velocity ?? 0) > (prev.velocity ?? 0)) prev.velocity = note.velocity;
        continue;
      }
    }
    kept.push({ ...note });
  }
  return kept.sort((a, b) => a.start - b.start || a.note - b.note);
}

export function pieceDuration(
  notes: TimedNote[],
  audio?: AudioBuffer,
  offset = 0,
  audioDurationSec?: number,
): number {
  const fromNotes = notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0);
  const audioLen = Math.max(0, (audio?.duration ?? audioDurationSec ?? 0) - offset);
  return Math.max(fromNotes, audioLen);
}

/** Pull notes back in from the full conversion when Easy/Medium left long silent gaps. */
export function fillTimelineGaps(
  kept: TimedNote[],
  pool: TimedNote[],
  songDuration: number,
  maxGap = 2.2,
): TimedNote[] {
  if (pool.length === 0 || songDuration <= 0) return kept;
  const out = kept.map((note) => ({ ...note }));
  const strength = (note: TimedNote) => Math.max(0.05, note.duration) * ((note.velocity ?? 80) / 80);
  const hasNote = (from: number, to: number) => out.some((note) => note.start >= from && note.start < to);

  for (let cursor = 0; cursor < songDuration; cursor += maxGap) {
    const end = Math.min(songDuration, cursor + maxGap);
    if (hasNote(cursor, end)) continue;
    const candidate = pool
      .filter((note) => note.start >= cursor && note.start < end + maxGap * 0.45)
      .sort((a, b) => strength(b) - strength(a) || a.start - b.start)[0];
    if (candidate) out.push({ ...candidate });
  }
  return out.sort((a, b) => a.start - b.start || a.note - b.note);
}

export function builtinPieces(): Piece[] {
  return SONGS.map((song) => ({
    id: song.id,
    title: song.title,
    source: "builtin" as const,
    notes: melodyToTimed(song.notes, song.beats, song.bpm),
  }));
}
