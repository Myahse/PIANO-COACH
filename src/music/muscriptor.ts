import type { TimedNote } from "./timed";

export type TranscribeTarget = "piano" | "vocals" | "both";

export type MuScriptorResult = {
  voiceNotes: TimedNote[];
  instNotes: TimedNote[];
  engine: string;
};

export const MUSCRIPTOR_LABEL = "MuScriptor";

const HF_LICENSE_URL = "https://huggingface.co/MuScriptor/muscriptor-small";

export function formatTranscriptionError(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Transcription failed.";

  try {
    const json = JSON.parse(trimmed) as { error?: string; progress?: number };
    if (json.error) return formatTranscriptionError(json.error);
    if (typeof json.progress === "number") return "Transcription failed.";
  } catch {
    /* not a single JSON payload */
  }

  const message = trimmed
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t || t.startsWith("[muscriptor]")) return false;
      try {
        const o = JSON.parse(t) as { progress?: number };
        return typeof o.progress !== "number";
      } catch {
        return true;
      }
    })
    .join("\n")
    .trim();

  if (/gated|ModelDownloadError|403|cannot download.*HuggingFace/i.test(message)) {
    return (
      `MuScriptor model access required. Log in with hf auth login, then accept the license at ${HF_LICENSE_URL} and retry.`
    );
  }

  return message || "Transcription failed.";
}

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

let muscriptorAvailable: boolean | null = null;
let muscriptorDevice: "cpu" | "cuda" | null = null;

export function muScriptorDevice(): "cpu" | "cuda" | null {
  return muscriptorDevice;
}

export function resetMuScriptorProbe(): void {
  muscriptorAvailable = null;
}

export async function probeMuScriptor(): Promise<boolean> {
  if (muscriptorAvailable !== null) return muscriptorAvailable;
  try {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      muscriptorAvailable = await invoke<boolean>("muscriptor_available");
      return muscriptorAvailable;
    }
    const res = await fetch("/api/muscriptor/status");
    if (!res.ok) {
      muscriptorAvailable = false;
      return false;
    }
    const body = (await res.json()) as { available?: boolean; device?: string };
    muscriptorAvailable = Boolean(body.available);
    muscriptorDevice = body.device === "cuda" ? "cuda" : body.device === "cpu" ? "cpu" : null;
    return muscriptorAvailable;
  } catch {
    muscriptorAvailable = false;
    return false;
  }
}

export async function transcribeWithMuScriptor(
  file: File,
  target: TranscribeTarget,
  onProgress?: (pct: number, label?: string) => void,
): Promise<MuScriptorResult> {
  if (!(await probeMuScriptor())) {
    throw new Error("MuScriptor is not installed. Run scripts/setup-muscriptor.ps1");
  }

  let body: {
    engine?: string;
    voiceNotes?: TimedNote[];
    instNotes?: TimedNote[];
    error?: string;
  };

  try {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      const audio = new Uint8Array(await file.arrayBuffer());
      body = await invoke("transcribe_muscriptor", { audio, filename: file.name, target });
    } else {
      body = await fetchMuScriptorStream(file, target, onProgress);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(formatTranscriptionError(message));
  }

  if (body.error) throw new Error(formatTranscriptionError(body.error));

  onProgress?.(95, "Creating Score");
  const voiceNotes = body.voiceNotes ?? [];
  const instNotes = body.instNotes ?? [];
  if (!voiceNotes.length && !instNotes.length) throw new Error("No notes were found.");

  onProgress?.(100, "Done");
  return {
    voiceNotes,
    instNotes,
    engine: body.engine ?? "muscriptor",
  };
}

type MuScriptorBody = {
  engine?: string;
  voiceNotes?: TimedNote[];
  instNotes?: TimedNote[];
  error?: string;
};

async function fetchMuScriptorStream(
  file: File,
  target: TranscribeTarget,
  onProgress?: (pct: number, label?: string) => void,
): Promise<MuScriptorBody> {
  const res = await fetch(
    `/api/muscriptor?filename=${encodeURIComponent(file.name)}&target=${target}`,
    { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: await file.arrayBuffer() },
  );

  const contentType = res.headers.get("Content-Type") ?? "";
  if (!res.ok) {
    throw new Error(formatTranscriptionError((await res.text()) || "MuScriptor transcription failed"));
  }

  if (!contentType.includes("ndjson") || !res.body) {
    return (await res.json()) as MuScriptorBody;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let body: MuScriptorBody | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: MuScriptorBody & { progress?: number; label?: string };
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        continue;
      }
      if (msg.error) throw new Error(formatTranscriptionError(msg.error));
      if (typeof msg.progress === "number") {
        onProgress?.(msg.progress, msg.label);
        continue;
      }
      if (msg.engine || msg.voiceNotes || msg.instNotes) body = msg;
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const msg = JSON.parse(tail) as MuScriptorBody & { progress?: number; label?: string };
    if (typeof msg.progress === "number") onProgress?.(msg.progress, msg.label);
    else if (msg.error) throw new Error(formatTranscriptionError(msg.error));
    else if (msg.engine || msg.voiceNotes || msg.instNotes) body = msg;
  }

  if (!body) throw new Error("MuScriptor returned no transcription data.");
  return body;
}

export function normalizeTranscribeTarget(value: string): TranscribeTarget {
  if (value === "piano" || value === "vocals") return value;
  return "both";
}
