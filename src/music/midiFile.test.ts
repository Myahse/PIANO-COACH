import { describe, expect, it } from "vitest";
import { parseMidi, writeMidi } from "./midiFile";
import type { TimedNote } from "./timed";

describe("parseMidi / writeMidi", () => {
  it("round-trips a simple melody", () => {
    const source: TimedNote[] = [
      { note: 60, start: 0, duration: 0.5, velocity: 90 },
      { note: 64, start: 0.5, duration: 0.5, velocity: 80 },
      { note: 67, start: 1, duration: 0.75, velocity: 85 },
    ];
    const buffer = writeMidi(source, "Test Song");
    const parsed = parseMidi(buffer);
    expect(parsed.title).toBe("Test Song");
    expect(parsed.notes).toHaveLength(3);
    expect(parsed.notes.map((n) => n.note)).toEqual([60, 64, 67]);
    for (let i = 0; i < source.length; i++) {
      expect(parsed.notes[i]!.start).toBeCloseTo(source[i]!.start, 2);
      expect(parsed.notes[i]!.duration).toBeCloseTo(source[i]!.duration, 2);
    }
  });

  it("rejects non-MIDI buffers", () => {
    expect(() => parseMidi(new ArrayBuffer(8))).toThrow(/not a MIDI file/i);
  });
});
