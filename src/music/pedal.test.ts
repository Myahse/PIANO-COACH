import { describe, expect, it } from "vitest";
import { applySustainPedal, withMinimumLength } from "./pedal";

const n = (note: number, start: number, duration: number) => ({ note, start, duration, velocity: 80 });

describe("applySustainPedal", () => {
  it("lets a tapped key ring until the pedal lifts", () => {
    const [out] = applySustainPedal([n(60, 3.51, 0.05)], [{ start: 3.51, end: 4.52 }]);
    expect(out!.duration).toBeCloseTo(1.01, 2);
  });

  it("never rings past the next strike of the same key", () => {
    const out = applySustainPedal([n(60, 0, 0.05), n(60, 0.5, 0.05)], [{ start: 0, end: 2 }]);
    expect(out[0]!.start + out[0]!.duration).toBeLessThan(0.5);
    expect(out[1]!.start + out[1]!.duration).toBeCloseTo(2, 5);
  });

  it("leaves notes released with the pedal up alone", () => {
    const out = applySustainPedal([n(64, 0, 0.3), n(67, 1, 0.2)], [{ start: 0.5, end: 0.9 }]);
    expect(out.map((note) => note.duration)).toEqual([0.3, 0.2]);
  });

  it("does not shorten a key held past the pedal", () => {
    const [out] = applySustainPedal([n(48, 0, 3)], [{ start: 0, end: 1 }]);
    expect(out!.duration).toBe(3);
  });
});

describe("withMinimumLength", () => {
  it("lengthens key taps but stops before a fast re-strike of the same key", () => {
    const out = withMinimumLength([n(60, 0, 0.03), n(60, 0.05, 0.03), n(64, 0, 0.03)], 0.08);
    expect(out.find((x) => x.note === 64)!.duration).toBeCloseTo(0.08, 5);
    expect(out[0]!.duration).toBeCloseTo(0.04, 5); // room until the re-strike at 0.05 s
  });
});
