export type ScaleDef = {
  id: string;
  name: string;
  intervals: number[];
};

export const SCALES: ScaleDef[] = [
  { id: "major", name: "Major", intervals: [0, 2, 4, 5, 7, 9, 11, 12] },
  { id: "natural-minor", name: "Natural minor", intervals: [0, 2, 3, 5, 7, 8, 10, 12] },
  { id: "pentatonic", name: "Major pentatonic", intervals: [0, 2, 4, 7, 9, 12] },
  { id: "blues", name: "Blues", intervals: [0, 3, 5, 6, 7, 10, 12] },
  { id: "chromatic", name: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
];

export const SCALE_ROOTS = [
  { name: "C", midi: 60 },
  { name: "G", midi: 67 },
  { name: "D", midi: 62 },
  { name: "A", midi: 69 },
  { name: "F", midi: 65 },
  { name: "A minor", midi: 57 },
  { name: "E minor", midi: 64 },
];

export function buildScale(root: number, intervals: number[], descend = true): number[] {
  const up = intervals.map((interval) => root + interval);
  if (!descend) return up;
  const down = [...up].reverse().slice(1);
  return [...up, ...down];
}
