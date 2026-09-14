import { describe, expect, it } from "vitest";
import { applyMidiIntelligence } from "./intelligence";
import { MELODY_FIXTURE, RAW_LAYER_FIXTURE } from "./fixtures/pipelineFixtures";

describe("applyMidiIntelligence", () => {
  it("cleans duplicate flutter and assigns hands", () => {
    const score = applyMidiIntelligence(RAW_LAYER_FIXTURE);
    expect(score.voiceNotes.length).toBeLessThan(RAW_LAYER_FIXTURE.voiceNotes.length);
    expect(score.instNotes.length).toBeLessThanOrEqual(RAW_LAYER_FIXTURE.instNotes.length);
    expect(score.leftHandNotes.length).toBeGreaterThan(0);
    expect(score.rightHandNotes.length).toBeGreaterThan(0);
    expect(score.fullNotes.length).toBeGreaterThan(0);
    const leftMax = Math.max(...score.leftHandNotes.map((n) => n.note));
    const rightMin = Math.min(...score.rightHandNotes.map((n) => n.note));
    expect(leftMax).toBeLessThanOrEqual(rightMin);
  });

  it("optionally quantizes note starts", () => {
    const raw = {
      engine: "fixture",
      voiceNotes: MELODY_FIXTURE,
      instNotes: [],
    };
    const score = applyMidiIntelligence(raw, { quantize: true, quantizeStep: 0.25 });
    const starts = score.voiceNotes.map((n) => n.start);
    for (const start of starts) {
      expect(Math.round(start * 4) / 4).toBeCloseTo(start, 5);
    }
  });

  it("preserves melody order after cleanup", () => {
    const raw = { engine: "fixture", voiceNotes: MELODY_FIXTURE, instNotes: [] };
    const score = applyMidiIntelligence(raw);
    const pitches = score.voiceNotes.map((n) => n.note);
    expect(pitches).toEqual([60, 64, 67, 72]);
  });
});
