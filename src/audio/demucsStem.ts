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

export type DemucsStems = {
  instruments: File;
  vocal: File;
};

/** Run Demucs two-stem split via desktop Python. Returns vocal + backing WAV files. */
export async function separateWithDemucs(
  audio: ArrayBuffer,
  filename: string,
  signal?: AbortSignal,
): Promise<DemucsStems | null> {
  if (signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
  if (!(await demucsAvailable())) return null;

  const { invoke } = await import("@tauri-apps/api/core");
  const result = await invoke<{ instruments: number[]; vocal: number[] }>("separate_stems", {
    audio: Array.from(new Uint8Array(audio)),
    filename,
  });
  if (signal?.aborted) throw new DOMException("Transcription cancelled.", "AbortError");
  if (!result?.instruments?.length || !result?.vocal?.length) return null;

  const safe = filename.replace(/\.[^.]+$/, "") || "stem";
  return {
    instruments: new File([new Uint8Array(result.instruments)], `${safe}-backing.wav`, {
      type: "audio/wav",
    }),
    vocal: new File([new Uint8Array(result.vocal)], `${safe}-vocals.wav`, { type: "audio/wav" }),
  };
}
