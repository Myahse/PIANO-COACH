import { describe, expect, it } from "vitest";
import { estimateBeatGrid } from "./tempo";
import type { TimedNote } from "../music/timed";

const n = (note: number, start: number, duration: number, velocity = 80): TimedNote => ({
  note,
  start,
  duration,
  velocity,
});

/** Distance between an estimated beat time and the nearest true beat. */
function phaseError(offset: number, trueOffset: number, beat: number): number {
  const d = (((offset - trueOffset) % beat) + beat) % beat;
  return Math.min(d, beat - d);
}

describe("estimateBeatGrid", () => {
  it("finds the beat, not the 8th-note subdivision (100 BPM, pickup offset)", () => {
    const beat = 0.6;
    const start = 0.37;
    const notes: TimedNote[] = [];
    for (let b = 0; b < 32; b++) {
      const t = start + b * beat;
      if (b % 4 === 0) notes.push(n(48, t, beat * 4), n(55, t, beat * 4), n(64, t, beat * 4));
      notes.push(n(72 + (b % 5), t, beat / 2 - 0.02, 90), n(74 + (b % 3), t + beat / 2, beat / 2 - 0.02, 70));
    }
    const grid = estimateBeatGrid(notes);
    expect(60 / grid.beatDuration).toBeGreaterThan(97);
    expect(60 / grid.beatDuration).toBeLessThan(103);
    expect(phaseError(grid.offset, start, beat)).toBeLessThan(0.03);
  });

  it("reads 16th-note runs over a quarter-note bass as the quarter pulse (132 BPM)", () => {
    const beat = 60 / 132;
    const notes: TimedNote[] = [];
    for (let b = 0; b < 32; b++) {
      const t = 0.3 + b * beat;
      notes.push(n(36 + (b % 4), t, beat * 0.9, 80));
      for (let s = 0; s < 4; s++) notes.push(n(60 + ((b * 4 + s) % 12), t + (s * beat) / 4, beat / 4.4, 85));
    }
    const grid = estimateBeatGrid(notes);
    expect(60 / grid.beatDuration).toBeGreaterThan(129);
    expect(60 / grid.beatDuration).toBeLessThan(135);
  });

  it("stays in sync over a long song (no cumulative drift)", () => {
    const beat = 60 / 93;
    const notes: TimedNote[] = [];
    for (let b = 0; b < 400; b++) {
      notes.push(n(b % 2 ? 43 : 36, b * beat, beat * 0.8), n(67 + (b % 5), b * beat + beat / 2, beat / 3, 60));
    }
    const grid = estimateBeatGrid(notes);
    const lastBeat = 399 * beat;
    const k = Math.round((lastBeat - grid.offset) / grid.beatDuration);
    expect(Math.abs(grid.offset + k * grid.beatDuration - lastBeat)).toBeLessThan(0.04);
  });
});
