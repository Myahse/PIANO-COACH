import { describe, expect, it } from "vitest";
import { accidentalForKey, beatGridMarkup, interpretForNotation, notationHeaderMarkup } from "./interpret";
import { resolveSongKey } from "../music/keys";
import type { TimedNote } from "../music/timed";

const n = (note: number, start: number, duration: number): TimedNote => ({ note, start, duration });

describe("interpretForNotation", () => {
  it("quantizes starts and groups chord tones", () => {
    const notes = [n(60, 0.01, 0.48), n(64, 0.02, 0.46), n(67, 0.03, 0.44)];
    const score = interpretForNotation(notes);
    expect(score.events.length).toBeLessThanOrEqual(2);
    expect(score.bpm).toBeGreaterThan(40);
    expect(score.measureBeats).toBe(4);
    const first = score.events[0];
    expect(first?.midi.length).toBeGreaterThanOrEqual(2);
  });

  it("assigns measure indices monotonically", () => {
    const notes = Array.from({ length: 16 }, (_, i) => n(60 + (i % 3) * 2, i * 0.45, 0.4));
    const score = interpretForNotation(notes);
    const measures = score.events.map((e) => e.measure);
    for (let i = 1; i < measures.length; i++) {
      expect(measures[i]!).toBeGreaterThanOrEqual(measures[i - 1]!);
    }
  });
});

describe("notationHeaderMarkup", () => {
  it("includes key label and tempo before staff content", () => {
    const notes = [n(60, 0, 0.5), n(64, 0.5, 0.5)];
    const interpreted = interpretForNotation(notes);
    const markup = notationHeaderMarkup(interpreted, 72, 13);
    expect(markup).toContain(interpreted.key.label);
    expect(markup).toContain(`♩ = ${interpreted.bpm}`);
  });
});

describe("beatGridMarkup", () => {
  it("draws beat lines when beat index changes within a measure", () => {
    const notes = [n(60, 0, 0.45), n(64, 0.55, 0.45), n(67, 1.05, 0.45)];
    const interpreted = interpretForNotation(notes);
    const xs = [72, 110, 150];
    const grid = beatGridMarkup(interpreted.events, xs, 72, 168, 13);
    expect(grid).toContain("beat-grid");
  });
});

describe("accidentalForKey", () => {
  it("prefers flats in flat keys for black keys", () => {
    const key = resolveSongKey([n(62, 0, 1), n(65, 0.5, 1), n(69, 1, 1)], { tonic: 5, mode: "major" });
    const acc = accidentalForKey(66, key);
    expect(acc === "♭" || acc === null).toBe(true);
  });
});
