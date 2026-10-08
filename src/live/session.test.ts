import { describe, expect, it } from "vitest";
import { LiveSession } from "./session";

describe("LiveSession.activeTilePitches", () => {
  it("keeps a long note held until it ends, not just at its attack", () => {
    const session = new LiveSession();
    session.load("Test", [
      { note: 48, start: 0, duration: 4 }, // whole-bar bass note
      { note: 64, start: 1, duration: 0.4 },
      { note: 67, start: 2, duration: 0.4 },
    ]);
    expect(session.activeTilePitches(0.02)).toEqual([48]);
    expect(session.activeTilePitches(1.1)).toEqual([48, 64]);
    expect(session.activeTilePitches(3.5)).toEqual([48]);
    expect(session.activeTilePitches(4.1)).toEqual([]);
  });
});
