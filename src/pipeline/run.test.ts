import { describe, expect, it } from "vitest";
import { vocalSourceForDualPass, vocalSourceForTranscription } from "./run";

describe("vocal transcription sources", () => {
  const original = new File([new Uint8Array(8)], "song.mp3", { type: "audio/mpeg" });
  const demucsVocal = new File([new Uint8Array(4)], "vocals.wav", { type: "audio/wav" });
  const pianoStem = new File([new Uint8Array(4)], "piano.wav", { type: "audio/wav" });

  it("uses full mix for heuristic dual vocal pass", () => {
    expect(
      vocalSourceForDualPass(
        { file: pianoStem, applied: true, backend: "heuristic", vocalFile: demucsVocal },
        original,
      ),
    ).toBe(original);
  });

  it("uses Demucs vocal stem when available", () => {
    expect(
      vocalSourceForDualPass(
        { file: pianoStem, applied: true, backend: "demucs", vocalFile: demucsVocal },
        original,
      ),
    ).toBe(demucsVocal);
  });

  it("uses full mix for vocals-only target without Demucs", () => {
    expect(
      vocalSourceForTranscription(
        "vocals",
        { file: pianoStem, applied: true, backend: "heuristic", vocalFile: demucsVocal },
        original,
      ),
    ).toBe(original);
  });
});
