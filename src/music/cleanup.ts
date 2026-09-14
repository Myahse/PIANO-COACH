import { detectSongKey, type ResolvedKey } from "./keys";
import { clampBeforeReattack, mergeLegatoFragments, mergeTiedNotes, type TimedNote } from "./timed";

/** Thin a vocal stem down to a single melody line. */
export function cleanMelody(notes: TimedNote[]): TimedNote[] {
  const tied = mergeTiedNotes(notes, 0.32);
  if (tied.length === 0) return [];
  const center = median(tied.map((note) => note.note));
  const stacked = dropOctaveCopies(tied);
  const inRange = stacked.filter(
    (note) => note.duration >= 0.07 && note.note >= center - 26 && note.note <= center + 26,
  );
  return mergeTiedNotes(limitTogether(inRange, 1), 0.26);
}

/** Snap timing lightly — preserve short notes and long sustains. */
export function quantizeNotes(notes: TimedNote[], step = 0.02): TimedNote[] {
  return notes.map((note) => ({
    ...note,
    start: Math.round(note.start / step) * step,
    duration: Math.max(0.03, Math.round(note.duration / step) * step),
  }));
}

const PIANO_LOW = 21;
const PIANO_HIGH = 108;

/** Drop MuScriptor junk: out-of-range pitches, micro-blips, duplicate hits, note floods. */
export function stripMuScriptorArtifacts(notes: TimedNote[]): TimedNote[] {
  if (notes.length === 0) return [];
  const sorted = notes
    .filter(
      (note) =>
        note.note >= PIANO_LOW &&
        note.note <= PIANO_HIGH &&
        note.duration >= 0.04 &&
        Number.isFinite(note.start) &&
        Number.isFinite(note.duration),
    )
    .sort((a, b) => a.start - b.start || a.note - b.note || b.duration - a.duration);

  const deduped: TimedNote[] = [];
  for (const note of sorted) {
    const prev = deduped.at(-1);
    if (
      prev &&
      prev.note === note.note &&
      Math.abs(prev.start - note.start) < 0.02 &&
      Math.abs(prev.duration - note.duration) < 0.03
    ) {
      continue;
    }
    deduped.push({ ...note });
  }
  return collapsePitchFlutter(deduped);
}

/** At one instant MuScriptor can emit dozens of pitches — keep the strongest few. */
export function limitSimultaneous(notes: TimedNote[], maxPerInstant: number): TimedNote[] {
  if (notes.length === 0 || maxPerInstant < 1) return [];
  const buckets = new Map<number, TimedNote[]>();
  for (const note of notes) {
    const key = Math.round(note.start * 50);
    const list = buckets.get(key) ?? [];
    list.push(note);
    buckets.set(key, list);
  }
  const kept: TimedNote[] = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => strength(b) - strength(a));
    kept.push(...list.slice(0, maxPerInstant));
  }
  return kept.sort((a, b) => a.start - b.start || a.note - b.note);
}

/** Only trim obvious MuScriptor floods (20+ pitches in 20 ms) — keep normal chords intact. */
export function limitExtremeFlood(notes: TimedNote[], maxPerInstant = 14): TimedNote[] {
  if (notes.length === 0) return [];
  const buckets = new Map<number, TimedNote[]>();
  for (const note of notes) {
    const key = Math.round(note.start * 50);
    const list = buckets.get(key) ?? [];
    list.push(note);
    buckets.set(key, list);
  }
  const kept: TimedNote[] = [];
  for (const list of buckets.values()) {
    if (list.length <= maxPerInstant + 4) {
      kept.push(...list);
      continue;
    }
    list.sort((a, b) => strength(b) - strength(a));
    kept.push(...list.slice(0, maxPerInstant));
  }
  return kept.sort((a, b) => a.start - b.start || a.note - b.note);
}

/** Nudge a note ±1 semitone when it clearly belongs to a nearby chord cluster. */
export function fixSemitoneSlips(notes: TimedNote[]): TimedNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.note - b.note);
  return sorted.map((note) => {
    const neighbors = sorted.filter(
      (other) => other !== note && Math.abs(other.start - note.start) <= 0.055,
    );
    if (neighbors.length === 0) return note;
    for (const delta of [-1, 1] as const) {
      const snapped = note.note + delta;
      if (snapped < PIANO_LOW || snapped > PIANO_HIGH) continue;
      const matches = neighbors.filter((other) => Math.abs(other.note - snapped) <= 1).length;
      const alone = neighbors.filter((other) => Math.abs(other.note - note.note) <= 2).length;
      if (matches >= 2 && alone <= 1) return { ...note, note: snapped };
    }
    return note;
  });
}

/** Merge overlapping same-pitch duplicates only — never glue separated re-attacks. */
function collapsePitchFlutter(notes: TimedNote[]): TimedNote[] {
  const kept: TimedNote[] = [];
  for (const note of notes) {
    let prev: TimedNote | undefined;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i]?.note === note.note) {
        prev = kept[i];
        break;
      }
    }
    if (prev) {
      const prevEnd = prev.start + prev.duration;
      if (note.start < prevEnd - 0.004) {
        prev.duration = Math.max(prevEnd, note.start + note.duration) - prev.start;
        if ((note.velocity ?? 0) > (prev.velocity ?? 0)) prev.velocity = note.velocity;
        continue;
      }
    }
    kept.push({ ...note });
  }
  return kept;
}

/** Hard mode playback — trim floods, keep up to 10 chord tones per instant. */
export function polishHardChords(notes: TimedNote[]): TimedNote[] {
  if (notes.length === 0) return [];
  return limitSimultaneous(limitExtremeFlood(fixSemitoneSlips(notes)), 10);
}

/** Store transcription faithfully — strip junk only, keep pitch and timing. */
export function preparePianoNotes(notes: TimedNote[]): TimedNote[] {
  if (notes.length === 0) return [];
  const stripped = stripMuScriptorArtifacts(notes).sort((a, b) => a.start - b.start || a.note - b.note);
  const pitched = fixSemitoneSlips(stripped);
  const capped = limitExtremeFlood(pitched);
  return clampBeforeReattack(mergeLegatoFragments(capped));
}

/** Vocal layer — same minimal cleanup as piano. */
export function prepareMelodyNotes(notes: TimedNote[]): TimedNote[] {
  if (notes.length === 0) return [];
  const stripped = stripMuScriptorArtifacts(notes).sort((a, b) => a.start - b.start || a.note - b.note);
  const pitched = fixSemitoneSlips(stripped);
  return clampBeforeReattack(mergeLegatoFragments(pitched));
}

/** Aggressive cleanup for simplified / Easy display (not used when storing full transcription). */
export function autoFixPiano(notes: TimedNote[]): TimedNote[] {
  if (notes.length === 0) return [];
  return quantizeNotes(cleanTranscription(notes));
}

/** Aggressive vocal thinning for simplified display. */
export function autoFixMelody(notes: TimedNote[]): TimedNote[] {
  if (notes.length === 0) return [];
  return quantizeNotes(cleanMelody(notes));
}

export function cleanTranscription(notes: TimedNote[]): TimedNote[] {
  const tied = mergeTiedNotes(notes, 0.28);
  if (tied.length === 0) return [];
  const key = detectSongKey(tied);
  const stacked = dropOctaveCopies(tied);
  const span = Math.max(1, lastEnd(stacked) - (stacked[0]?.start ?? 0));
  const perSecond = stacked.length / span;
  const voices = perSecond > 6 ? 2 : perSecond > 3 ? 3 : perSecond > 1.4 ? 4 : 5;
  const center = median(stacked.map((note) => note.note));
  const filtered = stacked.filter((note) => keepNote(note, key, stacked, center));
  return mergeTiedNotes(limitTogether(filtered, voices), 0.22);
}

function dropOctaveCopies(notes: TimedNote[]): TimedNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.note - b.note);
  const center = median(sorted.map((note) => note.note));
  const groups: TimedNote[][] = [];
  for (const note of sorted) {
    const last = groups.at(-1);
    const head = last?.[0];
    if (last && head && note.start - head.start <= 0.07) last.push(note);
    else groups.push([note]);
  }
  const kept: TimedNote[] = [];
  for (const group of groups) {
    const byPc = new Map<number, TimedNote>();
    for (const note of group) {
      const pc = note.note % 12;
      const prev = byPc.get(pc);
      if (!prev || strength(note) > strength(prev)) byPc.set(pc, preferPlayableOctave(note, prev, center));
    }
    kept.push(...byPc.values());
  }
  return kept.sort((a, b) => a.start - b.start || a.note - b.note);
}

function preferPlayableOctave(note: TimedNote, other: TimedNote | undefined, center: number): TimedNote {
  const candidate = other && strength(other) > strength(note) * 1.15 ? other : note;
  const low = center - 24;
  const high = center + 24;
  if (candidate.note < low) return { ...candidate, note: fold(candidate.note, low, low + 14) };
  if (candidate.note > high) return { ...candidate, note: fold(candidate.note, high - 19, high) };
  return candidate;
}

function median(values: number[]): number {
  if (values.length === 0) return 60;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 60;
}

function fold(midi: number, low: number, high: number): number {
  let note = midi;
  while (note > high) note -= 12;
  while (note < low) note += 12;
  return note;
}

function strength(note: TimedNote): number {
  return Math.max(0.08, note.duration) * ((note.velocity ?? 80) / 80);
}

function lastEnd(notes: TimedNote[]): number {
  return notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0);
}

function keepNote(note: TimedNote, key: ResolvedKey, all: TimedNote[], center: number): boolean {
  if (note.duration < 0.06) return false;
  if (note.note < center - 28 && note.duration < 0.2) return false;
  if (note.note > center + 28 && note.duration < 0.16) return false;
  const inKey = key.pcs.has(note.note % 12);
  if (inKey) return true;
  const neighbor = all.some(
    (other) =>
      other !== note &&
      Math.abs(other.start - note.start) < 0.9 &&
      Math.abs(other.note - note.note) <= 3,
  );
  return note.duration >= 0.22 && neighbor;
}

function limitTogether(notes: TimedNote[], voices: number): TimedNote[] {
  const kept: TimedNote[] = [];
  for (const note of notes) {
    const active = kept.filter((item) => note.start < item.start + item.duration * 0.65);
    if (active.length < voices) {
      kept.push({ ...note });
      continue;
    }
    const weakest = active.reduce((low, item) => (strength(item) < strength(low) ? item : low));
    if (strength(note) > strength(weakest) * 1.05) {
      weakest.duration = Math.max(0.1, note.start - weakest.start);
      kept.push({ ...note });
    }
  }
  return kept.filter((note) => note.duration >= 0.08);
}

