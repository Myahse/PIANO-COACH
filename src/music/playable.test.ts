import { describe, expect, it } from "vitest";
import { makePlayable, twoHandsCanHold } from "./playable";
import type { TimedNote } from "./timed";

const n = (note: number, start: number, duration: number): TimedNote => ({ note, start, duration, velocity: 80 });

/** At every note start, the keys held then must fit in two hands. */
function expectPlayable(notes: TimedNote[]): void {
  for (const t of new Set(notes.map((x) => x.start))) {
    const held = notes.filter((x) => x.start <= t + 1e-6 && x.start + x.duration > t + 1e-6).map((x) => x.note);
    expect(twoHandsCanHold(held), `keys ${held.join(",")} at ${t}s`).toBe(true);
  }
}

describe("makePlayable", () => {
  it("leaves an already playable passage untouched", () => {
    const input = [n(48, 0, 2), n(55, 0, 2), n(64, 0, 0.5), n(62, 0.5, 0.5), n(60, 1, 1)];
    expect(makePlayable(input)).toEqual(input);
  });

  it("releases pedalled arpeggio notes when the hand moves on, keeping every note", () => {
    // C2 G2 C3 E3 G3 C4 E4 G4 C5, each ringing to the end (pedal).
    const arp = [36, 43, 48, 52, 55, 60, 64, 67, 72].map((note, i) => n(note, i * 0.25, 3 - i * 0.25));
    const out = makePlayable(arp);
    expect(out.map((x) => x.note)).toEqual(arp.map((x) => x.note));
    expectPlayable(out);
    expect(out.at(-1)!.duration).toBeCloseTo(1, 5); // the last note still rings to the end
  });

  it("thins a chord no two hands can reach, keeping bass and melody", () => {
    const chord = [24, 36, 43, 48, 52, 55, 60, 64, 67, 72, 84].map((note) => n(note, 0, 1));
    const out = makePlayable(chord);
    expectPlayable(out);
    expect(out.map((x) => x.note)).toContain(24);
    expect(out.map((x) => x.note)).toContain(84);
    expect(out.length).toBeLessThan(chord.length);
  });

  it("keeps a held bass while the melody moves above it", () => {
    const out = makePlayable([n(36, 0, 4), n(72, 0, 0.5), n(74, 1, 0.5), n(76, 2, 0.5)]);
    expect(out.find((x) => x.note === 36)!.duration).toBe(4);
  });

  it("folds a bass that would have to jump too far, too fast, an octave toward the hand", () => {
    // Left hand on C3, then a low C1 a fifth of a second later: the bass is played as C2.
    const out = makePlayable([n(48, 0, 0.2), n(72, 0, 0.2), n(24, 0.2, 0.2), n(74, 0.2, 0.2)]);
    expect(out.map((x) => x.note)).toEqual([48, 72, 36, 74]);
  });

  it("never moves the melody, however far it leaps", () => {
    const out = makePlayable([n(60, 0, 0.2), n(96, 0.2, 0.2)]);
    expect(out.map((x) => x.note)).toEqual([60, 96]);
  });

  it("drops a lone blip far from everything else", () => {
    const out = makePlayable([n(60, 0, 1), n(64, 1, 1), n(100, 1.5, 0.06), n(62, 2, 1)]);
    expect(out.map((x) => x.note)).toEqual([60, 64, 62]);
  });
});
