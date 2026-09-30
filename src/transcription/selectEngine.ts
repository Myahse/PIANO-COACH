import { basicPitchEngine } from "./engines/basicPitchEngine";
import { muscriptorEngine } from "./engines/muscriptorEngine";
import { transkunEngine } from "./engines/transkunEngine";
import type { TranscriptionEngine } from "./types";
import type { TranscribeTarget } from "../music/muscriptor";

export type EnginePreference = "auto" | "muscriptor" | "transkun" | "basic-pitch";

const ENGINES: TranscriptionEngine[] = [muscriptorEngine, transkunEngine, basicPitchEngine];

export function listTranscriptionEngines(): TranscriptionEngine[] {
  return ENGINES;
}

/**
 * Pick engine: MuScriptor on desktop when available, else Transkun V2 (browser piano model)
 * for piano targets, else Basic Pitch. Vocal-only targets skip Transkun (piano-only model).
 */
export async function selectTranscriptionEngine(
  preference: EnginePreference = "auto",
  target: TranscribeTarget = "both",
): Promise<TranscriptionEngine> {
  if (preference === "basic-pitch") return basicPitchEngine;
  if (preference === "transkun") return transkunEngine;
  if (preference === "muscriptor") {
    if (await muscriptorEngine.isAvailable()) return muscriptorEngine;
    throw new Error("MuScriptor is not installed. Complete AI setup in Settings first.");
  }
  if (await muscriptorEngine.isAvailable()) return muscriptorEngine;
  if (target !== "vocals" && (await transkunEngine.isAvailable())) return transkunEngine;
  return basicPitchEngine;
}
