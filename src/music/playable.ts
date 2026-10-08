import { keyPosition, LEAP_BASE, LEAP_SPEED, reachable } from "../ui/fingering";
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
 * - a hand that would have to leap further than it can in the time it has plays those notes an
 *   octave nearer (or leaves them out), keeping the melody;
 * - a held note is released when the hands must move to play what comes next (on a real piano
 *   the sustain pedal would keep it ringing) — notes farthest from the new chord go first.
 *
 * Start times never change; durations may shorten, and unplayable notes are moved or removed.
 */
export function makePlayable(notes: TimedNote[]): TimedNote[] {
  const sorted = dropStrayNotes(notes.map((note) => ({ ...note })).sort((a, b) => a.start - b.start || a.note - b.note));
  const chords: TimedNote[][] = [];
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
    chords.push(playableChord([...byKey.values()]));
    i = j;
  }
  return releaseHeldNotes(limitLeaps(chords));
}

/** A short note with nothing else within an octave for this long around it is a stray. */
const STRAY_WINDOW = 1.5;
const STRAY_MAX_DURATION = 0.15;

/**
 * Drop blips: a very short note alone in its register (nothing within an octave for a second and a
 * half either side) is almost always a mis-heard drum hit or overtone, and would send a hand flying.
 */
function dropStrayNotes(sorted: TimedNote[]): TimedNote[] {
  return sorted.filter((note, i) => {
    if (note.duration >= STRAY_MAX_DURATION) return true;
    for (let k = i - 1; k >= 0 && note.start - sorted[k]!.start < STRAY_WINDOW; k--) {
      if (Math.abs(sorted[k]!.note - note.note) <= 12) return true;
    }
    for (let k = i + 1; k < sorted.length && sorted[k]!.start - note.start < STRAY_WINDOW; k++) {
      if (Math.abs(sorted[k]!.note - note.note) <= 12) return true;
    }
    return false;
  });
}

type HandTrack = { centre: number | null; at: number };

const centreOf = (part: TimedNote[]) => part.reduce((s, n) => s + keyPosition(n.note), 0) / part.length;

/** How far beyond a comfortable shift a hand would have to jump to play `part` at `at`. */
function leapExcess(hand: HandTrack, part: TimedNote[], at: number): number {
  if (part.length === 0 || hand.centre === null) return 0;
  const shift = Math.abs(centreOf(part) - hand.centre);
  return Math.max(0, shift - (LEAP_BASE + LEAP_SPEED * (at - hand.at)));
}

/**
 * Hands cannot teleport: a hand that would have to jump further than it can travel in the time
 * it has (an octave and more in a fraction of a second) gets its notes moved an octave toward
 * where it already is, the way an arranger folds a jumping bass line — or, if that does not help,
 * those notes are left out. The melody (the right hand's top note) is never moved or dropped.
 */
function limitLeaps(chords: TimedNote[][]): TimedNote[][] {
  const hands: Record<"left" | "right", HandTrack> = { left: { centre: null, at: 0 }, right: { centre: null, at: 0 } };
  const out: TimedNote[][] = [];
  for (const chord of chords) {
    if (chord.length === 0) continue;
    const at = chord[0]!.start;
    // Split the chord where both halves fit a hand and the hands jump least.
    let best: { left: TimedNote[]; right: TimedNote[]; cost: number } | null = null;
    for (let split = 0; split <= chord.length; split++) {
      const left = chord.slice(0, split);
      const right = chord.slice(split);
      if (!reachable(left.map((n) => n.note)) || !reachable(right.map((n) => n.note))) continue;
      const shift = (hand: HandTrack, part: TimedNote[]) =>
        part.length === 0 || hand.centre === null ? 0 : Math.abs(centreOf(part) - hand.centre);
      const cost =
        (leapExcess(hands.left, left, at) + leapExcess(hands.right, right, at)) * 10 +
        shift(hands.left, left) + shift(hands.right, right) +
        // Without history, prefer the natural split around middle C.
        (hands.left.centre === null ? left.filter((n) => n.note >= 60).length + right.filter((n) => n.note < 60).length : 0);
      if (!best || cost < best.cost) best = { left, right, cost };
    }
    if (!best) {
      out.push(chord);
      continue;
    }
    const top = chord[chord.length - 1]!;
    for (const side of ["left", "right"] as const) {
      const hand = hands[side];
      let part = best[side];
      // The melody (the top note, played by the right hand) stays where it is.
      if (leapExcess(hand, part, at) > 0 && !(side === "right" && part.includes(top))) {
        const other = best[side === "left" ? "right" : "left"];
        const dir = centreOf(part) > hand.centre! ? -12 : 12;
        let folded = part;
        for (let k = 1; k <= 3 && leapExcess(hand, folded, at) > 0; k++) {
          folded = part.map((n) => ({ ...n, note: n.note + dir * k }));
        }
        const clash = folded.some((n) => n.note < 21 || n.note > 108 || other.some((o) => o.note === n.note));
        part = leapExcess(hand, folded, at) === 0 && !clash ? folded : [];
        best[side] = part;
      }
      if (part.length > 0) {
        hand.centre = centreOf(part);
        hand.at = at;
      }
    }
    const kept = [...best.left, ...best.right].sort((a, b) => a.note - b.note);
    if (kept.length > 0) out.push(kept);
  }
  return out;
}

/**
 * A held note is released when the hands must move to play what comes next (on a real piano the
 * sustain pedal would keep it ringing) — notes farthest from the new chord go first.
 */
function releaseHeldNotes(chords: TimedNote[][]): TimedNote[] {
  const out: TimedNote[] = [];
  const active: TimedNote[] = [];
  for (const chord of chords) {
    const at = chord[0]!.start;
    const struck = new Set(chord.map((n) => n.note));

    // Keys still held from before (and not struck again now).
    for (let k = active.length - 1; k >= 0; k--) {
      const held = active[k]!;
      if (held.start + held.duration <= at + 1e-6 || struck.has(held.note)) {
        if (struck.has(held.note)) held.duration = Math.min(held.duration, Math.max(0.03, at - held.start - RELEASE_GAP));
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
