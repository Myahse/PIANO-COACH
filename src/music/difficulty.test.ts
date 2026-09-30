import { describe, expect, it } from "vitest";
import { applySongLevel, sourceNotesForLevel } from "./difficulty";
import type { TimedNote } from "./timed";

const n = (note: number, start: number, duration: number): TimedNote => ({ note, start, duration });

describe("sourceNotesForLevel", () => {
  it("easy follows the vocal stem only", () => {
    const voice = [n(64, 0, 0.2)];
    const inst = [n(60, 0, 0.5), n(64, 0.5, 0.5), n(67, 1, 0.5)];
    const out = sourceNotesForLevel({ voice, instruments: inst }, "easy", []);
    expect(out).toEqual(voice);
  });

  it("medium includes vocal melody and piano", () => {
    const voice = [n(69, 0.5, 0.4)];
    const inst = [n(48, 0, 0.8), n(55, 0, 0.75)];
    const out = sourceNotesForLevel({ voice, instruments: inst }, "medium", []);
    expect(out.some((note) => note.note === 69)).toBe(true);
    expect(out.some((note) => note.note === 48)).toBe(true);
  });

  it("hard prefers the pre-merged full score", () => {
    const voice = [n(64, 0, 0.5)];
    const inst = [n(48, 0, 0.8)];
    const all = [n(48, 0, 0.8), n(64, 0, 0.5)];
    const out = sourceNotesForLevel({ voice, instruments: inst, all }, "hard", []);
    expect(out).toEqual(all);
  });
});

describe("applySongLevel", () => {
  it("medium keeps short vocal syllables when piano sustains overlap", () => {
    const voice = [n(64, 0.1, 0.12), n(67, 0.55, 0.14), n(69, 1.0, 0.16)];
    const inst = [n(48, 0, 2.0), n(64, 0, 2.0), n(55, 0, 2.0), n(52, 0, 2.0), n(60, 0, 2.0)];
    const merged = sourceNotesForLevel({ voice, instruments: inst }, "medium", []);
    const out = applySongLevel(merged, "medium", { tonic: "auto", mode: "auto" }, { voice, instruments: inst });
    expect(out.filter((note) => note.note >= 64 && note.duration < 0.5).length).toBeGreaterThanOrEqual(2);
  });
});
