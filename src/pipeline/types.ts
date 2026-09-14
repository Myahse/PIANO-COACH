import type { TimedNote } from "../music/timed";

/** How the source audio should be treated before transcription. */
export type AudioProfile = "solo_piano" | "full_song" | "unknown";

export type PipelineStage =
  | "preprocess"
  | "separation"
  | "transcribe"
  | "intelligence";

export type PipelineProgress = {
  stage: PipelineStage;
  pct: number;
  label: string;
};

export type AudioAnalysis = {
  profile: AudioProfile;
  durationSec: number;
  /** 0–1 rough vocal-band energy estimate when computed. */
  vocalPresence?: number;
  recommendation?: string;
};

export type RawMidiLayers = {
  voiceNotes: TimedNote[];
  instNotes: TimedNote[];
  engine: string;
};

export type IntelligentScore = {
  voiceNotes: TimedNote[];
  instNotes: TimedNote[];
  leftHandNotes: TimedNote[];
  rightHandNotes: TimedNote[];
  fullNotes: TimedNote[];
};

export type PipelineOptions = {
  /** MuScriptor target: piano stem, vocal stem, or both. */
  target?: "piano" | "vocals" | "both";
  /** Skip or force stem separation (when implemented). */
  enableSeparation?: boolean;
  /** Override auto-detected audio profile. */
  forceProfile?: AudioProfile;
  /** Light grid snap during MIDI intelligence. */
  quantize?: boolean;
  quantizeStep?: number;
  signal?: AbortSignal;
  engine?: "auto" | "muscriptor" | "basic-pitch";
};

export type PipelineResult = IntelligentScore & {
  engine: string;
  analysis: AudioAnalysis;
  separationApplied: boolean;
};
