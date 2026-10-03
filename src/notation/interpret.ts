import { detectSongKey, resolveSongKey, type KeyPreference, type ResolvedKey } from "../music/keys";
import { isBlackKey, noteName, pc } from "../music/notes";
import type { TimedNote } from "../music/timed";
import { estimateBeatGrid } from "./tempo";

export type InterpretedEvent = {
  start: number;
  duration: number;
  midi: number[];
  beat: number;
  measure: number;
};

export type InterpretedScore = {
  key: ResolvedKey;
  bpm: number;
  beatDuration: number;
  /** Time (s) of the first beat of measure 0. */
  gridOrigin: number;
  measureBeats: number;
  events: InterpretedEvent[];
};

const FLAT_SPELL: Record<number, string> = {
  1: "D♭",
  3: "E♭",
  6: "G♭",
  8: "A♭",
  10: "B♭",
};

function quantizeTime(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/** Key-aware accidental for notation: ♯ vs ♭ spelling. */
export function accidentalForKey(midi: number, key: ResolvedKey): string | null {
  if (!isBlackKey(midi)) return null;
  const pitch = pc(midi);
  if (key.pcs.has(pitch)) {
    return noteName(midi).includes("#") ? "♯" : null;
  }
  return FLAT_SPELL[pitch] ? FLAT_SPELL[pitch]!.slice(1) : "♯";
}

/** Beat grid, measures, and key-aware grouping for sheet rendering. */
export function interpretForNotation(
  notes: TimedNote[],
  keyPref: KeyPreference = { tonic: "auto", mode: "auto" },
): InterpretedScore {
  const key = resolveSongKey(notes, keyPref);
  const { beatDuration, offset } = estimateBeatGrid(notes);
  const bpm = Math.round(60 / beatDuration);
  const measureBeats = 4;
  const measureDuration = beatDuration * measureBeats;
  const grid = beatDuration / 4;

  const sorted = [...notes].sort((a, b) => a.start - b.start || a.note - b.note);
  // Start the grid on the last beat at or before the first note (pickup notes stay in measure 0).
  const firstStart = sorted[0]?.start ?? 0;
  const gridOrigin = offset - Math.max(0, Math.ceil((offset - firstStart - grid / 2) / beatDuration)) * beatDuration;
  const events: InterpretedEvent[] = [];
  for (const note of sorted) {
    const start = gridOrigin + quantizeTime(note.start - gridOrigin, grid);
    const duration = Math.max(grid, quantizeTime(note.duration, grid));
    const last = events.at(-1);
    if (last && Math.abs(start - last.start) < grid * 0.5) {
      if (!last.midi.includes(note.note)) last.midi.push(note.note);
      last.duration = Math.max(last.duration, duration);
      continue;
    }
    const beat = Math.max(0, Math.floor((start - gridOrigin + 1e-6) / beatDuration));
    const measure = Math.max(0, Math.floor((start - gridOrigin + 1e-6) / measureDuration));
    events.push({ start, duration, midi: [note.note], beat, measure });
  }

  return { key, bpm, beatDuration, gridOrigin, measureBeats, events };
}

/** Fallback when no interpreted key — used by legacy callers. */
export function detectKeyLabel(notes: TimedNote[]): string {
  return detectSongKey(notes).label;
}

const SHARP_ORDER = [5, 0, 7, 2, 9, 4, 11];
const FLAT_ORDER = [5, 10, 3, 8, 1, 6, 11];

function keyAccidentalCount(key: ResolvedKey): { sharps: number; flats: number } {
  const majorTonic = key.minor ? (key.tonic + 3) % 12 : key.tonic;
  const sharpIndex = SHARP_ORDER.indexOf(majorTonic);
  const flatIndex = FLAT_ORDER.indexOf(majorTonic);
  if (key.minor) {
    if (flatIndex >= 0 && flatIndex <= 4) return { sharps: 0, flats: flatIndex + 3 };
    if (sharpIndex >= 0 && sharpIndex <= 3) return { sharps: sharpIndex + 3, flats: 0 };
  }
  if (sharpIndex >= 0) return { sharps: sharpIndex, flats: 0 };
  if (flatIndex >= 0) return { sharps: 0, flats: flatIndex };
  return { sharps: 0, flats: 0 };
}

/** Key + tempo header rendered before noteheads on the staff. */
export function notationHeaderMarkup(
  interpreted: InterpretedScore,
  trebleY: number,
  gap: number,
): string {
  const { sharps, flats } = keyAccidentalCount(interpreted.key);
  const sig =
    sharps > 0 ? `${"♯".repeat(Math.min(sharps, 7))}` : flats > 0 ? `${"♭".repeat(Math.min(flats, 7))}` : "♮";
  // One line above the top staff line, clear of the clef and noteheads.
  const y = trebleY - gap * 4 - 7;
  return `
    <text class="score-header" x="46" y="${y}"><tspan class="score-key">${interpreted.key.label}</tspan><tspan class="score-sig" dx="8">${sig}</tspan><tspan class="score-tempo" dx="8">♩ = ${interpreted.bpm}</tspan></text>
  `;
}

/** Faint beat subdivisions aligned to interpreted event positions. */
export function beatGridMarkup(
  events: InterpretedEvent[],
  xs: number[],
  trebleY: number,
  bassY: number,
  gap: number,
): string {
  const lines: string[] = [];
  let lastBeat = -1;
  events.forEach((event, index) => {
    if (index === 0) {
      lastBeat = event.beat;
      return;
    }
    if (event.beat !== lastBeat && event.measure === events[index - 1]?.measure) {
      const x = (xs[index] ?? xs[index - 1] ?? 72) - 6;
      lines.push(
        `<line class="beat-grid" x1="${x}" y1="${trebleY - 4 * gap - 4}" x2="${x}" y2="${bassY + 6}" />`,
      );
      lastBeat = event.beat;
    } else if (event.beat !== lastBeat) {
      lastBeat = event.beat;
    }
  });
  return lines.join("");
}
