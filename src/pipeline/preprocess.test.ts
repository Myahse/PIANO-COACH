import { describe, expect, it } from "vitest";
import { analyzeAudio } from "./preprocess";

function mockAudioBuffer(mono: Float32Array, sampleRate = 44100): AudioBuffer {
  return {
    length: mono.length,
    duration: mono.length / sampleRate,
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => mono,
  } as unknown as AudioBuffer;
}

function sineBuffer(seconds: number, freq: number, sampleRate = 44100): Float32Array {
  const length = Math.floor(seconds * sampleRate);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.35;
  }
  return out;
}

describe("analyzeAudio", () => {
  it("honors forced solo_piano profile", async () => {
    const buffer = mockAudioBuffer(sineBuffer(2, 440));
    const analysis = await analyzeAudio(buffer, "solo_piano");
    expect(analysis.profile).toBe("solo_piano");
    expect(analysis.durationSec).toBeCloseTo(2, 1);
    expect(analysis.recommendation).toMatch(/solo piano/i);
  });

  it("honors forced full_song profile", async () => {
    const buffer = mockAudioBuffer(sineBuffer(2, 880));
    const analysis = await analyzeAudio(buffer, "full_song");
    expect(analysis.profile).toBe("full_song");
    expect(analysis.recommendation).toMatch(/stem isolation/i);
  });

  it("returns vocal presence between 0 and 1", async () => {
    const buffer = mockAudioBuffer(sineBuffer(1.5, 660));
    const analysis = await analyzeAudio(buffer);
    expect(analysis.vocalPresence).toBeGreaterThanOrEqual(0);
    expect(analysis.vocalPresence).toBeLessThanOrEqual(1);
  });
});
