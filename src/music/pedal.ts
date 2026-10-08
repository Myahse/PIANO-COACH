import type { TimedNote } from "./timed";

/** A sustain-pedal press, in seconds. */
export type PedalSpan = { start: number; end: number };

/** Gap left before a re-struck key so the two notes stay separate. */
const RESTRIKE_GAP = 0.01;

/** For each note (sorted by start), when the same key is struck next — Infinity if never. */
function nextStrikes(sorted: TimedNote[]): number[] {
  const next = new Map<number, number>();
  const out: number[] = new Array(sorted.length);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const note = sorted[i]!;
    out[i] = next.get(note.note) ?? Infinity;
    next.set(note.note, note.start);
  }
  return out;
}

/**
 * Turn key-press durations into sounding durations.
 *
 * Piano transcribers (Transkun) report how long each key was held and the sustain pedal
 * separately; with the pedal down a briefly tapped key keeps ringing. A note released while
 * the pedal is down therefore lasts until the pedal lifts — but never past the next strike of
 * the same key.
 */
export function applySustainPedal(notes: TimedNote[], pedal: PedalSpan[]): TimedNote[] {
  if (notes.length === 0 || pedal.length === 0) return notes.map((note) => ({ ...note }));
  const spans = [...pedal].filter((span) => span.end > span.start).sort((a, b) => a.start - b.start);
  const sorted = notes.map((note) => ({ ...note })).sort((a, b) => a.start - b.start || a.note - b.note);

  const nextStart = nextStrikes(sorted);

  return sorted.map((note, i) => {
    const release = note.start + note.duration;
    const span = spans.find((s) => s.start <= release && release < s.end);
    if (!span) return note;
    const end = Math.min(span.end, nextStart[i]! - RESTRIKE_GAP);
    return end > release ? { ...note, duration: end - note.start } : note;
  });
}

/** Give every note at least `min` seconds of sound, without running into a re-strike of its key. */
export function withMinimumLength(notes: TimedNote[], min: number): TimedNote[] {
  const sorted = notes.map((note) => ({ ...note })).sort((a, b) => a.start - b.start || a.note - b.note);
  const nextStart = nextStrikes(sorted);
  return sorted.map((note, i) => {
    if (note.duration >= min) return note;
    const room = nextStart[i]! - RESTRIKE_GAP - note.start;
    return { ...note, duration: Math.max(note.duration, Math.min(min, room)) };
  });
}
