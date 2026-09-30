import { describe, expect, it } from "vitest";
import { extractResidualMelody } from "./melody";
import type { TimedNote } from "../music/timed";

const n = (note: number, start: number, duration: number): TimedNote => ({ note, start, duration, velocity: 80 });
const sungNote = (note: number, start: number, duration: number) => ({ ...n(note, start, duration), bendSpread: 0.6 });

const pianoChords: TimedNote[] = [];
for (let bar = 0; bar < 4; bar++) {
  for (const note of [48, 55, 64]) pianoChords.push(n(note, bar * 2, 1.9));
}

describe("extractResidualMelody", () => {
  it("returns nothing when every candidate is explained by the piano (solo piano)", () => {
    const candidates = [
      ...pianoChords.map((p) => ({ ...p, start: p.start + 0.02 })),
      // overtone/octave echoes a general transcriber reports
      ...pianoChords.map((p) => ({ ...p, note: p.note + 12, start: p.start + 0.03, duration: 0.5 })),
    ];
    expect(extractResidualMelody(candidates, pianoChords)).toEqual([]);
  });

  it("keeps a sung line that the piano model missed, as a single voice", () => {
    // 72 at 2.05 s sits two octaves above the piano's 48 attack — only vibrato tells it apart.
    const sung = [76, 74, 72, 74, 76, 76, 76, 74].map((note, i) => sungNote(note, 0.25 + i * 0.9, 0.8));
    const noise = sung.map((s) => ({ ...s, note: s.note - 5, duration: 0.3 })); // harmony under the line
    const melody = extractResidualMelody([...sung, ...noise], pianoChords);
    expect(melody.map((m) => m.note)).toEqual(sung.map((s) => s.note));
    for (let i = 1; i < melody.length; i++) {
      expect(melody[i]!.start).toBeGreaterThanOrEqual(melody[i - 1]!.start + melody[i - 1]!.duration - 1e-9);
    }
  });

  it("treats a steady octave above a piano attack as an overtone", () => {
    expect(extractResidualMelody([n(72, 2.03, 0.8), n(76, 2.9, 0.5)], pianoChords).map((m) => m.note)).not.toContain(72);
  });

  it("ignores a few stray leftovers on a solo-piano take", () => {
    const strays = [n(60, 2.1, 0.3), n(60, 2.5, 0.3), n(62, 3.1, 0.3)];
    expect(extractResidualMelody(strays, pianoChords)).toEqual([]);
  });

  it("drops isolated one-off blips", () => {
    const melody = extractResidualMelody([n(81, 3.3, 0.2), n(62, 9, 0.4)], pianoChords.slice(0, 3));
    expect(melody).toEqual([]);
  });
});
