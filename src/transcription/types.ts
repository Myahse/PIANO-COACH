import type { TimedNote } from "../music/timed";
import type { TranscribeTarget } from "../music/muscriptor";

export type EngineCapabilities = {
  polyphonic: boolean;
  piano: boolean;
  stems: boolean;
  velocity: boolean;
  pedal: boolean;
  desktopOnly: boolean;
};

export type TranscriptionInput = {
  file: File;
  buffer: AudioBuffer;
};

export type TranscriptionOptions = {
  target: TranscribeTarget;
  signal?: AbortSignal;
  onProgress?: (pct: number, label?: string) => void;
};

export type TranscriptionOutput = {
  voiceNotes: TimedNote[];
  instNotes: TimedNote[];
  engine: string;
};

export interface TranscriptionEngine {
  readonly id: string;
  readonly name: string;
  readonly capabilities: EngineCapabilities;
  isAvailable(): Promise<boolean>;
  transcribe(input: TranscriptionInput, options: TranscriptionOptions): Promise<TranscriptionOutput>;
}
