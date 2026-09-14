import { clampBeforeReattack, type TimedNote } from "./timed";

/** Shorten a note only when the same pitch is genuinely re-struck later. Never split long sustains. */
export function refineNoteDurations(notes: TimedNote[]): TimedNote[] {
  if (notes.length === 0) return [];
  return clampBeforeReattack(notes);
}
