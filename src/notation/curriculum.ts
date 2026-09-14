import { SONGS } from "../music/songs";
import type { Clef } from "./staff";

export type ReadingLevel = {
  id: string;
  unit: string;
  title: string;
  skill: string;
  teach: string;
  kind: "find" | "sequence";
  notes: number[];
  goal?: number;
  showHint: boolean;
  showName: boolean;
  clef: Clef;
  course?: string[];
};

const C4 = 60;
const D4 = 62;
const E4 = 64;
const F4 = 65;
const G4 = 67;
const A4 = 69;
const B4 = 71;
const C5 = 72;
const D5 = 74;
const E5 = 76;
const F5 = 77;

function song(id: string): number[] {
  return [...(SONGS.find((item) => item.id === id)?.notes ?? [])];
}

export const READING_LEVELS: ReadingLevel[] = [
  {
    id: "staff-bottom",
    unit: "The treble staff",
    title: "The bottom line",
    skill: "The lowest staff line is E",
    teach: "The five lines are a ladder. The bottom line is E4 — the E above Middle C. The G clef is a fancy G that wraps around the G line.",
    course: [
      "Reading starts with one staff: five lines and four spaces. The right hand usually reads the G clef, also called the treble staff.",
      "The G clef is a decorated G. It wraps around the second line from the bottom, and that line is always G. The bottom line, the one you will play now, is E — the E above Middle C.",
      "Technique: look at the staff first, then drop the finger. The glowing key is only there while you learn the landmark.",
    ],
    kind: "find",
    notes: [E4],
    goal: 6,
    showHint: true,
    showName: true,
    clef: "treble",
  },
  {
    id: "staff-g-line",
    unit: "The treble staff",
    title: "The G line",
    skill: "Second line from the bottom is G",
    teach: "The G clef circles the second line. That line is always G4. If you can find G, you can count up or down the ladder.",
    course: [
      "Every clef gives you one free landmark. On the treble staff that landmark is G4, the second line.",
      "From G you can step: one space up is A, one space down is F. You do not need to memorize the whole staff on day one — count from G or from Middle C.",
    ],
    kind: "find",
    notes: [G4],
    goal: 6,
    showHint: true,
    showName: true,
    clef: "treble",
  },
  {
    id: "staff-middle-c",
    unit: "The treble staff",
    title: "Middle C on a ledger",
    skill: "C4 sits on a little line under the staff",
    teach: "When a note is too low for the five lines, we draw a short ledger line. Middle C lives on the first ledger below the treble staff.",
    course: [
      "Middle C is the bridge between the two staves. On the treble staff it does not fit on the five lines, so we draw a short extra line — a ledger — and sit C on it.",
      "That is the same Middle C the right-hand thumb used in the technique course. The page and the keyboard are one map.",
    ],
    kind: "find",
    notes: [C4],
    goal: 6,
    showHint: true,
    showName: true,
    clef: "treble",
  },
  {
    id: "staff-spaces",
    unit: "The treble staff",
    title: "Spaces: F A C E",
    skill: "The four spaces spell FACE",
    teach: "From the bottom space up: F, A, C, E. A face in the spaces. Play the note sitting in a space.",
    kind: "find",
    notes: [F4, A4, C5, E5],
    goal: 10,
    showHint: true,
    showName: true,
    clef: "treble",
  },
  {
    id: "staff-lines",
    unit: "The treble staff",
    title: "Lines: E G B D F",
    skill: "Every Good Boy Does Fine",
    teach: "Bottom to top: E, G, B, D, F. The lines skip a letter each time. The top line is F5.",
    kind: "find",
    notes: [E4, G4, B4, D5, F5],
    goal: 10,
    showHint: true,
    showName: true,
    clef: "treble",
  },
  {
    id: "staff-mix-hint",
    unit: "Read and play",
    title: "Mix with a glowing key",
    skill: "Read the staff, check the keyboard",
    teach: "The staff tells you the note. The glowing key is only a safety net. Try to decide before you look down.",
    kind: "find",
    notes: [C4, D4, E4, F4, G4, A4],
    goal: 10,
    showHint: true,
    showName: false,
    clef: "treble",
  },
  {
    id: "staff-mix-name",
    unit: "Read and play",
    title: "Staff plus the letter",
    skill: "Match the written note to its name",
    teach: "No glow this time. Use the staff first, then confirm with the letter under it.",
    kind: "find",
    notes: [C4, D4, E4, F4, G4, A4, B4, C5],
    goal: 10,
    showHint: false,
    showName: true,
    clef: "treble",
  },
  {
    id: "staff-true-read",
    unit: "Read and play",
    title: "True reading",
    skill: "Name the note from the staff alone",
    teach: "No letter, no glow. Count from G or from Middle C. Lines and spaces alternate: E F G A B C D E F.",
    kind: "find",
    notes: [C4, D4, E4, F4, G4, A4, B4, C5],
    goal: 12,
    showHint: false,
    showName: false,
    clef: "treble",
  },
  {
    id: "staff-walk",
    unit: "Phrases on the page",
    title: "A walk on the staff",
    skill: "Read a line of neighboring notes",
    teach: "Notes moving to the next line or space are steps. Play them in order, left to right.",
    kind: "sequence",
    notes: [C4, D4, E4, F4, G4, F4, E4, D4, C4],
    showHint: true,
    showName: false,
    clef: "treble",
  },
  {
    id: "staff-hot-cross",
    unit: "Phrases on the page",
    title: "Hot Cross Buns on the staff",
    skill: "Read a tune you already can play",
    teach: "You know this melody by ear. Now follow it on the staff. The first three notes walk down: E D C.",
    kind: "sequence",
    notes: song("hot-cross"),
    showHint: true,
    showName: false,
    clef: "treble",
  },
  {
    id: "staff-mary",
    unit: "Phrases on the page",
    title: "Mary on the staff",
    skill: "Read a familiar song",
    teach: "Same rules: left to right, one note at a time. Repeated heads mean play the same key again.",
    kind: "sequence",
    notes: song("mary"),
    showHint: false,
    showName: false,
    clef: "treble",
  },
  {
    id: "staff-ode",
    unit: "Phrases on the page",
    title: "Ode to Joy on the staff",
    skill: "A longer written melody",
    teach: "It starts on the bottom line, E, not on Middle C. Watch for the walk up to G and back.",
    kind: "sequence",
    notes: song("ode"),
    showHint: false,
    showName: false,
    clef: "treble",
  },
  {
    id: "bass-c",
    unit: "The bass staff",
    title: "Bass C",
    skill: "C3 sits in the second space of the bass staff",
    teach: "The F clef (bass clef) is for the left hand. C3 — left-hand C — lives in the second space from the bottom.",
    course: [
      "The bass staff is a second five-line ladder, lower on the piano. The F clef curls around the F3 line, the second line from the top.",
      "C3, the left-hand C you practiced in the course, sits in the second space from the bottom. Play it each time you see that space.",
    ],
    kind: "find",
    notes: [48],
    goal: 6,
    showHint: true,
    showName: true,
    clef: "bass",
  },
  {
    id: "bass-g",
    unit: "The bass staff",
    title: "Bass G and F",
    skill: "G2 on the bottom line, F3 on the F-clef line",
    teach: "Bottom line of the bass staff is G2. The F clef marks F3. Those two landmarks unlock the rest.",
    course: [
      "Same idea as the G clef: one decorated letter names one line. Here that letter is F.",
      "Play G2 (bottom line) and F3 (the F-clef line). Count from those two if you get lost.",
    ],
    kind: "find",
    notes: [43, 53],
    goal: 8,
    showHint: true,
    showName: true,
    clef: "bass",
  },
  {
    id: "bass-c-position",
    unit: "The bass staff",
    title: "Left-hand C position on the staff",
    skill: "Read C3 through G3",
    teach: "The five notes of left-hand C position, now on the bass staff. No glow.",
    course: [
      "You already can play C3 D3 E3 F3 G3. Now they are written on the bass staff.",
      "This is the same job as the technique course, with the page instead of a letter name. Read, then play.",
    ],
    kind: "find",
    notes: [48, 50, 52, 53, 55],
    goal: 10,
    showHint: false,
    showName: false,
    clef: "bass",
  },
];

export const READING_UNIT_BLURBS: Record<string, string> = {
  "The treble staff": "The five lines the right hand reads. Learn the landmarks first, then the spaces and lines.",
  "Read and play": "See a note, play it. The glow and letter fade away until only the staff is left.",
  "Phrases on the page": "Left to right, one head at a time. Songs you already can play, now written down.",
  "The bass staff": "The five lines the left hand reads. The F clef marks F3. Middle C is a ledger above this staff.",
};

export const READING_UNITS = [...new Set(READING_LEVELS.map((level) => level.unit))];

export function readingById(id: string): ReadingLevel | undefined {
  return READING_LEVELS.find((level) => level.id === id);
}

export function readingIndex(id: string): number {
  return READING_LEVELS.findIndex((level) => level.id === id);
}
