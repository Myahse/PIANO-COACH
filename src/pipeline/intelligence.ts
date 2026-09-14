import { prepareMelodyNotes, preparePianoNotes, quantizeNotes } from "../music/cleanup";
import { splitHands } from "../music/handSplit";
import type { TimedNote } from "../music/timed";
import type { IntelligentScore, RawMidiLayers } from "./types";

export type IntelligenceOptions = {
  quantize?: boolean;
  quantizeStep?: number;
};

function sortNotes(notes: TimedNote[]): TimedNote[] {
  return [...notes].sort((a, b) => a.start - b.start || a.note - b.note);
}

/**
 * Stage 4 — MIDI intelligence: cleanup, timing, hands, optional quantization.
 * Pedal reconstruction and chord clustering hooks live here as they are added.
 */
export function applyMidiIntelligence(
  raw: RawMidiLayers,
  opts: IntelligenceOptions = {},
): IntelligentScore {
  let voiceNotes = prepareMelodyNotes(sortNotes(raw.voiceNotes));
  let instNotes = preparePianoNotes(sortNotes(raw.instNotes));

  if (opts.quantize) {
    const step = opts.quantizeStep ?? 0.02;
    voiceNotes = quantizeNotes(voiceNotes, step);
    instNotes = quantizeNotes(instNotes, step);
  }

  const { left, right } = splitHands(instNotes);
  const fullNotes = sortNotes([...instNotes, ...voiceNotes]);

  return {
    voiceNotes,
    instNotes,
    leftHandNotes: left,
    rightHandNotes: right,
    fullNotes,
  };
}
