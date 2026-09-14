import type { MidiEvent } from "./types";

export function parseMidiMessage(data: Uint8Array, timestamp: number): MidiEvent | null {
  if (data.length < 2) return null;

  const status = data[0] ?? 0;
  const command = status & 0xf0;
  const note = data[1] ?? 0;
  const velocity = data[2] ?? 0;

  if (command === 0x90) {
    return {
      type: velocity > 0 ? "noteon" : "noteoff",
      note,
      velocity,
      timestamp,
    };
  }

  if (command === 0x80) {
    return { type: "noteoff", note, velocity, timestamp };
  }

  if (command === 0xb0 && data.length >= 3) {
    return {
      type: "control",
      controller: note,
      value: velocity,
      timestamp,
    };
  }

  return null;
}
