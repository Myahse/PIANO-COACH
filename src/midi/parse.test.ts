import { describe, expect, it } from "vitest";
import { parseMidiMessage } from "./parse";

describe("parseMidiMessage", () => {
  it("parses note on", () => {
    const event = parseMidiMessage(new Uint8Array([0x90, 60, 100]), 42);
    expect(event).toEqual({ type: "noteon", note: 60, velocity: 100, timestamp: 42 });
  });

  it("treats note on with zero velocity as note off", () => {
    const event = parseMidiMessage(new Uint8Array([0x90, 60, 0]), 1);
    expect(event).toEqual({ type: "noteoff", note: 60, velocity: 0, timestamp: 1 });
  });

  it("parses note off", () => {
    const event = parseMidiMessage(new Uint8Array([0x80, 48, 64]), 5);
    expect(event).toEqual({ type: "noteoff", note: 48, velocity: 64, timestamp: 5 });
  });

  it("parses control change", () => {
    const event = parseMidiMessage(new Uint8Array([0xb0, 7, 127]), 0);
    expect(event).toEqual({ type: "control", controller: 7, value: 127, timestamp: 0 });
  });

  it("returns null for short messages", () => {
    expect(parseMidiMessage(new Uint8Array([0x90]), 0)).toBeNull();
  });
});
