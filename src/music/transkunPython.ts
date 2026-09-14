import { parseMidi } from "./midiFile";
import type { TimedNote } from "./timed";

export const TRANSKUN_PYTHON_LABEL = "Transkun V2 Python";

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

let pythonAvailable: boolean | null = null;

export async function probePythonTranskun(): Promise<boolean> {
  if (pythonAvailable !== null) return pythonAvailable;
  try {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      pythonAvailable = await invoke<boolean>("transkun_available");
      return pythonAvailable;
    }
    const res = await fetch("/api/transkun/status");
    if (!res.ok) {
      pythonAvailable = false;
      return false;
    }
    const body = (await res.json()) as { available?: boolean };
    pythonAvailable = Boolean(body.available);
    return pythonAvailable;
  } catch {
    pythonAvailable = false;
    return false;
  }
}

export async function transcribeFileWithPython(
  file: File,
  onProgress?: (pct: number, label?: string) => void,
): Promise<TimedNote[]> {
  onProgress?.(10, "Detecting Notes · Transkun…");
  onProgress?.(18, "Detecting Notes · may take a few minutes on CPU…");

  let midBuffer: ArrayBuffer;

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const audio = new Uint8Array(await file.arrayBuffer());
    const bytes = await invoke<number[]>("transkun_convert", { audio, filename: file.name });
    midBuffer = new Uint8Array(bytes).buffer;
  } else {
    const res = await fetch(`/api/transkun?filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: await file.arrayBuffer(),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || `${TRANSKUN_PYTHON_LABEL} failed`);
    }
    midBuffer = await res.arrayBuffer();
  }

  onProgress?.(92, "Creating Score · loading notes…");
  const parsed = parseMidi(midBuffer);
  if (parsed.notes.length < 1) throw new Error("No notes were found.");
  onProgress?.(100, "Done");
  return parsed.notes;
}
