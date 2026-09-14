import { formatTranscriptionError } from "../music/muscriptor";

const FRIENDLY: [RegExp, string][] = [
  [/AbortError|cancelled/i, "Transcription cancelled."],
  [/not installed|setup-muscriptor/i, "AI transcription is not set up yet. Open Settings → AI setup and follow the steps."],
  [/gated|403|huggingface|ModelDownloadError/i, "MuScriptor model access required. Accept the license on Hugging Face and sign in."],
  [/python|ENOENT|spawn/i, "Python transcription backend missing. Run the one-time setup from Settings → AI setup."],
  [/cuda|out of memory|OOM/i, "GPU ran out of memory — try a shorter clip or CPU mode."],
  [/too short/i, "That audio clip is too short to transcribe."],
  [/corrupt|decode|decodeAudioData/i, "Could not read that audio file. Try another export or format."],
  [/subprocess|exit code|code 1/i, "Transcription failed — try Standard quality or re-import the song."],
];

/** Map raw engine / subprocess errors to user-facing copy. */
export function friendlyTranscriptionError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Transcription cancelled.";
  }
  const raw = error instanceof Error ? error.message : String(error);
  const formatted = formatTranscriptionError(raw);
  for (const [pattern, message] of FRIENDLY) {
    if (pattern.test(formatted) || pattern.test(raw)) return message;
  }
  return formatted || "Transcription failed. Try again or use a different file.";
}
