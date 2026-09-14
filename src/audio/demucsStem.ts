const DESKTOP =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

let demucsProbe: boolean | null = null;

export async function demucsAvailable(): Promise<boolean> {
  if (!DESKTOP) return false;
  if (demucsProbe !== null) return demucsProbe;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    demucsProbe = await invoke<boolean>("demucs_available");
  } catch {
    demucsProbe = false;
  }
  return demucsProbe;
}

export function resetDemucsProbe(): void {
  demucsProbe = null;
}

/** Run Demucs two-stem split via desktop Python. Returns instrument stem WAV bytes. */
export async function separateWithDemucs(
  audio: ArrayBuffer,
  filename: string,
  signal?: AbortSignal,
): Promise<File | null> {
  if (signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
  if (!(await demucsAvailable())) return null;

  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke<number[]>("separate_stems", {
    audio: Array.from(new Uint8Array(audio)),
    filename,
  });
  if (signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
  if (!bytes?.length) return null;

  const safe = filename.replace(/\.[^.]+$/, "") || "stem";
  return new File([new Uint8Array(bytes)], `${safe}-piano-stem.wav`, { type: "audio/wav" });
}
