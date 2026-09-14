import { describe, expect, it, vi } from "vitest";
import { separatePianoStem } from "./separation";
import * as stemBackend from "./stemBackend";

function mockBuffer(): AudioBuffer {
  const mono = new Float32Array(44100);
  return {
    length: mono.length,
    duration: 1,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => mono,
  } as unknown as AudioBuffer;
}

describe("separatePianoStem", () => {
  it("skips separation for solo_piano profile", async () => {
    const file = new File([new Uint8Array(8)], "solo.wav", { type: "audio/wav" });
    const result = await separatePianoStem(file, mockBuffer(), {
      profile: "solo_piano",
      durationSec: 1,
    });
    expect(result.applied).toBe(false);
    expect(result.file).toBe(file);
  });

  it("uses stem backend for full_song profile", async () => {
    const stemFile = new File([new Uint8Array([1, 2, 3])], "stem.wav", { type: "audio/wav" });
    vi.spyOn(stemBackend, "separateAudioStems").mockResolvedValue({
      backend: "demucs",
      instruments: new Float32Array(0),
      sampleRate: 44100,
      stemFile,
    });

    const file = new File([new Uint8Array(8)], "mix.mp3", { type: "audio/mpeg" });
    const result = await separatePianoStem(file, mockBuffer(), {
      profile: "full_song",
      durationSec: 120,
    });

    expect(result.applied).toBe(true);
    expect(result.backend).toBe("demucs");
    expect(result.file).toBe(stemFile);
    vi.restoreAllMocks();
  });

  it("propagates abort during separation", async () => {
    const controller = new AbortController();
    controller.abort();
    const file = new File([new Uint8Array(8)], "mix.mp3", { type: "audio/mpeg" });
    await expect(
      separatePianoStem(
        file,
        mockBuffer(),
        { profile: "full_song", durationSec: 1 },
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
