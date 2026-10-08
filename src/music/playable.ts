import { reachable } from "../ui/fingering";
import type { TimedNote } from "./timed";

/** Notes starting within this window count as one chord. */
const CHORD_WINDOW = 0.04;
/** A released note ends this long before the notes that made the hand move. */
const RELEASE_GAP = 0.01;

/** Can two hands hold all these keys at once (each hand ≤ 5 keys within an octave)? */
export function twoHandsCanHold(notes: number[]): boolean {
  const sorted = [...new Set(notes)].sort((a, b) => a - b);
  for (let split = 0; split <= sorted.length; split++) {
    if (reachable(sorted.slice(0, split)) && reachable(sorted.slice(split))) return true;
  }
  return false;
}

/** Shrink a chord no two hands can play: keep bass and top, drop inner notes nearest the middle. */
function playableChord(chord: TimedNote[]): TimedNote[] {
  const kept = [...chord].sort((a, b) => a.note - b.note);
  while (kept.length > 2 && !twoHandsCanHold(kept.map((n) => n.note))) {
    const mid = (kept.length - 1) / 2;
    let idx = 1;
    for (let i = 1; i < kept.length - 1; i++) if (Math.abs(i - mid) < Math.abs(idx - mid)) idx = i;
    kept.splice(idx, 1);
  }
  return kept;
}

/**
 * Make an arrangement physically playable by two human hands, the way an arranger would:
 *
 * - a chord too wide or too full for two hands keeps its bass and melody (outer notes) and
 *   loses inner notes until it fits;
 * - a held note is released when the hands must move to play what comes next (on a real piano
 *   the sustain pedal would keep it ringing) — notes farthest from the new chord go first.
 *
 * Start times never change; only durations shorten and unplayable inner notes are removed.
 */
export function makePlayable(notes: TimedNote[]): TimedNote[] {
  const sorted = notes.map((note) => ({ ...note })).sort((a, b) => a.start - b.start || a.note - b.note);
  const out: TimedNote[] = [];
  const active: TimedNote[] = [];

  for (let i = 0; i < sorted.length; ) {
    const at = sorted[i]!.start;
    let j = i;
    while (j < sorted.length && sorted[j]!.start - at < CHORD_WINDOW) j++;
    // One note per key in a chord (a duplicate strike adds nothing to play).
    const byKey = new Map<number, TimedNote>();
    for (const note of sorted.slice(i, j)) {
      const prev = byKey.get(note.note);
      if (!prev || note.duration > prev.duration) byKey.set(note.note, note);
    }
    const chord = playableChord([...byKey.values()]);
    i = j;

    // Keys still held from before (and not struck again now).
    for (let k = active.length - 1; k >= 0; k--) {
      const held = active[k]!;
      if (held.start + held.duration <= at + 1e-6 || byKey.has(held.note)) {
        if (byKey.has(held.note)) held.duration = Math.min(held.duration, Math.max(0.03, at - held.start - RELEASE_GAP));
        active.splice(k, 1);
      }
    }

    // Let go of held keys (farthest from the new chord first) until everything fits in two hands.
    const centre = chord.reduce((s, n) => s + n.note, 0) / Math.max(1, chord.length);
    active.sort((a, b) => Math.abs(a.note - centre) - Math.abs(b.note - centre));
    while (active.length > 0 && !twoHandsCanHold([...active, ...chord].map((n) => n.note))) {
      const released = active.pop()!;
      released.duration = Math.max(0.03, at - released.start - RELEASE_GAP);
    }

    for (const note of chord) {
      out.push(note);
      active.push(note);
    }
  }
  return out.sort((a, b) => a.start - b.start || a.note - b.note);
}
