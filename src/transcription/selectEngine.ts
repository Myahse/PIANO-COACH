import { basicPitchEngine } from "./engines/basicPitchEngine";
import { muscriptorEngine } from "./engines/muscriptorEngine";
import type { TranscriptionEngine } from "./types";

export type EnginePreference = "auto" | "muscriptor" | "basic-pitch";

const ENGINES: TranscriptionEngine[] = [muscriptorEngine, basicPitchEngine];

export function listTranscriptionEngines(): TranscriptionEngine[] {
  return ENGINES;
}

/** Pick engine: MuScriptor on desktop when available, else Basic Pitch. */
export async function selectTranscriptionEngine(
  preference: EnginePreference = "auto",
): Promise<TranscriptionEngine> {
  if (preference === "basic-pitch") return basicPitchEngine;
  if (preference === "muscriptor") {
    if (await muscriptorEngine.isAvailable()) return muscriptorEngine;
    throw new Error("MuScriptor is not installed. Complete AI setup in Settings first.");
  }
  if (await muscriptorEngine.isAvailable()) return muscriptorEngine;
  return basicPitchEngine;
}
