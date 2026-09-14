import type { TimedNote } from "./timed";

export type HandLayers = {
  left: TimedNote[];
  right: TimedNote[];
};

/** Split piano notes into left/right hands (Songscription-style, pitch-based). */
export function splitHands(notes: TimedNote[], splitAt = 60): HandLayers {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.note - b.note);
  if (sorted.length === 0) return { left: [], right: [] };

  const split = adaptiveSplit(sorted, splitAt);
  const left: TimedNote[] = [];
  const right: TimedNote[] = [];

  for (const note of sorted) {
    if (note.note < split) left.push({ ...note });
    else right.push({ ...note });
  }

  return { left, right };
}

function adaptiveSplit(notes: TimedNote[], fallback: number): number {
  const pitches = notes.map((n) => n.note).sort((a, b) => a - b);
  const median = pitches[Math.floor(pitches.length / 2)] ?? fallback;
  return Math.min(64, Math.max(55, Math.round((median + fallback) / 2)));
}
