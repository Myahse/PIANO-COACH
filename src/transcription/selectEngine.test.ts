import { beforeEach, describe, expect, it, vi } from "vitest";

const muscriptorAvailable = vi.fn(async () => false);
const transkunTranscribe = vi.fn();
const basicPitchNotes = [{ note: 60, start: 0, duration: 0.5, velocity: 80 }];

vi.mock("../music/muscriptor", () => ({
  probeMuScriptor: () => muscriptorAvailable(),
  transcribeWithMuScriptor: vi.fn(),
}));
vi.mock("../music/transkunEngine", () => ({
  transcribeWithTranskun: (...args: unknown[]) => transkunTranscribe(...args),
}));
vi.mock("../bench/basicPitchOnly", () => ({
  runBasicPitchPath: async () => basicPitchNotes,
}));

const { selectTranscriptionEngine } = await import("./selectEngine");
const { transcribeToRawMidi } = await import("../pipeline/transcribeStage");

const input = { file: new File([], "x.wav"), buffer: {} as AudioBuffer };

describe("selectTranscriptionEngine", () => {
  beforeEach(() => {
    muscriptorAvailable.mockResolvedValue(false);
    transkunTranscribe.mockReset();
  });

  it("prefers MuScriptor when installed", async () => {
    muscriptorAvailable.mockResolvedValue(true);
    expect((await selectTranscriptionEngine("auto")).id).toBe("muscriptor");
  });

  it("uses the Transkun piano model in the browser", async () => {
    expect((await selectTranscriptionEngine("auto", "both")).id).toBe("transkun");
  });

  it("skips the piano-only model for vocal targets", async () => {
    expect((await selectTranscriptionEngine("auto", "vocals")).id).toBe("basic-pitch");
  });
});

describe("transcribeToRawMidi", () => {
  beforeEach(() => {
    muscriptorAvailable.mockResolvedValue(false);
    transkunTranscribe.mockReset();
  });

  it("returns Transkun notes on the piano layer only", async () => {
    transkunTranscribe.mockResolvedValue(basicPitchNotes);
    const raw = await transcribeToRawMidi(input.file, input.buffer, "both");
    expect(raw.engine).toBe("transkun-v2");
    expect(raw.instNotes).toHaveLength(1);
    expect(raw.voiceNotes).toHaveLength(0);
  });

  it("falls back to Basic Pitch without doubling notes", async () => {
    transkunTranscribe.mockRejectedValue(new Error("model failed to load"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = await transcribeToRawMidi(input.file, input.buffer, "both");
    warn.mockRestore();
    expect(raw.engine).toBe("basic-pitch");
    expect(raw.instNotes.length + raw.voiceNotes.length).toBe(1);
  });
});
