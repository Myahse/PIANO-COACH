export type SongDef = {
  id: string;
  title: string;
  level: "start" | "easy" | "next";
  notes: number[];
  beats: number[];
  bpm: number;
};

const C4 = 60;
const D4 = 62;
const E4 = 64;
const F4 = 65;
const G4 = 67;
const A4 = 69;
const C5 = 72;

export const SONGS: SongDef[] = [
  {
    id: "ode",
    title: "Ode to Joy",
    level: "start",
    bpm: 96,
    notes: [E4, E4, F4, G4, G4, F4, E4, D4, C4, C4, D4, E4, E4, D4, D4],
    beats: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 2],
  },
  {
    id: "twinkle",
    title: "Twinkle Twinkle",
    level: "start",
    bpm: 100,
    notes: [C4, C4, G4, G4, A4, A4, G4, F4, F4, E4, E4, D4, D4, C4],
    beats: [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2],
  },
  {
    id: "mary",
    title: "Mary Had a Little Lamb",
    level: "easy",
    bpm: 108,
    notes: [E4, D4, C4, D4, E4, E4, E4, D4, D4, D4, E4, G4, G4],
    beats: [1, 1, 1, 1, 1, 1, 2, 1, 1, 2, 1, 1, 2],
  },
  {
    id: "hot-cross",
    title: "Hot Cross Buns",
    level: "start",
    bpm: 100,
    notes: [E4, D4, C4, E4, D4, C4, C4, C4, C4, C4, D4, D4, D4, D4, E4, D4, C4],
    beats: [1, 1, 2, 1, 1, 2, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 2],
  },
  {
    id: "london",
    title: "London Bridge",
    level: "easy",
    bpm: 104,
    notes: [G4, A4, G4, F4, E4, F4, G4, D4, E4, F4, E4, F4, G4],
    beats: [1, 1, 1, 1, 1, 1, 2, 1, 1, 2, 1, 1, 2],
  },
  {
    id: "jingle",
    title: "Jingle Bells",
    level: "next",
    bpm: 132,
    notes: [E4, E4, E4, E4, E4, E4, E4, G4, C4, D4, E4, F4, F4, F4, F4, F4, E4, E4, E4, E4, D4, D4, E4, D4, G4],
    beats: [1, 1, 2, 1, 1, 2, 1, 1, 1, 1, 4, 1, 1, 1, 0.5, 0.5, 1, 1, 0.5, 0.5, 1, 1, 1, 2, 2],
  },
  {
    id: "happy",
    title: "Happy Birthday",
    level: "next",
    bpm: 96,
    notes: [C4, C4, D4, C4, F4, E4, C4, C4, D4, C4, G4, F4, C4, C4, C5, A4, F4, E4, D4, A4, A4, A4, F4, G4, F4],
    beats: [0.75, 0.25, 1, 1, 1, 2, 0.75, 0.25, 1, 1, 1, 2, 0.75, 0.25, 1, 1, 1, 1, 2, 0.75, 0.25, 1, 1, 1, 2],
  },
];
