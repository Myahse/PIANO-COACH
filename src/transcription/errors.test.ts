import { describe, expect, it } from "vitest";
import { friendlyTranscriptionError } from "./errors";

describe("friendlyTranscriptionError", () => {
  it("maps abort to cancellation copy", () => {
    expect(friendlyTranscriptionError(new DOMException("aborted", "AbortError"))).toMatch(/cancelled/i);
  });

  it("maps Hugging Face errors to setup guidance", () => {
    expect(friendlyTranscriptionError(new Error("403 gated repo on huggingface"))).toMatch(/Hugging Face/i);
  });

  it("maps python spawn failures", () => {
    expect(friendlyTranscriptionError(new Error("spawn python ENOENT"))).toMatch(/Python/i);
  });
});
