import { describe, expect, it } from "vitest";
import { combineHardScore } from "./cleanup";
import type { TimedNote } from "./timed";

const n = (note: number, start: number, duration: number): TimedNote => ({ note, start, duration });

describe("combineHardScore", () => {
  it("drops nested vocal blips but keeps piano sustain", () => {
    const voice = [n(64, 0.05, 0.12)];
    const inst = [n(64, 0, 1.2), n(48, 0, 0.9)];
    const out = combineHardScore(voice, inst);
    expect(out.filter((note) => note.note === 64)).toHaveLength(1);
    expect(out.find((note) => note.note === 64)!.duration).toBeCloseTo(1.2, 2);
  });

  it("keeps vocal re-attacks that follow the melody", () => {
    const voice = [n(64, 0, 0.35), n(64, 0.5, 0.32), n(67, 1.0, 0.28)];
    const inst = [n(64, 0, 0.9), n(48, 0, 1.1), n(55, 0, 1.0)];
    const out = combineHardScore(voice, inst);
    const vocalC = out.filter((note) => note.note === 64 && note.duration < 0.5);
    expect(vocalC.length).toBeGreaterThanOrEqual(1);
    expect(out.some((note) => note.note === 67)).toBe(true);
  });

  it("keeps vocal-only melody pitches", () => {
    const voice = [n(69, 0.5, 0.4), n(71, 1.0, 0.35)];
    const inst = [n(48, 0, 0.8), n(55, 0, 0.75)];
    const out = combineHardScore(voice, inst);
    expect(out.some((note) => note.note === 69)).toBe(true);
    expect(out.some((note) => note.note === 71)).toBe(true);
  });
});
