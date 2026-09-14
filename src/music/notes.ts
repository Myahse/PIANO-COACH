export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const FIRST_MIDI = 21;
export const LAST_MIDI = 108;

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(midi: number): boolean {
  return BLACK_PCS.has(pc(midi));
}

export function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function noteName(midi: number): string {
  return NOTE_NAMES[pc(midi)] ?? "C";
}

export function octave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function noteLabel(midi: number): string {
  return `${noteName(midi)}${octave(midi)}`;
}

export function prettyName(midi: number): string {
  return noteName(midi).replace("#", "♯");
}

export function prettyChord(notes: number[]): string {
  return notes.map((note) => prettyLabel(note)).join(" + ");
}

export function prettyLabel(midi: number): string {
  return `${prettyName(midi)}${octave(midi)}`;
}

export function samePitchClass(a: number, b: number): boolean {
  return pc(a) === pc(b);
}

export function whiteKeyCountBefore(midi: number): number {
  let count = 0;
  for (let n = FIRST_MIDI; n < midi; n++) {
    if (!isBlackKey(n)) count += 1;
  }
  return count;
}

export function totalWhiteKeys(): number {
  return whiteKeyCountBefore(LAST_MIDI + 1);
}

export function clampNote(midi: number): number {
  return Math.min(LAST_MIDI, Math.max(FIRST_MIDI, midi));
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomWhiteNote(min: number, max: number): number {
  let note = randomInt(min, max);
  let guard = 0;
  while (isBlackKey(note) && guard < 24) {
    note = randomInt(min, max);
    guard += 1;
  }
  return note;
}
