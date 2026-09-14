import { describe, expect, it } from "vitest";
import {
  clampBeforeReattack,
  mergeLegatoFragments,
  scaleTimedNotes,
  stripNestedSamePitch,
  type TimedNote,
} from "./timed";

const n = (note: number, start: number, duration: number): TimedNote => ({ note, start, duration });

describe("stripNestedSamePitch", () => {
  it("removes short flutter inside a longer sustain", () => {
    const notes = [
      n(60, 0, 1.2),
      n(60, 0.05, 0.08),
      n(62, 0.5, 0.3),
    ];
    const out = stripNestedSamePitch(notes);
    expect(out).toHaveLength(2);
    expect(out.some((x) => x.start === 0.05)).toBe(false);
  });
});

describe("clampBeforeReattack", () => {
  it("caps sustain before a clear re-attack", () => {
    const notes = [n(60, 0, 0.8), n(60, 0.65, 0.25)];
    const out = clampBeforeReattack(notes);
    const first = out.find((x) => x.note === 60 && x.start === 0);
    expect(first).toBeDefined();
    expect(first!.duration).toBeCloseTo(0.64, 2);
    expect(out).toHaveLength(2);
  });
});

describe("mergeLegatoFragments", () => {
  it("merges overlapping same-pitch fragments", () => {
    const notes = [n(64, 0, 0.2), n(64, 0.15, 0.2)];
    const out = mergeLegatoFragments(notes);
    expect(out).toHaveLength(1);
    expect(out[0]!.duration).toBeCloseTo(0.35, 2);
  });
});

describe("scaleTimedNotes", () => {
  it("stretches timeline when practice speed is below 1", () => {
    const notes = [n(60, 1, 0.5), n(62, 2, 0.25)];
    const out = scaleTimedNotes(notes, 0.5);
    expect(out[0]!.start).toBeCloseTo(2, 5);
    expect(out[0]!.duration).toBeCloseTo(1, 5);
    expect(out[1]!.start).toBeCloseTo(4, 5);
  });
});
