import type { TimedNote } from "../../music/timed";
import type { RawMidiLayers } from "../types";

const n = (note: number, start: number, duration: number, velocity = 80): TimedNote => ({
  note,
  start,
  duration,
  velocity,
});

/** Noisy vocal + piano layers for intelligence-stage tests. */
export const RAW_LAYER_FIXTURE: RawMidiLayers = {
  engine: "fixture",
  voiceNotes: [
    n(64, 0, 0.45),
    n(64, 0.02, 0.04, 40),
    n(67, 0.5, 0.4),
    n(69, 1.0, 0.35),
  ],
  instNotes: [
    n(48, 0, 0.9, 70),
    n(55, 0, 0.85, 65),
    n(60, 0.5, 0.5, 75),
    n(48, 0.51, 0.03, 30),
    n(36, 1.0, 0.8, 80),
    n(43, 1.0, 0.75, 75),
  ],
};

/** C-major arpeggio for notation / round-trip fixtures. */
export const MELODY_FIXTURE: TimedNote[] = [
  n(60, 0, 0.5),
  n(64, 0.5, 0.5),
  n(67, 1.0, 0.5),
  n(72, 1.5, 0.75),
];
