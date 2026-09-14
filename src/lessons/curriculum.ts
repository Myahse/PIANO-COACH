import type { SongLevel } from "../music/difficulty";
import { melodyToTimed, scaleTimedNotes } from "../music/timed";
import type { TimedNote } from "../music/timed";
import { SONGS } from "../music/songs";

export type LevelKind = "find" | "sequence" | "hold" | "play";
export type Hand = "right" | "left" | "both";
export type DrillStep = number | number[];

export type LevelDef = {
  id: string;
  unit: string;
  title: string;
  skill: string;
  teach: string;
  course: string[];
  hand: Hand;
  fingers?: string;
  kind: LevelKind;
  notes: DrillStep[];
  bass?: number;
  goal?: number;
  showHint: boolean;
  /** Falling-note practice — references a built-in song. */
  songId?: string;
  /** Use the song picked from My songs (Course training picker). */
  useLibrarySong?: boolean;
  /** Easy / Medium / Hard for library training levels. */
  librarySongLevel?: SongLevel;
  /** Playback speed multiplier (0.65–1). Lower = slower tiles. */
  playSpeed?: number;
};

const C3 = 48;
const D3 = 50;
const E3 = 52;
const F3 = 53;
const G3 = 55;
const C4 = 60;
const D4 = 62;
const E4 = 64;
const F4 = 65;
const G4 = 67;
const A4 = 69;
const B4 = 71;
const C5 = 72;

function song(id: string): number[] {
  return [...(SONGS.find((item) => item.id === id)?.notes ?? [])];
}

export function levelTimedNotes(level: LevelDef, libraryNotes?: TimedNote[]): TimedNote[] {
  const speed = level.playSpeed ?? 0.78;
  if (level.useLibrarySong && libraryNotes?.length) {
    return scaleTimedNotes(libraryNotes, speed);
  }
  if (level.kind !== "play" || !level.songId) return [];
  const def = SONGS.find((item) => item.id === level.songId);
  if (!def) return [];
  return melodyToTimed(def.notes, def.beats, def.bpm * speed);
}

export function levelSequenceSteps(level: LevelDef, libraryNotes?: TimedNote[]): DrillStep[] {
  if (level.useLibrarySong && libraryNotes?.length) {
    return libraryNotes.map((note) => note.note);
  }
  return level.notes;
}

export const UNIT_BLURBS: Record<string, string> = {
  "Your imports": "Same import, rising difficulty — Easy vocals, then Medium chords, then the full Hard song.",
  "Play first": "Hear a tune, play it with falling notes, then lock in the keys it uses.",
  "Five-finger toolkit": "Short warm-ups between songs — not endless note-hunting drills.",
  "More melodies": "Same pattern: play with tiles, then practice the line note by note.",
  "Left hand & together": "Mirror the right-hand home shape, then add a held bass under the tune.",
  "Stretch & longer lines": "Full octave, scale, and songs that leave the five-finger box.",
  "The C chord": "Skips you already played — now as a chord and a simple two-hand shape.",
};

export const LEVELS: LevelDef[] = [
  {
    id: "my-song-easy-play",
    unit: "Your imports",
    title: "Your song · Easy · play",
    skill: "Vocal line — falling notes",
    teach: "Easy = vocals only. Play along with your recording; tiles wait for you.",
    course: ["Pick your song below on the course path. Clear each step to unlock Medium, then Hard."],
    hand: "right",
    fingers: "Vocal line",
    kind: "play",
    notes: [],
    useLibrarySong: true,
    librarySongLevel: "easy",
    playSpeed: 0.65,
    showHint: true,
  },
  {
    id: "my-song-easy-line",
    unit: "Your imports",
    title: "Your song · Easy · line",
    skill: "Vocal line — note by note",
    teach: "Same Easy vocal line without tiles. Lock in the melody before Medium.",
    course: [],
    hand: "right",
    fingers: "Vocal line",
    kind: "sequence",
    notes: [],
    useLibrarySong: true,
    librarySongLevel: "easy",
    showHint: true,
  },
  {
    id: "my-song-medium-play",
    unit: "Your imports",
    title: "Your song · Medium · play",
    skill: "Vocals + chords — falling notes",
    teach: "Medium adds simplified chords under the vocal. More notes — take it slower.",
    course: [],
    hand: "both",
    fingers: "Vocals + chords",
    kind: "play",
    notes: [],
    useLibrarySong: true,
    librarySongLevel: "medium",
    playSpeed: 0.7,
    showHint: true,
  },
  {
    id: "my-song-hard-play",
    unit: "Your imports",
    title: "Your song · Hard · play",
    skill: "Full song — falling notes",
    teach: "Hard = full transcription, faithful to the recording. The real deal.",
    course: [],
    hand: "both",
    fingers: "Full arrangement",
    kind: "play",
    notes: [],
    useLibrarySong: true,
    librarySongLevel: "hard",
    playSpeed: 0.76,
    showHint: true,
  },
  {
    id: "hot-cross-play",
    unit: "Play first",
    title: "Hot Cross Buns · play",
    skill: "Falling notes — listen, then hit each tile",
    teach: "Watch the tiles fall. Play E, D, and C as they reach the keyboard line. Repeats are part of the song.",
    course: ["Three notes only: E, D, C. Same falling-note practice as the Play tab."],
    hand: "right",
    fingers: "RH 3 2 1 on E D C",
    kind: "play",
    notes: [],
    songId: "hot-cross",
    playSpeed: 0.72,
    showHint: true,
  },
  {
    id: "hot-cross-keys",
    unit: "Play first",
    title: "The three keys",
    skill: "Find E, D, and C in C position",
    teach: "These are the only notes in Hot Cross Buns. Thumb stays on Middle C — fingers 3, 2, 1 play the melody.",
    course: [],
    hand: "right",
    fingers: "RH 3 2 1",
    kind: "find",
    notes: [E4, D4, C4],
    goal: 8,
    showHint: true,
  },
  {
    id: "hot-cross",
    unit: "Play first",
    title: "Hot Cross Buns · line",
    skill: "Play the melody in order",
    teach: "E D C, repeats included. Same song — now without tiles.",
    course: [],
    hand: "right",
    fingers: "RH 3 2 1",
    kind: "sequence",
    notes: song("hot-cross"),
    showHint: true,
  },
  {
    id: "keyboard-map",
    unit: "Five-finger toolkit",
    title: "C position map",
    skill: "Five white keys under one hand",
    teach: "Thumb on Middle C (left of two black keys). Cover C D E F G — that is home for most beginner songs.",
    course: ["Two blacks = C D E. Three blacks = F G A B. You only need C through G for now."],
    hand: "right",
    fingers: "RH 1 2 3 4 5",
    kind: "find",
    notes: [C4, D4, E4, F4, G4],
    goal: 10,
    showHint: true,
  },
  {
    id: "five-finger",
    unit: "Five-finger toolkit",
    title: "Five-finger wave",
    skill: "Walk up and down without moving the hand",
    teach: "C D E F G F E D C. One finger per key. Even tone — no thumping the thumb.",
    course: [],
    hand: "right",
    fingers: "RH 1 2 3 4 5 4 3 2 1",
    kind: "sequence",
    notes: [C4, D4, E4, F4, G4, F4, E4, D4, C4],
    showHint: true,
  },
  {
    id: "rh-skips",
    unit: "Five-finger toolkit",
    title: "Skips: C, E, G",
    skill: "Jump a white key — fingers 1, 3, 5",
    teach: "Skip D and F. This is the C major chord one note at a time.",
    course: [],
    hand: "right",
    fingers: "RH 1 3 5 3 1",
    kind: "sequence",
    notes: [C4, E4, G4, E4, C4],
    showHint: true,
  },
  {
    id: "mary-play",
    unit: "More melodies",
    title: "Mary · play",
    skill: "Falling notes on a turning melody",
    teach: "Starts E D C D E. The line turns around E — watch for repeats.",
    course: [],
    hand: "right",
    fingers: "RH in C position",
    kind: "play",
    notes: [],
    songId: "mary",
    playSpeed: 0.76,
    showHint: true,
  },
  {
    id: "mary",
    unit: "More melodies",
    title: "Mary · line",
    skill: "Repeated notes — same finger, same key",
    teach: "E D C D E E E … Play every repeat. Stay in C position.",
    course: [],
    hand: "right",
    fingers: "RH in C position",
    kind: "sequence",
    notes: song("mary"),
    showHint: true,
  },
  {
    id: "ode-play",
    unit: "More melodies",
    title: "Ode to Joy · play",
    skill: "A longer phrase with falling notes",
    teach: "Begins on E, not C. Read the tiles one beat ahead.",
    course: [],
    hand: "right",
    fingers: "RH, starts on 3",
    kind: "play",
    notes: [],
    songId: "ode",
    playSpeed: 0.74,
    showHint: true,
  },
  {
    id: "ode",
    unit: "More melodies",
    title: "Ode to Joy · line",
    skill: "Longer melody — walks and repeats",
    teach: "Same tune without tiles. Keep the hand quiet between notes.",
    course: [],
    hand: "right",
    fingers: "RH, starts on 3",
    kind: "sequence",
    notes: song("ode"),
    showHint: true,
  },
  {
    id: "lh-home",
    unit: "Left hand & together",
    title: "Left-hand home",
    skill: "C3 under the little finger",
    teach: "Left-hand C is one octave below Middle C — same landmark, little finger (5).",
    course: [],
    hand: "left",
    fingers: "LH 5 on C3",
    kind: "find",
    notes: [C3, D3, E3, F3, G3],
    goal: 10,
    showHint: true,
  },
  {
    id: "lh-wave",
    unit: "Left hand & together",
    title: "Left-hand wave",
    skill: "Mirror the right-hand exercise",
    teach: "C3 to G3 and back. Numbers run 5 4 3 2 1 going up.",
    course: [],
    hand: "left",
    fingers: "LH 5 4 3 2 1 2 3 4 5",
    kind: "sequence",
    notes: [C3, D3, E3, F3, G3, F3, E3, D3, C3],
    showHint: true,
  },
  {
    id: "both-c",
    unit: "Left hand & together",
    title: "Both hands on C",
    skill: "Same letter, two octaves",
    teach: "LH 5 on C3, RH 1 on Middle C. Drop together.",
    course: [],
    hand: "both",
    fingers: "LH 5 + RH 1",
    kind: "find",
    notes: [[C3, C4]],
    goal: 6,
    showHint: true,
  },
  {
    id: "both-parallel",
    unit: "Left hand & together",
    title: "Parallel walk",
    skill: "Both hands move the same direction",
    teach: "C D E F G and back — both hands at once.",
    course: [],
    hand: "both",
    fingers: "Together C D E F G F E D C",
    kind: "sequence",
    notes: [
      [C3, C4],
      [D3, D4],
      [E3, E4],
      [F3, F4],
      [G3, G4],
      [F3, F4],
      [E3, E4],
      [D3, D4],
      [C3, C4],
    ],
    showHint: true,
  },
  {
    id: "hold-hot-cross",
    unit: "Left hand & together",
    title: "Hot Cross + bass C",
    skill: "Hold C3 while the right hand plays the tune",
    teach: "Left little finger stays on C3. Right hand plays Hot Cross Buns on top.",
    course: [],
    hand: "both",
    fingers: "LH 5 holds · RH melody",
    kind: "hold",
    bass: C3,
    notes: song("hot-cross"),
    showHint: true,
  },
  {
    id: "twinkle-play",
    unit: "Stretch & longer lines",
    title: "Twinkle · play",
    skill: "Leaps — C to G with falling notes",
    teach: "Opening jump C C G G. Prepare finger 5 before you leave C.",
    course: [],
    hand: "right",
    fingers: "RH leap 1 to 5",
    kind: "play",
    notes: [],
    songId: "twinkle",
    playSpeed: 0.76,
    showHint: true,
  },
  {
    id: "twinkle",
    unit: "Stretch & longer lines",
    title: "Twinkle · line",
    skill: "Leap then walk down",
    teach: "C C G G A A G … Same jumps without tiles.",
    course: [],
    hand: "right",
    fingers: "RH leap 1 to 5",
    kind: "sequence",
    notes: song("twinkle"),
    showHint: true,
  },
  {
    id: "c-major-full",
    unit: "Stretch & longer lines",
    title: "C major scale",
    skill: "All white keys C to C",
    teach: "Up and down: C D E F G A B C B A G F E D C. Slow and even.",
    course: [],
    hand: "right",
    fingers: "RH scale up and down",
    kind: "sequence",
    notes: [C4, D4, E4, F4, G4, A4, B4, C5, B4, A4, G4, F4, E4, D4, C4],
    showHint: true,
  },
  {
    id: "london",
    unit: "Stretch & longer lines",
    title: "London Bridge",
    skill: "Weave around G and A",
    teach: "Starts on G. Uses A — stretch or shift when needed.",
    course: [],
    hand: "right",
    fingers: "RH starts on G",
    kind: "sequence",
    notes: song("london"),
    showHint: true,
  },
  {
    id: "jingle",
    unit: "Stretch & longer lines",
    title: "Jingle Bells",
    skill: "Many repeated E’s, then a lift",
    teach: "Finger 3 on E — play every repeat, then the line moves to G and C.",
    course: [],
    hand: "right",
    fingers: "RH many 3’s on E",
    kind: "sequence",
    notes: song("jingle"),
    showHint: true,
  },
  {
    id: "happy",
    unit: "Stretch & longer lines",
    title: "Happy Birthday",
    skill: "Reach C5 near the end",
    teach: "Mostly white keys you know. Shift up for the high C.",
    course: [],
    hand: "right",
    fingers: "RH includes C5",
    kind: "sequence",
    notes: song("happy"),
    showHint: true,
  },
  {
    id: "triad-find",
    unit: "The C chord",
    title: "C major triad",
    skill: "C, E, G in any order",
    teach: "Skip neighbors: C skip D E skip F G. Together they are C major.",
    course: [],
    hand: "right",
    fingers: "RH 1 3 5",
    kind: "find",
    notes: [C4, E4, G4],
    goal: 10,
    showHint: false,
  },
  {
    id: "broken-chord",
    unit: "The C chord",
    title: "Broken C chord",
    skill: "C E G as a pattern",
    teach: "One note at a time: C E G E C. This becomes left-hand accompaniment later.",
    course: [],
    hand: "right",
    fingers: "RH 1 3 5 3 1",
    kind: "sequence",
    notes: [C4, E4, G4, E4, C4, C4, E4, G4, E4, C4],
    showHint: true,
  },
  {
    id: "both-c-chord",
    unit: "The C chord",
    title: "Two-hand C chord",
    skill: "LH C+G, RH E together",
    teach: "Three keys, two hands, one C major sound.",
    course: [],
    hand: "both",
    fingers: "LH 5+1 on C+G · RH 3 on E",
    kind: "find",
    notes: [[C3, G3, E4]],
    goal: 6,
    showHint: true,
  },
];

export const UNITS = [...new Set(LEVELS.map((level) => level.unit))];

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((level) => level.id === id);
}

export function levelIndex(id: string): number {
  return LEVELS.findIndex((level) => level.id === id);
}

export function asSteps(notes: DrillStep[]): number[][] {
  return notes.map((step) => (Array.isArray(step) ? [...step] : [step]));
}
