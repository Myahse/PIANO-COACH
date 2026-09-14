import { describe, expect, it } from "vitest";
import { compareTranscriptions } from "./compare";
import type { TimedNote } from "../music/timed";

const n = (note: number, start: number, duration: number): TimedNote => ({ note, start, duration });

describe("compareTranscriptions", () => {
  it("scores perfect recall and precision", () => {
    const notes = [n(60, 0, 0.5), n(64, 0.5, 0.5)];
    const metrics = compareTranscriptions(notes, notes.slice());
    expect(metrics.recall).toBe(1);
    expect(metrics.precision).toBe(1);
    expect(metrics.f1).toBe(1);
  });

  it("tolerates small timing drift", () => {
    const ref = [n(60, 1, 0.4)];
    const cand = [n(60, 1.05, 0.42)];
    const metrics = compareTranscriptions(ref, cand, { toleranceSec: 0.08 });
    expect(metrics.matchedReference).toBe(1);
    expect(metrics.startOffsetMedian).toBeCloseTo(0.05, 3);
  });
});
