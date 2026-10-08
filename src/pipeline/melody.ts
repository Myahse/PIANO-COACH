import type { TimedNote } from "../music/timed";

/** A general-purpose transcriber note, optionally with its in-note pitch wobble (semitones). */
export type MelodyCandidate = TimedNote & { bendSpread?: number };

/** Pitch offsets a general-purpose transcriber reports for a piano note (unison, octaves, 12th). */
const HARMONIC_OFFSETS = [0, 12, 19, 24, -12];

const MIN_MELODY_DURATION = 0.1;
const MELODY_LOW = 48;
const MELODY_HIGH = 96;
/** Pitch wobble (semitones) above which a note is sung/bowed, not a piano overtone. */
const VIBRATO_SPREAD = 0.3;
/** Steady-pitch (no vibrato) leftovers must be at least this long to count as melody. */
const MIN_STEADY_DURATION = 0.25;
/**
 * A real melody line is a meaningful part of the piece — enough notes, or (for long held sung
 * notes) enough of the running time. A few stray leftovers are noise.
 */
const MIN_LINE_NOTES = 4;
const MIN_LINE_SHARE = 0.15;
const MIN_HELD_NOTES = 3;
const MIN_TIME_SHARE = 0.25;

function isRealLine(line: TimedNote[], piano: TimedNote[]): boolean {
  if (line.length >= Math.max(MIN_LINE_NOTES, piano.length * MIN_LINE_SHARE)) return true;
  if (line.length < MIN_HELD_NOTES) return false;
  const all = [...line, ...piano];
  const from = Math.min(...all.map((n) => n.start));
  const to = Math.max(...all.map((n) => n.start + n.duration));
  const sung = line.reduce((sum, n) => sum + n.duration, 0);
  return sung >= (to - from) * MIN_TIME_SHARE;
}

function isExplainedByPiano(note: MelodyCandidate, piano: TimedNote[]): boolean {
  // Piano notes hold a steady pitch; vibrato means a voice (even one doubling the piano's octave).
  const voiced = (note.bendSpread ?? 0) >= VIBRATO_SPREAD;
  for (const p of piano) {
    if (p.start > note.start + 0.1) break;
    const offset = note.note - p.note;
    if (!HARMONIC_OFFSETS.includes(offset)) continue;
    if (voiced && offset !== 0) continue;
    // Same attack as a piano note (or one of its overtones).
    if (Math.abs(p.start - note.start) <= 0.08) return true;
    // Still sounding inside a sustained piano note of the same pitch.
    if (offset === 0 && note.start >= p.start - 0.05 && note.start <= p.start + p.duration) return true;
  }
  return false;
}

/** Keep one line: when notes overlap, the higher (then stronger) one wins and the other is trimmed. */
function skyline(notes: TimedNote[]): TimedNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.note - a.note);
  const line: TimedNote[] = [];
  for (const note of sorted) {
    const prev = line.at(-1);
    if (prev && note.start < prev.start + prev.duration) {
      if (note.start - prev.start < 0.05) {
        // Near-simultaneous: keep the higher pitch.
        if (note.note > prev.note) line[line.length - 1] = { ...note };
        continue;
      }
      prev.duration = note.start - prev.start;
    }
    line.push({ ...note });
  }
  return line.filter((note) => note.duration >= MIN_MELODY_DURATION * 0.8);
}

/**
 * A held sung note often comes back from the transcriber as back-to-back pieces of the same
 * pitch (the pitch wobbles, the detector restarts). Join pieces that follow with no real gap;
 * a deliberately repeated note has a breath or consonant between the attacks.
 */
const LEGATO_GAP = 0.06;

function joinHeldNotes(line: TimedNote[]): TimedNote[] {
  const out: TimedNote[] = [];
  for (const note of line) {
    const prev = out.at(-1);
    if (prev && prev.note === note.note && note.start - (prev.start + prev.duration) <= LEGATO_GAP) {
      prev.duration = Math.max(prev.duration, note.start + note.duration - prev.start);
      prev.velocity = Math.max(prev.velocity ?? 0, note.velocity ?? 0);
      continue;
    }
    out.push({ ...note });
  }
  return out;
}

/** Drop notes with no melodic neighbour — a real line has company within a couple of seconds. */
function dropIsolated(notes: TimedNote[], window = 2.5, minNeighbours = 1): TimedNote[] {
  return notes.filter((note) => {
    let count = 0;
    for (const other of notes) {
      if (other === note) continue;
      if (Math.abs(other.start - note.start) <= window) count += 1;
      if (count >= minNeighbours) return true;
    }
    return false;
  });
}

/**
 * Melody (vocals / lead instrument) that a piano-only model missed.
 *
 * `candidates` come from a general-purpose transcriber run on the same audio; anything a piano
 * note already explains is removed, and what remains is reduced to a single melodic line.
 * On solo-piano recordings nothing should survive.
 */
export function extractResidualMelody(candidates: MelodyCandidate[], piano: TimedNote[]): TimedNote[] {
  const pianoSorted = [...piano].sort((a, b) => a.start - b.start);
  const residual = candidates.filter(
    (note) =>
      note.duration >= MIN_MELODY_DURATION &&
      (note.duration >= MIN_STEADY_DURATION || (note.bendSpread ?? 0) >= VIBRATO_SPREAD) &&
      note.note >= MELODY_LOW &&
      note.note <= MELODY_HIGH &&
      !isExplainedByPiano(note, pianoSorted),
  );
  const line = dropIsolated(joinHeldNotes(skyline(residual)));
  if (!isRealLine(line, piano)) return [];
  return line.map(({ note, start, duration, velocity }) => ({
    note,
    start,
    duration,
    velocity,
  }));
}
